import { contextBridge, ipcRenderer } from 'electron'
import type { CreateProjectInput, ProjectsApi, RelocateProjectInput } from '../shared/contracts/projects'
import type { SaveModelProfileInput, SaveProviderConnectionInput, SaveProviderGroupInput, SettingsApi, TestConnectionInput } from '../shared/contracts/settings'
import type { ContextApi, ReadProjectDocumentInput } from '../shared/contracts/context'
import type { ModelDiscoveryInput, TextApi, TextCompactInput, TextGenerateInput, TextStreamCompletedPayload, TextStreamEventPayload, TextStreamInput } from '../shared/contracts/text'
import type { ImageApi, ImageEnqueueInput, ImageTaskEvent, ImageTaskListInput } from '../shared/contracts/images'
import type { LibraryApi, ListMemoryEntriesInput, ListProjectAssetsInput, ListProjectItemsInput, ListPromptAssetsInput, ListPromptPageInput, PromptCatalogSource, SaveMemoryEntryInput, SavePromptAssetInput, UpdateMemoryEntryInput, UpdatePromptAssetInput } from '../shared/contracts/library'
import type { CreateTaskInput, TaskApi, TaskBatchInput, TaskEvent, TaskListInput } from '../shared/contracts/tasks'
import type { InstallSkillInput, LinkSkillInput, SkillApi, UpdateSkillInput } from '../shared/contracts/skills'
import type { AgentApi, AgentRunInput, AgentStreamEventPayload, PlanImageInput, RunSkillInput } from '../shared/contracts/agent'
import type { SearchApi } from '../shared/contracts/search'
import type { EditorApi, SaveImageEditorVersionInput } from '../shared/contracts/editor'
import type { CanvasApi } from '../shared/contracts/canvas'
import type { QuickPrompt, QuickPromptInput } from '../shared/quick-prompts'
import type { ConversationApi, WorkspaceSession } from '../shared/contracts/conversations'
import { windowLifecycleChannels, type WindowCloseDecision, type WindowClosePreference, type WindowLifecycleApi } from '../shared/contracts/window-lifecycle'
import { runtimeLogChannels, type RuntimeLogsApi } from '../shared/contracts/logging'

const runtime = Object.freeze({
  chrome: process.versions.chrome ?? null,
  electron: process.versions.electron ?? null,
  node: process.versions.node ?? null,
  platform: process.platform,
})

const projects: ProjectsApi = Object.freeze({
  listRecent: () => ipcRenderer.invoke('projects:list-recent'),
  create: (input: CreateProjectInput) => ipcRenderer.invoke('projects:create', input),
  open: (input?: { projectRoot: string }) => ipcRenderer.invoke('projects:open', input),
  relocate: (input: RelocateProjectInput) => ipcRenderer.invoke('projects:relocate', input),
})

const settings: SettingsApi = Object.freeze({
  get: () => ipcRenderer.invoke('settings:get'),
  saveGroup: (input: SaveProviderGroupInput) => ipcRenderer.invoke('settings:save-group', input),
  deleteGroup: (id: string) => ipcRenderer.invoke('settings:delete-group', id),
  saveConnection: (input: SaveProviderConnectionInput) => ipcRenderer.invoke('settings:save-connection', input),
  deleteConnection: (id: string) => ipcRenderer.invoke('settings:delete-connection', id),
  saveModel: (input: SaveModelProfileInput) => ipcRenderer.invoke('settings:save-model', input),
  deleteModel: (id: string) => ipcRenderer.invoke('settings:delete-model', id),
  setDefaults: (input: { textModelId?: string | null; imageModelId?: string | null }) => ipcRenderer.invoke('settings:set-defaults', input),
  testConnection: (input: TestConnectionInput) => ipcRenderer.invoke('settings:test-connection', input),
})

