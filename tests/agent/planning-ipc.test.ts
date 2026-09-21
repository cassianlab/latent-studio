import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SettingsStore } from '../../src/main/settings'
import type { ImageApi } from '../../src/shared/contracts/images'
import { createNodeSqliteDatabase, initializeGlobalDatabase } from '../../src/main/config'
import { GlobalMemoryStore } from '../../src/main/library/global'
import { ProjectMemoryStore } from '../../src/main/library/project'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  list: vi.fn(),
  instructions: vi.fn(),
  generate: vi.fn(),
  startStream: vi.fn(),
  stopStream: vi.fn(),
}))
vi.mock('electron', () => ({ ipcMain: {
  handle: (channel: string, handler: (...args: unknown[]) => unknown) => mocks.handlers.set(channel, handler),
  removeHandler: (channel: string) => mocks.handlers.delete(channel),
} }))
vi.mock('../../src/main/models/service', () => ({ createTextModelService: () => ({ generate: mocks.generate, startStream: mocks.startStream, stopStream: mocks.stopStream, dispose: () => {} }) }))
vi.mock('../../src/main/skills/store', () => ({ SkillStore: class {
  list = mocks.list
  instructions = mocks.instructions
} }))
import { registerAgentIpc } from '../../src/main/agent/ipc'

let unregister: (() => void) | undefined
afterEach(() => { unregister?.(); vi.clearAllMocks() })

