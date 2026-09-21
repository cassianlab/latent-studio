interface SingleInstanceApp {
  requestSingleInstanceLock(): boolean
  on(event: 'second-instance', listener: () => void): void
  quit(): void
}

interface FocusableWindow {
  isDestroyed(): boolean
  isMinimized(): boolean
  restore(): void
  show(): void
  focus(): void
}

export function registerSingleInstanceGuard(app: SingleInstanceApp, getWindows: () => FocusableWindow[]): boolean {
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return false
  }

  app.on('second-instance', () => {
    const existingWindow = getWindows().find((window) => !window.isDestroyed())
    if (!existingWindow) return
    if (existingWindow.isMinimized()) existingWindow.restore()
    existingWindow.show()
    existingWindow.focus()
  })
  return true
}
