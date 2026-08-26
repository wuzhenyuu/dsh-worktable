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

  // A cross-tab conflict keeps reads available but rejects mutations before
  // commit/open/callback side effects can run.
  {
    let commitCalls = 0
    let openCalls = 0
    const blockedBridge = commands.createControlRoomCommandBridge({
      ...adapter,
      mutationBlocked: () => true,
      commit: (mutate) => {
        commitCalls += 1
        return adapter.commit(mutate)
      },
      open: () => { openCalls += 1 },
    })
    assert.equal(blockedBridge.execute({ action: 'control_room.list' }).ok, true)
    assert.equal(blockedBridge.execute({ action: 'control_room.get', controlRoomId: 'room-alpha' }).error.code, 'CONTROL_ROOM_NOT_FOUND')
    assert.equal(blockedBridge.execute({ action: 'control_room.search', query: 'alpha' }).ok, true)
    assert.equal(blockedBridge.execute({ action: 'control_room.create', controlRoomId: 'blocked-room', room: { name: 'Blocked' } }).error.code, 'CONFLICT_RELOAD_REQUIRED')
    assert.equal(blockedBridge.execute({ action: 'control_room.open', controlRoomId: 'blocked-room' }).error.code, 'CONFLICT_RELOAD_REQUIRED')
    assert.equal(commitCalls, 0)
    assert.equal(openCalls, 0)
  }

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

  // Catches: unknown command input being silently normalized, partially dropped, persisted, or audited.
  {
    const malformedCreates = [
      { name: 42 },
      { name: '   ' },
      { icon: '' },
      { description: false },
      { themeMode: 'neon' },
      { cardLayout: { columns: 5, cardSize: 'wide' } },
      { cardLayout: { columns: 2, cardSize: 'wide', extra: true } },
      { filters: { statuses: ['busy', 'busy'], showHidden: false, showArchived: false } },
      { filters: { statuses: ['idle'], showHidden: 'no', showArchived: false } },
      { defaultPane: 'dashboard' },
      { sidebarVisible: 'yes' },
      { projectIds: ['p1', 'p1'] },
      { projectIds: [' p1'] },
      { projectIds: ['p1', 'p2'], projectOrder: ['p1'] },
      { projectIds: ['p1'], projectOrder: ['p1', 'ghost'] },
      { fixedProjectIds: ['p1', 'p1'] },
      { excludedProjectIds: ['p1', 'p1'] },
      { boundSessionId: ' session-idle' },
      { rules: [{ id: 'rule-1', name: 7, enabled: true, mode: 'all', conditions: [{ id: 'condition-1', field: 'status', operator: 'equals', value: 'busy' }] }] },
      { rules: [{ id: 'rule-1', enabled: true, mode: 'all', conditions: [{ id: 'condition-1', field: 'status', operator: 'equals', value: 'busy', exclude: 'yes' }] }] },
      { rules: [{ id: 'rule-1', enabled: true, mode: 'all', conditions: [{ id: 'condition-1', field: 'status', operator: 'equals', value: 'busy', extra: true }] }] },
      { rules: [
        { id: 'rule-1', enabled: true, mode: 'all', conditions: [{ id: 'condition-1', field: 'status', operator: 'equals', value: 'busy' }] },
        { id: 'rule-1', enabled: true, mode: 'all', conditions: [{ id: 'condition-2', field: 'status', operator: 'equals', value: 'need' }] },
      ] },
    ]
    malformedCreates.forEach((room, index) => {
      const beforeRequest = JSON.stringify(snapshot)
      const result = bridge.execute({ action: 'control_room.create', controlRoomId: `invalid-create-${index}`, room })
      assert.equal(result.ok, false, `malformed create ${index}`)
      assert.equal(result.error.code, 'INVALID_REQUEST', `malformed create ${index}`)
      assert.equal(JSON.stringify(snapshot), beforeRequest, `malformed create ${index} mutated state/trash/audit`)
    })

    const malformedUpdates = [
      { name: null },
      { icon: '' },
      { description: 1 },
      { themeMode: 'neon' },
      { cardLayout: { columns: 2 } },
      { filters: { statuses: [], showHidden: false, showArchived: false } },
      { defaultPane: false },
      { sidebarVisible: 1 },
    ]
    malformedUpdates.forEach((patch, index) => {
      const beforeRequest = JSON.stringify(snapshot)
      const result = bridge.execute({ action: 'control_room.update', controlRoomId: 'room-alpha', patch })
      assert.equal(result.ok, false, `malformed update ${index}`)
      assert.equal(result.error.code, 'INVALID_REQUEST', `malformed update ${index}`)
      assert.equal(JSON.stringify(snapshot), beforeRequest, `malformed update ${index} mutated state/trash/audit`)
    })

    const validComplex = bridge.execute({
      action: 'control_room.create',
      controlRoomId: 'room-complex',
      room: {
        name: 'Complex',
        icon: 'C',
        description: 'Strict nested input',
        themeMode: 'dark',
        cardLayout: { columns: 3, cardSize: 'wide' },
        filters: { statuses: ['busy', 'need'], showHidden: true, showArchived: false },
        defaultPane: 'files',
        sidebarVisible: false,
        projectIds: ['p1', 'p2'],
        projectOrder: ['p3', 'p1', 'p2'],
        fixedProjectIds: ['p3'],
        excludedProjectIds: ['p4'],
        boundSessionId: 'session-idle',
        rules: [{
          id: 'rule-complex',
          name: 'Complex rule',
          enabled: true,
          mode: 'any',
          conditions: [{ id: 'condition-complex', field: 'status', operator: 'notEquals', value: 'idle', exclude: false }],
        }],
      },
    })
    assert.equal(validComplex.ok, true)
    assert.deepEqual(snapshot.state.rooms['room-complex'].projectOrder, ['p3', 'p1', 'p2'])
    assert.equal(snapshot.state.rooms['room-complex'].rules[0].name, 'Complex rule')
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
    const replaceRunningRequest = {
      action: 'control_room.bind_session',
      controlRoomId: 'room-alpha',
      sessionId: 'session-idle',
    }
    const replaceRunning = bridge.execute(replaceRunningRequest)
    assert.equal(replaceRunning.error.code, 'CONFIRMATION_REQUIRED')
    assert.equal(snapshot.state.rooms['room-alpha'].boundSessionId, 'session-running')
    const changedReplacement = bridge.execute({
      ...replaceRunningRequest,
      sessionId: 'session-other',
      confirmationToken: replaceRunning.confirmation.token,
    })
    assert.equal(changedReplacement.error.code, 'CONFIRMATION_REQUIRED')
    assert.notEqual(changedReplacement.confirmation.token, replaceRunning.confirmation.token)
    assert.equal(snapshot.state.rooms['room-alpha'].boundSessionId, 'session-running')
    const confirmedReplaceRequest = {
      ...replaceRunningRequest,
      confirmationToken: replaceRunning.confirmation.token,
    }
    assert.equal(bridge.execute(confirmedReplaceRequest).ok, true)
    assert.equal(snapshot.state.rooms['room-alpha'].boundSessionId, 'session-idle')
    const afterConfirmedReplace = JSON.stringify(snapshot)
    const replayedReplace = bridge.execute(confirmedReplaceRequest)
    assert.equal(replayedReplace.ok, false)
    assert.equal(replayedReplace.error.code, 'CONFIRMATION_REQUIRED')
    assert.equal(JSON.stringify(snapshot), afterConfirmedReplace)

    bridge.execute({ action: 'control_room.bind_session', controlRoomId: 'room-alpha', sessionId: 'session-running' })
    const unbind = bridge.execute({ action: 'control_room.bind_session', controlRoomId: 'room-alpha', sessionId: null })
    assert.equal(unbind.error.code, 'CONFIRMATION_REQUIRED')
    assert.equal(snapshot.state.rooms['room-alpha'].boundSessionId, 'session-running')
    const confirmedUnbindRequest = {
      action: 'control_room.bind_session',
      controlRoomId: 'room-alpha',
      sessionId: null,
      confirmationToken: unbind.confirmation.token,
    }
    assert.equal(bridge.execute(confirmedUnbindRequest).ok, true)
    const afterConfirmedUnbind = JSON.stringify(snapshot)
    const replayedUnbind = bridge.execute(confirmedUnbindRequest)
    assert.equal(replayedUnbind.ok, false)
    assert.equal(replayedUnbind.error.code, 'CONFIRMATION_REQUIRED')
    assert.equal(JSON.stringify(snapshot), afterConfirmedUnbind)

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

  // Catches: confirmation tokens being accepted for another action, room, payload, or room revision.
  {
    for (const controlRoomId of ['token-room-a', 'token-room-b', 'token-room-c']) {
      assert.equal(bridge.execute({
        action: 'control_room.create',
        controlRoomId,
        room: { projectIds: knownProjects, projectOrder: knownProjects },
      }).ok, true)
    }
    const removeRequest = {
      action: 'control_room.remove_projects',
      controlRoomId: 'token-room-a',
      projectIds: ['p1', 'p2', 'p3', 'p4', 'p5'],
    }
    const blocked = bridge.execute(removeRequest)
    assert.equal(blocked.error.code, 'CONFIRMATION_REQUIRED')
    const token = blocked.confirmation.token

    const changedActionBefore = JSON.stringify(snapshot)
    const changedAction = bridge.execute({ action: 'control_room.archive', controlRoomId: 'token-room-a', confirmationToken: token })
    assert.equal(changedAction.error.code, 'CONFIRMATION_REQUIRED')
    assert.equal(JSON.stringify(snapshot), changedActionBefore)

    const changedRoomBefore = JSON.stringify(snapshot)
    const changedRoom = bridge.execute({ ...removeRequest, controlRoomId: 'token-room-b', confirmationToken: token })
    assert.equal(changedRoom.error.code, 'CONFIRMATION_REQUIRED')
    assert.equal(JSON.stringify(snapshot), changedRoomBefore)

    const changedPayloadBefore = JSON.stringify(snapshot)
    const changedPayload = bridge.execute({ ...removeRequest, projectIds: [...removeRequest.projectIds, 'ghost'], confirmationToken: token })
    assert.equal(changedPayload.error.code, 'CONFIRMATION_REQUIRED')
    assert.notEqual(changedPayload.confirmation.token, token)
    assert.equal(JSON.stringify(snapshot), changedPayloadBefore)

    for (const projectIds of [['p1', 'p1'], [' p1'], ['']]) {
      const invalidIdsBefore = JSON.stringify(snapshot)
      const invalidIds = bridge.execute({ action: 'control_room.remove_projects', controlRoomId: 'token-room-a', projectIds })
      assert.equal(invalidIds.error.code, 'INVALID_REQUEST')
      assert.equal(JSON.stringify(snapshot), invalidIdsBefore)
    }

    const confirmedRemove = bridge.execute({ ...removeRequest, confirmationToken: token })
    assert.equal(confirmedRemove.ok, true)
    const afterConfirmedRemove = JSON.stringify(snapshot)
    const replayedRemove = bridge.execute({ ...removeRequest, confirmationToken: token })
    assert.equal(replayedRemove.ok, false)
    assert.equal(replayedRemove.error.code, 'CONFIRMATION_REQUIRED')
    assert.equal(JSON.stringify(snapshot), afterConfirmedRemove)

    const revisionRequest = { ...removeRequest, controlRoomId: 'token-room-c' }
    const revisionBlocked = bridge.execute(revisionRequest)
    assert.equal(revisionBlocked.error.code, 'CONFIRMATION_REQUIRED')
    assert.equal(bridge.execute({ action: 'control_room.update', controlRoomId: 'token-room-c', patch: { description: 'Revision changed' } }).ok, true)
    const changedRevisionBefore = JSON.stringify(snapshot)
    const changedRevision = bridge.execute({ ...revisionRequest, confirmationToken: revisionBlocked.confirmation.token })
    assert.equal(changedRevision.error.code, 'CONFIRMATION_REQUIRED')
    assert.notEqual(changedRevision.confirmation.token, revisionBlocked.confirmation.token)
    assert.equal(JSON.stringify(snapshot), changedRevisionBefore)
  }

  // Catches: same-millisecond mutations or React effect bridge reconstruction reviving a consumed token.
  {
    const ledger = commands.createControlRoomConfirmationLedger()
    const frozenAdapter = { ...adapter, now: () => 777_000 }
    const firstBridge = commands.createControlRoomCommandBridge(frozenAdapter, ledger)
    assert.equal(firstBridge.execute({
      action: 'control_room.create',
      controlRoomId: 'same-ms-ledger-room',
      room: { projectIds: knownProjects, projectOrder: knownProjects },
    }).ok, true)
    const initialRevision = snapshot.state.rooms['same-ms-ledger-room'].updatedAt
    const removeRequest = {
      action: 'control_room.remove_projects',
      controlRoomId: 'same-ms-ledger-room',
      projectIds: ['p1', 'p2', 'p3', 'p4', 'p5'],
    }
    const blocked = firstBridge.execute(removeRequest)
    assert.equal(blocked.error.code, 'CONFIRMATION_REQUIRED')
    assert.equal(firstBridge.execute({ ...removeRequest, confirmationToken: blocked.confirmation.token }).ok, true)
    assert.ok(snapshot.state.rooms['same-ms-ledger-room'].updatedAt > initialRevision, 'successful same-millisecond mutation advances the room revision')

    const afterSuccess = JSON.stringify(snapshot)
    const rebuiltBridge = commands.createControlRoomCommandBridge(frozenAdapter, ledger)
    const replayed = rebuiltBridge.execute({ ...removeRequest, confirmationToken: blocked.confirmation.token })
    assert.equal(replayed.ok, false)
    assert.equal(replayed.error.code, 'CONFIRMATION_REQUIRED')
    assert.equal(JSON.stringify(snapshot), afterSuccess, 'replayed token after bridge reconstruction changes no state, trash, or audit')

    assert.equal(firstBridge.execute({
      action: 'control_room.create',
      controlRoomId: 'same-ms-revision-room',
      room: { projectIds: knownProjects, projectOrder: knownProjects },
    }).ok, true)
    const revisionRequest = { ...removeRequest, controlRoomId: 'same-ms-revision-room' }
    const stale = firstBridge.execute(revisionRequest)
    assert.equal(stale.error.code, 'CONFIRMATION_REQUIRED')
    assert.equal(firstBridge.execute({ action: 'control_room.update', controlRoomId: 'same-ms-revision-room', patch: { description: 'same clock tick' } }).ok, true)
    const beforeStaleReplay = JSON.stringify(snapshot)
    const staleReplay = rebuiltBridge.execute({ ...revisionRequest, confirmationToken: stale.confirmation.token })
    assert.equal(staleReplay.ok, false)
    assert.equal(staleReplay.error.code, 'CONFIRMATION_REQUIRED')
    assert.notEqual(staleReplay.confirmation.token, stale.confirmation.token)
    assert.equal(JSON.stringify(snapshot), beforeStaleReplay, 'stale same-millisecond token changes no state, trash, or audit')
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

  process.stdout.write('control-room-tools: PASS (8 E2E-style safety flows)\n')
}

main()
  .catch((error) => {
    process.stderr.write(`${error && error.stack ? error.stack : error}\n`)
    process.exitCode = 1
  })
  .finally(() => fs.rmSync(tempDir, { recursive: true, force: true }))
