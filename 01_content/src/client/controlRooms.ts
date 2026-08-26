export const CONTROL_ROOMS_KEY = 'dsh.worktable.controlRooms.v1'
export const CONTROL_ROOMS_TRASH_KEY = 'dsh.worktable.controlRooms.trash.v1'
export const CONTROL_ROOMS_MIGRATION_BACKUP_KEY = 'dsh.worktable.controlRooms.migrationBackup.v1'
export const LEGACY_PROJECTS_KEY = 'dsh.worktable.projects.v1'
export const LEGACY_VIEW_KEY = 'dsh.worktable.view.v1'
export const CONTROL_ROOMS_EXPORT_FORMAT = 'dsh-control-rooms-v1.json'
export const CONTROL_ROOMS_VERSION = 1 as const
export const CONTROL_ROOM_TRASH_TTL_MS = 30 * 24 * 60 * 60 * 1000
export const CONTROL_ROOM_AUDIT_LIMIT = 100

export type ControlRoomStatus = 'idle' | 'busy' | 'need' | 'done'
export type ControlRoomThemeMode = 'dark' | 'light' | 'system'
export type ControlRoomDefaultPane = 'console' | 'conversation' | 'files' | 'terminal'
export type ControlRoomCardSize = 'compact' | 'comfortable' | 'wide'
export type ControlRoomCardColumns = 1 | 2 | 3 | 4

export type ControlRoomCardLayout = {
  columns: ControlRoomCardColumns
  cardSize: ControlRoomCardSize
}

export type ControlRoomFilters = {
  statuses: ControlRoomStatus[]
  showHidden: boolean
  showArchived: boolean
}

export type ControlRoomConditionField =
  | 'status'
  | 'name'
  | 'icon'
  | 'tag'
  | 'workspace'
  | 'hasBoundSession'
  | 'subagentCount'
  | 'lastActiveAt'
  | 'lastCompletedAt'
  | 'hidden'
  | 'archived'

export type ControlRoomConditionOperator =
  | 'equals'
  | 'notEquals'
  | 'contains'
  | 'notContains'
  | 'in'
  | 'notIn'
  | 'greaterThanOrEqual'
  | 'lessThanOrEqual'
  | 'before'
  | 'after'

export type ControlRoomConditionValue = string | number | boolean | string[]

export type ControlRoomCondition = {
  id: string
  field: ControlRoomConditionField
  operator: ControlRoomConditionOperator
  value: ControlRoomConditionValue
  /** A matching excluded condition makes the rule fail. */
  exclude?: boolean
}

export type ControlRoomRule = {
  id: string
  /** Optional for backward compatibility with rooms saved before rule names existed. */
  name?: string
  enabled: boolean
  mode: 'all' | 'any'
  conditions: ControlRoomCondition[]
}

export type ControlRoom = {
  id: string
  name: string
  icon: string
  description: string
  /** Project master data never lives here; these are references only. */
  projectIds: string[]
  projectOrder: string[]
  fixedProjectIds: string[]
  excludedProjectIds: string[]
  boundSessionId: string | null
  rules: ControlRoomRule[]
  layoutId: string
  themeMode: ControlRoomThemeMode
  cardLayout: ControlRoomCardLayout
  filters: ControlRoomFilters
  defaultPane: ControlRoomDefaultPane
  sidebarVisible: boolean
  createdAt: number
  updatedAt: number
  lastOpenedAt: number
  deletedAt: number | null
}

export type ControlRoomsState = {
  version: 1
  order: string[]
  activeId: string | null
  rooms: Record<string, ControlRoom>
}

export type DeletedControlRoom = {
  room: ControlRoom
  deletedAt: number
  expiresAt: number
}

export type ControlRoomAuditActor = 'user' | 'deepseek'

export type ControlRoomAuditEntry = {
  actor: ControlRoomAuditActor
  timestamp: number
  action: string
  controlRoomId: string
  summary: string
}

export type ControlRoomsTrashState = {
  version: 1
  deleted: DeletedControlRoom[]
  audit: ControlRoomAuditEntry[]
}

export type LegacyControlRoomMigrationInput = {
  /** The currently known project references, supplied by the React integration. */
  projectIds: string[]
  projectOrder?: string[]
  boundSessionId?: string | null
  /** The old view reference is intentionally not copied into this module. */
  layoutId?: string
  themeMode?: ControlRoomThemeMode
  rawProjects: string | null
  rawView: string | null
}

export type ControlRoomsMigrationBackup = {
  version: 1
  createdAt: number
  rawProjects: string | null
  rawView: string | null
  legacy: {
    projectIds: string[]
    projectOrder: string[]
    boundSessionId: string | null
    layoutId: string
    themeMode: ControlRoomThemeMode
  }
}

export type ControlRoomsExport = {
  format: typeof CONTROL_ROOMS_EXPORT_FORMAT
  version: 1
  exportedAt: number
  state: ControlRoomsState
}

export type StorageCompatible = Pick<Storage, 'getItem' | 'setItem'> & Partial<Pick<Storage, 'removeItem'>>

export type ControlRoomCreateInput = Partial<Omit<ControlRoom, 'id' | 'createdAt' | 'updatedAt' | 'lastOpenedAt' | 'deletedAt'>> & {
  id?: string
}

export type ControlRoomsLoadResult = {
  state: ControlRoomsState
  trash: ControlRoomsTrashState
  migrated: boolean
  /** Non-version storage failures keep this usable in-memory snapshot visible to the UI. */
  persistenceError: unknown | null
}

export class UnknownControlRoomsVersionError extends Error {
  readonly version: unknown

  constructor(version: unknown) {
    super(`Unsupported control-room storage version: ${String(version)}`)
    this.name = 'UnknownControlRoomsVersionError'
    this.version = version
  }
}

