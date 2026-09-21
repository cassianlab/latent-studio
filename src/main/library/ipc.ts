import { dialog, ipcMain, shell, type BrowserWindow, type OpenDialogOptions } from 'electron'
import { promises as fs } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import type {
  LibraryApi,
  LibraryScope,
  ListMemoryEntriesInput,
  ListProjectItemsInput,
  ListPromptAssetsInput,
  SaveProjectDocumentInput,
  UpdateProjectDocumentInput,
  ProjectAssetCategory,
  SaveMemoryEntryInput,
  SavePromptAssetInput,
  UpdatePromptAssetInput,
  UpdateMemoryEntryInput,
} from '../../shared/contracts/library'
import type { GlobalDatabase } from '../config'
import { GlobalMemoryStore, GlobalPromptStore } from './global'
import { ProjectMemoryStore, ProjectPromptStore } from './project'
import { ProjectMetadataService } from './metadata'
import { LibraryError } from './errors'
import { ProjectAssetService } from './assets'
import { PROMPT_CATALOG_SOURCE_DEFINITIONS, describePromptCatalogSources, removeRetiredPromptCatalogImports, syncPromptCatalog } from './prompt-catalog'
import { detectReferenceImageMimeType, MAX_REFERENCE_IMAGES, MAX_REFERENCE_IMAGE_BYTES } from '../../shared/reference-images'
import { isQuickPrompt } from '../../shared/quick-prompts'
import { GlobalQuickPromptStore } from './quick-prompts'
import { PromptSearchService } from './prompt-search'
import { createLocalEmbeddingProvider } from './local-embedding-provider'
import { releasePromptLibraryResources } from './cache'
import { ensureLegacyPromptImports } from './prompt-import-normalization'
import { isMemoryCategory } from '../../shared/memory/categories'

const channels = {
  listPrompts: 'library:list-prompts',
  listPromptPage: 'library:list-prompt-page',
  releasePromptLibraryResources: 'library:release-prompt-library-resources',
  searchPromptLibrary: 'library:search-prompt-library',
  getPrompt: 'library:get-prompt',
  savePrompt: 'library:save-prompt',
  quickSavePrompt: 'library:quick-save-prompt',
  updatePrompt: 'library:update-prompt',
  removePrompt: 'library:remove-prompt',
  syncPromptCatalog: 'library:sync-prompt-catalog',
  listPromptCatalogSources: 'library:list-prompt-catalog-sources',
  getEmbeddingStatus: 'library:get-embedding-status',
  installEmbeddingModel: 'library:install-embedding-model',
  updateEmbeddings: 'library:update-embeddings',
  rebuildEmbeddings: 'library:rebuild-embeddings',
  clearEmbeddings: 'library:clear-embeddings',
  uninstallEmbeddingModel: 'library:uninstall-embedding-model',
  listQuickPrompts: 'library:list-quick-prompts',
  saveQuickPrompt: 'library:save-quick-prompt',
  removeQuickPrompt: 'library:remove-quick-prompt',
  listMemories: 'library:list-memories',
  getMemory: 'library:get-memory',
  saveMemory: 'library:save-memory',
  updateMemory: 'library:update-memory',
  removeMemory: 'library:remove-memory',
  listProjectItems: 'library:list-project-items',
  inspectProjectItem: 'library:inspect-project-item',
  saveProjectDocument: 'library:save-project-document',
  updateProjectDocument: 'library:update-project-document',
  deleteProjectDocument: 'library:delete-project-document',
  importAssets: 'library:import-assets',
  chooseReferenceImages: 'library:choose-reference-images',
  saveReferenceImage: 'library:save-reference-image',
  listAssets: 'library:list-assets',
  updateAsset: 'library:update-asset',
  removeAsset: 'library:remove-asset',
  getAssetPreview: 'library:get-asset-preview',
  revealAsset: 'library:reveal-asset',
} as const

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function requiredText(value: unknown, message: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new LibraryError('invalid-input', message)
  return value.trim()
}

