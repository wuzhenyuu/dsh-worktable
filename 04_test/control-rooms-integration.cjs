/* Portable integration assertions for persisted room actions and navigation selection. */
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { build } = require('../01_content/node_modules/esbuild')

const repo = path.resolve(__dirname, '..')
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-control-room-integration-'))
const bundle = path.join(tempDir, 'control-rooms.cjs')

class MemoryStorage {
  constructor() { this.data = new Map() }
  getItem(key) { return this.data.has(key) ? this.data.get(key) : null }
  setItem(key, value) { this.data.set(key, String(value)) }
}

async function main() {
  await build({
    entryPoints: [path.join(repo, '01_content/src/client/controlRooms.ts')],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: ['node22'],
    logLevel: 'silent',
  })
  const d = require(bundle)
  const storage = new MemoryStorage()
  const repository = new d.ControlRoomsStorage(storage)
  let { state, trash } = repository.load()
  const save = (nextState, nextTrash = trash) => {
    state = nextState
    trash = nextTrash
    assert.equal(repository.save(state, trash).ok, true)
  }

  for (let index = 0; index < 10; index += 1) {
    save(d.createControlRoom(state, { name: `Room ${index}` }, { id: `room-${index}`, now: 1_000 + index }))
  }
  assert.equal(repository.load().state.order.length, 10, 'ten persisted rooms remain available')

  for (const roomId of ['room-0', 'room-1', 'room-2']) {
    save(d.addProjectToRoom(state, roomId, 'shared-project', 2_000))
  }
  assert.deepEqual(['room-0', 'room-1', 'room-2'].map((id) => state.rooms[id].projectIds), [
    ['shared-project'], ['shared-project'], ['shared-project'],
  ], 'one project may be referenced by three rooms')

  save(d.removeProjectFromRoom(state, 'room-0', 'shared-project', 2_001))
  assert.deepEqual(state.rooms['room-0'].projectIds, [], 'removal affects the selected room')
  assert.deepEqual(state.rooms['room-1'].projectIds, ['shared-project'], 'removal leaves other rooms untouched')

  save(d.selectControlRoom(state, 'room-9', 3_000))
  const nav = d.selectControlRoomNavigation(state, new Set(['room-0']))
  assert.equal(nav.primaryIds.length, 7, 'six recent rooms plus the required need room are visible')
  assert.deepEqual(nav.primaryIds, ['room-9', 'room-8', 'room-7', 'room-6', 'room-5', 'room-4', 'room-0'], 'recent rooms are ordered most-recent first')
  assert.ok(nav.primaryIds.includes('room-9'), 'current room remains visible')
  assert.ok(nav.primaryIds.includes('room-0'), 'need room remains visible')
  assert.deepEqual(nav.moreIds, ['room-1', 'room-2', 'room-3'], 'remaining rooms are available under More')

  const localBeforeStorage = state
  let incoming = d.updateControlRoom(state, 'room-0', { name: 'external newer' }, 3_001)
  incoming = d.createControlRoom(incoming, { name: 'external room' }, { id: 'external', now: 3_001 })
  const resolved = d.resolveControlRoomStorageEvent(localBeforeStorage, incoming, 'room-9')
  assert.equal(resolved.requiresReload, false, 'newer work outside the open room merges immediately')
  assert.equal(resolved.state.rooms['room-0'].name, 'external newer')
  assert.ok(resolved.state.rooms.external)

  incoming = d.updateControlRoom(incoming, 'room-9', { name: 'open room changed elsewhere' }, 3_002)
  const conflict = d.resolveControlRoomStorageEvent(localBeforeStorage, incoming, 'room-9')
  assert.equal(conflict.requiresReload, true, 'externally newer open work requires an explicit reload')
  assert.equal(conflict.state.rooms['room-9'].name, localBeforeStorage.rooms['room-9'].name, 'open local work is not silently replaced')

  const externalDeletion = d.deleteControlRoom(incoming, d.createEmptyControlRoomsTrashState(), 'room-0', 3_003)
  const deletionResolved = d.resolveControlRoomStorageEvent(localBeforeStorage, externalDeletion.state, 'room-9', externalDeletion.trash)
  assert.equal(deletionResolved.state.rooms['room-0'], undefined, 'a newer external deletion removes only the room configuration')
  assert.ok(deletionResolved.state.rooms['room-1'], 'external room deletion leaves other room configurations intact')

  let deletedRoom0 = null
  for (const roomId of [...state.order]) {
    const result = d.deleteControlRoom(state, trash, roomId, 4_000)
    if (roomId === 'room-0') deletedRoom0 = result.deleted
    save(result.state, result.trash)
  }
  assert.equal(state.activeId, null, 'the final room can be deleted')
  assert.deepEqual(state.order, [], 'deleting the final room produces the empty state')
  assert.ok(deletedRoom0, 'deleted configuration is retained in trash')

  const restored = d.restoreControlRoom(state, trash, 'room-0', 4_001)
  save(restored.state, restored.trash)
  assert.equal(restored.restoredId, 'room-0', 'deleted configuration can be restored')
  assert.equal(state.rooms['room-0'].name, 'Room 0', 'restoration keeps configuration fields')

  process.stdout.write('control-rooms-integration: PASS (navigation and persistence flow)\n')
}

main()
  .catch((error) => {
    process.stderr.write(`${error && error.stack ? error.stack : error}\n`)
    process.exitCode = 1
  })
  .finally(() => fs.rmSync(tempDir, { recursive: true, force: true }))
