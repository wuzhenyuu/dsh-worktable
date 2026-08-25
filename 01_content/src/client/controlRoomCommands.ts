import {
  addProjectToRoom,
  appendControlRoomAudit,
  copyControlRoom,
  createControlRoom,
  createEmptyControlRoomsState,
  createEmptyControlRoomsTrashState,
  deleteControlRoom,
  exportControlRooms,
  importControlRooms,
  isControlRoomConditionCompatible,
  normalizeControlRoom,
  removeProjectFromRoom,
  reorderProjectsInRoom,
  restoreControlRoom,
  updateControlRoom,
  type ControlRoom,
  type ControlRoomAuditActor,
  type ControlRoomCreateInput,
  type ControlRoomRule,
  type ControlRoomsState,
  type ControlRoomsTrashState,
} from './controlRooms'

export {
  createControlRoom,
  createEmptyControlRoomsState,
  createEmptyControlRoomsTrashState,
  exportControlRooms,
}

export const CONTROL_ROOM_COMMAND_OPERATIONS = [
  'control_room.list',
  'control_room.get',
  'control_room.create',
  'control_room.update',
  'control_room.copy',
  'control_room.add_projects',
  'control_room.remove_projects',
  'control_room.reorder_projects',
  'control_room.set_rule',
  'control_room.bind_session',
  'control_room.open',
  'control_room.archive',
  'control_room.restore',
  'control_room.search',
] as const

export type ControlRoomCommandAction = typeof CONTROL_ROOM_COMMAND_OPERATIONS[number]

export type ControlRoomsSnapshot = {
  state: ControlRoomsState
  trash: ControlRoomsTrashState
}

type ConfirmationFields = { confirmationToken?: string }

export type ControlRoomUpdatePatch = Partial<Pick<ControlRoom,
  'name' | 'icon' | 'description' | 'themeMode' | 'cardLayout' | 'filters' | 'defaultPane' | 'sidebarVisible'
>>

export type ControlRoomCommandRequest =
  | { action: 'control_room.list' }
  | { action: 'control_room.get'; controlRoomId: string }
  | { action: 'control_room.create'; controlRoomId: string; room?: ControlRoomUpdatePatch & Pick<Partial<ControlRoom>, 'projectIds' | 'projectOrder' | 'fixedProjectIds' | 'excludedProjectIds' | 'boundSessionId' | 'rules'> }
  | { action: 'control_room.update'; controlRoomId: string; patch: ControlRoomUpdatePatch }
  | ({ action: 'control_room.copy'; controlRoomId: string; newControlRoomId: string; name?: string } & ConfirmationFields)
  | { action: 'control_room.add_projects'; controlRoomId: string; projectIds: string[] }
  | ({ action: 'control_room.remove_projects'; controlRoomId: string; projectIds: string[] } & ConfirmationFields)
  | { action: 'control_room.reorder_projects'; controlRoomId: string; projectIds: string[] }
  | ({ action: 'control_room.set_rule'; controlRoomId: string; mode: 'upsert'; rule: ControlRoomRule } & ConfirmationFields)
  | ({ action: 'control_room.set_rule'; controlRoomId: string; mode: 'remove'; ruleId: string } & ConfirmationFields)
  | ({ action: 'control_room.set_rule'; controlRoomId: string; mode: 'replace_all'; rules: ControlRoomRule[] } & ConfirmationFields)
  | ({ action: 'control_room.bind_session'; controlRoomId: string; sessionId: string | null } & ConfirmationFields)
  | { action: 'control_room.open'; controlRoomId: string }
  | ({ action: 'control_room.archive'; controlRoomId: string } & ConfirmationFields)
  | { action: 'control_room.restore'; controlRoomId: string }
  | { action: 'control_room.search'; query: string; limit?: number }

export type ControlRoomCommandErrorCode =
  | 'INVALID_REQUEST'
  | 'UNKNOWN_OPERATION'
  | 'EXACT_CONTROL_ROOM_ID_REQUIRED'
  | 'CONTROL_ROOM_NOT_FOUND'
  | 'CONTROL_ROOM_ALREADY_EXISTS'
  | 'PROJECT_NOT_FOUND'
  | 'INVALID_RULE'
  | 'CONFIRMATION_REQUIRED'
  | 'UNSUPPORTED_DESTRUCTIVE_OPERATION'
  | 'COMMAND_FAILED'

