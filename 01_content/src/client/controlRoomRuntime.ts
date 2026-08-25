import {
  selectControlRoom,
  type ControlRoom,
  type ControlRoomsState,
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
 * Task 4 may add rule matches to `candidateIds`. Until then manual and fixed
 * references form membership and explicit exclusions always win.
 */
export function effectiveControlRoomProjectIds(
  room: ControlRoom,
  candidateIds?: readonly string[],
): string[] {
  const candidates = candidateIds ? new Set(candidateIds) : null
  const excluded = new Set(room.excludedProjectIds)
  const members = new Set([...room.projectIds, ...room.fixedProjectIds].filter((id) => !excluded.has(id)))
  const result: string[] = []
  const append = (id: string) => {
    if (!members.has(id) || excluded.has(id) || result.includes(id)) return
    if (candidates && !candidates.has(id)) return
    result.push(id)
  }
  room.projectOrder.forEach(append)
  room.projectIds.forEach(append)
  room.fixedProjectIds.forEach(append)
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
