import { describe, expect, it, vi } from 'vitest'
import { syncAllPromptCatalog, syncPromptCatalogWithEmbeddings } from '../../src/renderer/library/prompt-sync'
import type { PromptCatalogSource } from '../../src/shared/contracts/library'

describe('prompt catalog synchronization', () => {
  it('attempts every remote source and aggregates successful updates and failures', async () => {
    const calls: PromptCatalogSource[] = []
    const progress: Array<{ source: PromptCatalogSource; current: number; total: number; state: string; result?: { total: number }; message?: string }> = []
    const syncPromptCatalog = vi.fn(async ({ source }: { source: PromptCatalogSource }) => {
      calls.push(source)
      if (source === 'nanimicoder-open-image-prompts') throw new Error('network unavailable')
      return { source, imported: 1, updated: 2, removed: 3, skipped: 4, total: 10 }
    })

    const result = await syncAllPromptCatalog({ syncPromptCatalog }, undefined, (event) => progress.push(event))

    expect(calls).toEqual([
      'youmind-gpt-image-2',
      'wangrunlin-gpt-image-2-5',
      'vigo-ai-visual-prompt-cookbook',
      'stretchcloud-gpt-image-prompt-2-5',
      'nanimicoder-open-image-prompts',
      'awesome-gpt-image-2',
    ])
    expect(result).toMatchObject({ imported: 5, updated: 10, removed: 15, skipped: 20 })
    expect(result.failures).toEqual([{ source: 'nanimicoder-open-image-prompts', message: 'network unavailable' }])
    expect(result.sourceResults).toHaveLength(6)
    expect(progress[0]).toMatchObject({ source: 'youmind-gpt-image-2', current: 1, total: 6, state: 'syncing' })
    expect(progress[1]).toMatchObject({ source: 'youmind-gpt-image-2', current: 1, total: 6, state: 'succeeded', result: { total: 10 } })
    expect(progress).toContainEqual(expect.objectContaining({ source: 'nanimicoder-open-image-prompts', current: 5, total: 6, state: 'failed', message: 'network unavailable' }))
    expect(progress.at(-1)).toMatchObject({ source: 'awesome-gpt-image-2', current: 6, total: 6, state: 'succeeded' })
  })
})

describe('prompt catalog and embedding synchronization', () => {
  const embeddingStatus = (status: 'not-installed' | 'installed' | 'ready') => ({
    status,
    modelId: 'local-model',
    version: '1',
    license: 'Apache-2.0',
    sourceUrl: 'https://example.com/model',
    diskBytes: status === 'not-installed' ? 0 : 100,
    indexedCount: status === 'ready' ? 10 : 0,
    totalCount: 10,
    pendingCount: status === 'ready' ? 0 : 10,
    retrievalMode: status === 'ready' ? 'hybrid' as const : 'lexical' as const,
  })

  it('incrementally updates embeddings after repository synchronization when the model is installed', async () => {
    const updateEmbeddings = vi.fn().mockResolvedValue(embeddingStatus('ready'))
    const onEmbeddingProgress = vi.fn()
    const api = {
      syncPromptCatalog: vi.fn(async ({ source }: { source: PromptCatalogSource }) => ({ source, imported: 0, updated: 0, removed: 0, skipped: 1, total: 1 })),
      getEmbeddingStatus: vi.fn().mockResolvedValue(embeddingStatus('ready')),
      updateEmbeddings,
    }

    const result = await syncPromptCatalogWithEmbeddings(api, ['youmind-gpt-image-2'], undefined, onEmbeddingProgress)

    expect(updateEmbeddings).toHaveBeenCalledOnce()
    expect(onEmbeddingProgress.mock.calls.map(([value]) => value)).toEqual([true, false])
    expect(result.embeddingUpdated).toBe(true)
    expect(result.embeddingError).toBeUndefined()
  })

  it('skips vector indexing when the local model has not been installed', async () => {
    const updateEmbeddings = vi.fn()
    const api = {
      syncPromptCatalog: vi.fn(async ({ source }: { source: PromptCatalogSource }) => ({ source, imported: 1, updated: 0, removed: 0, skipped: 0, total: 1 })),
      getEmbeddingStatus: vi.fn().mockResolvedValue(embeddingStatus('not-installed')),
      updateEmbeddings,
    }

    const result = await syncPromptCatalogWithEmbeddings(api, ['youmind-gpt-image-2'])

    expect(updateEmbeddings).not.toHaveBeenCalled()
    expect(result.embeddingUpdated).toBe(false)
  })

  it('keeps successful catalog results when the follow-up vector update fails', async () => {
    const api = {
      syncPromptCatalog: vi.fn(async ({ source }: { source: PromptCatalogSource }) => ({ source, imported: 2, updated: 0, removed: 0, skipped: 0, total: 2 })),
      getEmbeddingStatus: vi.fn().mockResolvedValue(embeddingStatus('installed')),
      updateEmbeddings: vi.fn().mockRejectedValue(new Error('模型文件损坏')),
    }

    const result = await syncPromptCatalogWithEmbeddings(api, ['youmind-gpt-image-2'])

    expect(result.catalog.imported).toBe(2)
    expect(result.embeddingUpdated).toBe(false)
    expect(result.embeddingError).toBe('模型文件损坏')
  })
})
