import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PromptSyncProgress } from '../../src/renderer/library/PromptSyncProgress'
import type { PromptCatalogSourceInfo } from '../../src/shared/contracts/library'
import type { PromptCatalogSyncProgress } from '../../src/renderer/library/prompt-sync'

const sources: PromptCatalogSourceInfo[] = [
  { id: 'youmind-gpt-image-2', displayName: 'YouMind GPT Image 2', repositoryUrl: 'https://example.com/one', localCount: 126 },
  { id: 'stretchcloud-gpt-image-prompt-2-5', displayName: 'stretchcloud GPT Image 2.5', repositoryUrl: 'https://example.com/two', localCount: 129 },
  { id: 'wangrunlin-gpt-image-2-5', displayName: 'wangrunlin GPT Image 2.5', repositoryUrl: 'https://example.com/three', localCount: 0 },
]

describe('prompt catalog sync progress', () => {
  it('renders overall progress, current source and unambiguous per-source counts', () => {
    const results: PromptCatalogSyncProgress[] = [
      { source: 'youmind-gpt-image-2', current: 1, total: 3, state: 'succeeded', result: { source: 'youmind-gpt-image-2', imported: 126, updated: 0, removed: 0, skipped: 0, total: 126 } },
      { source: 'stretchcloud-gpt-image-prompt-2-5', current: 2, total: 3, state: 'failed', message: '网络不可用' },
    ]
    const markup = renderToStaticMarkup(createElement(PromptSyncProgress, {
      sources,
      syncing: true,
      progress: { source: 'wangrunlin-gpt-image-2-5', current: 3, total: 3, state: 'syncing' },
      results,
    }))

    expect(markup).toContain('正在同步 3/3')
    expect(markup).toContain('wangrunlin GPT Image 2.5')
    expect(markup).toMatch(/<progress[^>]+value="2"[^>]+max="3"/)
    expect(markup).toContain('来源条目 126')
    expect(markup).toContain('新增 126')
    expect(markup).toContain('未变化 0')
    expect(markup).toContain('失败 · 网络不可用')
  })
})
