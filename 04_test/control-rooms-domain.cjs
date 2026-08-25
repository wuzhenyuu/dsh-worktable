/* Portable pure-domain test: bundles the TypeScript source with project-local esbuild. */
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { build } = require('../01_content/node_modules/esbuild')

const repo = path.resolve(__dirname, '..')
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-control-rooms-'))
const bundle = path.join(tempDir, 'control-rooms.cjs')

class MemoryStorage {
  constructor(seed = {}) {
    this.data = new Map(Object.entries(seed))
    this.writes = []
    this.failKey = null
  }

  getItem(key) {
    return this.data.has(key) ? this.data.get(key) : null
  }

  setItem(key, value) {
    if (key === this.failKey) throw new Error(`write failed: ${key}`)
    this.writes.push(key)
    this.data.set(key, String(value))
  }
}

let cases = 0
function test(_name, fn) {
  fn()
  cases += 1
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
  const NOW = 1_800_000_000_000
  const empty = () => d.createEmptyControlRoomsState()
  const emptyTrash = () => d.createEmptyControlRoomsTrashState()
  const create = (state, id, now = NOW, extra = {}) => d.createControlRoom(state, { name: id, ...extra }, { id, now })

  // CRUD: eight independent acceptance cases.
  test('create defaults and activate', () => {
    const state = create(empty(), 'room-a')
    assert.deepEqual(state.order, ['room-a'])
    assert.equal(state.activeId, 'room-a')
    assert.equal(state.rooms['room-a'].layoutId, 'wt-console:room-a')
    assert.deepEqual(state.rooms['room-a'].cardLayout, { columns: 2, cardSize: 'comfortable' })
  })

  test('create ten rooms', () => {
    let state = empty()
    for (let index = 0; index < 10; index += 1) state = create(state, `room-${index}`, NOW + index)
    assert.equal(state.order.length, 10)
    assert.equal(Object.keys(state.rooms).length, 10)
  })

  test('update preserves identity and created time', () => {
    const before = create(empty(), 'room-a')
    const state = d.updateControlRoom(before, 'room-a', { name: 'Renamed', icon: '🌡️' }, NOW + 10)
    assert.equal(state.rooms['room-a'].name, 'Renamed')
    assert.equal(state.rooms['room-a'].createdAt, NOW)
    assert.equal(state.rooms['room-a'].updatedAt, NOW + 10)
  })

  test('copy duplicates configuration but not binding', () => {
    const before = create(empty(), 'room-a', NOW, {
      projectIds: ['p1'], projectOrder: ['p1'], boundSessionId: 'session-secret', themeMode: 'dark',
    })
    const state = d.copyControlRoom(before, 'room-a', { id: 'room-copy', now: NOW + 1 })
    assert.deepEqual(state.rooms['room-copy'].projectIds, ['p1'])
    assert.equal(state.rooms['room-copy'].boundSessionId, null)
    assert.equal(state.rooms['room-copy'].layoutId, 'wt-console:room-copy')
    assert.equal(state.rooms['room-copy'].themeMode, 'dark')
  })

  test('delete enters 30-day trash without mutating room references', () => {
    const before = create(empty(), 'room-a', NOW, { projectIds: ['p1'], boundSessionId: 's1' })
    const result = d.deleteControlRoom(before, emptyTrash(), 'room-a', NOW + 5)
    assert.equal(result.state.rooms['room-a'], undefined)
    assert.deepEqual(result.deleted.room.projectIds, ['p1'])
    assert.equal(result.deleted.room.boundSessionId, 's1')
    assert.equal(result.deleted.expiresAt - result.deleted.deletedAt, d.CONTROL_ROOM_TRASH_TTL_MS)
  })

  test('delete final room is permitted', () => {
    const result = d.deleteControlRoom(create(empty(), 'only'), emptyTrash(), 'only', NOW)
    assert.deepEqual(result.state.order, [])
    assert.equal(result.state.activeId, null)
  })

  test('restore recreates full configuration', () => {
    const before = create(empty(), 'room-a', NOW, { rules: [{ id: 'r1', enabled: true, mode: 'all', conditions: [] }] })
    const removed = d.deleteControlRoom(before, emptyTrash(), 'room-a', NOW + 1)
    const restored = d.restoreControlRoom(removed.state, removed.trash, 'room-a', NOW + 2)
    assert.equal(restored.restoredId, 'room-a')
    assert.equal(restored.state.rooms['room-a'].rules[0].id, 'r1')
    assert.equal(restored.state.rooms['room-a'].deletedAt, null)
  })

  test('expired trash cannot restore', () => {
    const removed = d.deleteControlRoom(create(empty(), 'room-a'), emptyTrash(), 'room-a', NOW)
    const result = d.restoreControlRoom(removed.state, removed.trash, 'room-a', NOW + d.CONTROL_ROOM_TRASH_TTL_MS)
    assert.equal(result.restoredId, null)
    assert.equal(result.trash.deleted.length, 0)
  })

  // Membership/order: five independent acceptance cases.
  test('same project may belong to three rooms', () => {
    let state = create(create(create(empty(), 'a'), 'b'), 'c')
    for (const roomId of ['a', 'b', 'c']) state = d.addProjectToRoom(state, roomId, 'shared', NOW + 1)
    assert.deepEqual(['a', 'b', 'c'].map((id) => state.rooms[id].projectIds), [['shared'], ['shared'], ['shared']])
  })

  test('duplicate add is idempotent', () => {
    let state = create(empty(), 'a')
    state = d.addProjectToRoom(state, 'a', 'p1', NOW + 1)
    state = d.addProjectToRoom(state, 'a', 'p1', NOW + 2)
    assert.deepEqual(state.rooms.a.projectIds, ['p1'])
    assert.deepEqual(state.rooms.a.projectOrder, ['p1'])
  })

  test('remove is isolated to target room', () => {
    let state = create(create(empty(), 'a', NOW, { projectIds: ['p1'] }), 'b', NOW, { projectIds: ['p1'] })
    state = d.removeProjectFromRoom(state, 'a', 'p1', NOW + 1)
    assert.deepEqual(state.rooms.a.projectIds, [])
    assert.deepEqual(state.rooms.b.projectIds, ['p1'])
  })

  test('reorder is deterministic and retains omitted projects', () => {
    const before = create(empty(), 'a', NOW, { projectIds: ['p1', 'p2', 'p3'], projectOrder: ['p1', 'p2', 'p3'] })
    const state = d.reorderProjectsInRoom(before, 'a', ['p3', 'unknown', 'p3', 'p1'], NOW + 1)
    assert.deepEqual(state.rooms.a.projectOrder, ['p3', 'p1', 'p2'])
  })

  test('fix and exclude are room-local reference operations', () => {
    let state = create(create(empty(), 'a'), 'b')
    state = d.setProjectFixed(state, 'a', 'p1', true, NOW + 1)
    state = d.setProjectExcluded(state, 'a', 'p1', true, NOW + 2)
    assert.deepEqual(state.rooms.a.fixedProjectIds, ['p1'])
    assert.deepEqual(state.rooms.a.excludedProjectIds, ['p1'])
    assert.deepEqual(state.rooms.b.fixedProjectIds, [])
  })

  test('normalization deduplicates reference lists and disables only damaged rule', () => {
    const source = create(empty(), 'a')
    source.rooms.a.projectIds = ['p1', 'p1', 'p2']
    source.rooms.a.projectOrder = ['missing', 'p2', 'p2']
    source.rooms.a.rules = [{ id: 'bad', enabled: true, mode: 'all', conditions: [{ field: 'wat', operator: 'equals', value: 1 }] }]
    const state = d.normalizeControlRoomsState(source)
    assert.deepEqual(state.rooms.a.projectIds, ['p1', 'p2'])
    assert.deepEqual(state.rooms.a.projectOrder, ['p2', 'p1'])
    assert.equal(state.rooms.a.rules[0].enabled, false)
  })

  test('newer summary wins and older summary is refused', () => {
    const local = create(empty(), 'a', NOW, { name: 'local' })
    const newer = d.updateControlRoom(local, 'a', { name: 'newer' }, NOW + 20)
    const merged = d.mergeControlRoomSummaries(newer, local)
    assert.equal(merged.rooms.a.name, 'newer')
  })

  test('audit retains exactly the latest 100 entries', () => {
    let audit = []
    for (let index = 0; index < 105; index += 1) {
      audit = d.appendControlRoomAudit(audit, { actor: index % 2 ? 'user' : 'deepseek', timestamp: index, action: 'update', controlRoomId: 'a', summary: String(index) })
    }
    assert.equal(audit.length, 100)
    assert.equal(audit[0].summary, '5')
    assert.equal(audit[99].summary, '104')
  })

  // Migration/backup/restore: at least five independent acceptance cases.
  const legacy = {
    projectIds: ['p2', 'p1'],
    projectOrder: ['p1', 'p2'],
    boundSessionId: 'legacy-session',
    layoutId: 'wt-console',
    themeMode: 'dark',
    rawProjects: '{"bindings":{"wt-console":"legacy-session"}}',
    rawView: '{"consoleTheme":"dark"}',
  }

  test('migration writes raw backup before new-format keys', () => {
    const storage = new MemoryStorage()
    new d.ControlRoomsStorage(storage).load(legacy, NOW)
    assert.deepEqual(storage.writes, [d.CONTROL_ROOMS_MIGRATION_BACKUP_KEY, d.CONTROL_ROOMS_TRASH_KEY, d.CONTROL_ROOMS_KEY])
  })

  test('migration creates exact default identity and layout', () => {
    const result = new d.ControlRoomsStorage(new MemoryStorage()).load(legacy, NOW)
    assert.equal(result.migrated, true)
    assert.deepEqual(result.state.order, ['room-default'])
    assert.equal(result.state.rooms['room-default'].layoutId, 'wt-console:room-default')
  })

  test('migration preserves project order binding and theme', () => {
    const room = new d.ControlRoomsStorage(new MemoryStorage()).load(legacy, NOW).state.rooms['room-default']
    assert.deepEqual(room.projectIds, ['p2', 'p1'])
    assert.deepEqual(room.projectOrder, ['p1', 'p2'])
    assert.equal(room.boundSessionId, 'legacy-session')
    assert.equal(room.themeMode, 'dark')
  })

  test('migration backup retains exact raw legacy bytes and old layout reference', () => {
    const facade = new d.ControlRoomsStorage(new MemoryStorage())
    facade.load(legacy, NOW)
    const backup = facade.readMigrationBackup()
    assert.equal(backup.rawProjects, legacy.rawProjects)
    assert.equal(backup.rawView, legacy.rawView)
    assert.equal(backup.legacy.layoutId, 'wt-console')
  })

  test('migration never deletes or rewrites legacy keys', () => {
    const storage = new MemoryStorage({ [d.LEGACY_PROJECTS_KEY]: legacy.rawProjects, [d.LEGACY_VIEW_KEY]: legacy.rawView })
    new d.ControlRoomsStorage(storage).load(legacy, NOW)
    assert.equal(storage.getItem(d.LEGACY_PROJECTS_KEY), legacy.rawProjects)
    assert.equal(storage.getItem(d.LEGACY_VIEW_KEY), legacy.rawView)
  })

  test('legacy restore retains new format while restoring raw legacy values', () => {
    const storage = new MemoryStorage()
    const facade = new d.ControlRoomsStorage(storage)
    facade.load(legacy, NOW)
    storage.data.set(d.LEGACY_PROJECTS_KEY, 'changed')
    assert.equal(facade.restoreLegacyBackup(), true)
    assert.equal(storage.getItem(d.LEGACY_PROJECTS_KEY), legacy.rawProjects)
    assert.ok(storage.getItem(d.CONTROL_ROOMS_KEY))
  })

  test('backup failure prevents any new-format state write', () => {
    const storage = new MemoryStorage()
    storage.failKey = d.CONTROL_ROOMS_MIGRATION_BACKUP_KEY
    assert.throws(() => new d.ControlRoomsStorage(storage).load(legacy, NOW), /write failed/)
    assert.equal(storage.getItem(d.CONTROL_ROOMS_KEY), null)
    assert.equal(storage.getItem(d.CONTROL_ROOMS_TRASH_KEY), null)
  })

  test('interrupted migration retains the original one-time raw backup', () => {
    const storage = new MemoryStorage()
    storage.failKey = d.CONTROL_ROOMS_KEY
    assert.throws(() => new d.ControlRoomsStorage(storage).load(legacy, NOW), /write failed/)
    const originalBackup = storage.getItem(d.CONTROL_ROOMS_MIGRATION_BACKUP_KEY)
    assert.ok(originalBackup)

    storage.failKey = null
    const changedLegacy = {
      ...legacy,
      projectIds: ['replacement'],
      rawProjects: '{"replacement":true}',
      rawView: '{"consoleTheme":"light"}',
    }
    const writesBeforeRetry = storage.writes.length
    const result = new d.ControlRoomsStorage(storage).load(changedLegacy, NOW + 1)
    assert.equal(result.migrated, true)
    assert.equal(storage.getItem(d.CONTROL_ROOMS_MIGRATION_BACKUP_KEY), originalBackup)
    assert.equal(storage.writes.slice(writesBeforeRetry).includes(d.CONTROL_ROOMS_MIGRATION_BACKUP_KEY), false)
    assert.equal(JSON.parse(originalBackup).rawProjects, legacy.rawProjects)
  })

  test('unknown interrupted-backup version is refused before migration writes', () => {
    const unknownBackup = '{"version":2,"rawProjects":"original"}'
    const storage = new MemoryStorage({ [d.CONTROL_ROOMS_MIGRATION_BACKUP_KEY]: unknownBackup })
    assert.throws(() => new d.ControlRoomsStorage(storage).load(legacy, NOW), d.UnknownControlRoomsVersionError)
    assert.deepEqual(storage.writes, [])
    assert.equal(storage.getItem(d.CONTROL_ROOMS_MIGRATION_BACKUP_KEY), unknownBackup)
    assert.equal(storage.getItem(d.CONTROL_ROOMS_TRASH_KEY), null)
    assert.equal(storage.getItem(d.CONTROL_ROOMS_KEY), null)
  })

  test('existing versioned state makes migration one-time', () => {
    const existing = create(empty(), 'existing')
    const storage = new MemoryStorage({ [d.CONTROL_ROOMS_KEY]: JSON.stringify(existing) })
    const result = new d.ControlRoomsStorage(storage).load(legacy, NOW)
    assert.equal(result.migrated, false)
    assert.ok(result.state.rooms.existing)
    assert.equal(storage.getItem(d.CONTROL_ROOMS_MIGRATION_BACKUP_KEY), null)
  })

  test('unknown main and trash versions are refused', () => {
    const badMain = new MemoryStorage({ [d.CONTROL_ROOMS_KEY]: '{"version":2,"order":[],"activeId":null,"rooms":{}}' })
    assert.throws(() => new d.ControlRoomsStorage(badMain).load(), d.UnknownControlRoomsVersionError)
    const good = JSON.stringify(empty())
    const badTrash = new MemoryStorage({ [d.CONTROL_ROOMS_KEY]: good, [d.CONTROL_ROOMS_TRASH_KEY]: '{"version":9}' })
    assert.throws(() => new d.ControlRoomsStorage(badTrash).load(), d.UnknownControlRoomsVersionError)
  })

  test('write failure preserves latest valid in-memory state', () => {
    const storage = new MemoryStorage()
    const facade = new d.ControlRoomsStorage(storage)
    facade.load()
    const desired = create(empty(), 'memory-only')
    storage.failKey = d.CONTROL_ROOMS_KEY
    const result = facade.save(desired, emptyTrash())
    assert.equal(result.ok, false)
    assert.ok(facade.getLastGood().state.rooms['memory-only'])
  })

  test('export/import remaps collisions without project master data', () => {
    const source = create(empty(), 'same', NOW, { projectIds: ['shared'] })
    const current = create(create(empty(), 'same'), 'same-2')
    const result = d.importControlRooms(current, d.exportControlRooms(source, NOW), NOW + 1)
    assert.equal(result.idMap.same, 'same-3')
    assert.deepEqual(result.state.rooms['same-3'].projectIds, ['shared'])
    assert.equal(result.state.rooms['same-3'].layoutId, 'wt-console:same-3')
    assert.equal(Object.prototype.hasOwnProperty.call(result.state.rooms['same-3'], 'projectData'), false)
  })

  test('unknown import version is refused', () => {
    const payload = JSON.parse(d.exportControlRooms(empty(), NOW))
    payload.version = 2
    assert.throws(() => d.importControlRooms(empty(), JSON.stringify(payload), NOW), d.UnknownControlRoomsVersionError)
  })

  process.stdout.write(`control-rooms-domain: PASS (${cases} cases)\n`)
}

main()
  .catch((error) => {
    process.stderr.write(`${error && error.stack ? error.stack : error}\n`)
    process.exitCode = 1
  })
  .finally(() => fs.rmSync(tempDir, { recursive: true, force: true }))
