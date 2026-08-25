import {
  isControlRoomConditionCompatible,
  type ControlRoomCondition,
  type ControlRoomRule,
  type ControlRoomStatus,
} from './controlRooms'

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
  if (!rule || rule.enabled !== true || (rule.mode !== 'all' && rule.mode !== 'any') || !Array.isArray(rule.conditions)) {
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