function scope(value: unknown): LibraryScope {
  if (value !== 'global' && value !== 'project') throw new LibraryError('invalid-scope', '范围必须是 global 或 project')
  return value
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function optionalStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value as string[] : undefined
}

function promptTranslations(value: unknown): SavePromptAssetInput['translations'] | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const zh = optionalString(record['zh-CN'])
  const en = optionalString(record.en)
  return zh || en ? { ...(zh ? { 'zh-CN': zh } : {}), ...(en ? { en } : {}) } : undefined
}

async function readReferenceImageMimeType(path: string): Promise<ReturnType<typeof detectReferenceImageMimeType>> {
  const file = await fs.open(path, 'r')
  try {
    const header = Buffer.alloc(12)
    const { bytesRead } = await file.read(header, 0, header.length, 0)
    return detectReferenceImageMimeType(header.subarray(0, bytesRead))
  } finally {
    await file.close()
  }
}

export interface LibraryIpcOptions {
  window?: BrowserWindow
  database: GlobalDatabase
  userDataPath: string
  getProjectRoot: () => string | undefined
}

export function registerLibraryIpc({ window, database, userDataPath, getProjectRoot }: LibraryIpcOptions): () => void {
  removeRetiredPromptCatalogImports(database)
  for (const source of PROMPT_CATALOG_SOURCE_DEFINITIONS) {
    database.run(
      'INSERT INTO prompt_catalog_sources (id, display_name, repository_url, adapter_id, enabled) VALUES (?, ?, ?, ?, 1) ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, repository_url = excluded.repository_url, adapter_id = excluded.adapter_id',
      source.id, source.displayName, source.repositoryUrl, source.format,
    )
  }
  const globalPrompts = new GlobalPromptStore(database)
  const legacyPromptMigration = ensureLegacyPromptImports(database)
  void legacyPromptMigration.catch(() => {})
  const globalMemories = new GlobalMemoryStore(database)
  const quickPrompts = new GlobalQuickPromptStore(database)
  const projectPrompts = new ProjectPromptStore()
  const projectMemories = new ProjectMemoryStore()
  const metadata = new ProjectMetadataService()
  const assets = new ProjectAssetService()
  const promptSearch = new PromptSearchService({
    database,
    listGlobalPrompts: () => globalPrompts.list({ scope: 'global' }),
    listGlobalPromptPage: (afterRowId, limit) => globalPrompts.listForSearchIndex(afterRowId, limit),
    listProjectPrompts: async () => {
      const projectRoot = getProjectRoot()
      return projectRoot ? projectPrompts.list({ scope: 'project', projectRoot }) : []
    },
    embeddingProvider: createLocalEmbeddingProvider(join(userDataPath, 'embedding-models')),
  })

  const activeRoot = (): string => {
    const root = getProjectRoot()
    if (!root) throw Object.assign(new Error('请先打开一个项目'), { code: 'no-active-project' })
    return root
  }

  const promptStore = (selected: LibraryScope) => selected === 'global' ? globalPrompts : projectPrompts
  const memoryStore = (selected: LibraryScope) => selected === 'global' ? globalMemories : projectMemories
  const promptInput = (raw: unknown): SavePromptAssetInput => {
    const input = asRecord(raw)
    const selected = input.scope === undefined ? 'global' : scope(input.scope)
    return {
      name: input.name as string,
      content: input.content as string,
      scope: selected,
      ...(selected === 'project' ? { projectRoot: activeRoot() } : {}),
      ...(typeof input.kind === 'string' ? { kind: input.kind as SavePromptAssetInput['kind'] } : {}),
      ...(optionalStringArray(input.tags) ? { tags: optionalStringArray(input.tags) } : {}),
      ...(typeof input.favorite === 'boolean' ? { favorite: input.favorite } : {}),
      ...(typeof input.source === 'string' ? { source: input.source as SavePromptAssetInput['source'] } : {}),
      ...(optionalString(input.collection) ? { collection: optionalString(input.collection) } : {}),
      ...(optionalString(input.category) ? { category: optionalString(input.category) } : {}),
      ...(input.primaryLocale === 'zh-CN' || input.primaryLocale === 'en' || input.primaryLocale === 'und' ? { primaryLocale: input.primaryLocale } : {}),
      ...(promptTranslations(input.translations) ? { translations: promptTranslations(input.translations) } : {}),
      ...(optionalString(input.description) ? { description: optionalString(input.description) } : {}),
      ...(optionalString(input.previewUrl) ? { previewUrl: optionalString(input.previewUrl) } : {}),
      ...(optionalString(input.sourceUrl) ? { sourceUrl: optionalString(input.sourceUrl) } : {}),
    }
  }
  const memoryInput = (raw: unknown): SaveMemoryEntryInput => {
    const input = asRecord(raw)
    const selected = input.scope === undefined ? 'global' : scope(input.scope)
    if (input.category !== undefined && !isMemoryCategory(input.category)) throw new Error('记忆类别无效')
    return {
      title: input.title as string,
      content: input.content as string,
      scope: selected,
      ...(selected === 'project' ? { projectRoot: activeRoot() } : {}),
      ...(typeof input.active === 'boolean' ? { active: input.active } : {}),
      ...(isMemoryCategory(input.category) ? { category: input.category } : {}),
      ...(typeof input.source === 'string' ? { source: input.source } : {}),
    }
  }
  const listPromptInput = (raw: unknown): ListPromptAssetsInput => {
    const input = asRecord(raw)
    const selected = input.scope === undefined ? 'global' : scope(input.scope)
    const search = optionalString(input.search)
    return {
      scope: selected,
      ...(selected === 'project' ? { projectRoot: activeRoot() } : {}),
      ...(search ? { search } : {}),
      ...(input.kind === 'prompt' || input.kind === 'template' || input.kind === 'style' ? { kind: input.kind } : {}),
    }
  }
  const listMemoryInput = (raw: unknown): ListMemoryEntriesInput => {
    const input = asRecord(raw)
    const selected = input.scope === undefined ? 'global' : scope(input.scope)
    const search = optionalString(input.search)
    return {
      scope: selected,
      ...(selected === 'project' ? { projectRoot: activeRoot() } : {}),
      ...(search ? { search } : {}),
      ...(typeof input.activeOnly === 'boolean' ? { activeOnly: input.activeOnly } : {}),
    }
  }
  const idScopeInput = (raw: unknown): { id: string; scope: LibraryScope; projectRoot?: string } => {
    const input = asRecord(raw)
    const selected = scope(input.scope)
    return { id: requiredText(input.id, 'ID 不能为空'), scope: selected, ...(selected === 'project' ? { projectRoot: activeRoot() } : {}) }
  }
  const updateMemoryInput = (raw: unknown): UpdateMemoryEntryInput => {
    const input = asRecord(raw)
    const base = idScopeInput(raw)
    if (input.category !== undefined && !isMemoryCategory(input.category)) throw new Error('记忆类别无效')
    return {
      ...base,
      ...(typeof input.title === 'string' ? { title: input.title } : {}),
      ...(typeof input.content === 'string' ? { content: input.content } : {}),
      ...(typeof input.active === 'boolean' ? { active: input.active } : {}),
      ...(isMemoryCategory(input.category) ? { category: input.category } : {}),
      ...(typeof input.source === 'string' ? { source: input.source } : {}),
      ...(typeof input.lastUsedAt === 'string' ? { lastUsedAt: input.lastUsedAt } : {}),
    }
  }
  const updatePromptInput = (raw: unknown): UpdatePromptAssetInput => {
    const input = asRecord(raw)
    const base = idScopeInput(raw)
    return {
      ...base,
      ...(typeof input.name === 'string' ? { name: input.name } : {}),
      ...(typeof input.content === 'string' ? { content: input.content } : {}),
      ...(input.kind === 'prompt' || input.kind === 'template' || input.kind === 'style' ? { kind: input.kind } : {}),
      ...(optionalStringArray(input.tags) ? { tags: optionalStringArray(input.tags) } : {}),
      ...(typeof input.favorite === 'boolean' ? { favorite: input.favorite } : {}),
      ...(typeof input.source === 'string' ? { source: input.source as UpdatePromptAssetInput['source'] } : {}),
      ...(typeof input.collection === 'string' ? { collection: input.collection } : {}),
      ...(typeof input.category === 'string' ? { category: input.category } : {}),
      ...(input.primaryLocale === 'zh-CN' || input.primaryLocale === 'en' || input.primaryLocale === 'und' ? { primaryLocale: input.primaryLocale } : {}),
      ...(promptTranslations(input.translations) ? { translations: promptTranslations(input.translations) } : {}),
      ...(typeof input.description === 'string' || input.description === null ? { description: input.description as string | null } : {}),
      ...(typeof input.previewUrl === 'string' ? { previewUrl: input.previewUrl } : {}),
      ...(typeof input.sourceUrl === 'string' ? { sourceUrl: input.sourceUrl } : {}),
    }
  }
  const api: LibraryApi = {
    listPrompts: async (raw) => { const input = listPromptInput(raw); if (input.scope === 'global') await legacyPromptMigration; return promptStore(input.scope as LibraryScope).list(input) },
    listPromptPage: async (raw) => {
      const input = listPromptInput(raw)
      if (input.scope === 'global') await legacyPromptMigration
      const rawInput = asRecord(raw)
      const offset = typeof rawInput.offset === 'number' ? rawInput.offset : 0
      const limit = typeof rawInput.limit === 'number' ? rawInput.limit : 60
      const store = promptStore(input.scope as LibraryScope)
      const pageInput = {
        ...input,
        offset,
        limit,
        ...(typeof rawInput.source === 'string' ? { source: rawInput.source as import('../../shared/contracts/library').ListPromptPageInput['source'] } : {}),
        ...(typeof rawInput.category === 'string' ? { category: rawInput.category } : {}),
        ...(typeof rawInput.favoriteOnly === 'boolean' ? { favoriteOnly: rawInput.favoriteOnly } : {}),
      }
      if ('listPage' in store && typeof store.listPage === 'function') return store.listPage(pageInput)
      const items = await store.list(input)
      const pageItems = items.slice(Math.max(0, offset), Math.max(0, offset) + Math.min(100, Math.max(1, limit)))
      return { items: pageItems, total: items.length, offset: Math.max(0, offset), limit: Math.min(100, Math.max(1, limit)), hasMore: Math.max(0, offset) + pageItems.length < items.length, categories: [...new Set(items.map((item) => item.category))] }
    },
    releasePromptLibraryResources: () => releasePromptLibraryResources(window?.webContents.session),
    searchPromptLibrary: async (raw) => { await legacyPromptMigration; return promptSearch.search({ query: requiredText(asRecord(raw).query, '检索关键词不能为空'), ...(typeof asRecord(raw).limit === 'number' ? { limit: asRecord(raw).limit as number } : {}) }) },
    getPrompt: async (raw) => { const input = idScopeInput(raw); if (input.scope === 'global') await legacyPromptMigration; return promptStore(input.scope).get(input) },
    savePrompt: (raw) => { const input = promptInput(raw); return promptStore(input.scope).save(input) },
    quickSavePrompt: (raw) => { const input = promptInput(raw); return promptStore(input.scope).quickSave(input) },
    updatePrompt: (raw) => { const input = updatePromptInput(raw); return promptStore(input.scope).update(input) },
    removePrompt: (raw) => { const input = idScopeInput(raw); return promptStore(input.scope).remove(input) },
    syncPromptCatalog: (raw) => {
      const input = asRecord(raw)
      const supportedSources = new Set(PROMPT_CATALOG_SOURCE_DEFINITIONS.map((source) => source.id))
      if (typeof input.source !== 'string' || !supportedSources.has(input.source as import('../../shared/contracts/library').PromptCatalogSource)) throw new LibraryError('invalid-input', '不支持的提示词源')
      return syncPromptCatalog({
        source: input.source as import('../../shared/contracts/library').PromptCatalogSource,
        store: globalPrompts,
        database,
        cacheDirectory: join(userDataPath, 'prompt-catalog-cache'),
      })
    },
    listPromptCatalogSources: async () => PROMPT_CATALOG_SOURCE_DEFINITIONS.map((source) => ({
      id: source.id,
      displayName: source.displayName,
      repositoryUrl: source.repositoryUrl,
      localCount: globalPrompts.countImportedBySource({ tag: source.tag, collections: source.collections }),
    })),
    getEmbeddingStatus: () => promptSearch.embeddingStatus(),
    installEmbeddingModel: async () => { await promptSearch.installEmbeddingModel(); return promptSearch.updateEmbeddings() },
    updateEmbeddings: () => promptSearch.updateEmbeddings(),
    rebuildEmbeddings: () => promptSearch.rebuildEmbeddings(),
    clearEmbeddings: () => promptSearch.clearEmbeddings(),
    uninstallEmbeddingModel: () => promptSearch.uninstallEmbeddingModel(),
    listQuickPrompts: (raw) => {
      const input = asRecord(raw)
      const legacyItems = Array.isArray(input.legacyItems) && input.legacyItems.every(isQuickPrompt) ? input.legacyItems : undefined
      return quickPrompts.list(legacyItems)
    },
    saveQuickPrompt: (raw) => quickPrompts.save(raw),
    removeQuickPrompt: (raw) => quickPrompts.remove(requiredText(asRecord(raw).id, '快捷提示词标识不能为空')),
    listMemories: (raw) => { const input = listMemoryInput(raw); return memoryStore(input.scope as LibraryScope).list(input) },
    getMemory: (raw) => { const input = idScopeInput(raw); return memoryStore(input.scope).get(input) },
    saveMemory: (raw) => { const input = memoryInput(raw); return memoryStore(input.scope).save(input) },
    updateMemory: (raw) => { const input = updateMemoryInput(raw); return memoryStore(input.scope).update(input) },
    removeMemory: (raw) => { const input = idScopeInput(raw); return memoryStore(input.scope).remove(input) },
    listProjectItems: (raw) => {
      const input = asRecord(raw)
      return metadata.list({
        projectRoot: activeRoot(),
        ...(typeof input.directory === 'string' ? { directory: input.directory } : {}),
        ...(typeof input.recursive === 'boolean' ? { recursive: input.recursive } : {}),
        ...(typeof input.includeHidden === 'boolean' ? { includeHidden: input.includeHidden } : {}),
        ...(typeof input.maxEntries === 'number' ? { maxEntries: input.maxEntries } : {}),
      })
    },
    inspectProjectItem: (raw) => { const input = asRecord(raw); return metadata.inspect({ filePath: requiredText(input.filePath, '文件路径不能为空'), projectRoot: activeRoot() }) },
    saveProjectDocument: (raw) => { const input = asRecord(raw) as Partial<SaveProjectDocumentInput>; return metadata.saveDocument({ projectRoot: activeRoot(), title: requiredText(input.title, '文档标题不能为空'), content: requiredText(input.content, '文档内容不能为空'), ...(typeof input.filename === 'string' ? { filename: input.filename } : {}) }) },
    updateProjectDocument: (raw) => { const input = asRecord(raw) as Partial<UpdateProjectDocumentInput>; return metadata.updateDocument({ projectRoot: activeRoot(), filePath: requiredText(input.filePath, '文档路径不能为空'), title: requiredText(input.title, '文档标题不能为空'), content: requiredText(input.content, '文档内容不能为空') }) },
    deleteProjectDocument: async (raw) => { const input = asRecord(raw) as { filePath?: string }; await metadata.deleteDocument({ projectRoot: activeRoot(), filePath: requiredText(input.filePath, '文档路径不能为空') }) },
    importAssets: async (raw?: unknown) => {
      const input = raw && typeof raw === 'object' ? (raw as { filePaths?: string[]; category?: ProjectAssetCategory }) : undefined
      if (input?.filePaths && Array.isArray(input.filePaths) && input.filePaths.length > 0) {
        return assets.import({ projectRoot: activeRoot(), sourcePaths: input.filePaths, category: input.category })
      }
      const options: OpenDialogOptions = { title: '导入项目素材', properties: ['openFile', 'multiSelections'], filters: [{ name: '图片与文件', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp', 'tif', 'tiff', 'svg', 'pdf', 'md', 'txt', 'json'] }] }
      const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
      if (result.canceled || result.filePaths.length === 0) return []
      return assets.import({ projectRoot: activeRoot(), sourcePaths: result.filePaths, category: input?.category })
    },
    chooseReferenceImages: async () => {
      const options: OpenDialogOptions = {
        title: '选择参考图',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: '参考图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
      }
      const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
      if (result.canceled || result.filePaths.length === 0) return []
      if (result.filePaths.length > MAX_REFERENCE_IMAGES) throw new LibraryError('invalid-input', `单轮最多添加 ${MAX_REFERENCE_IMAGES} 张参考图`)
      const details = await Promise.all(result.filePaths.map((path) => fs.stat(path).catch(() => null)))
      if (details.some((item) => !item?.isFile())) throw new LibraryError('invalid-input', '只能选择图片文件')
      if (details.some((item) => (item?.size ?? 0) > MAX_REFERENCE_IMAGE_BYTES)) throw new LibraryError('invalid-input', '单张参考图不能超过 20 MiB')
      const mimeTypes = await Promise.all(result.filePaths.map((path) => readReferenceImageMimeType(path).catch(() => undefined)))
      const matchesExtension = mimeTypes.every((mimeType, index) => {
        const extension = extname(result.filePaths[index]).toLowerCase()
        const expected = extension === '.png' ? 'image/png' : extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : extension === '.webp' ? 'image/webp' : undefined
        return Boolean(expected && mimeType === expected)
      })
      if (!matchesExtension) throw new LibraryError('invalid-input', '文件内容不是有效的 PNG、JPEG 或 WebP 图片')
      return assets.import({ projectRoot: activeRoot(), sourcePaths: result.filePaths, category: 'reference' })
    },
    saveReferenceImage: (raw) => {
      const input = asRecord(raw)
      return assets.saveReferenceImage({ projectRoot: activeRoot(), name: requiredText(input.name, '参考图名称不能为空'), dataUrl: requiredText(input.dataUrl, '画板图片数据不能为空') })
    },
    listAssets: (raw) => { const input = asRecord(raw); return assets.list({ projectRoot: activeRoot(), ...(typeof input.search === 'string' ? { search: input.search } : {}), ...(typeof input.category === 'string' ? { category: input.category as ProjectAssetCategory } : {}), ...(typeof input.maxEntries === 'number' ? { maxEntries: input.maxEntries } : {}) }) },
    updateAsset: (raw) => { const input = asRecord(raw); return assets.update({ projectRoot: activeRoot(), id: requiredText(input.id, '素材标识不能为空'), category: input.category as ProjectAssetCategory }) },
    removeAsset: (raw) => { const input = asRecord(raw); return assets.remove({ projectRoot: activeRoot(), id: requiredText(input.id, '素材标识不能为空') }) },
    getAssetPreview: (raw) => { const input = asRecord(raw); return assets.preview({ projectRoot: activeRoot(), id: requiredText(input.id, '素材标识不能为空') }) },
    revealAsset: async (raw) => {
      const input = asRecord(raw)
      const root = activeRoot()
      let relativePath = optionalString(input.relativePath)
      if (!relativePath && typeof input.id === 'string') {
        const list = await assets.list({ projectRoot: root })
        const item = list.find((a) => a.id === input.id)
        relativePath = item?.relativePath
      }
      if (!relativePath) {
        await shell.openPath(join(root, 'assets'))
        return true
      }
      const fullPath = resolve(root, relativePath)
      shell.showItemInFolder(fullPath)
      return true
    },
  }
  const handlers: Array<[string, (...args: unknown[]) => unknown]> = [
    [channels.listPrompts, (_event, raw) => api.listPrompts(raw as never)],
    [channels.listPromptPage, (_event, raw) => api.listPromptPage(raw as never)],
    [channels.releasePromptLibraryResources, () => api.releasePromptLibraryResources()],
    [channels.searchPromptLibrary, (_event, raw) => api.searchPromptLibrary(raw as never)],
    [channels.getPrompt, (_event, raw) => api.getPrompt(raw as never)],
    [channels.savePrompt, (_event, raw) => api.savePrompt(raw as never)],
    [channels.quickSavePrompt, (_event, raw) => api.quickSavePrompt(raw as never)],
    [channels.updatePrompt, (_event, raw) => api.updatePrompt(raw as never)],
    [channels.removePrompt, (_event, raw) => api.removePrompt(raw as never)],
    [channels.syncPromptCatalog, (_event, raw) => api.syncPromptCatalog(raw as never)],
    [channels.listPromptCatalogSources, () => api.listPromptCatalogSources()],
    [channels.getEmbeddingStatus, () => api.getEmbeddingStatus()],
    [channels.installEmbeddingModel, () => api.installEmbeddingModel()],
    [channels.updateEmbeddings, () => api.updateEmbeddings()],
    [channels.rebuildEmbeddings, () => api.rebuildEmbeddings()],
    [channels.clearEmbeddings, () => api.clearEmbeddings()],
    [channels.uninstallEmbeddingModel, () => api.uninstallEmbeddingModel()],
    [channels.listQuickPrompts, (_event, raw) => api.listQuickPrompts(raw as never)],
    [channels.saveQuickPrompt, (_event, raw) => api.saveQuickPrompt(raw as never)],
    [channels.removeQuickPrompt, (_event, raw) => api.removeQuickPrompt(raw as never)],
    [channels.listMemories, (_event, raw) => api.listMemories(raw as never)],
    [channels.getMemory, (_event, raw) => api.getMemory(raw as never)],
    [channels.saveMemory, (_event, raw) => api.saveMemory(raw as never)],
    [channels.updateMemory, (_event, raw) => api.updateMemory(raw as never)],
    [channels.removeMemory, (_event, raw) => api.removeMemory(raw as never)],
    [channels.listProjectItems, (_event, raw) => api.listProjectItems(raw as never)],
    [channels.inspectProjectItem, (_event, raw) => api.inspectProjectItem(raw as never)],
    [channels.saveProjectDocument, (_event, raw) => api.saveProjectDocument(raw as never)],
    [channels.updateProjectDocument, (_event, raw) => api.updateProjectDocument(raw as never)],
    [channels.deleteProjectDocument, (_event, raw) => api.deleteProjectDocument(raw as never)],
    [channels.importAssets, (_event, raw) => api.importAssets(raw as never)],
    [channels.chooseReferenceImages, () => api.chooseReferenceImages()],
    [channels.saveReferenceImage, (_event, raw) => api.saveReferenceImage(raw as never)],
    [channels.listAssets, (_event, raw) => api.listAssets(raw as never)],
    [channels.updateAsset, (_event, raw) => api.updateAsset(raw as never)],
    [channels.removeAsset, (_event, raw) => api.removeAsset(raw as never)],
    [channels.getAssetPreview, (_event, raw) => api.getAssetPreview(raw as never)],
    [channels.revealAsset, (_event, raw) => api.revealAsset(raw as never)],
  ]
  for (const [channel, handler] of handlers) ipcMain.handle(channel, handler)
  return () => { for (const [channel] of handlers) ipcMain.removeHandler(channel) }
}

export { channels as libraryIpcChannels }
