/** Storage scope for reusable content. */
import type { QuickPrompt, QuickPromptInput } from '../quick-prompts'
import type { PromptSearchResult } from './agent'

export type LibraryScope = 'global' | 'project'
export type MemoryCategory = 'general' | 'visual-style' | 'color-palette' | 'aspect-ratio' | 'character' | 'composition' | 'negative' | 'workflow'

export type PromptAssetKind = 'prompt' | 'template' | 'style'

export type PromptAssetSource = 'manual' | 'generation' | 'optimization' | 'import'
export type PromptLocale = 'zh-CN' | 'en' | 'und'
export type PromptTranslations = Partial<Record<'zh-CN' | 'en', string>>
/** Stable identifiers for supported upstream prompt repositories. */
export type PromptCatalogSource =
  | 'youmind-gpt-image-2'
  /** @deprecated retained only so stored synchronization history can still be decoded. */
  | 'youmind-nano-banana-pro'
  | 'wangrunlin-gpt-image-2-5'
  | 'vigo-ai-visual-prompt-cookbook'
  | 'stretchcloud-gpt-image-prompt-2-5'
  | 'nanimicoder-open-image-prompts'
  | 'awesome-gpt-image-2'
  /** @deprecated retained for migration of existing renderer state; no longer syncable. */
  | 'evolink-gpt-image-2'
  /** @deprecated retained for migration of existing renderer state; no longer syncable. */
  | 'awesome-prompts'

export interface SyncPromptCatalogResult {
  source: PromptCatalogSource
  imported: number
  updated: number
  removed: number
  skipped: number
  total: number
}

export interface PromptCatalogSourceInfo {
  id: PromptCatalogSource
  displayName: string
  repositoryUrl: string
  /** Number of active entries from this source currently stored on this device. */
  localCount: number
}

export type EmbeddingModelState = 'unavailable' | 'not-installed' | 'downloading' | 'installed' | 'indexing' | 'ready' | 'failed'

export interface EmbeddingModelStatus {
  status: EmbeddingModelState
  modelId: string | null
  version: string | null
  license: string | null
  sourceUrl: string | null
  diskBytes: number
  indexedCount: number
  totalCount: number
  pendingCount: number
  retrievalMode: 'hybrid' | 'lexical'
  fallbackReason?: 'local_embedding_unavailable' | 'local_embedding_error'
  installedAt?: string
  lastHealthCheckAt?: string
  lastError?: string
}

export interface PromptAsset {
  id: string
  name: string
  content: string
  kind: PromptAssetKind
  scope: LibraryScope
  version: number
  tags: string[]
  favorite: boolean
  source?: PromptAssetSource
  /** Source project or user-defined collection, independent from content category. */
  collection: string
  /** Content category such as portrait, landscape, or infographic. */
  category: string
  primaryLocale?: PromptLocale
  translations?: PromptTranslations
  description?: string
  previewUrl?: string
  sourceUrl?: string
  createdAt: string
  updatedAt: string
  deletedAt?: string
}

export interface SavePromptAssetInput {
  name: string
  content: string
  scope: LibraryScope
  /** Required for project-scoped assets. Never persisted in the asset itself. */
  projectRoot?: string
  kind?: PromptAssetKind
  tags?: readonly string[]
  favorite?: boolean
  source?: PromptAssetSource
  collection?: string
  category?: string
  primaryLocale?: PromptLocale
  translations?: PromptTranslations
  description?: string
  previewUrl?: string
  sourceUrl?: string
}

export interface UpdatePromptAssetInput {
  id: string
  scope: LibraryScope
  projectRoot?: string
  name?: string
  content?: string
  kind?: PromptAssetKind
  tags?: readonly string[]
  favorite?: boolean
  source?: PromptAssetSource
  collection?: string
  category?: string
  primaryLocale?: PromptLocale
  translations?: PromptTranslations
  description?: string | null
  previewUrl?: string | null
  sourceUrl?: string | null
}

export interface ListPromptAssetsInput {
  scope?: LibraryScope
  projectRoot?: string
  search?: string
  kind?: PromptAssetKind
}

export interface PromptPage {
  items: PromptAsset[]
  total: number
  offset: number
  limit: number
  hasMore: boolean
  categories: string[]
}

export interface ListPromptPageInput extends ListPromptAssetsInput {
  offset?: number
  limit?: number
  source?: 'all' | 'mine' | 'open-source' | PromptCatalogSource
  category?: string
  favoriteOnly?: boolean
}

