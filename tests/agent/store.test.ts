import { describe, expect, it } from 'vitest'
import { createNodeSqliteDatabase } from '../../src/main/projects/database'
import { initializeProjectDatabase } from '../../src/main/projects/database'
import { ProjectAgentStore } from '../../src/main/agent/store'
import type { AgentSessionSnapshot } from '../../src/main/agent/runner'

function snapshot(projectRoot: string): AgentSessionSnapshot {
  const now = new Date().toISOString()
  return {
    id: 'run-1',
    input: { runId: 'run-1', modelProfileId: 'text', prompt: '生成图片' },
    messages: [{ role: 'user', content: '生成图片' }],
    steps: [{ id: 'step-1', kind: 'model', name: '文本模型', status: 'cancelled', startedAt: now, finishedAt: now }],
    text: '',
    imageTasks: [],
    documents: [],
    confirmed: false,
    stepCount: 1,
    cancelled: true,
    projectRoot,
    status: 'cancelled',
    updatedAt: now,
  }
}

describe('project agent store', () => {
  it('persists and restores agent snapshots within the owning project', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeProjectDatabase(database)
    const root = '/tmp/latent-agent-project'
    const other = '/tmp/latent-agent-other'
    const databases = new Map([[root, database]])
    const store = new ProjectAgentStore((projectRoot) => databases.get(projectRoot))
    const value = snapshot(root)
    await store.save(value)
    await expect(store.load(root)).resolves.toEqual([value])
    await expect(store.load(other)).resolves.toEqual([])
    database.close?.()
  })
})