export class ControlRoomsPersistenceError extends Error {
  readonly writeError: unknown
  readonly rollbackErrors: unknown[]

  constructor(operation: string, writeError: unknown, rollbackErrors: unknown[] = []) {
    const detail = writeError instanceof Error ? writeError.message : String(writeError)
    const rollback = rollbackErrors.length > 0 ? `; ${rollbackErrors.length} rollback operation(s) also failed` : ''
    super(`${operation} failed: ${detail}${rollback}`)
    this.name = 'ControlRoomsPersistenceError'
    this.writeError = writeError
    this.rollbackErrors = rollbackErrors
  }
}

const EMPTY_FILTERS: ControlRoomFilters = {
  statuses: ['idle', 'busy', 'need', 'done'],
  showHidden: false,
  showArchived: false,
}

const DEFAULT_CARD_LAYOUT: ControlRoomCardLayout = { columns: 2, cardSize: 'comfortable' }

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

const uniqueStrings = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of value) {
    if (typeof item === 'string' && item && !seen.has(item)) {
      seen.add(item)
      result.push(item)
    }
  }
  return result
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const normalizedTheme = (value: unknown): ControlRoomThemeMode =>
  value === 'dark' || value === 'light' || value === 'system' ? value : 'system'

const normalizedPane = (value: unknown): ControlRoomDefaultPane =>
  value === 'conversation' || value === 'files' || value === 'terminal' || value === 'console' ? value : 'console'

const normalizedStatus = (value: unknown): value is ControlRoomStatus =>
  value === 'idle' || value === 'busy' || value === 'need' || value === 'done'

const BOOLEAN_FIELDS: ControlRoomConditionField[] = ['hasBoundSession', 'hidden', 'archived']
const NUMBER_FIELDS: ControlRoomConditionField[] = ['subagentCount']
const TIME_FIELDS: ControlRoomConditionField[] = ['lastActiveAt', 'lastCompletedAt']
const BOOLEAN_OPERATORS: ControlRoomConditionOperator[] = ['equals', 'notEquals']
const NUMBER_OPERATORS: ControlRoomConditionOperator[] = ['equals', 'notEquals', 'greaterThanOrEqual', 'lessThanOrEqual']
const TIME_OPERATORS: ControlRoomConditionOperator[] = ['before', 'after', 'greaterThanOrEqual', 'lessThanOrEqual']
const TEXT_OPERATORS: ControlRoomConditionOperator[] = ['equals', 'notEquals', 'contains', 'notContains', 'in', 'notIn']
const CONDITION_FIELDS: ControlRoomConditionField[] = [
  'status', 'name', 'icon', 'tag', 'workspace', 'hasBoundSession', 'subagentCount',
  'lastActiveAt', 'lastCompletedAt', 'hidden', 'archived',
]
const CONDITION_STATUSES: ControlRoomStatus[] = ['idle', 'busy', 'need', 'done']

export function isControlRoomConditionCompatible(condition: Pick<ControlRoomCondition, 'field' | 'operator' | 'value'>): boolean {
  if (!CONDITION_FIELDS.includes(condition.field)) return false
  if (BOOLEAN_FIELDS.includes(condition.field)) {
    return typeof condition.value === 'boolean' && BOOLEAN_OPERATORS.includes(condition.operator)
  }
  if (NUMBER_FIELDS.includes(condition.field)) {
    return typeof condition.value === 'number' && Number.isFinite(condition.value) && NUMBER_OPERATORS.includes(condition.operator)
  }
  if (TIME_FIELDS.includes(condition.field)) {
    return typeof condition.value === 'number' && Number.isFinite(condition.value) && TIME_OPERATORS.includes(condition.operator)
  }
  if (!TEXT_OPERATORS.includes(condition.operator)) return false
  if (condition.field === 'status') {
    if (condition.operator === 'in' || condition.operator === 'notIn') {
      return Array.isArray(condition.value)
        && condition.value.length > 0
        && condition.value.every((value) => CONDITION_STATUSES.includes(value as ControlRoomStatus))
    }
    return typeof condition.value === 'string' && CONDITION_STATUSES.includes(condition.value as ControlRoomStatus)
  }
  if (condition.operator === 'in' || condition.operator === 'notIn') {
    return Array.isArray(condition.value)
  }
  return typeof condition.value === 'string'
}

function normalizeCondition(value: unknown, index: number): ControlRoomCondition | null {
  if (!isRecord(value)) return null
  const operators: ControlRoomConditionOperator[] = [
    'equals', 'notEquals', 'contains', 'notContains', 'in', 'notIn',
    'greaterThanOrEqual', 'lessThanOrEqual', 'before', 'after',
  ]
  if (!CONDITION_FIELDS.includes(value.field as ControlRoomConditionField)) return null
  if (!operators.includes(value.operator as ControlRoomConditionOperator)) return null
  const rawValue = value.value
  const validValue = typeof rawValue === 'string' || typeof rawValue === 'number' || typeof rawValue === 'boolean'
    || (Array.isArray(rawValue) && rawValue.every((item) => typeof item === 'string'))
  if (!validValue) return null
  const condition: ControlRoomCondition = {
    id: typeof value.id === 'string' && value.id ? value.id : `condition-${index + 1}`,
    field: value.field as ControlRoomConditionField,
    operator: value.operator as ControlRoomConditionOperator,
    value: clone(rawValue as ControlRoomConditionValue),
    ...(value.exclude === true ? { exclude: true } : {}),
  }
  return isControlRoomConditionCompatible(condition) ? condition : null
}

