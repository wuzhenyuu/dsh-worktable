import {
  deleteControlRoom,
  selectControlRoom,
  updateControlRoom,
  type ControlRoom,
  type ControlRoomsState,
  type ControlRoomsTrashState,
  type StorageCompatible,
} from './controlRooms'
import type { LayoutSpec, PaneTab } from './split'

export type ControlRoomBindingState = 'unbound' | 'valid' | 'missing'

export type ControlRoomOpenPreparation = {
  state: ControlRoomsState
  room: ControlRoom
  spec: LayoutSpec
  boundSessionId: string | null
  bindingState: ControlRoomBindingState
  createdSpec: boolean
}

export type ControlRoomLabels = (key: 'title' | 'pane' | 'files' | 'terminal') => string

export function controlRoomLayoutId(roomId: string): string {
  return `wt-console:${roomId}`
}

/**
 * Manual members, fixed overrides, and rule matches share one ordering seam.
 * Explicit manual exclusions always win.
 */
export function effectiveControlRoomProjectIds(
  room: ControlRoom,
  candidateIds?: readonly string[],
  ruleMatchedIds: readonly string[] = [],
): string[] {
  const candidates = candidateIds ? new Set(candidateIds) : null
  const excluded = new Set(room.excludedProjectIds)
  const members = new Set([...room.projectIds, ...room.fixedProjectIds, ...ruleMatchedIds].filter((id) => !excluded.has(id)))
  const result: string[] = []
  const append = (id: string) => {
    if (!members.has(id) || excluded.has(id) || result.includes(id)) return
    if (candidates && !candidates.has(id)) return
    result.push(id)
  }
  room.projectOrder.forEach(append)
  room.projectIds.forEach(append)
  room.fixedProjectIds.forEach(append)
  ruleMatchedIds.forEach(append)
  candidateIds?.forEach(append)
  return result
}

export function controlRoomBindingState(
  room: Pick<ControlRoom, 'boundSessionId'>,
  knownSessionIds: ReadonlySet<string>,
): ControlRoomBindingState {
  if (!room.boundSessionId) return 'unbound'
  return knownSessionIds.has(room.boundSessionId) ? 'valid' : 'missing'
}

export function specHasLockedConsole(spec: LayoutSpec | undefined): boolean {
  const panes = spec ? [...(spec.left ? [spec.left] : []), ...(spec.top ?? []), ...(spec.main ?? [])] : []
  return panes.some((pane) => pane.tabs?.some((tab) => tab.content?.kind === 'builtin' && tab.content.type === 'console'))
}

export function copyControlRoomLayoutView(
  views: Readonly<Record<string, LayoutSpec>>,
  sourceLayoutId: string,
  targetLayoutId: string,
): Record<string, LayoutSpec> {
  const source = views[sourceLayoutId]
  if (!source || sourceLayoutId === targetLayoutId) return views as Record<string, LayoutSpec>
  const copy = JSON.parse(JSON.stringify(source)) as LayoutSpec
  copy.id = targetLayoutId
  return { ...views, [targetLayoutId]: copy }
}

export function copyControlRoomSplitGeometry<T extends Record<string, unknown>>(
  geometry: T,
  sourceLayoutId: string,
  targetLayoutId: string,
): T {
  const source = geometry[sourceLayoutId]
  if (source == null || sourceLayoutId === targetLayoutId) return geometry
  return {
    ...geometry,
    [targetLayoutId]: JSON.parse(JSON.stringify(source)) as unknown,
  }
}

export function copyControlRoomSplitGeometryInStorage(
  storage: StorageCompatible,
  storageKey: string,
  sourceLayoutId: string,
  targetLayoutId: string,
): boolean {
  try {
    const raw = storage.getItem(storageKey)
    if (!raw) return false
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false
    const current = parsed as Record<string, unknown>
    if (current[sourceLayoutId] == null) return false
    const next = copyControlRoomSplitGeometry(current, sourceLayoutId, targetLayoutId)
    storage.setItem(storageKey, JSON.stringify(next))
    return true
  } catch {
    return false
  }
}

export type ControlRoomAfterCopyOptions = {
  getSourceLayoutId(sourceControlRoomId: string): string | undefined
  updateViews(update: (views: Readonly<Record<string, LayoutSpec>>) => Record<string, LayoutSpec>): void
  storage: StorageCompatible
  storageKey: string
}

/** Shared executable callback for both the human copy button and the command bridge. */
export function createControlRoomAfterCopyCallback(options: ControlRoomAfterCopyOptions): (
  sourceControlRoomId: string,
  newControlRoomId: string,
) => { sourceLayoutId: string; targetLayoutId: string; geometryCopied: boolean } {
  return (sourceControlRoomId, newControlRoomId) => {
    const sourceLayoutId = options.getSourceLayoutId(sourceControlRoomId) ?? controlRoomLayoutId(sourceControlRoomId)
    const targetLayoutId = controlRoomLayoutId(newControlRoomId)
    options.updateViews((views) => copyControlRoomLayoutView(views, sourceLayoutId, targetLayoutId))
    const geometryCopied = copyControlRoomSplitGeometryInStorage(
      options.storage,
      options.storageKey,
      sourceLayoutId,
      targetLayoutId,
    )
    return { sourceLayoutId, targetLayoutId, geometryCopied }
  }
}

