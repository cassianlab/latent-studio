import { app, BrowserWindow, ipcMain } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createMainWindow, createWindowCloseIntentRequester, createWindowLifecycleCoordinator, registerSingleInstanceGuard, registerWindowLifecycleIpc, type WindowLifecycleCoordinator } from './app'
import { registerProjectIpc } from './projects/ipc'
import { SqliteRecentProjectsStore } from './projects/recent'
import { createMainRuntime, type MainRuntime } from './runtime'
import { registerSettingsIpc, SettingsStore } from './settings'
import type { RecentProjectsStore } from '../shared/contracts/projects'
import { registerModelsIpc } from './models/ipc'
import { registerContextIpc } from './context/ipc'
import { registerImagesIpc } from './images/ipc'
import { registerLibraryIpc } from './library/ipc'
import { registerTasksIpc } from './tasks/ipc'
import { registerSkillsIpc } from './skills/ipc'
import { registerAgentIpc } from './agent/ipc'
import { registerSearchIpc } from './search/ipc'
import type { ImageModelService } from './images/service'
import type { AgentRunner } from './agent/runner'
import type { ProjectDatabase } from './projects/database'
import { registerEditorIpc } from './editor/ipc'
import { registerCanvasIpc } from './canvas/ipc'
import { registerConversationIpc } from './conversation/ipc'
import { createConversationFlushRequester } from './conversation/shutdown-ipc'
import { createConversationShutdownCoordinator } from './conversation/shutdown'
import { registerRuntimeLogIpc } from './logging'

let unregisterProjectIpc: (() => void) | undefined
let unregisterSettingsIpc: (() => void) | undefined
let unregisterModelsIpc: (() => void) | undefined
let unregisterContextIpc: (() => void) | undefined
let unregisterImagesIpc: (() => void) | undefined
let unregisterLibraryIpc: (() => void) | undefined
let unregisterTasksIpc: (() => void) | undefined
let unregisterSkillsIpc: (() => void) | undefined
let unregisterAgentIpc: (() => void) | undefined
let unregisterSearchIpc: (() => void) | undefined
let unregisterEditorIpc: (() => void) | undefined
let unregisterCanvasIpc: (() => void) | undefined
let unregisterConversationIpc: (() => void) | undefined
let unregisterWindowLifecycleIpc: (() => void) | undefined
let unregisterRuntimeLogIpc: (() => void) | undefined
let recentStore: RecentProjectsStore | undefined
let runtime: MainRuntime | undefined
let activeProjectRoot: string | undefined
let activeImageService: ImageModelService | undefined
let activeAgentRunner: AgentRunner | undefined
let activeProjectDatabase: ProjectDatabase | undefined
let activeProjectId: string | undefined
let windowLifecycle: WindowLifecycleCoordinator<BrowserWindow> | undefined
const isSmokeTest = process.env.LATENT_STUDIO_SMOKE === '1'
const canStart = isSmokeTest || registerSingleInstanceGuard(app, () => BrowserWindow.getAllWindows())

const conversationFlushRequester = createConversationFlushRequester(ipcMain)
const windowCloseIntentRequester = createWindowCloseIntentRequester(ipcMain)
let windowDiagnosticQueue = Promise.resolve()

function recordWindowDiagnostic(event: string, context: Record<string, unknown> = {}): void {
  const logger = runtime?.diagnosticLogger
  if (!logger) return
  windowDiagnosticQueue = windowDiagnosticQueue.then(() => logger.log({ level: 'info', message: event, context })).catch((error) => {
    console.error('Failed to record window lifecycle diagnostic', error)
  })
}