function normalizeRule(value: unknown, index: number): ControlRoomRule | null {
  if (!isRecord(value)) return null
  const rawConditions = Array.isArray(value.conditions) ? value.conditions : []
  const conditions = rawConditions
    .map((condition, conditionIndex) => normalizeCondition(condition, conditionIndex))
    .filter((condition): condition is ControlRoomCondition => !!condition)
  return {
    id: typeof value.id === 'string' && value.id ? value.id : `rule-${index + 1}`,
    ...(typeof value.name === 'string' && value.name.trim() ? { name: value.name.trim() } : {}),
    enabled: value.enabled !== false
      && (value.mode === 'all' || value.mode === 'any')
      && conditions.length > 0
      && conditions.length === rawConditions.length,
    mode: value.mode === 'any' ? 'any' : 'all',
    conditions,
  }
}

export function createEmptyControlRoomsState(): ControlRoomsState {
  return { version: CONTROL_ROOMS_VERSION, order: [], activeId: null, rooms: {} }
}

export function createEmptyControlRoomsTrashState(): ControlRoomsTrashState {
  return { version: CONTROL_ROOMS_VERSION, deleted: [], audit: [] }
}

export function normalizeControlRoom(value: unknown, fallbackId = 'room'): ControlRoom {
  const room = isRecord(value) ? value : {}
  const id = typeof room.id === 'string' && room.id ? room.id : fallbackId
  const createdAt = typeof room.createdAt === 'number' && Number.isFinite(room.createdAt) ? room.createdAt : 0
  const updatedAt = typeof room.updatedAt === 'number' && Number.isFinite(room.updatedAt) ? room.updatedAt : createdAt
  const projectIds = uniqueStrings(room.projectIds)
  const fixedProjectIds = uniqueStrings(room.fixedProjectIds)
  const excludedProjectIds = uniqueStrings(room.excludedProjectIds)
  const orderable = new Set([...projectIds, ...fixedProjectIds])
  const projectOrder = uniqueStrings(room.projectOrder).filter((projectId) => orderable.has(projectId))
  for (const projectId of [...projectIds, ...fixedProjectIds]) {
    if (!projectOrder.includes(projectId)) projectOrder.push(projectId)
  }
  const rawRules = Array.isArray(room.rules) ? room.rules : []
  const rules = rawRules
    .map((rule, index) => normalizeRule(rule, index))
    .filter((rule): rule is ControlRoomRule => !!rule)
  const rawCardLayout = isRecord(room.cardLayout) ? room.cardLayout : {}
  const columns = rawCardLayout.columns === 1 || rawCardLayout.columns === 2 || rawCardLayout.columns === 3 || rawCardLayout.columns === 4
    ? rawCardLayout.columns
    : DEFAULT_CARD_LAYOUT.columns
  const cardSize = rawCardLayout.cardSize === 'compact' || rawCardLayout.cardSize === 'comfortable' || rawCardLayout.cardSize === 'wide'
    ? rawCardLayout.cardSize
    : DEFAULT_CARD_LAYOUT.cardSize
  const rawFilters = isRecord(room.filters) ? room.filters : {}
  const statuses = uniqueStrings(rawFilters.statuses).filter(normalizedStatus)
  return {
    id,
    name: typeof room.name === 'string' && room.name.trim() ? room.name : '新控制室',
    icon: typeof room.icon === 'string' && room.icon ? room.icon : '🖥️',
    description: typeof room.description === 'string' ? room.description : '',
    projectIds,
    projectOrder,
    fixedProjectIds,
    excludedProjectIds,
    boundSessionId: typeof room.boundSessionId === 'string' && room.boundSessionId ? room.boundSessionId : null,
    rules,
    layoutId: `wt-console:${id}`,
    themeMode: normalizedTheme(room.themeMode),
    cardLayout: { columns, cardSize },
    filters: {
      statuses: statuses.length ? statuses : [...EMPTY_FILTERS.statuses],
      showHidden: rawFilters.showHidden === true,
      showArchived: rawFilters.showArchived === true,
    },
    defaultPane: normalizedPane(room.defaultPane),
    sidebarVisible: room.sidebarVisible !== false,
    createdAt,
    updatedAt,
    lastOpenedAt: typeof room.lastOpenedAt === 'number' && Number.isFinite(room.lastOpenedAt) ? room.lastOpenedAt : createdAt,
    deletedAt: typeof room.deletedAt === 'number' && Number.isFinite(room.deletedAt) ? room.deletedAt : null,
  }
}

export function normalizeControlRoomsState(value: unknown): ControlRoomsState {
  if (!isRecord(value)) return createEmptyControlRoomsState()
  if (value.version !== CONTROL_ROOMS_VERSION) throw new UnknownControlRoomsVersionError(value.version)
  const rawRooms = isRecord(value.rooms) ? value.rooms : {}
  const rooms: Record<string, ControlRoom> = {}
  for (const [key, rawRoom] of Object.entries(rawRooms)) {
    const room = normalizeControlRoom(rawRoom, key)
    rooms[key] = room.id === key ? room : { ...room, id: key, layoutId: room.layoutId === `wt-console:${room.id}` ? `wt-console:${key}` : room.layoutId }
  }
  const order = uniqueStrings(value.order).filter((id) => !!rooms[id])
  for (const id of Object.keys(rooms)) if (!order.includes(id)) order.push(id)
  const activeId = typeof value.activeId === 'string' && rooms[value.activeId] ? value.activeId : null
  return { version: CONTROL_ROOMS_VERSION, order, activeId, rooms }
}

