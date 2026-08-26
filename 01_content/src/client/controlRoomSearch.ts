import type { ControlRoomRule, ControlRoomStatus } from './controlRooms'

export type ControlRoomSearchKind = 'room' | 'project' | 'conversation' | 'rule'

export type ControlRoomSearchRoom = {
  id: string
  name: string
  icon: string
  description: string
  effectiveProjectIds: string[]
  /** Missing explicit room references are searchable even though rules only see live projects. */
  referencedProjectIds?: string[]
  boundSessionId: string | null
  boundSessionTitle: string
  rules: ControlRoomRule[]
  lastOpenedAt: number
  needCount: number
}

export type ControlRoomSearchProject = {
  id: string
  name: string
  icon: string
  tags: string[]
  workspace: string
  lastUsedAt: number
  status: ControlRoomStatus
  missing?: boolean
}

export type ControlRoomSearchInput = {
  rooms: readonly ControlRoomSearchRoom[]
  projects: readonly ControlRoomSearchProject[]
  currentRoomId: string | null
  limit?: number
}

export type ControlRoomSearchResult = {
  kind: ControlRoomSearchKind
  /** Stable semantic id. Rule ids are scoped by room internally but retain their source id here. */
  targetId: string
  title: string
  subtitle: string
  icon: string
  roomIds: string[]
  /** Concrete owning room selected for navigation. */
  roomId: string
  relevance: number
  missing?: boolean
}

export type ControlRoomSearchResponse = {
  results: ControlRoomSearchResult[]
  total: number
  overflow: number
}

export type ControlRoomSearchNavigation =
  | { kind: 'open-room'; roomId: string }
  | { kind: 'open-project'; roomId: string; projectId: string }
  | { kind: 'open-conversation'; roomId: string; sessionId: string }
  | { kind: 'open-rule'; roomId: string; ruleId: string }

export type ControlRoomSearchActions = {
  openControlRoom: (roomId: string) => void
  openProjectInRoom: (roomId: string, projectId: string) => void
  openRuleEditor: (roomId: string, ruleId: string) => void
}

type Candidate = ControlRoomSearchResult & {
  searchTitle: string
  searchDetails: string[]
  recentAt: number
  need: boolean
  current: boolean
  stableOrder: number
}

const folded = (value: unknown): string => String(value ?? '').normalize('NFKC').trim().toLowerCase()
const tokensOf = (query: string): string[] => folded(query).split(/\s+/u).filter(Boolean)

function textualRelevance(title: string, details: readonly string[], query: string): number {
  const normalizedTitle = folded(title)
  const normalizedDetails = details.map(folded).filter(Boolean)
  const tokens = tokensOf(query)
  if (tokens.length === 0) return 1
  let score = normalizedTitle === folded(query) ? 500 : 0
  for (const token of tokens) {
    let tokenScore = 0
    if (normalizedTitle === token) tokenScore = 1_200
    else if (normalizedTitle.startsWith(token)) tokenScore = 900
    else if (normalizedTitle.includes(token)) tokenScore = 700
    for (const detail of normalizedDetails) {
      if (detail === token) tokenScore = Math.max(tokenScore, 500)
      else if (detail.includes(token)) tokenScore = Math.max(tokenScore, 350)
    }
    if (tokenScore === 0) return 0
    score += tokenScore
  }
  return score
}

function preferredRoomId(
  roomIds: readonly string[],
  currentRoomId: string | null,
  roomById: ReadonlyMap<string, ControlRoomSearchRoom>,
): string {
  if (currentRoomId && roomIds.includes(currentRoomId)) return currentRoomId
  return [...roomIds].sort((left, right) => {
    const recent = (roomById.get(right)?.lastOpenedAt ?? 0) - (roomById.get(left)?.lastOpenedAt ?? 0)
    if (recent) return recent
    const need = (roomById.get(right)?.needCount ?? 0) - (roomById.get(left)?.needCount ?? 0)
    return need || left.localeCompare(right)
  })[0] ?? ''
}

function conditionKeywords(rule: ControlRoomRule): string[] {
  return rule.conditions.flatMap((condition) => [
    condition.field,
    condition.operator,
    Array.isArray(condition.value) ? condition.value.join(' ') : String(condition.value),
    condition.exclude === true ? 'exclude' : '',
  ])
}

