interface PreventableEvent {
  preventDefault(): void
}

interface ShutdownApp {
  on(event: 'before-quit', listener: (event: PreventableEvent) => void): unknown
  removeListener(event: 'before-quit', listener: (event: PreventableEvent) => void): unknown
  quit(): void
}

interface ShutdownWindow {
  on(event: 'close', listener: (event: PreventableEvent) => void): unknown
  removeListener(event: 'close', listener: (event: PreventableEvent) => void): unknown
  close(): void
  isDestroyed(): boolean
}

interface ShutdownCoordinatorOptions<TWindow extends ShutdownWindow> {
  app: ShutdownApp
  requestFlush(window: TWindow): Promise<void>
  finalize(): void
  timeoutMs: number
  onFlushFailure?: (error: unknown) => void
}

export interface ConversationShutdownCoordinator<TWindow extends ShutdownWindow> {
  guardWindow(window: TWindow, options?: { handleClose?: boolean }): () => void
  dispose(): void
}

export function createConversationShutdownCoordinator<TWindow extends ShutdownWindow>({ app, requestFlush, finalize, timeoutMs, onFlushFailure }: ShutdownCoordinatorOptions<TWindow>): ConversationShutdownCoordinator<TWindow> {
  const guardedWindows = new Map<TWindow, (event: PreventableEvent) => void>()
  const closeAllowed = new WeakSet<TWindow>()
  const pendingFlushes = new Map<TWindow, Promise<void>>()
  let activeWindow: TWindow | undefined
  let allowQuit = false
  let quitting = false
  let finalized = false

  const reportFailure = (error: unknown) => { onFlushFailure?.(error) }
  const flush = (window: TWindow): Promise<void> => {
    const existing = pendingFlushes.get(window)
    if (existing) return existing
    let timer: ReturnType<typeof setTimeout> | undefined
    const bounded = new Promise<void>((resolve, reject) => {
      let settled = false
      const succeed = () => {
        if (settled) return
        settled = true
        resolve()
      }
      const fail = (error: unknown) => {
        if (settled) return
        settled = true
        reportFailure(error)
        reject(error)
      }
      timer = setTimeout(() => {
        fail(new Error('退出前保存对话超时'))
      }, timeoutMs)
      try {
        void requestFlush(window).then(succeed, fail)
      } catch (error) {
        fail(error)
      }
    }).finally(() => {
      if (timer) clearTimeout(timer)
      pendingFlushes.delete(window)
    })
    pendingFlushes.set(window, bounded)
    return bounded
  }

  const finalizeOnce = () => {
    if (finalized) return
    finalized = true
    finalize()
  }

  const finishQuit = () => {
    if (allowQuit) return
    allowQuit = true
    try { finalizeOnce() } finally { app.quit() }
  }

  const beforeQuit = (event: PreventableEvent) => {
    if (allowQuit) return
    event.preventDefault()
    if (quitting) return
    quitting = true
    const window = activeWindow
    if (!window || window.isDestroyed()) {
      finishQuit()
      return
    }
    void flush(window).then(finishQuit, () => { quitting = false })
  }

  app.on('before-quit', beforeQuit)

  return {
    guardWindow(window, options = {}) {
      activeWindow = window
      if (options.handleClose === false) {
        return () => {
          if (activeWindow === window) activeWindow = undefined
        }
      }
      const close = (event: PreventableEvent) => {
        if (allowQuit || closeAllowed.has(window)) {
          if (activeWindow === window) activeWindow = undefined
          return
        }
        event.preventDefault()
        void flush(window).then(() => {
          if (quitting || window.isDestroyed()) return
          closeAllowed.add(window)
          if (activeWindow === window) activeWindow = undefined
          window.close()
        }, () => undefined)
      }
      guardedWindows.set(window, close)
      window.on('close', close)
      return () => {
        window.removeListener('close', close)
        guardedWindows.delete(window)
        if (activeWindow === window) activeWindow = undefined
      }
    },
    dispose() {
      app.removeListener('before-quit', beforeQuit)
      for (const [window, close] of guardedWindows) window.removeListener('close', close)
      guardedWindows.clear()
      activeWindow = undefined
    },
  }
}
