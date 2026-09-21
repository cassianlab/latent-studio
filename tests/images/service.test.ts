import { promises as fs } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { createNodeSqliteDatabase, initializeGlobalDatabase } from '../../src/main/config'
import type { EncryptedCredentialStore } from '../../src/main/credentials'
import { SettingsStore } from '../../src/main/settings'
import { createImageModelService } from '../../src/main/images'
import type { FetchImplementation } from '../../src/main/models/contracts'

const credentials: EncryptedCredentialStore = {
  encryptApiKey: (value) => `encrypted:${value}`,
  decryptApiKey: (value) => value.replace(/^encrypted:/, ''),
}

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } })
}

async function makeStore() {
  const database = await createNodeSqliteDatabase(':memory:')
  initializeGlobalDatabase(database)
  const store = new SettingsStore(database, credentials)
  const connection = store.saveConnection({ name: '图片连接', providerType: 'openai', baseUrl: 'https://images.example.test/v1', apiKey: 'secret-key', maxConcurrency: 2 })
  const model = store.saveModel({ connectionId: connection.id, modelId: 'image-test', name: '图片测试', kind: 'image', capabilities: [] })
  return { database, store, model }
}

async function waitFor<T>(read: () => T | Promise<T | undefined> | undefined, timeout = 500): Promise<T> {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const value = await read()
    if (value !== undefined) return value
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  throw new Error('timed out waiting for image task')
}