export function normalizeControlRoomsTrashState(value: unknown): ControlRoomsTrashState {
  if (!isRecord(value)) return createEmptyControlRoomsTrashState()
  if (value.version !== CONTROL_ROOMS_VERSION) throw new UnknownControlRoomsVersionError(value.version)
  const deleted = (Array.isArray(value.deleted) ? value.deleted : []).flatMap((item): DeletedControlRoom[] => {
    if (!isRecord(item) || typeof item.deletedAt !== 'number' || typeof item.expiresAt !== 'number') return []
    return [{ room: normalizeControlRoom(item.room), deletedAt: item.deletedAt, expiresAt: item.expiresAt }]
  })
  const audit = (Array.isArray(value.audit) ? value.audit : []).flatMap((item): ControlRoomAuditEntry[] => {
    if (!isRecord(item) || (item.actor !== 'user' && item.actor !== 'deepseek') || typeof item.timestamp !== 'number'
      || typeof item.action !== 'string' || typeof item.controlRoomId !== 'string' || typeof item.summary !== 'string') return []
    return [{
      actor: item.actor,
      timestamp: item.timestamp,
      action: item.action,
      controlRoomId: item.controlRoomId,
      summary: item.summary,
    }]
  }).slice(-CONTROL_ROOM_AUDIT_LIMIT)
  return { version: CONTROL_ROOMS_VERSION, deleted, audit }
}

function roomFromInput(input: ControlRoomCreateInput, id: string, now: number): ControlRoom {
  return normalizeControlRoom({
    name: '新控制室',
    icon: '🖥️',
    description: '',
    projectIds: [],
    projectOrder: [],
    fixedProjectIds: [],
    excludedProjectIds: [],
    boundSessionId: null,
    rules: [],
    layoutId: `wt-console:${id}`,
    themeMode: 'system',
    cardLayout: DEFAULT_CARD_LAYOUT,
    filters: EMPTY_FILTERS,
    defaultPane: 'console',
    sidebarVisible: true,
    ...input,
    id,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
    deletedAt: null,
  }, id)
}

function nextControlRoomRevision(room: Pick<ControlRoom, 'updatedAt'>, now: number): number {
  return Math.max(now, room.updatedAt + 1)
}

export function createControlRoom(
  state: ControlRoomsState,
  input: ControlRoomCreateInput,
  options: { id?: string; now: number },
): ControlRoomsState {
  const normalized = normalizeControlRoomsState(state)
  const id = options.id || input.id
  if (!id) throw new Error('A deterministic control-room id is required')
  if (normalized.rooms[id]) throw new Error(`Control room already exists: ${id}`)
  const room = roomFromInput(input, id, options.now)
  return {
    ...normalized,
    order: [...normalized.order, id],
    activeId: normalized.activeId ?? id,
    rooms: { ...normalized.rooms, [id]: room },
  }
}

export function updateControlRoom(
  state: ControlRoomsState,
  roomId: string,
  patch: Partial<Omit<ControlRoom, 'id' | 'createdAt' | 'deletedAt'>>,
  now: number,
): ControlRoomsState {
  const normalized = normalizeControlRoomsState(state)
  const current = normalized.rooms[roomId]
  if (!current) return normalized
  const room = normalizeControlRoom({
    ...current,
    ...patch,
    id: roomId,
    createdAt: current.createdAt,
    updatedAt: nextControlRoomRevision(current, now),
    deletedAt: null,
  }, roomId)
  return { ...normalized, rooms: { ...normalized.rooms, [roomId]: room } }
}

/** Select a room and record its recency without changing project/session master data. */
export function selectControlRoom(state: ControlRoomsState, roomId: string, now: number): ControlRoomsState {
  const normalized = normalizeControlRoomsState(state)
  const room = normalized.rooms[roomId]
  if (!room) return normalized
  const selected = updateControlRoom(normalized, roomId, { lastOpenedAt: now }, now)
  return { ...selected, activeId: roomId }
}

export type ControlRoomNavigation = {
  primaryIds: string[]
  moreIds: string[]
}

/**
 * Keep small room sets fully visible. Large sets show the six most recently
 * opened rooms, plus any current/need rooms that would otherwise disappear.
 */
export function selectControlRoomNavigation(
  state: ControlRoomsState,
  needRoomIds: ReadonlySet<string>,
): ControlRoomNavigation {
  const normalized = normalizeControlRoomsState(state)
  const visibleIds = normalized.order.filter((id) => normalized.rooms[id]?.sidebarVisible !== false)
  if (normalized.order.length <= 8) return { primaryIds: visibleIds, moreIds: [] }

  const orderIndex = new Map(normalized.order.map((id, index) => [id, index]))
  const recentIds = [...visibleIds]
    .sort((a, b) => {
      const recency = normalized.rooms[b].lastOpenedAt - normalized.rooms[a].lastOpenedAt
      return recency || (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0)
    })
    .slice(0, 6)
  const primary = new Set(recentIds)
  if (normalized.activeId && normalized.rooms[normalized.activeId]) primary.add(normalized.activeId)
  for (const id of needRoomIds) if (normalized.rooms[id]) primary.add(id)
  const requiredIds = normalized.order.filter((id) => primary.has(id) && !recentIds.includes(id))
  return {
    primaryIds: [...recentIds, ...requiredIds],
    moreIds: visibleIds.filter((id) => !primary.has(id)),
  }
}

export function copyControlRoom(
  state: ControlRoomsState,
  sourceId: string,
  options: { id: string; now: number; name?: string },
): ControlRoomsState {
  const source = normalizeControlRoomsState(state).rooms[sourceId]
  if (!source) return normalizeControlRoomsState(state)
  const { createdAt: _createdAt, updatedAt: _updatedAt, lastOpenedAt: _lastOpenedAt, deletedAt: _deletedAt, ...copyable } = clone(source)
  return createControlRoom(state, {
    ...copyable,
    id: options.id,
    name: options.name ?? `${source.name} 副本`,
    boundSessionId: null,
    layoutId: `wt-console:${options.id}`,
  }, options)
}

