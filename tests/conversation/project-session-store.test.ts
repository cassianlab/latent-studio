import { describe, expect, it } from 'vitest'
import { ProjectConversationStore } from '../../src/main/conversation/store'
import { createNodeSqliteDatabase, initializeProjectDatabase } from '../../src/main/projects/database'
import { createDefaultSession } from '../../src/renderer/conversation/session-store'

describe('project conversation store', () => {
  it('persists the complete shared session context in the project database', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeProjectDatabase(database)
    const store = new ProjectConversationStore(database)
    const session = {
      ...createDefaultSession('agent', '持续分镜对话'),
      messages: [{
        id: 'message-1', role: 'assistant' as const, text: '已分析', toolContext: '【工具结果】角色穿红色风衣', createdAt: 1,
        artifacts: [
          { type: 'document' as const, operation: 'created' as const, relativePath: 'documents/brief.md', name: 'brief.md', extension: '.md' },
          { type: 'prompt' as const, operation: 'updated' as const, id: 'prompt-1', scope: 'global' as const, name: '雨夜人像' },
        ],
      }],
      skillContexts: [{ id: 'skill-1', name: 'shot', displayName: '分镜', contentHash: 'hash', instructions: '# 分镜', activatedAtMessageId: 'message-1' }],
      compaction: {
        summary: '较早对话摘要',
        throughMessageId: 'message-1',
        updatedAt: 2,
        compressionMode: 'official' as const,
        coveredMessageCount: 1,
        coveredFromAt: 1,
        coveredThroughAt: 1,
        keyItemCount: 1,
        officialItems: [{ type: 'compaction', encrypted_content: 'opaque' }],
      },
    }

    await store.save(session)
    await store.setActive(session.id)

    await expect(store.load()).resolves.toEqual({ sessions: [session], activeId: session.id })
    database.close?.()
  })

  it('persists compacting state and prompt search cards', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeProjectDatabase(database)
    const store = new ProjectConversationStore(database)
    const session = {
      ...createDefaultSession('agent', '检索提示词'),
      messages: [{ id: 'message-1', role: 'assistant' as const, text: '匹配结果', pendingStage: 'compacting' as const, promptResults: [{ id: 'p1', title: '风景', content: 'Landscape', category: '风景', type: 'prompt' as const, score: 0.8, reason: '相关', retrievalMode: 'lexical' as const }], createdAt: 1 }],
    }
    await store.save(session)
    await expect(store.load()).resolves.toEqual({ sessions: [session], activeId: undefined })
    database.close?.()
  })

  it('imports legacy sessions once without replacing later database state', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeProjectDatabase(database)
    const store = new ProjectConversationStore(database)
    const legacy = createDefaultSession('image', '旧版会话')

    await store.initialize([legacy], legacy.id)
    await store.remove(legacy.id)
    await store.initialize([createDefaultSession('text', '不应重新导入')])

    await expect(store.load()).resolves.toEqual({ sessions: [], activeId: undefined })
    database.close?.()
  })

  it('rejects malformed nested session data', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeProjectDatabase(database)
    const store = new ProjectConversationStore(database)
    const session = createDefaultSession('text', '无效会话')

    await expect(store.save({
      ...session,
      messages: [{ id: 'message-1', role: 'tool', text: 42, createdAt: 'today' }],
    } as never)).rejects.toThrow('会话数据无效')
    await expect(store.save({
      ...session,
      skillContexts: [{ id: 'skill-1', name: 'shot', displayName: '分镜', contentHash: 'hash', instructions: 42 }],
    } as never)).rejects.toThrow('会话数据无效')
    await expect(store.save({
      ...session,
      results: [{ id: 'result-1', title: '结果', status: 'completed', task: { id: 'task-1', request: { prompt: 42 } } }],
    } as never)).rejects.toThrow('会话数据无效')
    await expect(store.save({
      ...session,
      imagePlan: { mode: 'smart', invariants: ['主体一致'], variations: [{ id: 'v1', title: '远景', prompt: '雨夜', difference: 42 }] },
    } as never)).rejects.toThrow('会话数据无效')
    await expect(store.save({
      ...session,
      compaction: { summary: '摘要', throughMessageId: 'message-1', updatedAt: 2, compressionMode: 'official', officialItems: [{ encrypted_content: () => 'invalid' }] },
    } as never)).rejects.toThrow('会话数据无效')
    database.close?.()
  })

  it('persists a session larger than the legacy single-row boundary in bounded chunks', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeProjectDatabase(database)
    const store = new ProjectConversationStore(database)
    const session = createDefaultSession('text', '超大会话')

    const large = {
      ...session,
      messages: [{ id: 'message-1', role: 'user', text: 'x'.repeat(9 * 1024 * 1024), createdAt: 1 }],
    }

    await expect(store.save(large)).resolves.toBeUndefined()
    await expect(store.load()).resolves.toEqual({ sessions: [large], activeId: undefined })
    const chunks = database.all?.<{ byte_length: number }>('SELECT byte_length FROM workspace_session_chunks') ?? []
    expect(chunks.length).toBeGreaterThan(1)
    expect(Math.max(...chunks.map((chunk) => chunk.byte_length))).toBeLessThanOrEqual(512 * 1024)
    database.close?.()
  })

  it('reports corrupt or oversized rows without deleting them or hiding valid sessions', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeProjectDatabase(database)
    const store = new ProjectConversationStore(database)
    const valid = createDefaultSession('agent', '可恢复会话')
    await store.save(valid)
    database.run?.('INSERT INTO workspace_sessions (id, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?)', 'bad-json', '{', 1, 1)
    database.run?.('INSERT INTO workspace_sessions (id, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?)', 'bad-schema', JSON.stringify({ id: 'bad-schema' }), 1, 1)
    database.run?.('INSERT INTO workspace_sessions (id, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?)', 'too-large', 'x'.repeat(8 * 1024 * 1024 + 1), 1, 1)

    const loaded = await store.load()

    expect(loaded.sessions).toEqual([valid])
    expect(loaded.issues).toEqual(expect.arrayContaining([
      { code: 'invalid-json' },
      { code: 'invalid-session' },
      { code: 'payload-too-large' },
    ]))
    expect(loaded.issues).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionId: expect.any(String) }),
    ]))
    expect(database.all?.<{ id: string }>('SELECT id FROM workspace_sessions')).toHaveLength(3)
    expect(database.all?.<{ id: string }>('SELECT id FROM workspace_session_records')).toEqual([{ id: valid.id }])
    database.close?.()
  })
})