function closeMainRuntime(): void {
  unregisterAgentIpc?.()
  unregisterAgentIpc = undefined
  unregisterProjectIpc?.()
  unregisterProjectIpc = undefined
  unregisterSettingsIpc?.()
  unregisterSettingsIpc = undefined
  unregisterModelsIpc?.()
  unregisterModelsIpc = undefined
  unregisterContextIpc?.()
  unregisterContextIpc = undefined
  unregisterImagesIpc?.()
  unregisterImagesIpc = undefined
  unregisterLibraryIpc?.()
  unregisterLibraryIpc = undefined
  unregisterTasksIpc?.()
  unregisterTasksIpc = undefined
  unregisterSkillsIpc?.()
  unregisterSkillsIpc = undefined
  unregisterSearchIpc?.()
  unregisterSearchIpc = undefined
  unregisterEditorIpc?.()
  unregisterEditorIpc = undefined
  unregisterCanvasIpc?.()
  unregisterCanvasIpc = undefined
  unregisterConversationIpc?.()
  unregisterConversationIpc = undefined
  unregisterWindowLifecycleIpc?.()
  unregisterWindowLifecycleIpc = undefined
  unregisterRuntimeLogIpc?.()
  unregisterRuntimeLogIpc = undefined
  windowLifecycle?.dispose()
  windowLifecycle = undefined
  activeProjectRoot = undefined
  activeProjectDatabase = undefined
  activeProjectId = undefined
  activeImageService = undefined
  activeAgentRunner = undefined
  runtime?.close()
  runtime = undefined
  conversationFlushRequester.dispose()
  windowCloseIntentRequester.dispose()
  conversationShutdown.dispose()
}

const conversationShutdown = createConversationShutdownCoordinator({
  app,
  requestFlush: async (window: BrowserWindow) => {
    await conversationFlushRequester.request(window)
    activeAgentRunner?.cancelAll()
    await activeAgentRunner?.flushPersistence()
    recordWindowDiagnostic('app-exit-cleanup-completed', { conversationFlushed: true, agentPersistenceFlushed: true })
    await windowDiagnosticQueue
  },
  finalize: closeMainRuntime,
  timeoutMs: 5_000,
  onFlushFailure: (error) => {
    console.error('Failed to flush conversations before shutdown', error)
    recordWindowDiagnostic('app-exit-cleanup-failed', { error })
  },
})

