import { promises as fs } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { createNodeSqliteDatabase, initializeGlobalDatabase } from '../../src/main/config'
import { GlobalMemoryStore, GlobalPromptStore, LibraryError, ProjectMemoryStore, ProjectPromptStore } from '../../src/main/library'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function projectRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'latent-library-'))
  roots.push(root)
  await fs.mkdir(join(root, '.latent-studio'), { recursive: true })
  return root
}

describe('global content stores', () => {
  it('indexes prompt names used by paged version lookup', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeGlobalDatabase(database)
    try {
      const indexes = database.all<{ name: string }>("PRAGMA index_list('global_prompts')")
      expect(indexes.map((index) => index.name)).toContain('idx_global_prompts_name')
    } finally {
      database.close?.()
    }
  })

  it('quick-saves same-named prompts as versions without overwriting content', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeGlobalDatabase(database)
    try {
      const store = new GlobalPromptStore(database)
      const first = await store.quickSave({ scope: 'global', name: '电影感', content: 'wide shot' })
      const second = await store.quickSave({ scope: 'global', name: '电影感', content: 'close-up', kind: 'style', tags: ['夜景'] })

      expect(first.version).toBe(1)
      expect(second.version).toBe(2)
      await expect(store.list({ scope: 'global' })).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ id: first.id, content: 'wide shot', kind: 'prompt', version: 1 }),
        expect.objectContaining({ id: second.id, content: 'close-up', kind: 'style', tags: ['夜景'], version: 2 }),
      ]))
      expect(database.all<{ content: string }>('SELECT content FROM global_prompts WHERE id = ?', first.id)[0].content).toBe('wide shot')
    } finally {
      database.close?.()
    }
  })

  it('updates a personal global prompt without changing its stable id or version', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeGlobalDatabase(database)
    try {
      const store = new GlobalPromptStore(database)
      const saved = await store.save({ scope: 'global', name: '产品摄影', content: '白色背景', category: '商品' })
      const updated = await store.update({ scope: 'global', id: saved.id, name: '高级产品摄影', content: '暖白色背景，柔光', favorite: true })

      expect(updated).toMatchObject({ id: saved.id, version: saved.version, name: '高级产品摄影', content: '暖白色背景，柔光', favorite: true, category: '商品' })
      await expect(store.list({ scope: 'global' })).resolves.toHaveLength(1)
    } finally {
      database.close?.()
    }
  })

  it('pages global prompts without returning the complete library', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeGlobalDatabase(database)
    try {
      const store = new GlobalPromptStore(database)
      for (let index = 0; index < 75; index += 1) {
        await store.save({
          scope: 'global',
          name: `分页提示词 ${String(index).padStart(2, '0')}`,
          content: index === 42 ? '唯一检索词 needle' : `测试内容 ${index}`,
          category: index % 2 === 0 ? '人像' : '风景',
          collection: '个人',
        })
      }

      await expect(store.listPage({ scope: 'global', offset: 20, limit: 10 })).resolves.toMatchObject({
        total: 75,
        offset: 20,
        limit: 10,
        hasMore: true,
        items: expect.any(Array),
      })
      expect((await store.listPage({ scope: 'global', offset: 20, limit: 10 })).items).toHaveLength(10)
      await expect(store.listPage({ scope: 'global', search: 'needle', offset: 0, limit: 60 })).resolves.toMatchObject({
        total: 1,
        hasMore: false,
        items: [expect.objectContaining({ content: '唯一检索词 needle' })],
      })
    } finally {
      database.close?.()
    }
  })

  it('keeps personal prompts first and imported prompts with previews ahead of text-only imports', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeGlobalDatabase(database)
    try {
      const store = new GlobalPromptStore(database)
      await store.save({ scope: 'global', name: '有图仓库提示词', content: 'Preview', source: 'import', collection: '仓库', previewUrl: 'https://example.com/preview.jpg' })
      await store.save({ scope: 'global', name: '无图仓库提示词', content: 'Text only', source: 'import', collection: '仓库' })
      await store.save({ scope: 'global', name: '我的提示词', content: 'Personal prompt', source: 'manual', collection: '个人' })

      const page = await store.listPage({ scope: 'global', offset: 0, limit: 10 })
      expect(page.items.map((item) => item.name)).toEqual(['我的提示词', '有图仓库提示词', '无图仓库提示词'])
    } finally {
      database.close?.()
    }
  })

  it('persists global memory state and supports explicit edits', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeGlobalDatabase(database)
    try {
      const store = new GlobalMemoryStore(database)
      const saved = await store.save({ scope: 'global', title: '画面比例', content: '默认使用 16:9', category: 'aspect-ratio', active: false, source: '用户明确要求' })
      expect(saved.active).toBe(false)
      expect(saved.category).toBe('aspect-ratio')
      expect(await store.list({ scope: 'global', activeOnly: true })).toEqual([])
      const updated = await store.update({ scope: 'global', id: saved.id, active: true, content: '默认使用 2.39:1' })
      expect(updated).toMatchObject({ id: saved.id, content: '默认使用 2.39:1', active: true })
      await expect(store.get({ scope: 'global', id: saved.id })).resolves.toMatchObject({ title: '画面比例', category: 'aspect-ratio' })
      await store.remove({ scope: 'global', id: saved.id })
      await expect(store.get({ scope: 'global', id: saved.id })).resolves.toBeNull()
      await expect(store.remove({ scope: 'global', id: saved.id })).rejects.toMatchObject({ code: 'not-found' })
    } finally {
      database.close?.()
    }
  })

  it('rejects project-scoped writes at the global boundary', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeGlobalDatabase(database)
    try {
      const store = new GlobalPromptStore(database)
      await expect(store.save({ scope: 'project', projectRoot: '/tmp/project', name: 'x', content: 'y' })).rejects.toMatchObject({ code: 'invalid-scope' })
    } finally {
      database.close?.()
    }
  })
})

