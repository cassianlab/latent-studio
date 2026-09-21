import { describe, expect, it, vi } from 'vitest'
import { mergeSearchablePromptAssets, PromptSearchService, rankPromptAssets, type EmbeddingProvider } from '../../src/main/library/prompt-search'
import type { PromptAsset } from '../../src/shared/contracts/library'
import { createNodeSqliteDatabase, initializeGlobalDatabase } from '../../src/main/config/database'
import type { GlobalDatabase } from '../../src/main/config'
import { GlobalPromptStore } from '../../src/main/library/global'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

function item(id: string, name: string, content: string, category: string, favorite = false): PromptAsset {
  return { id, name, content, kind: 'prompt', scope: 'global', version: 1, tags: ['import'], favorite, collection: '开源仓库', category, createdAt: '', updatedAt: '' }
}

describe('prompt library lexical ranking', () => {
  it('includes current-project personal prompts in the same searchable index with project precedence', () => {
    const global = [item('global-1', '全局人像', '全局提示词', '人像'), item('shared-id', '旧全局项', '旧内容', '其他')]
    const project = [{ ...item('project-1', '项目角色', '项目专属银发角色', '角色设计'), scope: 'project' as const }, { ...item('shared-id', '项目覆盖项', '项目内容', '角色设计'), scope: 'project' as const }]

    expect(mergeSearchablePromptAssets(global, project).map((value) => [value.id, value.name])).toEqual([
      ['project-1', '项目角色'],
      ['shared-id', '项目覆盖项'],
      ['global-1', '全局人像'],
    ])
  })

  it('expands Chinese intent terms and ranks title/category matches first', () => {
    const result = rankPromptAssets([
      item('1', '城市夜景', '城市夜景摄影，雨后路面反光', '风景'),
      item('2', '人像定妆照', 'portrait editorial studio photo', '人像'),
      item('3', '商品主图', 'clean product hero image for e-commerce', '商品与电商'),
    ], '人物肖像摄影', 4)
    expect(result[0]?.id).toBe('2')
  })

  it('rewards complete query coverage over a single title token', () => {
    const result = rankPromptAssets([
      item('single', '城市摄影', '现代建筑摄影', '建筑与室内'),
      item('complete', '雨夜街景', '城市夜景，雨后街道与霓虹反光', '风景'),
    ], '城市 夜景', 4)

    expect(result[0]?.id).toBe('complete')
  })

  it('uses stable tie breakers independent of input order', () => {
    const first = item('a', '人像 A', 'portrait with soft light A', '人像')
    const second = item('b', '人像 B', 'portrait with soft light B', '人像')

    expect(rankPromptAssets([second, first], 'portrait', 4).map((value) => value.id)).toEqual(['a', 'b'])
    expect(rankPromptAssets([first, second], 'portrait', 4).map((value) => value.id)).toEqual(['a', 'b'])
  })

  it('deduplicates normalized prompt text and prefers favorites on ties', () => {
    const result = rankPromptAssets([
      item('1', '同一提示词', 'A cinematic portrait, soft light.', '人像'),
      item('2', '我的收藏', ' a cinematic portrait, soft light. ', '人像', true),
    ], 'portrait', 4)
    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe('2')
  })

  it('deduplicates prompt text when punctuation only changes whitespace', () => {
    const result = rankPromptAssets([
      item('1', '英文肖像', 'A cinematic portrait, soft light.', '人像'),
      item('2', '英文肖像副本', 'A cinematic portrait soft light', '人像', true),
    ], 'portrait', 4)

    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe('2')
  })

  it('uses the main-process FTS index for Chinese n-grams, synonyms and weighted fields', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'latent-prompt-search-'))
    const database = await createNodeSqliteDatabase(join(directory, 'global.db'))
    initializeGlobalDatabase(database)
    const store = new GlobalPromptStore(database)
    await store.save({ name: '棚拍肖像', content: '柔和侧光，85mm 镜头，人物特写', scope: 'global', category: '人像', collection: '个人', favorite: true })
    await store.save({ name: '城市夜景', content: '雨夜霓虹街道摄影', scope: 'global', category: '风景', collection: '仓库' })
    const service = new PromptSearchService({ database, listGlobalPrompts: () => store.list({ scope: 'global' }) })

    const results = await service.search({ query: '人物摄影', limit: 4 })

    expect(results[0]).toMatchObject({ title: '棚拍肖像', category: '人像', retrievalMode: 'lexical' })
    expect(results[0]?.score).toBeGreaterThan(0.5)
    expect(results[0]?.reason).toMatch(/人像|肖像|摄影/)
    database.close?.()
    await rm(directory, { recursive: true, force: true })
  })

  it('reuses the persistent lexical index without loading every prompt again', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'latent-prompt-lexical-'))
    const database = await createNodeSqliteDatabase(join(directory, 'global.db'))
    initializeGlobalDatabase(database)
    const store = new GlobalPromptStore(database)
    await store.save({ name: '棚拍肖像', content: '柔和侧光，85mm 镜头，人物特写', scope: 'global', category: '人像', collection: '个人' })
    const service = new PromptSearchService({ database, listGlobalPrompts: () => store.list({ scope: 'global' }) })

    const first = await service.search({ query: '人物摄影', limit: 4 })
    const reopened = new PromptSearchService({
      database,
      listGlobalPrompts: async () => { throw new Error('持久索引不应重新读取全部提示词') },
    })
    const second = await reopened.search({ query: '棚拍人像', limit: 4 })

    expect(first[0]).toMatchObject({ title: '棚拍肖像', retrievalMode: 'lexical' })
    expect(second[0]).toMatchObject({ title: '棚拍肖像', retrievalMode: 'lexical' })
    database.close?.()
    await rm(directory, { recursive: true, force: true })
  })

  it('keeps the event loop responsive while upgrading a large lexical index', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeGlobalDatabase(database)
    const store = new GlobalPromptStore(database)
    for (let index = 0; index < 100; index += 1) {
      await store.save({ name: `影棚人像 ${index}`, content: `电影感人物摄影 ${index}`, scope: 'global', category: '人像', collection: '测试' })
    }
    database.run("INSERT INTO schema_meta (key,value) VALUES ('prompt_search_lexical_version','outdated') ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    const responsiveDatabase = {
      exec: database.exec.bind(database),
      all: database.all.bind(database),
      close: database.close?.bind(database),
      run(sql: string, ...params: unknown[]) {
        if (sql.startsWith('INSERT INTO prompt_search_fts')) {
          const deadline = performance.now() + 1
          while (performance.now() < deadline) { /* simulate a large on-disk index write */ }
        }
        return database.run(sql, ...params)
      },
    } as unknown as GlobalDatabase
    const service = new PromptSearchService({ database: responsiveDatabase, listGlobalPrompts: () => store.list({ scope: 'global' }) })
    let heartbeats = 0
    const timer = setInterval(() => { heartbeats += 1 }, 0)

    await service.search({ query: '影棚人像', limit: 4 })
    clearInterval(timer)

    expect(heartbeats).toBeGreaterThanOrEqual(3)
    database.close?.()
  })

  it('keeps the persistent FTS compact while returning the complete prompt', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeGlobalDatabase(database)
    const store = new GlobalPromptStore(database)
    const content = `角色三视图，保持服装与比例一致。${'完整提示词内容。'.repeat(600)}`
    await store.save({ name: '角色三视图', content, scope: 'global', category: '角色设计', collection: '个人' })
    const service = new PromptSearchService({ database, listGlobalPrompts: () => store.list({ scope: 'global' }) })

    const results = await service.search({ query: '角色三视图', limit: 4 })
    const schema = database.all<{ sql: string }>("SELECT sql FROM sqlite_master WHERE name = 'prompt_search_fts'")[0]?.sql ?? ''
    const stored = database.all<{ content: string }>('SELECT content FROM prompt_search_documents')[0]?.content ?? ''

    expect(results[0]?.content).toBe(content)
    expect(stored.length).toBeLessThanOrEqual(512)
    expect(schema).toContain("content=''")
    expect(schema).toContain('contentless_delete=1')
    database.close?.()
  })

  it('keeps the persistent lexical index current after prompt writes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'latent-prompt-incremental-'))
    const database = await createNodeSqliteDatabase(join(directory, 'global.db'))
    initializeGlobalDatabase(database)
    const store = new GlobalPromptStore(database)
    await store.save({ name: '城市夜景', content: '雨夜霓虹街道', scope: 'global', category: '风景', collection: '个人' })
    const first = new PromptSearchService({ database, listGlobalPrompts: () => store.list({ scope: 'global' }) })
    await expect(first.search({ query: '霓虹', limit: 4 })).resolves.toHaveLength(1)

    const added = await store.save({ name: '商品摄影', content: '暖白色背景上的玻璃香水瓶', scope: 'global', category: '产品', collection: '个人' })
    const reopened = () => new PromptSearchService({
      database,
      listGlobalPrompts: async () => { throw new Error('增量索引不应重新读取全部提示词') },
    })
    await expect(reopened().search({ query: '香水瓶', limit: 4 })).resolves.toEqual([
      expect.objectContaining({ id: added.id, title: '商品摄影' }),
    ])

    await store.update({ id: added.id, scope: 'global', content: '深红色背景上的玻璃香水瓶' })
    await expect(reopened().search({ query: '深红色', limit: 4 })).resolves.toEqual([
      expect.objectContaining({ id: added.id }),
    ])

    await store.remove({ id: added.id, scope: 'global' })
    await expect(reopened().search({ query: '香水瓶', limit: 4 })).resolves.toEqual([])
    database.close?.()
    await rm(directory, { recursive: true, force: true })
  })

  it('uses a healthy local embedding provider for hybrid search and falls back after clearing it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'latent-prompt-vector-'))
    const database = await createNodeSqliteDatabase(join(directory, 'global.db'))
    initializeGlobalDatabase(database)
    const store = new GlobalPromptStore(database)
    await store.save({ name: '旅行纪念徽章', content: '把旅行照片制作成珐琅徽章', scope: 'global', category: '产品', collection: '个人' })
    let failEmbeddingQuery = false
    const embed = vi.fn(async (texts: readonly string[]) => {
      if (failEmbeddingQuery) throw new Error('model file is damaged')
      return texts.map((text) => text.includes('徽章') || text.includes('纪念品') ? [1, 0, 0] : [0, 1, 0])
    })
    const provider: EmbeddingProvider = {
      descriptor: { modelId: 'test-embedding', version: '1', sourceUrl: 'https://example.com/model', license: 'Apache-2.0', dimensions: 3 },
      install: async () => ({ installPath: join(directory, 'model'), diskBytes: 128 }),
      isInstalled: async () => true,
      embed,
      uninstall: async () => {},
    }
    const service = new PromptSearchService({ database, listGlobalPrompts: () => store.list({ scope: 'global' }), embeddingProvider: provider })

    await service.installEmbeddingModel()
    await service.updateEmbeddings()
    const hybrid = await service.search({ query: '旅行纪念品', limit: 4 })
    expect(hybrid[0]).toMatchObject({ title: '旅行纪念徽章', retrievalMode: 'hybrid', embeddingModel: 'test-embedding' })
    expect((await service.embeddingStatus()).indexedCount).toBe(1)

    embed.mockClear()
    await expect(service.updateEmbeddings()).resolves.toMatchObject({ status: 'ready', retrievalMode: 'hybrid', indexedCount: 1, pendingCount: 0 })
    expect(embed).not.toHaveBeenCalled()

    const invalidLimit = await service.search({ query: '旅行徽章', limit: Number.NaN })
    expect(invalidLimit).toHaveLength(1)

    failEmbeddingQuery = true
    const degraded = await service.search({ query: '旅行徽章', limit: 4 })
    expect(degraded[0]).toMatchObject({ retrievalMode: 'lexical', fallbackReason: 'local_embedding_error' })
    await expect(service.embeddingStatus()).resolves.toMatchObject({ status: 'failed', retrievalMode: 'lexical', lastError: 'model file is damaged' })

    await service.clearEmbeddings()
    const lexical = await service.search({ query: '旅行徽章', limit: 4 })
    expect(lexical[0]).toMatchObject({ retrievalMode: 'lexical', fallbackReason: 'local_embedding_unavailable' })
    database.close?.()
    await rm(directory, { recursive: true, force: true })
  })

  it('keeps current-project prompts in hybrid search results', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'latent-prompt-project-hybrid-'))
    const database = await createNodeSqliteDatabase(join(directory, 'global.db'))
    initializeGlobalDatabase(database)
    const store = new GlobalPromptStore(database)
    await store.save({ name: '全局静物', content: 'A studio still life photograph.', scope: 'global', category: '摄影', collection: '个人' })
    const projectPrompt = { ...item('project-watercolor', '项目水墨飞船', '项目专属水墨飞船概念图', '插画'), scope: 'project' as const }
    const provider: EmbeddingProvider = {
      descriptor: { modelId: 'project-hybrid', version: '1', sourceUrl: 'https://example.com/model', license: 'Apache-2.0', dimensions: 2 },
      install: async () => ({ installPath: join(directory, 'model'), diskBytes: 64 }),
      isInstalled: async () => true,
      embed: async (texts) => texts.map(() => [1, 0]),
      uninstall: async () => {},
    }
    const service = new PromptSearchService({
      database,
      listGlobalPrompts: () => store.list({ scope: 'global' }),
      listProjectPrompts: async () => [projectPrompt],
      embeddingProvider: provider,
    })

    await service.installEmbeddingModel()
    await service.updateEmbeddings()
    await expect(service.search({ query: '水墨飞船', limit: 4 })).resolves.toEqual([
      expect.objectContaining({ id: 'project-watercolor', retrievalMode: 'hybrid' }),
      expect.objectContaining({ title: '全局静物', retrievalMode: 'hybrid' }),
    ])

    database.close?.()
    await rm(directory, { recursive: true, force: true })
  })

  it('indexes bilingual translations without replacing the executable prompt', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeGlobalDatabase(database)
    const store = new GlobalPromptStore(database)
    const saved = await store.save({
      name: '人像 · 夜景',
      content: 'A photorealistic nighttime portrait.',
      scope: 'global',
      category: '人像',
      collection: 'NanmiCoder Open Image Prompts',
      primaryLocale: 'en',
      translations: { 'zh-CN': '一张照片般逼真的夜景人像。' },
    })
    const service = new PromptSearchService({ database, listGlobalPrompts: () => store.list({ scope: 'global' }) })

    const [result] = await service.search({ query: '逼真夜景人像', limit: 4 })

    expect(result).toMatchObject({ id: saved.id, content: 'A photorealistic nighttime portrait.' })
    await expect(store.get({ id: saved.id, scope: 'global' })).resolves.toMatchObject({
      primaryLocale: 'en',
      translations: { 'zh-CN': '一张照片般逼真的夜景人像。' },
    })
    database.close?.()
  })

  it('switches retrieval mode across install, indexing, and uninstall', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'latent-prompt-vector-lifecycle-'))
    const database = await createNodeSqliteDatabase(join(directory, 'global.db'))
    initializeGlobalDatabase(database)
    const store = new GlobalPromptStore(database)
    await store.save({ name: '城市夜景', content: '雨夜霓虹街道摄影', scope: 'global', category: '风景', collection: '个人' })
    let installed = false
    const embed = vi.fn(async (texts: readonly string[]) => texts.map(() => [1, 0, 0]))
    const provider: EmbeddingProvider = {
      descriptor: { modelId: 'lifecycle-embedding', version: '1', sourceUrl: 'https://example.com/model', license: 'Apache-2.0', dimensions: 3 },
      install: async () => { installed = true; return { installPath: join(directory, 'model'), diskBytes: 128 } },
      isInstalled: async () => installed,
      embed,
      uninstall: async () => { installed = false },
    }
    const service = new PromptSearchService({ database, listGlobalPrompts: () => store.list({ scope: 'global' }), embeddingProvider: provider })

    await expect(service.embeddingStatus()).resolves.toMatchObject({ status: 'not-installed', retrievalMode: 'lexical', indexedCount: 0 })
    await expect(service.search({ query: '夜景', limit: 4 })).resolves.toEqual([expect.objectContaining({ retrievalMode: 'lexical', fallbackReason: 'local_embedding_unavailable' })])

    await expect(service.installEmbeddingModel()).resolves.toMatchObject({ status: 'installed', retrievalMode: 'lexical', indexedCount: 0, pendingCount: 1 })
    await expect(service.updateEmbeddings()).resolves.toMatchObject({ status: 'ready', retrievalMode: 'hybrid', indexedCount: 1, pendingCount: 0 })
    await expect(service.search({ query: '夜景', limit: 4 })).resolves.toEqual([expect.objectContaining({ retrievalMode: 'hybrid', embeddingModel: 'lifecycle-embedding' })])

    await expect(service.uninstallEmbeddingModel()).resolves.toMatchObject({ status: 'not-installed', retrievalMode: 'lexical', indexedCount: 0, totalCount: 1 })
    embed.mockClear()
    await expect(service.search({ query: '夜景', limit: 4 })).resolves.toEqual([expect.objectContaining({ retrievalMode: 'lexical', fallbackReason: 'local_embedding_unavailable' })])
    expect(embed).not.toHaveBeenCalled()

    database.close?.()
    await rm(directory, { recursive: true, force: true })
  })
})
