import type { ProjectDatabase } from '../projects/database'
import type { AgentSessionPersistence, AgentSessionSnapshot } from './runner'

const AGENT_SCHEMA = `
  CREATE TABLE IF NOT EXISTS agent_sessions (
    id TEXT PRIMARY KEY NOT NULL,
    project_root TEXT NOT NULL,
    status TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS agent_sessions_updated_at ON agent_sessions(updated_at DESC);
`

interface AgentSessionRow {
  id: string
  project_root: string
  status: string
  snapshot_json: string
  updated_at: string
}

const statuses = new Set(['completed', 'awaiting-confirmation', 'failed', 'cancelled'])

function databaseFor(getDatabase: (projectRoot: string) => ProjectDatabase | undefined, projectRoot: string): ProjectDatabase | undefined {
  const database = getDatabase(projectRoot)
  if (!database?.run || !database.all) return undefined
  database.exec(AGENT_SCHEMA)
  return database
}

function parseSnapshot(row: AgentSessionRow, projectRoot: string): AgentSessionSnapshot | undefined {
  if (row.project_root !== projectRoot || !statuses.has(row.status)) return undefined
  try {
    const value = JSON.parse(row.snapshot_json) as AgentSessionSnapshot
    if (!value || value.id !== row.id || value.projectRoot !== projectRoot || !Array.isArray(value.messages) || !Array.isArray(value.steps)) return undefined
    return value
  } catch {
    return undefined
  }
}

export class ProjectAgentStore implements AgentSessionPersistence {
  constructor(private readonly getDatabase: (projectRoot: string) => ProjectDatabase | undefined) {}

  async load(projectRoot: string): Promise<AgentSessionSnapshot[]> {
    const database = databaseFor(this.getDatabase, projectRoot)
    if (!database) return []
    const rows = database.all?.<AgentSessionRow>('SELECT id, project_root, status, snapshot_json, updated_at FROM agent_sessions WHERE project_root = ? ORDER BY updated_at DESC', projectRoot) ?? []
    return rows.flatMap((row) => { const snapshot = parseSnapshot(row, projectRoot); return snapshot ? [snapshot] : [] })
  }

  async save(snapshot: AgentSessionSnapshot): Promise<void> {
    if (!snapshot.projectRoot) return
    const database = databaseFor(this.getDatabase, snapshot.projectRoot)
    if (!database) return
    database.run?.('INSERT INTO agent_sessions (id, project_root, status, snapshot_json, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET project_root = excluded.project_root, status = excluded.status, snapshot_json = excluded.snapshot_json, updated_at = excluded.updated_at', snapshot.id, snapshot.projectRoot, snapshot.status, JSON.stringify(snapshot), snapshot.updatedAt)
  }
}
