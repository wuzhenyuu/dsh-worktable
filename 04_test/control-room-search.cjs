/* Portable Task 5 assertions for global search ranking, deduplication, caps, and navigation. */
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { build } = require('../01_content/node_modules/esbuild')

const repo = path.resolve(__dirname, '..')
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-control-room-search-'))
const bundle = path.join(tempDir, 'control-room-search.cjs')

const condition = (field, operator, value) => ({ id: `${field}-${operator}`, field, operator, value })
const rule = (id, name, conditions) => ({ id, name, enabled: true, mode: 'all', conditions })
const room = (id, patch = {}) => ({
  id,
  name: id,
  icon: '🖥️',
  description: '',
  effectiveProjectIds: [],
  boundSessionId: null,
  boundSessionTitle: '',
  rules: [],
  lastOpenedAt: 0,
  needCount: 0,
  ...patch,
})
const project = (id, patch = {}) => ({
  id,
  name: id,
  icon: '📦',
  tags: [],
  workspace: '',
  lastUsedAt: 0,
  status: 'idle',
  ...patch,
})

async function main() {
  await build({
    entryPoints: [path.join(repo, '01_content/src/client/controlRoomSearch.ts')],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: ['node22'],
    logLevel: 'silent',
  })
  const search = require(bundle)

  let response = search.searchControlRooms({
    currentRoomId: 'creative',
    rooms: [room('creative', { name: '创意 🎨 控制室', description: '视觉制作' })],
    projects: [],
  }, '🎨')
  assert.equal(response.results[0].title, '创意 🎨 控制室', 'Chinese and emoji text remains searchable')

  response = search.searchControlRooms({
    currentRoomId: null,
    rooms: [room('r1', { effectiveProjectIds: ['p1'] })],
    projects: [project('p1', { name: 'Release 2026', tags: ['API-V2'], workspace: 'F:/Codex/Alpha42' })],
  }, 'api-v2 ALPHA42')
  assert.equal(response.results[0].targetId, 'p1', 'English is case-insensitive and digits are retained')

  response = search.searchControlRooms({
    currentRoomId: 'current',
    rooms: [
      room('current', { name: 'Current room', description: 'alpha', lastOpenedAt: 99 }),
      room('other', { name: 'Alpha', lastOpenedAt: 1 }),
    ],
    projects: [],
  }, 'alpha')
  assert.equal(response.results[0].roomId, 'other', 'text relevance is stronger than current-room preference')

  response = search.searchControlRooms({
    currentRoomId: 'current',
    rooms: [
      room('current', { name: 'Equal', lastOpenedAt: 1 }),
      room('recent', { name: 'Equal', lastOpenedAt: 100, needCount: 1 }),
    ],
    projects: [],
  }, 'equal')
  assert.equal(response.results[0].roomId, 'current', 'the current room wins an equal text score before recency and need')

  response = search.searchControlRooms({
    currentRoomId: null,
    rooms: [
      room('older', { name: 'Equal', lastOpenedAt: 1 }),
      room('newer', { name: 'Equal', lastOpenedAt: 10 }),
    ],
    projects: [],
  }, 'equal')
  assert.equal(response.results[0].roomId, 'newer', 'recent use breaks a text/current-room tie')

  response = search.searchControlRooms({
    currentRoomId: null,
    rooms: [
      room('idle', { name: 'Need tie', lastOpenedAt: 10 }),
      room('need', { name: 'Need tie', lastOpenedAt: 10, needCount: 1 }),
    ],
    projects: [],
  }, 'need tie')
  assert.equal(response.results[0].roomId, 'need', 'need state breaks a text/current/recency tie')

  response = search.searchControlRooms({
    currentRoomId: 'two',
    rooms: [
      room('one', { effectiveProjectIds: ['shared'], lastOpenedAt: 20 }),
      room('two', { effectiveProjectIds: ['shared'], lastOpenedAt: 10 }),
    ],
    projects: [project('shared', { name: 'Shared project' })],
  }, 'shared')
  assert.equal(response.results.length, 1, 'a project in multiple rooms is a single semantic result')
  assert.deepEqual(response.results[0].roomIds, ['one', 'two'])
  assert.equal(response.results[0].roomId, 'two', 'the descriptor picks the current concrete owning room')

  response = search.searchControlRooms({
    currentRoomId: 'one',
    rooms: [room('one', { effectiveProjectIds: ['shared'] })],
    projects: [project('shared', { name: 'Duplicate input' }), project('shared', { name: 'Duplicate input' })],
  }, 'duplicate')
  assert.equal(response.results.length, 1, 'duplicate source rows cannot duplicate a semantic project result')

  response = search.searchControlRooms({
    currentRoomId: 'two',
    rooms: [
      room('one', { boundSessionId: 's1', boundSessionTitle: 'Deploy 42', lastOpenedAt: 20 }),
      room('two', { boundSessionId: 's1', boundSessionTitle: 'Deploy 42', lastOpenedAt: 10 }),
    ],
    projects: [],
  }, 'deploy 42')
  assert.equal(response.results.length, 1, 'one bound session referenced by multiple rooms is deduplicated')
  assert.deepEqual(response.results[0].roomIds, ['one', 'two'])
  assert.deepEqual(search.describeControlRoomSearchNavigation(response.results[0]), {
    kind: 'open-conversation', roomId: 'two', sessionId: 's1',
  })

  response = search.searchControlRooms({
    currentRoomId: 'rules',
    rooms: [room('rules', {
      rules: [rule('urgent-rule', 'Escalation', [condition('tag', 'contains', '紧急'), condition('status', 'equals', 'need')])],
    })],
    projects: [],
  }, '紧急 need')
  assert.equal(response.results[0].kind, 'rule', 'rule condition values and keywords are indexed')
  assert.equal(response.results[0].targetId, 'urgent-rule')

  response = search.searchControlRooms({
    currentRoomId: null,
    rooms: Array.from({ length: 60 }, (_, index) => room(`room-${index}`, { name: `Overflow ${index}` })),
    projects: [],
  }, 'overflow')
  assert.equal(response.results.length, 50, 'results are capped at fifty')
  assert.equal(response.total, 60)
  assert.equal(response.overflow, 10, 'the omitted count is reported')

  const routed = []
  const actions = {
    openControlRoom: (roomId) => routed.push(['room', roomId]),
    openProjectInRoom: (roomId, projectId) => routed.push(['project', roomId, projectId]),
    openRuleEditor: (roomId, ruleId) => routed.push(['rule', roomId, ruleId]),
  }
  const fixtures = [
    { kind: 'room', roomId: 'r', targetId: 'r' },
    { kind: 'project', roomId: 'r', targetId: 'p' },
    { kind: 'conversation', roomId: 'r', targetId: 's' },
    { kind: 'rule', roomId: 'r', targetId: 'q' },
  ]
  const descriptors = fixtures.map(search.describeControlRoomSearchNavigation)
  descriptors.forEach((descriptor) => search.executeControlRoomSearchNavigation(descriptor, actions))
  assert.deepEqual(descriptors, [
    { kind: 'open-room', roomId: 'r' },
    { kind: 'open-project', roomId: 'r', projectId: 'p' },
    { kind: 'open-conversation', roomId: 'r', sessionId: 's' },
    { kind: 'open-rule', roomId: 'r', ruleId: 'q' },
  ], 'all four result kinds produce explicit production navigation descriptors')
  assert.deepEqual(routed, [
    ['room', 'r'],
    ['project', 'r', 'p'],
    ['room', 'r'],
    ['rule', 'r', 'q'],
  ], 'conversation navigation reuses openControlRoom while project and rule use their production locating actions')

  const indexSource = fs.readFileSync(path.join(repo, '01_content/src/client/index.tsx'), 'utf8')
  const splitSource = fs.readFileSync(path.join(repo, '01_content/src/client/split.tsx'), 'utf8')
  assert.match(indexSource, /executeControlRoomSearchNavigation\(describeControlRoomSearchNavigation\(result\)/, 'the overlay executes the tested descriptor seam')
  assert.match(indexSource, /openControlRoom,\s*openProjectInRoom: openProjectFromSearch,\s*openRuleEditor: openRuleFromSearch/s, 'the overlay adapter supplies the three production actions used by all four kinds')
  assert.match(indexSource, /const openProjectFromSearch[\s\S]*openControlRoom\(roomId\)[\s\S]*data-wt-console-project-id/, 'project results open a concrete room then locate its card')
  assert.match(indexSource, /const openRuleFromSearch[\s\S]*openRoomManage\(roomId,[\s\S]*data-wt-room-rule-id/, 'rule results open the guarded room editor then locate the rule')
  assert.match(splitSource, /data-wt-console-project-id=\{c\.id\}/, 'the production ConsolePane exposes the project locating target')
  assert.match(indexSource, /data-wt-room-rule-id=\{rule\.id\}/, 'the production room editor exposes the rule locating target')
  assert.match(indexSource, /Control\+K Control\+Shift\+P/, 'the visible overlay entry advertises both keyboard shortcuts')
  assert.match(indexSource, /installModalFocusGuard\([\s\S]*searchDialogRef\.current[\s\S]*returnFocus: searchReturnFocusRef\.current/, 'the overlay shares the tested focus containment and restoration guard')
  const missing = search.searchControlRooms({
    currentRoomId: 'room-missing',
    rooms: [{
      id: 'room-missing', name: 'Recovered', icon: '🧭', description: '',
      effectiveProjectIds: [], referencedProjectIds: ['deleted-project-id'],
      boundSessionId: null, boundSessionTitle: '', rules: [], lastOpenedAt: 5, needCount: 0,
    }],
    projects: [{
      id: 'deleted-project-id', name: 'deleted-project-id', icon: '⚠️', tags: [], workspace: '',
      lastUsedAt: 0, status: 'idle', missing: true,
    }],
  }, 'deleted-project-id')
  assert.equal(missing.results[0].targetId, 'deleted-project-id', 'search keeps an exact missing project ID visible')
  assert.equal(missing.results[0].missing, true, 'search marks the result as missing instead of inventing project master data')
  assert.match(indexSource, /rooms\.projectMissing[\s\S]*result\.targetId/, 'production search rendering shows the localized missing state and exact ID')
  assert.match(splitSource, /onCleanMissing[\s\S]*rooms\.cleanMissingReference/, 'the production missing card exposes an accessible room-reference cleanup action')

  process.stdout.write('control-room-search: PASS (ranking, Unicode, dedup, cap, focus, and four UI navigation routes)\n')
}

main()
  .catch((error) => {
    process.stderr.write(`${error && error.stack ? error.stack : error}\n`)
    process.exitCode = 1
  })
  .finally(() => fs.rmSync(tempDir, { recursive: true, force: true }))
