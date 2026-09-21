import type { ConversationLoadIssue, ConversationLoadResult, WorkspaceSession } from '../../shared/contracts/conversations'
import type { ProjectDatabase } from '../projects/database'

const INITIALIZED_KEY = 'sessions-initialized-v1'
const ACTIVE_KEY = 'active-session-id'
const MAX_LEGACY_SESSION_PAYLOAD_BYTES = 8 * 1024 * 1024
const SESSION_CHUNK_BYTES = 512 * 1024
const SESSION_STORE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS workspace_session_records (
    id TEXT PRIMARY KEY NOT NULL,
    message_count INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS workspace_session_chunks (
    session_id TEXT NOT NULL REFERENCES workspace_session_records(id) ON DELETE CASCADE,
    section TEXT NOT NULL,
    item_index INTEGER NOT NULL,
    chunk_index INTEGER NOT NULL,
    payload_blob BLOB NOT NULL,
    byte_length INTEGER NOT NULL,
    PRIMARY KEY (session_id, section, item_index, chunk_index)
  );
  CREATE INDEX IF NOT EXISTS workspace_session_records_updated_at ON workspace_session_records(updated_at DESC);
`
const taskStatuses = new Set(['pending', 'running', 'completed', 'failed', 'cancelled'])
const reasoningEfforts = new Set(['auto', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
const providers = new Set(['openai', 'anthropic', 'gemini', 'deepseek', 'glm', 'kimi', 'openai-compatible'])
const imageErrorCodes = new Set(['auth', 'rate_limit', 'invalid_request', 'not_found', 'server', 'network', 'cancelled', 'parse', 'unknown'])

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function stringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function nonNegativeInteger(value: unknown): value is number {
  return finiteNumber(value) && Number.isInteger(value) && value >= 0
}

function optional(value: unknown, validator: (item: unknown) => boolean): boolean {
  return value === undefined || validator(value)
}

function validJson(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || finiteNumber(value)) return true
  if (Array.isArray(value)) return value.every(validJson)
  const item = record(value)
  return Boolean(item && Object.values(item).every(validJson))
}

function validUsage(value: unknown): boolean {
  const usage = record(value)
  return Boolean(usage
    && optional(usage.inputTokens, nonNegativeInteger)
    && optional(usage.outputTokens, nonNegativeInteger)
    && optional(usage.totalTokens, nonNegativeInteger)
    && optional(usage.reasoningTokens, nonNegativeInteger)
    && optional(usage.contextTokens, nonNegativeInteger))
}

function validSearchResult(value: unknown): boolean {
  const result = record(value)
  return Boolean(result
    && typeof result.title === 'string'
    && typeof result.url === 'string'
    && typeof result.snippet === 'string'
    && typeof result.source === 'string')
}

function validPromptResult(value: unknown): boolean {
  const result = record(value)
  return Boolean(result
    && typeof result.id === 'string' && result.id.trim()
    && typeof result.title === 'string'
    && typeof result.content === 'string'
    && typeof result.category === 'string'
    && ['prompt', 'template', 'style', 'fragment'].includes(String(result.type))
    && finiteNumber(result.score)
    && typeof result.reason === 'string'
    && ['hybrid', 'lexical'].includes(String(result.retrievalMode))
    && optional(result.collection, (item) => typeof item === 'string')
    && optional(result.thumbnailUrl, (item) => typeof item === 'string')
    && optional(result.sourceUrl, (item) => typeof item === 'string')
    && optional(result.embeddingModel, (item) => typeof item === 'string')
    && optional(result.fallbackReason, (item) => typeof item === 'string'))
}

function validAgentStep(value: unknown): boolean {
  const step = record(value)
  return Boolean(step
    && typeof step.id === 'string' && step.id.trim()
    && ['model', 'tool', 'confirmation', 'final'].includes(String(step.kind))
    && typeof step.name === 'string'
    && ['running', 'completed', 'failed', 'cancelled', 'awaiting-confirmation'].includes(String(step.status))
    && typeof step.startedAt === 'string'
    && optional(step.finishedAt, (item) => typeof item === 'string')
    && optional(step.error, (item) => typeof item === 'string')
    && optional(step.input, (item) => Boolean(record(item)) && validJson(item))
    && optional(step.output, validJson))
}

function validArtifact(value: unknown): boolean {
  const artifact = record(value)
  if (!artifact || (artifact.operation !== 'created' && artifact.operation !== 'updated')) return false
  if (artifact.type === 'document') {
    return typeof artifact.relativePath === 'string' && Boolean(artifact.relativePath.trim())
      && typeof artifact.name === 'string' && Boolean(artifact.name.trim())
      && optional(artifact.extension, (item) => typeof item === 'string')
      && optional(artifact.mimeType, (item) => typeof item === 'string')
      && optional(artifact.byteLength, nonNegativeInteger)
      && optional(artifact.modifiedAt, (item) => typeof item === 'string')
  }
  if (artifact.type === 'prompt') {
    return typeof artifact.id === 'string' && Boolean(artifact.id.trim())
      && typeof artifact.name === 'string' && Boolean(artifact.name.trim())
      && (artifact.scope === 'global' || artifact.scope === 'project')
      && optional(artifact.promptKind, (item) => item === 'prompt' || item === 'template' || item === 'style')
      && optional(artifact.collection, (item) => typeof item === 'string')
      && optional(artifact.category, (item) => typeof item === 'string')
  }
  return false
}

function validMessage(value: unknown): boolean {
  const message = record(value)
  if (!message) return false
  if (typeof message.id !== 'string' || !message.id.trim()) return false
  if (message.role !== 'user' && message.role !== 'assistant') return false
  if (typeof message.text !== 'string' || typeof message.createdAt !== 'number' || !Number.isFinite(message.createdAt)) return false
  if (message.pending !== undefined && typeof message.pending !== 'boolean') return false
  if (message.pendingStage !== undefined && message.pendingStage !== 'preparing' && message.pendingStage !== 'compacting' && message.pendingStage !== 'waiting') return false
  if (message.error !== undefined && typeof message.error !== 'string') return false
  if (message.cancelled !== undefined && typeof message.cancelled !== 'boolean') return false
  if (!optional(message.usage, validUsage)) return false
  if (!optional(message.sources, (item) => Array.isArray(item) && item.every(validSearchResult))) return false
  if (!optional(message.promptResults, (item) => Array.isArray(item) && item.length <= 4 && item.every(validPromptResult))) return false
  if (!optional(message.artifacts, (item) => Array.isArray(item) && item.length <= 20 && item.every(validArtifact))) return false
  if (message.reasoningEffort !== undefined && !reasoningEfforts.has(String(message.reasoningEffort))) return false
  if (message.toolContext !== undefined && typeof message.toolContext !== 'string') return false
  if (message.mode !== undefined && message.mode !== 'text' && message.mode !== 'image' && message.mode !== 'agent') return false
  if (message.imageTaskIds !== undefined && !stringArray(message.imageTaskIds)) return false
  if (message.agentSteps !== undefined && (!Array.isArray(message.agentSteps) || !message.agentSteps.every(validAgentStep))) return false
  if (message.activatedSkillIds !== undefined && !stringArray(message.activatedSkillIds)) return false
  return true
}

function validImageReference(value: unknown): boolean {
  const reference = record(value)
  if (!reference) return false
  if ('path' in reference) {
    return typeof reference.path === 'string' && Boolean(reference.path.trim())
      && optional(reference.type, (item) => item === 'file')
      && optional(reference.mimeType, (item) => typeof item === 'string')
      && optional(reference.filename, (item) => typeof item === 'string')
  }
  return optional(reference.type, (item) => item === 'data')
    && optional(reference.data, (item) => typeof item === 'string')
    && optional(reference.base64, (item) => typeof item === 'string')
    && optional(reference.mimeType, (item) => typeof item === 'string')
    && optional(reference.filename, (item) => typeof item === 'string')
}

function validImageRequest(value: unknown): boolean {
  const request = record(value)
  if (!request || typeof request.model !== 'string' || !request.model.trim() || typeof request.prompt !== 'string') return false
  if (request.operation !== undefined && request.operation !== 'generate' && request.operation !== 'edit') return false
  if (!optional(request.size, (item) => typeof item === 'string')
    || !optional(request.outputSize, (item) => typeof item === 'string')
    || !optional(request.quality, (item) => ['auto', 'low', 'medium', 'high', 'xhigh', 'max'].includes(String(item)))
    || !optional(request.background, (item) => ['auto', 'opaque', 'transparent'].includes(String(item)))
    || !optional(request.outputFormat, (item) => ['png', 'jpeg', 'webp'].includes(String(item)))
    || !optional(request.outputCompression, finiteNumber)
    || !optional(request.n, finiteNumber)
    || !optional(request.metadata, (item) => Boolean(record(item)) && validJson(item))
    || !optional(request.mask, validImageReference)) return false
  if (request.operation === 'edit') return Array.isArray(request.references) && request.references.every(validImageReference)
  return optional(request.references, (item) => Array.isArray(item) && item.every(validImageReference))
}

function validImageResult(value: unknown): boolean {
  const result = record(value)
  if (!result) return false
  if (!optional(result.url, (item) => typeof item === 'string')
    || !optional(result.b64Json, (item) => typeof item === 'string')
    || !optional(result.revisedPrompt, (item) => typeof item === 'string')
    || !optional(result.localPath, (item) => typeof item === 'string')
    || !optional(result.mimeType, (item) => typeof item === 'string')
    || !optional(result.byteLength, nonNegativeInteger)
    || !optional(result.width, nonNegativeInteger)
    || !optional(result.height, nonNegativeInteger)) return false
  if (result.normalization === undefined) return true
  const normalization = record(result.normalization)
  return Boolean(normalization
    && typeof normalization.sourceMimeType === 'string'
    && optional(normalization.sourceWidth, nonNegativeInteger)
    && optional(normalization.sourceHeight, nonNegativeInteger))
}

function validImageResponse(value: unknown): boolean {
  const response = record(value)
  return Boolean(response
    && Array.isArray(response.images) && response.images.every(validImageResult)
    && optional(response.id, (item) => typeof item === 'string')
    && optional(response.model, (item) => typeof item === 'string')
    && optional(response.createdAt, (item) => typeof item === 'string'))
}

function validImageError(value: unknown): boolean {
  const error = record(value)
  return Boolean(error
    && imageErrorCodes.has(String(error.code))
    && typeof error.message === 'string'
    && optional(error.provider, (item) => providers.has(String(item)))
    && optional(error.status, finiteNumber)
    && optional(error.retryAfterMs, finiteNumber)
    && optional(error.requestId, (item) => typeof item === 'string'))
}

function validImageTask(value: unknown): boolean {
  const task = record(value)
  return Boolean(task
    && typeof task.id === 'string' && task.id.trim()
    && typeof task.connectionId === 'string' && task.connectionId.trim()
    && validImageRequest(task.request)
    && taskStatuses.has(String(task.status))
    && nonNegativeInteger(task.attempts)
    && nonNegativeInteger(task.maxRetries)
    && typeof task.createdAt === 'string'
    && typeof task.updatedAt === 'string'
    && optional(task.archivedAt, (item) => typeof item === 'string')
    && optional(task.result, validImageResponse)
    && optional(task.error, validImageError))
}

function validResult(value: unknown): boolean {
  const result = record(value)
  if (!result || typeof result.id !== 'string' || !result.id.trim() || typeof result.title !== 'string' || !taskStatuses.has(String(result.status))) return false
  return optional(result.task, validImageTask)
}

function validSkill(value: unknown): boolean {
  const skill = record(value)
  return Boolean(skill
    && typeof skill.id === 'string' && skill.id.trim()
    && typeof skill.name === 'string' && skill.name.trim()
    && typeof skill.displayName === 'string' && skill.displayName.trim()
    && typeof skill.contentHash === 'string' && skill.contentHash.trim()
    && typeof skill.instructions === 'string'
    && (skill.description === undefined || typeof skill.description === 'string')
    && (skill.activatedAtMessageId === undefined || typeof skill.activatedAtMessageId === 'string'))
}

function validPlan(value: unknown): boolean {
  if (value === null) return true
  const plan = record(value)
  if (!plan || (plan.mode !== 'smart' && plan.mode !== 'same') || !stringArray(plan.invariants) || !Array.isArray(plan.variations)) return false
  if (plan.notes !== undefined && !stringArray(plan.notes)) return false
  if (!optional(plan.usage, validUsage)) return false
  return plan.variations.every((value) => {
    const variation = record(value)
    return Boolean(variation
      && typeof variation.id === 'string'
      && typeof variation.title === 'string'
      && typeof variation.prompt === 'string'
      && typeof variation.difference === 'string'
      && (variation.referenceAssetIds === undefined || stringArray(variation.referenceAssetIds)))
  })
}

function validCompaction(value: unknown): boolean {
  if (value === undefined) return true
  const compaction = record(value)
  const officialItems = compaction?.officialItems
  return Boolean(compaction
    && typeof compaction.summary === 'string'
    && typeof compaction.throughMessageId === 'string'
    && typeof compaction.updatedAt === 'number'
    && Number.isFinite(compaction.updatedAt)
    && optional(compaction.compressionMode, (item) => item === 'official' || item === 'observational' || item === 'local')
    && optional(compaction.fallbackReason, (item) => typeof item === 'string' && item.length <= 2_000)
    && optional(compaction.estimatedFixedTokens, nonNegativeInteger)
    && optional(compaction.coveredMessageCount, nonNegativeInteger)
    && optional(compaction.coveredFromAt, finiteNumber)
    && optional(compaction.coveredThroughAt, finiteNumber)
    && optional(compaction.keyItemCount, nonNegativeInteger)
    && optional(officialItems, (item) => Array.isArray(item) && item.every((entry) => Boolean(record(entry)) && validJson(entry)))
    && (compaction.compressionMode !== 'official' || Array.isArray(officialItems) && officialItems.length > 0))
}

function databaseMethods(database: ProjectDatabase) {
  if (!database.run || !database.all) throw new Error('项目数据库不支持会话存储')
  return { run: database.run.bind(database), all: database.all.bind(database) }
}

interface SessionChunkRow {
  session_id: string
  section: 'header' | 'message'
  item_index: number
  chunk_index: number
  payload_blob: Uint8Array
}

function chunksFor(value: unknown): Uint8Array[] {
  const bytes = Buffer.from(JSON.stringify(value), 'utf8')
  const chunks: Uint8Array[] = []
  for (let offset = 0; offset < bytes.byteLength; offset += SESSION_CHUNK_BYTES) {
    chunks.push(bytes.subarray(offset, Math.min(offset + SESSION_CHUNK_BYTES, bytes.byteLength)))
  }
  return chunks.length ? chunks : [Buffer.from('null')]
}

function parseChunks(rows: readonly SessionChunkRow[]): unknown {
  const bytes = Buffer.concat(rows.map((row) => Buffer.from(row.payload_blob)))
  return JSON.parse(bytes.toString('utf8')) as unknown
}

function validSession(value: unknown): value is WorkspaceSession {
  if (!value || typeof value !== 'object') return false
  const session = value as Partial<WorkspaceSession>
  return typeof session.id === 'string' && Boolean(session.id.trim())
    && typeof session.title === 'string'
    && (session.mode === 'text' || session.mode === 'image' || session.mode === 'agent')
    && optional(session.agentWriteEnabled, (item) => typeof item === 'boolean')
    && typeof session.createdAt === 'number' && Number.isFinite(session.createdAt)
    && typeof session.updatedAt === 'number' && Number.isFinite(session.updatedAt)
    && Array.isArray(session.messages) && session.messages.every(validMessage)
    && Array.isArray(session.results) && session.results.every(validResult)
    && Array.isArray(session.skillContexts) && session.skillContexts.every(validSkill)
    && validCompaction(session.compaction)
    && validPlan(session.imagePlan) && typeof session.imageLastPrompt === 'string'
    && validPlan(session.agentPlan) && typeof session.agentLastPrompt === 'string'
}

export class ProjectConversationStore {
  constructor(private readonly database: ProjectDatabase) {
    this.database.exec(SESSION_STORE_SCHEMA)
  }

  async load(): Promise<ConversationLoadResult> {
    const { all } = databaseMethods(this.database)
    const sessions: WorkspaceSession[] = []
    const issues: ConversationLoadIssue[] = []
    const normalizedIds = new Set<string>()
    for (const sessionRecord of all<{ id: string; message_count: number }>('SELECT id, message_count FROM workspace_session_records ORDER BY updated_at DESC')) {
      normalizedIds.add(sessionRecord.id)
      try {
        const rows = all<SessionChunkRow>('SELECT session_id, section, item_index, chunk_index, payload_blob FROM workspace_session_chunks WHERE session_id = ? ORDER BY section, item_index, chunk_index', sessionRecord.id)
        const headerRows = rows.filter((row) => row.section === 'header' && row.item_index === 0)
        if (headerRows.length === 0) {
          issues.push({ code: 'invalid-session' })
          continue
        }
        const header = record(parseChunks(headerRows))
        if (!header) {
          issues.push({ code: 'invalid-session' })
          continue
        }
        const messages = Array.from({ length: sessionRecord.message_count }, (_, index) => {
          const messageRows = rows.filter((row) => row.section === 'message' && row.item_index === index)
          if (!messageRows.length) throw new Error('missing-message')
          return parseChunks(messageRows)
        })
        const session = { ...header, messages }
        if (validSession(session)) sessions.push(session)
        else issues.push({ code: 'invalid-session' })
      } catch (error) {
        issues.push({ code: error instanceof SyntaxError ? 'invalid-json' : 'invalid-session' })
      }
    }
    for (const row of all<{ id: string; payload_json: string }>('SELECT id, payload_json FROM workspace_sessions ORDER BY updated_at DESC')) {
      if (normalizedIds.has(row.id)) continue
      if (Buffer.byteLength(row.payload_json, 'utf8') > MAX_LEGACY_SESSION_PAYLOAD_BYTES) {
        issues.push({ code: 'payload-too-large' })
        continue
      }
      try {
        const value: unknown = JSON.parse(row.payload_json)
        if (validSession(value)) sessions.push(value)
        else issues.push({ code: 'invalid-session' })
      } catch {
        issues.push({ code: 'invalid-json' })
      }
    }
    const activeId = all<{ value: string }>('SELECT value FROM workspace_state WHERE key = ?', ACTIVE_KEY)[0]?.value
    const resolvedActiveId = activeId && sessions.some((session) => session.id === activeId) ? activeId : undefined
    sessions.sort((left, right) => right.updatedAt - left.updatedAt)
    return { sessions, activeId: resolvedActiveId, ...(issues.length ? { issues } : {}) }
  }

  async initialize(sessions: readonly WorkspaceSession[], activeId?: string): Promise<void> {
    const { all, run } = databaseMethods(this.database)
    if (all<{ value: string }>('SELECT value FROM workspace_state WHERE key = ?', INITIALIZED_KEY)[0]) return
    for (const session of sessions) if (validSession(session)) await this.save(session)
    if (activeId && sessions.some((session) => session.id === activeId)) await this.setActive(activeId)
    run('INSERT INTO workspace_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', INITIALIZED_KEY, '1')
  }

  async save(session: WorkspaceSession): Promise<void> {
    if (!validSession(session)) throw new Error('会话数据无效')
    const { run } = databaseMethods(this.database)
    let headerChunks: Uint8Array[]
    let messageChunks: Uint8Array[][]
    try {
      headerChunks = chunksFor({ ...session, messages: [] })
      messageChunks = session.messages.map(chunksFor)
    } catch {
      throw new Error('会话数据无效')
    }
    this.database.exec('BEGIN IMMEDIATE')
    try {
      run('INSERT INTO workspace_session_records (id, message_count, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET message_count = excluded.message_count, created_at = excluded.created_at, updated_at = excluded.updated_at', session.id, session.messages.length, session.createdAt, session.updatedAt)
      run('DELETE FROM workspace_session_chunks WHERE session_id = ?', session.id)
      for (const [chunkIndex, chunk] of headerChunks.entries()) {
        run('INSERT INTO workspace_session_chunks (session_id, section, item_index, chunk_index, payload_blob, byte_length) VALUES (?, ?, ?, ?, ?, ?)', session.id, 'header', 0, chunkIndex, chunk, chunk.byteLength)
      }
      for (const [messageIndex, chunks] of messageChunks.entries()) {
        for (const [chunkIndex, chunk] of chunks.entries()) {
          run('INSERT INTO workspace_session_chunks (session_id, section, item_index, chunk_index, payload_blob, byte_length) VALUES (?, ?, ?, ?, ?, ?)', session.id, 'message', messageIndex, chunkIndex, chunk, chunk.byteLength)
        }
      }
      run('DELETE FROM workspace_sessions WHERE id = ?', session.id)
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  async remove(id: string): Promise<void> {
    const { run } = databaseMethods(this.database)
    run('DELETE FROM workspace_session_records WHERE id = ?', id)
    run('DELETE FROM workspace_sessions WHERE id = ?', id)
    run('DELETE FROM workspace_state WHERE key = ? AND value = ?', ACTIVE_KEY, id)
  }

  async setActive(id: string): Promise<void> {
    const { all, run } = databaseMethods(this.database)
    const exists = all<{ id: string }>('SELECT id FROM workspace_session_records WHERE id = ?', id)[0]
      ?? all<{ id: string }>('SELECT id FROM workspace_sessions WHERE id = ?', id)[0]
    if (!exists) throw new Error('会话不存在')
    run('INSERT INTO workspace_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', ACTIVE_KEY, id)
  }
}
