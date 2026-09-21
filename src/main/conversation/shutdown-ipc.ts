import { randomUUID } from 'node:crypto'
import type { BrowserWindow, IpcMain, IpcMainEvent, WebContents } from 'electron'

export const conversationFlushChannels = {
  request: 'conversations:flush-requested',
  result: 'conversations:flush-result',
} as const

interface PendingFlush {
  sender: WebContents
  resolve(): void
  reject(error: Error): void
}

export function createConversationFlushRequester(ipc: Pick<IpcMain, 'on' | 'removeListener'>): { request(window: BrowserWindow): Promise<void>; dispose(): void } {
  const pending = new Map<string, PendingFlush>()
  const receive = (event: IpcMainEvent, raw: unknown) => {
    if (!raw || typeof raw !== 'object') return
    const payload = raw as { requestId?: unknown; error?: unknown }
    if (typeof payload.requestId !== 'string') return
    const request = pending.get(payload.requestId)
    if (!request || request.sender !== event.sender) return
    pending.delete(payload.requestId)
    if (typeof payload.error === 'string' && payload.error) request.reject(new Error(payload.error))
    else request.resolve()
  }
  ipc.on(conversationFlushChannels.result, receive)

  return {
    request(window) {
      if (window.isDestroyed() || window.webContents.isDestroyed()) return Promise.reject(new Error('工作台窗口已关闭'))
      const requestId = randomUUID()
      return new Promise<void>((resolve, reject) => {
        pending.set(requestId, { sender: window.webContents, resolve, reject })
        window.webContents.send(conversationFlushChannels.request, { requestId })
      })
    },
    dispose() {
      ipc.removeListener(conversationFlushChannels.result, receive)
      for (const request of pending.values()) request.reject(new Error('应用正在退出'))
      pending.clear()
    },
  }
}