export function deleteControlRoom(
  state: ControlRoomsState,
  trash: ControlRoomsTrashState,
  roomId: string,
  now: number,
): { state: ControlRoomsState; trash: ControlRoomsTrashState; deleted: DeletedControlRoom | null } {
  const normalized = normalizeControlRoomsState(state)
  const room = normalized.rooms[roomId]
  if (!room) return { state: normalized, trash: normalizeControlRoomsTrashState(trash), deleted: null }
  const deleted: DeletedControlRoom = {
    room: { ...clone(room), deletedAt: now, updatedAt: nextControlRoomRevision(room, now) },
    deletedAt: now,
    expiresAt: now + CONTROL_ROOM_TRASH_TTL_MS,
  }
  const rooms = { ...normalized.rooms }
  delete rooms[roomId]
  const order = normalized.order.filter((id) => id !== roomId)
  return {
    state: { ...normalized, rooms, order, activeId: normalized.activeId === roomId ? (order[0] ?? null) : normalized.activeId },
    trash: {
      ...normalizeControlRoomsTrashState(trash),
      deleted: [...normalizeControlRoomsTrashState(trash).deleted.filter((item) => item.room.id !== roomId), deleted],
    },
    deleted,
  }
}

function collisionId(baseId: string, occupied: Set<string>): string {
  let suffix = 2
  let candidate = `${baseId}-${suffix}`
  while (occupied.has(candidate)) candidate = `${baseId}-${++suffix}`
  return candidate
}

export function restoreControlRoom(
  state: ControlRoomsState,
  trash: ControlRoomsTrashState,
  roomId: string,
  now: number,
): { state: ControlRoomsState; trash: ControlRoomsTrashState; restoredId: string | null } {
  const normalized = normalizeControlRoomsState(state)
  const normalizedTrash = normalizeControlRoomsTrashState(trash)
  const entry = normalizedTrash.deleted.find((item) => item.room.id === roomId)
  if (!entry || entry.expiresAt <= now) return { state: normalized, trash: expireDeletedControlRooms(normalizedTrash, now), restoredId: null }
  const occupied = new Set(Object.keys(normalized.rooms))
  const restoredId = occupied.has(roomId) ? collisionId(roomId, occupied) : roomId
  const room = normalizeControlRoom({
    ...clone(entry.room),
    id: restoredId,
    layoutId: restoredId === roomId ? entry.room.layoutId : `wt-console:${restoredId}`,
    deletedAt: null,
    updatedAt: nextControlRoomRevision(entry.room, now),
  }, restoredId)
  return {
    state: {
      ...normalized,
      order: [...normalized.order, restoredId],
      activeId: normalized.activeId ?? restoredId,
      rooms: { ...normalized.rooms, [restoredId]: room },
    },
    trash: { ...normalizedTrash, deleted: normalizedTrash.deleted.filter((item) => item !== entry && item.room.id !== roomId) },
    restoredId,
  }
}

export function expireDeletedControlRooms(trash: ControlRoomsTrashState, now: number): ControlRoomsTrashState {
  const normalized = normalizeControlRoomsTrashState(trash)
  return { ...normalized, deleted: normalized.deleted.filter((entry) => entry.expiresAt > now) }
}

export function addProjectToRoom(state: ControlRoomsState, roomId: string, projectId: string, now: number): ControlRoomsState {
  const room = normalizeControlRoomsState(state).rooms[roomId]
  if (!room || !projectId || room.projectIds.includes(projectId)) return normalizeControlRoomsState(state)
  return updateControlRoom(state, roomId, {
    projectIds: [...room.projectIds, projectId],
    projectOrder: room.projectOrder.includes(projectId) ? room.projectOrder : [...room.projectOrder, projectId],
  }, now)
}

export function removeProjectFromRoom(state: ControlRoomsState, roomId: string, projectId: string, now: number): ControlRoomsState {
  const room = normalizeControlRoomsState(state).rooms[roomId]
  if (!room) return normalizeControlRoomsState(state)
  return updateControlRoom(state, roomId, {
    projectIds: room.projectIds.filter((id) => id !== projectId),
    projectOrder: room.projectOrder.filter((id) => id !== projectId),
    fixedProjectIds: room.fixedProjectIds.filter((id) => id !== projectId),
    excludedProjectIds: room.excludedProjectIds.filter((id) => id !== projectId),
  }, now)
}

export function reorderProjectsInRoom(state: ControlRoomsState, roomId: string, requestedOrder: string[], now: number): ControlRoomsState {
  const room = normalizeControlRoomsState(state).rooms[roomId]
  if (!room) return normalizeControlRoomsState(state)
  const available = new Set([...room.projectIds, ...room.fixedProjectIds])
  const order = uniqueStrings(requestedOrder).filter((id) => available.has(id))
  for (const id of room.projectOrder) if (available.has(id) && !order.includes(id)) order.push(id)
  return updateControlRoom(state, roomId, { projectOrder: order }, now)
}

export function setProjectFixed(state: ControlRoomsState, roomId: string, projectId: string, fixed: boolean, now: number): ControlRoomsState {
  const room = normalizeControlRoomsState(state).rooms[roomId]
  if (!room || !projectId) return normalizeControlRoomsState(state)
  const fixedProjectIds = fixed
    ? uniqueStrings([...room.fixedProjectIds, projectId])
    : room.fixedProjectIds.filter((id) => id !== projectId)
  const projectOrder = fixed && !room.projectOrder.includes(projectId) ? [...room.projectOrder, projectId] : room.projectOrder
  return updateControlRoom(state, roomId, { fixedProjectIds, projectOrder }, now)
}

export function setProjectExcluded(state: ControlRoomsState, roomId: string, projectId: string, excluded: boolean, now: number): ControlRoomsState {
  const room = normalizeControlRoomsState(state).rooms[roomId]
  if (!room || !projectId) return normalizeControlRoomsState(state)
  const excludedProjectIds = excluded
    ? uniqueStrings([...room.excludedProjectIds, projectId])
    : room.excludedProjectIds.filter((id) => id !== projectId)
  return updateControlRoom(state, roomId, { excludedProjectIds }, now)
}