describe('image model service', () => {
  it('automatically retries a transient provider failure without caller configuration', async () => {
    const { database, store, model } = await makeStore()
    let attempts = 0
    const service = createImageModelService(store, {
      fetch: async () => {
        attempts += 1
        if (attempts === 1) {
          return new Response(JSON.stringify({ error: { message: 'temporary server failure' } }), {
            status: 503,
            headers: { 'content-type': 'application/json', 'retry-after': '0' },
          })
        }
        return jsonResponse({ data: [{ b64_json: png }] })
      },
    })

    try {
      const task = await service.enqueue({ modelProfileId: model.id, request: { prompt: '自动重试生图' } })
      const completed = await waitFor(() => service.get(task.id).then((record) => record?.status === 'completed' ? record : undefined))
      expect(completed.attempts).toBe(2)
      expect(completed.maxRetries).toBe(2)
    } finally {
      service.dispose()
      database.close?.()
    }
  })

  it('routes a generation request with reference images through the multi-image edit endpoint', async () => {
    const root = await mkdtemp(join(tmpdir(), 'latent-image-references-'))
    await fs.mkdir(join(root, 'assets'), { recursive: true })
    await writeFile(join(root, 'assets', 'one.png'), Buffer.from(png, 'base64'))
    await writeFile(join(root, 'assets', 'two.png'), Buffer.from(png, 'base64'))
    const { database, store, model } = await makeStore()
    const service = createImageModelService(store, {
      getProjectRoot: () => root,
      fetch: async (url, init) => {
        expect(String(url)).toBe('https://images.example.test/v1/images/edits')
        const form = init?.body as FormData
        expect(form.getAll('image[]')).toHaveLength(2)
        return jsonResponse({ data: [{ b64_json: png }] })
      },
    })
    try {
      const task = await service.enqueue({ modelProfileId: model.id, request: { prompt: '参考两张图生成', references: [{ type: 'file', path: 'assets/one.png' }, { type: 'file', path: 'assets/two.png' }] } })
      const completed = await waitFor(() => service.get(task.id).then((record) => record?.status === 'completed' ? record : undefined))
      expect(completed.request).toMatchObject({ operation: 'edit', references: expect.any(Array) })
    } finally {
      service.dispose()
      database.close?.()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('binds a task before the queue can start it', async () => {
    const { database, store, model } = await makeStore()
    const calls: string[] = []
    const fetch: FetchImplementation = async (url) => {
      calls.push(String(url))
        return jsonResponse({ id: 'image-1', model: 'image-test', data: [{ b64_json: png }] })
    }
    const service = createImageModelService(store, { fetch })
    try {
      const events: Array<{ type: string; task: { status: string } }> = []
      service.onTaskEvent((event) => events.push(event as never))
      const task = await service.enqueue({ modelProfileId: model.id, request: { prompt: '一只猫' } })
      const completed = await waitFor(() => events.find((event) => event.task.id === task.id && event.type === 'completed'))
      expect(completed.task.status).toBe('completed')
      expect(calls).toEqual(['https://images.example.test/v1/images/generations'])
    } finally {
      service.dispose()
      database.close?.()
    }
  })

  it('resolves relative project references and blocks references outside the project', async () => {
    const root = await mkdtemp(join(tmpdir(), 'latent-image-service-'))
    const outside = await mkdtemp(join(tmpdir(), 'latent-image-service-outside-'))
    await fs.mkdir(join(root, 'assets'), { recursive: true })
    await writeFile(join(root, 'assets', 'reference.png'), Buffer.from([1, 2, 3]))
    await writeFile(join(outside, 'secret.png'), Buffer.from([4, 5, 6]))
    const { database, store, model } = await makeStore()
    const service = createImageModelService(store, {
      getProjectRoot: () => root,
      fetch: async (_url, init) => {
        expect(init?.body).toBeInstanceOf(FormData)
        expect((init?.body as FormData).get('image[]')).toBeInstanceOf(Blob)
        return jsonResponse({ data: [{ b64_json: png }] })
      },
    })
    try {
      const task = await service.enqueue({ modelProfileId: model.id, request: { operation: 'edit', prompt: '修改', references: [{ type: 'file', path: 'assets/reference.png' }] } })
      const completed = await waitFor(() => service.get(task.id).then((record) => record?.status === 'completed' ? record : undefined))
      expect(completed.result?.images[0]?.localPath).toContain(join(root, 'outputs'))
      const rejected = await service.enqueue({ modelProfileId: model.id, request: { operation: 'edit', prompt: '修改', references: [{ type: 'file', path: join(outside, 'secret.png') }] } })
      const result = await waitFor(() => service.get(rejected.id).then((record) => ['failed', 'cancelled'].includes(record?.status ?? '') ? record : undefined))
      expect(result.error?.code).toBe('invalid_request')
    } finally {
      service.dispose()
      database.close?.()
      await Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })])
    }
  })

  it.each([
    ['private address', 'http://127.0.0.1/out.png', undefined],
    ['invalid format', 'https://cdn.example.test/out.png', new Response('not-an-image', { status: 200, headers: { 'content-type': 'image/png' } })],
    ['redirect', 'https://cdn.example.test/out.png', new Response('', { status: 302, headers: { location: 'https://cdn.example.test/final.png' } })],
    ['download failure', 'https://cdn.example.test/out.png', new TypeError('socket closed')],
  ] as const)('rejects unsafe or failed output downloads (%s)', async (_name, outputUrl, downloadResult) => {
    const root = await mkdtemp(join(tmpdir(), 'latent-image-output-'))
    const { database, store, model } = await makeStore()
    const service = createImageModelService(store, {
      getProjectRoot: () => root,
      fetch: async (url) => {
        if (String(url).endsWith('/images/generations')) return jsonResponse({ data: [{ url: outputUrl }] })
        if (downloadResult instanceof Error) throw downloadResult
        return downloadResult ?? jsonResponse({})
      },
    })
    try {
      const task = await service.enqueue({ modelProfileId: model.id, request: { prompt: '测试' }, maxRetries: 0 })
      const failed = await waitFor(() => service.get(task.id).then((record) => record?.status === 'failed' ? record : undefined))
      expect(failed.error?.code).toMatch(/parse|network/)
      expect(failed.result).toBeUndefined()
    } finally {
      service.dispose()
      database.close?.()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects output downloads over the byte limit before reading the body', async () => {
    const root = await mkdtemp(join(tmpdir(), 'latent-image-output-large-'))
    const { database, store, model } = await makeStore()
    const service = createImageModelService(store, {
      getProjectRoot: () => root,
      fetch: async (url) => String(url).endsWith('/images/generations')
        ? jsonResponse({ data: [{ url: 'https://cdn.example.test/large.png' }] })
        : new Response(new Uint8Array([0]), { status: 200, headers: { 'content-type': 'image/png', 'content-length': String(50 * 1024 * 1024 + 1) } }),
    })
    try {
      const task = await service.enqueue({ modelProfileId: model.id, request: { prompt: '测试' } })
      const failed = await waitFor(() => service.get(task.id).then((record) => record?.status === 'failed' ? record : undefined))
      expect(failed.error).toMatchObject({ code: 'parse', message: '图片结果大小无效' })
    } finally {
      service.dispose()
      database.close?.()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('persists verified image metadata including dimensions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'latent-image-output-meta-'))
    const { database, store, model } = await makeStore()
    const service = createImageModelService(store, {
      getProjectRoot: () => root,
      fetch: async (url) => String(url).endsWith('/images/generations')
        ? jsonResponse({ data: [{ b64_json: png }] })
        : jsonResponse({}),
    })
    try {
      const task = await service.enqueue({ modelProfileId: model.id, request: { prompt: '测试' } })
      const completed = await waitFor(() => service.get(task.id).then((record) => record?.status === 'completed' ? record : undefined))
      expect(completed.result?.images[0]).toMatchObject({ mimeType: 'image/png', byteLength: expect.any(Number), width: 1, height: 1 })
      expect(completed.result?.images[0]?.b64Json).toBeUndefined()
    } finally {
      service.dispose()
      database.close?.()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('normalizes provider output to the requested dimensions and format', async () => {
    const root = await mkdtemp(join(tmpdir(), 'latent-image-output-normalized-'))
    const providerBytes = await sharp({
      create: { width: 2, height: 3, channels: 3, background: '#d94a4f' },
    }).png().toBuffer()
    const { database, store, model } = await makeStore()
    const service = createImageModelService(store, {
      getProjectRoot: () => root,
      fetch: async () => jsonResponse({ data: [{ b64_json: providerBytes.toString('base64') }] }),
    })
    try {
      const task = await service.enqueue({ modelProfileId: model.id, request: { prompt: '标准化输出', size: '4x2', outputFormat: 'webp' } })
      const completed = await waitFor(() => service.get(task.id).then((record) => record?.status === 'completed' ? record : undefined))
      const result = completed.result?.images[0]
      expect(result).toMatchObject({
        mimeType: 'image/webp',
        width: 4,
        height: 2,
        normalization: { sourceMimeType: 'image/png', sourceWidth: 2, sourceHeight: 3 },
      })
      expect(result?.localPath).toMatch(/\.webp$/)
      await expect(sharp(result?.localPath).metadata()).resolves.toMatchObject({ format: 'webp', width: 4, height: 2 })
    } finally {
      service.dispose()
      database.close?.()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('preserves provider alpha pixels while resizing a transparent PNG', async () => {
    const root = await mkdtemp(join(tmpdir(), 'latent-image-output-alpha-'))
    const providerBytes = await sharp({
      create: { width: 2, height: 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    }).composite([{ input: { create: { width: 1, height: 1, channels: 4, background: { r: 220, g: 40, b: 40, alpha: 1 } } }, left: 0, top: 0 }]).png().toBuffer()
    const { database, store, model } = await makeStore()
    const service = createImageModelService(store, {
      getProjectRoot: () => root,
      fetch: async () => jsonResponse({ data: [{ b64_json: providerBytes.toString('base64') }] }),
    })
    try {
      const task = await service.enqueue({ modelProfileId: model.id, request: { prompt: '透明背景输出', outputSize: '4x4', outputFormat: 'png', background: 'transparent' } })
      const completed = await waitFor(() => service.get(task.id).then((record) => record?.status === 'completed' ? record : undefined))
      const { data } = await sharp(completed.result?.images[0]?.localPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      const alpha = Array.from({ length: data.length / 4 }, (_, index) => data[index * 4 + 3])
      expect(Math.min(...alpha)).toBe(0)
      expect(Math.max(...alpha)).toBeGreaterThan(0)
    } finally {
      service.dispose()
      database.close?.()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('preserves the complete frame when source and export ratios differ', async () => {
    const root = await mkdtemp(join(tmpdir(), 'latent-image-output-preserve-frame-'))
    const providerBytes = await sharp({
      create: { width: 4, height: 2, channels: 4, background: { r: 220, g: 40, b: 40, alpha: 1 } },
    }).composite([{ input: { create: { width: 2, height: 2, channels: 4, background: { r: 40, g: 80, b: 220, alpha: 1 } } }, left: 2, top: 0 }]).png().toBuffer()
    const { database, store, model } = await makeStore()
    const service = createImageModelService(store, { getProjectRoot: () => root, fetch: async () => jsonResponse({ data: [{ b64_json: providerBytes.toString('base64') }] }) })
    try {
      const task = await service.enqueue({ modelProfileId: model.id, request: { prompt: '完整画面', outputSize: '2x2', outputFormat: 'png' } })
      const completed = await waitFor(() => service.get(task.id).then((record) => record?.status === 'completed' ? record : undefined))
      const outputPath = completed.result?.images[0]?.localPath
      const { data, info } = await sharp(outputPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      expect(info.width).toBe(2)
      expect(info.height).toBe(2)
      const pixels = Array.from({ length: info.width * info.height }, (_, index) => index * 4)
      expect(pixels.some((index) => data[index + 3] === 0)).toBe(true)
      expect(pixels.some((index) => data[index] > 150 && data[index + 2] < 120)).toBe(true)
      expect(pixels.some((index) => data[index + 2] > 150 && data[index] < 120)).toBe(true)
    } finally {
      service.dispose()
      database.close?.()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('exports target dimensions without sending local-only outputSize to the provider', async () => {
    const root = await mkdtemp(join(tmpdir(), 'latent-image-export-target-'))
    const { database, store, model } = await makeStore()
    const service = createImageModelService(store, {
      getProjectRoot: () => root,
      fetch: async (_url, init) => {
        const body = JSON.parse(String(init?.body))
        expect(body.size).toBe('1024x1024')
        expect(body).not.toHaveProperty('outputSize')
        expect(body).not.toHaveProperty('output_size')
        return jsonResponse({ data: [{ b64_json: png }] })
      },
    })
    try {
      const task = await service.enqueue({ modelProfileId: model.id, request: { prompt: '导出规格', size: '1024x1024', outputSize: '16x9', outputFormat: 'jpeg' } })
      const completed = await waitFor(() => service.get(task.id).then((record) => record?.status === 'completed' ? record : undefined))
      await expect(sharp(completed.result?.images[0]?.localPath).metadata()).resolves.toMatchObject({ format: 'jpeg', width: 16, height: 9 })
    } finally {
      service.dispose()
      database.close?.()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('normalizes every result in a batch even when provider sizes and encodings differ', async () => {
    const root = await mkdtemp(join(tmpdir(), 'latent-image-batch-spec-'))
    const { database, store, model } = await makeStore()
    const images = await Promise.all([
      sharp({ create: { width: 2, height: 3, channels: 3, background: '#d94a4f' } }).png().toBuffer(),
      sharp({ create: { width: 4, height: 2, channels: 3, background: '#d94a4f' } }).jpeg().toBuffer(),
      sharp({ create: { width: 3, height: 3, channels: 3, background: '#d94a4f' } }).webp().toBuffer(),
    ])
    const service = createImageModelService(store, { getProjectRoot: () => root, fetch: async () => jsonResponse({ data: images.map((bytes) => ({ b64_json: bytes.toString('base64') })) }) })
    try {
      const task = await service.enqueue({ modelProfileId: model.id, request: { prompt: '统一批次规格', outputSize: '16x9', outputFormat: 'png', n: 3 } })
      const completed = await waitFor(() => service.get(task.id).then((record) => record?.status === 'completed' ? record : undefined))
      expect(completed.result?.images).toHaveLength(3)
      for (const result of completed.result!.images) {
        await expect(sharp(result.localPath).metadata()).resolves.toMatchObject({ format: 'png', width: 16, height: 9 })
      }
    } finally {
      service.dispose()
      database.close?.()
      await rm(root, { recursive: true, force: true })
    }
  })

  it.each(['auto', '0x9', '99999x99999', 4096])('rejects invalid export dimensions before a model call (%s)', async (outputSize) => {
    const { database, store, model } = await makeStore()
    const service = createImageModelService(store, { fetch: async () => { throw new Error('must not call provider') } })
    try {
      await expect(service.enqueue({ modelProfileId: model.id, request: { prompt: '非法规格', outputSize } })).rejects.toMatchObject({ code: 'invalid_request' })
    } finally {
      service.dispose()
      database.close?.()
    }
  })

  it('uses the normalized PNG extension even when the provider URL ends in JPEG', async () => {
    const root = await mkdtemp(join(tmpdir(), 'latent-image-format-extension-'))
    const providerBytes = await sharp({ create: { width: 2, height: 3, channels: 3, background: '#d94a4f' } }).jpeg().toBuffer()
    const { database, store, model } = await makeStore()
    const service = createImageModelService(store, {
      getProjectRoot: () => root,
      fetch: async (url) => String(url).endsWith('/images/generations')
        ? jsonResponse({ data: [{ url: 'https://cdn.example.test/result.jpg' }] })
        : new Response(providerBytes, { headers: { 'content-type': 'image/jpeg' } }),
    })
    try {
      const task = await service.enqueue({ modelProfileId: model.id, request: { prompt: 'PNG 输出', size: '4x2', outputFormat: 'png' } })
      const completed = await waitFor(() => service.get(task.id).then((record) => record?.status === 'completed' ? record : undefined))
      const result = completed.result?.images[0]
      expect(result?.localPath).toMatch(/\.png$/)
      expect(result?.mimeType).toBe('image/png')
      expect(result?.url).toBeUndefined()
      await expect(sharp(result?.localPath).metadata()).resolves.toMatchObject({ format: 'png', width: 4, height: 2 })
    } finally {
      service.dispose()
      database.close?.()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('pins the model connection and project scope when a task is enqueued', async () => {
    const firstRoot = await mkdtemp(join(tmpdir(), 'latent-image-pinned-a-'))
    const secondRoot = await mkdtemp(join(tmpdir(), 'latent-image-pinned-b-'))
    const { database, store, model } = await makeStore()
    let activeRoot = firstRoot
    const calls: Array<{ body: Record<string, unknown>; key: string }> = []
    const service = createImageModelService(store, {
      getProjectRoot: () => activeRoot,
      fetch: async (url, init) => {
        if (String(url).endsWith('/images/generations')) {
          calls.push({ body: JSON.parse(String(init?.body)) as Record<string, unknown>, key: String((init?.headers as Record<string, string>)?.authorization) })
          return jsonResponse({ data: [{ b64_json: png }] })
        }
        return jsonResponse({})
      },
    })
    try {
      await service.pause()
      const task = await service.enqueue({ modelProfileId: model.id, request: { prompt: '固定路由' } })
      const connection = store.get().connections[0]
      store.saveConnection({ ...connection, apiKey: 'changed-key' })
      store.saveModel({ ...model, modelId: 'changed-image' })
      await service.resume()
      const completed = await waitFor(() => service.get(task.id).then((record) => record?.status === 'completed' ? record : undefined))
      expect(calls).toHaveLength(1)
      expect(calls[0]?.body.model).toBe('image-test')
      expect(calls[0]?.key).toBe('Bearer secret-key')
      expect(completed.result?.images[0]?.localPath).toContain(join(firstRoot, 'outputs'))
      expect(completed.result?.images[0]?.localPath).not.toContain(join(secondRoot, 'outputs'))
      activeRoot = secondRoot
      expect(await service.list()).toEqual([])
    } finally {
      service.dispose()
      database.close?.()
      await Promise.all([rm(firstRoot, { recursive: true, force: true }), rm(secondRoot, { recursive: true, force: true })])
    }
  })

  it('propagates cancellation while downloading a URL result', async () => {
    const root = await mkdtemp(join(tmpdir(), 'latent-image-download-cancel-'))
    const { database, store, model } = await makeStore()
    let downloadStarted = false
    let downloadSignal: AbortSignal | undefined
    const service = createImageModelService(store, {
      getProjectRoot: () => root,
      fetch: async (url, init) => {
        if (String(url).endsWith('/images/generations')) return jsonResponse({ data: [{ url: 'https://cdn.example.test/result.png' }] })
        downloadStarted = true
        downloadSignal = init?.signal
        return new Promise<Response>((_resolve, reject) => {
          if (init?.signal?.aborted) reject(new DOMException('Aborted', 'AbortError'))
          else init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
        })
      },
    })
    try {
      const task = await service.enqueue({ modelProfileId: model.id, request: { prompt: '取消下载' } })
      await waitFor(() => downloadStarted ? true : undefined)
      expect(await service.cancel(task.id)).toBe(true)
      const cancelled = await waitFor(() => service.get(task.id).then((record) => record?.status === 'cancelled' ? record : undefined))
      expect(cancelled.error?.code).toBe('cancelled')
      expect(downloadSignal?.aborted).toBe(true)
    } finally {
      service.dispose()
      database.close?.()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('isolates queue state when the active project changes', async () => {
    const firstRoot = await mkdtemp(join(tmpdir(), 'latent-image-isolation-a-'))
    const secondRoot = await mkdtemp(join(tmpdir(), 'latent-image-isolation-b-'))
    const { database, store, model } = await makeStore()
    let activeRoot = firstRoot
    let release: (() => void) | undefined
    const service = createImageModelService(store, {
      getProjectRoot: () => activeRoot,
      fetch: async (_url, init) => new Promise<Response>((resolve) => {
        if (init?.signal?.aborted) { resolve(jsonResponse({ data: [] })); return }
        release = () => resolve(jsonResponse({ data: [{ b64_json: png }] }))
      }),
    })
    try {
      const first = await service.enqueue({ modelProfileId: model.id, request: { prompt: '项目 A' } })
      await waitFor(() => service.get(first.id).then((record) => record?.status === 'running' ? true : undefined))
      activeRoot = secondRoot
      expect(await service.list()).toEqual([])
      expect(await service.cancel(first.id)).toBe(false)
      release?.()
      await new Promise((resolve) => setTimeout(resolve, 10))
      const second = await service.enqueue({ modelProfileId: model.id, request: { prompt: '项目 B' } })
      expect((await service.list()).map((task) => task.id)).toEqual([second.id])
    } finally {
      service.dispose()
      database.close?.()
      await Promise.all([rm(firstRoot, { recursive: true, force: true }), rm(secondRoot, { recursive: true, force: true })])
    }
  })

  it('automatically registers completed output image in asset store', async () => {
    const root = await mkdtemp(join(tmpdir(), 'latent-image-autorecord-'))
    const { database, store, model } = await makeStore()
    const recordedAssets: unknown[] = []
    const mockAssetStore = {
      recordGenerated: async (input: unknown) => {
        recordedAssets.push(input)
        return input as never
      },
    }
    const service = createImageModelService(store, {
      getProjectRoot: () => root,
      getAssetStore: () => mockAssetStore as never,
      fetch: async () => jsonResponse({ id: 'img-1', model: 'image-test', data: [{ b64_json: png }] }),
    })
    try {
      const task = await service.enqueue({ modelProfileId: model.id, request: { prompt: '星际战舰' } })
      await waitFor(async () => {
        const item = await service.get(task.id)
        return item?.status === 'completed' ? true : undefined
      })
      const canonicalRoot = await fs.realpath(root)
      expect(recordedAssets).toHaveLength(1)
      expect(recordedAssets[0]).toMatchObject({
        projectRoot: canonicalRoot,
        taskId: task.id,
        title: '星际战舰',
      })
    } finally {
      service.dispose()
      database.close?.()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('physically unlinks generated files from disk when removed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'latent-image-remove-'))
    const { database, store, model } = await makeStore()
    const service = createImageModelService(store, {
      getProjectRoot: () => root,
      fetch: async () => jsonResponse({ id: 'img-del', model: 'image-test', data: [{ b64_json: png }] }),
    })
    try {
      const task = await service.enqueue({ modelProfileId: model.id, request: { prompt: '待删除图' } })
      const completed = await waitFor(() => service.get(task.id).then((r) => (r?.status === 'completed' ? r : undefined)))
      const filePath = completed.result?.images[0]?.localPath
      expect(filePath).toBeTruthy()
      await expect(fs.access(filePath!)).resolves.toBeUndefined()

      const removed = await service.remove(task.id, filePath)
      expect(removed).toBe(true)
      await expect(fs.access(filePath!)).rejects.toThrow()
      expect(await service.get(task.id)).toBeFalsy()
    } finally {
      service.dispose()
      database.close?.()
      await rm(root, { recursive: true, force: true })
    }
  })
})
