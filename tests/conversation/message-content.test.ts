import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ConversationMessageContent } from '../../src/renderer/conversation/ConversationMessageContent'

describe('conversation message content', () => {
  it('renders assistant markdown without flattening its structure', () => {
    const markup = renderToStaticMarkup(createElement(ConversationMessageContent, {
      content: '## 推荐理由\n\n- 适合产品展示\n- 光线更稳定\n\n`16:9`',
    }))

    expect(markup).toContain('md-h2')
    expect(markup).toContain('md-ul')
    expect(markup).toContain('md-inline-code')
    expect(markup).not.toContain('## 推荐理由')
  })

  it('shows one streaming caret after the current content', () => {
    const markup = renderToStaticMarkup(createElement(ConversationMessageContent, {
      content: '正在生成',
      pending: true,
    }))

    expect(markup.match(/text-stream-caret/g)).toHaveLength(1)
  })
})
