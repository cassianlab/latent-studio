import type { ImageTaskRecord } from '../../shared/contracts/images'
import type { TaskBatchAction, TaskRecord, TaskStatus } from '../../shared/contracts/tasks'

export type TaskFilterKey = 'all' | 'running' | 'pending' | 'completed' | 'attention' | 'archived'
export type TaskSortKey = 'updated-desc' | 'created-asc' | 'status'

export interface TaskListRow {
  id: string
  title: string
  status: TaskStatus
  progress: number
  model: string
  route: string
  createdAt: string
  updatedAt: string
  archived: boolean
  image?: ImageTaskRecord
  error?: string
}

export function imageTaskToRow(task: ImageTaskRecord, archived: boolean): TaskListRow {
  const first = task.title?.trim() || task.request.prompt.split(/[,，。\n]/)[0]?.trim() || '图片生成任务'
  return {
    id: task.id,
    title: first,
    status: task.status,
    progress: task.status === 'completed' ? 100 : task.status === 'running' ? 50 : 0,
    model: task.request.model || '未绑定模型',
    route: `图片连接 ${task.connectionId.slice(0, 8)}`,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    archived,
    image: task,
    error: task.error?.message,
  }
}

function taskRow(task: TaskRecord, archived: boolean): TaskListRow {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    progress: task.progress,
    model: task.kind,
    route: '计划任务',
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    archived,
    error: task.error?.message,
  }
}

export function buildTaskRows(
  tasks: TaskRecord[],
  images: ImageTaskRecord[],
  archivedTasks: TaskRecord[],
  archivedImages: ImageTaskRecord[],
): TaskListRow[] {
  return [
    ...tasks.map((task) => taskRow(task, false)),
    ...images.map((task) => imageTaskToRow(task, false)),
    ...archivedTasks.map((task) => taskRow(task, true)),
    ...archivedImages.map((task) => imageTaskToRow(task, true)),
  ]
}

export function canManageTask(status: TaskStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

export function filterTaskRows(rows: TaskListRow[], filter: TaskFilterKey): TaskListRow[] {
  if (filter === 'archived') return rows.filter((row) => row.archived)
  const active = rows.filter((row) => !row.archived)
  if (filter === 'running') return active.filter((row) => row.status === 'running')
  if (filter === 'pending') return active.filter((row) => row.status === 'pending')
  if (filter === 'completed') return active.filter((row) => row.status === 'completed')
  if (filter === 'attention') {
    return active.filter((row) =>
      row.status === 'failed' || row.status === 'paused' || row.status === 'cancelled'
    )
  }
  return active
}

export function searchTaskRows(rows: readonly TaskListRow[], query: string): TaskListRow[] {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return [...rows]
  return rows.filter((row) => [
    row.title,
    row.id,
    row.model,
    row.route,
    row.error,
    row.image?.connectionId,
    row.image?.request.prompt,
  ].some((value) => value?.toLocaleLowerCase().includes(needle)))
}

const STATUS_ORDER: Record<TaskStatus, number> = {
  running: 0,
  pending: 1,
  paused: 2,
  failed: 3,
  cancelled: 4,
  completed: 5,
}

export function sortTaskRows(rows: readonly TaskListRow[], sort: TaskSortKey): TaskListRow[] {
  return [...rows].sort((left, right) => {
    if (sort === 'status') {
      const statusDifference = STATUS_ORDER[left.status] - STATUS_ORDER[right.status]
      if (statusDifference) return statusDifference
    } else {
      const leftTime = Date.parse(sort === 'created-asc' ? left.createdAt : left.updatedAt)
      const rightTime = Date.parse(sort === 'created-asc' ? right.createdAt : right.updatedAt)
      const timeDifference = sort === 'created-asc' ? leftTime - rightTime : rightTime - leftTime
      if (timeDifference) return timeDifference
    }
    return left.id.localeCompare(right.id, 'zh-CN')
  })
}

export function canApplyTaskAction(row: TaskListRow, action: TaskBatchAction): boolean {
  if (action === 'restore') return row.archived
  if (action === 'remove') return canManageTask(row.status)
  if (row.archived) return false
  if (action === 'cancel') return row.status === 'pending' || row.status === 'running' || row.status === 'paused'
  if (action === 'retry') return row.status === 'failed' || row.status === 'cancelled' || row.status === 'paused'
  return canManageTask(row.status)
}

export function rowsForTaskAction(
  rows: readonly TaskListRow[],
  selectedIds: ReadonlySet<string>,
  action: TaskBatchAction,
): TaskListRow[] {
  return rows.filter((row) => selectedIds.has(row.id) && canApplyTaskAction(row, action))
}
