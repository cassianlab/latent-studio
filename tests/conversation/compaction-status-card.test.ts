import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CompactionStatusCard } from '../../src/renderer/conversation/CompactionStatusCard'

describe('CompactionStatusCard', () => {
  it('explains observational compression and keeps its readable summary', () => {
    const markup = renderToStaticMarkup(createElement(CompactionStatusCard, {
      state: {
        summary: '用户正在制作雨夜分镜。',
        throughMessageId: 'message-8',
        updatedAt: Date.UTC(2026, 8, 16),
        compressionMode: 'observational',
        coveredMessageCount: 8,
        coveredFromAt: Date.UTC(2026, 8, 15),
        coveredThroughAt: Date.UTC(2026, 8, 16),
        keyItemCount: 3,
      },
    }))

    expect(markup).toContain('上下文已压缩')
    expect(markup).toContain('模型观察压缩')
    expect(markup).toContain('完整对话仍保留')
    expect(markup).toContain('查看摘要')
    expect(markup).toContain('用户正在制作雨夜分镜')
  })

  it('shows a local fallback reason explicitly', () => {
    const markup = renderToStaticMarkup(createElement(CompactionStatusCard, {
      state: {
        summary: '本地摘要',
        throughMessageId: 'message-8',
        updatedAt: 1,
        compressionMode: 'local',
        fallbackReason: '模型摘要压缩超时',
        coveredMessageCount: 8,
        keyItemCount: 2,
      },
    }))

    expect(markup).toContain('本地保底压缩')
    expect(markup).toContain('模型摘要压缩超时')
  })
})