export function reconcileNeedAckTransitions(
  seen: Readonly<Record<string, boolean>>,
  current: Readonly<Record<string, boolean>>,
): { seen: Record<string, boolean>; clearSessionIds: string[] } {
  const next = { ...seen }
  const clearSessionIds: string[] = []
  for (const [sessionId, needNow] of Object.entries(current)) {
    if (seen[sessionId] !== undefined && seen[sessionId] !== needNow) clearSessionIds.push(sessionId)
    next[sessionId] = needNow
  }
  return { seen: next, clearSessionIds }
}

export function autoBindControlRoomSession(
  state: ControlRoomsState,
  activeLayoutId: string | null,
  sessionId: string,
  now: number,
): { state: ControlRoomsState; result: 'auto' | 'kept' | 'none'; roomId: string | null } {
  if (!activeLayoutId || !sessionId) return { state, result: 'none', roomId: null }
  const room = Object.values(state.rooms).find((candidate) => candidate.layoutId === activeLayoutId)
  if (!room) return { state, result: 'none', roomId: null }
  if (room.boundSessionId) return { state, result: 'kept', roomId: room.id }
  return {
    state: updateControlRoom(state, room.id, { boundSessionId: sessionId }, now),
    result: 'auto',
    roomId: room.id,
  }
}

export function deleteControlRoomAndPlanNextOpen(
  state: ControlRoomsState,
  trash: ControlRoomsTrashState,
  roomId: string,
  openLayoutId: string | null,
  now: number,
): {
  state: ControlRoomsState
  trash: ControlRoomsTrashState
  closeOpenLayout: boolean
  openRoomId: string | null
} {
  const room = state.rooms[roomId]
  const result = deleteControlRoom(state, trash, roomId, now)
  const closeOpenLayout = Boolean(result.deleted && room && room.layoutId === openLayoutId)
  return {
    state: result.state,
    trash: result.trash,
    closeOpenLayout,
    openRoomId: closeOpenLayout ? result.state.activeId : null,
  }
}

function defaultTabs(room: ControlRoom, labels: ControlRoomLabels): { tabs: PaneTab[]; active: number } {
  const tabs: PaneTab[] = [{
    id: 'control-room',
    title: labels('pane'),
    content: { kind: 'builtin', type: 'console' },
  }]
  if (room.defaultPane === 'files') {
    tabs.push({ id: 'control-room-files', title: labels('files'), content: { kind: 'builtin', type: 'explorer' } })
  } else if (room.defaultPane === 'terminal') {
    tabs.push({ id: 'control-room-terminal', title: labels('terminal'), content: { kind: 'builtin', type: 'terminal' } })
  }
  return { tabs, active: tabs.length - 1 }
}

export function buildControlRoomSpec(room: ControlRoom, labels: ControlRoomLabels): LayoutSpec {
  const initial = defaultTabs(room, labels)
  return {
    id: controlRoomLayoutId(room.id),
    title: room.name || labels('title'),
    icon: room.icon,
    top: null,
    main: [{
      id: 'control-room',
      title: labels('pane'),
      min: 240,
      tabs: initial.tabs,
      active: initial.active,
    }],
    chatWidth: { default: 340, min: 280, max: 600 },
    topHeight: { default: 200, min: 120, max: 480 },
    chatSide: 'right',
  }
}

export function prepareControlRoomOpen(
  state: ControlRoomsState,
  roomId: string,
  views: Readonly<Record<string, LayoutSpec>>,
  knownSessionIds: ReadonlySet<string>,
  now: number,
  labels: ControlRoomLabels,
  legacySaved?: LayoutSpec,
): ControlRoomOpenPreparation {
  const room = state.rooms[roomId]
  if (!room) throw new Error(`Unknown control room: ${roomId}`)
  const layoutId = controlRoomLayoutId(roomId)
  const normalizedRoom = room.layoutId === layoutId ? room : { ...room, layoutId }
  const saved = views[layoutId]
  const exactReusable = specHasLockedConsole(saved)
    ? (saved!.id === layoutId ? saved! : { ...saved!, id: layoutId })
    : null
  const reusable = exactReusable
    ?? (!saved && specHasLockedConsole(legacySaved) ? { ...legacySaved!, id: layoutId } : null)
  const selected = selectControlRoom(
    normalizedRoom === room ? state : { ...state, rooms: { ...state.rooms, [roomId]: normalizedRoom } },
    roomId,
    now,
  )
  const selectedRoom = selected.rooms[roomId]
  return {
    state: selected,
    room: selectedRoom,
    spec: reusable ?? buildControlRoomSpec(selectedRoom, labels),
    boundSessionId: selectedRoom.boundSessionId,
    bindingState: controlRoomBindingState(selectedRoom, knownSessionIds),
    createdSpec: !exactReusable || exactReusable !== saved,
  }
}
