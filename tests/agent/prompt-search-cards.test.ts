import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PromptSearchCards } from '../../src/renderer/agent/PromptSearchCards'

describe('prompt search cards', () => {
  it('shows stable card numbers without exposing internal fallback codes', () => {
    const markup = renderToStaticMarkup(createElement(PromptSearchCards, { results: [
      { id: 'p1', title: '角色三视图', content: 'front side back', category: '角色设计', type: 'prompt', collection: '个人', score: 0.98, reason: '标题命中', retrievalMode: 'lexical', fallbackReason: 'local_embedding_unavailable' },
      { id: 'p2', title: '产品三视图', content: 'product views', category: '产品', type: 'prompt', collection: '仓库', score: 0.9, reason: '正文命中', retrievalMode: 'lexical' },
    ] }))
    expect(markup).toContain('aria-label="第 1 个提示词"')
    expect(markup).toContain('aria-label="第 2 个提示词"')
    expect(markup).toContain('>1</span>')
    expect(markup).toContain('>2</span>')
    expect(markup).not.toContain('local_embedding_unavailable')
  })
})
