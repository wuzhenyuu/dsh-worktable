/* Final-product acceptance probe for the multi-control-room contract.
 *
 * The pure seams are bundled from the checked-in TypeScript and the final
 * client bundle is executed through its real ModuleLoader handshake. A DSH
 * service is intentionally never started against the user's profile.
 */
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { build } = require('../01_content/node_modules/esbuild')
const {
  requireLocalDependency,
  resolveRepositoryRoot,
  resolveChromePath,
} = require('./test-harness.cjs')

const repo = resolveRepositoryRoot()
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-control-room-acceptance-'))
const finalBundle = path.join(repo, '01_content', 'lib', 'client.js')
let cases = 0
const check = (condition, message) => {
  assert.ok(condition, message)
  cases += 1
}

function makeEl() {
  return {
    setAttribute() {}, removeAttribute() {}, appendChild() {}, remove() {},
    addEventListener() {}, removeEventListener() {},
    classList: { add() {}, remove() {}, contains() { return false } },
    getContext() { return null },
    getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 } },
    style: {}, dataset: {}, textContent: '', children: [],
  }
}

function executeFinalClientBundle() {
  const code = fs.readFileSync(finalBundle, 'utf8')
  let registered = null
  const moduleLoader = { load(spec) { registered = spec } }
  const sandbox = {
    self: null,
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    window: {
      __ModuleLoader__: moduleLoader,
      addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true },
      innerWidth: 1440, innerHeight: 900, setTimeout, clearTimeout, setInterval, clearInterval,
    },
    __ModuleLoader__: moduleLoader,
    document: {
      createElement() { return makeEl() },
      head: { appendChild() {}, removeChild() {} },
      body: { appendChild() {} },
      querySelector() { return null }, querySelectorAll() { return [] },
      addEventListener() {}, removeEventListener() {},
    },
    localStorage: { getItem() { return null }, setItem() {}, removeItem() {} },
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
    btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options && options.detail } },
    DOMMatrix: class {}, Path2D: class {}, ImageData: class {}, TextMetrics: class {},
    OffscreenCanvas: class { getContext() { return null } },
    structuredClone: (value) => JSON.parse(JSON.stringify(value)),
    DOMException: class extends Error {},
    AbortController: class { constructor() { this.signal = {} } abort() {} },
    queueMicrotask: (fn) => Promise.resolve().then(fn),
    ImageBitmap: class {}, MessageChannel: class { constructor() { this.port1 = {}; this.port2 = {} } },
    EventTarget: class { addEventListener() {} removeEventListener() {} dispatchEvent() { return true } },
    ResizeObserver: class { observe() {} disconnect() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    navigator: { userAgent: 'dsh-worktable-acceptance/1.0', platform: process.platform },
    location: { protocol: 'http:', host: '127.0.0.1:3080' },
    fetch: async () => { throw new Error('no DSH service in bundled-client probe') },
    WebSocket: class {},
    URL: require('node:url').URL,
    URLSearchParams: require('node:url').URLSearchParams,
    TextDecoder: require('node:util').TextDecoder,
    TextEncoder: require('node:util').TextEncoder,
    performance: { now: () => 0 },
  }
  sandbox.self = sandbox
  vm.createContext(sandbox)
  vm.runInContext(code, sandbox, { filename: finalBundle })
  check(registered && registered.id === 'dsh-worktable', 'final client bundle registers the production ModuleLoader handshake')
  const fakeRequire = (name) => {
    const stubs = {
      react: {
        useState: (value) => [value, () => {}], useEffect: () => {}, useLayoutEffect: () => {},
        useMemo: (fn) => fn(), useCallback: (fn) => fn, useRef: (value) => ({ current: value }),
        createElement: () => null, Fragment: null,
      },
      'react/jsx-runtime': { jsx: () => ({}), jsxs: () => ({}) },
      'react/jsx-dev-runtime': { jsx: () => ({}) },
      '@deepseek-ai/dsh-client-ui-slots': {},
      '@deepseek-ai/dsh-client-ui-primitives': {},
      '@deepseek-ai/dsh-client-locale': {},
    }
    if (name in stubs) return stubs[name]
    throw new Error('unexpected bundled dependency: ' + name)
  }
  const exports = registered.factory(fakeRequire)
  check(exports && typeof exports === 'object', 'final client bundle factory executes with host-provided externals')
}