export interface MemoryEntry {
  id: string
  title: string
  content: string
  scope: LibraryScope
  version: number
  active: boolean
  category?: MemoryCategory
  source?: string
  lastUsedAt?: string
  createdAt: string
  updatedAt: string
  deletedAt?: string
}

export interface SaveMemoryEntryInput {
  title: string
  content: string
  scope: LibraryScope
  /** Required for project-scoped memories. Never persisted in the entry itself. */
  projectRoot?: string
  active?: boolean
  category?: MemoryCategory
  source?: string
}

export interface ListMemoryEntriesInput {
  scope?: LibraryScope
  projectRoot?: string
  search?: string
  activeOnly?: boolean
}

export interface UpdateMemoryEntryInput {
  id: string
  scope: LibraryScope
  projectRoot?: string
  title?: string
  content?: string
  active?: boolean
  category?: MemoryCategory
  source?: string
  lastUsedAt?: string
}

export interface PromptAssetStore {
  list(input: ListPromptAssetsInput): Promise<PromptAsset[]>
  get(input: { id: string; scope: LibraryScope; projectRoot?: string }): Promise<PromptAsset | null>
  save(input: SavePromptAssetInput): Promise<PromptAsset>
  quickSave(input: SavePromptAssetInput): Promise<PromptAsset>
  update(input: UpdatePromptAssetInput): Promise<PromptAsset>
  remove(input: { id: string; scope: LibraryScope; projectRoot?: string }): Promise<void>
  restore?(input: { id: string; scope: LibraryScope; projectRoot?: string }): Promise<void>
}

export interface MemoryEntryStore {
  list(input: ListMemoryEntriesInput): Promise<MemoryEntry[]>
  get(input: { id: string; scope: LibraryScope; projectRoot?: string }): Promise<MemoryEntry | null>
  save(input: SaveMemoryEntryInput): Promise<MemoryEntry>
  update(input: UpdateMemoryEntryInput): Promise<MemoryEntry>
  remove(input: { id: string; scope: LibraryScope; projectRoot?: string }): Promise<void>
  restore?(input: { id: string; scope: LibraryScope; projectRoot?: string }): Promise<void>
}

export type ProjectItemKind = 'document' | 'asset' | 'output' | 'other'

export interface ProjectItemMetadata {
  /** Always relative to the project root, using POSIX separators. */
  relativePath: string
  name: string
  kind: ProjectItemKind
  extension?: string
  mimeType?: string
  isDirectory: boolean
  byteLength?: number
  modifiedAt?: string
}

export interface ListProjectItemsInput {
  projectRoot: string
  /** Relative or absolute path inside projectRoot. Defaults to projectRoot. */
  directory?: string
  recursive?: boolean
  includeHidden?: boolean
  maxEntries?: number
}

export interface ProjectItemInput {
  projectRoot: string
  filePath: string
}

export interface ProjectMetadataStore {
  list(input: ListProjectItemsInput): Promise<ProjectItemMetadata[]>
  inspect(input: ProjectItemInput): Promise<ProjectItemMetadata>
}

export interface SaveProjectDocumentInput {
  title: string
  content: string
  filename?: string
  extension?: string
}

export interface UpdateProjectDocumentInput {
  filePath: string
  title: string
  content: string
}

export interface ProjectAsset {
  id: string
  name: string
  relativePath: string
  sourceName: string
  /** User-assigned semantic category used by the project asset library. */
  category: ProjectAssetCategory
  extension?: string
  mimeType?: string
  byteLength: number
  modifiedAt: string
  importedAt: string
  previewable: boolean
  origin?: 'imported' | 'generated'
}

export type ProjectAssetCategory = 'character' | 'scene' | 'prop' | 'style-reference' | 'reference' | 'output' | 'other'

export interface UpdateProjectAssetInput {
  id: string
  category: ProjectAssetCategory
}

export interface ListProjectAssetsInput {
  search?: string
  category?: ProjectAssetCategory
  maxEntries?: number
}

