import { describe, expect, it } from 'vitest'
import { createNodeSqliteDatabase, initializeGlobalDatabase } from '../../src/main/config'
import { GlobalQuickPromptStore } from '../../src/main/library/quick-prompts'
import {
  QUICK_PROMPT_CATEGORIES,
  defaultQuickPrompts,
} from '../../src/shared/quick-prompts'

describe('quick prompt store', () => {
  it('ships substantial editable Chinese inspiration across all six categories', () => {
    const defaults = defaultQuickPrompts()

    expect(new Set(defaults.map((item) => item.category))).toEqual(new Set(QUICK_PROMPT_CATEGORIES.map((item) => item.id)))
    expect(defaults.length).toBeGreaterThanOrEqual(24)
    expect(defaults.every((item) => item.title.trim() && item.prompt.length >= 24)).toBe(true)
    expect(defaults.filter((item) => item.category === 'template').every((item) => item.prompt.includes('【'))).toBe(true)
  })

  it('creates, edits, and deletes prompts in SQLite without restoring deleted defaults', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeGlobalDatabase(database)
    const store = new GlobalQuickPromptStore(database)
    const deleted = (await store.list())[0]

    await store.remove(deleted.id)
    const created = await store.save({ title: '我的雨夜', prompt: '潮湿街道上的人物远景，霓虹反射，保留大量环境信息', category: 'composition' })
    await store.save({ ...created, title: '我的雨夜远景', prompt: '潮湿街道上的人物大远景，地面霓虹反射，主体仅占画面五分之一' })

    const reopened = await new GlobalQuickPromptStore(database).list()
    expect(reopened.some((item) => item.id === deleted.id)).toBe(false)
    expect(reopened).toContainEqual(expect.objectContaining({ id: created.id, title: '我的雨夜远景', category: 'composition' }))
    database.close?.()
  })

  it('imports a prompt-library item with traceable source metadata', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeGlobalDatabase(database)
    const store = new GlobalQuickPromptStore(database)

    const imported = await store.save({
      title: '商业人像',
      prompt: '自然肤质的棚拍人像，柔和主光，干净背景，保留真实面部细节',
      category: 'style',
      sourcePromptId: 'library-prompt-7',
    })

    expect(imported).toMatchObject({ title: '商业人像', category: 'style', sourcePromptId: 'library-prompt-7' })
    await expect(store.list()).resolves.toContainEqual(imported)
    database.close?.()
  })

  it('imports valid legacy items only when SQLite has not been initialized', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeGlobalDatabase(database)
    const store = new GlobalQuickPromptStore(database)
    const legacy = [{ ...defaultQuickPrompts()[0], title: '旧版自定义灵感' }]

    await expect(store.list(legacy)).resolves.toEqual([expect.objectContaining({ title: '旧版自定义灵感' })])
    await store.remove(legacy[0].id)
    await expect(new GlobalQuickPromptStore(database).list(defaultQuickPrompts())).resolves.toEqual([])
    database.close?.()
  })

  it('preserves an intentionally empty legacy collection', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeGlobalDatabase(database)

    await expect(new GlobalQuickPromptStore(database).list([])).resolves.toEqual([])
    database.close?.()
  })
})