const models: TextApi = Object.freeze({
  discoverModels: (input: ModelDiscoveryInput) => ipcRenderer.invoke('models:discover', input),
  generate: (input: TextGenerateInput) => ipcRenderer.invoke('models:generate', input),
  compact: (input: TextCompactInput) => ipcRenderer.invoke('models:compact', input),
  startStream: (input: TextStreamInput) => ipcRenderer.invoke('models:start-stream', input),
  stopStream: (requestId: string) => ipcRenderer.invoke('models:stop-stream', { requestId }),
  onStreamEvent: (listener: (payload: TextStreamEventPayload) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: TextStreamEventPayload) => listener(payload)
    ipcRenderer.on('models:text-stream-event', handler)
    return () => ipcRenderer.removeListener('models:text-stream-event', handler)
  },
  onStreamComplete: (listener: (payload: TextStreamCompletedPayload) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: TextStreamCompletedPayload) => listener(payload)
    ipcRenderer.on('models:text-stream-complete', handler)
    return () => ipcRenderer.removeListener('models:text-stream-complete', handler)
  },
})

const context: ContextApi = Object.freeze({
  readProjectFile: (input: Omit<ReadProjectDocumentInput, 'projectRoot'>) => ipcRenderer.invoke('context:read-project-file', input),
  chooseAndReadProjectFile: () => ipcRenderer.invoke('context:choose-and-read-project-file'),
  chooseAndReadAttachments: () => ipcRenderer.invoke('context:choose-and-read-attachments'),
})

const images: ImageApi = Object.freeze({
  enqueue: (input: ImageEnqueueInput) => ipcRenderer.invoke('images:enqueue', input),
  list: (input?: ImageTaskListInput) => ipcRenderer.invoke('images:list', input ?? {}),
  get: (taskId: string) => ipcRenderer.invoke('images:get', { taskId }),
  cancel: (taskId: string) => ipcRenderer.invoke('images:cancel', { taskId }),
  retry: (taskId: string) => ipcRenderer.invoke('images:retry', { taskId }),
  archive: (taskId: string) => ipcRenderer.invoke('images:archive', { taskId }),
  restore: (taskId: string) => ipcRenderer.invoke('images:restore', { taskId }),
  remove: (taskId: string, localPath?: string) => ipcRenderer.invoke('images:remove', { taskId, ...(localPath ? { localPath } : {}) }),
  pause: (connectionId?: string) => ipcRenderer.invoke('images:pause', connectionId ? { connectionId } : {}),
  resume: (connectionId?: string) => ipcRenderer.invoke('images:resume', connectionId ? { connectionId } : {}),
  setConnectionConcurrency: (input: { connectionId: string; maxConcurrency: number }) => ipcRenderer.invoke('images:set-concurrency', input),
  revealOutput: (input?: { taskId?: string; localPath?: string }) => ipcRenderer.invoke('images:reveal-output', input ?? {}),
  onTaskEvent: (listener: (event: ImageTaskEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: ImageTaskEvent) => listener(payload)
    ipcRenderer.on('images:task-event', handler)
    return () => ipcRenderer.removeListener('images:task-event', handler)
  },
})

