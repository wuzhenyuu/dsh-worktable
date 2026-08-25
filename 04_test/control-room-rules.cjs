/* Portable Task 4 assertions for control-room rule evaluation and membership. */
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { build } = require('../01_content/node_modules/esbuild')

const repo = path.resolve(__dirname, '..')
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-control-room-rules-'))

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

const condition = (field, operator, value, exclude = false) => ({
  id: `${field}-${operator}-${String(value)}`,
  field,
  operator,
  value,
  ...(exclude ? { exclude: true } : {}),
})
const rule = (conditions, mode = 'all', enabled = true) => ({ id: `rule-${mode}-${conditions.length}`, enabled, mode, conditions })
const facts = (patch = {}) => ({
  id: 'alpha',
  status: 'busy',
  name: 'Alpha Builder',
  icon: '🧪',
  tags: ['frontend', 'urgent'],
  workspace: 'F:/codex/alpha',
  hasBoundSession: true,
  subagentCount: 3,
  lastActiveAt: 2_000,
  lastCompletedAt: 1_500,
  hidden: false,
  archived: false,
  ...patch,
})

async function main() {
  const rules = await bundle('controlRoomRules')
  const runtime = await bundle('controlRoomRuntime')
  const domain = await bundle('controlRooms')

  assert.equal(rules.evaluateControlRoomRule(rule([
    condition('status', 'equals', 'busy'),
    condition('name', 'contains', 'builder'),
  ], 'all'), facts()).matched, true, 'all requires every included condition')
  assert.equal(rules.evaluateControlRoomRule(rule([
    condition('status', 'equals', 'idle'),
    condition('name', 'contains', 'alpha'),
  ], 'any'), facts()).matched, true, 'any accepts one included condition')
  assert.equal(rules.evaluateControlRoomRule(rule([
    condition('name', 'contains', 'alpha'),
    condition('tag', 'contains', 'urgent', true),
  ]), facts()).matched, false, 'matching excluded condition disqualifies')

  const room = domain.normalizeControlRoom({
    id: 'room',
    projectIds: ['manual'],
    fixedProjectIds: ['fixed'],
    excludedProjectIds: ['excluded', 'fixed-excluded'],
    projectOrder: ['fixed', 'manual'],
  })
  assert.deepEqual(
    runtime.effectiveControlRoomProjectIds(room, ['manual', 'fixed', 'rule-hit', 'excluded', 'fixed-excluded'], ['rule-hit', 'excluded']),
    ['fixed', 'manual', 'rule-hit'],
    'fixed survives no-match while rule matches append',
  )
  const fixedExcluded = domain.normalizeControlRoom({ ...room, fixedProjectIds: ['fixed-excluded'] })
  assert.deepEqual(runtime.effectiveControlRoomProjectIds(fixedExcluded, ['fixed-excluded'], ['fixed-excluded']), [], 'manual exclusion always wins')

  const normalized = domain.normalizeControlRoom({
    id: 'corrupt-room',
    rules: [
      { id: 'bad', enabled: true, mode: 'all', conditions: [{ id: 'bad-c', field: 'subagentCount', operator: 'contains', value: '3' }] },
      { ...rule([condition('name', 'contains', 'alpha')]), name: 'Builder rule' },
    ],
  })
  assert.equal(normalized.rules[0].enabled, false, 'normalization disables only the corrupt rule')
  assert.equal(normalized.rules[1].name, 'Builder rule', 'optional rule names survive normalization')
  assert.deepEqual(rules.matchingControlRoomProjectIds(normalized.rules, [facts()]), ['alpha'], 'a corrupt rule cannot block a valid sibling')
  assert.deepEqual(rules.evaluateControlRoomRule({ id: 'raw-bad', enabled: true, mode: 'all', conditions: [null] }, facts()), { matched: false, disabled: true }, 'raw corrupt input is isolated')

  assert.equal(rules.evaluateControlRoomRule(rule([condition('status', 'equals', 'busy')]), facts()).matched, true, 'status family')
  assert.equal(rules.evaluateControlRoomRule(rule([condition('name', 'contains', 'PHA BUIL')]), facts()).matched, true, 'name keyword is case-insensitive')
  assert.equal(rules.evaluateControlRoomRule(rule([condition('icon', 'equals', '🧪')]), facts()).matched, true, 'icon family')
  assert.equal(rules.evaluateControlRoomRule(rule([condition('tag', 'in', ['backend', 'urgent'])]), facts()).matched, true, 'tag family')
  assert.equal(rules.evaluateControlRoomRule(rule([condition('workspace', 'contains', 'codex/alpha')]), facts()).matched, true, 'workspace family')
  assert.equal(rules.evaluateControlRoomRule(rule([condition('hasBoundSession', 'equals', true)]), facts()).matched, true, 'bound-session family')
  assert.equal(rules.evaluateControlRoomRule(rule([condition('subagentCount', 'greaterThanOrEqual', 2)]), facts()).matched, true, 'child-agent family')
  assert.equal(rules.evaluateControlRoomRule(rule([condition('lastActiveAt', 'after', 1_999)]), facts()).matched, true, 'last-active family')
  assert.equal(rules.evaluateControlRoomRule(rule([condition('lastCompletedAt', 'before', 1_501)]), facts()).matched, true, 'last-completed family')
  assert.equal(rules.evaluateControlRoomRule(rule([condition('hidden', 'equals', false)]), facts()).matched, true, 'hidden family')
  assert.equal(rules.evaluateControlRoomRule(rule([condition('archived', 'equals', false)]), facts()).matched, true, 'archived family')

  const dynamicRule = rule([
    condition('status', 'equals', 'busy'),
    condition('subagentCount', 'greaterThanOrEqual', 1),
    condition('hasBoundSession', 'equals', true),
  ])
  assert.deepEqual(rules.matchingControlRoomProjectIds([dynamicRule], [facts({ status: 'idle', subagentCount: 0, hasBoundSession: false })]), [], 'stale event inputs do not match')
  assert.deepEqual(rules.matchingControlRoomProjectIds([dynamicRule], [facts({ status: 'busy', subagentCount: 2, hasBoundSession: true })]), ['alpha'], 'fresh event inputs recalculate immediately')

  const storageData = new Map()
  const storage = {
    getItem: (key) => storageData.has(key) ? storageData.get(key) : null,
    setItem: (key, value) => storageData.set(key, String(value)),
  }
  const repository = new domain.ControlRoomsStorage(storage)
  const persistedState = domain.createControlRoom(domain.createEmptyControlRoomsState(), { name: 'Rules', rules: normalized.rules }, { id: 'rules-room', now: 5_000 })
  assert.equal(repository.save(persistedState, domain.createEmptyControlRoomsTrashState()).ok, true, 'rule configuration persists')
  assert.equal(repository.load().state.rooms['rules-room'].rules[1].name, 'Builder rule', 'rule display name survives storage reload')

  process.stdout.write('control-room-rules: PASS (24 assertions across every Task 4 family)\n')
}

main()
  .catch((error) => {
    process.stderr.write(`${error && error.stack ? error.stack : error}\n`)
    process.exitCode = 1
  })
  .finally(() => fs.rmSync(tempDir, { recursive: true, force: true }))
