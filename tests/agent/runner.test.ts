import { describe, expect, it, vi } from 'vitest'
import { AgentRunner } from '../../src/main/agent/runner'
import type { ImageApi, ImageTaskRecord } from '../../src/shared/contracts/images'
import { estimateTextTokens, MODEL_CONTEXT_WINDOW_TOKENS } from '../../src/shared/token-estimator'

function task(id: string): ImageTaskRecord {
  const now = new Date().toISOString()
  return { id, connectionId: 'image-connection', status: 'pending', request: { prompt: id }, progress: 0, attempts: 0, createdAt: now, updatedAt: now }
}

function imageApi(enqueue: (prompt: string) => Promise<ImageTaskRecord>): ImageApi {
  return { enqueue: async ({ request }) => enqueue(request.prompt), list: async () => [], get: async () => null, cancel: async () => true, retry: async () => true, pause: async () => {}, resume: async () => {}, setConnectionConcurrency: async () => {}, onTaskEvent: () => () => {} }
}

describe('agent runner', () => {
  it('forwards streamed model text while keeping the final generation result', async () => {
    const events: Array<{ type: string; text?: string }> = []
    const generateStream = vi.fn(async (_input, emit: (event: { type: 'text_delta'; text: string }) => void) => {
      emit({ type: 'text_delta', text: '第一段' })
      emit({ type: 'text_delta', text: '第二段' })
      return { text: '第一段第二段', toolCalls: [], usage: { inputTokens: 120, outputTokens: 20, totalTokens: 140 } }
    })
    const runner = new AgentRunner({
      generate: vi.fn(),
      generateStream,
      search: vi.fn(),
      readFile: vi.fn(),
      runSkill: vi.fn(),
      image: imageApi(async () => task('unused')),
    })

    const result = await runner.run({ modelProfileId: 'text', prompt: '流式回答' }, (event) => events.push(event))

    expect(result).toMatchObject({ status: 'completed', text: '第一段第二段', usage: { inputTokens: 120, outputTokens: 20, totalTokens: 140 } })
    expect(generateStream).toHaveBeenCalledOnce()
    expect(events.filter((event) => event.type !== 'activity')).toEqual([
      { type: 'text_delta', text: '第一段' },
      { type: 'text_delta', text: '第二段' },
    ])
  })

  it('chains project search and file tools until the model returns text', async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce({ text: '', toolCalls: [{ id: 'search-1', name: 'search_web', arguments: '{"query":"雨夜摄影"}' }], usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120, reasoningTokens: 10 } })
      .mockResolvedValueOnce({ text: '', toolCalls: [{ id: 'file-1', name: 'read_project_file', arguments: '{"filePath":"notes.md"}' }], usage: { inputTokens: 180, outputTokens: 30, totalTokens: 210, reasoningTokens: 12 } })
      .mockResolvedValueOnce({ text: '结论', toolCalls: [], usage: { inputTokens: 260, outputTokens: 40, totalTokens: 300, reasoningTokens: 15 } })
    const runner = new AgentRunner({
      generate,
      search: async () => ({ query: '雨夜摄影', searchedAt: '', results: [] }),
      readFile: async () => ({ summary: { relativePath: 'notes.md', fileName: 'notes.md', kind: 'markdown', mimeType: 'text/markdown', byteLength: 5 }, text: '笔记' }),
      runSkill: vi.fn(),
      image: imageApi(async () => task('unused')),
    })
    const result = await runner.run({ modelProfileId: 'text', prompt: '整理资料', maxSteps: 4 })
    expect(result.status).toBe('completed')
    expect(result.text).toBe('结论')
    expect(result.steps.map((step) => step.name)).toEqual(['文本模型', 'search_web', '文本模型', 'read_project_file', '文本模型', '完成'])
    expect(generate).toHaveBeenCalledTimes(3)
    expect(generate.mock.calls.every(([call]) => call.request.includeUsage === true)).toBe(true)
    expect(result.usage).toEqual({ inputTokens: 540, outputTokens: 90, totalTokens: 630, reasoningTokens: 37, contextTokens: 300 })
  })

  it('reports readable execution stages before and during tool work', async () => {
    const events: Array<Record<string, unknown>> = []
    const generate = vi.fn()
      .mockResolvedValueOnce({ text: '我先查一下最新资料。', toolCalls: [{ id: 'search-1', name: 'search_web', arguments: '{"query":"雨夜摄影"}' }] })
      .mockResolvedValueOnce({ text: '已经整理好了。', toolCalls: [] })
    const runner = new AgentRunner({
      generate,
      search: async () => ({ query: '雨夜摄影', searchedAt: '', results: [] }),
      readFile: vi.fn(),
      runSkill: vi.fn(),
      image: imageApi(async () => task('unused')),
    })

    await runner.run({ modelProfileId: 'text', prompt: '查一下雨夜摄影' }, (event) => events.push(event))

    expect(events).toEqual(expect.arrayContaining([
      { type: 'activity', phase: 'thinking', label: '正在理解你的要求' },
      { type: 'activity', phase: 'tool', label: '正在联网检索' },
      { type: 'activity', phase: 'thinking', label: '正在整理执行结果' },
    ]))
    expect(events).not.toContainEqual({ type: 'text_reset' })
  })

  it('lets the model search the prompt library before composing an answer', async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce({ text: '', toolCalls: [{ id: 'prompt-search-1', name: 'search_prompt_library', arguments: '{"query":"旅行徽章","limit":3}' }] })
      .mockResolvedValueOnce({ text: '找到了适合的提示词', toolCalls: [] })
    const searchPrompts = vi.fn().mockResolvedValue([{ id: 'prompt-1', name: '旅行纪念徽章', content: 'Turn the reference photo into an enamel pin.', tags: ['Product'] }])
    const runner = new AgentRunner({ generate, search: vi.fn(), searchPrompts, readFile: vi.fn(), runSkill: vi.fn(), image: imageApi(async () => task('unused')) })

    const result = await runner.run({ modelProfileId: 'text', prompt: '从提示词库找一个旅行徽章做法' })

    expect(result.status).toBe('completed')
    expect(searchPrompts).toHaveBeenCalledWith({ query: '旅行徽章', limit: 3 })
    expect(generate.mock.calls[1][0].request.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'tool', name: 'search_prompt_library', content: expect.stringContaining('旅行纪念徽章') }),
    ]))
  })

  it('keeps tool-call preamble out of the final answer and resets provisional streamed text', async () => {
    const events: Array<{ type: string; text?: string }> = []
    const generateStream = vi.fn()
      .mockImplementationOnce(async (_input, emit: (event: { type: 'text_delta'; text: string }) => void) => {
        emit({ type: 'text_delta', text: '我先检索并展示提示词正文' })
        return { text: '我先检索并展示提示词正文', toolCalls: [{ id: 'search-1', name: 'search_prompt_library', arguments: '{"query":"三视图"}' }] }
      })
      .mockImplementationOnce(async (_input, emit: (event: { type: 'text_delta'; text: string }) => void) => {
        emit({ type: 'text_delta', text: '推荐角色三视图，因为它明确包含正面、侧面和背面。' })
        return { text: '推荐角色三视图，因为它明确包含正面、侧面和背面。', toolCalls: [] }
      })
    const runner = new AgentRunner({
      generate: vi.fn(),
      generateStream,
      search: vi.fn(),
      searchPromptLibrary: vi.fn().mockResolvedValue([{ id: 'p1', title: '角色三视图', content: 'front side back', category: '角色设计', type: 'prompt', collection: '个人', score: 1, reason: '标题命中', retrievalMode: 'lexical' }]),
      readFile: vi.fn(),
      runSkill: vi.fn(),
      image: imageApi(async () => task('unused')),
    })

    const result = await runner.run({ modelProfileId: 'text', prompt: '检索三视图提示词' }, (event) => events.push(event))

    expect(result.text).toBe('推荐角色三视图，因为它明确包含正面、侧面和背面。')
    expect(events.filter((event) => event.type !== 'activity')).toEqual([
      { type: 'text_delta', text: '我先检索并展示提示词正文' },
      { type: 'text_reset' },
      { type: 'text_delta', text: '推荐角色三视图，因为它明确包含正面、侧面和背面。' },
    ])
  })

  it('tells the model how to use numbered prompt cards in later turns', async () => {
    const generate = vi.fn().mockResolvedValue({ text: '请补充希望如何改写第一个提示词。', toolCalls: [] })
    const runner = new AgentRunner({ generate, search: vi.fn(), readFile: vi.fn(), runSkill: vi.fn(), image: imageApi(async () => task('unused')) })

    await runner.run({
      modelProfileId: 'text',
      prompt: '改写第一个',
      contextMessages: [{ role: 'assistant', content: '【提示词检索结果】\n#1 [p1] 角色三视图\nfront side back' }],
    })

    expect(generate.mock.calls[0][0].request.system).toContain('第一个')
    expect(generate.mock.calls[0][0].request.system).toContain('缺少改写要求')
    expect(generate.mock.calls[0][0].request.messages).toContainEqual(expect.objectContaining({ role: 'assistant', content: expect.stringContaining('#1 [p1]') }))
  })

  it('reads prompt details, project memory, and asset metadata through narrow tools', async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce({ text: '', toolCalls: [{ id: 'prompt-detail', name: 'get_prompt_detail', arguments: '{"id":"prompt-1"}' }] })
      .mockResolvedValueOnce({ text: '', toolCalls: [{ id: 'memory-read', name: 'read_project_memory', arguments: '{"id":"memory-1"}' }] })
      .mockResolvedValueOnce({ text: '', toolCalls: [{ id: 'asset-read', name: 'read_project_asset_metadata', arguments: '{"id":"asset-1"}' }] })
      .mockResolvedValueOnce({ text: '已读取项目资料', toolCalls: [] })
    const getPromptDetail = vi.fn().mockResolvedValue({ id: 'prompt-1', name: '雨夜人像', content: '电影感雨夜人像' })
    const readProjectMemory = vi.fn().mockResolvedValue({ id: 'memory-1', title: '角色设定', content: '红色外套' })
    const readProjectAssetMetadata = vi.fn().mockResolvedValue({ id: 'asset-1', name: '角色参考.png', relativePath: 'assets/角色参考.png' })
    const runner = new AgentRunner({ generate, search: vi.fn(), readFile: vi.fn(), runSkill: vi.fn(), getPromptDetail, readProjectMemory, readProjectAssetMetadata, image: imageApi(async () => task('unused')) })

    const result = await runner.run({ modelProfileId: 'text', prompt: '读取这些项目资料', mode: 'agent', maxSteps: 6 })

    expect(result.status).toBe('completed')
    expect(getPromptDetail).toHaveBeenCalledWith({ id: 'prompt-1' })
    expect(readProjectMemory).toHaveBeenCalledWith({ id: 'memory-1' })
    expect(readProjectAssetMetadata).toHaveBeenCalledWith({ id: 'asset-1' })
    expect(generate.mock.calls.at(-1)?.[0].request.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'tool', name: 'get_prompt_detail', content: expect.stringContaining('雨夜人像') }),
      expect.objectContaining({ role: 'tool', name: 'read_project_memory', content: expect.stringContaining('红色外套') }),
      expect.objectContaining({ role: 'tool', name: 'read_project_asset_metadata', content: expect.stringContaining('角色参考.png') }),
    ]))
  })

  it('includes prior conversation turns when starting a new Agent run', async () => {
    const generate = vi.fn().mockResolvedValue({ text: '继续刚才的方案', toolCalls: [] })
    const runner = new AgentRunner({ generate, search: vi.fn(), readFile: vi.fn(), runSkill: vi.fn(), image: imageApi(async () => task('unused')) })
    await runner.run({ modelProfileId: 'text', prompt: '把主角改成近景', contextMessages: [{ role: 'user', content: '先做一个雨夜远景' }, { role: 'assistant', content: '已准备远景方案' }] })
    expect(generate.mock.calls[0][0].request.messages).toEqual([
      { role: 'user', content: '先做一个雨夜远景' },
      { role: 'assistant', content: '已准备远景方案' },
      { role: 'user', content: '把主角改成近景' },
    ])
  })

  it('keeps prior conversation turns when the selected model changes', async () => {
    const generate = vi.fn().mockResolvedValue({ text: '模型 B 已理解此前要求', toolCalls: [] })
    const runner = new AgentRunner({ generate, search: vi.fn(), readFile: vi.fn(), runSkill: vi.fn(), image: imageApi(async () => task('unused')) })

    await runner.run({
      modelProfileId: 'model-b',
      prompt: '继续调整光线',
      contextMessages: [
        { role: 'user', content: '使用模型 A：先做一个雨夜远景' },
        { role: 'assistant', content: '模型 A：已准备远景方案' },
      ],
    })

    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      modelProfileId: 'model-b',
      request: expect.objectContaining({
        messages: [
          { role: 'user', content: '使用模型 A：先做一个雨夜远景' },
          { role: 'assistant', content: '模型 A：已准备远景方案' },
          { role: 'user', content: '继续调整光线' },
        ],
      }),
    }))
  })

  it('places uploaded document attachments in the Agent context', async () => {
    const generate = vi.fn().mockResolvedValue({ text: '已读取附件', toolCalls: [] })
    const runner = new AgentRunner({ generate, search: vi.fn(), readFile: vi.fn(), runSkill: vi.fn(), image: imageApi(async () => task('unused')) })
    const attachment = {
      summary: { relativePath: 'brief.md', fileName: 'brief.md', kind: 'markdown' as const, mimeType: 'text/markdown' as const, byteLength: 12 },
      text: '主角穿红色外套',
    }

    await runner.run({ modelProfileId: 'text', prompt: '按附件设定执行', attachments: [attachment] })

    expect(generate.mock.calls[0][0].request.messages[0]).toEqual({
      role: 'system',
      content: expect.stringContaining('主角穿红色外套'),
    })
  })

  it('gives every uploaded attachment a readable share of the context budget', async () => {
    const generate = vi.fn().mockResolvedValue({ text: '已读取全部附件', toolCalls: [] })
    const runner = new AgentRunner({ generate, search: vi.fn(), readFile: vi.fn(), runSkill: vi.fn(), image: imageApi(async () => task('unused')) })
    const summary = (fileName: string) => ({ relativePath: fileName, fileName, kind: 'plain-text' as const, mimeType: 'text/plain' as const, byteLength: 30_000 })

    await runner.run({
      modelProfileId: 'text',
      prompt: '对比两个附件',
      attachments: [
        { summary: summary('first.txt'), text: 'a'.repeat(30_000) },
        { summary: summary('second.txt'), text: '第二个附件的关键结论' },
      ],
    })

    expect(generate.mock.calls[0][0].request.messages[0].content).toContain('附件：second.txt')
    expect(generate.mock.calls[0][0].request.messages[0].content).toContain('第二个附件的关键结论')
  })

  it('marks oversized attachment excerpts and preserves their beginning and ending', async () => {
    const generate = vi.fn().mockResolvedValue({ text: '已读取附件摘要', toolCalls: [] })
    const runner = new AgentRunner({ generate, search: vi.fn(), readFile: vi.fn(), runSkill: vi.fn(), image: imageApi(async () => task('unused')) })
    const middle = 'm'.repeat(500_000)

    await runner.run({
      modelProfileId: 'text',
      prompt: '检查附件开头和结尾',
      attachments: [{
        summary: { relativePath: 'long.txt', fileName: 'long.txt', kind: 'plain-text', mimeType: 'text/plain', byteLength: middle.length + 14 },
        text: `开头关键事实-${middle}-结尾关键事实`,
      }],
    })

    const attachmentContext = generate.mock.calls[0][0].request.messages[0].content
    expect(attachmentContext).toContain('开头关键事实')
    expect(attachmentContext).toContain('结尾关键事实')
    expect(attachmentContext).toContain('已省略')
  })

  it('lets the text Agent inspect selected reference images as multimodal input', async () => {
    const generate = vi.fn().mockResolvedValue({ text: '已判断参考图构图', toolCalls: [] })
    const readImageReferences = vi.fn().mockResolvedValue([{ type: 'image' as const, data: 'iVBORw0KGgo=', mimeType: 'image/png' }])
    const runner = new AgentRunner({ generate, readImageReferences, search: vi.fn(), readFile: vi.fn(), runSkill: vi.fn(), image: imageApi(async () => task('unused')) })

    await runner.run({
      modelProfileId: 'text',
      prompt: '判断这张参考图的构图并给出修改方案',
      references: [{ type: 'file', path: 'assets/reference.png', mimeType: 'image/png' }],
    })

    expect(readImageReferences).toHaveBeenCalledWith([{ type: 'file', path: 'assets/reference.png', mimeType: 'image/png' }])
    expect(generate.mock.calls[0][0].request.messages).toContainEqual({
      role: 'user',
      content: [
        { type: 'text', text: '判断这张参考图的构图并给出修改方案' },
        { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' },
      ],
    })
  })

  it('lets the model activate an authorized Skill from compact metadata before loading its instructions', async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce({ text: '', toolCalls: [{ id: 'activate-1', name: 'activate_skills', arguments: JSON.stringify({ skillIds: ['custom-storyboard'], reason: '需要把剧本拆成可执行镜头' }) }] })
      .mockResolvedValueOnce({ text: '已按分镜 Skill 完成', toolCalls: [] })
    const listSkillCandidates = vi.fn().mockResolvedValue([
      { id: 'custom-storyboard', name: 'storyboard', displayName: '分镜规划', description: '拆分镜头' },
    ])
    const resolveSkills = vi.fn().mockResolvedValue([
      { id: 'custom-storyboard', name: 'storyboard', displayName: '分镜规划', description: '拆分镜头', contentHash: 'hash-storyboard', instructions: '# 分镜规划\n先列出镜头不变量。' },
    ])
    const runner = new AgentRunner({
      generate,
      listSkillCandidates,
      resolveSkills,
      search: vi.fn(),
      readFile: vi.fn(),
      runSkill: vi.fn(),
      image: imageApi(async () => task('unused')),
    })
    const result = await runner.run({ modelProfileId: 'text', prompt: '把这段剧本拆成分镜' })

    expect(listSkillCandidates).toHaveBeenCalledWith('agent')
    expect(generate.mock.calls[0][0].request.system).toContain('custom-storyboard')
    expect(generate.mock.calls[0][0].request.system).toContain('拆分镜头')
    expect(generate.mock.calls[0][0].request.system).not.toContain('先列出镜头不变量')
    expect(resolveSkills).toHaveBeenCalledExactlyOnceWith('把这段剧本拆成分镜', 'custom-storyboard', 'agent')
    expect(generate.mock.calls[1][0].request.system).toContain('先列出镜头不变量')
    expect(result.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'activate_skills', input: expect.objectContaining({ reason: '需要把剧本拆成可执行镜头' }) }),
    ]))
    expect(result.skillContexts).toContainEqual(expect.objectContaining({ id: 'custom-storyboard' }))
  })

  it('rejects automatic activation of a Skill that was not in the authorized candidate list', async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce({ text: '', toolCalls: [{ id: 'activate-unknown', name: 'activate_skills', arguments: JSON.stringify({ skillIds: ['not-authorized'], reason: '尝试越权' }) }] })
      .mockResolvedValueOnce({ text: '未激活未授权 Skill', toolCalls: [] })
    const resolveSkills = vi.fn()
    const runner = new AgentRunner({
      generate,
      listSkillCandidates: vi.fn().mockResolvedValue([{ id: 'allowed', name: 'allowed', displayName: '允许的 Skill' }]),
      resolveSkills,
      search: vi.fn(),
      readFile: vi.fn(),
      runSkill: vi.fn(),
      image: imageApi(async () => task('unused')),
    })

    const result = await runner.run({ modelProfileId: 'text', prompt: '执行任务' })

    expect(resolveSkills).not.toHaveBeenCalled()
    expect(result.steps.some((item) => item.error?.includes('不在当前授权候选列表'))).toBe(true)
  })

  it('reuses an uncompressed Skill snapshot while loading only the newly selected Skill', async () => {
    const generate = vi.fn().mockResolvedValue({ text: '已综合两个 Skill', toolCalls: [] })
    const resolveSkills = vi.fn(async (_prompt: string, selectedSkillId?: string) => selectedSkillId === 'skill-1'
      ? [{ id: 'skill-1', name: 'first', displayName: 'Skill 1', contentHash: 'hash-1', instructions: '# Skill 1' }]
      : [{ id: 'skill-2', name: 'second', displayName: 'Skill 2', contentHash: 'hash-2', instructions: '# Skill 2' }])
    const runner = new AgentRunner({ generate, resolveSkills, search: vi.fn(), readFile: vi.fn(), runSkill: vi.fn(), image: imageApi(async () => task('unused')) })

    const first = await runner.run({
      modelProfileId: 'text',
      prompt: '第一轮',
      skillId: 'skill-1',
      messageId: 'message-1',
    })
    await runner.run({ modelProfileId: 'text', prompt: '第二轮', skillId: 'skill-2', messageId: 'message-2', skillContexts: first.skillContexts })

    expect(resolveSkills.mock.calls).toEqual([['第一轮', 'skill-1', 'agent'], ['第二轮', 'skill-2', 'agent']])
    expect(generate.mock.calls[1][0].request.system).toContain('# Skill 1')
    expect(generate.mock.calls[1][0].request.system).toContain('# Skill 2')
  })

  it('keeps all Skill snapshots until conversation compaction removes their turns', async () => {
    const generate = vi.fn().mockResolvedValue({ text: '继续使用历史上下文', toolCalls: [] })
    const skillContexts = Array.from({ length: 13 }, (_, index) => ({
      id: `skill-${index + 1}`,
      name: `skill-${index + 1}`,
      displayName: `Skill ${index + 1}`,
      contentHash: `hash-${index + 1}`,
      instructions: `# Skill ${index + 1}`,
      activatedAtMessageId: `message-${index + 1}`,
    }))
    const runner = new AgentRunner({ generate, resolveSkills: vi.fn().mockResolvedValue([]), search: vi.fn(), readFile: vi.fn(), runSkill: vi.fn(), image: imageApi(async () => task('unused')) })

    const result = await runner.run({ modelProfileId: 'text', prompt: '继续', skillContexts })

    expect(result.skillContexts).toHaveLength(13)
    expect(generate.mock.calls[0][0].request.system).toContain('# Skill 1')
  })

  it('reactivates an unchanged Skill snapshot for the current turn', async () => {
    const generate = vi.fn().mockResolvedValue({ text: '已继续使用同一个 Skill', toolCalls: [] })
    const unchanged = { id: 'skill-1', name: 'first', displayName: 'Skill 1', contentHash: 'hash-1', instructions: '# Skill 1' }
    const resolveSkills = vi.fn().mockResolvedValue([unchanged])
    const runner = new AgentRunner({ generate, resolveSkills, search: vi.fn(), readFile: vi.fn(), runSkill: vi.fn(), image: imageApi(async () => task('unused')) })

    const result = await runner.run({
      modelProfileId: 'text',
      prompt: '继续使用同一个 Skill',
      skillId: 'skill-1',
      messageId: 'message-2',
      skillContexts: [{ ...unchanged, activatedAtMessageId: 'message-1' }],
    })

    expect(result.skillContexts).toContainEqual({ ...unchanged, activatedAtMessageId: 'message-2' })
  })

  it('keeps text mode Skill-free until the user selects a slash command', async () => {
    const generate = vi.fn().mockResolvedValue({ text: '普通文本回答', toolCalls: [] })
    const resolveSkills = vi.fn().mockResolvedValue([{ id: 'auto', name: 'auto', displayName: '自动 Skill', contentHash: 'hash', instructions: '# 自动 Skill' }])
    const runner = new AgentRunner({ generate, resolveSkills, search: vi.fn(), readFile: vi.fn(), runSkill: vi.fn(), image: imageApi(async () => task('unused')) })

    await runner.run({ modelProfileId: 'text', prompt: '普通文本问题', mode: 'text' })

    expect(resolveSkills).not.toHaveBeenCalled()
    expect(generate.mock.calls[0][0].request.system).toContain('当前轮没有激活 Skill')
  })

  it('resolves and exposes an explicitly selected Skill in text mode', async () => {
    const generate = vi.fn().mockResolvedValue({ text: '已按选定 Skill 回答', toolCalls: [] })
    const selectedSkill = { id: 'skill-writing', name: 'writing', displayName: '写作助手', contentHash: 'hash-writing', instructions: '# 写作助手\n先检查结构。' }
    const resolveSkills = vi.fn().mockResolvedValue([selectedSkill])
    const runner = new AgentRunner({ generate, resolveSkills, search: vi.fn(), readFile: vi.fn(), runSkill: vi.fn(), image: imageApi(async () => task('unused')) })

    await runner.run({ modelProfileId: 'text', prompt: '请检查这段文案', mode: 'text', skillId: 'skill-writing' })

    expect(resolveSkills).toHaveBeenCalledWith('请检查这段文案', 'skill-writing', 'text')
    expect(generate.mock.calls[0][0].request.system).toContain('当前轮已激活的 Skills')
    expect(generate.mock.calls[0][0].request.system).toContain('先检查结构')
  })

  it('does not execute a historical Skill that was not activated for the current turn', async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce({ text: '', toolCalls: [{ id: 'stale-skill', name: 'run_skill', arguments: '{"skillId":"skill-1","entrypoint":"run.js"}' }] })
      .mockResolvedValueOnce({ text: '未执行历史 Skill', toolCalls: [] })
    const runSkill = vi.fn()
    const runner = new AgentRunner({ generate, resolveSkills: vi.fn().mockResolvedValue([]), search: vi.fn(), readFile: vi.fn(), runSkill, image: imageApi(async () => task('unused')) })

    const result = await runner.run({
      modelProfileId: 'text',
      prompt: '只参考上轮结论',
      mode: 'text',
      skillContexts: [{ id: 'skill-1', name: 'first', displayName: 'Skill 1', contentHash: 'hash-1', instructions: '# Skill 1', activatedAtMessageId: 'message-1' }],
    })

    expect(runSkill).not.toHaveBeenCalled()
    expect(result.steps.some((step) => step.error?.includes('本轮未激活'))).toBe(true)
  })

  it('does not expose image tools or execute image calls in text mode', async () => {
    const generate = vi.fn().mockResolvedValue({ text: '文本回答', toolCalls: [] })
    const enqueue = vi.fn().mockResolvedValue(task('forbidden'))
    const runner = new AgentRunner({ generate, search: vi.fn(), readFile: vi.fn(), runSkill: vi.fn(), image: { ...imageApi(async () => task('unused')), enqueue } })

    await runner.run({ modelProfileId: 'text', prompt: '只做文本分析', mode: 'text' })

    const names = generate.mock.calls[0][0].request.tools.map((tool: { name: string }) => tool.name)
    expect(names).toContain('run_skill')
    expect(names).not.toContain('create_image_tasks')
    expect(names).not.toContain('control_image_tasks')
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('does not expose or execute project write tools without explicit permissions', async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce({ text: '', toolCalls: [{ id: 'doc-create', name: 'create_project_document', arguments: JSON.stringify({ title: '人物小传', content: '# 人物小传' }) }] })
      .mockResolvedValueOnce({ text: '未保存', toolCalls: [] })
    const writeProjectDocument = vi.fn()
    const runner = new AgentRunner({ generate, search: vi.fn(), readFile: vi.fn(), runSkill: vi.fn(), writeProjectDocument, image: imageApi(async () => task('unused')) })

    const result = await runner.run({ modelProfileId: 'text', prompt: '保存人物小传', mode: 'agent' })

    const names = generate.mock.calls[0][0].request.tools.map((tool: { name: string }) => tool.name)
    expect(names).not.toContain('create_project_document')
    expect(writeProjectDocument).not.toHaveBeenCalled()
    expect(result.steps.filter((step) => step.error)).toEqual([expect.objectContaining({ error: expect.stringContaining('未获得该写入操作的授权') })])
  })

  it('lets Agent mode create project documents, memories, and personal prompts with explicit permissions', async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce({ text: '', toolCalls: [{ id: 'doc-create', name: 'create_project_document', arguments: JSON.stringify({ title: '人物小传', content: '# 人物小传\n主角设定' }) }] })
      .mockResolvedValueOnce({ text: '', toolCalls: [{ id: 'memory-create', name: 'create_project_memory', arguments: JSON.stringify({ title: '角色统一性', content: '主角穿红色外套' }) }] })
      .mockResolvedValueOnce({ text: '', toolCalls: [{ id: 'prompt-create', name: 'create_personal_prompt', arguments: JSON.stringify({ name: '雨夜人像', content: '雨夜电影感人像', category: '人像' }) }] })
      .mockResolvedValueOnce({ text: '已保存', toolCalls: [] })
    const writeProjectDocument = vi.fn().mockResolvedValue({ relativePath: 'documents/人物小传.md', name: '人物小传.md' })
    const createProjectMemory = vi.fn().mockResolvedValue({ id: 'memory-1', title: '角色统一性' })
    const createPersonalPrompt = vi.fn().mockResolvedValue({ id: 'prompt-1', name: '雨夜人像' })
    const runner = new AgentRunner({ generate, search: vi.fn(), readFile: vi.fn(), runSkill: vi.fn(), writeProjectDocument, createProjectMemory, createPersonalPrompt, image: imageApi(async () => task('unused')) })

    const result = await runner.run({
      modelProfileId: 'text',
      prompt: '保存文档、项目记忆和个人提示词',
      mode: 'agent',
      maxSteps: 6,
      permissions: ['write-project-documents', 'write-project-memories', 'write-personal-prompts'],
    })

    expect(result.status).toBe('completed')
    expect(writeProjectDocument).toHaveBeenCalledWith({ title: '人物小传', content: '# 人物小传\n主角设定' })
    expect(createProjectMemory).toHaveBeenCalledWith({ title: '角色统一性', content: '主角穿红色外套' })
    expect(createPersonalPrompt).toHaveBeenCalledWith({ name: '雨夜人像', content: '雨夜电影感人像', scope: 'global', category: '人像' })
  })

  it('never exposes Agent write tools in text mode', async () => {
    const generate = vi.fn().mockResolvedValue({ text: '只读回答', toolCalls: [] })
    const runner = new AgentRunner({ generate, search: vi.fn(), readFile: vi.fn(), runSkill: vi.fn(), image: imageApi(async () => task('unused')) })

    await runner.run({ modelProfileId: 'text', prompt: '分析这份文档', mode: 'text' })

    const names = generate.mock.calls[0][0].request.tools.map((tool: { name: string }) => tool.name)
    expect(names).not.toContain('create_project_document')
    expect(names).not.toContain('update_project_memory')
    expect(names).not.toContain('delete_personal_prompt')
  })

  it('only exposes project read tools when project context is enabled', async () => {
    const generate = vi.fn().mockResolvedValue({ text: '只读回答', toolCalls: [] })
    const runner = new AgentRunner({ generate, search: vi.fn(), readFile: vi.fn(), runSkill: vi.fn(), image: imageApi(async () => task('unused')) })

    await runner.run({ modelProfileId: 'text', prompt: '普通文本问题', mode: 'text', projectContext: false })
    await runner.run({ modelProfileId: 'text', prompt: '分析项目资料', mode: 'text', projectContext: true })

    const withoutContext = generate.mock.calls[0][0].request.tools.map((tool: { name: string }) => tool.name)
    const withContext = generate.mock.calls[1][0].request.tools.map((tool: { name: string }) => tool.name)
    expect(withoutContext).not.toContain('read_project_file')
    expect(withoutContext).not.toContain('read_project_memory')
    expect(withoutContext).not.toContain('read_project_asset_metadata')
    expect(withContext).toContain('read_project_file')
    expect(withContext).toContain('read_project_memory')
    expect(withContext).toContain('read_project_asset_metadata')
  })

  it('requires explicit confirmation before overwriting or deleting user data even in automatic mode', async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce({ text: '', toolCalls: [{ id: 'doc-update', name: 'update_project_document', arguments: JSON.stringify({ filePath: 'documents/brief.md', title: '新简介', content: '新内容' }) }] })
      .mockResolvedValueOnce({ text: '已更新', toolCalls: [] })
    const updateProjectDocument = vi.fn().mockResolvedValue({ relativePath: 'documents/brief.md', name: 'brief.md' })
    const runner = new AgentRunner({ generate, search: vi.fn(), readFile: vi.fn(), runSkill: vi.fn(), updateProjectDocument, image: imageApi(async () => task('unused')) })

    const pending = await runner.run({ modelProfileId: 'text', prompt: '覆盖更新 brief.md', mode: 'agent', requireConfirmation: false, permissions: ['write-project-documents'] })

    expect(pending.status).toBe('awaiting-confirmation')
    expect(pending.pendingConfirmation).toMatchObject({ action: 'update-project-document', toolName: 'update_project_document' })
    expect(updateProjectDocument).not.toHaveBeenCalled()

    const completed = await runner.confirm(pending.runId)
    expect(completed.status).toBe('completed')
    expect(updateProjectDocument).toHaveBeenCalledWith({ filePath: 'documents/brief.md', title: '新简介', content: '新内容' })
  })

  it('updates an existing personal prompt by stable id without creating a replacement', async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce({ text: '', toolCalls: [{ id: 'prompt-update', name: 'update_personal_prompt', arguments: JSON.stringify({ id: 'prompt-1', scope: 'global', name: '雨夜近景', content: '雨夜电影感近景' }) }] })
      .mockResolvedValueOnce({ text: '已更新', toolCalls: [] })
    const updated = { id: 'prompt-1', name: '雨夜近景', content: '雨夜电影感近景', scope: 'global' as const, kind: 'prompt' as const, version: 1, tags: [], favorite: false, collection: '个人', category: '人像', createdAt: '2026-09-18T00:00:00.000Z', updatedAt: '2026-09-18T00:01:00.000Z' }
    const updatePersonalPrompt = vi.fn().mockResolvedValue(updated)
    const createPersonalPrompt = vi.fn()
    const runner = new AgentRunner({ generate, search: vi.fn(), readFile: vi.fn(), runSkill: vi.fn(), updatePersonalPrompt, createPersonalPrompt, image: imageApi(async () => task('unused')) })

    const pending = await runner.run({ modelProfileId: 'text', prompt: '把刚才的提示词改成近景', mode: 'agent', permissions: ['write-personal-prompts'] })
    expect(pending.status).toBe('awaiting-confirmation')

    const completed = await runner.confirm(pending.runId)
    expect(completed.status).toBe('completed')
    expect(updatePersonalPrompt).toHaveBeenCalledWith({ id: 'prompt-1', scope: 'global', name: '雨夜近景', content: '雨夜电影感近景' })
    expect(createPersonalPrompt).not.toHaveBeenCalled()
    expect(completed.steps).toContainEqual(expect.objectContaining({ name: 'update_personal_prompt', status: 'completed', output: updated }))
  })

  it('keeps every model request below the hard context budget', async () => {
    const generate = vi.fn().mockResolvedValue({ text: '仍可继续', toolCalls: [] })
    const runner = new AgentRunner({ generate, search: vi.fn(), readFile: vi.fn(), runSkill: vi.fn(), image: imageApi(async () => task('unused')) })
    const contextMessages = Array.from({ length: 12 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      content: `${index}:` + '长'.repeat(40_000),
    }))

    await runner.run({ modelProfileId: 'text', prompt: '保留当前请求', contextMessages })

    const request = generate.mock.calls[0][0].request
    const estimatedTokens = estimateTextTokens(request.system) + request.messages.reduce((total: number, message: { content: string | readonly { type: string; text?: string }[] }) => {
      if (typeof message.content === 'string') return total + estimateTextTokens(message.content) + 8
      return total + message.content.reduce((sum, part) => sum + (part.type === 'text' ? estimateTextTokens(part.text ?? '') : 2_000), 8)
    }, 0)
    expect(estimatedTokens).toBeLessThan(MODEL_CONTEXT_WINDOW_TOKENS)
    expect(request.messages).toContainEqual({ role: 'user', content: '保留当前请求' })
  })

  it('pauses image creation for confirmation and submits prompts concurrently', async () => {
    const generate = vi.fn().mockResolvedValueOnce({ text: '', toolCalls: [{ id: 'image-1', name: 'create_image_tasks', arguments: JSON.stringify({ mode: 'smart', prompts: [{ title: '广角', prompt: '雨夜广角镜头' }, { title: '近景', prompt: '雨夜近景镜头' }] }) }] })
      .mockResolvedValueOnce({ text: '任务已创建', toolCalls: [] })
    const prompts: string[] = []
    const runner = new AgentRunner({
      generate,
      search: vi.fn(),
      readFile: vi.fn(),
      runSkill: vi.fn(),
      image: imageApi(async (prompt) => { prompts.push(prompt); return task(`task-${prompts.length}`) }),
    })
    const pending = await runner.run({ modelProfileId: 'text', imageModelProfileId: 'image', prompt: '生成两张图' })
    expect(pending.status).toBe('awaiting-confirmation')
    expect(pending.pendingConfirmation?.action).toBe('create-image-tasks')
    const completed = await runner.confirm(pending.runId)
    expect(completed.status).toBe('completed')
    expect(prompts).toEqual(['雨夜广角镜头', '雨夜近景镜头'])
    expect(completed.imageTasks).toHaveLength(2)
  })

  it('executes image creation immediately when confirmation is disabled', async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce({ text: '', toolCalls: [{ id: 'image-auto', name: 'create_image_tasks', arguments: JSON.stringify({ mode: 'smart', prompts: [{ title: '远景', prompt: '雨夜远景' }, { title: '近景', prompt: '雨夜近景' }] }) }] })
      .mockResolvedValueOnce({ text: '自动任务已提交', toolCalls: [] })
    const prompts: string[] = []
    const runner = new AgentRunner({
      generate,
      search: vi.fn(),
      readFile: vi.fn(),
      runSkill: vi.fn(),
      image: imageApi(async (prompt) => { prompts.push(prompt); return task(`auto-task-${prompts.length}`) }),
    })
    const result = await runner.run({ modelProfileId: 'text', imageModelProfileId: 'image', prompt: '自动生成两张图', requireConfirmation: false })
    expect(result.status).toBe('completed')
    expect(result.pendingConfirmation).toBeUndefined()
    expect(prompts).toEqual(['雨夜远景', '雨夜近景'])
  })

  it('preserves export specifications and shared invariants in automatic image tasks', async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce({ text: '', toolCalls: [{ id: 'spec-task', name: 'create_image_tasks', arguments: JSON.stringify({ prompts: [{ title: '雨夜近景人像', prompt: '雨夜近景' }], invariants: ['银发女主角，红色外套'] }) }] })
      .mockResolvedValueOnce({ text: '已提交', toolCalls: [] })
    const enqueue = vi.fn().mockResolvedValue(task('spec-task'))
    const runner = new AgentRunner({ generate, search: vi.fn(), readFile: vi.fn(), runSkill: vi.fn(), image: { ...imageApi(async () => task('unused')), enqueue } })
    await runner.run({ modelProfileId: 'text', imageModelProfileId: 'image', prompt: '生成一张图', requireConfirmation: false, imageRequest: { size: '3840x2160', outputSize: '3840x2160', quality: 'xhigh', background: 'transparent', outputFormat: 'png' } })
    expect(generate.mock.calls[0][0].request.system).toContain('主体、场景、构图、光线和风格')
    expect(generate.mock.calls[0][0].request.system).toContain('创建任务前先确定简洁的任务名称')
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ title: '雨夜近景人像', request: expect.objectContaining({
      size: '3840x2160', outputSize: '3840x2160', quality: 'xhigh', background: 'transparent', outputFormat: 'png', prompt: expect.stringContaining('银发女主角，红色外套'),
    }) }))
  })

  it('passes enabled memory through to the actual Agent image task', async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce({ text: '', toolCalls: [{ id: 'image-memory', name: 'create_image_tasks', arguments: JSON.stringify({ prompts: [{ title: '雨夜人像', prompt: '雨夜近景' }] }) }] })
      .mockResolvedValueOnce({ text: '已提交', toolCalls: [] })
    const enqueue = vi.fn().mockResolvedValue(task('image-memory'))
    const runner = new AgentRunner({ generate, search: vi.fn(), readFile: vi.fn(), runSkill: vi.fn(), image: { ...imageApi(async () => task('unused')), enqueue } })
    await runner.run({ modelProfileId: 'text', imageModelProfileId: 'image', prompt: '生成一张图', requireConfirmation: false, memoryContext: '人物外观：银发短发' })
    expect(enqueue.mock.calls[0][0].request.prompt).toContain('人物外观：银发短发')
  })

  it('uses the composer image count only when the user did not state another count', async () => {
    const generate = vi.fn().mockResolvedValue({ text: '收到', toolCalls: [] })
    const runner = new AgentRunner({ generate, search: vi.fn(), readFile: vi.fn(), runSkill: vi.fn(), image: imageApi(async () => task('unused')) })

    await runner.run({ modelProfileId: 'text', prompt: '先生成看看效果', imageCount: 4 })
    expect(generate.mock.calls[0][0].request.system).toContain('界面设置要求生成 4 张图片')

    generate.mockClear()
    await runner.run({ modelProfileId: 'text', prompt: '先生成一张图片看看效果', imageCount: 4 })
    expect(generate.mock.calls[0][0].request.system).toContain('用户明确要求生成 1 张图片')
    expect(generate.mock.calls[0][0].request.system).not.toContain('界面设置要求生成 4 张图片')
  })

  it('defaults a previous-image edit to one task instead of inheriting the composer batch count', async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce({ text: '我会只修改上一张图片的背景。', toolCalls: [{ id: 'edit-background', name: 'create_image_tasks', arguments: JSON.stringify({ prompts: [{ title: '三视图白底修改', prompt: '保持角色和三视图布局，只把背景改成纯白色' }], usePreviousImage: true }) }] })
      .mockResolvedValueOnce({ text: '已提交一张背景修改图', toolCalls: [] })
    const enqueue = vi.fn().mockResolvedValue(task('edited-background'))
    const runner = new AgentRunner({ generate, search: vi.fn(), readFile: vi.fn(), runSkill: vi.fn(), image: { ...imageApi(async () => task('unused')), enqueue } })

    const result = await runner.run({
      modelProfileId: 'text',
      imageModelProfileId: 'image',
      prompt: '背景使用白色',
      imageCount: 4,
      requireConfirmation: false,
      previousImageReferences: [{ type: 'file', path: 'outputs/previous.png' }],
    })

    expect(result.imageTasks).toHaveLength(1)
    expect(enqueue).toHaveBeenCalledOnce()
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
      maxRetries: 2,
      request: expect.objectContaining({ references: [{ type: 'file', path: 'outputs/previous.png' }] }),
    }))
    expect(generate.mock.calls[0][0].request.system).toContain('修改上一张且用户未明确数量时，只创建 1 个图片任务')
  })

  it('uses the previous generated image only when the Agent marks a follow-up as an edit', async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce({ text: '', toolCalls: [{ id: 'edit-task', name: 'create_image_tasks', arguments: JSON.stringify({ prompts: [{ title: '蓝色外套修改', prompt: '保持构图，把外套改成蓝色' }], usePreviousImage: true }) }] })
      .mockResolvedValueOnce({ text: '修改任务已提交', toolCalls: [] })
    const enqueue = vi.fn().mockResolvedValue(task('edit-task'))
    const runner = new AgentRunner({ generate, search: vi.fn(), readFile: vi.fn(), runSkill: vi.fn(), image: { ...imageApi(async () => task('unused')), enqueue } })

    await runner.run({
      modelProfileId: 'text',
      imageModelProfileId: 'image',
      prompt: '这张不满意，把外套改成蓝色',
      requireConfirmation: false,
      previousImageReferences: [{ type: 'file', path: 'outputs/previous.png', filename: 'previous.png', mimeType: 'image/png' }],
    })

    expect(generate.mock.calls[0][0].request.system).toContain('上一张生成结果')
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ request: expect.objectContaining({
      references: [{ type: 'file', path: 'outputs/previous.png', filename: 'previous.png', mimeType: 'image/png' }],
    }) }))
  })

  it('validates the combined current and previous references before creating image tasks', async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce({ text: '', toolCalls: [{ id: 'edit-task', name: 'create_image_tasks', arguments: JSON.stringify({ prompts: [{ title: '上一张修改', prompt: '按上一张修改' }], usePreviousImage: true }) }] })
      .mockResolvedValueOnce({ text: '当前模型不支持两张参考图', toolCalls: [] })
    const enqueue = vi.fn().mockResolvedValue(task('edit-task'))
    const runner = new AgentRunner({
      generate,
      search: vi.fn(),
      readFile: vi.fn(),
      runSkill: vi.fn(),
      image: { ...imageApi(async () => task('unused')), enqueue },
      getImageModelCapabilities: () => ['reference-image'],
    })

    const result = await runner.run({
      modelProfileId: 'text',
      imageModelProfileId: 'image',
      prompt: '把外套改成蓝色',
      requireConfirmation: false,
      references: [{ type: 'file', path: 'assets/current.png' }],
      previousImageReferences: [{ type: 'file', path: 'outputs/previous.png' }],
    })

    expect(enqueue).not.toHaveBeenCalled()
    expect(result.steps.some((item) => item.error?.includes('多参考图能力'))).toBe(true)
  })

  it('rejects an automatic image plan whose count conflicts with the user request', async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce({ text: '', toolCalls: [{ id: 'wrong-count', name: 'create_image_tasks', arguments: JSON.stringify({ mode: 'smart', prompts: [1, 2, 3, 4].map((index) => ({ title: `镜头 ${index}`, prompt: `镜头 ${index}` })) }) }] })
      .mockResolvedValueOnce({ text: '', toolCalls: [{ id: 'correct-count', name: 'create_image_tasks', arguments: JSON.stringify({ mode: 'smart', prompts: [{ title: '镜头 A', prompt: '镜头 A' }, { title: '镜头 B', prompt: '镜头 B' }] }) }] })
      .mockResolvedValueOnce({ text: '已按要求创建两个任务', toolCalls: [] })
    const prompts: string[] = []
    const runner = new AgentRunner({ generate, search: vi.fn(), readFile: vi.fn(), runSkill: vi.fn(), image: imageApi(async (prompt) => { prompts.push(prompt); return task(`count-${prompts.length}`) }) })
    const result = await runner.run({ modelProfileId: 'text', imageModelProfileId: 'image', prompt: '生成两张图片', requireConfirmation: false })
    expect(result.status).toBe('completed')
    expect(prompts).toEqual(['镜头 A', '镜头 B'])
    expect(generate.mock.calls[0][0].request.system).toContain('严格包含 2 个 prompts')
  })

  it('cancels an in-flight model run and returns a cancelled trace', async () => {
    let release: (() => void) | undefined
    const generate = vi.fn(() => new Promise<never>((_resolve, reject) => {
      release = () => reject(Object.assign(new Error('aborted'), { code: 'cancelled' }))
    }))
    const runner = new AgentRunner({
      generate,
      search: vi.fn(),
      readFile: vi.fn(),
      runSkill: vi.fn(),
      image: imageApi(async () => task('unused')),
    })
    const running = runner.run({ runId: 'cancel-me', modelProfileId: 'text', prompt: '取消这个任务' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const cancelled = await runner.cancel('cancel-me')
    release?.()
    await running
    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.steps.at(-1)).toMatchObject({ name: '文本模型', status: 'cancelled' })
  })

  it('cancels when the project changes during a model request', async () => {
    let root = '/tmp/project-a'
    const runner = new AgentRunner({
      generate: async () => { root = '/tmp/project-b'; return { text: '不应继续', toolCalls: [] } },
      search: vi.fn(),
      readFile: vi.fn(),
      runSkill: vi.fn(),
      image: imageApi(async () => task('unused')),
      getProjectRoot: () => root,
    })
    const result = await runner.run({ runId: 'project-switch', modelProfileId: 'text', prompt: '项目切换' })
    expect(result.status).toBe('cancelled')
  })

  it('flushes pending Agent snapshots before restoring the next project', async () => {
    let root = '/tmp/project-a'
    const releases: Array<() => void> = []
    const persistence = {
      load: vi.fn(async () => []),
      save: vi.fn(() => new Promise<void>((resolve) => { releases.push(resolve) })),
    }
    const runner = new AgentRunner({
      generate: vi.fn().mockResolvedValue({ text: '已完成', toolCalls: [] }),
      search: vi.fn(),
      readFile: vi.fn(),
      runSkill: vi.fn(),
      image: imageApi(async () => task('unused')),
      getProjectRoot: () => root,
      persistence,
    })
    await runner.run({ runId: 'persist-before-switch', modelProfileId: 'text', prompt: '保存这轮' })
    await vi.waitFor(() => expect(persistence.save).toHaveBeenCalled())

    root = '/tmp/project-b'
    const switching = runner.switchProject(root)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(persistence.load).toHaveBeenCalledExactlyOnceWith('/tmp/project-a')

    releases.shift()?.()
    await vi.waitFor(() => expect(persistence.save).toHaveBeenCalledTimes(2))
    expect(persistence.load).toHaveBeenCalledExactlyOnceWith('/tmp/project-a')

    releases.shift()?.()
    await switching

    expect(persistence.load).toHaveBeenLastCalledWith('/tmp/project-b')
  })
})
