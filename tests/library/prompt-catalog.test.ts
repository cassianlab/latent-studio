import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { gzipSync } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'
import { createNodeSqliteDatabase, initializeGlobalDatabase } from '../../src/main/config'
import { GlobalPromptStore } from '../../src/main/library/global'
import { PROMPT_CATALOG_SOURCE_DEFINITIONS, removeRetiredPromptCatalogImports, syncPromptCatalog } from '../../src/main/library/prompt-catalog'
import type { PromptCatalogSource } from '../../src/shared/contracts/library'

async function nanmiArchiveFixture(): Promise<Uint8Array> {
  const directory = await mkdtemp(join(tmpdir(), 'latent-studio-nanmi-test-'))
  const path = join(directory, 'prompts.db')
  const database = new DatabaseSync(path)
  try {
    database.exec(`
      CREATE TABLE prompts (tweet_id TEXT, author TEXT, tool TEXT, prompt_text TEXT, tweet_url TEXT);
      CREATE TABLE prompt_translations (tweet_id TEXT, translated_text TEXT, translation_version INTEGER, locale TEXT);
      CREATE TABLE images (tweet_id TEXT, url TEXT, image_index INTEGER);
      CREATE TABLE prompt_labels (tweet_id TEXT, label_id INTEGER, taxonomy_version TEXT, confidence REAL);
      CREATE TABLE taxonomy_labels (label_id INTEGER, taxonomy_version TEXT, dimension_key TEXT, key TEXT, display_zh TEXT);
      INSERT INTO prompts VALUES ('1', 'Nanmi', 'Nano Banana', 'Studio portrait', 'https://x.com/example/1');
      INSERT INTO prompt_translations VALUES ('1', '影棚人像', 1, 'zh-CN');
      INSERT INTO images VALUES ('1', 'https://cdn.example.com/1.jpg', 1);
      INSERT INTO prompt_labels VALUES ('1', 1, 'v1', 0.9);
      INSERT INTO taxonomy_labels VALUES (1, 'v1', 'subject', 'portrait', '人像');
    `)
  } finally {
    database.close()
  }
  try {
    return gzipSync(await readFile(path))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

describe('open-source prompt catalog', () => {
  it('exposes only the confirmed active source registry', () => {
    expect(PROMPT_CATALOG_SOURCE_DEFINITIONS.map((source) => source.id)).toEqual([
      'youmind-gpt-image-2',
      'wangrunlin-gpt-image-2-5',
      'vigo-ai-visual-prompt-cookbook',
      'stretchcloud-gpt-image-prompt-2-5',
      'nanimicoder-open-image-prompts',
      'awesome-gpt-image-2',
    ])
    expect(PROMPT_CATALOG_SOURCE_DEFINITIONS.map((source) => source.id)).not.toEqual(expect.arrayContaining(['prompts.chat', 'awesome-prompts', 'evolink-gpt-image-2', 'youmind-nano-banana-pro']))
  })

  it('coalesces concurrent synchronization requests for the same source', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeGlobalDatabase(database)
    const store = new GlobalPromptStore(database)
    const responders: Array<(response: Response) => void> = []
    const fetch = vi.fn(() => new Promise<Response>((resolve) => responders.push(resolve)))
    try {
      const first = syncPromptCatalog({ source: 'awesome-gpt-image-2', store, database, fetch })
      const second = syncPromptCatalog({ source: 'awesome-gpt-image-2', store, database, fetch })
      await Promise.resolve()
      responders.forEach((resolve) => resolve(new Response(JSON.stringify({ cases: [{ id: 1, title: '雨夜', prompt: 'Rainy night', category: 'Landscape' }] }), { status: 200 })))

      const [firstResult, secondResult] = await Promise.all([first, second])
      expect(fetch).toHaveBeenCalledOnce()
      expect(secondResult).toEqual(firstResult)
      await expect(store.list({ scope: 'global' })).resolves.toHaveLength(1)
    } finally {
      database.close?.()
    }
  })

  it('removes every retired catalog import and derived index without touching personal copies', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeGlobalDatabase(database)
    const store = new GlobalPromptStore(database)
    try {
      const retired = [
        ['prompts.chat', 'prompts.chat'],
        ['awesome-prompts', 'Awesome Prompts'],
        ['evolink-gpt-image-2', 'EvoLink GPT Image 2'],
        ['youmind-nano-banana-pro', 'YouMind Nano Banana Pro'],
      ] as const
      const imported = []
      for (const [source, collection] of retired) {
        imported.push(await store.save({
          name: `旧上游提示词 ${source}`,
          content: 'This retired upstream prompt should disappear.',
          scope: 'global',
          source: 'import',
          collection,
          category: '其他',
          tags: [source, `source-id:${source}:legacy`],
        }))
        database.run('INSERT INTO prompt_catalog_sources (id, display_name, repository_url, adapter_id, enabled) VALUES (?, ?, ?, ?, 1)', source, collection, `https://example.com/${source}`, source)
      }
      const personal = await store.save({
        name: '我的副本',
        content: 'Keep this personal copy.',
        scope: 'global',
        source: 'manual',
        collection: '个人',
        category: '人像',
        tags: retired.map(([source]) => source),
      })
      for (const item of imported) {
        database.run('INSERT INTO prompt_embeddings (item_id, model_id, model_version, content_hash, dimensions, dtype, vector_blob, status, created_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)', item.id, 'test-model', '1', item.id, 'float32', new Uint8Array([0, 0, 0, 0]), 'ready', item.updatedAt)
      }

      expect(removeRetiredPromptCatalogImports(database)).toBe(4)
      const items = await store.list({ scope: 'global' })
      expect(items.map((item) => item.name)).toEqual(['我的副本'])
      expect(database.all<{ enabled: number }>('SELECT enabled FROM prompt_catalog_sources ORDER BY id')).toEqual(retired.map(() => ({ enabled: 0 })))
      expect(database.all('SELECT prompt_id FROM prompt_search_documents')).toEqual([{ prompt_id: personal.id }])
      expect(database.all('SELECT d.prompt_id FROM prompt_search_fts f JOIN prompt_search_documents d ON d.rowid = f.rowid')).toEqual([{ prompt_id: personal.id }])
      expect(database.all('SELECT item_id FROM prompt_embeddings')).toEqual([])
    } finally {
      database.close?.()
    }
  })

  it('syncs the GPT Image 2 index without downloading gallery images', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeGlobalDatabase(database)
    const store = new GlobalPromptStore(database)
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      repository: 'https://github.com/freestylefly/awesome-gpt-image-2',
      totalCases: 1,
      cases: [{
        id: 544,
        title: '幼儿词汇拆解学习卡',
        prompt: 'Create a clean vocabulary poster.',
        category: 'Charts & Infographics',
        styles: ['Poster', 'Realistic'],
        scenes: ['Education'],
        image: '/images/case544.jpg',
        githubUrl: 'https://github.com/freestylefly/awesome-gpt-image-2/blob/main/docs/gallery-part-2.md#case-544',
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    try {
      await expect(syncPromptCatalog({ source: 'awesome-gpt-image-2', store, fetch })).resolves.toMatchObject({ imported: 1, total: 1 })
      expect(fetch).toHaveBeenCalledOnce()
      expect(fetch.mock.calls[0]?.[0]).toContain('/data/cases.json')
      const [item] = await store.list({ scope: 'global' })
      expect(item).toMatchObject({
        name: '幼儿词汇拆解学习卡',
        content: 'Create a clean vocabulary poster.',
        collection: 'Awesome GPT Image 2',
        category: '海报与平面',
        previewUrl: 'https://raw.githubusercontent.com/freestylefly/awesome-gpt-image-2/main/data/images/case544.jpg',
        sourceUrl: 'https://github.com/freestylefly/awesome-gpt-image-2/blob/main/docs/gallery-part-2.md#case-544',
        tags: expect.arrayContaining(['awesome-gpt-image-2', 'Charts & Infographics', 'Poster', 'Education']),
      })
    } finally {
      database.close?.()
    }
  })

  it('rejects synchronization requests for every retired source', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeGlobalDatabase(database)
    const store = new GlobalPromptStore(database)
    try {
      for (const source of ['prompts.chat', 'awesome-prompts', 'evolink-gpt-image-2', 'youmind-nano-banana-pro'] as PromptCatalogSource[]) {
        await expect(syncPromptCatalog({ source, store })).rejects.toMatchObject({ code: 'invalid-input' })
      }
      await expect(store.list({ scope: 'global' })).resolves.toEqual([])
    } finally {
      database.close?.()
    }
  })

  it('updates changed remote prompts without overwriting personal copies', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeGlobalDatabase(database)
    const store = new GlobalPromptStore(database)
    const catalog = (prompt: string) => new Response(JSON.stringify({
      cases: [{ id: 7, title: '风景模板', prompt, category: 'Landscape', image: '/images/case7.jpg' }],
    }), { status: 200 })
    try {
      await store.save({ scope: 'global', name: '我的改编', content: '保留我的内容', source: 'manual', collection: '个人', category: '风景' })
      await syncPromptCatalog({ source: 'awesome-gpt-image-2', store, fetch: async () => catalog('旧版提示词') })
      await expect(syncPromptCatalog({ source: 'awesome-gpt-image-2', store, fetch: async () => catalog('新版提示词') })).resolves.toMatchObject({ imported: 0, updated: 1, skipped: 0, total: 1 })

      const items = await store.list({ scope: 'global' })
      expect(items).toHaveLength(2)
      expect(items).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: '风景模板', content: '新版提示词', source: 'import' }),
        expect.objectContaining({ name: '我的改编', content: '保留我的内容', collection: '个人' }),
      ]))
      const imported = items.find((item) => item.name === '风景模板')
      expect(imported?.id).toBeDefined()
      const firstId = imported?.id
      await syncPromptCatalog({ source: 'awesome-gpt-image-2', store, fetch: async () => catalog('第三版提示词') })
      expect((await store.list({ scope: 'global' })).find((item) => item.name === '风景模板')?.id).toBe(firstId)
    } finally {
      database.close?.()
    }
  })

  it('rolls back all catalog writes when an item update fails midway', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeGlobalDatabase(database)
    const store = new GlobalPromptStore(database)
    const catalog = (suffix: string) => new Response(JSON.stringify({
      cases: [
        { id: 1, title: '风景模板', prompt: `风景 ${suffix}`, category: 'Landscape' },
        { id: 2, title: '人像模板', prompt: `人像 ${suffix}`, category: 'Portrait' },
      ],
    }), { status: 200 })
    try {
      await syncPromptCatalog({ source: 'awesome-gpt-image-2', store, database, fetch: async () => catalog('旧版') })
      const originalUpdate = store.update.bind(store)
      let updateCount = 0
      store.update = async (input) => {
        updateCount += 1
        if (updateCount === 2) throw new Error('simulated write failure')
        return originalUpdate(input)
      }

      await expect(syncPromptCatalog({ source: 'awesome-gpt-image-2', store, database, fetch: async () => catalog('新版') })).rejects.toThrow('simulated write failure')
      expect((await store.list({ scope: 'global' })).map((item) => item.content).sort()).toEqual(['人像 旧版', '风景 旧版'])
      expect(database.all<{ status: string; error_code: string | null }>('SELECT status, error_code FROM prompt_catalog_sync_runs ORDER BY rowid DESC LIMIT 1')).toEqual([{ status: 'failed', error_code: 'write-failed' }])
    } finally {
      database.close?.()
    }
  })

  it('records an HTTP failure without replacing the last successful catalog', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeGlobalDatabase(database)
    const store = new GlobalPromptStore(database)
    const catalog = new Response(JSON.stringify({ cases: [{ id: 1, title: '雨夜', prompt: 'Rainy night', category: 'Landscape' }] }), { status: 200 })
    try {
      await syncPromptCatalog({ source: 'awesome-gpt-image-2', store, database, fetch: async () => catalog })
      await expect(syncPromptCatalog({ source: 'awesome-gpt-image-2', store, database, fetch: async () => new Response('upstream unavailable', { status: 503 }) })).rejects.toMatchObject({ code: 'read-failed' })

      await expect(store.list({ scope: 'global' })).resolves.toEqual([expect.objectContaining({ name: '雨夜', content: 'Rainy night' })])
      expect(database.all<{ last_success_version: string | null; last_error_code: string | null }>('SELECT last_success_version, last_error_code FROM prompt_catalog_sources')).toEqual([expect.objectContaining({ last_success_version: expect.any(String), last_error_code: 'read-failed' })])
      expect(database.all<{ status: string; error_code: string | null }>('SELECT status, error_code FROM prompt_catalog_sync_runs ORDER BY rowid DESC LIMIT 1')).toEqual([{ status: 'failed', error_code: 'read-failed' }])
    } finally {
      database.close?.()
    }
  })

  it('uses conditional metadata and skips an unchanged source on HTTP 304', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeGlobalDatabase(database)
    const store = new GlobalPromptStore(database)
    const firstFetch = vi.fn(async () => new Response(JSON.stringify({ cases: [{ id: 1, title: '雨夜', prompt: 'Rainy night', category: 'Landscape' }] }), { status: 200, headers: { etag: 'v1', 'last-modified': 'Tue, 15 Sep 2026 00:00:00 GMT' } }))
    const secondFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('if-none-match')).toBe('v1')
      expect(new Headers(init?.headers).get('if-modified-since')).toBe('Tue, 15 Sep 2026 00:00:00 GMT')
      return new Response(null, { status: 304, headers: { etag: 'v1' } })
    })
    try {
      await syncPromptCatalog({ source: 'awesome-gpt-image-2', store, database, fetch: firstFetch })
      await expect(syncPromptCatalog({ source: 'awesome-gpt-image-2', store, database, fetch: secondFetch })).resolves.toMatchObject({ imported: 0, updated: 0, removed: 0, skipped: 1, total: 1 })
      expect(secondFetch).toHaveBeenCalledOnce()
    } finally {
      database.close?.()
    }
  })

  it('retries a transient catalog request before reporting a sync failure', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeGlobalDatabase(database)
    const store = new GlobalPromptStore(database)
    await store.save({
      scope: 'global',
      name: '雨夜',
      content: 'Rainy night',
      source: 'import',
      collection: 'Awesome GPT Image 2',
      category: '风景',
      tags: ['awesome-gpt-image-2', 'source-id:awesome-gpt-image-2:1'],
    })
    database.run(
      'INSERT INTO prompt_catalog_checkpoints (source_id, remote_version, etag, updated_at) VALUES (?, ?, ?, ?)',
      'awesome-gpt-image-2', 'v1', 'etag-v1', '2026-09-19T00:00:00.000Z',
    )
    const fetch = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response(null, { status: 304 }))
    try {
      await expect(syncPromptCatalog({ source: 'awesome-gpt-image-2', store, database, fetch })).resolves.toMatchObject({
        imported: 0,
        updated: 0,
        skipped: 1,
      })
      expect(fetch).toHaveBeenCalledTimes(2)
    } finally {
      database.close?.()
    }
  })

  it('skips the NanmiCoder release download when the manifest version is already imported', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeGlobalDatabase(database)
    const store = new GlobalPromptStore(database)
    await store.save({
      scope: 'global',
      name: '影棚人像',
      content: 'Studio portrait',
      source: 'import',
      collection: 'NanmiCoder Open Image Prompts',
      category: '人像',
      tags: ['nanimicoder-open-image-prompts', 'source-id:nanimicoder-open-image-prompts:1'],
    })
    database.run(
      'INSERT INTO prompt_catalog_checkpoints (source_id, remote_version, updated_at) VALUES (?, ?, ?)',
      'nanimicoder-open-image-prompts', 'dataset-v1', '2026-09-19T00:00:00.000Z',
    )
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      dataset_version: 'dataset-v1',
      release_repo: 'NanmiCoder/open-image-prompts',
      db: { asset: 'prompts.db.gz', tag: 'dataset-v1', sha256: 'a'.repeat(64), bytes: 1024 },
    }), { status: 200 }))
    try {
      await expect(syncPromptCatalog({ source: 'nanimicoder-open-image-prompts', store, database, fetch })).resolves.toMatchObject({
        imported: 0,
        updated: 0,
        skipped: 1,
        total: 1,
      })
      expect(fetch).toHaveBeenCalledOnce()
      expect(fetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/NanmiCoder/open-image-prompts/contents/data/dataset-manifest.json?ref=main',
        expect.objectContaining({ headers: expect.objectContaining({ accept: 'application/vnd.github.raw+json', 'user-agent': 'Mozilla/5.0 LatentStudio/0.8' }) }),
      )
    } finally {
      database.close?.()
    }
  })

  it('resumes an interrupted NanmiCoder archive without downloading received bytes again', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeGlobalDatabase(database)
    const store = new GlobalPromptStore(database)
    const archive = await nanmiArchiveFixture()
    const cacheDirectory = await mkdtemp(join(tmpdir(), 'latent-studio-nanmi-cache-test-'))
    const manifest = JSON.stringify({
      dataset_version: 'dataset-v2',
      release_repo: 'NanmiCoder/open-image-prompts',
      db: { asset: 'prompts.db.gz', tag: 'dataset-v2', sha256: createHash('sha256').update(archive).digest('hex'), bytes: archive.byteLength },
    })
    const ranges: string[] = []
    let interrupted = false
    let resumedRange = ''
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes('dataset-manifest.json')) return new Response(manifest, { status: 200 })
      const range = new Headers(init?.headers).get('range')
      ranges.push(range ?? 'full')
      if (!range) return new Response(archive, { status: 200 })
      const match = /^bytes=(\d+)-(\d+)$/.exec(range)
      if (!match) return new Response(null, { status: 416 })
      const start = Number(match[1])
      const end = Number(match[2])
      if (!interrupted && start === 0) {
        interrupted = true
        const split = Math.max(1, Math.floor((end - start + 1) / 2))
        return new Response(archive.slice(start, start + split), {
          status: 206,
          headers: { 'content-range': `bytes ${start}-${end}/${archive.byteLength}` },
        })
      }
      if (start > 0 && end < Math.ceil(archive.byteLength / 4)) resumedRange = range
      return new Response(archive.slice(start, end + 1), {
        status: 206,
        headers: { 'content-range': `bytes ${start}-${end}/${archive.byteLength}` },
      })
    })
    try {
      await expect(syncPromptCatalog({ source: 'nanimicoder-open-image-prompts', store, database, fetch, cacheDirectory })).resolves.toMatchObject({ imported: 1, total: 1 })
      expect(ranges).toContain('bytes=0-' + (Math.ceil(archive.byteLength / 4) - 1))
      expect(resumedRange).toMatch(/^bytes=[1-9]\d*-/)
      await expect(store.list({ scope: 'global' })).resolves.toEqual([expect.objectContaining({ content: 'Studio portrait', translations: { 'zh-CN': '影棚人像' } })])
    } finally {
      database.close?.()
      await rm(cacheDirectory, { recursive: true, force: true })
    }
  })

  it('reuses the verified NanmiCoder archive after a local catalog write fails', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeGlobalDatabase(database)
    const store = new GlobalPromptStore(database)
    const archive = await nanmiArchiveFixture()
    const cacheDirectory = await mkdtemp(join(tmpdir(), 'latent-studio-nanmi-cache-test-'))
    const manifest = JSON.stringify({
      dataset_version: 'dataset-v3',
      release_repo: 'NanmiCoder/open-image-prompts',
      db: { asset: 'prompts.db.gz', tag: 'dataset-v3', sha256: createHash('sha256').update(archive).digest('hex'), bytes: archive.byteLength },
    })
    let archiveRequests = 0
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes('dataset-manifest.json')) return new Response(manifest, { status: 200 })
      archiveRequests += 1
      const range = new Headers(init?.headers).get('range')
      const match = /^bytes=(\d+)-(\d+)$/.exec(range ?? '')
      if (!match) return new Response(null, { status: 416 })
      const start = Number(match[1])
      const end = Number(match[2])
      return new Response(archive.slice(start, end + 1), {
        status: 206,
        headers: { 'content-range': `bytes ${start}-${end}/${archive.byteLength}` },
      })
    })
    const originalSave = store.save.bind(store)
    store.save = vi.fn(async () => { throw new Error('simulated local write failure') })
    try {
      await expect(syncPromptCatalog({ source: 'nanimicoder-open-image-prompts', store, database, fetch, cacheDirectory })).rejects.toThrow('simulated local write failure')
      expect(archiveRequests).toBe(4)

      store.save = originalSave
      await expect(syncPromptCatalog({ source: 'nanimicoder-open-image-prompts', store, database, fetch, cacheDirectory })).resolves.toMatchObject({ imported: 1, total: 1 })
      expect(archiveRequests).toBe(4)
    } finally {
      database.close?.()
      await rm(cacheDirectory, { recursive: true, force: true })
    }
  })

  it('parses the newly supported JSON repositories and writes sync metadata', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeGlobalDatabase(database)
    const store = new GlobalPromptStore(database)
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      entries: [{
        id: 'sample',
        title: { en: 'Product poster', 'zh-CN': '中文模板' },
        category: 'products',
        tags: ['layout'],
        prompt: { steps: [{ en: 'Create a product poster.', 'zh-CN': '生成一张商品海报。' }] },
        previews: [{ url: 'https://cdn.example.com/sample.jpg' }],
        source: { prompt_url: 'https://x.com/example/1' },
      }],
    }), { status: 200 }))
    try {
      await expect(syncPromptCatalog({ source: 'wangrunlin-gpt-image-2-5', store, database, fetch })).resolves.toMatchObject({ imported: 1, total: 1 })
      expect(await store.list({ scope: 'global' })).toEqual([expect.objectContaining({
        name: '中文模板',
        content: 'Create a product poster.',
        primaryLocale: 'en',
        translations: { 'zh-CN': '生成一张商品海报。' },
        category: '产品',
        previewUrl: 'https://cdn.example.com/sample.jpg',
      })])
      expect(database.all<{ id: string; last_success_version: string }>('SELECT id, last_success_version FROM prompt_catalog_sources')).toEqual([expect.objectContaining({ id: 'wangrunlin-gpt-image-2-5', last_success_version: expect.any(String) })])
      expect(database.all<{ status: string; records_added: number }>('SELECT status, records_added FROM prompt_catalog_sync_runs')).toEqual([expect.objectContaining({ status: 'succeeded', records_added: 1 })])
    } finally {
      database.close?.()
    }
  })

  it('bypasses an old wangrunlin checkpoint once to migrate bilingual content', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeGlobalDatabase(database)
    const store = new GlobalPromptStore(database)
    database.run(
      'INSERT INTO prompt_catalog_checkpoints (source_id, remote_version, etag, updated_at) VALUES (?, ?, ?, ?)',
      'wangrunlin-gpt-image-2-5', 'legacy-version', 'legacy-etag', '2026-09-19T00:00:00.000Z',
    )
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      entries: [{
        id: 'sample',
        title: { en: 'Product poster', 'zh-CN': '中文模板' },
        category: 'products',
        prompt: { steps: [{ en: 'Create a product poster.', 'zh-CN': '生成一张商品海报。' }] },
      }],
    }), { status: 200, headers: { etag: 'current-etag' } }))
    try {
      await syncPromptCatalog({ source: 'wangrunlin-gpt-image-2-5', store, database, fetch })
      expect(fetch.mock.calls[0]?.[1]?.headers).toBeUndefined()
      const checkpoint = database.all<{ cursor_json: string }>('SELECT cursor_json FROM prompt_catalog_checkpoints WHERE source_id = ?', 'wangrunlin-gpt-image-2-5')[0]
      expect(JSON.parse(checkpoint.cursor_json)).toEqual({ formatVersion: 2 })
    } finally {
      database.close?.()
    }
  })

  it('syncs every YouMind API page with Chinese content and remote thumbnails', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeGlobalDatabase(database)
    const store = new GlobalPromptStore(database)
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)) as { model: string; campaign: string; page: number; limit: number }
      expect(init?.method).toBe('POST')
      expect(new Headers(init?.headers).get('origin')).toBe('https://youmind.com')
      expect(payload).toMatchObject({ model: 'gpt-image-2', campaign: 'gpt-image-2-prompts', limit: 100 })
      return new Response(JSON.stringify({
        prompts: [{
          id: payload.page,
          title: payload.page === 1 ? '产品海报' : '城市夜景',
          description: '示例',
          slug: `sample-${payload.page}`,
          content: `English prompt ${payload.page}`,
          translatedContent: `中文提示词 ${payload.page}`,
          media: [`https://cdn.example.com/original-${payload.page}.jpg`],
          mediaThumbnails: [`https://cdn.example.com/thumb-${payload.page}.jpg`],
          sourceLink: `https://x.com/example/${payload.page}`,
          sourcePlatform: 'twitter',
          promptCategories: [payload.page === 1 ? 'products' : 'landscape'],
        }],
        total: 2,
        page: payload.page,
        limit: 100,
        totalPages: 2,
        hasMore: payload.page < 2,
      }), { status: 200 })
    })
    try {
      await expect(syncPromptCatalog({ source: 'youmind-gpt-image-2', store, database, fetch })).resolves.toMatchObject({ imported: 2, total: 2 })
      expect(fetch).toHaveBeenCalledTimes(2)
      await expect(store.list({ scope: 'global' })).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ name: '产品海报', content: 'English prompt 1', primaryLocale: 'en', translations: { 'zh-CN': '中文提示词 1' }, category: '产品', previewUrl: 'https://cdn.example.com/thumb-1.jpg', sourceUrl: 'https://x.com/example/1' }),
        expect.objectContaining({ name: '城市夜景', content: 'English prompt 2', primaryLocale: 'en', translations: { 'zh-CN': '中文提示词 2' }, category: '风景', previewUrl: 'https://cdn.example.com/thumb-2.jpg' }),
      ]))
    } finally {
      database.close?.()
    }
  })

  it('replaces a YouMind title copied from prompt text with its concise description', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeGlobalDatabase(database)
    const store = new GlobalPromptStore(database)
    const translated = '使用上传人物作为唯一身份参考，保留五官和发型，生成一组真实自然的时尚写真。'
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      prompts: [{
        id: 77,
        title: `提示词：${translated}`,
        description: '自然光时尚人像写真',
        content: 'Use the uploaded portrait as the only identity reference and create a natural fashion editorial.',
        translatedContent: translated,
      }],
      totalPages: 1,
      hasMore: false,
    }), { status: 200 }))
    try {
      await syncPromptCatalog({ source: 'youmind-gpt-image-2', store, database, fetch })
      await expect(store.list({ scope: 'global' })).resolves.toEqual([expect.objectContaining({
        name: '自然光时尚人像写真',
        content: 'Use the uploaded portrait as the only identity reference and create a natural fashion editorial.',
        translations: { 'zh-CN': translated },
      })])
    } finally {
      database.close?.()
    }
  })

  it('yields to the event loop while importing a large catalog', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeGlobalDatabase(database)
    const store = new GlobalPromptStore(database)
    const cases = Array.from({ length: 300 }, (_, index) => ({
      id: index + 1,
      title: `提示词 ${index + 1}`,
      prompt: `Prompt ${index + 1}`,
      category: 'General',
    }))
    let heartbeats = 0
    const timer = setInterval(() => { heartbeats += 1 }, 0)
    try {
      await syncPromptCatalog({
        source: 'awesome-gpt-image-2',
        store,
        database,
        fetch: async () => new Response(JSON.stringify({ cases }), { status: 200 }),
      })
      expect(heartbeats).toBeGreaterThan(0)
    } finally {
      clearInterval(timer)
      database.close?.()
    }
  })

  it('uses the YouMind published-time checkpoint for incremental updates', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeGlobalDatabase(database)
    const store = new GlobalPromptStore(database)
    let sync = 1
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const { page } = JSON.parse(String(init?.body)) as { page: number }
      if (sync === 1) {
        return new Response(JSON.stringify({
          prompts: [{
            id: page,
            title: page === 1 ? '当前边界' : '历史提示词',
            content: page === 1 ? 'Current boundary' : 'Historical prompt',
            sourcePublishedAt: page === 1 ? '2026-09-16T10:00:00.000Z' : '2026-09-15T10:00:00.000Z',
          }],
          totalPages: 2,
          hasMore: page < 2,
        }), { status: 200 })
      }
      if (page !== 1) throw new Error(`incremental sync fetched unexpected page ${page}`)
      return new Response(JSON.stringify({
        prompts: [
          { id: 3, title: '新增提示词', content: 'New prompt', sourcePublishedAt: '2026-09-17T10:00:00.000Z' },
          { id: 1, title: '当前边界', content: 'Current boundary', sourcePublishedAt: '2026-09-16T10:00:00.000Z' },
          { id: 4, title: '边界以下旧提示词', content: 'Older prompt', sourcePublishedAt: '2026-09-15T09:00:00.000Z' },
        ],
        totalPages: 2,
        hasMore: true,
      }), { status: 200 })
    })
    try {
      await expect(syncPromptCatalog({ source: 'youmind-gpt-image-2', store, database, fetch })).resolves.toMatchObject({ imported: 2, total: 2 })
      sync = 2
      await expect(syncPromptCatalog({ source: 'youmind-gpt-image-2', store, database, fetch })).resolves.toMatchObject({ imported: 1, updated: 0, removed: 0, skipped: 1, total: 2 })

      expect(fetch).toHaveBeenCalledTimes(3)
      expect((await store.list({ scope: 'global' })).map((item) => item.name).sort()).toEqual(['历史提示词', '当前边界', '新增提示词'].sort())
      const checkpoint = database.all<{ cursor_json: string }>('SELECT cursor_json FROM prompt_catalog_checkpoints WHERE source_id = ?', 'youmind-gpt-image-2')[0]
      expect(JSON.parse(checkpoint.cursor_json)).toMatchObject({ latestPublishedAt: '2026-09-17T10:00:00.000Z' })
    } finally {
      database.close?.()
    }
  })

  it('bootstraps a YouMind checkpoint from page one when an older local catalog already exists', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeGlobalDatabase(database)
    const store = new GlobalPromptStore(database)
    await store.save({
      scope: 'global',
      name: '旧版已有提示词',
      content: 'Existing local prompt',
      source: 'import',
      collection: 'YouMind GPT Image 2',
      category: '其他',
      tags: ['youmind-gpt-image-2', 'source-id:existing'],
    })
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const { page } = JSON.parse(String(init?.body)) as { page: number }
      if (page !== 1) throw new Error(`checkpoint bootstrap fetched unexpected page ${page}`)
      return new Response(JSON.stringify({
        prompts: [{
          id: 99,
          title: '最新提示词',
          content: 'Newest prompt',
          sourcePublishedAt: '2026-09-18T01:00:00.000Z',
        }],
        totalPages: 176,
        hasMore: true,
      }), { status: 200 })
    })
    try {
      await expect(syncPromptCatalog({ source: 'youmind-gpt-image-2', store, database, fetch })).resolves.toMatchObject({ imported: 1, removed: 0, total: 1 })
      expect(fetch).toHaveBeenCalledOnce()
      expect((await store.list({ scope: 'global' })).map((item) => item.name).sort()).toEqual(['旧版已有提示词', '最新提示词'])
      const checkpoint = database.all<{ cursor_json: string }>('SELECT cursor_json FROM prompt_catalog_checkpoints WHERE source_id = ?', 'youmind-gpt-image-2')[0]
      expect(JSON.parse(checkpoint.cursor_json)).toEqual({ latestPublishedAt: '2026-09-18T01:00:00.000Z', formatVersion: 2 })
    } finally {
      database.close?.()
    }
  })

  it('keeps the last YouMind GPT Image 2 catalog when a later page fails', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeGlobalDatabase(database)
    const store = new GlobalPromptStore(database)
    try {
      const completeFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        const payload = JSON.parse(String(init?.body)) as { model: string; campaign: string; page: number }
        expect(payload).toMatchObject({ model: 'gpt-image-2', campaign: 'gpt-image-2-prompts' })
        return new Response(JSON.stringify({ prompts: [{ id: 42, title: '原有提示词', content: 'Original prompt' }], totalPages: 1, hasMore: false }), { status: 200 })
      })
      await syncPromptCatalog({ source: 'youmind-gpt-image-2', store, database, fetch: completeFetch })

      const partialFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        const { page } = JSON.parse(String(init?.body)) as { page: number }
        if (page === 2) return new Response('upstream unavailable', { status: 403 })
        return new Response(JSON.stringify({ prompts: [{ id: 99, title: '未完整提示词', content: 'Partial prompt' }], totalPages: 2, hasMore: true }), { status: 200 })
      })
      await expect(syncPromptCatalog({ source: 'youmind-gpt-image-2', store, database, fetch: partialFetch })).rejects.toMatchObject({ code: 'read-failed' })
      await expect(store.list({ scope: 'global' })).resolves.toEqual([expect.objectContaining({ name: '原有提示词' })])
    } finally {
      database.close?.()
    }
  })

  it('loads Vigo style.json templates from the repository tree while keeping thumbnails remote', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeGlobalDatabase(database)
    const store = new GlobalPromptStore(database)
    const tree = JSON.stringify({ tree: [{ path: 'styles/retro-pop-sticker-cutout/style.json', type: 'blob', size: 1200 }] })
    const style = JSON.stringify({
      style_name: 'Retro Pop Sticker Cutout',
      style_slug: 'retro-pop-sticker-cutout',
      style_summary: 'Retro-pop scrapbook posters with oversized yellow headline typography.',
      prompt_template: 'Create a {ASPECT_RATIO} poster featuring {SUBJECT} with {MAIN_TEXT}.',
      visual_deconstruction: { style_category: 'Illustration poster' },
    })
    const fetch = vi.fn(async (url: string | URL | Request) => new Response(String(url).includes('/git/trees/') ? tree : style, { status: 200 }))
    try {
      await expect(syncPromptCatalog({ source: 'vigo-ai-visual-prompt-cookbook', store, fetch })).resolves.toMatchObject({ imported: 1, total: 1 })
      await expect(syncPromptCatalog({ source: 'vigo-ai-visual-prompt-cookbook', store, fetch })).resolves.toMatchObject({ imported: 0, updated: 0, skipped: 1, total: 1 })
      await expect(store.list({ scope: 'global' })).resolves.toEqual([expect.objectContaining({
        name: 'Retro Pop Sticker Cutout',
        content: 'Create a {ASPECT_RATIO} poster featuring {SUBJECT} with {MAIN_TEXT}.',
        kind: 'style',
        previewUrl: 'https://raw.githubusercontent.com/VigoZhao/AI-Visual-Prompt-Cookbook/main/assets/thumbs/retro-pop-sticker-cutout-16x9.jpg',
      })])
      expect(fetch).toHaveBeenCalledTimes(4)
    } finally {
      database.close?.()
    }
  })
})
