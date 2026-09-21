import type { ImageApi, ImageEnqueueInput, ImageTaskEvent, ImageTaskRecord } from '../../shared/contracts/images'

const mockApi: ImageApi = {
  async enqueue() { throw new Error('浏览器预览不执行图片请求') },
  async list() { return [] },
  async get() { return null },
  async cancel() { return false },
  async retry() { return false },
  async archive() { return false },
  async restore() { return false },
  async remove(_taskId?: string, _localPath?: string) { return false },
  async pause() {},
  async resume() {},
  async setConnectionConcurrency() {},
  async revealOutput() { return false },
  onTaskEvent() { return () => {} },
}

export function getImageApi(): ImageApi {
  if (typeof window !== 'undefined' && window.latentStudio?.images) return window.latentStudio.images
  return mockApi
}

export type { ImageEnqueueInput, ImageTaskEvent, ImageTaskRecord }