export function appendControlRoomAudit(
  audit: ControlRoomAuditEntry[],
  entry: ControlRoomAuditEntry,
): ControlRoomAuditEntry[] {
  return [...audit, clone(entry)].slice(-CONTROL_ROOM_AUDIT_LIMIT)
}

/** Merge room summaries without allowing an older tab to replace newer room data. */
export function mergeControlRoomSummaries(local: ControlRoomsState, incoming: ControlRoomsState): ControlRoomsState {
  const left = normalizeControlRoomsState(local)
  const right = normalizeControlRoomsState(incoming)
  const rooms: Record<string, ControlRoom> = { ...left.rooms }
  for (const [id, room] of Object.entries(right.rooms)) {
    const current = rooms[id]
    if (!current || room.updatedAt > current.updatedAt) rooms[id] = clone(room)
  }
  const order = uniqueStrings([...right.order, ...left.order]).filter((id) => !!rooms[id])
  const activeCandidate = right.activeId && rooms[right.activeId] ? right.activeId : left.activeId
  return { version: CONTROL_ROOMS_VERSION, order, activeId: activeCandidate && rooms[activeCandidate] ? activeCandidate : null, rooms }
}

function tombstoneTimestamp(entry: DeletedControlRoom): number {
  return Math.max(entry.deletedAt, entry.room.updatedAt)
}

export function mergeControlRoomsTrash(
  local: ControlRoomsTrashState,
  incoming: ControlRoomsTrashState,
): ControlRoomsTrashState {
  const left = normalizeControlRoomsTrashState(local)
  const right = normalizeControlRoomsTrashState(incoming)
  const byRoomId = new Map<string, DeletedControlRoom>()
  for (const entry of [...left.deleted, ...right.deleted]) {
    const current = byRoomId.get(entry.room.id)
    if (!current || tombstoneTimestamp(entry) > tombstoneTimestamp(current)) byRoomId.set(entry.room.id, clone(entry))
  }
  const seenAudit = new Set<string>()
  const audit = [...left.audit, ...right.audit].filter((entry) => {
    const key = `${entry.actor}\u0000${entry.timestamp}\u0000${entry.action}\u0000${entry.controlRoomId}\u0000${entry.summary}`
    if (seenAudit.has(key)) return false
    seenAudit.add(key)
    return true
  }).slice(-CONTROL_ROOM_AUDIT_LIMIT)
  return { version: CONTROL_ROOMS_VERSION, deleted: [...byRoomId.values()], audit }
}

export function resolveControlRoomStorageEvent(
  local: ControlRoomsState,
  incoming: ControlRoomsState,
  openRoomId: string | null,
  localTrash: ControlRoomsTrashState = createEmptyControlRoomsTrashState(),
  incomingTrash: ControlRoomsTrashState = createEmptyControlRoomsTrashState(),
): { state: ControlRoomsState; trash: ControlRoomsTrashState; requiresReload: boolean } {
  const normalizedLocal = normalizeControlRoomsState(local)
  const normalizedIncoming = normalizeControlRoomsState(incoming)
  let trash = mergeControlRoomsTrash(localTrash, incomingTrash)
  const deleted = trash.deleted
  const localOpen = openRoomId ? normalizedLocal.rooms[openRoomId] : undefined
  const incomingOpen = openRoomId ? normalizedIncoming.rooms[openRoomId] : undefined
  const openTombstone = openRoomId ? deleted.find((entry) => entry.room.id === openRoomId) : undefined
  const requiresReload = !!localOpen && (
    (!!incomingOpen && incomingOpen.updatedAt > localOpen.updatedAt)
    || (!!openTombstone && tombstoneTimestamp(openTombstone) >= localOpen.updatedAt)
  )
  let state = mergeControlRoomSummaries(normalizedLocal, normalizedIncoming)
  for (const entry of deleted) {
    const current = state.rooms[entry.room.id]
    if (!current) continue
    if (tombstoneTimestamp(entry) < current.updatedAt) {
      trash = { ...trash, deleted: trash.deleted.filter((item) => item.room.id !== entry.room.id) }
      continue
    }
    if (entry.room.id === openRoomId && localOpen) continue
    const rooms = { ...state.rooms }
    delete rooms[entry.room.id]
    const order = state.order.filter((id) => id !== entry.room.id)
    state = { ...state, rooms, order, activeId: state.activeId === entry.room.id ? (order[0] ?? null) : state.activeId }
  }
  if (normalizedLocal.activeId && state.rooms[normalizedLocal.activeId]) {
    state = { ...state, activeId: normalizedLocal.activeId }
  }
  if (requiresReload && openRoomId && localOpen) {
    state = { ...state, activeId: openRoomId, rooms: { ...state.rooms, [openRoomId]: localOpen } }
  }
  return { state, trash, requiresReload }
}

export function exportControlRooms(state: ControlRoomsState, exportedAt: number): string {
  const payload: ControlRoomsExport = {
    format: CONTROL_ROOMS_EXPORT_FORMAT,
    version: CONTROL_ROOMS_VERSION,
    exportedAt,
    state: normalizeControlRoomsState(state),
  }
  return JSON.stringify(payload, null, 2)
}

