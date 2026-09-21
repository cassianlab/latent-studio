import { randomUUID } from 'node:crypto'
import { ipcMain, type BrowserWindow, type IpcMain, type IpcMainEvent, type WebContents } from 'electron'
import { windowLifecycleChannels, type WindowCloseDecision, type WindowClosePreference } from '../../shared/contracts/window-lifecycle'
import type { SettingsStore } from '../settings'

interface PreventableEvent {
  preventDefault(): void
}

interface LifecycleApp {
  quit(): void
}

interface LifecycleWindow {
  on(event: 'close', listener: (event: PreventableEvent) => void): unknown
  removeListener(event: 'close', listener: (event: PreventableEvent) => void): unknown
  hide(): void
  isDestroyed(): boolean
}

interface LifecycleCoordinatorOptions<TWindow extends LifecycleWindow> {
  app: LifecycleApp
  getPreference(): WindowClosePreference
  setPreference(preference: WindowClosePreference): void
  requestDecision(window: TWindow): Promise<WindowCloseDecision>
  recordDiagnostic?(event: string, context?: Record<string, unknown>): void
}

export interface WindowLifecycleCoordinator<TWindow extends LifecycleWindow> {
  guardWindow(window: TWindow): () => void
  dispose(): void
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error
}

export function createWindowLifecycleCoordinator<TWindow extends LifecycleWindow>({
  app,
  getPreference,
  setPreference,
  requestDecision,
  recordDiagnostic,
}: LifecycleCoordinatorOptions<TWindow>): WindowLifecycleCoordinator<TWindow> {
  const guardedWindows = new Map<TWindow, (event: PreventableEvent) => void>()
  const pendingWindows = new WeakSet<TWindow>()
  const record = (event: string, context?: Record<string, unknown>) => recordDiagnostic?.(event, context)

  const applyAction = (window: TWindow, action: WindowCloseDecision['action']) => {
    if (window.isDestroyed() || action === 'cancel') {
      record('window-close-cancelled')
      return
    }
    if (action === 'minimize') {
      window.hide()
      record('window-close-minimized')
      return
    }
    record('window-close-quit-requested')
    app.quit()
  }

  return {
    guardWindow(window) {
      const close = (event: PreventableEvent) => {
        event.preventDefault()
        if (pendingWindows.has(window) || window.isDestroyed()) return
        pendingWindows.add(window)
        const preference = getPreference()
        record('window-close-intent', { preference })

        if (preference !== 'ask') {
          applyAction(window, preference)
          pendingWindows.delete(window)
          return
        }

        void requestDecision(window).then((decision) => {
          record('window-close-decision', { action: decision.action, remember: decision.remember })
          if (decision.remember && decision.action !== 'cancel') {
            setPreference(decision.action)
            record('window-close-preference-changed', { preference: decision.action })
          }
          applyAction(window, decision.action)
        }, (error) => {
          record('window-close-prompt-failed', { errorName: errorName(error) })
        }).finally(() => pendingWindows.delete(window))
      }
      guardedWindows.set(window, close)
      window.on('close', close)
      return () => {
        window.removeListener('close', close)
        guardedWindows.delete(window)
      }
    },
    dispose() {
      for (const [window, close] of guardedWindows) window.removeListener('close', close)
      guardedWindows.clear()
    },
  }
}

interface PendingDecision {
  sender: WebContents
  resolve(decision: WindowCloseDecision): void
}

function parseDecision(raw: unknown): WindowCloseDecision {
  if (!raw || typeof raw !== 'object') return { action: 'cancel', remember: false }
  const input = raw as { action?: unknown; remember?: unknown }
  const action = input.action === 'minimize' || input.action === 'quit' || input.action === 'cancel'
    ? input.action
    : 'cancel'
  return { action, remember: input.remember === true && action !== 'cancel' }
}

export function createWindowCloseIntentRequester(ipc: Pick<IpcMain, 'on' | 'removeListener'>): {
  request(window: BrowserWindow): Promise<WindowCloseDecision>
  dispose(): void
} {
  const pending = new Map<string, PendingDecision>()
  const receive = (event: IpcMainEvent, raw: unknown) => {
    if (!raw || typeof raw !== 'object') return
    const input = raw as { requestId?: unknown; decision?: unknown }
    if (typeof input.requestId !== 'string') return
    const request = pending.get(input.requestId)
    if (!request || request.sender !== event.sender) return
    pending.delete(input.requestId)
    request.resolve(parseDecision(input.decision))
  }
  ipc.on(windowLifecycleChannels.closeDecision, receive)

  return {
    request(window) {
      if (window.isDestroyed() || window.webContents.isDestroyed()) {
        return Promise.reject(new Error('工作台窗口已关闭'))
      }
      const requestId = randomUUID()
      return new Promise<WindowCloseDecision>((resolve) => {
        pending.set(requestId, { sender: window.webContents, resolve })
        window.webContents.send(windowLifecycleChannels.closeIntent, { requestId })
      })
    },
    dispose() {
      ipc.removeListener(windowLifecycleChannels.closeDecision, receive)
      for (const request of pending.values()) request.resolve({ action: 'cancel', remember: false })
      pending.clear()
    },
  }
}

export function registerWindowLifecycleIpc({
  store,
  recordDiagnostic,
  ipc = ipcMain,
}: {
  store: Pick<SettingsStore, 'getWindowClosePreference' | 'setWindowClosePreference'>
  recordDiagnostic?(event: string, context?: Record<string, unknown>): void
  ipc?: Pick<IpcMain, 'handle' | 'removeHandler'>
}): () => void {
  ipc.handle(windowLifecycleChannels.getPreference, () => store.getWindowClosePreference())
  ipc.handle(windowLifecycleChannels.setPreference, (_event, raw: unknown) => {
    if (raw !== 'ask' && raw !== 'minimize' && raw !== 'quit') throw new Error('窗口关闭偏好无效')
    store.setWindowClosePreference(raw)
    recordDiagnostic?.('window-close-preference-changed', { preference: raw, source: 'settings' })
    return raw
  })
  return () => {
    ipc.removeHandler(windowLifecycleChannels.getPreference)
    ipc.removeHandler(windowLifecycleChannels.setPreference)
  }
}
