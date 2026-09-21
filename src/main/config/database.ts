export interface GlobalDatabase {
  exec(sql: string): void
  run(sql: string, ...parameters: SqlValue[]): void
  all<T>(sql: string, ...parameters: SqlValue[]): T[]
  close?(): void
}

export type SqlValue = string | number | bigint | Uint8Array | null

export type GlobalDatabaseFactory = (databasePath: string) => GlobalDatabase | Promise<GlobalDatabase>

export const PROMPT_SEARCH_FTS_SCHEMA = `
  CREATE VIRTUAL TABLE IF NOT EXISTS prompt_search_fts USING fts5(
    title,
    category,
    collection_name,
    tags,
    content,
    cjk_terms,
    content='',
    contentless_delete=1,
    tokenize = 'unicode61 remove_diacritics 2'
  );
`

export const GLOBAL_SCHEMA = `
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS schema_meta (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );
  INSERT OR IGNORE INTO schema_meta (key, value) VALUES ('version', '6');
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS provider_groups (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    provider_type TEXT NOT NULL,
    base_url TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS provider_connections (
    id TEXT PRIMARY KEY NOT NULL,
    group_id TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    provider_type TEXT NOT NULL,
    base_url TEXT NOT NULL,
    encrypted_api_key TEXT,
    max_concurrency INTEGER NOT NULL DEFAULT 1,
    group_name TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS model_profiles (
    id TEXT PRIMARY KEY NOT NULL,
    connection_id TEXT NOT NULL REFERENCES provider_connections(id) ON DELETE CASCADE,
    model_id TEXT NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'text',
    capabilities_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (connection_id, model_id)
  );
  CREATE TABLE IF NOT EXISTS global_prompts (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_global_prompts_name ON global_prompts(name);
  CREATE TABLE IF NOT EXISTS memory_entries (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS skill_installations (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    source TEXT NOT NULL,
    version TEXT,
    installed_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS recent_projects (
    project_id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    opened_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS quick_prompts (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    prompt TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT,
    source_prompt_id TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS prompt_catalog_sources (
    id TEXT PRIMARY KEY NOT NULL,
    display_name TEXT NOT NULL,
    repository_url TEXT NOT NULL,
    adapter_id TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_success_version TEXT,
    last_success_at TEXT,
    last_error_code TEXT,
    last_error_message TEXT
  );
  CREATE TABLE IF NOT EXISTS prompt_catalog_sync_runs (
    id TEXT PRIMARY KEY NOT NULL,
    source_id TEXT NOT NULL,
    status TEXT NOT NULL,
    records_seen INTEGER NOT NULL DEFAULT 0,
    records_added INTEGER NOT NULL DEFAULT 0,
    records_updated INTEGER NOT NULL DEFAULT 0,
    records_removed INTEGER NOT NULL DEFAULT 0,
    records_skipped INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    error_code TEXT,
    error_message TEXT
  );
  CREATE TABLE IF NOT EXISTS prompt_catalog_checkpoints (
    source_id TEXT PRIMARY KEY NOT NULL,
    remote_version TEXT,
    etag TEXT,
    last_modified TEXT,
    cursor_json TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS prompt_search_documents (
    prompt_id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    category TEXT NOT NULL,
    collection_name TEXT NOT NULL,
    tags TEXT NOT NULL,
    favorite INTEGER NOT NULL DEFAULT 0,
    kind TEXT NOT NULL,
    preview_url TEXT,
    source_url TEXT,
    content_hash TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  ${PROMPT_SEARCH_FTS_SCHEMA}
  CREATE TABLE IF NOT EXISTS embedding_models (
    model_id TEXT PRIMARY KEY NOT NULL,
    version TEXT NOT NULL,
    source_url TEXT NOT NULL,
    license TEXT,
    install_path TEXT NOT NULL DEFAULT '',
    disk_bytes INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 0,
    installed_at TEXT,
    last_health_check_at TEXT,
    last_error TEXT
  );
  CREATE TABLE IF NOT EXISTS prompt_embeddings (
    item_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    model_version TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    dimensions INTEGER NOT NULL,
    dtype TEXT NOT NULL,
    vector_blob BLOB NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (item_id, model_id, model_version)
  );
  CREATE TABLE IF NOT EXISTS embedding_index_runs (
    id TEXT PRIMARY KEY NOT NULL,
    model_id TEXT NOT NULL,
    model_version TEXT NOT NULL,
    operation TEXT NOT NULL,
    status TEXT NOT NULL,
    queued_count INTEGER NOT NULL,
    processed_count INTEGER NOT NULL,
    failed_count INTEGER NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    error_message TEXT
  );
`

