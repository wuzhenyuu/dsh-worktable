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
const modalBundle = path.join(tempDir, 'modal-focus.cjs')

class MemoryStorage {
  constructor() { this.data = new Map() }
  getItem(key) { return this.data.has(key) ? this.data.get(key) : null }
  setItem(key, value) { this.data.set(key, String(value)) }
}

class ThrowingMigrationStorage extends MemoryStorage {
  setItem(key) { throw new Error(`SecurityError: blocked ${key}`) }
  removeItem(key) { this.data.delete(key) }
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
  await build({
    entryPoints: [path.join(repo, '01_content/src/client/modalFocus.ts')],
    outfile: modalBundle,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: ['node22'],
    logLevel: 'silent',
  })
  const d = require(bundle)
  const modal = require(modalBundle)
  const throwingInitialization = new d.ControlRoomsStorage(new ThrowingMigrationStorage()).load({
    projectIds: ['legacy-project'],
    projectOrder: ['legacy-project'],
    boundSessionId: 'legacy-session',
    layoutId: 'wt-console',
    themeMode: 'dark',
    rawProjects: '{"legacy":true}',
    rawView: '{"consoleTheme":"dark"}',
  }, 900)
  assert.equal(throwingInitialization.migrated, false, 'production initialization stays in compatibility mode after a storage security failure')
  assert.ok(throwingInitialization.state.rooms['room-default'], 'production initialization still returns a renderable legacy room')
  assert.match(String(throwingInitialization.persistenceError), /SecurityError/, 'production initialization exposes the persistence failure')
  const indexSource = fs.readFileSync(path.join(repo, '01_content/src/client/index.tsx'), 'utf8')
  assert.match(indexSource, /initialControlRoomsPersistenceErrorRef\.current = loaded\.persistenceError != null/, 'React initialization wires the repository failure into visible UI state')
  assert.match(indexSource, /data-wt-room-create-field="icon"[\s\S]*data-wt-room-create-field="description"/, 'the production create dialog renders accessible icon and description controls')
  assert.match(indexSource, /data-wt-room-manage-field="icon"[\s\S]*data-wt-room-manage-field="description"/, 'the production management dialog renders icon and description controls')
  assert.match(indexSource, /createNamedRoom\(roomCreateName, roomCreateIcon, roomCreateDescription\)/, 'the production create action persists all three rendered fields')
  assert.match(indexSource, /createControlRoom\(current\.state, \{ name, icon, description \}/, 'the create path stores icon and description in the domain model')
  assert.match(indexSource, /data-wt-room-manage-field="icon"[\s\S]*updateRoomPresentation\(room\.id, \{ icon \}\)[\s\S]*data-wt-room-manage-field="description"[\s\S]*updateRoomPresentation\(room\.id, \{ description \}\)/, 'the production management controls commit icon and description edits')
  assert.match(indexSource, /roomCreateDialogRef[\s\S]*installModalFocusGuard\([\s\S]*roomCreateNameRef/, 'the production create dialog installs the shared modal focus guard')
  assert.match(indexSource, /roomManageDialogRef[\s\S]*installModalFocusGuard\([\s\S]*roomDeleteId[\s\S]*\[roomManageId, roomDeleteId\]/, 'the production management guard pauses and resumes around nested deletion')
  const localeSource = fs.readFileSync(path.join(repo, '01_content/src/client/locales.ts'), 'utf8')
  for (const key of ['rooms.icon', 'rooms.iconPh', 'rooms.description', 'rooms.descriptionPh']) {
    assert.equal(localeSource.split(`'${key}'`).length - 1, 2, `${key} is complete in Chinese and English`)
  }
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
  const deletionResolved = d.resolveControlRoomStorageEvent(
    localBeforeStorage,
    externalDeletion.state,
    'room-9',
    d.createEmptyControlRoomsTrashState(),
    externalDeletion.trash,
  )
  assert.equal(deletionResolved.state.rooms['room-0'], undefined, 'a newer external deletion removes only the room configuration')
  assert.ok(deletionResolved.state.rooms['room-1'], 'external room deletion leaves other room configurations intact')

  const localDeletion = d.deleteControlRoom(localBeforeStorage, d.createEmptyControlRoomsTrashState(), 'room-1', 3_100)
  const staleIncoming = d.updateControlRoom(localBeforeStorage, 'room-1', { name: 'stale resurrection' }, 3_050)
  const staleResolved = d.resolveControlRoomStorageEvent(
    localDeletion.state,
    staleIncoming,
    'room-9',
    localDeletion.trash,
    d.createEmptyControlRoomsTrashState(),
  )
  assert.equal(staleResolved.state.rooms['room-1'], undefined, 'stale external room data cannot resurrect a local deletion')
  assert.equal(staleResolved.trash.deleted.length, 1, 'local recovery entry survives an accepted stale storage event')
  assert.equal(staleResolved.trash.deleted[0].room.name, 'Room 1')
  const reconciliationRepository = new d.ControlRoomsStorage(new MemoryStorage())
  assert.equal(reconciliationRepository.save(staleResolved.state, staleResolved.trash).ok, true)
  const reconciliationReload = reconciliationRepository.load(undefined, 3_150)
  assert.equal(reconciliationReload.state.rooms['room-1'], undefined, 'accepted reconciliation persists the no-resurrection result')
  assert.equal(reconciliationReload.trash.deleted[0].room.name, 'Room 1', 'accepted reconciliation persists the recovery entry')

  const newerIncomingDeletion = d.deleteControlRoom(localBeforeStorage, d.createEmptyControlRoomsTrashState(), 'room-1', 3_200)
  const tombstoneResolved = d.resolveControlRoomStorageEvent(
    localDeletion.state,
    newerIncomingDeletion.state,
    'room-9',
    localDeletion.trash,
    newerIncomingDeletion.trash,
  )
  assert.equal(tombstoneResolved.trash.deleted.length, 1, 'tombstones reconcile per room ID')
  assert.equal(tombstoneResolved.trash.deleted[0].room.updatedAt, 3_200, 'newest tombstone retains the recovery configuration')

  let activeElement = null
  let keydown = null
  const makeFocusable = (name) => ({
    isConnected: true,
    name,
    focus() { activeElement = this },
  })
  const first = makeFocusable('first')
  const last = makeFocusable('last')
  const returnFocus = makeFocusable('return')
  const fakeDocument = {
    get activeElement() { return activeElement },
    addEventListener(type, listener, capture) { assert.equal(type, 'keydown'); assert.equal(capture, true); keydown = listener },
    removeEventListener(type, listener, capture) { assert.equal(type, 'keydown'); assert.equal(listener, keydown); assert.equal(capture, true) },
  }
  const dialog = {
    ownerDocument: fakeDocument,
    querySelectorAll() { return [first, last] },
    contains(element) { return element === first || element === last },
  }
  let escaped = 0
  const disposeModal = modal.installModalFocusGuard({
    dialog,
    initialFocus: first,
    returnFocus,
    onEscape: () => { escaped += 1 },
    schedule: (callback) => callback(),
  })
  assert.equal(activeElement, first, 'modal guard moves initial focus into the confirmation')
  let prevented = 0
  activeElement = makeFocusable('outside')
  keydown({ key: 'Tab', shiftKey: false, preventDefault: () => { prevented += 1 }, stopPropagation() {} })
  assert.equal(activeElement, first, 'Tab from outside is contained inside the modal')
  activeElement = last
  keydown({ key: 'Tab', shiftKey: false, preventDefault: () => { prevented += 1 }, stopPropagation() {} })
  assert.equal(activeElement, first, 'Tab wraps from the last control to the first')
  activeElement = first
  keydown({ key: 'Tab', shiftKey: true, preventDefault: () => { prevented += 1 }, stopPropagation() {} })
  assert.equal(activeElement, last, 'Shift+Tab wraps from the first control to the last')
  keydown({ key: 'Escape', shiftKey: false, preventDefault: () => { prevented += 1 }, stopPropagation() {} })
  assert.equal(escaped, 1, 'Escape invokes the modal close path')
  assert.equal(prevented, 4, 'trapped keys suppress background interaction')
  disposeModal()
  assert.equal(activeElement, returnFocus, 'closing the confirmation restores trigger focus')

  const parentReturn = makeFocusable('parent-return')
  const parentClose = makeFocusable('parent-close')
  const deleteTrigger = makeFocusable('delete-trigger')
  const deleteCancel = makeFocusable('delete-cancel')
  const nestedDocument = {
    get activeElement() { return activeElement },
    addEventListener() {},
    removeEventListener() {},
  }
  const parentDialog = { ownerDocument: nestedDocument, querySelectorAll: () => [parentClose, deleteTrigger], contains: (element) => element === parentClose || element === deleteTrigger }
  const deleteDialog = { ownerDocument: nestedDocument, querySelectorAll: () => [deleteCancel], contains: (element) => element === deleteCancel }
  const disposeParentBeforeDelete = modal.installModalFocusGuard({
    dialog: parentDialog, initialFocus: parentClose, returnFocus: parentReturn, onEscape() {}, schedule: (callback) => callback(),
  })
  assert.equal(activeElement, parentClose, 'parent management dialog receives initial focus')
  disposeParentBeforeDelete()
  const disposeNestedDelete = modal.installModalFocusGuard({
    dialog: deleteDialog, initialFocus: deleteCancel, returnFocus: deleteTrigger, onEscape() {}, schedule: (callback) => callback(),
  })
  assert.equal(activeElement, deleteCancel, 'nested deletion pauses the parent and receives focus')
  disposeNestedDelete()
  assert.equal(activeElement, deleteTrigger, 'closing nested deletion restores its parent-dialog trigger')
  const disposeResumedParent = modal.installModalFocusGuard({
    dialog: parentDialog, initialFocus: deleteTrigger, returnFocus: parentReturn, onEscape() {}, schedule: (callback) => callback(),
  })
  assert.equal(activeElement, deleteTrigger, 'resumed parent guard keeps focus on the appropriate control')
  disposeResumedParent()
  assert.equal(activeElement, parentReturn, 'closing the resumed parent restores the original external trigger')

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