export type ControlRoomCommandConfirmation = {
  token: string
  action: ControlRoomCommandAction
  controlRoomIds: string[]
  summary: string
}

export type ControlRoomCommandResult =
  | {
      ok: true
      action: ControlRoomCommandAction
      changed: boolean
      controlRoomId?: string
      data?: unknown
    }
  | {
      ok: false
      action: string
      error: { code: ControlRoomCommandErrorCode; message: string }
      confirmation?: ControlRoomCommandConfirmation
    }

export type ControlRoomSearchCommandResult = {
  query: string
  results: readonly unknown[]
  total: number
  [key: string]: unknown
}

export type ControlRoomCommandAdapter = {
  snapshot(): ControlRoomsSnapshot
  commit(mutate: (current: ControlRoomsSnapshot) => ControlRoomsSnapshot): ControlRoomsSnapshot
  now(): number
  knownProjectIds(): readonly string[]
  isSessionRunning(sessionId: string): boolean
  /** Opens the same production room path used by the UI. */
  open(controlRoomId: string): void
  /** Searches through the same production search projection used by the UI. */
  search(query: string, limit?: number): ControlRoomSearchCommandResult
  afterCopy?(sourceControlRoomId: string, newControlRoomId: string): void
  afterArchive?(controlRoomId: string, layoutId: string): void
  afterRestore?(sourceLayoutId: string, restoredControlRoomId: string): void
}

export type ControlRoomCommandBridge = {
  readonly surface: 'in-client-local-storage-fallback'
  readonly operations: readonly ControlRoomCommandAction[]
  execute(request: ControlRoomCommandRequest | unknown): ControlRoomCommandResult
}

const TARGET_ACTIONS = new Set<string>(CONTROL_ROOM_COMMAND_OPERATIONS.filter((action) =>
  action !== 'control_room.list' && action !== 'control_room.create' && action !== 'control_room.search'))

const UNSUPPORTED_DESTRUCTIVE_ACTIONS = new Set([
  'control_room.empty_trash',
  'control_room.update_many',
  'control_room.remove_project_from_all_rooms',
  'control_room.delete_project_master_data',
])

const UPDATE_KEYS = new Set([
  'name', 'icon', 'description', 'themeMode', 'cardLayout', 'filters', 'defaultPane', 'sidebarVisible',
])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

function fail(action: unknown, code: ControlRoomCommandErrorCode, message: string, confirmation?: ControlRoomCommandConfirmation): ControlRoomCommandResult {
  return {
    ok: false,
    action: typeof action === 'string' ? action : '',
    error: { code, message },
    ...(confirmation ? { confirmation } : {}),
  }
}

function success(action: ControlRoomCommandAction, changed: boolean, controlRoomId?: string, data?: unknown): ControlRoomCommandResult {
  return {
    ok: true,
    action,
    changed,
    ...(controlRoomId ? { controlRoomId } : {}),
    ...(data === undefined ? {} : { data: clone(data) }),
  }
}

function exactId(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value && value.length > 0
}

function uniqueIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => !exactId(item))) return null
  return [...new Set(value)]
}

function safeUpdatePatch(value: unknown): ControlRoomUpdatePatch | null {
  if (!isRecord(value) || Object.keys(value).length === 0 || Object.keys(value).some((key) => !UPDATE_KEYS.has(key))) return null
  return clone(value) as ControlRoomUpdatePatch
}

function safeCreateInput(value: unknown): ControlRoomCreateInput | null {
  if (value === undefined) return {}
  if (!isRecord(value)) return null
  const allowed = new Set([...UPDATE_KEYS, 'projectIds', 'projectOrder', 'fixedProjectIds', 'excludedProjectIds', 'boundSessionId', 'rules'])
  if (Object.keys(value).some((key) => !allowed.has(key))) return null
  return clone(value) as ControlRoomCreateInput
}

