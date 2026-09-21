import { access, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { createNodeSqliteDatabase, initializeGlobalDatabase } from '../../src/main/config'
import type { EncryptedCredentialStore } from '../../src/main/credentials'
import { SettingsStore } from '../../src/main/settings'
import { TaskStore } from '../../src/main/tasks/store'
import { createImageModelService } from '../../src/main/images'

const credentials: EncryptedCredentialStore = {
  encryptApiKey: (value) => `encrypted:${value}`,
  decryptApiKey: (value) => value.replace(/^encrypted:/, ''),
}

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } })
}

async function waitFor<T>(read: () => Promise<T | undefined> | T | undefined, timeout = 1500): Promise<T> {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const value = await read()
    if (value !== undefined) return value
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('timed out waiting for image task')
}

describe('image tasks and task center', () => {
  it('persists one canonical task record and mirrors queue lifecycle', async () => {
    const project = await mkdtemp(join(tmpdir(), 'latent-image-task-center-'))
    const database = await createNodeSqliteDatabase(':memory:')
    initializeGlobalDatabase(database)
    const settings = new SettingsStore(database, credentials)
    const connection = settings.saveConnection({ name: '图片连接', providerType: 'openai', baseUrl: 'https://images.example.test/v1', apiKey: 'secret-key', maxConcurrency: 1 })
    const model = settings.saveModel({ connectionId: connection.id, modelId: 'image-test', name: '图片模型', kind: 'image', capabilities: [] })
    const taskStore = new TaskStore(project)
    const service = createImageModelService(settings, {
      getProjectRoot: () => project,
      getTaskStore: () => taskStore,
      fetch: async (url) => String(url).endsWith('/images/generations') ? jsonResponse({ data: [{ b64_json: png }] }) : jsonResponse({}),
    })
    try {
      const task = await service.enqueue({ id: 'image-1', modelProfileId: model.id, request: { prompt: '一只猫' } })
      expect(await taskStore.get(task.id)).toMatchObject({ id: task.id, kind: 'image', status: expect.stringMatching(/pending|running|completed/) })
      const completed = await waitFor(() => service.get(task.id).then((value) => value?.status === 'completed' ? value : undefined) as never)
      expect(completed.status).toBe('completed')
      expect(await taskStore.get(task.id)).toMatchObject({ status: 'completed', progress: 100 })
      const restored = new TaskStore(project)
      expect(await restored.get(task.id)).toMatchObject({ status: 'completed', kind: 'image' })
    } finally {
      service.dispose()
      database.close?.()
      await rm(project, { recursive: true, force: true })
    }
  })

  it('rehydrates an interrupted image task and resumes it after restart', async () => {
    const project = await mkdtemp(join(tmpdir(), 'latent-image-task-restart-'))
    const database = await createNodeSqliteDatabase(':memory:')
    initializeGlobalDatabase(database)
    const settings = new SettingsStore(database, credentials)
    const connection = settings.saveConnection({ name: '图片连接', providerType: 'openai', baseUrl: 'https://images.example.test/v1', apiKey: 'secret-key', maxConcurrency: 1 })
    const model = settings.saveModel({ connectionId: connection.id, modelId: 'image-test', name: '图片模型', kind: 'image', capabilities: [] })
    const taskStore = new TaskStore(project)
    await taskStore.syncImage({ id: 'interrupted', connectionId: connection.id, request: { model: model.modelId, prompt: '恢复这张图', operation: 'generate', references: [] }, status: 'paused', attempts: 1, maxRetries: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:01.000Z' }, model.id, project)
    let calls = 0
    const service = createImageModelService(settings, {
      getProjectRoot: () => project,
      getTaskStore: () => taskStore,
      fetch: async (url) => { calls += 1; return String(url).endsWith('/images/generations') ? jsonResponse({ data: [{ b64_json: png }] }) : jsonResponse({}) },
    })
    try {
      await expect(service.list()).resolves.toMatchObject([{ id: 'interrupted', status: 'pending' }])
      expect(calls).toBe(0)
      await service.resume()
      const completed = await waitFor(() => service.get('interrupted').then((value) => value?.status === 'completed' ? value : undefined) as never)
      expect(completed.status).toBe('completed')
      expect(calls).toBe(1)
    } finally {
      service.dispose()
      database.close?.()
      await rm(project, { recursive: true, force: true })
    }
  })

  it('archives, restores and removes an image task without deleting its generated file', async () => {
    const project = await mkdtemp(join(tmpdir(), 'latent-image-task-management-'))
    const database = await createNodeSqliteDatabase(':memory:')
    initializeGlobalDatabase(database)
    const settings = new SettingsStore(database, credentials)
    const connection = settings.saveConnection({ name: '图片连接', providerType: 'openai', baseUrl: 'https://images.example.test/v1', apiKey: 'secret-key', maxConcurrency: 1 })
    const model = settings.saveModel({ connectionId: connection.id, modelId: 'image-test', name: '图片模型', kind: 'image', capabilities: [] })
    const taskStore = new TaskStore(project)
    const service = createImageModelService(settings, {
      getProjectRoot: () => project,
      getTaskStore: () => taskStore,
      fetch: async () => jsonResponse({ data: [{ b64_json: png }] }),
    })
    try {
      const task = await service.enqueue({ id: 'managed-image', modelProfileId: model.id, request: { prompt: '保留输出文件' } })
      const completed = await waitFor(() => service.get(task.id).then((value) => value?.status === 'completed' ? value : undefined) as never)
      const outputPath = completed.result?.images[0]?.localPath as string

      expect(await service.archive(task.id)).toBe(true)
      await expect(service.list()).resolves.toEqual([])
      await expect(service.list({ archived: true })).resolves.toEqual([expect.objectContaining({ id: task.id })])
      expect(await service.restore(task.id)).toBe(true)
      await expect(service.list()).resolves.toEqual([expect.objectContaining({ id: task.id })])
      expect(await service.remove(task.id)).toBe(true)
      await expect(service.get(task.id)).resolves.toBeNull()
      await expect(access(outputPath)).resolves.toBeUndefined()
    } finally {
      service.dispose()
      database.close?.()
      await rm(project, { recursive: true, force: true })
    }
  })
})
