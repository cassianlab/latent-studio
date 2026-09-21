import { describe, expect, it } from 'vitest'
import type { AgentRunResult } from '../../src/shared/contracts/agent'
import { buildAgentAssistantMessage, buildAgentToolContext, findLatestCompletedImage, mergeAgentMessages } from '../../src/renderer/agent/agent-conversation-model'

const run = (overrides: Partial<AgentRunResult> = {}): AgentRunResult => ({
  runId: 'run-1',
  status: 'completed',
  text: '',
  steps: [],
  ...overrides,
})

describe('agent conversation message model', () => {
  it('merges persisted and pending turns without rendering a duplicate id', () => {
    const persisted = [{ id: 'u-1', role: 'user' as const, text: '先做一张图', createdAt: 1 }]
    const pending = [
      { id: 'u-1', role: 'user' as const, text: '先做一张图', createdAt: 1 },
      { id: 'a-1', role: 'assistant' as const, text: '', pending: true, createdAt: 2 },
    ]
    expect(mergeAgentMessages(persisted, pending)).toEqual([
      persisted[0],
      pending[1],
    ])
  })

  it('creates a conversational confirmation message for image tasks', () => {
    const message = buildAgentAssistantMessage(run({
      status: 'awaiting-confirmation',
      pendingConfirmation: { action: 'create-image-tasks', input: { prompts: [{ prompt: 'A' }, { prompt: 'B' }] } },
    }), 'a-1', 100)
    expect(message).toMatchObject({
      id: 'a-1',
      role: 'assistant',
      text: '我已准备好 2 个图片任务，确认后开始生成。',
    })
  })

  it('persists provider usage on the assistant turn for context accounting', () => {
    const message = buildAgentAssistantMessage(run({
      text: '已完成',
      usage: { inputTokens: 8_000, outputTokens: 2_000, totalTokens: 10_000, contextTokens: 10_000, reasoningTokens: 1_500 },
    }), 'a-usage', 100)

    expect(message.usage).toEqual({ inputTokens: 8_000, outputTokens: 2_000, totalTokens: 10_000, contextTokens: 10_000, reasoningTokens: 1_500 })
  })

  it('binds generated image tasks to the assistant turn that created them', () => {
    const message = buildAgentAssistantMessage(run({
      text: '图片任务已提交',
      imageTasks: [
        { id: 'task-1', connectionId: 'image', status: 'pending', request: { prompt: '雨夜人像' }, progress: 0, attempts: 0, createdAt: '2026-09-16T10:00:00.000Z', updatedAt: '2026-09-16T10:00:00.000Z' },
        { id: 'task-2', connectionId: 'image', status: 'running', request: { prompt: '雨夜远景' }, progress: 20, attempts: 1, createdAt: '2026-09-16T10:00:01.000Z', updatedAt: '2026-09-16T10:00:02.000Z' },
      ],
    }), 'assistant-run', 100)

    expect(message.imageTaskIds).toEqual(['task-1', 'task-2'])
    expect(message.agentSteps).toEqual([])
  })

  it('marks a failed Agent run as an assistant error message', () => {
    const message = buildAgentAssistantMessage(run({ status: 'failed', text: '文本模型请求失败' }), 'a-2', 100)
    expect(message).toMatchObject({
      id: 'a-2',
      role: 'assistant',
      text: '文本模型请求失败',
      error: '文本模型请求失败',
    })
  })

  it('marks a cancelled Agent response so its user message can be edited and resent', () => {
    const message = buildAgentAssistantMessage(run({ status: 'cancelled', text: '' }), 'a-cancelled', 100)
    expect(message).toMatchObject({ text: '这次 Agent 请求已取消。', cancelled: true })
  })

  it('persists Skill tool results as hidden context for the next turn', () => {
    const message = buildAgentAssistantMessage(run({
      text: '已完成 Skill 分析',
      steps: [{
        id: 'skill-step',
        kind: 'tool',
        name: 'run_skill',
        status: 'completed',
        output: { stdout: '角色造型需要保持红色风衣', stderr: '', exitCode: 0 },
        startedAt: '2026-09-15T00:00:00.000Z',
        finishedAt: '2026-09-15T00:00:01.000Z',
      }],
    }), 'a-skill', 100)

    expect(message.toolContext).toContain('run_skill')
    expect(message.toolContext).toContain('角色造型需要保持红色风衣')
  })

  it('finds the latest completed image by task time regardless of card order', () => {
    const older = { id: 'older', status: 'completed' as const, task: { updatedAt: '2026-09-14T10:00:00.000Z', result: { images: [{ localPath: '/outputs/older.png' }] } } }
    const newer = { id: 'newer', status: 'completed' as const, task: { updatedAt: '2026-09-14T11:00:00.000Z', result: { images: [{ localPath: '/outputs/newer.png' }] } } }

    expect(findLatestCompletedImage([newer, older])?.localPath).toBe('/outputs/newer.png')
    expect(findLatestCompletedImage([older, newer])?.localPath).toBe('/outputs/newer.png')
  })

  it('keeps the recommendation explanation alongside prompt-library cards', () => {
    const message = buildAgentAssistantMessage(run({
      text: '找到了两个可用模板',
      promptResults: [{ id: 'p1', title: '雨夜人像', content: 'A rainy portrait', category: '人像', type: 'prompt', score: 0.9, reason: '标题命中', retrievalMode: 'lexical', thumbnailUrl: 'https://cdn.example.com/p1.jpg' }],
    }), 'a-prompts', 100)
    expect(message.promptResults).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'p1', thumbnailUrl: 'https://cdn.example.com/p1.jpg' })]))
    expect(message.text).toBe('找到了两个可用模板')
  })

  it('stores prompt search results as numbered references for later turns', () => {
    const context = buildAgentToolContext(run({
      steps: [{
        id: 'search-step', kind: 'tool', name: 'search_prompt_library', status: 'completed',
        output: [{ id: 'p1', title: '角色三视图', content: 'front side back' }, { id: 'p2', title: '产品三视图', content: 'product views' }],
        startedAt: '2026-09-16T00:00:00.000Z',
      }],
    }))
    expect(context).toContain('#1 [p1] 角色三视图')
    expect(context).toContain('#2 [p2] 产品三视图')
    expect(context).toContain('front side back')
  })

  it('persists created and updated document identities as conversation artifacts', () => {
    const message = buildAgentAssistantMessage(run({
      text: '文档已处理',
      steps: [
        {
          id: 'create-doc', kind: 'tool', name: 'create_project_document', status: 'completed',
          output: { relativePath: 'documents/brief.md', name: 'brief.md', kind: 'document', extension: '.md', isDirectory: false },
          startedAt: '2026-09-18T00:00:00.000Z', finishedAt: '2026-09-18T00:00:01.000Z',
        },
        {
          id: 'update-doc', kind: 'tool', name: 'update_project_document', status: 'completed',
          output: { relativePath: 'documents/outline.txt', name: '新大纲.txt', kind: 'document', extension: '.txt', isDirectory: false },
          startedAt: '2026-09-18T00:00:02.000Z', finishedAt: '2026-09-18T00:00:03.000Z',
        },
      ],
    }), 'a-docs', 100)

    expect(message.artifacts).toEqual([
      expect.objectContaining({ type: 'document', operation: 'created', relativePath: 'documents/brief.md', name: 'brief.md' }),
      expect.objectContaining({ type: 'document', operation: 'updated', relativePath: 'documents/outline.txt', name: '新大纲.txt' }),
    ])
  })

  it('persists created and updated prompt identities as conversation artifacts', () => {
    const prompt = {
      id: 'prompt-1', name: '雨夜人像', content: '雨夜电影感人像', kind: 'prompt' as const, scope: 'global' as const,
      version: 1, tags: [], favorite: false, collection: '个人', category: '人像',
      createdAt: '2026-09-18T00:00:00.000Z', updatedAt: '2026-09-18T00:00:00.000Z',
    }
    const message = buildAgentAssistantMessage(run({
      text: '提示词已处理',
      steps: [
        { id: 'create-prompt', kind: 'tool', name: 'create_personal_prompt', status: 'completed', output: prompt, startedAt: '2026-09-18T00:00:00.000Z' },
        { id: 'update-prompt', kind: 'tool', name: 'update_personal_prompt', status: 'completed', output: { ...prompt, name: '雨夜近景', version: 2 }, startedAt: '2026-09-18T00:00:01.000Z' },
      ],
    }), 'a-prompts', 100)

    expect(message.artifacts).toEqual([
      expect.objectContaining({ type: 'prompt', operation: 'created', id: 'prompt-1', scope: 'global', name: '雨夜人像' }),
      expect.objectContaining({ type: 'prompt', operation: 'updated', id: 'prompt-1', scope: 'global', name: '雨夜近景' }),
    ])
  })
})
