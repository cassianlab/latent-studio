export type TaskStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'

export interface TaskRecord {
  id: string
  title: string
  kind: string
  status: TaskStatus
  progress: number
  attempts: number
  maxAttempts: number
  createdAt: string
  updatedAt: string
  archivedAt?: string
  payload?: Record<string, unknown>
  error?: { code?: string; message: string }
}

export interface TaskListInput {
  archived?: boolean
}

export type TaskBatchAction = 'cancel' | 'retry' | 'archive' | 'restore' | 'remove'

export interface TaskBatchInput {
  action: TaskBatchAction
  taskIds: string[]
}

export interface TaskBatchResult {
  action: TaskBatchAction
  requested: number
  succeeded: string[]
  skipped: string[]
  failed: Array<{ taskId: string; message: string }>
}

export interface TaskQueueState {
  paused: boolean
}

export interface CreateTaskInput {
  id?: string
  title: string
  kind?: string
  payload?: Record<string, unknown>
  maxAttempts?: number
}

export interface TaskEvent {
  type: 'created' | 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'retrying' | 'archived' | 'restored' | 'removed' | 'renamed'
  task: TaskRecord
}

export interface TaskApi {
  create(input: CreateTaskInput): Promise<TaskRecord>
  list(input?: TaskListInput): Promise<TaskRecord[]>
  get(taskId: string): Promise<TaskRecord | null>
  rename(taskId: string, title: string): Promise<TaskRecord | null>
  cancel(taskId: string): Promise<boolean>
  retry(taskId: string): Promise<boolean>
  archive(taskId: string): Promise<boolean>
  restore(taskId: string): Promise<boolean>
  remove(taskId: string): Promise<boolean>
  batch(input: TaskBatchInput): Promise<TaskBatchResult>
  getQueueState(): Promise<TaskQueueState>
  pause(): Promise<void>
  resume(): Promise<void>
  onEvent(listener: (event: TaskEvent) => void): () => void
  onTaskEvent(listener: (event: TaskEvent) => void): () => void
}
