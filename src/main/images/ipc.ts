import { ipcMain, shell, type WebContents } from 'electron'
import { join } from 'node:path'
import type { ImageEnqueueInput, ImageRequestInput } from '../../shared/contracts/images'
import type { SettingsStore } from '../settings'
import { sharedTaskStore } from '../tasks/store'
import { ProjectAssetService } from '../library/assets'
import { createImageModelService, type ImageModelService } from './service'

const channels = {
  enqueue: 'images:enqueue',
  list: 'images:list',
  get: 'images:get',
  cancel: 'images:cancel',
  retry: 'images:retry',
  archive: 'images:archive',
  restore: 'images:restore',
  remove: 'images:remove',
  pause: 'images:pause',
  resume: 'images:resume',
  setConcurrency: 'images:set-concurrency',
  taskEvent: 'images:task-event',
  revealOutput: 'images:reveal-output',
} as const

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function requiredId(value: unknown, message: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(message)
  return value.trim()
}

export interface ImagesIpcOptions {
  store: SettingsStore
  getProjectRoot: () => string | undefined
  onService?: (service: ImageModelService) => void
}

export function registerImagesIpc({ store, getProjectRoot, onService }: ImagesIpcOptions): () => void {
  const assetService = new ProjectAssetService()
  const service = createImageModelService(store, {
    getProjectRoot,
    getTaskStore: sharedTaskStore,
    getAssetStore: () => assetService,
  })
  onService?.(service)
  const senders = new Map<number, WebContents>()
  const unsubscribe = service.onTaskEvent((event) => {
    for (const [id, sender] of senders) {
      if (sender.isDestroyed()) { senders.delete(id); continue }
      try { sender.send(channels.taskEvent, event) } catch { senders.delete(id) }
    }
  })
  const remember = (sender: WebContents): void => { if (!sender.isDestroyed()) senders.set(sender.id, sender) }
  const enqueue = (_event: Electron.IpcMainInvokeEvent, raw: unknown) => {
    remember(_event.sender)
    const input = asRecord(raw)
    const modelProfileId = requiredId(input.modelProfileId, '图片模型配置标识缺失')
    if (!input.request || typeof input.request !== 'object') throw new Error('图片请求格式无效')
    return service.enqueue({
      ...(typeof input.id === 'string' ? { id: input.id } : {}),
      ...(typeof input.title === 'string' ? { title: input.title } : {}),
      modelProfileId,
      request: input.request as ImageRequestInput,
      ...(typeof input.maxRetries === 'number' ? { maxRetries: input.maxRetries } : {}),
    } satisfies ImageEnqueueInput)
  }
  const handlers: Array<[string, (...args: unknown[]) => unknown]> = [
    [channels.enqueue, enqueue as (...args: unknown[]) => unknown],
    [channels.list, (event, raw) => { remember((event as Electron.IpcMainInvokeEvent).sender); return service.list({ archived: asRecord(raw).archived === true }) }],
    [channels.get, (event, raw) => { remember((event as Electron.IpcMainInvokeEvent).sender); return service.get(requiredId(asRecord(raw).taskId, '图片任务标识缺失')) }],
    [channels.cancel, (event, raw) => { remember((event as Electron.IpcMainInvokeEvent).sender); return service.cancel(requiredId(asRecord(raw).taskId, '图片任务标识缺失')) }],
    [channels.retry, (event, raw) => { remember((event as Electron.IpcMainInvokeEvent).sender); return service.retry(requiredId(asRecord(raw).taskId, '图片任务标识缺失')) }],
    [channels.archive, (event, raw) => { remember((event as Electron.IpcMainInvokeEvent).sender); return service.archive(requiredId(asRecord(raw).taskId, '图片任务标识缺失')) }],
    [channels.restore, (event, raw) => { remember((event as Electron.IpcMainInvokeEvent).sender); return service.restore(requiredId(asRecord(raw).taskId, '图片任务标识缺失')) }],
    [channels.remove, (event, raw) => { remember((event as Electron.IpcMainInvokeEvent).sender); const input = asRecord(raw); return service.remove(requiredId(input.taskId, '图片任务标识缺失'), typeof input.localPath === 'string' ? input.localPath : undefined) }],
    [channels.pause, (event, raw) => { remember((event as Electron.IpcMainInvokeEvent).sender); const id = asRecord(raw).connectionId; return service.pause(id === undefined ? undefined : requiredId(id, '连接标识缺失')) }],
    [channels.resume, (event, raw) => { remember((event as Electron.IpcMainInvokeEvent).sender); const id = asRecord(raw).connectionId; return service.resume(id === undefined ? undefined : requiredId(id, '连接标识缺失')) }],
    [channels.setConcurrency, (event, raw) => { remember((event as Electron.IpcMainInvokeEvent).sender); const input = asRecord(raw); return service.setConnectionConcurrency({ connectionId: requiredId(input.connectionId, '连接标识缺失'), maxConcurrency: input.maxConcurrency as number }) }],
    [channels.revealOutput, async (_event, raw) => {
      const input = asRecord(raw)
      let targetPath: string | undefined = typeof input.localPath === 'string' ? input.localPath.trim() : undefined
      if (!targetPath && typeof input.taskId === 'string') {
        const task = await service.get(input.taskId)
        targetPath = task?.result?.images[0]?.localPath
      }
      if (!targetPath) {
        const root = getProjectRoot()
        if (root) {
          await shell.openPath(join(root, 'outputs'))
          return true
        }
        return false
      }
      shell.showItemInFolder(targetPath)
      return true
    }],
  ]
  for (const [channel, handler] of handlers) ipcMain.handle(channel, handler)
  return () => {
    unsubscribe()
    service.dispose()
    senders.clear()
    for (const [channel] of handlers) ipcMain.removeHandler(channel)
  }
}

export { channels as imageIpcChannels }