describe('project content stores', () => {
  it('keeps project prompt versions after reopening the store', async () => {
    const root = await projectRoot()
    const firstStore = new ProjectPromptStore()
    const first = await firstStore.quickSave({ scope: 'project', projectRoot: root, name: '角色设定', content: '林默，左眉有疤' })
    const second = await firstStore.quickSave({ scope: 'project', projectRoot: root, name: '角色设定', content: '林默，左眉有一道短疤' })
    expect([first.version, second.version]).toEqual([1, 2])

    const reopened = new ProjectPromptStore()
    await expect(reopened.list({ scope: 'project', projectRoot: root })).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: '角色设定', content: first.content, version: 1 }),
      expect.objectContaining({ name: '角色设定', content: second.content, version: 2 }),
    ]))
    await reopened.remove({ scope: 'project', projectRoot: root, id: first.id })
    await expect(reopened.get({ scope: 'project', projectRoot: root, id: first.id })).resolves.toBeNull()
  })

  it('preserves prompt collection and category after reopening the project store', async () => {
    const root = await projectRoot()
    const firstStore = new ProjectPromptStore()
    const saved = await firstStore.save({
      scope: 'project',
      projectRoot: root,
      name: '人像测试',
      content: '电影感环境人像',
      collection: '个人',
      category: '人像',
    })

    const reopened = new ProjectPromptStore()
    await expect(reopened.get({ scope: 'project', projectRoot: root, id: saved.id })).resolves.toMatchObject({
      collection: '个人',
      category: '人像',
    })
  })

  it('updates a project prompt in place while preserving unspecified metadata', async () => {
    const root = await projectRoot()
    const store = new ProjectPromptStore()
    const saved = await store.save({ scope: 'project', projectRoot: root, name: '角色海报', content: '中景角色海报', tags: ['人像'], collection: '个人', category: '人像' })
    const updated = await store.update({ scope: 'project', projectRoot: root, id: saved.id, content: '低机位中景角色海报' })

    expect(updated).toMatchObject({ id: saved.id, version: saved.version, content: '低机位中景角色海报', tags: ['人像'], collection: '个人', category: '人像' })
    await expect(new ProjectPromptStore().list({ scope: 'project', projectRoot: root })).resolves.toHaveLength(1)
  })

  it('updates and filters project memories without silently replacing another version', async () => {
    const root = await projectRoot()
    const store = new ProjectMemoryStore()
    const first = await store.save({ scope: 'project', projectRoot: root, title: '色彩', content: '低饱和', category: 'color-palette', source: '项目规则' })
    const second = await store.save({ scope: 'project', projectRoot: root, title: '色彩', content: '低饱和但保留红色重点', active: false })
    expect(second.version).toBe(2)
    await expect(store.list({ scope: 'project', projectRoot: root, activeOnly: true })).resolves.toEqual([expect.objectContaining({ id: first.id, category: 'color-palette' })])
    await expect(store.update({ scope: 'project', projectRoot: root, id: first.id, active: false })).resolves.toMatchObject({ active: false })
    await expect(store.list({ scope: 'project', projectRoot: root, search: '红色' })).resolves.toEqual([expect.objectContaining({ id: second.id })])
  })

  it('rejects invalid project roots and corrupt content files', async () => {
    const store = new ProjectPromptStore()
    await expect(store.list({ scope: 'project', projectRoot: '/' })).rejects.toMatchObject({ code: 'invalid-project-root' })
    const root = await projectRoot()
    await fs.writeFile(join(root, '.latent-studio', 'prompt-library.json'), '{bad', 'utf8')
    await expect(store.list({ scope: 'project', projectRoot: root })).rejects.toMatchObject({ code: 'corrupt-library' })
    expect(new LibraryError('invalid-input', 'x')).toBeInstanceOf(Error)
  })
})
