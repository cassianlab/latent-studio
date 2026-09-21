import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ConversationError } from '../../src/renderer/conversation/ConversationError'

describe('ConversationError', () => {
  it('maps exhausted provider accounts to one compact Chinese error', () => {
    const markup = renderToStaticMarkup(createElement(ConversationError, {
      error: 'All available accounts exhausted',
    }))

    expect(markup).toContain('当前渠道的可用账号额度已耗尽')
    expect(markup.match(/All available accounts exhausted/g)).toHaveLength(1)
    expect(markup).not.toContain('start-state error')
  })
})
