import { describe, expect, it } from 'vitest'
import { createNodeSqliteDatabase, initializeGlobalDatabase } from '../../src/main/config'
import { MAX_RECENT_PROJECTS, SqliteRecentProjectsStore } from '../../src/main/projects/recent'

describe('sqlite recent projects', () => {
  it('keeps recent projects in the global database and bounds the list', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeGlobalDatabase(database)
    const store = new SqliteRecentProjectsStore(database)
    for (let index = 0; index < MAX_RECENT_PROJECTS + 2; index += 1) {
      await store.add({ id: `p-${index}`, name: `Project ${index}`, path: `/tmp/project-${index}`, openedAt: new Date(index).toISOString() })
    }
    await expect(store.list()).resolves.toHaveLength(MAX_RECENT_PROJECTS)
    await store.add({ id: 'p-last', name: 'Last', path: '/tmp/project-last', openedAt: new Date(Date.now() + 1000).toISOString() })
    await expect(store.list()).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: 'p-last' })]))
    await store.remove('/tmp/project-last')
    await expect(store.list()).resolves.not.toEqual(expect.arrayContaining([expect.objectContaining({ id: 'p-last' })]))
    database.close?.()
  })
})
