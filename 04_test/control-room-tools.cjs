/* Portable E2E-style assertions for the in-client control-room command bridge. */
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { build } = require('../01_content/node_modules/esbuild')

const repo = path.resolve(__dirname, '..')
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-control-room-tools-'))
const bundle = path.join(tempDir, 'control-room-tools.cjs')

async function main() {
  await build({
    entryPoints: [path.join(repo, '01_content/src/client/controlRoomCommands.ts')],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: ['node22'],
    logLevel: 'silent',
  })
  const commands = require(bundle)

  let now = 10_000
  const opened = []
  let snapshot = {
    state: commands.createEmptyControlRoomsState(),
    trash: commands.createEmptyControlRoomsTrashState(),
  }
  const knownProjects = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']
  const adapter = {
    snapshot: () => snapshot,
    commit: (mutate) => {
      snapshot = mutate(snapshot)
      return snapshot
    },
    now: () => ++now,
    knownProjectIds: () => knownProjects,
    isSessionRunning: (sessionId) => sessionId === 'session-running',
    open: (controlRoomId) => { opened.push(controlRoomId) },
    search: (query, limit) => ({ query, results: [], total: 0, limited: limit }),
  }

  const bridge = commands.createControlRoomCommandBridge(adapter)

  // Catches: commands bypassing the domain reorder path or failing to audit model writes.
  {
    const created = bridge.execute({ action: 'control_room.create', controlRoomId: 'room-alpha', room: { name: 'Alpha' } })
    assert.equal(created.ok, true)
    assert.equal(created.controlRoomId, 'room-alpha')
    const added = bridge.execute({ action: 'control_room.add_projects', controlRoomId: 'room-alpha', projectIds: ['p1', 'p2', 'p3'] })
    assert.equal(added.ok, true)
    const reordered = bridge.execute({ action: 'control_room.reorder_projects', controlRoomId: 'room-alpha', projectIds: ['p3', 'p1', 'p2'] })
    assert.equal(reordered.ok, true)
    assert.deepEqual(snapshot.state.rooms['room-alpha'].projectOrder, ['p3', 'p1', 'p2'])
    assert.deepEqual(snapshot.trash.audit.map((entry) => [entry.actor, entry.action, entry.controlRoomId]), [
      ['deepseek', 'create', 'room-alpha'],
      ['deepseek', 'add_projects', 'room-alpha'],
      ['deepseek', 'reorder_projects', 'room-alpha'],
    ])
  }

  // Catches: any declared bridge operation being only a type name without a working production branch.
  {
    assert.equal(bridge.execute({ action: 'control_room.list' }).data.rooms.length, 1)
    assert.equal(bridge.execute({ action: 'control_room.get', controlRoomId: 'room-alpha' }).data.id, 'room-alpha')
    assert.equal(bridge.execute({ action: 'control_room.update', controlRoomId: 'room-alpha', patch: { description: 'Managed room' } }).ok, true)
    assert.equal(bridge.execute({ action: 'control_room.copy', controlRoomId: 'room-alpha', newControlRoomId: 'room-beta', name: 'Beta' }).ok, true)
    const rule = {
      id: 'rule-busy',
      name: 'Busy work',
      enabled: true,
      mode: 'all',
      conditions: [{ id: 'condition-busy', field: 'status', operator: 'equals', value: 'busy' }],
    }
    assert.equal(bridge.execute({ action: 'control_room.set_rule', controlRoomId: 'room-beta', mode: 'upsert', rule }).ok, true)
    assert.equal(bridge.execute({ action: 'control_room.set_rule', controlRoomId: 'room-beta', mode: 'remove', ruleId: 'rule-busy' }).ok, true)
    assert.equal(bridge.execute({ action: 'control_room.bind_session', controlRoomId: 'room-beta', sessionId: 'session-idle' }).ok, true)
    assert.equal(bridge.execute({ action: 'control_room.search', query: 'beta', limit: 5 }).data.query, 'beta')
    assert.equal(bridge.execute({ action: 'control_room.open', controlRoomId: 'room-beta' }).ok, true)
    assert.deepEqual(opened, ['room-beta'])
    const archive = bridge.execute({ action: 'control_room.archive', controlRoomId: 'room-beta' })
    assert.equal(archive.error.code, 'CONFIRMATION_REQUIRED')
    assert.equal(bridge.execute({ action: 'control_room.archive', controlRoomId: 'room-beta', confirmationToken: archive.confirmation.token }).ok, true)
    assert.equal(bridge.execute({ action: 'control_room.restore', controlRoomId: 'room-beta' }).ok, true)
    assert.equal(snapshot.state.rooms['room-beta'].name, 'Beta')
  }

  // Catches: target commands accepting a missing/name-guessed/array room selector.
  {
    const targeted = [
      { action: 'control_room.get' },
      { action: 'control_room.create', room: { name: 'Wrong' } },
      { action: 'control_room.update', patch: { name: 'Wrong' } },
      { action: 'control_room.copy', newControlRoomId: 'room-copy' },
      { action: 'control_room.add_projects', projectIds: ['p1'] },
      { action: 'control_room.remove_projects', projectIds: ['p1'] },
      { action: 'control_room.reorder_projects', projectIds: ['p1'] },
      { action: 'control_room.set_rule', mode: 'remove', ruleId: 'rule-1' },
      { action: 'control_room.bind_session', sessionId: null },
      { action: 'control_room.open' },
      { action: 'control_room.archive' },
      { action: 'control_room.restore' },
    ]
    for (const request of targeted) {
      const result = bridge.execute({ ...request, name: 'Alpha' })
      assert.equal(result.ok, false, request.action)
      assert.equal(result.error.code, 'EXACT_CONTROL_ROOM_ID_REQUIRED', request.action)
    }
    const ambiguous = bridge.execute({ action: 'control_room.update', controlRoomId: ['room-alpha', 'room-other'], patch: { name: 'Wrong' } })
    assert.equal(ambiguous.ok, false)
    assert.equal(ambiguous.error.code, 'EXACT_CONTROL_ROOM_ID_REQUIRED')
    assert.equal(snapshot.state.rooms['room-alpha'].name, 'Alpha')
  }

  // Catches: destructive requests mutating before an exact, payload-bound confirmation replay.
  {
    bridge.execute({ action: 'control_room.add_projects', controlRoomId: 'room-alpha', projectIds: ['p4', 'p5', 'p6'] })
    const removeRequest = { action: 'control_room.remove_projects', controlRoomId: 'room-alpha', projectIds: ['p1', 'p2', 'p3', 'p4', 'p5'] }
    const blocked = bridge.execute(removeRequest)
    assert.equal(blocked.ok, false)
    assert.equal(blocked.error.code, 'CONFIRMATION_REQUIRED')
    assert.deepEqual(snapshot.state.rooms['room-alpha'].projectIds, knownProjects)
    const wrong = bridge.execute({ ...removeRequest, confirmationToken: blocked.confirmation.token + '-wrong' })
    assert.equal(wrong.ok, false)
    assert.equal(wrong.error.code, 'CONFIRMATION_REQUIRED')
    const confirmed = bridge.execute({ ...removeRequest, confirmationToken: blocked.confirmation.token })
    assert.equal(confirmed.ok, true)
    assert.deepEqual(snapshot.state.rooms['room-alpha'].projectIds, ['p6'])

    bridge.execute({ action: 'control_room.bind_session', controlRoomId: 'room-alpha', sessionId: 'session-running' })
    const unbind = bridge.execute({ action: 'control_room.bind_session', controlRoomId: 'room-alpha', sessionId: null })
    assert.equal(unbind.error.code, 'CONFIRMATION_REQUIRED')
    assert.equal(snapshot.state.rooms['room-alpha'].boundSessionId, 'session-running')
    assert.equal(bridge.execute({ action: 'control_room.bind_session', controlRoomId: 'room-alpha', sessionId: null, confirmationToken: unbind.confirmation.token }).ok, true)

    const replaceRules = bridge.execute({ action: 'control_room.set_rule', controlRoomId: 'room-alpha', mode: 'replace_all', rules: [] })
    assert.equal(replaceRules.error.code, 'CONFIRMATION_REQUIRED')
    assert.equal(bridge.execute({ action: 'control_room.set_rule', controlRoomId: 'room-alpha', mode: 'replace_all', rules: [], confirmationToken: replaceRules.confirmation.token }).ok, true)

    const archive = bridge.execute({ action: 'control_room.archive', controlRoomId: 'room-alpha' })
    assert.equal(archive.error.code, 'CONFIRMATION_REQUIRED')
    assert.ok(snapshot.state.rooms['room-alpha'])
    assert.equal(bridge.execute({ action: 'control_room.archive', controlRoomId: 'room-alpha', confirmationToken: archive.confirmation.token }).ok, true)
    assert.equal(snapshot.state.rooms['room-alpha'], undefined)
    assert.equal(snapshot.trash.deleted[0].room.id, 'room-alpha')
  }

  // Catches: hidden bulk/master-data deletions becoming executable through the fallback.
  {
    for (const action of ['control_room.empty_trash', 'control_room.update_many', 'control_room.remove_project_from_all_rooms', 'control_room.delete_project_master_data']) {
      const result = bridge.execute({ action, confirmationToken: `confirm:${action}:anything` })
      assert.equal(result.ok, false, action)
      assert.equal(result.error.code, 'UNSUPPORTED_DESTRUCTIVE_OPERATION', action)
    }
  }

  // Catches: room import leaking foreign data into project/session/global settings or omitting its user audit.
  {
    const master = {
      projects: { p1: { name: 'Master project' } },
      conversations: ['session-running'],
      appearance: { theme: 'dark' },
      hardware: { gpu: 'unchanged' },
    }
    const beforeMaster = JSON.stringify(master)
    let source = commands.createEmptyControlRoomsState()
    source = commands.createControlRoom(source, { name: 'Imported', projectIds: ['p1'] }, { id: 'room-imported', now: 20_000 })
    const imported = commands.importControlRoomsWithAudit(snapshot, commands.exportControlRooms(source, 20_001), 20_002, 'user')
    snapshot = imported.snapshot
    assert.equal(JSON.stringify(master), beforeMaster)
    assert.equal(imported.idMap['room-imported'], 'room-imported')
    assert.deepEqual(snapshot.state.rooms['room-imported'].projectIds, ['p1'])
    assert.deepEqual(snapshot.trash.audit.at(-1), {
      actor: 'user',
      timestamp: 20_002,
      action: 'import',
      controlRoomId: 'room-imported',
      summary: 'Imported control-room configuration',
    })
  }

  process.stdout.write('control-room-tools: PASS (6 E2E-style safety flows)\n')
}

main()
  .catch((error) => {
    process.stderr.write(`${error && error.stack ? error.stack : error}\n`)
    process.exitCode = 1
  })
  .finally(() => fs.rmSync(tempDir, { recursive: true, force: true }))