describe('Agent image planning Skill context', () => {
  it('always injects global memory and gates project memory for text and image planning', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeGlobalDatabase(database)
    const projectRoot = await mkdtemp(join(tmpdir(), 'latent-memory-injection-'))
    const savedGlobalMemory = await new GlobalMemoryStore(database).save({ scope: 'global', title: '全局光线', content: '始终使用暖色光', active: true })
    const savedProjectMemory = await new ProjectMemoryStore().save({ scope: 'project', projectRoot, title: '项目角色', content: '主角保持银色短发', active: true })
    mocks.list.mockResolvedValue([])
    mocks.startStream.mockImplementation(async (input, emit) => {
      const result = input.request.tools
        ? { text: '回答', toolCalls: [] }
        : { text: JSON.stringify({ invariants: ['人物一致'], variations: [{ title: '正面镜头', prompt: '正面', difference: '正面' }, { title: '侧面镜头', prompt: '侧面', difference: '侧面' }], notes: [] }), toolCalls: [] }
      emit({ requestId: input.requestId, result })
      return { requestId: input.requestId }
    })
    unregister = registerAgentIpc({ store: {} as SettingsStore, database, userDataPath: '/tmp/latent-memory-injection-test', getProjectRoot: () => projectRoot })
    try {
      const run = (projectContext: boolean) => mocks.handlers.get('agent:run')?.({ sender: { send: vi.fn() } }, { mode: 'text', modelProfileId: 'text', prompt: '回答', projectContext })
      await run(false)
      await run(true)
      expect(mocks.startStream.mock.calls[0][0].request.system).toContain('始终使用暖色光')
      expect(mocks.startStream.mock.calls[0][0].request.system).not.toContain('主角保持银色短发')
      expect(mocks.startStream.mock.calls[1][0].request.system).toContain('始终使用暖色光')
      expect(mocks.startStream.mock.calls[1][0].request.system).toContain('主角保持银色短发')
      expect(mocks.startStream.mock.calls[1][0].request.system.match(/【已激活的长期记忆与创作规则设定】/g)).toHaveLength(1)
      await expect(new GlobalMemoryStore(database).get({ id: savedGlobalMemory.id, scope: 'global' })).resolves.toMatchObject({ lastUsedAt: expect.any(String) })
      await expect(new ProjectMemoryStore().get({ id: savedProjectMemory.id, scope: 'project', projectRoot })).resolves.toMatchObject({ lastUsedAt: expect.any(String) })

      const plan = (projectContext: boolean) => mocks.handlers.get('agent:plan-image')?.({}, { modelProfileId: 'text', prompt: '两张分镜', count: 2, mode: 'smart', projectContext })
      await plan(false)
      await plan(true)
      expect(mocks.startStream.mock.calls[2][0].request.system).toContain('始终使用暖色光')
      expect(mocks.startStream.mock.calls[2][0].request.system).not.toContain('主角保持银色短发')
      expect(mocks.startStream.mock.calls[3][0].request.system).toContain('始终使用暖色光')
      expect(mocks.startStream.mock.calls[3][0].request.system).toContain('主角保持银色短发')
    } finally {
      unregister?.()
      unregister = undefined
      database.close?.()
      await rm(projectRoot, { recursive: true, force: true })
    }
  })
  it('runs text and business Agent work when the image service is unavailable', async () => {
    mocks.list.mockResolvedValue([])
    mocks.startStream.mockImplementation(async (input, emit) => {
      expect(input.request.tools.map((tool: { name: string }) => tool.name)).not.toEqual(expect.arrayContaining(['create_image_tasks', 'control_image_tasks']))
      emit({ requestId: input.requestId, result: { text: '已完成文本任务', toolCalls: [] } })
      return { requestId: input.requestId }
    })
    unregister = registerAgentIpc({ store: {} as SettingsStore, userDataPath: '/tmp/phase15-text-only-agent', getProjectRoot: () => undefined })

    await expect(mocks.handlers.get('agent:run')?.({ sender: { send: vi.fn() } }, {
      runId: 'run-without-image-service',
      mode: 'agent',
      modelProfileId: 'text',
      prompt: '整理这个任务',
    })).resolves.toMatchObject({ status: 'completed', text: '已完成文本任务' })
  })

  it('loads only an explicitly selected Skill while planning images', async () => {
    const eligible = { id: 'allowed', name: 'shot-planner', displayName: '分镜规划', enabled: true, trusted: true, scope: 'project', projectAuthorized: true }
    mocks.list.mockResolvedValue([
      eligible,
      { ...eligible, id: 'disabled', enabled: false },
      { ...eligible, id: 'untrusted', trusted: false },
      { ...eligible, id: 'ungranted', projectAuthorized: false },
    ])
    mocks.instructions.mockImplementation(async (id: string) => `Skill instructions for ${id}`)
    const result = { text: JSON.stringify({ invariants: ['主体一致'], variations: [{ title: '远景', prompt: '雨夜远景', difference: '远景' }, { title: '近景', prompt: '雨夜近景', difference: '近景' }], notes: [] }), toolCalls: [] }
    mocks.startStream.mockImplementation(async (input, emit) => {
      emit({ requestId: input.requestId, result })
      return { requestId: input.requestId }
    })
    unregister = registerAgentIpc({ store: {} as SettingsStore, userDataPath: '/tmp/phase9-test', getProjectRoot: () => undefined })
    await mocks.handlers.get('agent:plan-image')?.({}, { modelProfileId: 'text', prompt: '生成两张分镜图片', count: 2, mode: 'smart', skillId: 'allowed' })
    expect(mocks.instructions).toHaveBeenCalledExactlyOnceWith('allowed')
    expect(mocks.startStream.mock.calls[0][0].request.system).toContain('Skill instructions for allowed')
    expect(mocks.startStream.mock.calls[0][0].request.system).toContain('4-16 个中文字符')
    expect(mocks.generate).not.toHaveBeenCalled()
  })

  it('offers every enabled, trusted and project-authorized Skill to the Agent without preloading instructions', async () => {
    const eligible = { id: 'custom-no-keywords', name: 'custom', displayName: '自定义 Skill', description: '处理自定义工作流', contentHash: 'custom-hash', enabled: true, trusted: true, scope: 'project', projectAuthorized: true }
    mocks.list.mockResolvedValue([
      eligible,
      { ...eligible, id: 'disabled', enabled: false },
      { ...eligible, id: 'untrusted', trusted: false },
      { ...eligible, id: 'ungranted', projectAuthorized: false },
    ])
    mocks.instructions.mockImplementation(async (id: string) => `Instructions for ${id}`)
    mocks.startStream
      .mockImplementationOnce(async (input, emit) => {
        expect(input.request.system).toContain('custom-no-keywords')
        expect(input.request.system).not.toContain('Instructions for custom-no-keywords')
        emit({ requestId: input.requestId, result: { text: '', toolCalls: [{ id: 'activate-custom', name: 'activate_skills', arguments: JSON.stringify({ skillIds: ['custom-no-keywords'], reason: '当前任务匹配自定义工作流' }) }] } })
        return { requestId: input.requestId }
      })
      .mockImplementationOnce(async (input, emit) => {
        expect(input.request.system).toContain('Instructions for custom-no-keywords')
        emit({ requestId: input.requestId, result: { text: '已完成', toolCalls: [] } })
        return { requestId: input.requestId }
      })
    const image: ImageApi = {
      enqueue: vi.fn(), list: vi.fn(), get: vi.fn(), cancel: vi.fn(), retry: vi.fn(), archive: vi.fn(), restore: vi.fn(), remove: vi.fn(), pause: vi.fn(), resume: vi.fn(), setConnectionConcurrency: vi.fn(), onTaskEvent: vi.fn(() => () => {}),
    }
    unregister = registerAgentIpc({ store: {} as SettingsStore, userDataPath: '/tmp/phase15-auto-skill-test', getProjectRoot: () => undefined, imageApi: image })

    const result = await mocks.handlers.get('agent:run')?.({ sender: { send: vi.fn() } }, {
      runId: 'run-auto-skill',
      mode: 'agent',
      modelProfileId: 'text',
      prompt: '处理这个任务',
    })

    expect(result).toMatchObject({ status: 'completed', text: '已完成' })
    expect(mocks.instructions).toHaveBeenCalledExactlyOnceWith('custom-no-keywords')
    expect(mocks.instructions).not.toHaveBeenCalledWith('disabled')
    expect(mocks.instructions).not.toHaveBeenCalledWith('untrusted')
    expect(mocks.instructions).not.toHaveBeenCalledWith('ungranted')
  })

  it('forwards Agent text deltas through the renderer-safe IPC event', async () => {
    mocks.list.mockResolvedValue([])
    mocks.startStream.mockImplementation(async (input, emit) => {
      emit({ requestId: input.requestId, event: { type: 'text_delta', text: '实时回答' } })
      emit({ requestId: input.requestId, result: { text: '实时回答', toolCalls: [] } })
      return { requestId: input.requestId }
    })
    const image: ImageApi = {
      enqueue: vi.fn(), list: vi.fn(), get: vi.fn(), cancel: vi.fn(), retry: vi.fn(), pause: vi.fn(), resume: vi.fn(), setConnectionConcurrency: vi.fn(), onTaskEvent: vi.fn(() => () => {}),
    }
    unregister = registerAgentIpc({ store: {} as SettingsStore, userDataPath: '/tmp/phase11-test', getProjectRoot: () => undefined, imageApi: image })
    const send = vi.fn()
    const result = await mocks.handlers.get('agent:run')?.({ sender: { send } }, { runId: 'run-stream', modelProfileId: 'text', prompt: '回答我' })
    expect(result).toMatchObject({ runId: 'run-stream', status: 'completed', text: '实时回答' })
    expect(send).toHaveBeenCalledWith('agent:text-stream-event', { runId: 'run-stream', event: { type: 'text_delta', text: '实时回答' } })
  })

  it('forwards uploaded attachments through the Agent IPC boundary', async () => {
    mocks.list.mockResolvedValue([])
    mocks.startStream.mockImplementation(async (input, emit) => {
      emit({ requestId: input.requestId, result: { text: '已读取附件', toolCalls: [] } })
      return { requestId: input.requestId }
    })
    const image: ImageApi = {
      enqueue: vi.fn(), list: vi.fn(), get: vi.fn(), cancel: vi.fn(), retry: vi.fn(), archive: vi.fn(), restore: vi.fn(), remove: vi.fn(), pause: vi.fn(), resume: vi.fn(), setConnectionConcurrency: vi.fn(), onTaskEvent: vi.fn(() => () => {}),
    }
    unregister = registerAgentIpc({ store: {} as SettingsStore, userDataPath: '/tmp/phase14-test', getProjectRoot: () => undefined, imageApi: image })
    await mocks.handlers.get('agent:run')?.({ sender: { send: vi.fn() } }, {
      runId: 'run-attachment',
      modelProfileId: 'text',
      prompt: '按附件执行',
      attachments: [{ summary: { relativePath: 'brief.md', fileName: 'brief.md', kind: 'markdown', mimeType: 'text/markdown', byteLength: 12 }, text: '# 人物设定' }],
    })
    expect(mocks.startStream.mock.calls[0][0].request.messages).toContainEqual(expect.objectContaining({ role: 'system', content: expect.stringContaining('# 人物设定') }))
  })

  it('loads only the explicitly selected Skill in text mode', async () => {
    mocks.list.mockResolvedValue([
      { id: 'selected', name: 'selected', displayName: '选定 Skill', contentHash: 'selected-hash', enabled: true, trusted: true, scope: 'global' },
      { id: 'automatic', name: 'automatic', displayName: '自动 Skill', contentHash: 'automatic-hash', enabled: true, trusted: true, scope: 'global', triggerKeywords: ['文案'] },
    ])
    mocks.instructions.mockImplementation(async (id: string) => `Instructions for ${id}`)
    mocks.startStream.mockImplementation(async (input, emit) => {
      emit({ requestId: input.requestId, result: { text: '已完成', toolCalls: [] } })
      return { requestId: input.requestId }
    })
    const image: ImageApi = {
      enqueue: vi.fn(), list: vi.fn(), get: vi.fn(), cancel: vi.fn(), retry: vi.fn(), archive: vi.fn(), restore: vi.fn(), remove: vi.fn(), pause: vi.fn(), resume: vi.fn(), setConnectionConcurrency: vi.fn(), onTaskEvent: vi.fn(() => () => {}),
    }
    unregister = registerAgentIpc({ store: {} as SettingsStore, userDataPath: '/tmp/phase15-text-skill-test', getProjectRoot: () => undefined, imageApi: image })

    await mocks.handlers.get('agent:run')?.({ sender: { send: vi.fn() } }, {
      runId: 'run-text-skill',
      mode: 'text',
      modelProfileId: 'text',
      prompt: '请修改文案',
      skillId: 'selected',
    })

    expect(mocks.instructions).toHaveBeenCalledExactlyOnceWith('selected')
  })

  it('rejects oversized conversation, Skill, attachment, and memory payloads at the main-process boundary', async () => {
    const image: ImageApi = {
      enqueue: vi.fn(), list: vi.fn(), get: vi.fn(), cancel: vi.fn(), retry: vi.fn(), archive: vi.fn(), restore: vi.fn(), remove: vi.fn(), pause: vi.fn(), resume: vi.fn(), setConnectionConcurrency: vi.fn(), onTaskEvent: vi.fn(() => () => {}),
    }
    unregister = registerAgentIpc({ store: {} as SettingsStore, userDataPath: '/tmp/phase15-ipc-limits', getProjectRoot: () => undefined, imageApi: image })
    const run = (input: Record<string, unknown>) => mocks.handlers.get('agent:run')?.({ sender: { send: vi.fn() } }, { modelProfileId: 'text', prompt: '检查边界', ...input })

    await expect(run({
      contextMessages: Array.from({ length: 513 }, () => ({ role: 'user', content: '历史消息' })),
    })).rejects.toThrow('历史消息数量')

    await expect(run({
      skillContexts: [{ id: 'large', name: 'large', displayName: '过大 Skill', contentHash: 'hash', instructions: 'x'.repeat(256 * 1024 + 1) }],
    })).rejects.toThrow('Skill 指令过大')

    const attachment = { summary: { relativePath: 'brief.md', fileName: 'brief.md', kind: 'markdown', mimeType: 'text/markdown', byteLength: 1 }, text: '附件' }
    await expect(run({ attachments: Array.from({ length: 9 }, () => attachment) })).rejects.toThrow('单轮最多上传 8 个附件')

    await expect(run({ attachments: [{
      ...attachment,
      summary: { ...attachment.summary, byteLength: 50 * 1024 * 1024 + 1 },
    }] })).rejects.toThrow('brief.md 超过 50 MB')

    await expect(run({ memoryContext: 'x'.repeat(64 * 1024 + 1) })).rejects.toThrow('记忆上下文过大')
    await expect(run({ memoryRefs: Array.from({ length: 26 }, (_, index) => ({ id: `memory-${index}`, version: 1, scope: 'global' })) })).rejects.toThrow('记忆引用格式无效')
    await expect(run({ memoryRefs: [{ id: 'memory-1', version: 0, scope: 'global' }] })).rejects.toThrow('记忆引用格式无效')
  })
})