export function importControlRooms(
  current: ControlRoomsState,
  serialized: string,
  now: number,
): { state: ControlRoomsState; idMap: Record<string, string> } {
  const parsed: unknown = JSON.parse(serialized)
  if (!isRecord(parsed) || parsed.format !== CONTROL_ROOMS_EXPORT_FORMAT) throw new Error('Invalid control-room import format')
  if (parsed.version !== CONTROL_ROOMS_VERSION) throw new UnknownControlRoomsVersionError(parsed.version)
  const imported = normalizeControlRoomsState(parsed.state)
  const base = normalizeControlRoomsState(current)
  const occupied = new Set(Object.keys(base.rooms))
  const idMap: Record<string, string> = {}
  for (const sourceId of imported.order) {
    const targetId = occupied.has(sourceId) ? collisionId(sourceId, occupied) : sourceId
    idMap[sourceId] = targetId
    occupied.add(targetId)
  }
  const rooms = { ...base.rooms }
  const appendedOrder: string[] = []
  for (const sourceId of imported.order) {
    const source = imported.rooms[sourceId]
    const targetId = idMap[sourceId]
    rooms[targetId] = normalizeControlRoom({
      ...clone(source),
      id: targetId,
      layoutId: targetId === sourceId ? source.layoutId : `wt-console:${targetId}`,
      updatedAt: nextControlRoomRevision(source, now),
      deletedAt: null,
    }, targetId)
    appendedOrder.push(targetId)
  }
  return {
    state: { ...base, order: [...base.order, ...appendedOrder], rooms },
    idMap,
  }
}

function parseStored(storage: StorageCompatible, key: string): unknown | null {
  const raw = storage.getItem(key)
  return raw == null ? null : JSON.parse(raw)
}

function parseStoredRaw(raw: string | null): unknown | null {
  return raw == null ? null : JSON.parse(raw)
}

function validatedMigrationBackup(value: unknown): ControlRoomsMigrationBackup | null {
  if (value == null) return null
  if (!isRecord(value) || value.version !== CONTROL_ROOMS_VERSION) {
    throw new UnknownControlRoomsVersionError(isRecord(value) ? value.version : undefined)
  }
  if (!isRecord(value.legacy)) throw new Error('Invalid control-room migration backup')
  return clone(value as ControlRoomsMigrationBackup)
}

function restoreStoredRaw(storage: StorageCompatible, key: string, raw: string | null): void {
  if (raw != null) {
    storage.setItem(key, raw)
    return
  }
  if (typeof storage.removeItem !== 'function') throw new Error(`Storage cannot roll back absent key: ${key}`)
  storage.removeItem(key)
}

function rollbackStoredValues(
  storage: StorageCompatible,
  entries: readonly { key: string; raw: string | null }[],
): unknown[] {
  const errors: unknown[] = []
  for (const entry of [...entries].reverse()) {
    try { restoreStoredRaw(storage, entry.key, entry.raw) } catch (error) { errors.push(error) }
  }
  return errors
}

function createLegacyMigration(
  input: LegacyControlRoomMigrationInput,
  now: number,
): { state: ControlRoomsState; backup: ControlRoomsMigrationBackup } {
  const projectIds = uniqueStrings(input.projectIds)
  const projectOrder = uniqueStrings(input.projectOrder ?? input.projectIds).filter((id) => projectIds.includes(id))
  for (const id of projectIds) if (!projectOrder.includes(id)) projectOrder.push(id)
  const legacy = {
    projectIds,
    projectOrder,
    boundSessionId: typeof input.boundSessionId === 'string' && input.boundSessionId ? input.boundSessionId : null,
    layoutId: input.layoutId || 'wt-console:room-default',
    themeMode: normalizedTheme(input.themeMode),
  }
  const state = createControlRoom(createEmptyControlRoomsState(), {
    id: 'room-default',
    name: '总览',
    projectIds,
    projectOrder,
    boundSessionId: legacy.boundSessionId,
    // New split persistence is keyed by this ID; the old view remains in the raw backup.
    layoutId: 'wt-console:room-default',
    themeMode: legacy.themeMode,
  }, { id: 'room-default', now })
  return {
    state,
    backup: {
      version: CONTROL_ROOMS_VERSION,
      createdAt: now,
      rawProjects: input.rawProjects,
      rawView: input.rawView,
      legacy,
    },
  }
}

export class ControlRoomsStorage {
  private lastGoodState: ControlRoomsState | null = null
  private lastGoodTrash: ControlRoomsTrashState | null = null
  private lastWriteError: unknown = null

  constructor(private readonly storage: StorageCompatible) {}

