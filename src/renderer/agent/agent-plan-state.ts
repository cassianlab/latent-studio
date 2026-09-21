import type { ImageTaskStatus } from '../../shared/contracts/images'

export type AgentPlanStatus = 'awaiting-confirmation' | 'running' | 'paused' | 'completed' | 'partial' | 'failed' | 'cancelled'

export { resolveAgentImageCount } from '../../shared/agent-planning'

export function resolveAgentPlanStatus(input: {
  executing: boolean
  paused: boolean
  taskStatuses: ImageTaskStatus[]
}): AgentPlanStatus {
  if (input.paused) return 'paused'
  if (input.taskStatuses.length === 0) return 'awaiting-confirmation'
  // Task events are authoritative; the local execution flag can lag the final event.
  const hasActiveTasks = input.taskStatuses.some((status) => status === 'pending' || status === 'running')
  const completed = input.taskStatuses.filter((status) => status === 'completed').length
  const failed = input.taskStatuses.filter((status) => status === 'failed').length
  const cancelled = input.taskStatuses.filter((status) => status === 'cancelled').length
  if (hasActiveTasks) return 'running'
  if (completed === input.taskStatuses.length) return 'completed'
  if (completed > 0) return 'partial'
  if (failed > 0) return 'failed'
  if (cancelled === input.taskStatuses.length) return 'cancelled'
  return 'failed'
}
