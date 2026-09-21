import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AgentConversation } from '../../src/renderer/agent/AgentConversation'

describe('agent conversation context visibility', () => {
  it('keeps inherited context implicit after the first completed turn', () => {
    const markup = renderToStaticMarkup(createElement(AgentConversation, {
      conversationId: 'conversation-1',
      sessionMessages: [
        { id: 'user-1', role: 'user', text: '你好', mode: 'agent', createdAt: 1 },
        { id: 'assistant-1', role: 'assistant', text: '你好，有什么需要我帮你处理的？', mode: 'agent', createdAt: 2 },
      ],
    }))

    expect(markup).not.toContain('已继承本会话上下文')
    expect(markup).not.toContain('提取推导构思')
  })

  it('offers re-editing after a cancelled Agent turn', () => {
    const markup = renderToStaticMarkup(createElement(AgentConversation, {
      conversationId: 'conversation-1',
      sessionMessages: [
        { id: 'user-1', role: 'user', text: '这条发错了', mode: 'agent', createdAt: 1 },
        { id: 'assistant-1', role: 'assistant', text: '这次 Agent 请求已取消。', cancelled: true, mode: 'agent', createdAt: 2 },
      ],
      onEditMessage: () => undefined,
    }))

    expect(markup).toContain('重新编辑')
  })
})
