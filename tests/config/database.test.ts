import { describe, expect, it } from 'vitest'
import { GLOBAL_SCHEMA, createNodeSqliteDatabase, initializeGlobalDatabase, openGlobalDatabase, type GlobalDatabase } from '../../src/main/config/database'

describe('global database', () => {
  it('initializes the global schema through the injected database port', () => {
    const calls: string[] = []
    const database: GlobalDatabase = { exec: (sql) => calls.push(sql), run: () => undefined, all: () => [{ name: 'kind' }, { name: 'group_name' }, { name: 'group_id' }] }
    initializeGlobalDatabase(database)
    expect(calls).toEqual([GLOBAL_SCHEMA])
    expect(calls[0]).toContain('CREATE TABLE IF NOT EXISTS provider_connections')
    expect(calls[0]).toContain('CREATE TABLE IF NOT EXISTS recent_projects')
    expect(calls[0]).toContain('CREATE TABLE IF NOT EXISTS quick_prompts')
  })

  it('opens and initializes a database supplied by the factory', async () => {
    const database: GlobalDatabase = { exec: () => undefined, run: () => undefined, all: () => [{ name: 'kind' }, { name: 'group_name' }, { name: 'group_id' }] }
    let path = ''
    await expect(openGlobalDatabase('/tmp/global.db', async (databasePath) => { path = databasePath; return database })).resolves.toBe(database)
    expect(path).toBe('/tmp/global.db')
  })

  it('adds the model kind, group_name and group_id columns to a database created by the previous schema', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    database.exec('CREATE TABLE model_profiles (id TEXT PRIMARY KEY, connection_id TEXT NOT NULL, model_id TEXT NOT NULL, name TEXT NOT NULL, capabilities_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)')
    database.exec('CREATE TABLE provider_connections (id TEXT PRIMARY KEY, name TEXT NOT NULL, provider_type TEXT NOT NULL, base_url TEXT NOT NULL, encrypted_api_key TEXT, max_concurrency INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)')
    database.run("INSERT INTO provider_connections (id, name, provider_type, base_url, created_at, updated_at) VALUES ('legacy-1', '硅基流动', 'openai-compatible', 'https://api.siliconflow.cn/v1', '2026-01-01', '2026-01-01')")
    initializeGlobalDatabase(database)
    const modelCols = database.all<{ name: string }>('PRAGMA table_info(model_profiles)')
    expect(modelCols.some((column) => column.name === 'kind')).toBe(true)
    const connCols = database.all<{ name: string }>('PRAGMA table_info(provider_connections)')
    expect(connCols.some((column) => column.name === 'group_name')).toBe(true)
    expect(connCols.some((column) => column.name === 'group_id')).toBe(true)
    const groups = database.all<{ id: string; name: string }>('SELECT id, name FROM provider_groups')
    expect(groups.length).toBeGreaterThan(0)
    const migratedConn = database.all<{ id: string; group_id: string }>('SELECT id, group_id FROM provider_connections WHERE id = ?', 'legacy-1')[0]
    expect(migratedConn.group_id).toBe(groups[0].id)
    database.close?.()
  })
})
