import type { CreateTaskInput, TaskApi, TaskEvent, TaskRecord } from '../../shared/contracts/tasks'

const mockApi: TaskApi = {
  create: async (input: CreateTaskInput): Promise<TaskRecord> => ({ id: input.id ?? `mock-${Date.now()}`, title: input.title, kind: input.kind ?? 'generic', status: 'pending', progress: 0, attempts: 0, maxAttempts: input.maxAttempts ?? 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...(input.payload ? { payload: input.payload } : {}) }),
  list: async () => [], get: async () => null, rename: async () => null, cancel: async () => false, retry: async () => false, pause: async () => undefined, resume: async () => undefined, onEvent: (_listener: (event: TaskEvent) => void) => () => undefined, onTaskEvent: (_listener: (event: TaskEvent) => void) => () => undefined,
  archive: async () => false, restore: async () => false, remove: async () => false,
  batch: async (input) => ({ action: input.action, requested: input.taskIds.length, succeeded: [], skipped: [...input.taskIds], failed: [] }),
  getQueueState: async () => ({ paused: false }),
}

export function getTaskApi(): TaskApi {
  if (typeof window !== 'undefined' && window.latentStudio?.tasks) return window.latentStudio.tasks
  return mockApi
}