const library: LibraryApi = Object.freeze({
  listPrompts: (input: Omit<ListPromptAssetsInput, 'projectRoot'>) => ipcRenderer.invoke('library:list-prompts', input),
  listPromptPage: (input: Omit<ListPromptPageInput, 'projectRoot'>) => ipcRenderer.invoke('library:list-prompt-page', input),
  releasePromptLibraryResources: () => ipcRenderer.invoke('library:release-prompt-library-resources'),
  searchPromptLibrary: (input: { query: string; limit?: number }) => ipcRenderer.invoke('library:search-prompt-library', input),
  getPrompt: (input: { id: string; scope: 'global' | 'project' }) => ipcRenderer.invoke('library:get-prompt', input),
  savePrompt: (input: Omit<SavePromptAssetInput, 'projectRoot'>) => ipcRenderer.invoke('library:save-prompt', input),
  quickSavePrompt: (input: Omit<SavePromptAssetInput, 'projectRoot'>) => ipcRenderer.invoke('library:quick-save-prompt', input),
  updatePrompt: (input: Omit<UpdatePromptAssetInput, 'projectRoot'>) => ipcRenderer.invoke('library:update-prompt', input),
  removePrompt: (input: { id: string; scope: 'global' | 'project' }) => ipcRenderer.invoke('library:remove-prompt', input),
  syncPromptCatalog: (input: { source: PromptCatalogSource }) => ipcRenderer.invoke('library:sync-prompt-catalog', input),
  listPromptCatalogSources: () => ipcRenderer.invoke('library:list-prompt-catalog-sources'),
  getEmbeddingStatus: () => ipcRenderer.invoke('library:get-embedding-status'),
  installEmbeddingModel: () => ipcRenderer.invoke('library:install-embedding-model'),
  updateEmbeddings: () => ipcRenderer.invoke('library:update-embeddings'),
  rebuildEmbeddings: () => ipcRenderer.invoke('library:rebuild-embeddings'),
  clearEmbeddings: () => ipcRenderer.invoke('library:clear-embeddings'),
  uninstallEmbeddingModel: () => ipcRenderer.invoke('library:uninstall-embedding-model'),
  listQuickPrompts: (input?: { legacyItems?: readonly QuickPrompt[] }) => ipcRenderer.invoke('library:list-quick-prompts', input ?? {}),
  saveQuickPrompt: (input: QuickPromptInput) => ipcRenderer.invoke('library:save-quick-prompt', input),
  removeQuickPrompt: (input: { id: string }) => ipcRenderer.invoke('library:remove-quick-prompt', input),
  listMemories: (input: Omit<ListMemoryEntriesInput, 'projectRoot'>) => ipcRenderer.invoke('library:list-memories', input),
  getMemory: (input: { id: string; scope: 'global' | 'project' }) => ipcRenderer.invoke('library:get-memory', input),
  saveMemory: (input: Omit<SaveMemoryEntryInput, 'projectRoot'>) => ipcRenderer.invoke('library:save-memory', input),
  updateMemory: (input: Omit<UpdateMemoryEntryInput, 'projectRoot'>) => ipcRenderer.invoke('library:update-memory', input),
  removeMemory: (input: { id: string; scope: 'global' | 'project' }) => ipcRenderer.invoke('library:remove-memory', input),
  listProjectItems: (input: Omit<ListProjectItemsInput, 'projectRoot'>) => ipcRenderer.invoke('library:list-project-items', input),
  inspectProjectItem: (input: { filePath: string }) => ipcRenderer.invoke('library:inspect-project-item', input),
  saveProjectDocument: (input: { title: string; content: string; filename?: string; extension?: string }) => ipcRenderer.invoke('library:save-project-document', input),
  updateProjectDocument: (input: { filePath: string; title: string; content: string }) => ipcRenderer.invoke('library:update-project-document', input),
  deleteProjectDocument: (input: { filePath: string }) => ipcRenderer.invoke('library:delete-project-document', input),
  importAssets: (input?: { filePaths?: string[]; category?: import('../shared/contracts/library').ProjectAssetCategory }) => ipcRenderer.invoke('library:import-assets', input),
  chooseReferenceImages: () => ipcRenderer.invoke('library:choose-reference-images'),
  saveReferenceImage: (input: { name: string; dataUrl: string }) => ipcRenderer.invoke('library:save-reference-image', input),
  listAssets: (input?: ListProjectAssetsInput) => ipcRenderer.invoke('library:list-assets', input ?? {}),
  updateAsset: (input: { id: string; category: import('../shared/contracts/library').ProjectAssetCategory }) => ipcRenderer.invoke('library:update-asset', input),
  removeAsset: (input: { id: string }) => ipcRenderer.invoke('library:remove-asset', input),
  getAssetPreview: (input: { id: string }) => ipcRenderer.invoke('library:get-asset-preview', input),
  revealAsset: (input: { id?: string; relativePath?: string }) => ipcRenderer.invoke('library:reveal-asset', input),
})

