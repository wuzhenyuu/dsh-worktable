/* Portable assertions for room-local opening, membership, binding, and persistence. */
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { build } = require('../01_content/node_modules/esbuild')

const repo = path.resolve(__dirname, '..')
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-control-room-runtime-'))
const bundle = path.join(tempDir, 'runtime.cjs')

class MemoryStorage {
  constructor() { this.data = new Map() }
  getItem(key) { return this.data.has(key) ? this.data.get(key) : null }
  setItem(key, value) { this.data.set(key, String(value)) }
}

const labels = (key) => ({
  title: 'Control room',
  pane: 'Control room',
  files: 'Files',
  terminal: 'Terminal',
}[key] ?? key)

async function main() {
  await build({
    entryPoints: [path.join(repo, '01_content/src/client/controlRoomRuntime.ts')],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: ['node22'],
    logLevel: 'silent',
  })
  const runtime = require(bundle)
  const domainBundle = path.join(tempDir, 'domain.cjs')
  await build({
    entryPoints: [path.join(repo, '01_content/src/client/controlRooms.ts')],
    outfile: domainBundle,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: ['node22'],
    logLevel: 'silent',
  })
  const domain = require(domainBundle)

  let state = domain.createEmptyControlRoomsState()
  const views = {}
  const knownSessions = new Set()
  const themes = ['dark', 'light', 'system', 'dark', 'light']
  const sizes = ['compact', 'comfortable', 'wide', 'compact', 'wide']
  for (let index = 0; index < 5; index += 1) {
    const id = `room-${index + 1}`
    const sid = `session-${index + 1}`
    knownSessions.add(sid)
    state = domain.createControlRoom(state, {
      name: `Room ${index + 1}`,
      projectIds: [`p${index}-a`, `p${index}-b`],
      projectOrder: [`p${index}-b`, `p${index}-a`],
      boundSessionId: sid,
      themeMode: themes[index],
      cardLayout: { columns: index % 4 + 1, cardSize: sizes[index] },
      defaultPane: index === 1 ? 'files' : index === 2 ? 'terminal' : index === 3 ? 'conversation' : 'console',
      sidebarVisible: index !== 4,
    }, { id, now: 1_000 + index })
    const layoutId = `wt-console:${id}`
    views[layoutId] = {
      id: layoutId,
      title: `Saved ${id}`,
      icon: '🧭',
      top: null,
      main: [{
        id: `pane-${index}`,
        title: `Pane ${index}`,
        min: 240,
        tabs: [{ id: `console-${index}`, title: 'Control room', content: { kind: 'builtin', type: 'console' } }],
        active: 0,
      }],
      chatWidth: { default: 300 + index, min: 280, max: 600 },
      chatSide: index % 2 ? 'left' : 'right',
    }
  }

  for (let index = 0; index < 5; index += 1) {
    const id = `room-${index + 1}`
    const opened = runtime.prepareControlRoomOpen(state, id, views, knownSessions, 2_000 + index, labels)
    assert.equal(opened.room.layoutId, `wt-console:${id}`, 'room identity is the exact namespaced layout ID')
    assert.equal(opened.spec, views[`wt-console:${id}`], 'the exact room-local saved spec is selected without replacement')
    assert.equal(opened.spec.main[0].id, `pane-${index}`, 'saved pane mutations remain independent by room')
    assert.equal(opened.boundSessionId, `session-${index + 1}`, 'each room opens only its own management session')
    assert.equal(opened.bindingState, 'valid')
    assert.equal(opened.room.themeMode, themes[index])
    assert.deepEqual(opened.room.cardLayout, { columns: index % 4 + 1, cardSize: sizes[index] })
    assert.equal(opened.state.activeId, id)
    assert.equal(opened.state.rooms[id].lastOpenedAt, 2_000 + index)
    state = opened.state
  }

  const membershipRoom = {
    ...state.rooms['room-1'],
    projectIds: ['manual-a', 'excluded', 'manual-b'],
    fixedProjectIds: ['fixed', 'manual-a'],
    excludedProjectIds: ['excluded'],
    projectOrder: ['fixed', 'manual-b', 'excluded', 'manual-a'],
  }
  assert.deepEqual(
    runtime.effectiveControlRoomProjectIds(membershipRoom, ['manual-a', 'manual-b', 'excluded', 'fixed', 'unknown']),
    ['fixed', 'manual-b', 'manual-a'],
    'manual and fixed membership obey room order while exclusions win',
  )

  const beforeRoom2 = state.rooms['room-2'].projectOrder
  state = domain.reorderProjectsInRoom(state, 'room-1', ['p0-a', 'p0-b'], 3_000)
  assert.deepEqual(state.rooms['room-1'].projectOrder, ['p0-a', 'p0-b'], 'reorder updates the active room order')
  assert.deepEqual(state.rooms['room-2'].projectOrder, beforeRoom2, 'reorder never mutates another room')

  const sharedBinding = domain.updateControlRoom(state, 'room-2', { boundSessionId: 'session-1' }, 3_050)
  assert.equal(sharedBinding.rooms['room-1'].boundSessionId, 'session-1')
  assert.equal(sharedBinding.rooms['room-2'].boundSessionId, 'session-1', 'one session may manage multiple rooms')
  assert.equal(knownSessions.size, 5, 'rebinding only changes references and never deletes a session')

  const missing = domain.updateControlRoom(sharedBinding, 'room-5', { boundSessionId: 'missing-session' }, 3_100)
  const missingOpen = runtime.prepareControlRoomOpen(missing, 'room-5', views, knownSessions, 3_101, labels)
  assert.equal(missingOpen.bindingState, 'missing', 'a missing management session is surfaced as invalid')
  assert.equal(missingOpen.boundSessionId, 'missing-session', 'invalid binding remains recoverable instead of being cleared')
  assert.equal(missingOpen.state.rooms['room-5'].boundSessionId, 'missing-session')

  const emptyBinding = domain.updateControlRoom(missingOpen.state, 'room-5', { boundSessionId: null }, 3_102)
  assert.equal(runtime.controlRoomBindingState(emptyBinding.rooms['room-5'], knownSessions), 'unbound')
  assert.equal(emptyBinding.rooms['room-5'].boundSessionId, null, 'clearing the room reference does not touch session data')
  assert.equal(knownSessions.has('session-5'), true, 'clearing/rebinding never deletes a session')

  const noSaved = domain.createControlRoom(emptyBinding, {
    name: 'Defaults',
    defaultPane: 'files',
  }, { id: 'room-default-pane', now: 3_200 })
  const defaultOpen = runtime.prepareControlRoomOpen(noSaved, 'room-default-pane', views, knownSessions, 3_201, labels)
  assert.equal(defaultOpen.spec.id, 'wt-console:room-default-pane')
  assert.equal(defaultOpen.spec.main[0].tabs[0].content.type, 'console', 'the locked console tab always remains present')
  assert.equal(defaultOpen.spec.main[0].tabs[1].content.type, 'explorer', 'room default pane seeds the room-local spec')
  assert.equal(defaultOpen.spec.main[0].active, 1)

  const storage = new MemoryStorage()
  const repository = new domain.ControlRoomsStorage(storage)
  assert.equal(repository.save(defaultOpen.state, domain.createEmptyControlRoomsTrashState()).ok, true)
  const reload = new domain.ControlRoomsStorage(storage).load(undefined, 4_000).state
  for (let index = 0; index < 5; index += 1) {
    const id = `room-${index + 1}`
    assert.equal(reload.rooms[id].layoutId, `wt-console:${id}`)
    assert.equal(reload.rooms[id].themeMode, themes[index])
    assert.deepEqual(reload.rooms[id].cardLayout, { columns: index % 4 + 1, cardSize: sizes[index] })
  }
  assert.equal(reload.rooms['room-5'].boundSessionId, null, 'repository reload keeps the latest room-local binding')

  const deleted = domain.deleteControlRoom(reload, domain.createEmptyControlRoomsTrashState(), 'room-3', 4_100)
  assert.ok(views['wt-console:room-3'], 'room deletion leaves its saved layout data available for restore')
  const restored = domain.restoreControlRoom(deleted.state, deleted.trash, 'room-3', 4_101)
  const restoredOpen = runtime.prepareControlRoomOpen(restored.state, 'room-3', views, knownSessions, 4_102, labels)
  assert.equal(restoredOpen.spec, views['wt-console:room-3'], 'restored room selects its original saved pane mutations')

  const occupied = domain.createControlRoom(deleted.state, { name: 'Replacement room 3' }, { id: 'room-3', now: 4_103 })
  const collisionRestore = domain.restoreControlRoom(occupied, deleted.trash, 'room-3', 4_104)
  assert.equal(collisionRestore.restoredId, 'room-3-2')
  const collisionViews = runtime.copyControlRoomLayoutView(views, 'wt-console:room-3', 'wt-console:room-3-2')
  assert.equal(collisionViews['wt-console:room-3-2'].id, 'wt-console:room-3-2')
  assert.equal(collisionViews['wt-console:room-3-2'].main[0].id, 'pane-2', 'collision restore clones the original saved layout under the remapped ID')
  const collisionGeometry = runtime.copyControlRoomSplitGeometry({
    'wt-console:room-3': { chatW: 417, topH: 233, leftW: 261, paneWs: [509], topWs: [], leftWs: [] },
    'unrelated-project': { chatW: 305, topH: 180, leftW: 200, paneWs: [333], topWs: [], leftWs: [] },
  }, 'wt-console:room-3', 'wt-console:room-3-2')
  assert.deepEqual(collisionGeometry['wt-console:room-3-2'], {
    chatW: 417, topH: 233, leftW: 261, paneWs: [509], topWs: [], leftWs: [],
  }, 'collision restore clones split widths and heights to the remapped layout ID')
  assert.deepEqual(collisionGeometry['unrelated-project'], {
    chatW: 305, topH: 180, leftW: 200, paneWs: [333], topWs: [], leftWs: [],
  }, 'geometry cloning does not overwrite unrelated layout records')
  const geometryStorage = new MemoryStorage()
  geometryStorage.setItem('dsh.worktable.split.v2', JSON.stringify({
    'wt-console:room-3': { chatW: 417, topH: 233, leftW: 261, paneWs: [509], topWs: [], leftWs: [] },
    'unrelated-project': { chatW: 305, topH: 180, leftW: 200, paneWs: [333], topWs: [], leftWs: [] },
  }))
  assert.equal(runtime.copyControlRoomSplitGeometryInStorage(
    geometryStorage,
    'dsh.worktable.split.v2',
    'wt-console:room-3',
    'wt-console:room-3-2',
  ), true)
  const persistedGeometry = JSON.parse(geometryStorage.getItem('dsh.worktable.split.v2'))
  assert.equal(persistedGeometry['wt-console:room-3-2'].chatW, 417, 'cloned geometry survives storage reload')
  assert.equal(persistedGeometry['unrelated-project'].paneWs[0], 333)

  let ackLifecycle = runtime.reconcileNeedAckTransitions({}, { 'room-only-session': true })
  assert.deepEqual(ackLifecycle.clearSessionIds, [], 'the first observed need does not clear an ack')
  ackLifecycle = runtime.reconcileNeedAckTransitions(ackLifecycle.seen, { 'room-only-session': false })
  assert.deepEqual(ackLifecycle.clearSessionIds, ['room-only-session'], 'need resolution clears the stale ack')
  ackLifecycle = runtime.reconcileNeedAckTransitions(ackLifecycle.seen, { 'room-only-session': true })
  assert.deepEqual(ackLifecycle.clearSessionIds, ['room-only-session'], 'a new need transition clears the prior lifecycle ack so glow can relight')

  let autoBindState = domain.createControlRoom(domain.createEmptyControlRoomsState(), {
    name: 'Auto bind room',
  }, { id: 'auto-bind-room', now: 5_000 })
  const preservedSessions = new Set(['fresh-session', 'later-session'])
  let autoBind = runtime.autoBindControlRoomSession(
    autoBindState,
    'wt-console:auto-bind-room',
    'fresh-session',
    5_001,
  )
  assert.equal(autoBind.result, 'auto', 'an unbound active control room auto-binds the newly sent session')
  assert.equal(autoBind.state.rooms['auto-bind-room'].boundSessionId, 'fresh-session')
  autoBindState = autoBind.state
  autoBind = runtime.autoBindControlRoomSession(
    autoBindState,
    'wt-console:auto-bind-room',
    'later-session',
    5_002,
  )
  assert.equal(autoBind.result, 'kept', 'an existing room management binding is retained')
  assert.equal(autoBind.state.rooms['auto-bind-room'].boundSessionId, 'fresh-session')
  assert.equal(runtime.autoBindControlRoomSession(autoBindState, 'ordinary-project', 'later-session', 5_003).result, 'none')
  assert.deepEqual([...preservedSessions], ['fresh-session', 'later-session'], 'auto-binding only changes room references and never deletes sessions')

  let deleteState = domain.createControlRoom(domain.createEmptyControlRoomsState(), { name: 'Delete me' }, { id: 'delete-me', now: 6_000 })
  deleteState = domain.createControlRoom(deleteState, { name: 'Replacement' }, { id: 'replacement', now: 6_001 })
  deleteState = domain.selectControlRoom(deleteState, 'delete-me', 6_002)
  let deletePlan = runtime.deleteControlRoomAndPlanNextOpen(
    deleteState,
    domain.createEmptyControlRoomsTrashState(),
    'delete-me',
    'wt-console:delete-me',
    6_003,
  )
  assert.equal(deletePlan.closeOpenLayout, true, 'deleting the room whose layout is open closes that exact layout')
  assert.equal(deletePlan.openRoomId, 'replacement', 'the replacement active room must be reopened through the room-open seam')
  assert.equal(deletePlan.state.activeId, 'replacement')
  assert.equal(deletePlan.state.rooms['delete-me'], undefined, 'deleted-room cards and theme cannot remain the current room')
  deletePlan = runtime.deleteControlRoomAndPlanNextOpen(
    deletePlan.state,
    deletePlan.trash,
    'replacement',
    'wt-console:replacement',
    6_004,
  )
  assert.equal(deletePlan.closeOpenLayout, true)
  assert.equal(deletePlan.openRoomId, null, 'deleting the final room leaves the empty create state')
  assert.equal(deletePlan.state.activeId, null)

  process.stdout.write('control-room-runtime: PASS (five independent rooms and sessions)\n')
}

main()
  .catch((error) => {
    process.stderr.write(`${error && error.stack ? error.stack : error}\n`)
    process.exitCode = 1
  })
  .finally(() => fs.rmSync(tempDir, { recursive: true, force: true }))