function openWindow(): BrowserWindow {
  if (!runtime) throw new Error('Main runtime is not initialized')
  unregisterAgentIpc?.()
  unregisterProjectIpc?.()
  unregisterSettingsIpc?.()
  unregisterModelsIpc?.()
  unregisterContextIpc?.()
  unregisterImagesIpc?.()
  unregisterLibraryIpc?.()
  unregisterTasksIpc?.()
  unregisterSkillsIpc?.()
  unregisterSearchIpc?.()
  unregisterEditorIpc?.()
  unregisterCanvasIpc?.()
  unregisterConversationIpc?.()
  unregisterWindowLifecycleIpc?.()
  unregisterRuntimeLogIpc?.()
  windowLifecycle?.dispose()
  activeProjectRoot = undefined
  activeProjectDatabase = undefined
  activeProjectId = undefined
  const window = createMainWindow()
  window.on('unresponsive', () => recordWindowDiagnostic('renderer-unresponsive'))
  window.on('responsive', () => recordWindowDiagnostic('renderer-responsive'))
  window.webContents.on('render-process-gone', (_event, details) => recordWindowDiagnostic('renderer-process-gone', { ...details }))
  recentStore ??= new SqliteRecentProjectsStore(runtime.globalDatabase)
  const settingsStore = new SettingsStore(runtime.globalDatabase, runtime.credentialStore)
  windowLifecycle = createWindowLifecycleCoordinator({
    app,
    getPreference: () => settingsStore.getWindowClosePreference(),
    setPreference: (preference) => settingsStore.setWindowClosePreference(preference),
    requestDecision: (target) => windowCloseIntentRequester.request(target),
    recordDiagnostic: recordWindowDiagnostic,
  })
  const unguardShutdownWindow = conversationShutdown.guardWindow(window, { handleClose: false })
  const unguardLifecycleWindow = windowLifecycle.guardWindow(window)
  window.once('closed', () => {
    unguardShutdownWindow()
    unguardLifecycleWindow()
  })
  unregisterWindowLifecycleIpc = registerWindowLifecycleIpc({ store: settingsStore, recordDiagnostic: recordWindowDiagnostic })
  unregisterRuntimeLogIpc = registerRuntimeLogIpc(runtime.errorLogger, runtime.diagnosticLogger)
  unregisterProjectIpc = registerProjectIpc({
    window,
    recent: recentStore,
    onProjectOpened: async (handle) => {
      activeAgentRunner?.cancelAll()
      await activeAgentRunner?.flushPersistence()
      activeProjectRoot = handle.rootPath
      activeProjectDatabase = handle.database
      activeProjectId = handle.manifest.id
      await activeAgentRunner?.switchProject(handle.rootPath)
      await activeImageService?.switchProject()
    },
  })
  unregisterSettingsIpc = registerSettingsIpc({ store: settingsStore })
  unregisterModelsIpc = registerModelsIpc({ store: settingsStore })
  unregisterContextIpc = registerContextIpc({ window, getProjectRoot: () => activeProjectRoot })
  activeImageService = undefined
  unregisterImagesIpc = registerImagesIpc({ store: settingsStore, getProjectRoot: () => activeProjectRoot, onService: (service) => { activeImageService = service } })
  unregisterLibraryIpc = registerLibraryIpc({ window, database: runtime.globalDatabase, userDataPath: app.getPath('userData'), getProjectRoot: () => activeProjectRoot })
  unregisterTasksIpc = registerTasksIpc({ getProjectRoot: () => activeProjectRoot, imageApi: activeImageService })
  unregisterSkillsIpc = registerSkillsIpc({ window, userDataPath: app.getPath('userData'), builtInRoot: join(app.getAppPath(), 'skills', 'builtin'), getProjectRoot: () => activeProjectRoot })
  activeAgentRunner = undefined
  unregisterAgentIpc = registerAgentIpc({ store: settingsStore, database: runtime.globalDatabase, userDataPath: app.getPath('userData'), builtInRoot: join(app.getAppPath(), 'skills', 'builtin'), getProjectRoot: () => activeProjectRoot, getProjectDatabase: (projectRoot) => projectRoot === activeProjectRoot ? activeProjectDatabase : undefined, imageApi: activeImageService, onRunner: (runner) => { activeAgentRunner = runner } })
  unregisterSearchIpc = registerSearchIpc({ getProjectRoot: () => activeProjectRoot })
  unregisterEditorIpc = registerEditorIpc({ getProjectRoot: () => activeProjectRoot })
  unregisterCanvasIpc = registerCanvasIpc({ getProjectRoot: () => activeProjectRoot })
  unregisterConversationIpc = registerConversationIpc(() => activeProjectId && activeProjectDatabase ? { id: activeProjectId, database: activeProjectDatabase } : undefined)
  return window
}

if (canStart) app.whenReady().then(async () => {
  if (process.platform === 'darwin' && app.dock) {
    const iconPath = join(app.getAppPath(), 'public/icon.png')
    if (existsSync(iconPath)) {
      app.dock.setIcon(iconPath)
    }
  }
  runtime = await createMainRuntime(app.getPath('userData'))
  if (isSmokeTest) {
    if (process.env.LATENT_STUDIO_SMOKE_WINDOW === '1') {
      const window = openWindow()
      const finish = (ok: boolean) => {
        if (!ok) process.exitCode = 1
        app.quit()
      }
      window.webContents.once('did-fail-load', () => finish(false))
      window.webContents.once('did-finish-load', () => {
        void window.webContents.executeJavaScript('Boolean(window.latentStudio && window.latentStudio.runtime)')
          .then((ready) => finish(ready === true))
          .catch(() => finish(false))
      })
    } else {
      app.quit()
    }
    return
  }
  openWindow()

  app.on('activate', () => {
    const existingWindow = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed())
    if (!existingWindow) {
      openWindow()
    } else {
      existingWindow.show()
      existingWindow.focus()
    }
  })
}).catch((error: unknown) => {
  console.error('Latent Studio failed to initialize', error)
  app.quit()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
