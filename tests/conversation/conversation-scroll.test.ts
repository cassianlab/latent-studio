import { describe, expect, it } from 'vitest'
import { isConversationNearBottom } from '../../src/renderer/conversation/conversation-scroll'

describe('conversation scroll following', () => {
  it('follows output only while the reader remains near the bottom', () => {
    expect(isConversationNearBottom({ scrollHeight: 1000, scrollTop: 620, clientHeight: 300 })).toBe(true)
    expect(isConversationNearBottom({ scrollHeight: 1000, scrollTop: 300, clientHeight: 300 })).toBe(false)
  })

  it('treats short conversations as already at the bottom', () => {
    expect(isConversationNearBottom({ scrollHeight: 280, scrollTop: 0, clientHeight: 300 })).toBe(true)
  })
})
