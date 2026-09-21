import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { TaskStore } from '../../src/main/tasks/store'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

async function root(): Promise<string> { const value = await mkdtemp(join(tmpdir(), 'latent-tasks-')); roots.push(value); return value }

describe('TaskStore', () => {
  it('persists task records and supports lifecycle actions', async () => {
    const project = await root(); const store = new TaskStore(project, { now: () => '2026-01-01T00:00:00.000Z' })
    const events: string[] = []; store.onEvent((event) => events.push(event.type))
    const task = await store.create({ id: 't1', title: '生成镜头', kind: 'image', payload: { prompt: '雨夜' } })
    expect(task).toMatchObject({ id: 't1', status: 'pending', progress: 0, attempts: 0 })
    expect(await store.cancel('t1')).toBe(true)
    expect(await store.retry('t1')).toBe(true)
    await store.pause(); expect((await store.get('t1'))?.status).toBe('paused')
    await store.resume(); expect((await store.get('t1'))?.status).toBe('pending')
    expect(events).toEqual(['created', 'cancelled', 'retrying', 'paused', 'pending'])
    expect(JSON.parse(await readFile(join(project, '.latent-studio/tasks.json'), 'utf8')).tasks).toHaveLength(1)
  })

  it('keeps newly created task titles concise without changing task details', async () => {
    const project = await root()
    const store = new TaskStore(project)
    const prompt = '请为我生成一张雨夜街头的电影感人像海报并保留霓虹灯反射与浅景深效果'

    const task = await store.create({ title: prompt, payload: { prompt } })

    expect(Array.from(task.title).length).toBeLessThanOrEqual(24)
    expect(task.title).toBe('请为我生成一张雨夜街头的电影感人像海报并保留霓…')
    expect(task.payload?.prompt).toBe(prompt)
  })

  it('restores snapshots and converts interrupted running work to paused', async () => {
    const project = await root(); const first = new TaskStore(project)
    await first.create({ id: 't1', title: '运行中任务' })
    await first.pause(); await first.resume()
    const path = join(project, '.latent-studio/tasks.json')
    const snapshot = JSON.parse(await readFile(path, 'utf8')); snapshot.tasks[0].status = 'running'
    const { writeFile } = await import('node:fs/promises'); await writeFile(path, JSON.stringify(snapshot), 'utf8')
    const restored = new TaskStore(project); expect(await restored.get('t1')).toMatchObject({ status: 'paused' })
  })

  it('archives, restores and removes terminal tasks without exposing archived work in the active list', async () => {
    const project = await root()
    const store = new TaskStore(project, { now: () => '2026-09-14T08:00:00.000Z' })
    await store.create({ id: 'archivable', title: '可归档任务' })
    await store.cancel('archivable')

    expect(await store.archive('archivable')).toBe(true)
    expect(await store.retry('archivable')).toBe(false)
    expect(await store.list()).toEqual([])
    expect(await store.list({ archived: true })).toEqual([
      expect.objectContaining({ id: 'archivable', archivedAt: '2026-09-14T08:00:00.000Z' }),
    ])

    expect(await store.restore('archivable')).toBe(true)
    expect(await store.list()).toEqual([expect.objectContaining({ id: 'archivable', archivedAt: undefined })])
    expect(await store.remove('archivable')).toBe(true)
    expect(await store.get('archivable')).toBeUndefined()
  })

  it('does not archive or remove active work', async () => {
    const project = await root()
    const store = new TaskStore(project)
    await store.create({ id: 'active', title: '活动任务' })
    expect(await store.archive('active')).toBe(false)
    expect(await store.remove('active')).toBe(false)
    expect(await store.get('active')).toBeDefined()
  })

  it('renames tasks, persists changes, and emits renamed event', async () => {
    const project = await root()
    const store = new TaskStore(project)
    const events: string[] = []
    store.onEvent((event) => events.push(`${event.type}:${event.task.title}`))
    await store.create({ id: 'r1', title: '原始标题' })
    const renamed = await store.rename('r1', '重命名后的标题')
    expect(renamed?.title).toBe('重命名后的标题')
    expect((await store.get('r1'))?.title).toBe('重命名后的标题')
    expect(events).toContain('renamed:重命名后的标题')

    const reloaded = new TaskStore(project)
    expect((await reloaded.get('r1'))?.title).toBe('重命名后的标题')
  })
})