/** Loads Electron's built-in SQLite lazily so importing this module is safe in tests. */
export async function createNodeSqliteDatabase(databasePath: string): Promise<GlobalDatabase> {
  const sqlite = await import('node:sqlite')
  const database = new sqlite.DatabaseSync(databasePath)
  return {
    exec: (sql) => database.exec(sql),
    run: (sql, ...parameters) => { database.prepare(sql).run(...parameters) },
    all: <T>(sql: string, ...parameters: SqlValue[]) => database.prepare(sql).all(...parameters) as T[],
    close: () => database.close(),
  }
}

export function initializeGlobalDatabase(database: GlobalDatabase): void {
  database.exec(GLOBAL_SCHEMA)
  const connectionColumns = database.all<{ name: string }>('PRAGMA table_info(provider_connections)')
  if (!connectionColumns.some((column) => column.name === 'group_id')) {
    database.exec("ALTER TABLE provider_connections ADD COLUMN group_id TEXT DEFAULT ''")
  }
  if (!connectionColumns.some((column) => column.name === 'group_name')) {
    database.exec("ALTER TABLE provider_connections ADD COLUMN group_name TEXT DEFAULT ''")
  }

  // Automatic migration for connections with missing or empty group_id:
  const connectionsWithoutGroup = database.all<{
    id: string
    name: string
    provider_type: string
    base_url: string
    group_id?: string
    group_name?: string
  }>("SELECT id, name, provider_type, base_url, group_id, group_name FROM provider_connections WHERE group_id IS NULL OR group_id = ''")

  if (connectionsWithoutGroup && connectionsWithoutGroup.length > 0) {
    const existingGroups = database.all<{ id: string; name: string; provider_type: string; base_url: string }>('SELECT id, name, provider_type, base_url FROM provider_groups')
    const now = new Date().toISOString()

    for (const conn of connectionsWithoutGroup) {
      if (!conn.id || !conn.provider_type) continue
      const groupName = conn.group_name?.trim() || conn.name?.trim() || conn.provider_type
      let matchedGroup = existingGroups.find((g) => g.name === groupName && g.provider_type === conn.provider_type)
      if (!matchedGroup) {
        const newGroupId = `group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        database.run(
          'INSERT INTO provider_groups (id, name, provider_type, base_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
          newGroupId,
          groupName,
          conn.provider_type,
          conn.base_url,
          now,
          now
        )
        matchedGroup = { id: newGroupId, name: groupName, provider_type: conn.provider_type, base_url: conn.base_url }
        existingGroups.push(matchedGroup)
      }
      database.run('UPDATE provider_connections SET group_id = ? WHERE id = ?', matchedGroup.id, conn.id)
    }
  }

  const modelColumns = database.all<{ name: string }>('PRAGMA table_info(model_profiles)')
  if (!modelColumns.some((column) => column.name === 'kind')) {
    database.exec("ALTER TABLE model_profiles ADD COLUMN kind TEXT NOT NULL DEFAULT 'text'")
    database.run("INSERT INTO schema_meta (key, value) VALUES ('version', '3') ON CONFLICT(key) DO UPDATE SET value = excluded.value")
  }
  database.run("INSERT INTO schema_meta (key, value) VALUES ('version', '6') ON CONFLICT(key) DO UPDATE SET value = excluded.value")
}

export async function openGlobalDatabase(databasePath: string, databaseFactory: GlobalDatabaseFactory = createNodeSqliteDatabase): Promise<GlobalDatabase> {
  const database = await databaseFactory(databasePath)
  initializeGlobalDatabase(database)
  return database
}

export const createGlobalDatabase = openGlobalDatabase
