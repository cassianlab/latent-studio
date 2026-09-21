export interface ProjectDatabase {
  exec(sql: string): void
  run?: (sql: string, ...parameters: Array<string | number | bigint | Uint8Array | null>) => void
  all?: <T>(sql: string, ...parameters: Array<string | number | bigint | Uint8Array | null>) => T[]
  close?(): void
}

export type DatabaseFactory = (databasePath: string) => ProjectDatabase | Promise<ProjectDatabase>

const PROJECT_SCHEMA = `
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS schema_meta (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );
  INSERT OR IGNORE INTO schema_meta (key, value) VALUES ('version', '2');
  UPDATE schema_meta SET value = '2' WHERE key = 'version';
  CREATE TABLE IF NOT EXISTS workspace_sessions (
    id TEXT PRIMARY KEY NOT NULL,
    payload_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS workspace_state (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );
`

/** Loads Electron 44's built-in SQLite only when a real project is opened. */
export async function createNodeSqliteDatabase(databasePath: string): Promise<ProjectDatabase> {
  const sqlite = await import('node:sqlite')
  const database = new sqlite.DatabaseSync(databasePath)
  return {
    exec: (sql) => database.exec(sql),
    run: (sql, ...parameters) => { database.prepare(sql).run(...parameters) },
    all: <T>(sql: string, ...parameters: Array<string | number | bigint | Uint8Array | null>) => database.prepare(sql).all(...parameters) as T[],
    close: () => database.close(),
  }
}

export function initializeProjectDatabase(database: ProjectDatabase): void {
  database.exec(PROJECT_SCHEMA)
}