const tasks: TaskApi = Object.freeze({
  create: (input: CreateTaskInput) => ipcRenderer.invoke('tasks:create', input),
  list: (input?: TaskListInput) => ipcRenderer.invoke('tasks:list', input ?? {}),
  get: (taskId: string) => ipcRenderer.invoke('tasks:get', { taskId }),
  rename: (taskId: string, title: string) => ipcRenderer.invoke('tasks:rename', { taskId, title }),
  cancel: (taskId: string) => ipcRenderer.invoke('tasks:cancel', { taskId }),
  retry: (taskId: string) => ipcRenderer.invoke('tasks:retry', { taskId }),
  archive: (taskId: string) => ipcRenderer.invoke('tasks:archive', { taskId }),
  restore: (taskId: string) => ipcRenderer.invoke('tasks:restore', { taskId }),
  remove: (taskId: string) => ipcRenderer.invoke('tasks:remove', { taskId }),
  batch: (input: TaskBatchInput) => ipcRenderer.invoke('tasks:batch', input),
  getQueueState: () => ipcRenderer.invoke('tasks:queue-state'),
  pause: () => ipcRenderer.invoke('tasks:pause'),
  resume: () => ipcRenderer.invoke('tasks:resume'),
  onEvent: (listener: (event: TaskEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: TaskEvent) => listener(payload)
    ipcRenderer.on('tasks:event', handler)
    return () => ipcRenderer.removeListener('tasks:event', handler)
  },
  onTaskEvent: (listener: (event: TaskEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: TaskEvent) => listener(payload)
    ipcRenderer.on('tasks:event', handler)
    return () => ipcRenderer.removeListener('tasks:event', handler)
  },
})

const skills: SkillApi = Object.freeze({
  list: () => ipcRenderer.invoke('skills:list'),
  link: (input: LinkSkillInput) => ipcRenderer.invoke('skills:link', input),
  install: (input: InstallSkillInput) => ipcRenderer.invoke('skills:install', input),
  update: (input: UpdateSkillInput) => ipcRenderer.invoke('skills:update', input),
  remove: (id: string) => ipcRenderer.invoke('skills:remove', { id }),
  rescan: (id: string) => ipcRenderer.invoke('skills:rescan', { id }),
})

const agent: AgentApi = Object.freeze({
  planImage: (input: PlanImageInput) => ipcRenderer.invoke('agent:plan-image', input),
  runSkill: (input: RunSkillInput) => ipcRenderer.invoke('agent:run-skill', input),
  run: (input: AgentRunInput) => ipcRenderer.invoke('agent:run', input),
  onStreamEvent: (listener: (payload: AgentStreamEventPayload) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: AgentStreamEventPayload) => listener(payload)
    ipcRenderer.on('agent:text-stream-event', handler)
    return () => ipcRenderer.removeListener('agent:text-stream-event', handler)
  },
  confirm: (runId: string) => ipcRenderer.invoke('agent:confirm', { runId }),
  cancel: (runId: string) => ipcRenderer.invoke('agent:cancel', { runId }),
  cancelSkill: (runId: string) => ipcRenderer.invoke('agent:cancel-skill', { runId }),
  list: () => ipcRenderer.invoke('agent:list'),
})

const search: SearchApi = Object.freeze({
  search: (input: Parameters<SearchApi['search']>[0]) => ipcRenderer.invoke('search:web', input),
})

const editor: EditorApi = Object.freeze({
  saveVersion: (input: Omit<SaveImageEditorVersionInput, 'projectRoot'>) => ipcRenderer.invoke('editor:save-version', input),
  listVersions: () => ipcRenderer.invoke('editor:list-versions'),
  getVersionPreview: (id: string) => ipcRenderer.invoke('editor:get-version-preview', id),
})