/** Build and rank a read-only global index. Master project/session/room state is never mutated here. */
export function searchControlRooms(input: ControlRoomSearchInput, query: string): ControlRoomSearchResponse {
  const roomById = new Map(input.rooms.map((room) => [room.id, room]))
  const ownersByProject = new Map<string, string[]>()
  for (const room of input.rooms) {
    for (const projectId of new Set([...room.effectiveProjectIds, ...(room.referencedProjectIds ?? [])])) {
      const owners = ownersByProject.get(projectId) ?? []
      if (!owners.includes(room.id)) owners.push(room.id)
      ownersByProject.set(projectId, owners)
    }
  }

  let stableOrder = 0
  const candidates: Candidate[] = []
  const seenRoomIds = new Set<string>()
  for (const room of input.rooms) {
    if (seenRoomIds.has(room.id)) continue
    seenRoomIds.add(room.id)
    candidates.push({
      kind: 'room',
      targetId: room.id,
      title: room.name,
      subtitle: room.description,
      icon: room.icon,
      roomIds: [room.id],
      roomId: room.id,
      relevance: 0,
      searchTitle: room.name,
      searchDetails: [room.description],
      recentAt: room.lastOpenedAt,
      need: room.needCount > 0,
      current: room.id === input.currentRoomId,
      stableOrder: stableOrder++,
    })
  }

  const seenProjectIds = new Set<string>()
  for (const project of input.projects) {
    if (seenProjectIds.has(project.id)) continue
    seenProjectIds.add(project.id)
    const roomIds = ownersByProject.get(project.id) ?? []
    if (roomIds.length === 0) continue
    const roomId = preferredRoomId(roomIds, input.currentRoomId, roomById)
    candidates.push({
      kind: 'project',
      targetId: project.id,
      title: project.name,
      subtitle: [project.tags.join(' · '), project.workspace].filter(Boolean).join(' — '),
      icon: project.icon,
      roomIds: [...roomIds],
      roomId,
      relevance: 0,
      missing: project.missing === true || undefined,
      searchTitle: project.name,
      searchDetails: [project.id, ...project.tags, project.workspace],
      recentAt: Math.max(project.lastUsedAt, ...roomIds.map((id) => roomById.get(id)?.lastOpenedAt ?? 0)),
      need: project.status === 'need' || roomIds.some((id) => (roomById.get(id)?.needCount ?? 0) > 0),
      current: !!input.currentRoomId && roomIds.includes(input.currentRoomId),
      stableOrder: stableOrder++,
    })
  }

  const conversations = new Map<string, { title: string; roomIds: string[] }>()
  for (const room of input.rooms) {
    if (!room.boundSessionId) continue
    const current = conversations.get(room.boundSessionId) ?? { title: room.boundSessionTitle || room.boundSessionId, roomIds: [] }
    if (!current.roomIds.includes(room.id)) current.roomIds.push(room.id)
    if (room.boundSessionTitle) current.title = room.boundSessionTitle
    conversations.set(room.boundSessionId, current)
  }
  for (const [sessionId, conversation] of conversations) {
    const roomId = preferredRoomId(conversation.roomIds, input.currentRoomId, roomById)
    candidates.push({
      kind: 'conversation',
      targetId: sessionId,
      title: conversation.title,
      subtitle: conversation.roomIds.map((id) => roomById.get(id)?.name ?? id).join(' · '),
      icon: '💬',
      roomIds: [...conversation.roomIds],
      roomId,
      relevance: 0,
      searchTitle: conversation.title,
      searchDetails: [sessionId, ...conversation.roomIds.map((id) => roomById.get(id)?.name ?? id)],
      recentAt: Math.max(...conversation.roomIds.map((id) => roomById.get(id)?.lastOpenedAt ?? 0)),
      need: conversation.roomIds.some((id) => (roomById.get(id)?.needCount ?? 0) > 0),
      current: !!input.currentRoomId && conversation.roomIds.includes(input.currentRoomId),
      stableOrder: stableOrder++,
    })
  }

  const seenRuleIds = new Set<string>()
  for (const room of input.rooms) {
    room.rules.forEach((rule, index) => {
      const semanticId = `${room.id}\u0000${rule.id}`
      if (seenRuleIds.has(semanticId)) return
      seenRuleIds.add(semanticId)
      const title = rule.name?.trim() || `Rule ${index + 1}`
      candidates.push({
        kind: 'rule',
        targetId: rule.id,
        title,
        subtitle: room.name,
        icon: '⚙️',
        roomIds: [room.id],
        roomId: room.id,
        relevance: 0,
        searchTitle: title,
        searchDetails: [room.name, ...conditionKeywords(rule)],
        recentAt: room.lastOpenedAt,
        need: room.needCount > 0,
        current: room.id === input.currentRoomId,
        stableOrder: stableOrder++,
      })
    })
  }

  const ranked = candidates
    .map((candidate) => ({ ...candidate, relevance: textualRelevance(candidate.searchTitle, candidate.searchDetails, query) }))
    .filter((candidate) => candidate.relevance > 0)
    .sort((left, right) => {
      const relevance = right.relevance - left.relevance
      if (relevance) return relevance
      if (left.current !== right.current) return left.current ? -1 : 1
      const recent = right.recentAt - left.recentAt
      if (recent) return recent
      if (left.need !== right.need) return left.need ? -1 : 1
      return left.stableOrder - right.stableOrder
    })
  const limit = Math.min(50, Math.max(0, input.limit ?? 50))
  const results = ranked.slice(0, limit).map(({ searchTitle: _searchTitle, searchDetails: _searchDetails, recentAt: _recentAt, need: _need, current: _current, stableOrder: _stableOrder, ...result }) => result)
  return { results, total: ranked.length, overflow: Math.max(0, ranked.length - results.length) }
}

/** Stable, testable seam between a semantic result and production UI actions. */
export function describeControlRoomSearchNavigation(result: Pick<ControlRoomSearchResult, 'kind' | 'roomId' | 'targetId'>): ControlRoomSearchNavigation {
  switch (result.kind) {
    case 'room': return { kind: 'open-room', roomId: result.roomId }
    case 'project': return { kind: 'open-project', roomId: result.roomId, projectId: result.targetId }
    case 'conversation': return { kind: 'open-conversation', roomId: result.roomId, sessionId: result.targetId }
    case 'rule': return { kind: 'open-rule', roomId: result.roomId, ruleId: result.targetId }
  }
}

export function executeControlRoomSearchNavigation(
  descriptor: ControlRoomSearchNavigation,
  actions: ControlRoomSearchActions,
): void {
  switch (descriptor.kind) {
    case 'open-room': actions.openControlRoom(descriptor.roomId); return
    case 'open-project': actions.openProjectInRoom(descriptor.roomId, descriptor.projectId); return
    case 'open-conversation': actions.openControlRoom(descriptor.roomId); return
    case 'open-rule': actions.openRuleEditor(descriptor.roomId, descriptor.ruleId); return
  }
}