  load(legacyInput?: LegacyControlRoomMigrationInput, now = Date.now()): ControlRoomsLoadResult {
    let storedState: unknown | null
    try {
      storedState = parseStored(this.storage, CONTROL_ROOMS_KEY)
    } catch (error) {
      if (error instanceof UnknownControlRoomsVersionError || !legacyInput) throw error
      return this.compatibilityResult(legacyInput, now, error)
    }
    if (storedState != null) {
      let state: ControlRoomsState
      try { state = normalizeControlRoomsState(storedState) } catch (error) {
        if (error instanceof UnknownControlRoomsVersionError || !legacyInput) throw error
        return this.compatibilityResult(legacyInput, now, error)
      }
      let trash: ControlRoomsTrashState
      try {
        const storedTrash = parseStored(this.storage, CONTROL_ROOMS_TRASH_KEY)
        trash = expireDeletedControlRooms(storedTrash == null ? createEmptyControlRoomsTrashState() : normalizeControlRoomsTrashState(storedTrash), now)
      } catch (error) {
        if (error instanceof UnknownControlRoomsVersionError) throw error
        trash = createEmptyControlRoomsTrashState()
        this.lastWriteError = error
        this.lastGoodState = state
        this.lastGoodTrash = trash
        return { state: clone(state), trash: clone(trash), migrated: false, persistenceError: error }
      }
      this.lastGoodState = state
      this.lastGoodTrash = trash
      this.lastWriteError = null
      return { state: clone(state), trash: clone(trash), migrated: false, persistenceError: null }
    }

    let existingTrashRaw: string | null
    let existingBackupRaw: string | null
    let existingTrash: ControlRoomsTrashState
    try {
      // Every auxiliary envelope is read and version-validated before migration writes.
      existingTrashRaw = this.storage.getItem(CONTROL_ROOMS_TRASH_KEY)
      existingBackupRaw = this.storage.getItem(CONTROL_ROOMS_MIGRATION_BACKUP_KEY)
      const parsedTrash = parseStoredRaw(existingTrashRaw)
      existingTrash = expireDeletedControlRooms(
        parsedTrash == null ? createEmptyControlRoomsTrashState() : normalizeControlRoomsTrashState(parsedTrash),
        now,
      )
      validatedMigrationBackup(parseStoredRaw(existingBackupRaw))
    } catch (error) {
      if (error instanceof UnknownControlRoomsVersionError || !legacyInput) throw error
      return this.compatibilityResult(legacyInput, now, error)
    }

    if (!legacyInput) {
      const state = createEmptyControlRoomsState()
      const trash = existingTrash
      this.lastGoodState = state
      this.lastGoodTrash = trash
      this.lastWriteError = null
      return { state: clone(state), trash: clone(trash), migrated: false, persistenceError: null }
    }

    const migration = createLegacyMigration(legacyInput, now)
    const trash = existingTrash
    const originals = [
      { key: CONTROL_ROOMS_MIGRATION_BACKUP_KEY, raw: existingBackupRaw },
      { key: CONTROL_ROOMS_TRASH_KEY, raw: existingTrashRaw },
      { key: CONTROL_ROOMS_KEY, raw: null },
    ] as const
    try {
      // The backup is one-time. A valid interrupted backup stays byte-for-byte intact.
      if (existingBackupRaw == null) {
        this.storage.setItem(CONTROL_ROOMS_MIGRATION_BACKUP_KEY, JSON.stringify(migration.backup))
      }
      // Likewise, a valid auxiliary trash/audit envelope is retained rather than emptied.
      if (existingTrashRaw == null) this.storage.setItem(CONTROL_ROOMS_TRASH_KEY, JSON.stringify(trash))
      // The main key is the migration-complete marker and is deliberately written last.
      this.storage.setItem(CONTROL_ROOMS_KEY, JSON.stringify(migration.state))
    } catch (error) {
      const persistenceError = new ControlRoomsPersistenceError(
        'Control-room migration persistence',
        error,
        rollbackStoredValues(this.storage, originals),
      )
      this.lastGoodState = migration.state
      this.lastGoodTrash = trash
      this.lastWriteError = persistenceError
      return {
        state: clone(migration.state),
        trash: clone(trash),
        migrated: false,
        persistenceError,
      }
    }
    this.lastGoodState = migration.state
    this.lastGoodTrash = trash
    this.lastWriteError = null
    return { state: clone(migration.state), trash: clone(trash), migrated: true, persistenceError: null }
  }

  save(state: ControlRoomsState, trash: ControlRoomsTrashState): { ok: boolean; error: unknown | null } {
    const nextState = normalizeControlRoomsState(state)
    const nextTrash = normalizeControlRoomsTrashState(trash)
    // The current valid in-memory state survives quota/security write failures.
    this.lastGoodState = nextState
    this.lastGoodTrash = nextTrash
    let previousState: string | null | undefined
    let previousTrash: string | null | undefined
    try {
      previousState = this.storage.getItem(CONTROL_ROOMS_KEY)
      previousTrash = this.storage.getItem(CONTROL_ROOMS_TRASH_KEY)
      this.storage.setItem(CONTROL_ROOMS_KEY, JSON.stringify(nextState))
      this.storage.setItem(CONTROL_ROOMS_TRASH_KEY, JSON.stringify(nextTrash))
      this.lastWriteError = null
      return { ok: true, error: null }
    } catch (error) {
      const rollbackErrors = previousState === undefined || previousTrash === undefined
        ? []
        : rollbackStoredValues(this.storage, [
            { key: CONTROL_ROOMS_KEY, raw: previousState },
            { key: CONTROL_ROOMS_TRASH_KEY, raw: previousTrash },
          ])
      const persistenceError = new ControlRoomsPersistenceError('Control-room save transaction', error, rollbackErrors)
      this.lastWriteError = persistenceError
      return { ok: false, error: persistenceError }
    }
  }

  getLastGood(): { state: ControlRoomsState; trash: ControlRoomsTrashState } | null {
    if (!this.lastGoodState || !this.lastGoodTrash) return null
    return { state: clone(this.lastGoodState), trash: clone(this.lastGoodTrash) }
  }

  getLastWriteError(): unknown {
    return this.lastWriteError
  }

  readMigrationBackup(): ControlRoomsMigrationBackup | null {
    return validatedMigrationBackup(parseStored(this.storage, CONTROL_ROOMS_MIGRATION_BACKUP_KEY))
  }

  /** Restore only raw legacy keys. New-format room data is intentionally retained for a later retry. */
  restoreLegacyBackup(): boolean {
    const backup = this.readMigrationBackup()
    if (!backup) return false
    if (backup.rawProjects != null) this.storage.setItem(LEGACY_PROJECTS_KEY, backup.rawProjects)
    if (backup.rawView != null) this.storage.setItem(LEGACY_VIEW_KEY, backup.rawView)
    return true
  }

  private compatibilityResult(
    legacyInput: LegacyControlRoomMigrationInput,
    now: number,
    error: unknown,
  ): ControlRoomsLoadResult {
    const migration = createLegacyMigration(legacyInput, now)
    const trash = createEmptyControlRoomsTrashState()
    this.lastGoodState = migration.state
    this.lastGoodTrash = trash
    this.lastWriteError = error
    return {
      state: clone(migration.state),
      trash: clone(trash),
      migrated: false,
      persistenceError: error,
    }
  }
}