export interface ProjectAssetStore {
  list(input: { projectRoot: string } & ListProjectAssetsInput): Promise<ProjectAsset[]>
  import(input: { projectRoot: string; sourcePaths: readonly string[]; category?: ProjectAssetCategory }): Promise<ProjectAsset[]>
  recordGenerated?(input: { projectRoot: string; taskId: string; title?: string; localPath: string; mimeType?: string; byteLength?: number }): Promise<ProjectAsset>
  update(input: { projectRoot: string } & UpdateProjectAssetInput): Promise<ProjectAsset>
  remove(input: { projectRoot: string; id: string }): Promise<void>
  preview(input: { projectRoot: string; id: string }): Promise<string | null>
}

/** Renderer-safe library boundary; the active project root is owned by main. */
export interface LibraryApi {
  listPrompts(input: Omit<ListPromptAssetsInput, 'projectRoot'>): Promise<PromptAsset[]>
  listPromptPage(input: Omit<ListPromptPageInput, 'projectRoot'>): Promise<PromptPage>
  releasePromptLibraryResources(): Promise<void>
  searchPromptLibrary(input: { query: string; limit?: number }): Promise<PromptSearchResult[]>
  getPrompt(input: { id: string; scope: LibraryScope }): Promise<PromptAsset | null>
  savePrompt(input: Omit<SavePromptAssetInput, 'projectRoot'>): Promise<PromptAsset>
  quickSavePrompt(input: Omit<SavePromptAssetInput, 'projectRoot'>): Promise<PromptAsset>
  updatePrompt(input: Omit<UpdatePromptAssetInput, 'projectRoot'>): Promise<PromptAsset>
  removePrompt(input: { id: string; scope: LibraryScope }): Promise<void>
  restorePrompt?(input: { id: string; scope: LibraryScope }): Promise<void>
  syncPromptCatalog(input: { source: PromptCatalogSource }): Promise<SyncPromptCatalogResult>
  listPromptCatalogSources(): Promise<PromptCatalogSourceInfo[]>
  getEmbeddingStatus(): Promise<EmbeddingModelStatus>
  installEmbeddingModel(): Promise<EmbeddingModelStatus>
  updateEmbeddings(): Promise<EmbeddingModelStatus>
  rebuildEmbeddings(): Promise<EmbeddingModelStatus>
  clearEmbeddings(): Promise<EmbeddingModelStatus>
  uninstallEmbeddingModel(): Promise<EmbeddingModelStatus>
  listQuickPrompts(input?: { legacyItems?: readonly QuickPrompt[] }): Promise<QuickPrompt[]>
  saveQuickPrompt(input: QuickPromptInput): Promise<QuickPrompt>
  removeQuickPrompt(input: { id: string }): Promise<void>
  listMemories(input: Omit<ListMemoryEntriesInput, 'projectRoot'>): Promise<MemoryEntry[]>
  getMemory(input: { id: string; scope: LibraryScope }): Promise<MemoryEntry | null>
  saveMemory(input: Omit<SaveMemoryEntryInput, 'projectRoot'>): Promise<MemoryEntry>
  updateMemory(input: Omit<UpdateMemoryEntryInput, 'projectRoot'>): Promise<MemoryEntry>
  removeMemory(input: { id: string; scope: LibraryScope }): Promise<void>
  restoreMemory?(input: { id: string; scope: LibraryScope }): Promise<void>
  listProjectItems(input: Omit<ListProjectItemsInput, 'projectRoot'>): Promise<ProjectItemMetadata[]>
  inspectProjectItem(input: Omit<ProjectItemInput, 'projectRoot'>): Promise<ProjectItemMetadata>
  saveProjectDocument(input: SaveProjectDocumentInput): Promise<ProjectItemMetadata>
  updateProjectDocument(input: UpdateProjectDocumentInput): Promise<ProjectItemMetadata>
  deleteProjectDocument(input: { filePath: string }): Promise<void>
  restoreProjectDocument?(input: { trashId: string }): Promise<void>
  importAssets(input?: { filePaths?: string[]; category?: ProjectAssetCategory }): Promise<ProjectAsset[]>
  chooseReferenceImages(): Promise<ProjectAsset[]>
  saveReferenceImage(input: { name: string; dataUrl: string }): Promise<ProjectAsset>
  listAssets(input?: ListProjectAssetsInput): Promise<ProjectAsset[]>
  updateAsset(input: UpdateProjectAssetInput): Promise<ProjectAsset>
  removeAsset(input: { id: string }): Promise<void>
  getAssetPreview(input: { id: string }): Promise<string | null>
  revealAsset(input: { id?: string; relativePath?: string }): Promise<boolean>
}

export interface LibraryErrorShape {
  code: string
  message: string
}
