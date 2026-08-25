import {
  isControlRoomConditionCompatible,
  type ControlRoomCondition,
  type ControlRoom,
  type ControlRoomRule,
  type ControlRoomStatus,
} from './controlRooms'
import { effectiveControlRoomProjectIds } from './controlRoomRuntime'

export type ControlRoomProjectFacts = {
  id: string
  status: ControlRoomStatus
  name: string
  icon: string
  tags: string[]
  workspace: string
  hasBoundSession: boolean
  subagentCount: number
  lastActiveAt: number
  lastCompletedAt: number
  hidden: boolean
  archived: boolean
}

export type ControlRoomRuleEvaluation = {
  matched: boolean
  disabled: boolean
}

export type ControlRoomRuleProjectInput = {
  id: string
  name: string
  icon: string
  tags?: string[]
  workspace?: string
  boundSessionId?: string | null
  lastActiveAt?: number
  lastCompletedAt?: number
  hidden?: boolean
  archived?: boolean
}

export type ControlRoomRuleRefreshSummary = {
  memberIds: string[]
  needCount: number
}

export type ControlRoomRuleRefreshResult = {
  facts: ControlRoomProjectFacts[]
  matchesByRoom: Record<string, string[]>
  summariesByRoom: Record<string, ControlRoomRuleRefreshSummary>
  openRoomFingerprint: string
}

export type ControlRoomRuleRefreshInput = {
  rooms: readonly ControlRoom[]
  activeRoomId: string | null
  projects: readonly ControlRoomRuleProjectInput[]
  sessionSnapshot: any
  pendingSessionIds?: ReadonlySet<string>
}

const folded = (value: unknown): string => String(value ?? '').trim().toLocaleLowerCase()
const same = (left: unknown, right: unknown): boolean => {
  if (typeof left === 'string' || typeof right === 'string') return folded(left) === folded(right)
  return left === right
}

function conditionActual(condition: ControlRoomCondition, facts: ControlRoomProjectFacts): string | number | boolean | string[] {
  switch (condition.field) {
    case 'tag': return facts.tags
    case 'hasBoundSession': return facts.hasBoundSession
    case 'subagentCount': return facts.subagentCount
    case 'lastActiveAt': return facts.lastActiveAt
    case 'lastCompletedAt': return facts.lastCompletedAt
    case 'hidden': return facts.hidden
    case 'archived': return facts.archived
    default: return facts[condition.field]
  }
}

function includesValue(actual: string | string[], expected: string): boolean {
  const needle = folded(expected)
  if (Array.isArray(actual)) return actual.some((item) => folded(item) === needle)
  return folded(actual).includes(needle)
}

export function evaluateControlRoomCondition(condition: ControlRoomCondition, facts: ControlRoomProjectFacts): boolean {
  if (!isControlRoomConditionCompatible(condition)) return false
  const actual = conditionActual(condition, facts)
  const expected = condition.value
  switch (condition.operator) {
    case 'equals':
      return Array.isArray(actual) ? actual.some((item) => same(item, expected)) : same(actual, expected)
    case 'notEquals':
      return Array.isArray(actual) ? actual.every((item) => !same(item, expected)) : !same(actual, expected)
    case 'contains':
      return includesValue(actual as string | string[], expected as string)
    case 'notContains':
      return !includesValue(actual as string | string[], expected as string)
    case 'in':
      return (expected as string[]).some((item) => Array.isArray(actual)
        ? actual.some((value) => same(value, item))
        : same(actual, item))
    case 'notIn':
      return !(expected as string[]).some((item) => Array.isArray(actual)
        ? actual.some((value) => same(value, item))
        : same(actual, item))
    case 'greaterThanOrEqual':
      return Number(actual) >= Number(expected)
    case 'lessThanOrEqual':
      return Number(actual) <= Number(expected)
    case 'before':
      return Number(actual) < Number(expected)
    case 'after':
      return Number(actual) > Number(expected)
  }
}

export function evaluateControlRoomRule(rule: ControlRoomRule, facts: ControlRoomProjectFacts): ControlRoomRuleEvaluation {
  if (!rule || rule.enabled !== true || (rule.mode !== 'all' && rule.mode !== 'any') || !Array.isArray(rule.conditions) || rule.conditions.length === 0) {
    return { matched: false, disabled: true }
  }
  if (rule.conditions.some((condition) => !condition || !isControlRoomConditionCompatible(condition))) {
    return { matched: false, disabled: true }
  }
  const excluded = rule.conditions.filter((condition) => condition.exclude === true)
  if (excluded.some((condition) => evaluateControlRoomCondition(condition, facts))) {
    return { matched: false, disabled: false }
  }
  const included = rule.conditions.filter((condition) => condition.exclude !== true)
  const matched = included.length === 0
    ? true
    : rule.mode === 'all'
      ? included.every((condition) => evaluateControlRoomCondition(condition, facts))
      : included.some((condition) => evaluateControlRoomCondition(condition, facts))
  return { matched, disabled: false }
}

