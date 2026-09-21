import type { EmbeddingModelStatus, LibraryApi, PromptCatalogSource, SyncPromptCatalogResult } from '../../shared/contracts/library'

export const PROMPT_CATALOG_SOURCES: readonly PromptCatalogSource[] = [
  'youmind-gpt-image-2',
  'wangrunlin-gpt-image-2-5',
  'vigo-ai-visual-prompt-cookbook',
  'stretchcloud-gpt-image-prompt-2-5',
  'nanimicoder-open-image-prompts',
  'awesome-gpt-image-2',
]

export interface PromptCatalogSyncSummary {
  imported: number
  updated: number
  removed: number
  skipped: number
  failures: Array<{ source: PromptCatalogSource; message: string }>
  sourceResults: PromptCatalogSyncProgress[]
}

export interface PromptCatalogSyncProgress {
  source: PromptCatalogSource
  current: number
  total: number
  state: 'syncing' | 'succeeded' | 'failed'
  result?: SyncPromptCatalogResult
  message?: string
}

export async function syncAllPromptCatalog(
  api: Pick<LibraryApi, 'syncPromptCatalog'>,
  sources: readonly PromptCatalogSource[] = PROMPT_CATALOG_SOURCES,
  onProgress?: (progress: PromptCatalogSyncProgress) => void,
): Promise<PromptCatalogSyncSummary> {
  const summary: PromptCatalogSyncSummary = { imported: 0, updated: 0, removed: 0, skipped: 0, failures: [], sourceResults: [] }
  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index]
    onProgress?.({ source, current: index + 1, total: sources.length, state: 'syncing' })
    try {
      const result = await api.syncPromptCatalog({ source })
      summary.imported += result.imported
      summary.updated += result.updated
      summary.removed += result.removed
      summary.skipped += result.skipped
      const progress: PromptCatalogSyncProgress = { source, current: index + 1, total: sources.length, state: 'succeeded', result }
      summary.sourceResults.push(progress)
      onProgress?.(progress)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '同步失败'
      summary.failures.push({ source, message })
      const progress: PromptCatalogSyncProgress = { source, current: index + 1, total: sources.length, state: 'failed', message }
      summary.sourceResults.push(progress)
      onProgress?.(progress)
    }
  }
  return summary
}

export interface PromptCatalogWithEmbeddingsResult {
  catalog: PromptCatalogSyncSummary
  embeddingUpdated: boolean
  embeddingStatus?: EmbeddingModelStatus
  embeddingError?: string
}

export async function syncPromptCatalogWithEmbeddings(
  api: Pick<LibraryApi, 'syncPromptCatalog' | 'getEmbeddingStatus' | 'updateEmbeddings'>,
  sources: readonly PromptCatalogSource[] = PROMPT_CATALOG_SOURCES,
  onProgress?: (progress: PromptCatalogSyncProgress) => void,
  onEmbeddingProgress?: (active: boolean) => void,
): Promise<PromptCatalogWithEmbeddingsResult> {
  const catalog = await syncAllPromptCatalog(api, sources, onProgress)
  let status: EmbeddingModelStatus
  try {
    status = await api.getEmbeddingStatus()
  } catch (cause) {
    return { catalog, embeddingUpdated: false, embeddingError: cause instanceof Error ? cause.message : '向量模型状态读取失败' }
  }
  if (!['installed', 'ready', 'failed'].includes(status.status)) return { catalog, embeddingUpdated: false, embeddingStatus: status }
  onEmbeddingProgress?.(true)
  try {
    const embeddingStatus = await api.updateEmbeddings()
    return { catalog, embeddingUpdated: true, embeddingStatus }
  } catch (cause) {
    return { catalog, embeddingUpdated: false, embeddingStatus: status, embeddingError: cause instanceof Error ? cause.message : '向量索引更新失败' }
  } finally {
    onEmbeddingProgress?.(false)
  }
}