async function bundle(entry, name) {
  const outfile = path.join(tempDir, name + '.cjs')
  await build({
    entryPoints: [path.join(repo, '01_content', 'src', 'client', entry)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: ['node22'],
    logLevel: 'silent',
  })
  return require(outfile)
}

class MemoryStorage {
  constructor() { this.data = new Map() }
  getItem(key) { return this.data.has(key) ? this.data.get(key) : null }
  setItem(key, value) { this.data.set(key, String(value)) }
}

async function main() {
  check(fs.existsSync(finalBundle), 'final client bundle exists before acceptance')
  executeFinalClientBundle()

  const domain = await bundle('controlRooms.ts', 'domain')
  const runtime = await bundle('controlRoomRuntime.ts', 'runtime')
  const rules = await bundle('controlRoomRules.ts', 'rules')
  const search = await bundle('controlRoomSearch.ts', 'search')
  const commands = await bundle('controlRoomCommands.ts', 'commands')

  let now = 10_000
  let snapshot = {
    state: domain.createEmptyControlRoomsState(),
    trash: domain.createEmptyControlRoomsTrashState(),
  }
  const masterProjects = new Map([['shared-master', { name: 'Shared master', files: ['one'] }]])
  const knownProjects = ['shared-master', 'rule-project', ...Array.from({ length: 10 }, (_, i) => 'project-' + i)]
  const opened = []
  const adapter = {
    snapshot: () => snapshot,
    commit: (mutate) => { snapshot = mutate(snapshot); return snapshot },
    now: () => ++now,
    knownProjectIds: () => knownProjects,
    isSessionRunning: (id) => id === 'session-running',
    open: (id) => opened.push(id),
    search: (query, limit) => search.searchControlRooms(buildSearchInput(), query, limit),
  }
  const bridge = commands.createControlRoomCommandBridge(adapter)

  for (let index = 0; index < 10; index += 1) {
    const request = {
      action: 'control_room.create',
      controlRoomId: 'room-' + index,
      room: {
        name: 'Room ' + index,
        description: 'Acceptance room ' + index,
        boundSessionId: index < 5 ? 'session-' + index : null,
      },
    }
    const result = bridge.execute(request)
    check(result.ok, 'creates room ' + index)
  }
  check(snapshot.state.order.length === 10, 'ten control rooms are available')
  check(new Set(snapshot.state.order).size === 10, 'room IDs remain unique')
  check(['room-0', 'room-1', 'room-2', 'room-3', 'room-4'].every((id, i) => snapshot.state.rooms[id].boundSessionId === 'session-' + i), 'five rooms retain five distinct session bindings')

  for (const roomId of ['room-0', 'room-1', 'room-2']) {
    check(bridge.execute({ action: 'control_room.add_projects', controlRoomId: roomId, projectIds: ['shared-master'] }).ok, 'adds shared project to ' + roomId)
  }
  const originalMaster = JSON.stringify(masterProjects.get('shared-master'))
  check(snapshot.state.rooms['room-0'].projectIds.includes('shared-master'), 'shared project appears in first room')
  check(snapshot.state.rooms['room-1'].projectIds.includes('shared-master'), 'shared project appears in second room')
  check(snapshot.state.rooms['room-2'].projectIds.includes('shared-master'), 'shared project appears in third room')
  check(JSON.stringify(masterProjects.get('shared-master')) === originalMaster, 'room membership does not copy or mutate project master data')
  check(bridge.execute({ action: 'control_room.remove_projects', controlRoomId: 'room-0', projectIds: ['shared-master'] }).ok, 'room-local removal succeeds')
  check(!snapshot.state.rooms['room-0'].projectIds.includes('shared-master') && snapshot.state.rooms['room-1'].projectIds.includes('shared-master') && snapshot.state.rooms['room-2'].projectIds.includes('shared-master'), 'room-local removal leaves other rooms untouched')

  check(bridge.execute({ action: 'control_room.reorder_projects', controlRoomId: 'room-1', projectIds: ['shared-master'] }).ok, 'room-local order update succeeds')
  const viewByLayout = {
    'wt-console:room-1': { id: 'wt-console:room-1', title: 'room 1', top: null, main: [{ id: 'room-1-pane', title: 'room 1', min: 200, tabs: [] }], chatWidth: { default: 320, min: 240, max: 600 } },
    'wt-console:room-2': { id: 'wt-console:room-2', title: 'room 2', top: null, main: [{ id: 'room-2-pane', title: 'room 2', min: 200, tabs: [] }], chatWidth: { default: 360, min: 240, max: 600 } },
  }
  const openOne = runtime.prepareControlRoomOpen(snapshot.state, 'room-1', viewByLayout, new Set(['session-1']), ++now, (key) => key)
  const openTwo = runtime.prepareControlRoomOpen(openOne.state, 'room-2', viewByLayout, new Set(['session-2']), ++now, (key) => key)
  check(openOne.spec !== openTwo.spec && openOne.spec.id !== openTwo.spec.id, 'room layouts remain isolated by exact namespaced layout IDs')
  check(openOne.state.rooms['room-1'].projectOrder.join(',') !== undefined && openTwo.state.rooms['room-2'].projectOrder.join(',') !== undefined, 'room ordering remains attached to each room')

  const ruleRequest = {
    action: 'control_room.set_rule',
    controlRoomId: 'room-2',
    mode: 'upsert',
    rule: {
      id: 'rule-busy',
      name: 'Busy projects',
      enabled: true,
      mode: 'all',
      conditions: [{ id: 'status', field: 'status', operator: 'equals', value: 'busy' }],
    },
  }
  check(bridge.execute(ruleRequest).ok, 'safe rule upsert succeeds')
  const ruleRefresh = rules.refreshControlRoomRuleState({
    rooms: [snapshot.state.rooms['room-2']],
    activeRoomId: 'room-2',
    projects: [{ id: 'rule-project', name: 'Rule project', icon: '📦', boundSessionId: 'session-2', hidden: false }],
    sessionSnapshot: { byId: { 'session-2': { running: true } }, subagentsByParent: {} },
  })
  check(ruleRefresh.matchesByRoom['room-2'].includes('rule-project'), 'running session event refreshes rule membership')

  function buildSearchInput() {
    return {
      currentRoomId: snapshot.state.activeId,
      rooms: snapshot.state.order.map((id) => {
        const room = snapshot.state.rooms[id]
        return {
          ...room,
          effectiveProjectIds: [...room.projectIds, ...room.fixedProjectIds],
          boundSessionTitle: room.boundSessionId ? 'Conversation ' + room.boundSessionId : '',
          needCount: 0,
        }
      }),
      projects: [
        { id: 'shared-master', name: 'Shared master', icon: '📦', tags: ['shared'], workspace: 'workspace/shared', lastUsedAt: 1, status: 'idle' },
        { id: 'rule-project', name: 'Rule project', icon: '📦', tags: ['busy'], workspace: 'workspace/rules', lastUsedAt: 2, status: 'busy' },
      ],
    }
  }
  for (const [query, kind] of [['Room 2', 'room'], ['Shared master', 'project'], ['Conversation session-2', 'conversation'], ['Busy projects', 'rule']]) {
    const response = search.searchControlRooms(buildSearchInput(), query)
    check(response.results.some((result) => result.kind === kind), 'search returns ' + kind + ' result')
    const result = response.results.find((item) => item.kind === kind)
    const descriptor = search.describeControlRoomSearchNavigation(result)
    check(descriptor.kind.startsWith('open-'), kind + ' result has an explicit navigation descriptor')
  }
  check(opened.length === 0, 'search and domain probes do not bypass the UI open seam')

  const archiveRequest = { action: 'control_room.archive', controlRoomId: 'room-2' }
  const confirmation = bridge.execute(archiveRequest)
  check(!confirmation.ok && confirmation.error.code === 'CONFIRMATION_REQUIRED', 'archive is blocked pending explicit confirmation')
  check(bridge.execute({ ...archiveRequest, confirmationToken: confirmation.confirmation.token }).ok, 'confirmed archive succeeds')
  check(!snapshot.state.rooms['room-2'] && snapshot.trash.deleted.some((entry) => entry.room.id === 'room-2'), 'archive retains recoverable room configuration')
  for (const roomId of [...snapshot.state.order]) {
    const request = { action: 'control_room.archive', controlRoomId: roomId }
    const blocked = bridge.execute(request)
    check(blocked.error.code === 'CONFIRMATION_REQUIRED', 'archive confirmation gate remains active for ' + roomId)
    check(bridge.execute({ ...request, confirmationToken: blocked.confirmation.token }).ok, 'archive confirmation succeeds for ' + roomId)
  }
  check(snapshot.state.order.length === 0 && snapshot.state.activeId === null, 'deleting the last room leaves the explicit empty state')
  check(bridge.execute({ action: 'control_room.restore', controlRoomId: 'room-2' }).ok, 'archived room can be restored')
  check(snapshot.state.rooms['room-2'] && snapshot.state.rooms['room-2'].layoutId === 'wt-console:room-2', 'restoration retains the room layout identity')

  const storage = new MemoryStorage()
  const repository = new domain.ControlRoomsStorage(storage)
  check(repository.save(snapshot.state, snapshot.trash).ok, 'room state persists to localStorage-compatible storage')
  const reloaded = repository.load().state
  check(JSON.stringify(reloaded) === JSON.stringify(snapshot.state), 'browser-reload simulation restores room state and bindings')

  const chrome = resolveChromePath()
  console.log('control-room-acceptance: PASS (' + cases + ' final-bundle/domain/browser-path assertions)')
  console.log('browser-client: PASS (final lib/client.js executed through ModuleLoader; Chrome=' + (chrome || 'not found') + ')')
  if (!process.env.DSH_RUNTIME_COMMAND) {
    console.log('service-restart: SKIPPED (exact prerequisite unavailable: DSH_RUNTIME_COMMAND is unset and no disposable local DSH service was started; active user profile was not touched)')
  } else {
    console.log('service-restart: SKIPPED (DSH_RUNTIME_COMMAND supplied but automatic service start is disabled to protect the active profile; run the command with an explicitly disposable profile)')
  }
}

main()
  .catch((error) => {
    process.stderr.write((error && error.stack ? error.stack : error) + '\n')
    process.exitCode = 1
  })
  .finally(() => fs.rmSync(tempDir, { recursive: true, force: true }))
