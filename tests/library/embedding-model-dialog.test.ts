import { describe, expect, it } from 'vitest'
import { embeddingModelPresentation, formatEmbeddingBytes } from '../../src/renderer/library/EmbeddingModelDialog'
import type { EmbeddingModelStatus } from '../../src/shared/contracts/library'

function status(overrides: Partial<EmbeddingModelStatus> = {}): EmbeddingModelStatus {
  return {
    status: 'not-installed',
    modelId: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
    version: 'revision-1',
    license: 'Apache-2.0',
    sourceUrl: 'https://huggingface.co/model',
    diskBytes: 0,
    indexedCount: 0,
    totalCount: 32000,
    pendingCount: 32000,
    retrievalMode: 'lexical',
    fallbackReason: 'local_embedding_unavailable',
    ...overrides,
  }
}

describe('embedding model dialog presentation', () => {
  it('explains keyword fallback before installation', () => {
    expect(embeddingModelPresentation(status())).toMatchObject({
      label: '未安装',
      tone: 'neutral',
      primaryAction: 'install',
      retrievalLabel: '关键词检索',
    })
  })

  it('shows a healthy hybrid index and the incremental update action', () => {
    expect(embeddingModelPresentation(status({
      status: 'ready',
      diskBytes: 124_000_000,
      indexedCount: 31_900,
      pendingCount: 100,
      retrievalMode: 'hybrid',
    }))).toMatchObject({
      label: '可用',
      tone: 'success',
      primaryAction: 'update',
      retrievalLabel: '混合检索',
    })
  })

  it('marks a failed model as repairable', () => {
    expect(embeddingModelPresentation(status({ status: 'failed', lastError: 'model file is damaged' }))).toMatchObject({
      label: '需要修复',
      tone: 'danger',
      primaryAction: 'install',
    })
  })

  it('formats model disk usage without raw byte counts', () => {
    expect(formatEmbeddingBytes(0)).toBe('0 B')
    expect(formatEmbeddingBytes(124_000_000)).toBe('118.3 MB')
  })
})