/** Enabled rules are ORed together; a corrupt rule is isolated from every other rule. */
export function matchingControlRoomProjectIds(
  rules: readonly ControlRoomRule[],
  projects: readonly ControlRoomProjectFacts[],
): string[] {
  if (!Array.isArray(rules) || rules.length === 0) return []
  return projects
    .filter((project) => rules.some((rule) => evaluateControlRoomRule(rule, project).matched))
    .map((project) => project.id)
}

const finiteMax = (...values: unknown[]): number => Math.max(
  0,
  ...values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value)),
)

const childSessionIds = (snapshot: any, sessionId: string): Set<string> => {
  const children = new Set<string>()
  const byId: Record<string, any> = snapshot?.byId ?? {}
  for (const [childId, entry] of Object.entries<any>(byId)) {
    if (entry?.parentId === sessionId) children.add(childId)
  }
  const raw = (snapshot?.subagentsByParent ?? {})[sessionId]
  const items = Array.isArray(raw) ? raw : (raw?.entries ?? raw?.items ?? raw?.children ?? [])
  if (Array.isArray(items)) items.forEach((item: any) => {
    const childId = item?.sessionId ?? item?.id
    if (typeof childId === 'string' && childId) children.add(childId)
  })
  return children
}

const sessionNeedsAttention = (entry: any): boolean => entry?.pendingInteraction != null

/** Production event seam: rebuild facts and room summaries from one project/session snapshot. */
export function refreshControlRoomRuleState(input: ControlRoomRuleRefreshInput): ControlRoomRuleRefreshResult {
  const snapshot = input.sessionSnapshot
  const byId: Record<string, any> = snapshot?.byId ?? {}
  const facts = input.projects.map((project): ControlRoomProjectFacts => {
    const sessionId = project.boundSessionId ?? null
    const entry = sessionId ? byId[sessionId] : null
    const children = sessionId ? childSessionIds(snapshot, sessionId) : new Set<string>()
    let needsAttention = sessionNeedsAttention(entry) || (!!sessionId && input.pendingSessionIds?.has(sessionId) === true)
    if (!needsAttention) {
      for (const childId of children) {
        if (sessionNeedsAttention(byId[childId]) || input.pendingSessionIds?.has(childId) === true) {
          needsAttention = true
          break
        }
      }
    }
    const status: ControlRoomStatus = needsAttention
      ? 'need'
      : entry?.completed === true
        ? 'done'
        : entry?.running === true
          ? 'busy'
          : 'idle'
    const sessionTags = Array.isArray(entry?.tags)
      ? entry.tags.filter((tag: unknown): tag is string => typeof tag === 'string' && !!tag)
      : []
    return {
      id: project.id,
      status,
      name: project.name,
      icon: project.icon,
      tags: [...new Set([...(project.tags ?? []), ...sessionTags])],
      workspace: project.workspace ?? entry?.workspaceId ?? entry?.workspace ?? entry?.cwd ?? '',
      hasBoundSession: !!sessionId,
      subagentCount: children.size,
      lastActiveAt: finiteMax(project.lastActiveAt, entry?.lastActiveAt, entry?.lastActivityAt, entry?.lastMessageAt, entry?.updatedAt),
      lastCompletedAt: finiteMax(project.lastCompletedAt, entry?.lastCompletedAt, entry?.completedAt, entry?.completed === true ? entry?.updatedAt : undefined),
      hidden: project.hidden === true,
      archived: project.archived === true || entry?.archived === true || entry?.status === 'archived',
    }
  })
  const candidateIds = input.projects.map((project) => project.id)
  const factById = new Map(facts.map((fact) => [fact.id, fact]))
  const matchesByRoom: Record<string, string[]> = {}
  const summariesByRoom: Record<string, ControlRoomRuleRefreshSummary> = {}
  for (const room of input.rooms) {
    const matches = matchingControlRoomProjectIds(room.rules, facts)
    const memberIds = effectiveControlRoomProjectIds(room, candidateIds, matches)
    matchesByRoom[room.id] = matches
    summariesByRoom[room.id] = {
      memberIds,
      needCount: memberIds.filter((projectId) => factById.get(projectId)?.status === 'need').length,
    }
  }
  const openRoom = input.activeRoomId ? input.rooms.find((room) => room.id === input.activeRoomId) : null
  const openSummary = openRoom ? summariesByRoom[openRoom.id] : null
  const openRoomFingerprint = openRoom && openSummary
    ? JSON.stringify({
        roomId: openRoom.id,
        rules: openRoom.rules,
        members: openSummary.memberIds,
        facts: openSummary.memberIds.map((projectId) => factById.get(projectId)),
      })
    : ''
  return { facts, matchesByRoom, summariesByRoom, openRoomFingerprint }
}

/** Used by React after an event refresh; the first snapshot seeds state without a spurious notification. */
export function notifyOpenControlRoomRuleRefresh(
  previous: ControlRoomRuleRefreshResult | null,
  current: ControlRoomRuleRefreshResult,
  notify: () => void,
): ControlRoomRuleRefreshResult {
  if (previous && previous.openRoomFingerprint !== current.openRoomFingerprint) notify()
  return current
}
