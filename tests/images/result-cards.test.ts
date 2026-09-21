import { describe, expect, it } from 'vitest'
import { mergeResultCards } from '../../src/renderer/image/ImageConversation'
import { formatResultCardSpec, formatResultCardStatus } from '../../src/renderer/image/ResultImageCard'
import { formatAssetSize } from '../../src/renderer/library/AssetCard'

describe('image result card queue reconciliation', () => {
  it('does not render an enqueue response twice when the queue event arrived first', () => {
    const task = { id: 'task-1', title: '新生成', status: 'running' as const }
    expect(mergeResultCards([task], [task])).toEqual([task])
  })
})

describe('image result card specifications', () => {
  it('shows automatic retry progress instead of a generic pending state', () => {
    const now = '2026-09-18T00:00:00.000Z'
    expect(formatResultCardStatus({
      id: 'retrying', connectionId: 'image', status: 'pending', attempts: 1, maxRetries: 2,
      request: { model: 'image', prompt: '雨夜' }, createdAt: now, updatedAt: now,
      error: { code: 'network', message: 'temporary' },
    })).toBe('自动重试 2/3')
    expect(formatResultCardStatus({
      id: 'running', connectionId: 'image', status: 'running', attempts: 2, maxRetries: 2,
      request: { model: 'image', prompt: '雨夜' }, createdAt: now, updatedAt: now,
      error: { code: 'network', message: 'temporary' },
    })).toBe('正在重试 2/3')
  })

  it('shows one final specification instead of repeating requested and actual dimensions', () => {
    expect(formatResultCardSpec({
      request: { model: 'image-model', prompt: '宫殿', outputSize: '2048x1152', outputFormat: 'png', quality: 'max', background: 'transparent' },
      result: { width: 2048, height: 1152 },
    })).toBe('2048x1152 · PNG · max · 透明背景')
  })

  it('falls back to the requested output size while the actual dimensions are unavailable', () => {
    expect(formatResultCardSpec({
      request: { model: 'image-model', prompt: '宫殿', size: '1536x1024', outputSize: '2048x1152', outputFormat: 'jpeg' },
    })).toBe('2048x1152 · JPEG')
  })
})

describe('asset card file size', () => {
  it('uses MB for files at least one megabyte', () => {
    expect(formatAssetSize(512 * 1024)).toBe('512 KB')
    expect(formatAssetSize(1024 * 1024)).toBe('1.00 MB')
    expect(formatAssetSize(2.5 * 1024 * 1024)).toBe('2.50 MB')
  })
})
