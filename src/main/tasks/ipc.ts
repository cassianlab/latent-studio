import { ipcMain, type WebContents } from 'electron'
import type { TaskApi, TaskBatchAction, TaskBatchInput, TaskBatchResult } from '../../shared/contracts/tasks'
import { sharedTaskStore, type TaskStore } from './store'
import type { ImageApi } from '../../shared/contracts/images'

const channels = { create: 'tasks:create', list: 'tasks:list', get: 'tasks:get', rename: 'tasks:rename', cancel: 'tasks:cancel', retry: 'tasks:retry', archive: 'tasks:archive', restore: 'tasks:restore', remove: 'tasks:remove', batch: 'tasks:batch', queueState: 'tasks:queue-state', pause: 'tasks:pause', resume: 'tasks:resume', event: 'tasks:event' } as const
const BATCH_ACTIONS = new Set<TaskBatchAction>(['cancel', 'retry', 'archive', 'restore', 'remove'])
const MAX_BATCH_SIZE = 500

function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' ? value as Record<string, unknown> : {} }
function id(value: unknown): string { if (typeof value !== 'string' || !value.trim()) throw new Error('任务标识不能为空'); return value.trim() }
function activeRoot(getProjectRoot: () => string | undefined): string { const root = getProjectRoot(); if (!root) throw Object.assign(new Error('请先打开一个项目'), { code: 'no-active-project' }); return root }

function batchInput(value: unknown): TaskBatchInput {
  const input = record(value)
  if (!BATCH_ACTIONS.has(input.action as TaskBatchAction)) throw new Error('批量任务操作无效')
  if (!Array.isArray(input.taskIds)) throw new Error('批量任务标识无效')
  const taskIds = [...new Set(input.taskIds.map(id))]
  if (taskIds.length === 0 || taskIds.length > MAX_BATCH_SIZE) throw new Error(`批量任务数量需要是 1-${MAX_BATCH_SIZE}`)
  return { action: input.action as TaskBatchAction, taskIds }
}

export interface TasksIpcOptions { getProjectRoot: () => string | undefined; imageApi?: ImageApi }

export function registerTasksIpc({ getProjectRoot, imageApi }: TasksIpcOptions): () => void {
  const stores = new Map<string, TaskStore>()
  const senders = new Map<number, WebContents>()
  const store = (): TaskStore => {
    const root = activeRoot(getProjectRoot)
    let value = stores.get(root)
    if (!value) {
      value = sharedTaskStore(root)
      value.onEvent((event) => {
        for (const [senderId, sender] of senders) {
          if (sender.isDestroyed()) { senders.delete(senderId); continue }
          try { sender.send(channels.event, event) } catch { senders.delete(senderId) }
        }
      })
      stores.set(root, value)
    }
    return value
  }
  const remember = (sender: WebContents): void => { if (!sender.isDestroyed()) senders.set(sender.id, sender) }
  const imageTask = async (taskId: string): Promise<boolean> => {
    const persisted = await store().get(taskId)
    if (persisted?.kind === 'image') return true
    return Boolean(imageApi && await imageApi.get(taskId))
  }
  const runAction = async (taskId: string, action: TaskBatchAction): Promise<boolean> => {
    const target = imageApi && await imageTask(taskId) ? imageApi : store()
    return target[action](taskId)
  }
  const runBatch = async (input: TaskBatchInput): Promise<TaskBatchResult> => {
    const result: TaskBatchResult = { action: input.action, requested: input.taskIds.length, succeeded: [], skipped: [], failed: [] }
    for (const taskId of input.taskIds) {
      try {
        if (await runAction(taskId, input.action)) result.succeeded.push(taskId)
        else result.skipped.push(taskId)
      } catch (error) {
        result.failed.push({ taskId, message: error instanceof Error ? error.message : '任务操作失败' })
      }
    }
    return result
  }
  const api: TaskApi = {
    create: (raw) => { const input = record(raw); return store().create({ id: typeof input.id === 'string' ? input.id : undefined, title: input.title as string, kind: typeof input.kind === 'string' ? input.kind : undefined, payload: input.payload && typeof input.payload === 'object' ? input.payload as Record<string, unknown> : undefined, maxAttempts: typeof input.maxAttempts === 'number' ? input.maxAttempts : undefined }) },
    list: (input) => store().list(input).then((items) => items.filter((item) => item.kind !== 'image')),
    get: async (taskId) => { const value = id(taskId); return (await store().get(value)) ?? null },
    rename: async (taskId, title) => { const value = id(taskId); return store().rename(value, title) },
    cancel: async (taskId) => runAction(id(taskId), 'cancel'),
    retry: async (taskId) => runAction(id(taskId), 'retry'),
    archive: async (taskId) => runAction(id(taskId), 'archive'),
    restore: async (taskId) => runAction(id(taskId), 'restore'),
    remove: async (taskId) => runAction(id(taskId), 'remove'),
    batch: runBatch,
    getQueueState: async () => ({ paused: await store().isPaused() }),
    pause: async () => { await store().pause(); await imageApi?.pause() },
    resume: async () => { await store().resume(); await imageApi?.resume() },
    onEvent: () => () => undefined, onTaskEvent: () => () => undefined,
  }
  const handlers: Array<[string, (...args: unknown[]) => unknown]> = [
    [channels.create, (event, raw) => { remember((event as Electron.IpcMainInvokeEvent).sender); return api.create(raw as never) }],
    [channels.list, (event, raw) => { remember((event as Electron.IpcMainInvokeEvent).sender); return api.list({ archived: record(raw).archived === true }) }],
    [channels.get, (event, raw) => { remember((event as Electron.IpcMainInvokeEvent).sender); return api.get(id(record(raw).taskId)) }],
    [channels.rename, (event, raw) => { remember((event as Electron.IpcMainInvokeEvent).sender); const payload = record(raw); return api.rename(id(payload.taskId), typeof payload.title === 'string' ? payload.title : '') }],
    [channels.cancel, (event, raw) => { remember((event as Electron.IpcMainInvokeEvent).sender); return api.cancel(id(record(raw).taskId)) }],
    [channels.retry, (event, raw) => { remember((event as Electron.IpcMainInvokeEvent).sender); return api.retry(id(record(raw).taskId)) }],
    [channels.archive, (event, raw) => { remember((event as Electron.IpcMainInvokeEvent).sender); return api.archive(id(record(raw).taskId)) }],
    [channels.restore, (event, raw) => { remember((event as Electron.IpcMainInvokeEvent).sender); return api.restore(id(record(raw).taskId)) }],
    [channels.remove, (event, raw) => { remember((event as Electron.IpcMainInvokeEvent).sender); return api.remove(id(record(raw).taskId)) }],
    [channels.batch, (event, raw) => { remember((event as Electron.IpcMainInvokeEvent).sender); return api.batch(batchInput(raw)) }],
    [channels.queueState, (event) => { remember((event as Electron.IpcMainInvokeEvent).sender); return api.getQueueState() }],
    [channels.pause, (event) => { remember((event as Electron.IpcMainInvokeEvent).sender); return api.pause() }],
    [channels.resume, (event) => { remember((event as Electron.IpcMainInvokeEvent).sender); return api.resume() }],
  ]
  for (const [channel, handler] of handlers) ipcMain.handle(channel, handler)
  return () => { for (const [channel] of handlers) ipcMain.removeHandler(channel); senders.clear() }
}

export { channels as taskIpcChannels }
