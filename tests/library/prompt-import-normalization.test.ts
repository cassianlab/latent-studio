import { describe, expect, it } from 'vitest'
import { createNodeSqliteDatabase, initializeGlobalDatabase } from '../../src/main/config/database'
import { GlobalPromptStore } from '../../src/main/library/global'
import { migrateLegacyPromptImports, migrateLegacyNanmiPromptImports, normalizeNanmiPromptRecord } from '../../src/main/library/prompt-import-normalization'

describe('NanmiCoder prompt normalization', () => {
  it('uses taxonomy for a short title and preserves both prompt languages', () => {
    const prompt = normalizeNanmiPromptRecord({
      tweet_id: '19001',
      author: 'creator',
      tool: 'GPT Image 2',
      prompt_text: 'A photorealistic nighttime street-fashion portrait of a young woman holding a compact camera.',
      translated_text: '一张照片般逼真的夜景街头时尚人像照片，一位年轻女子站在城市人行道上，双手握着一台小型数码相机，仿佛正在拍照。',
      labels: 'subject=portrait=人像|setting=street=街头|lighting=night=夜景',
      tweet_url: 'https://x.com/creator/status/19001',
      preview_url: 'https://pbs.twimg.com/media/example.jpg',
    }, {
      tag: 'nanimicoder-open-image-prompts',
      collection: 'NanmiCoder Open Image Prompts',
      repositoryUrl: 'https://github.com/NanmiCoder/open-image-prompts',
    })

    expect(prompt?.name).toBe('人像 · 街头 · 夜景')
    expect(prompt?.name.length).toBeLessThanOrEqual(40)
    expect(prompt?.content).toBe('A photorealistic nighttime street-fashion portrait of a young woman holding a compact camera.')
    expect(prompt?.primaryLocale).toBe('en')
    expect(prompt?.translations).toEqual({
      'zh-CN': '一张照片般逼真的夜景街头时尚人像照片，一位年轻女子站在城市人行道上，双手握着一台小型数码相机，仿佛正在拍照。',
    })
    expect(prompt?.tags).toEqual(expect.arrayContaining([expect.stringMatching(/^source-id:[a-f0-9]{24}$/)]))
    expect(prompt?.tags.every((tag) => tag.length <= 40)).toBe(true)
  })

  it('falls back to category, tool and source id when taxonomy is absent', () => {
    const prompt = normalizeNanmiPromptRecord({
      tweet_id: '19002',
      tool: 'Midjourney',
      prompt_text: 'A clean product photograph on a white background.',
      translated_text: '在纯白背景上拍摄干净的产品照片。',
      labels: '',
    }, {
      tag: 'nanimicoder-open-image-prompts',
      collection: 'NanmiCoder Open Image Prompts',
      repositoryUrl: 'https://github.com/NanmiCoder/open-image-prompts',
    })

    expect(prompt?.name).toBe('产品 · Midjourney · 19002')
  })

  it('migrates stored legacy imports to a short title and bilingual content', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeGlobalDatabase(database)
    const translated = '创作一幅富有戏剧感的电影级影棚人像，搭配彩色灯光与氛围烟雾。'
    const envelope = {
      marker: 'latent-studio-prompt-v1',
      content: 'Create a dramatic cinematic studio portrait with colored lighting and atmospheric smoke.',
      kind: 'prompt',
      tags: ['nanimicoder-open-image-prompts', 'Nano Banana', '影棚', '人物肖像', '电影感', 'source-id:9417e0edaa21086e3f3ccb70'],
      favorite: false,
      source: 'import',
      collection: 'NanmiCoder Open Image Prompts',
      category: '人像',
    }
    database.run(
      'INSERT INTO global_prompts (id,name,content,created_at,updated_at) VALUES (?,?,?,?,?)',
      'legacy-nanmi', translated, JSON.stringify(envelope), '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z',
    )

    await expect(migrateLegacyNanmiPromptImports(database)).resolves.toBe(1)
    await expect(new GlobalPromptStore(database).get({ id: 'legacy-nanmi', scope: 'global' })).resolves.toMatchObject({
      id: 'legacy-nanmi',
      name: '影棚 · 人物肖像 · 电影感',
      content: envelope.content,
      primaryLocale: 'en',
      translations: { 'zh-CN': translated },
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(database.all<{ title: string }>('SELECT title FROM prompt_search_documents WHERE prompt_id = ?', 'legacy-nanmi')).toEqual([{ title: '' }])
    await expect(migrateLegacyNanmiPromptImports(database)).resolves.toBe(0)
    database.close?.()
  })

  it('does not rescan a migrated NanmiCoder record without a Chinese translation', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeGlobalDatabase(database)
    database.run(
      'INSERT INTO global_prompts (id,name,content,created_at,updated_at) VALUES (?,?,?,?,?)',
      'legacy-english-only',
      '{ "image_generation": { "subject": "portrait" } }',
      JSON.stringify({
        marker: 'latent-studio-prompt-v1',
        content: '{ "image_generation": { "subject": "portrait" } }',
        kind: 'prompt',
        tags: ['nanimicoder-open-image-prompts', 'Nano Banana', '人物肖像', '影棚光', 'source-id:english-only'],
        favorite: false,
        source: 'import',
        collection: 'NanmiCoder Open Image Prompts',
        category: '人像',
      }),
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    )

    await expect(migrateLegacyNanmiPromptImports(database)).resolves.toBe(1)
    await expect(migrateLegacyNanmiPromptImports(database)).resolves.toBe(0)
    await expect(new GlobalPromptStore(database).get({ id: 'legacy-english-only', scope: 'global' })).resolves.toMatchObject({
      name: '人物肖像 · 影棚光',
      primaryLocale: 'en',
    })
    database.close?.()
  })

  it('repairs a current NanmiCoder import whose oversized source key was discarded', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeGlobalDatabase(database)
    database.run(
      'INSERT INTO global_prompts (id,name,content,created_at,updated_at) VALUES (?,?,?,?,?)',
      'missing-source-key',
      '影棚 · 人物肖像',
      JSON.stringify({
        marker: 'latent-studio-prompt-v1',
        content: 'Create a studio portrait.',
        kind: 'prompt',
        tags: ['nanimicoder-open-image-prompts', 'Nano Banana', '人物肖像'],
        favorite: false,
        source: 'import',
        collection: 'NanmiCoder Open Image Prompts',
        category: '人像',
        primaryLocale: 'en',
        sourceUrl: 'https://x.com/creator/status/19001',
      }),
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    )

    await expect(migrateLegacyPromptImports(database)).resolves.toBe(1)
    const prompt = await new GlobalPromptStore(database).get({ id: 'missing-source-key', scope: 'global' })
    expect(prompt?.tags).toEqual(expect.arrayContaining([expect.stringMatching(/^source-id:[a-f0-9]{24}$/)]))
    await expect(migrateLegacyPromptImports(database)).resolves.toBe(0)
    database.close?.()
  })

  it('adds language metadata to legacy imports from the other repositories', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeGlobalDatabase(database)
    database.run(
      'INSERT INTO global_prompts (id,name,content,created_at,updated_at) VALUES (?,?,?,?,?)',
      'legacy-awesome',
      'Studio portrait',
      JSON.stringify({
        marker: 'latent-studio-prompt-v1',
        content: 'Create a cinematic studio portrait with soft window light.',
        kind: 'prompt',
        tags: ['awesome-gpt-image-2', 'source-id:awesome-gpt-image-2:1'],
        favorite: false,
        source: 'import',
        collection: 'Awesome GPT Image 2',
        category: '人像',
      }),
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    )

    await expect(migrateLegacyPromptImports(database)).resolves.toBe(1)
    await expect(new GlobalPromptStore(database).get({ id: 'legacy-awesome', scope: 'global' })).resolves.toMatchObject({
      name: 'Studio portrait',
      content: 'Create a cinematic studio portrait with soft window light.',
      primaryLocale: 'en',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    await expect(migrateLegacyPromptImports(database)).resolves.toBe(0)
    database.close?.()
  })
})