const canvas: CanvasApi = Object.freeze({
  load: () => ipcRenderer.invoke('canvas:load'),
  save: (state: Parameters<CanvasApi['save']>[0]) => ipcRenderer.invoke('canvas:save', state),
})

const conversations: ConversationApi = Object.freeze({
  load: (input: { projectId: string; legacySessions?: readonly WorkspaceSession[]; legacyActiveId?: string }) => ipcRenderer.invoke('conversations:load', input),
  save: (input: { projectId: string; session: WorkspaceSession }) => ipcRenderer.invoke('conversations:save', input),
  remove: (input: { projectId: string; sessionId: string }) => ipcRenderer.invoke('conversations:remove', input),
  setActive: (input: { projectId: string; sessionId: string }) => ipcRenderer.invoke('conversations:set-active', input),
  onFlushRequested: (listener: () => void | Promise<void>) => {
    const handler = async (_event: Electron.IpcRendererEvent, payload: { requestId?: unknown }) => {
      if (typeof payload?.requestId !== 'string') return
      try {
        await listener()
        ipcRenderer.send('conversations:flush-result', { requestId: payload.requestId })
      } catch (error) {
        ipcRenderer.send('conversations:flush-result', { requestId: payload.requestId, error: error instanceof Error ? error.message : '会话保存失败' })
      }
    }
    ipcRenderer.on('conversations:flush-requested', handler)
    return () => ipcRenderer.removeListener('conversations:flush-requested', handler)
  },
})

const windowLifecycle: WindowLifecycleApi = Object.freeze({
  getPreference: () => ipcRenderer.invoke(windowLifecycleChannels.getPreference),
  setPreference: (preference: WindowClosePreference) => ipcRenderer.invoke(windowLifecycleChannels.setPreference, preference),
  onCloseIntent: (listener: () => WindowCloseDecision | Promise<WindowCloseDecision>) => {
    const handler = async (_event: Electron.IpcRendererEvent, payload: { requestId?: unknown }) => {
      if (typeof payload?.requestId !== 'string') return
      let decision: WindowCloseDecision = { action: 'cancel', remember: false }
      try {
        decision = await listener()
      } finally {
        ipcRenderer.send(windowLifecycleChannels.closeDecision, { requestId: payload.requestId, decision })
      }
    }
    ipcRenderer.on(windowLifecycleChannels.closeIntent, handler)
    return () => ipcRenderer.removeListener(windowLifecycleChannels.closeIntent, handler)
  },
})

const logs: RuntimeLogsApi = Object.freeze({
  list: () => ipcRenderer.invoke(runtimeLogChannels.list),
  recordError: (input: { message: string; area: 'conversation' | 'renderer' }) => ipcRenderer.invoke(runtimeLogChannels.recordError, input),
})

contextBridge.exposeInMainWorld('latentStudio', Object.freeze({ runtime, projects, settings, models, context, images, library, tasks, skills, agent, search, editor, canvas, conversations, windowLifecycle, logs }))

export type LatentStudioRuntime = typeof runtime

declare global {
  interface Window {
    latentStudio: {
      readonly runtime: LatentStudioRuntime
      readonly projects: ProjectsApi
      readonly settings: SettingsApi
      readonly models: TextApi
      readonly context: ContextApi
      readonly images: ImageApi
      readonly library: LibraryApi
      readonly tasks: TaskApi
      readonly skills: SkillApi
      readonly agent: AgentApi
      readonly search: SearchApi
      readonly editor: EditorApi
      readonly canvas: CanvasApi
      readonly conversations: ConversationApi
      readonly windowLifecycle: WindowLifecycleApi
      readonly logs: RuntimeLogsApi
    }
  }
}
