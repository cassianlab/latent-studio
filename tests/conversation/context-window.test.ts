import { describe, expect, it, vi } from 'vitest'
import {
  CONTEXT_COMPACTION_THRESHOLD,
  CONTEXT_WINDOW_TOKENS,
  estimateContextTokens,
  estimateConversationUsage,
  prepareConversationContext,
  retainSkillContextsAfterCompaction,
  summarizeConversationWithModel,
} from '../../src/renderer/conversation/context-window'
import type { SessionMessage } from '../../src/renderer/conversation/types'

function messages(count: number, chars: number): SessionMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `message-${index}`,
    role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
    text: `${index}:` + 'a'.repeat(chars),
    createdAt: index,
  }))
}

describe('conversation context window', () => {
  it('reports visible non-zero usage for a short multi-turn conversation', () => {
    const usage = estimateConversationUsage(messages(6, 160))

    expect(usage.usedTokens).toBeGreaterThan(0)
    expect(usage.percent).toBeGreaterThanOrEqual(0.1)
    expect(usage.estimated).toBe(true)
  })

  it('prefers provider context usage so hidden reasoning and request overhead are counted', () => {
    const input = messages(4, 20)
    input[3].usage = { inputTokens: 8_000, outputTokens: 2_000, totalTokens: 10_000, contextTokens: 10_000, reasoningTokens: 1_500 }

    const usage = estimateConversationUsage(input)

    expect(usage).toMatchObject({ usedTokens: 10_000, reasoningTokens: 1_500, estimated: false })
  })

  it('does not reset active context when a later model reports fewer tokens', () => {
    const input = messages(4, 200)
    input[1].usage = { inputTokens: 10_000, outputTokens: 2_000, totalTokens: 12_000, contextTokens: 12_000, reasoningTokens: 1_500 }
    input[3].usage = { inputTokens: 800, outputTokens: 200, totalTokens: 1_000, contextTokens: 1_000, reasoningTokens: 100 }

    const trailingTokens = estimateContextTokens(input.slice(2).map((message) => message.text))
    const usage = estimateConversationUsage(input)

    expect(usage).toMatchObject({
      usedTokens: 12_000 + trailingTokens,
      reasoningTokens: 1_500,
      estimated: true,
    })
  })

  it('drops provider checkpoints covered by compaction', () => {
    const input = messages(6, 200)
    input[1].usage = { inputTokens: 10_000, outputTokens: 2_000, totalTokens: 12_000, contextTokens: 12_000, reasoningTokens: 1_500 }
    input[5].usage = { inputTokens: 700, outputTokens: 200, totalTokens: 900, contextTokens: 900, reasoningTokens: 80 }

    const usage = estimateConversationUsage(input, {
      summary: '较早对话已经压缩。',
      throughMessageId: 'message-3',
      updatedAt: 4,
      compressionMode: 'local',
    })

    expect(usage).toMatchObject({ usedTokens: 900, reasoningTokens: 80, estimated: false })
  })

  it('automatically compacts when provider usage reaches the threshold', async () => {
    const input = messages(6, 200)
    input[1].usage = { inputTokens: 5_000, outputTokens: 200_000, totalTokens: 205_000, contextTokens: 205_000, reasoningTokens: 195_000 }
    input[5].usage = { inputTokens: 700, outputTokens: 200, totalTokens: 900, contextTokens: 900, reasoningTokens: 80 }
    const summarize = vi.fn().mockResolvedValue('已压缩供应商报告的高占用上下文。')

    const result = await prepareConversationContext({ messages: input, summarize })

    expect(result.compacted).toBe(true)
    expect(result.state?.throughMessageId).toBe('message-3')
    expect(summarize).toHaveBeenCalledOnce()
    expect(estimateConversationUsage(input, result.state).usedTokens).toBeLessThan(205_000)
  })

  it('uses the current artifact identity after a document or prompt was edited in conversation', async () => {
    const prepared = await prepareConversationContext({
      messages: [{
        id: 'assistant-1', role: 'assistant', text: '已更新成果', toolContext: '【工具结果】\n{"relativePath":"documents/old.md"}', createdAt: 1,
        artifacts: [
          { type: 'document', operation: 'updated', relativePath: 'documents/new.md', name: 'new.md' },
          { type: 'prompt', operation: 'updated', id: 'prompt-1', scope: 'global', name: '新提示词' },
        ],
      }],
    })

    expect(prepared.messages[0]?.content).toContain('当前文档成果：documents/new.md')
    expect(prepared.messages[0]?.content).toContain('当前提示词成果：ID=prompt-1，范围=global')
  })

  it('keeps an uncompressed conversation unchanged below the proactive threshold', async () => {
    const input = messages(6, 200)
    const summarize = vi.fn()

    const result = await prepareConversationContext({ messages: input, summarize })

    expect(result.messages.map((item) => item.content)).toEqual(input.map((item) => item.text))
    expect(result.compacted).toBe(false)
    expect(result.state).toBeUndefined()
    expect(summarize).not.toHaveBeenCalled()
  })

  it('manually compacts a short conversation and reports the reduced active usage', async () => {
    const input = messages(8, 2_000)
    const before = estimateConversationUsage(input)

    const result = await prepareConversationContext({
      messages: input,
      forceCompaction: true,
      summarize: async () => '用户正在整理一组连续的视觉方案。',
    })
    const after = estimateConversationUsage(input, result.state)

    expect(result.compacted).toBe(true)
    expect(result.state?.throughMessageId).toBe('message-5')
    expect(after.usedTokens).toBeLessThan(before.usedTokens)
  })

  it('retains observed fixed request overhead after compaction', async () => {
    const input = messages(8, 200)
    input[7].usage = { inputTokens: 6_400, outputTokens: 200, totalTokens: 6_600, contextTokens: 6_600, reasoningTokens: 100 }

    const result = await prepareConversationContext({
      messages: input,
      forceCompaction: true,
      summarize: async () => '较早对话摘要。',
    })
    const after = estimateConversationUsage(input, result.state)

    expect(result.state?.estimatedFixedTokens).toBeGreaterThan(5_000)
    expect(after.usedTokens).toBeGreaterThan(5_000)
    expect(after.usedTokens).toBeLessThan(6_600)
  })

  it('uses the deterministic fallback when model summarization never responds', async () => {
    vi.useFakeTimers()
    try {
      const input = messages(8, 2_000)
      const resultPromise = prepareConversationContext({
        messages: input,
        forceCompaction: true,
        summarize: async () => new Promise<never>(() => undefined),
      })
      let result: Awaited<typeof resultPromise> | undefined
      void resultPromise.then((value) => { result = value })

      await vi.advanceTimersByTimeAsync(60_000)

      expect(result).toMatchObject({ compacted: true, usedFallback: true, state: { compressionMode: 'local' } })
    } finally {
      vi.useRealTimers()
    }
  })

  it('includes persisted tool results when preparing the next turn', async () => {
    const input: SessionMessage[] = [{
      id: 'assistant-with-skill',
      role: 'assistant',
      text: '已完成分析',
      toolContext: '【工具结果：run_skill】\n角色保持红色风衣',
      createdAt: 1,
    }]

    const result = await prepareConversationContext({ messages: input })

    expect(result.messages[0]?.content).toContain('已完成分析')
    expect(result.messages[0]?.content).toContain('角色保持红色风衣')
  })

  it('summarizes older turns while retaining recent original turns', async () => {
    const input = messages(12, 72_000)
    const events: string[] = []
    const summarize = vi.fn(async () => { events.push('summarize'); return '用户正在制作雨夜分镜，角色穿红色外套。' })

    const result = await prepareConversationContext({ messages: input, summarize, onCompactionStart: async () => { events.push('start') } })

    expect(result.compacted).toBe(true)
    expect(result.usedFallback).toBe(false)
    expect(result.state?.summary).toContain('红色外套')
    expect(result.state?.summary).toContain('## 当前目标')
    expect(result.state?.summary).toContain('## 未完成事项')
    expect(result.state?.compressionMode).toBe('observational')
    expect(result.state?.throughMessageId).toBeTruthy()
    expect(result.messages[0]).toMatchObject({ role: 'system', content: expect.stringContaining('历史对话压缩摘要') })
    expect(result.messages.at(-1)?.content).toBe(input.at(-1)?.text)
    expect(result.estimatedTokens).toBeLessThan(CONTEXT_COMPACTION_THRESHOLD)
    expect(events).toEqual(['start', 'summarize'])
  })

  it('migrates legacy official compaction to the readable observation summary', async () => {
    const input = messages(12, 200)
    const result = await prepareConversationContext({
      messages: input,
      state: {
        summary: '用户正在制作雨夜分镜，角色穿红色外套。',
        throughMessageId: 'message-7',
        updatedAt: 8,
        compressionMode: 'official',
        officialItems: [{ type: 'compaction', encrypted_content: 'opaque-context' }],
      },
    })

    expect(result.compacted).toBe(false)
    expect(result.state?.compressionMode).toBe('observational')
    expect(result.state?.officialItems).toBeUndefined()
    expect(result.messages[0]).toMatchObject({
      role: 'system',
      content: expect.stringContaining('用户正在制作雨夜分镜'),
    })
    expect('officialCompactionItems' in result).toBe(false)
  })

  it('proactively compacts large ASCII history before the main-process byte guard can drop it', async () => {
    const input = messages(8, 90_000)
    const summarize = vi.fn().mockResolvedValue('已压缩高熵英文与代码上下文。')

    const result = await prepareConversationContext({ messages: input, summarize })

    expect(result.compacted).toBe(true)
    expect(summarize).toHaveBeenCalledOnce()
    expect(result.messages[0]?.content).toContain('已压缩高熵英文与代码上下文')
    expect(result.messages.at(-1)?.content).toBe(input.at(-1)?.text)
  })

  it('includes persisted Skill tool results in model-generated summaries', async () => {
    const input = messages(12, 72_000)
    input[0] = {
      ...input[0],
      toolContext: '【工具结果：run_skill】\n角色的红色风衣不可修改',
    }
    const summarize = vi.fn().mockResolvedValue('已保留工具结论。')

    await prepareConversationContext({ messages: input, summarize })

    expect(summarize.mock.calls[0][0].messages[0].content).toContain('角色的红色风衣不可修改')
  })

  it('keeps exact paths, model ids, dimensions, and explicit constraints when the model omits them', async () => {
    const input = messages(8, 2_000)
    input[0] = {
      ...input[0],
      text: '必须使用 gpt-5.6-terra，输出保持 16:9，并保存到 /Users/example/Projects/雨夜/scene-01.png。',
    }

    const result = await prepareConversationContext({
      messages: input,
      forceCompaction: true,
      summarize: async () => '## 当前目标\n制作雨夜分镜\n\n## 已确认事实与约束\n无\n\n## 决策与用户偏好\n无\n\n## 产物、路径与工具结果\n无\n\n## 未完成事项\n无\n\n## 变更记录\n无',
    })

    expect(result.state?.summary).toContain('gpt-5.6-terra')
    expect(result.state?.summary).toContain('16:9')
    expect(result.state?.summary).toContain('/Users/example/Projects/雨夜/scene-01.png')
    expect(result.state?.summary).toContain('必须使用 gpt-5.6-terra')
  })

  it('drops Skill snapshots whose activation was covered by compaction', () => {
    const input = messages(5, 20)
    const skills = [
      { id: 'old', name: 'old', displayName: '旧 Skill', contentHash: 'old-hash', instructions: '# old', activatedAtMessageId: 'message-1' },
      { id: 'recent', name: 'recent', displayName: '新 Skill', contentHash: 'new-hash', instructions: '# recent', activatedAtMessageId: 'message-4' },
      { id: 'unknown', name: 'unknown', displayName: '未知 Skill', contentHash: 'unknown-hash', instructions: '# unknown' },
    ]

    expect(retainSkillContextsAfterCompaction(skills, input, {
      summary: '早期摘要',
      throughMessageId: 'message-2',
      updatedAt: 1,
    }).map((skill) => skill.id)).toEqual(['recent', 'unknown'])
  })

  it('uses a bounded local fallback when model summarization fails', async () => {
    const input = messages(16, 80_000)

    const result = await prepareConversationContext({
      messages: input,
      summarize: vi.fn().mockRejectedValue(new Error('provider unavailable')),
    })

    expect(result.compacted).toBe(true)
    expect(result.usedFallback).toBe(true)
    expect(result.state?.summary).toContain('本地压缩摘要')
    expect(result.messages.at(-1)?.content).toBe(input.at(-1)?.text)
    expect(result.estimatedTokens).toBeLessThan(CONTEXT_WINDOW_TOKENS)
  })

  it('continues from the previous compaction boundary without restoring older raw turns', async () => {
    const original = messages(16, 60_000)
    const first = await prepareConversationContext({ messages: original, summarize: async () => '第一段摘要' })
    const nextMessages = [...original, ...messages(3, 300).map((item, index) => ({ ...item, id: `new-${index}`, createdAt: 20 + index }))]

    const second = await prepareConversationContext({ messages: nextMessages, state: first.state })

    expect(second.messages[0]?.content).toContain('第一段摘要')
    expect(second.messages.some((item) => item.content === original[0]?.text)).toBe(false)
    expect(second.messages.at(-1)?.content).toBe(nextMessages.at(-1)?.text)
  })

  it('enforces the hard input budget even when a summarizer returns oversized content', async () => {
    const input = messages(20, 100_000)
    const result = await prepareConversationContext({ messages: input, fixedContext: ['b'.repeat(80_000)], summarize: async () => 'c'.repeat(1_200_000) })

    expect(result.usedFallback).toBe(true)
    expect(result.estimatedTokens).toBeLessThan(CONTEXT_WINDOW_TOKENS)
    expect(estimateContextTokens(result.messages.map((item) => item.content), ['b'.repeat(80_000)])).toBeLessThan(CONTEXT_WINDOW_TOKENS)
  })

  it('bounds the model request used to summarize oversized history', async () => {
    const generate = vi.fn().mockResolvedValue({ text: '压缩摘要', toolCalls: [] })

    await summarizeConversationWithModel({ generate }, 'text-model', {
      previousSummary: '上一版摘要',
      messages: Array.from({ length: 10 }, (_, index) => ({ role: index % 2 === 0 ? 'user' as const : 'assistant' as const, content: '长'.repeat(80_000) })),
    })

    const request = generate.mock.calls[0][0].request
    expect(estimateContextTokens([request.system, ...request.messages.map((message: { content: string }) => message.content)])).toBeLessThan(CONTEXT_WINDOW_TOKENS)
    expect(request.messages[0].content).toContain('上一版摘要')
    expect(request.system).toContain('当前目标')
    expect(request.system).toContain('已确认事实与约束')
    expect(request.system).toContain('决策与用户偏好')
    expect(request.system).toContain('产物、路径与工具结果')
    expect(request.system).toContain('未完成事项')
    expect(request.system).toContain('变更记录')
    expect(request.system).toContain('用新值更新')
    expect(request.system).toContain('旧值已失效')
  })
})
