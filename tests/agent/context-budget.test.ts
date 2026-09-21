import { describe, expect, it } from 'vitest'
import { fitTextModelContext } from '../../src/main/agent/context-budget'
import { MODEL_CONTEXT_WINDOW_TOKENS, textTokenUpperBound } from '../../src/shared/token-estimator'

describe('agent model context budget', () => {
  it('uses a conservative final guard for high-entropy ASCII context', () => {
    const longAsciiTurn = { role: 'assistant' as const, content: 'a'.repeat(600_000) }
    const fitted = fitTextModelContext('', [
      longAsciiTurn,
      { role: 'user', content: '继续处理' },
    ])

    const guardedSize = textTokenUpperBound(fitted.system)
      + fitted.messages.reduce((total, message) => total + textTokenUpperBound(typeof message.content === 'string' ? message.content : JSON.stringify(message.content)) + 8, 0)
    expect(guardedSize).toBeLessThan(MODEL_CONTEXT_WINDOW_TOKENS)
    expect(fitted.messages).not.toContainEqual(longAsciiTurn)
    expect(fitted.messages).toContainEqual({ role: 'user', content: '继续处理' })
  })

  it('does not underestimate random identifiers or Base64-like text', () => {
    const highEntropy = Array.from({ length: 80_000 }, (_, index) => `${index.toString(36)}Az9+/`).join('')
    const fitted = fitTextModelContext('system', [
      { role: 'assistant', content: highEntropy },
      { role: 'user', content: '保留本轮请求' },
    ])

    const guardedSize = textTokenUpperBound(fitted.system)
      + fitted.messages.reduce((total, message) => total + textTokenUpperBound(typeof message.content === 'string' ? message.content : JSON.stringify(message.content)) + 8, 0)
    expect(guardedSize).toBeLessThan(MODEL_CONTEXT_WINDOW_TOKENS)
    expect(fitted.messages).toContainEqual({ role: 'user', content: '保留本轮请求' })
  })

  it('keeps assistant tool calls and their tool results as one atomic exchange', () => {
    const fitted = fitTextModelContext('', [
      { role: 'user', content: '当前请求' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'large-call', name: 'read_project_file', arguments: '{}' },
          { id: 'small-call', name: 'search_web', arguments: '{}' },
        ],
      },
      { role: 'tool', toolCallId: 'large-call', name: 'read_project_file', content: 'x'.repeat(1_040_000) },
      { role: 'tool', toolCallId: 'small-call', name: 'search_web', content: '小工具结果' },
      { role: 'assistant', content: '最终结论' },
    ])

    expect(fitted.messages).toContainEqual({ role: 'user', content: '当前请求' })
    expect(fitted.messages.some((message) => message.role === 'tool')).toBe(false)
    expect(fitted.messages.some((message) => message.role === 'assistant' && message.toolCalls?.length)).toBe(false)
    expect(fitted.messages).toContainEqual({ role: 'assistant', content: '最终结论' })
  })
})
