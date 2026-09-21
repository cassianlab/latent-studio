import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, string>()
const mockStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, val: string) => { store.set(key, String(val)) },
  removeItem: (key: string) => { store.delete(key) },
  clear: () => { store.clear() },
}

Object.defineProperty(globalThis, 'localStorage', {
  value: mockStorage,
  writable: true,
  configurable: true,
})

if (typeof globalThis.window === 'undefined') {
  Object.defineProperty(globalThis, 'window', {
    value: {
      dispatchEvent: () => true,
      addEventListener: () => {},
      removeEventListener: () => {},
    },
    writable: true,
    configurable: true,
  })
}

import {
  createSession,
  createDefaultSession,
  clearSessionCache,
  deleteSession,
  flushSessionWrites,
  flushAllSessionWrites,
  getSessionLoadIssues,
  getSessionPersistenceError,
  hydrateSessions,
  loadSessions,
  renameSession,
  retrySessionWrites,
  switchSession,
  updateActiveSession,
} from '../../src/renderer/conversation/session-store'
import { estimateConversationUsage } from '../../src/renderer/conversation/context-window'

describe('session-store', () => {
  const projectId = 'test-project-1'

  beforeEach(() => {
    localStorage.clear()
    clearSessionCache()
    delete (window as unknown as { latentStudio?: unknown }).latentStudio
  })

  it('loads initial default session when storage is empty', async () => {
    const { sessions, activeSession } = await hydrateSessions(projectId)
    expect(sessions).toHaveLength(1)
    expect(activeSession.id).toBe(sessions[0].id)
    expect(activeSession.title).toBe('雨夜重逢视觉探索')
  })

  it('creates a new session and switches active to it', async () => {
    await hydrateSessions(projectId)
    const created = createSession(projectId, 'text', '文本创作测试')
    await flushSessionWrites(projectId)
    expect(created.mode).toBe('text')
    expect(created.title).toBe('文本创作测试')

    const { sessions, activeSession } = loadSessions(projectId)
    expect(sessions).toHaveLength(2)
    expect(activeSession.id).toBe(created.id)
    expect(created.agentWriteEnabled).toBe(true)
  })

  it('persists the Agent write toggle for the whole conversation', async () => {
    const persisted = new Map<string, ReturnType<typeof createDefaultSession>>()
    let activeId: string | undefined
    const conversations = {
      load: async () => ({ sessions: [...persisted.values()], ...(activeId ? { activeId } : {}) }),
      save: async ({ session }: { session: ReturnType<typeof createDefaultSession> }) => { persisted.set(session.id, structuredClone(session)) },
      remove: async ({ sessionId }: { sessionId: string }) => { persisted.delete(sessionId) },
      setActive: async ({ sessionId }: { sessionId: string }) => { activeId = sessionId },
    }
    ;(window as unknown as { latentStudio?: { conversations: typeof conversations } }).latentStudio = { conversations }

    const initial = await hydrateSessions(projectId)
    expect(initial.activeSession.agentWriteEnabled).toBe(true)
    updateActiveSession(projectId, { agentWriteEnabled: false })
    await flushSessionWrites(projectId)

    clearSessionCache(projectId)
    const reloaded = await hydrateSessions(projectId)
    expect(reloaded.activeSession.agentWriteEnabled).toBe(false)
  })

  it('switches to an existing session', async () => {
    await hydrateSessions(projectId)
    const s1 = createSession(projectId, 'image', '会话1')
    createSession(projectId, 'text', '会话2')

    const switched = switchSession(projectId, s1.id)
    expect(switched.id).toBe(s1.id)

    const { activeSession } = loadSessions(projectId)
    expect(activeSession.id).toBe(s1.id)
  })

  it('keeps context usage isolated between conversations', async () => {
    await hydrateSessions(projectId)
    const first = createSession(projectId, 'text', '会话1')
    updateActiveSession(projectId, {
      messages: [
        { id: 'user-1', role: 'user', text: '第一条对话的历史要求', createdAt: 1 },
        { id: 'assistant-1', role: 'assistant', text: '第一条对话的历史回答', usage: { contextTokens: 8_000 }, createdAt: 2 },
      ],
    })
    const second = createSession(projectId, 'text', '会话2')

    expect(estimateConversationUsage(loadSessions(projectId).activeSession.messages).usedTokens).toBe(0)

    switchSession(projectId, first.id)
    expect(estimateConversationUsage(loadSessions(projectId).activeSession.messages).usedTokens).toBe(8_000)

    switchSession(projectId, second.id)
    expect(estimateConversationUsage(loadSessions(projectId).activeSession.messages).usedTokens).toBe(0)
  })

  it('updates the active session with new messages or results', async () => {
    await hydrateSessions(projectId)
    const updated = updateActiveSession(projectId, {
      messages: [{ id: 'm1', role: 'user', text: '你好', createdAt: Date.now() }],
    })
    expect(updated.messages).toHaveLength(1)
    expect(updated.messages[0].text).toBe('你好')

    const reloaded = loadSessions(projectId)
    expect(reloaded.activeSession.messages).toHaveLength(1)
  })

  it('migrates legacy image and agent results into one deduplicated shared list', async () => {
    const imageResult = { id: 'task-image', title: '图片结果', status: 'completed' }
    const agentResult = { id: 'task-agent', title: 'Agent 结果', status: 'running' }
    localStorage.setItem(`latent-studio:sessions:${projectId}`, JSON.stringify([{
      ...createDefaultSession('image', '旧会话'),
      results: [imageResult],
      imageResults: [imageResult],
      agentResults: [agentResult],
    }]))

    const { activeSession } = await hydrateSessions(projectId)
    expect(activeSession.results).toEqual([imageResult, agentResult])
    expect(activeSession).not.toHaveProperty('imageResults')
    expect(activeSession).not.toHaveProperty('agentResults')
  })

  it('restores shared Skill snapshots and context compaction state', async () => {
    const saved = createDefaultSession('agent', '共享上下文')
    const skillContexts = [{ id: 'skill-1', name: 'shot-planner', displayName: '分镜规划', contentHash: 'hash-1', instructions: '# 分镜规划', activatedAtMessageId: 'message-1' }]
    const compaction = { summary: '用户正在制作雨夜分镜。', throughMessageId: 'message-8', updatedAt: 42 }
    localStorage.setItem(`latent-studio:sessions:${projectId}`, JSON.stringify([{ ...saved, skillContexts, compaction }]))

    const { activeSession } = await hydrateSessions(projectId)

    expect(activeSession.skillContexts).toEqual(skillContexts)
    expect(activeSession.compaction).toEqual(compaction)
  })

  it('renames a session', async () => {
    await hydrateSessions(projectId)
    const created = createSession(projectId, 'image', '原标题')
    renameSession(projectId, created.id, '修改后的标题')

    const { sessions } = loadSessions(projectId)
    const found = sessions.find((s) => s.id === created.id)
    expect(found?.title).toBe('修改后的标题')
  })

  it('deletes a session and safely falls back to remaining or creates fresh', async () => {
    await hydrateSessions(projectId)
    const s1 = createSession(projectId, 'image', '会话1')
    const s2 = createSession(projectId, 'text', '会话2')

    const nextActive = deleteSession(projectId, s2.id)
    const { sessions } = loadSessions(projectId)
    expect(sessions.some((s) => s.id === s2.id)).toBe(false)
    expect(nextActive.id).toBe(s1.id)
  })

  it('surfaces persistence failures and clears them after a successful retry', async () => {
    const session = createDefaultSession('text', '持久化测试')
    let shouldFail = true
    const conversations = {
      load: async () => ({ sessions: [session], activeId: session.id }),
      save: async () => { if (shouldFail) throw new Error('disk full') },
      remove: async () => undefined,
      setActive: async () => undefined,
    }
    ;(window as unknown as { latentStudio?: { conversations: typeof conversations } }).latentStudio = { conversations }
    await hydrateSessions(projectId)

    updateActiveSession(projectId, { title: '尚未保存' })
    await expect(flushSessionWrites(projectId)).rejects.toThrow('disk full')
    expect(getSessionPersistenceError(projectId)).toContain('disk full')

    shouldFail = false
    await retrySessionWrites(projectId)
    expect(getSessionPersistenceError(projectId)).toBeUndefined()
  })

  it('waits for writes appended while a full session flush is already running', async () => {
    const session = createDefaultSession('text', '退出保存测试')
    const releases: Array<() => void> = []
    const conversations = {
      load: async () => ({ sessions: [session], activeId: session.id }),
      save: vi.fn(() => new Promise<void>((resolve) => { releases.push(resolve) })),
      remove: async () => undefined,
      setActive: async () => undefined,
    }
    ;(window as unknown as { latentStudio?: { conversations: typeof conversations } }).latentStudio = { conversations }
    await hydrateSessions(projectId)

    updateActiveSession(projectId, { title: '第一次更新' })
    const flushing = flushAllSessionWrites()
    await vi.waitFor(() => expect(conversations.save).toHaveBeenCalledTimes(1))

    updateActiveSession(projectId, { title: '第二次更新' })
    releases.shift()?.()
    await vi.waitFor(() => expect(conversations.save).toHaveBeenCalledTimes(2))

    let completed = false
    void flushing.then(() => { completed = true })
    await Promise.resolve()
    expect(completed).toBe(false)

    releases.shift()?.()
    await expect(flushing).resolves.toBeUndefined()
  })

  it('retries a failed session deletion so removed conversations cannot return after restart', async () => {
    const first = createDefaultSession('text', '保留')
    const removed = createDefaultSession('agent', '删除')
    let shouldFail = true
    const removeCalls: string[] = []
    const conversations = {
      load: async () => ({ sessions: [first, removed], activeId: removed.id }),
      save: async () => undefined,
      remove: async ({ sessionId }: { sessionId: string }) => {
        removeCalls.push(sessionId)
        if (shouldFail) throw new Error('database busy')
      },
      setActive: async () => undefined,
    }
    ;(window as unknown as { latentStudio?: { conversations: typeof conversations } }).latentStudio = { conversations }
    await hydrateSessions(projectId)

    deleteSession(projectId, removed.id)
    await expect(flushSessionWrites(projectId)).rejects.toThrow('database busy')

    shouldFail = false
    await retrySessionWrites(projectId)
    expect(removeCalls).toEqual([removed.id, removed.id])
    expect(getSessionPersistenceError(projectId)).toBeUndefined()
  })

  it('keeps recoverable load diagnostics visible without replacing valid sessions', async () => {
    const session = createDefaultSession('text', '仍然可用')
    const conversations = {
      load: async () => ({ sessions: [session], activeId: session.id, issues: [{ code: 'invalid-json' as const }] }),
      save: async () => undefined,
      remove: async () => undefined,
      setActive: async () => undefined,
    }
    ;(window as unknown as { latentStudio?: { conversations: typeof conversations } }).latentStudio = { conversations }

    const hydrated = await hydrateSessions(projectId)

    expect(hydrated.activeSession.id).toBe(session.id)
    expect(getSessionLoadIssues(projectId)).toEqual([{ code: 'invalid-json' }])
  })
})
