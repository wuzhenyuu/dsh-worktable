/* Portable integration assertions for the production project/session rule refresh seam. */
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { build } = require('../01_content/node_modules/esbuild')

const repo = path.resolve(__dirname, '..')
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-control-room-rule-refresh-'))
const bundle = path.join(tempDir, 'control-room-rules.cjs')

const statusCondition = { id: 'status-busy', field: 'status', operator: 'equals', value: 'busy' }
const childCondition = { id: 'child-present', field: 'subagentCount', operator: 'greaterThanOrEqual', value: 1 }
const makeRoom = (conditions = [statusCondition, childCondition]) => ({
  id: 'ops',
  name: 'Ops',
  icon: '🖥️',
  description: '',
  projectIds: [],
  projectOrder: [],
  fixedProjectIds: [],
  excludedProjectIds: [],
  boundSessionId: null,
  rules: [{ id: 'live-rule', name: 'Live work', enabled: true, mode: 'all', conditions }],
  layoutId: 'wt-console:ops',
  themeMode: 'system',
  cardLayout: { columns: 2, cardSize: 'comfortable' },
  filters: { statuses: ['idle', 'busy', 'need', 'done'], showHidden: false, showArchived: false },
  defaultPane: 'console',
  sidebarVisible: true,
  createdAt: 1,
  updatedAt: 1,
  lastOpenedAt: 1,
  deletedAt: null,
})
const project = (patch = {}) => ({
  id: 'alpha',
  name: 'Alpha',
  icon: '🧪',
  boundSessionId: 'session-alpha',
  hidden: false,
  ...patch,
})

async function main() {
  await build({
    entryPoints: [path.join(repo, '01_content/src/client/controlRoomRules.ts')],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: ['node22'],
    logLevel: 'silent',
  })
  const production = require(bundle)
  let notifications = 0
  const notify = () => { notifications += 1 }
  let previous = null
  const refresh = (room, projectInput, sessionSnapshot) => {
    const current = production.refreshControlRoomRuleState({
      rooms: [room],
      activeRoomId: 'ops',
      projects: [projectInput],
      sessionSnapshot,
    })
    previous = production.notifyOpenControlRoomRuleRefresh(previous, current, notify)
    return current
  }

  let current = refresh(makeRoom(), project(), {
    byId: { 'session-alpha': { running: false } },
    subagentsByParent: {},
  })
  assert.equal(notifications, 0, 'first production refresh seeds state without a false open-room notification')
  assert.equal(current.facts[0].status, 'idle')
  assert.equal(current.facts[0].subagentCount, 0)
  assert.deepEqual(current.summariesByRoom.ops, { memberIds: [], needCount: 0 })

  current = refresh(makeRoom(), project(), {
    byId: {
      'session-alpha': { running: true, updatedAt: 2_000 },
      'child-1': { parentId: 'session-alpha', running: true },
    },
    subagentsByParent: { 'session-alpha': [{ id: 'child-1' }] },
  })
  assert.equal(current.facts[0].status, 'busy', 'session event updates status through the production fact builder')
  assert.equal(current.facts[0].subagentCount, 1, 'subagent event is deduplicated across both snapshot channels')
  assert.deepEqual(current.matchesByRoom.ops, ['alpha'])
  assert.deepEqual(current.summariesByRoom.ops, { memberIds: ['alpha'], needCount: 0 }, 'room summary uses the effective membership seam')
  assert.equal(notifications, 1, 'open room is notified after the event changes facts and membership')

  current = refresh(makeRoom([childCondition]), project(), {
    byId: {
      'session-alpha': { running: true },
      'child-1': { parentId: 'session-alpha', pendingInteraction: { type: 'question' } },
    },
    subagentsByParent: { 'session-alpha': [{ sessionId: 'child-1' }] },
  })
  assert.equal(current.facts[0].status, 'need', 'child pending event preserves need > done > busy priority')
  assert.deepEqual(current.summariesByRoom.ops, { memberIds: ['alpha'], needCount: 1 })
  assert.equal(notifications, 2, 'open-room notification fires when need summary changes')

  const hiddenRule = { id: 'hidden', field: 'hidden', operator: 'equals', value: true }
  current = refresh(makeRoom([hiddenRule]), project({ hidden: true }), {
    byId: { 'session-alpha': { completed: true, updatedAt: 3_000 } },
    subagentsByParent: {},
  })
  assert.equal(current.facts[0].hidden, true, 'project event enters the same production refresh')
  assert.equal(current.facts[0].status, 'done')
  assert.deepEqual(current.summariesByRoom.ops, { memberIds: ['alpha'], needCount: 0 }, 'rule and project events recompute the room summary')
  assert.equal(notifications, 3, 'rule/project refresh notifies the open room')

  process.stdout.write('control-room-rule-refresh: PASS (production event seam, summary, and open-room notification)\n')
}

main()
  .catch((error) => {
    process.stderr.write(`${error && error.stack ? error.stack : error}\n`)
    process.exitCode = 1
  })
  .finally(() => fs.rmSync(tempDir, { recursive: true, force: true }))