function validRule(value: unknown): value is ControlRoomRule {
  if (!isRecord(value) || !exactId(value.id) || (value.mode !== 'all' && value.mode !== 'any')
    || typeof value.enabled !== 'boolean' || !Array.isArray(value.conditions) || value.conditions.length === 0) return false
  return value.conditions.every((condition) => isRecord(condition) && exactId(condition.id)
    && typeof condition.field === 'string' && typeof condition.operator === 'string'
    && Object.prototype.hasOwnProperty.call(condition, 'value')
    && isControlRoomConditionCompatible(condition as unknown as ControlRoomRule['conditions'][number]))
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

function confirmationFor(
  action: ControlRoomCommandAction,
  controlRoomIds: string[],
  summary: string,
  fingerprint: unknown,
): ControlRoomCommandConfirmation {
  const serialized = JSON.stringify({ action, controlRoomIds, fingerprint })
  return {
    token: `confirm:${action}:${fnv1a(serialized)}`,
    action,
    controlRoomIds: [...controlRoomIds],
    summary,
  }
}

function confirmationMissing(request: Record<string, unknown>, confirmation: ControlRoomCommandConfirmation): ControlRoomCommandResult | null {
  return request.confirmationToken === confirmation.token
    ? null
    : fail(request.action, 'CONFIRMATION_REQUIRED', 'Replay this exact action with the returned confirmation token.', confirmation)
}

function withAudit(
  current: ControlRoomsSnapshot,
  state: ControlRoomsState,
  now: number,
  action: string,
  controlRoomId: string,
  summary: string,
  trash = current.trash,
): ControlRoomsSnapshot {
  return {
    state,
    trash: {
      ...trash,
      audit: appendControlRoomAudit(trash.audit, {
        actor: 'deepseek',
        timestamp: now,
        action,
        controlRoomId,
        summary,
      }),
    },
  }
}

function roomResult(room: ControlRoom): ControlRoom {
  return normalizeControlRoom(room, room.id)
}

/**
 * Room-only import path shared by the production UI and portable tests.
 * The function cannot receive or return project/session/global master data.
 */
export function importControlRoomsWithAudit(
  current: ControlRoomsSnapshot,
  serialized: string,
  now: number,
  actor: ControlRoomAuditActor,
): { snapshot: ControlRoomsSnapshot; idMap: Record<string, string> } {
  const imported = importControlRooms(current.state, serialized, now)
  let audit = current.trash.audit
  for (const controlRoomId of Object.values(imported.idMap)) {
    audit = appendControlRoomAudit(audit, {
      actor,
      timestamp: now,
      action: 'import',
      controlRoomId,
      summary: 'Imported control-room configuration',
    })
  }
  return {
    snapshot: { state: imported.state, trash: { ...current.trash, audit } },
    idMap: imported.idMap,
  }
}

export function createControlRoomCommandBridge(adapter: ControlRoomCommandAdapter): ControlRoomCommandBridge {
  const execute = (unknownRequest: ControlRoomCommandRequest | unknown): ControlRoomCommandResult => {
    if (!isRecord(unknownRequest) || typeof unknownRequest.action !== 'string') {
      return fail('', 'INVALID_REQUEST', 'A typed control-room command request is required.')
    }
    const request = unknownRequest
    const action = request.action
    if (UNSUPPORTED_DESTRUCTIVE_ACTIONS.has(action)) {
      return fail(action, 'UNSUPPORTED_DESTRUCTIVE_OPERATION', `${action} is intentionally unavailable from the in-client bridge.`)
    }
    if (!(CONTROL_ROOM_COMMAND_OPERATIONS as readonly string[]).includes(action)) {
      return fail(action, 'UNKNOWN_OPERATION', `Unknown control-room operation: ${action}`)
    }
    if ((TARGET_ACTIONS.has(action) || action === 'control_room.create') && !exactId(request.controlRoomId)) {
      return fail(action, 'EXACT_CONTROL_ROOM_ID_REQUIRED', 'Provide one exact controlRoomId; names and multiple IDs are not accepted.')
    }

    const typedAction = action as ControlRoomCommandAction
    const before = adapter.snapshot()
    const controlRoomId = exactId(request.controlRoomId) ? request.controlRoomId : undefined

    if (typedAction === 'control_room.list') {
      return success(typedAction, false, undefined, {
        activeId: before.state.activeId,
        rooms: before.state.order.flatMap((id) => before.state.rooms[id] ? [roomResult(before.state.rooms[id])] : []),
        archived: before.trash.deleted.map((entry) => ({
          controlRoomId: entry.room.id,
          name: entry.room.name,
          deletedAt: entry.deletedAt,
          expiresAt: entry.expiresAt,
        })),
      })
    }

    if (typedAction === 'control_room.search') {
      if (typeof request.query !== 'string' || (request.limit !== undefined && (!Number.isInteger(request.limit) || (request.limit as number) < 1))) {
        return fail(action, 'INVALID_REQUEST', 'search requires a string query and an optional positive integer limit.')
      }
      return success(typedAction, false, undefined, adapter.search(request.query, request.limit as number | undefined))
    }

    if (typedAction === 'control_room.restore') {
      const archived = before.trash.deleted.find((entry) => entry.room.id === controlRoomId)
      if (!archived) return fail(action, 'CONTROL_ROOM_NOT_FOUND', `Archived control room not found: ${controlRoomId}`)
      const now = adapter.now()
      const restored = restoreControlRoom(before.state, before.trash, controlRoomId!, now)
      const restoredId = restored.restoredId
      if (!restoredId) return fail(action, 'COMMAND_FAILED', `Control room could not be restored: ${controlRoomId}`)
      adapter.commit((current) => withAudit(current, restored.state, now, 'restore', restoredId, 'Restored archived control-room configuration', restored.trash))
      adapter.afterRestore?.(archived.room.layoutId, restoredId)
      return success(typedAction, true, restoredId, { restoredFromControlRoomId: controlRoomId })
    }

    if (typedAction === 'control_room.create') {
      if (before.state.rooms[controlRoomId!]) return fail(action, 'CONTROL_ROOM_ALREADY_EXISTS', `Control room already exists: ${controlRoomId}`)
      const input = safeCreateInput(request.room)
      if (!input) return fail(action, 'INVALID_REQUEST', 'create contains unsupported control-room fields.')
      const now = adapter.now()
      const next = adapter.commit((current) => withAudit(
        current,
        createControlRoom(current.state, input, { id: controlRoomId!, now }),
        now,
        'create',
        controlRoomId!,
        'Created control room',
      ))
      return success(typedAction, true, controlRoomId, roomResult(next.state.rooms[controlRoomId!]))
    }

    const room = before.state.rooms[controlRoomId!]
    if (!room) return fail(action, 'CONTROL_ROOM_NOT_FOUND', `Control room not found: ${controlRoomId}`)

    try {
      if (typedAction === 'control_room.get') return success(typedAction, false, controlRoomId, roomResult(room))

      if (typedAction === 'control_room.update') {
        const patch = safeUpdatePatch(request.patch)
        if (!patch) return fail(action, 'INVALID_REQUEST', 'update requires at least one supported presentation field.')
        const now = adapter.now()
        const fields = Object.keys(patch)
        const next = adapter.commit((current) => withAudit(
          current,
          updateControlRoom(current.state, controlRoomId!, patch, now),
          now,
          'update',
          controlRoomId!,
          `Updated control-room fields: ${fields.join(', ')}`,
        ))
        return success(typedAction, true, controlRoomId, roomResult(next.state.rooms[controlRoomId!]))
      }

      if (typedAction === 'control_room.copy') {
        if (!exactId(request.newControlRoomId)) return fail(action, 'EXACT_CONTROL_ROOM_ID_REQUIRED', 'copy requires one exact newControlRoomId.')
        if (before.state.rooms[request.newControlRoomId]) return fail(action, 'CONTROL_ROOM_ALREADY_EXISTS', `Control room already exists: ${request.newControlRoomId}`)
        if (request.name !== undefined && typeof request.name !== 'string') return fail(action, 'INVALID_REQUEST', 'copy name must be a string.')
        const now = adapter.now()
        const copiedId = request.newControlRoomId
        const next = adapter.commit((current) => withAudit(
          current,
          copyControlRoom(current.state, controlRoomId!, { id: copiedId, now, ...(typeof request.name === 'string' ? { name: request.name } : {}) }),
          now,
          'copy',
          copiedId,
          `Copied control room from ${controlRoomId}`,
        ))
        adapter.afterCopy?.(controlRoomId!, copiedId)
        return success(typedAction, true, copiedId, roomResult(next.state.rooms[copiedId]))
      }

      if (typedAction === 'control_room.add_projects') {
        const projectIds = uniqueIds(request.projectIds)
        if (!projectIds || projectIds.length === 0) return fail(action, 'INVALID_REQUEST', 'add_projects requires one or more exact project IDs.')
        const known = new Set(adapter.knownProjectIds())
        const missing = projectIds.find((id) => !known.has(id))
        if (missing) return fail(action, 'PROJECT_NOT_FOUND', `Project master record not found: ${missing}`)
        const added = projectIds.filter((id) => !room.projectIds.includes(id))
        if (added.length === 0) return success(typedAction, false, controlRoomId, roomResult(room))
        const now = adapter.now()
        const next = adapter.commit((current) => {
          let state = current.state
          for (const projectId of added) state = addProjectToRoom(state, controlRoomId!, projectId, now)
          return withAudit(current, state, now, 'add_projects', controlRoomId!, `Added ${added.length} project reference(s)`)
        })
        return success(typedAction, true, controlRoomId, roomResult(next.state.rooms[controlRoomId!]))
      }

      if (typedAction === 'control_room.remove_projects') {
        const requestedIds = uniqueIds(request.projectIds)
        if (!requestedIds || requestedIds.length === 0) return fail(action, 'INVALID_REQUEST', 'remove_projects requires one or more exact project IDs.')
        const removed = requestedIds.filter((id) => room.projectIds.includes(id) || room.fixedProjectIds.includes(id) || room.excludedProjectIds.includes(id))
        if (removed.length === 0) return success(typedAction, false, controlRoomId, roomResult(room))
        if (removed.length >= 5) {
          const confirmation = confirmationFor(typedAction, [controlRoomId!], `Remove ${removed.length} project references from ${controlRoomId}`, {
            updatedAt: room.updatedAt,
            projectIds: removed,
          })
          const blocked = confirmationMissing(request, confirmation)
          if (blocked) return blocked
        }
        const now = adapter.now()
        const next = adapter.commit((current) => {
          let state = current.state
          for (const projectId of removed) state = removeProjectFromRoom(state, controlRoomId!, projectId, now)
          return withAudit(current, state, now, 'remove_projects', controlRoomId!, `Removed ${removed.length} project reference(s)`)
        })
        return success(typedAction, true, controlRoomId, roomResult(next.state.rooms[controlRoomId!]))
      }

      if (typedAction === 'control_room.reorder_projects') {
        const projectIds = uniqueIds(request.projectIds)
        if (!projectIds) return fail(action, 'INVALID_REQUEST', 'reorder_projects requires an array of exact project IDs.')
        const now = adapter.now()
        const next = adapter.commit((current) => withAudit(
          current,
          reorderProjectsInRoom(current.state, controlRoomId!, projectIds, now),
          now,
          'reorder_projects',
          controlRoomId!,
          `Reordered ${projectIds.length} project reference(s)`,
        ))
        return success(typedAction, true, controlRoomId, roomResult(next.state.rooms[controlRoomId!]))
      }

      if (typedAction === 'control_room.set_rule') {
        if (request.mode === 'replace_all') {
          if (!Array.isArray(request.rules) || request.rules.some((rule) => !validRule(rule))) return fail(action, 'INVALID_RULE', 'replace_all requires valid control-room rules.')
          const confirmation = confirmationFor(typedAction, [controlRoomId!], `Replace all rules in ${controlRoomId}`, {
            updatedAt: room.updatedAt,
            rules: request.rules,
          })
          const blocked = confirmationMissing(request, confirmation)
          if (blocked) return blocked
          const now = adapter.now()
          const next = adapter.commit((current) => withAudit(
            current,
            updateControlRoom(current.state, controlRoomId!, { rules: clone(request.rules) as ControlRoomRule[] }, now),
            now,
            'set_rule',
            controlRoomId!,
            `Replaced all rules (${request.rules.length})`,
          ))
          return success(typedAction, true, controlRoomId, roomResult(next.state.rooms[controlRoomId!]))
        }
        if (request.mode === 'remove') {
          if (!exactId(request.ruleId)) return fail(action, 'INVALID_RULE', 'remove requires one exact ruleId.')
          if (!room.rules.some((rule) => rule.id === request.ruleId)) return fail(action, 'INVALID_RULE', `Rule not found: ${request.ruleId}`)
          const now = adapter.now()
          const rules = room.rules.filter((rule) => rule.id !== request.ruleId)
          const next = adapter.commit((current) => withAudit(
            current,
            updateControlRoom(current.state, controlRoomId!, { rules }, now),
            now,
            'set_rule',
            controlRoomId!,
            `Removed rule ${request.ruleId}`,
          ))
          return success(typedAction, true, controlRoomId, roomResult(next.state.rooms[controlRoomId!]))
        }
        if (request.mode === 'upsert') {
          if (!validRule(request.rule)) return fail(action, 'INVALID_RULE', 'upsert requires one valid rule.')
          const exists = room.rules.some((rule) => rule.id === request.rule.id)
          const rules = exists
            ? room.rules.map((rule) => rule.id === request.rule.id ? clone(request.rule) as ControlRoomRule : rule)
            : [...room.rules, clone(request.rule) as ControlRoomRule]
          const now = adapter.now()
          const next = adapter.commit((current) => withAudit(
            current,
            updateControlRoom(current.state, controlRoomId!, { rules }, now),
            now,
            'set_rule',
            controlRoomId!,
            `${exists ? 'Updated' : 'Added'} rule ${request.rule.id}`,
          ))
          return success(typedAction, true, controlRoomId, roomResult(next.state.rooms[controlRoomId!]))
        }
        return fail(action, 'INVALID_RULE', 'set_rule mode must be upsert, remove, or replace_all.')
      }

      if (typedAction === 'control_room.bind_session') {
        if (request.sessionId !== null && !exactId(request.sessionId)) return fail(action, 'INVALID_REQUEST', 'sessionId must be one exact ID or null.')
        if (request.sessionId === room.boundSessionId) return success(typedAction, false, controlRoomId, roomResult(room))
        if (request.sessionId === null && room.boundSessionId && adapter.isSessionRunning(room.boundSessionId)) {
          const confirmation = confirmationFor(typedAction, [controlRoomId!], `Unbind running management session ${room.boundSessionId}`, {
            updatedAt: room.updatedAt,
            boundSessionId: room.boundSessionId,
          })
          const blocked = confirmationMissing(request, confirmation)
          if (blocked) return blocked
        }
        const now = adapter.now()
        const next = adapter.commit((current) => withAudit(
          current,
          updateControlRoom(current.state, controlRoomId!, { boundSessionId: request.sessionId as string | null }, now),
          now,
          'bind_session',
          controlRoomId!,
          request.sessionId ? `Bound management session ${request.sessionId}` : 'Unbound management session',
        ))
        return success(typedAction, true, controlRoomId, roomResult(next.state.rooms[controlRoomId!]))
      }

      if (typedAction === 'control_room.open') {
        adapter.open(controlRoomId!)
        const now = adapter.now()
        adapter.commit((current) => withAudit(current, current.state, now, 'open', controlRoomId!, 'Opened control room'))
        return success(typedAction, true, controlRoomId, roomResult(adapter.snapshot().state.rooms[controlRoomId!]))
      }

      if (typedAction === 'control_room.archive') {
        const confirmation = confirmationFor(typedAction, [controlRoomId!], `Archive ${controlRoomId}; only its reversible room configuration moves to Trash`, {
          updatedAt: room.updatedAt,
          projectIds: room.projectIds,
          boundSessionId: room.boundSessionId,
        })
        const blocked = confirmationMissing(request, confirmation)
        if (blocked) return blocked
        const now = adapter.now()
        adapter.commit((current) => {
          const archived = deleteControlRoom(current.state, current.trash, controlRoomId!, now)
          return withAudit(
            current,
            archived.state,
            now,
            'archive',
            controlRoomId!,
            'Archived control-room configuration; project, file, and session data were not deleted',
            archived.trash,
          )
        })
        adapter.afterArchive?.(controlRoomId!, room.layoutId)
        return success(typedAction, true, controlRoomId, {
          reversible: true,
          deletesProjectMasterData: false,
          deletesFiles: false,
          deletesSessions: false,
        })
      }
    } catch (error) {
      return fail(action, 'COMMAND_FAILED', error instanceof Error ? error.message : String(error))
    }

    return fail(action, 'UNKNOWN_OPERATION', `Unknown control-room operation: ${action}`)
  }

  return {
    surface: 'in-client-local-storage-fallback',
    operations: CONTROL_ROOM_COMMAND_OPERATIONS,
    execute,
  }
}
