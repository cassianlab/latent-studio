import { describe, expect, it, afterEach, vi } from 'vitest'
import type { WebContents } from 'electron'
import type { ImageApi } from '../../src/shared/contracts/images'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const electronMock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  return { handlers, electron: { ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler), removeHandler: (channel: string) => handlers.delete(channel) } } }
})
vi.mock('electron', () => electronMock.electron)
const { registerTasksIpc } = await import('../../src/main/tasks/ipc')

function handler(channel: string): (...args: unknown[]) => unknown { const value = electronMock.handlers.get(channel); if (!value) throw new Error(`Missing handler: ${channel}`); return value }
const roots: string[] = []
afterEach(async () => { electronMock.handlers.clear(); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

describe('tasks IPC', () => {
  it('exposes typed lifecycle channels and project-scoped persistence', async () => {
    const project = await mkdtemp(join(tmpdir(), 'latent-task-ipc-')); roots.push(project)
    const sender = { id: 1, isDestroyed: () => false, send: vi.fn() } as unknown as WebContents
    const unregister = registerTasksIpc({ getProjectRoot: () => project })
    const created = await handler('tasks:create')({ sender }, { id: 'ipc-1', title: '任务' }) as { id: string; status: string }
    expect(created).toMatchObject({ id: 'ipc-1', status: 'pending' })
    expect(sender.send).toHaveBeenCalledWith('tasks:event', expect.objectContaining({ type: 'created', task: expect.objectContaining({ id: 'ipc-1' }) }))
    const renamed = await handler('tasks:rename')({ sender }, { taskId: 'ipc-1', title: '新任务名称' }) as { id: string; title: string }
    expect(renamed).toMatchObject({ id: 'ipc-1', title: '新任务名称' })
    await expect(handler('tasks:list')({ sender })).resolves.toEqual([expect.objectContaining({ id: 'ipc-1', title: '新任务名称' })])
    await expect(handler('tasks:cancel')({ sender }, { taskId: 'ipc-1' })).resolves.toBe(true)
    await expect(handler('tasks:retry')({ sender }, { taskId: 'ipc-1' })).resolves.toBe(true)
    await expect(handler('tasks:archive')({ sender }, { taskId: 'ipc-1' })).resolves.toBe(false)
    await handler('tasks:pause')({ sender }); await handler('tasks:resume')({ sender })
    await handler('tasks:cancel')({ sender }, { taskId: 'ipc-1' })
    await expect(handler('tasks:archive')({ sender }, { taskId: 'ipc-1' })).resolves.toBe(true)
    await expect(handler('tasks:list')({ sender }, { archived: true })).resolves.toEqual([expect.objectContaining({ id: 'ipc-1' })])
    await expect(handler('tasks:restore')({ sender }, { taskId: 'ipc-1' })).resolves.toBe(true)
    await expect(handler('tasks:remove')({ sender }, { taskId: 'ipc-1' })).resolves.toBe(true)
    expect([...electronMock.handlers.keys()]).toEqual(expect.arrayContaining(['tasks:create', 'tasks:list', 'tasks:get', 'tasks:rename', 'tasks:cancel', 'tasks:retry', 'tasks:pause', 'tasks:resume', 'tasks:archive', 'tasks:restore', 'tasks:remove']))
    unregister(); expect(electronMock.handlers.size).toBe(0)
  })

  it('deduplicates batch ids and reports partial success without hiding skipped tasks', async () => {
    const project = await mkdtemp(join(tmpdir(), 'latent-task-ipc-')); roots.push(project)
    const sender = { id: 2, isDestroyed: () => false, send: vi.fn() } as unknown as WebContents
    const unregister = registerTasksIpc({ getProjectRoot: () => project })
    await handler('tasks:create')({ sender }, { id: 'terminal', title: '已完成前置任务' })
    await handler('tasks:create')({ sender }, { id: 'active', title: '活动任务' })
    await handler('tasks:cancel')({ sender }, { taskId: 'terminal' })

    await expect(handler('tasks:batch')({ sender }, {
      action: 'archive',
      taskIds: ['terminal', 'active', 'terminal'],
    })).resolves.toEqual({
      action: 'archive',
      requested: 2,
      succeeded: ['terminal'],
      skipped: ['active'],
      failed: [],
    })
    await expect(handler('tasks:list')({ sender }, { archived: true })).resolves.toEqual([
      expect.objectContaining({ id: 'terminal' }),
    ])
    await expect(handler('tasks:queue-state')({ sender })).resolves.toEqual({ paused: false })
    await handler('tasks:pause')({ sender })
    await expect(handler('tasks:queue-state')({ sender })).resolves.toEqual({ paused: true })
    await handler('tasks:resume')({ sender })
    await expect(handler('tasks:queue-state')({ sender })).resolves.toEqual({ paused: false })
    unregister()
  })

  it('routes image task batch actions through the image service', async () => {
    const project = await mkdtemp(join(tmpdir(), 'latent-task-ipc-')); roots.push(project)
    const sender = { id: 3, isDestroyed: () => false, send: vi.fn() } as unknown as WebContents
    const retry = vi.fn().mockResolvedValue(true)
    const imageApi = {
      get: vi.fn().mockResolvedValue({ id: 'image-1', status: 'failed' }),
      retry,
    } as unknown as ImageApi
    const unregister = registerTasksIpc({ getProjectRoot: () => project, imageApi })

    await expect(handler('tasks:batch')({ sender }, { action: 'retry', taskIds: ['image-1'] })).resolves.toMatchObject({
      succeeded: ['image-1'],
      skipped: [],
      failed: [],
    })
    expect(retry).toHaveBeenCalledWith('image-1')
    unregister()
  })
})
