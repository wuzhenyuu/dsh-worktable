/* Deterministic scale gate for the documented 100-room x 1000-reference target. */
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { performance } = require('node:perf_hooks')
const { build } = require('../01_content/node_modules/esbuild')

const repo = path.resolve(__dirname, '..')
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-control-room-scale-'))

class MemoryStorage {
  constructor() { this.data = new Map() }
  getItem(key) { return this.data.has(key) ? this.data.get(key) : null }
  setItem(key, value) { this.data.set(key, String(value)) }
}

async function bundle(name) {
  const outfile = path.join(tempDir, `${name}.cjs`)
  await build({
    entryPoints: [path.join(repo, `01_content/src/client/${name}.ts`)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: ['node22'],
    logLevel: 'silent',
  })
  return require(outfile)
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)]
}

function timedMedian(fn, warmups = 2, samples = 5) {
  for (let index = 0; index < warmups; index += 1) fn()
  const timings = []
  for (let index = 0; index < samples; index += 1) {
    const startedAt = performance.now()
    fn()
    timings.push(performance.now() - startedAt)
  }
  return { medianMs: median(timings), timings }
}

function scaleFixture() {
  const order = []
  const rooms = {}
  for (let roomIndex = 0; roomIndex < 100; roomIndex += 1) {
    const roomId = `room-${roomIndex}`
    const projectIds = Array.from({ length: 1_000 }, (_, projectIndex) => `project-${projectIndex}`)
    order.push(roomId)
    rooms[roomId] = {
      id: roomId,
      name: `Room ${roomIndex}`,
      projectIds,
      projectOrder: [...projectIds].reverse(),
      fixedProjectIds: projectIds.slice(900, 950),
      excludedProjectIds: projectIds.slice(0, 10),
      updatedAt: roomIndex + 1,
    }
  }
  return { version: 1, order, activeId: 'room-0', rooms }
}

async function main() {
  const domain = await bundle('controlRooms')
  const runtime = await bundle('controlRoomRuntime')
  const fixture = scaleFixture()
  let lastCount = 0
  let normalized = null

  const fullProjection = timedMedian(() => {
    normalized = domain.normalizeControlRoomsState(fixture)
    let count = 0
    for (const roomId of normalized.order) {
      count += runtime.effectiveControlRoomProjectIds(normalized.rooms[roomId]).length
    }
    lastCount = count
  })

  assert.equal(lastCount, 99_000, 'ten exclusions per room are honored across the full 100 x 1000 projection')
  assert.deepEqual(
    runtime.effectiveControlRoomProjectIds(normalized.rooms['room-0']).slice(0, 3),
    ['project-999', 'project-998', 'project-997'],
    'large-room membership keeps the declared reverse project order',
  )
  assert.equal(
    runtime.effectiveControlRoomProjectIds(normalized.rooms['room-0']).at(-1),
    'project-10',
    'large-room membership removes exclusions without disturbing the remaining tail order',
  )

  const untrusted = {
    version: 1,
    order: ['room-untrusted', 'room-untrusted', 'missing-room'],
    activeId: 'missing-room',
    rooms: {
      'room-untrusted': {
        id: 'room-untrusted',
        name: '',
        projectIds: ['project-b', 'project-a', 'project-a'],
        projectOrder: ['project-a', 'missing-project'],
      },
    },
  }
  const normalizedMutation = domain.reorderProjectsInRoom(untrusted, 'room-untrusted', ['project-b'], 49_999)
  assert.deepEqual(normalizedMutation.order, ['room-untrusted'], 'an untrusted reducer input is normalized once at the public seam')
  assert.equal(normalizedMutation.activeId, null, 'an untrusted reducer input cannot retain an invalid active room')
  assert.deepEqual(normalizedMutation.rooms['room-untrusted'].projectIds, ['project-b', 'project-a'])
  assert.deepEqual(normalizedMutation.rooms['room-untrusted'].projectOrder, ['project-b', 'project-a'])

  const untouchedRoom = normalized.rooms['room-0']
  const targetBefore = normalized.rooms['room-50']
  const targetOrder = [...targetBefore.projectOrder].reverse()
  let reordered = null
  const singleRoomMutation = timedMedian(() => {
    reordered = domain.reorderProjectsInRoom(normalized, 'room-50', targetOrder, 50_000)
  })
  assert.equal(reordered.rooms['room-0'], untouchedRoom, 'a single-room reorder preserves untouched room object identity')
  assert.notEqual(reordered.rooms['room-50'], targetBefore, 'a single-room reorder replaces only the target room')
  assert.deepEqual(reordered.rooms['room-50'].projectOrder.slice(0, 3), ['project-0', 'project-1', 'project-2'])

  const storage = new MemoryStorage()
  const repository = new domain.ControlRoomsStorage(storage)
  const emptyTrash = domain.createEmptyControlRoomsTrashState()
  let saved = null
  const mutationAndPersistence = timedMedian(() => {
    saved = domain.reorderProjectsInRoom(normalized, 'room-50', targetOrder, 50_000)
    assert.equal(repository.save(saved, emptyTrash).ok, true)
  })
  const persisted = JSON.parse(storage.getItem(domain.CONTROL_ROOMS_KEY))
  assert.deepEqual(persisted.rooms['room-50'].projectOrder.slice(0, 3), ['project-0', 'project-1', 'project-2'])

  assert.ok(
    fullProjection.medianMs < 100,
    `100-room x 1000-reference normalization and membership projection must stay under 100ms; median=${fullProjection.medianMs.toFixed(2)}ms samples=${fullProjection.timings.map((value) => value.toFixed(2)).join(',')}`,
  )
  assert.ok(
    singleRoomMutation.medianMs < 100,
    `single-room mutation in a 100 x 1000 state must stay under 100ms; median=${singleRoomMutation.medianMs.toFixed(2)}ms samples=${singleRoomMutation.timings.map((value) => value.toFixed(2)).join(',')}`,
  )
  assert.ok(
    mutationAndPersistence.medianMs < 100,
    `single-room mutation plus persistence in a 100 x 1000 state must stay under 100ms; median=${mutationAndPersistence.medianMs.toFixed(2)}ms samples=${mutationAndPersistence.timings.map((value) => value.toFixed(2)).join(',')}`,
  )

  process.stdout.write(
    `control-room-scale: PASS (100 rooms x 1000 refs; normalize+project median ${fullProjection.medianMs.toFixed(2)}ms; single-room mutation median ${singleRoomMutation.medianMs.toFixed(2)}ms; mutation+save median ${mutationAndPersistence.medianMs.toFixed(2)}ms)\n`,
  )
}

main()
  .catch((error) => {
    process.stderr.write(`${error && error.stack ? error.stack : error}\n`)
    process.exitCode = 1
  })
  .finally(() => fs.rmSync(tempDir, { recursive: true, force: true }))
