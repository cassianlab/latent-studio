import type { Mode } from '../../mock-data'
import type { ConversationApi, ConversationLoadIssue, WorkspaceSession } from '../../shared/contracts/conversations'

type StoredSession = Partial<WorkspaceSession> & {
  id: string
  agentSkillId?: string
  imageResults?: WorkspaceSession['results']
  agentResults?: WorkspaceSession['results']
}

interface SessionData {
  sessions: WorkspaceSession[]
  activeSession: WorkspaceSession
}

const STORAGE_PREFIX = 'latent-studio:sessions:'
const ACTIVE_PREFIX = 'latent-studio:active-session:'
const cache = new Map<string, SessionData>()
const writeChains = new Map<string, Promise<void>>()
const persistenceErrors = new Map<string, string>()
const loadIssues = new Map<string, ConversationLoadIssue[]>()
const pendingRemovals = new Map<string, Set<string>>()
const previewData = new Map<string, { sessions: WorkspaceSession[]; activeId?: string; initialized: boolean }>()

function generateId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `session-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

export function createDefaultSession(mode: Mode = 'image', title = '新探索对话'): WorkspaceSession {
  const now = Date.now()
  return {
    id: generateId(),
    title,
    mode,
    agentWriteEnabled: true,
    createdAt: now,
    updatedAt: now,
    messages: [],
    results: [],
    skillContexts: [],
    imagePlan: null,
    imageLastPrompt: '',
    agentPlan: null,
    agentLastPrompt: '',
  }
}

function normalizeSession(value: StoredSession): WorkspaceSession {
  const defaults = createDefaultSession(value.mode)
  const byId = new Map<string, WorkspaceSession['results'][number]>()
  for (const result of [...(value.results ?? []), ...(value.imageResults ?? []), ...(value.agentResults ?? [])]) {
    if (result?.id && !byId.has(result.id)) byId.set(result.id, result)
  }
  const { imageResults: _imageResults, agentResults: _agentResults, agentSkillId: _legacyAgentSkillId, ...stored } = value
  return {
    ...defaults,
    ...stored,
    id: value.id,
    agentWriteEnabled: value.agentWriteEnabled !== false,
    results: [...byId.values()],
    messages: Array.isArray(value.messages) ? value.messages : [],
    skillContexts: Array.isArray(value.skillContexts) ? value.skillContexts : [],
    ...(value.compaction ? { compaction: value.compaction } : {}),
    imagePlan: value.imagePlan ?? null,
    imageLastPrompt: value.imageLastPrompt ?? '',
    agentPlan: value.agentPlan ?? null,
    agentLastPrompt: value.agentLastPrompt ?? '',
  }
}

function storageKey(projectId: string): string {
  return `${STORAGE_PREFIX}${projectId || 'default'}`
}

function activeKey(projectId: string): string {
  return `${ACTIVE_PREFIX}${projectId || 'default'}`
}

function legacySessions(projectId: string): { sessions: WorkspaceSession[]; activeId?: string } {
  try {
    const raw = localStorage.getItem(storageKey(projectId))
    const parsed: unknown = raw ? JSON.parse(raw) : []
    const sessions = Array.isArray(parsed)
      ? parsed.filter((value): value is StoredSession => Boolean(value && typeof value === 'object' && typeof (value as StoredSession).id === 'string')).map(normalizeSession)
      : []
    const activeId = localStorage.getItem(activeKey(projectId)) ?? undefined
    return { sessions, ...(activeId ? { activeId } : {}) }
  } catch {
    return { sessions: [] }
  }
}

const previewApi: ConversationApi = {
  async load(input) {
    let current = previewData.get(input.projectId)
    if (!current) {
      current = { sessions: [], initialized: false }
      previewData.set(input.projectId, current)
    }
    if (!current.initialized) {
      current.sessions = (input.legacySessions ?? []).map((session) => structuredClone(session))
      current.activeId = input.legacyActiveId
      current.initialized = true
    }
    return structuredClone({ sessions: current.sessions, ...(current.activeId ? { activeId: current.activeId } : {}) })
  },
  async save({ projectId, session }) {
    const current = previewData.get(projectId) ?? { sessions: [], initialized: true }
    const index = current.sessions.findIndex((item) => item.id === session.id)
    if (index >= 0) current.sessions[index] = structuredClone(session)
    else current.sessions.push(structuredClone(session))
    previewData.set(projectId, current)
  },
  async remove({ projectId, sessionId }) {
    const current = previewData.get(projectId)
    if (!current) return
    current.sessions = current.sessions.filter((session) => session.id !== sessionId)
    if (current.activeId === sessionId) current.activeId = undefined
  },
  async setActive({ projectId, sessionId }) {
    const current = previewData.get(projectId)
    if (!current?.sessions.some((session) => session.id === sessionId)) throw new Error('会话不存在')
    current.activeId = sessionId
  },
  onFlushRequested() { return () => {} },
}

function api(): ConversationApi {
  return typeof window !== 'undefined' && window.latentStudio?.conversations ? window.latentStudio.conversations : previewApi
}

function dispatch(projectId: string, data: SessionData): void {
  window.dispatchEvent(new CustomEvent('latent-studio:session-updated', { detail: { projectId, activeId: data.activeSession.id, count: data.sessions.length } }))
}

function notifyPersistenceChange(projectId: string): void {
  const data = cache.get(projectId)
  if (data) dispatch(projectId, data)
}

function enqueue(projectId: string, operation: () => Promise<void>): void {
  const previous = writeChains.get(projectId) ?? Promise.resolve()
  const next = previous.then(operation, operation).then(() => {
    persistenceErrors.delete(projectId)
    notifyPersistenceChange(projectId)
  }, (error: unknown) => {
    persistenceErrors.set(projectId, error instanceof Error ? error.message : '会话保存失败')
    notifyPersistenceChange(projectId)
    console.error('Failed to persist project sessions', error)
    throw error
  })
  writeChains.set(projectId, next)
  void next.catch(() => undefined)
}

function saveSessions(projectId: string, sessions: WorkspaceSession[], activeId: string, removedId?: string): void {
  const activeSession = sessions.find((session) => session.id === activeId) ?? sessions[0]
  const data = { sessions, activeSession }
  if (removedId) {
    const removals = pendingRemovals.get(projectId) ?? new Set<string>()
    removals.add(removedId)
    pendingRemovals.set(projectId, removals)
  }
  cache.set(projectId, data)
  dispatch(projectId, data)
  enqueue(projectId, async () => {
    const conversations = api()
    const removals = [...(pendingRemovals.get(projectId) ?? [])]
    for (const sessionId of removals) await conversations.remove({ projectId, sessionId })
    await Promise.all(sessions.map((session) => conversations.save({ projectId, session })))
    await conversations.setActive({ projectId, sessionId: activeSession.id })
    const pending = pendingRemovals.get(projectId)
    for (const sessionId of removals) pending?.delete(sessionId)
    if (pending?.size === 0) pendingRemovals.delete(projectId)
  })
}

export async function hydrateSessions(projectId: string): Promise<SessionData> {
  const legacy = legacySessions(projectId)
  const persisted = await api().load({ projectId, ...(legacy.sessions.length ? { legacySessions: legacy.sessions } : {}), ...(legacy.activeId ? { legacyActiveId: legacy.activeId } : {}) })
  if (persisted.issues?.length) loadIssues.set(projectId, persisted.issues.map((issue) => ({ ...issue })))
  else loadIssues.delete(projectId)
  let sessions = persisted.sessions.map((session) => normalizeSession(session))
  let activeId = persisted.activeId
  if (!sessions.length) {
    const initial = createDefaultSession('image', '雨夜重逢视觉探索')
    sessions = [initial]
    activeId = initial.id
    await api().save({ projectId, session: initial })
    await api().setActive({ projectId, sessionId: initial.id })
  }
  const activeSession = sessions.find((session) => session.id === activeId) ?? sessions[0]
  const data = { sessions, activeSession }
  cache.set(projectId, data)
  if (legacy.sessions.length) {
    localStorage.removeItem(storageKey(projectId))
    localStorage.removeItem(activeKey(projectId))
  }
  dispatch(projectId, data)
  return data
}

export function loadSessions(projectId: string): SessionData {
  const existing = cache.get(projectId)
  if (existing) return existing
  const initial = createDefaultSession('image', '雨夜重逢视觉探索')
  const data = { sessions: [initial], activeSession: initial }
  cache.set(projectId, data)
  return data
}

export function createSession(projectId: string, mode: Mode = 'image', title = '新探索对话'): WorkspaceSession {
  const { sessions } = loadSessions(projectId)
  const newSession = createDefaultSession(mode, title)
  saveSessions(projectId, [newSession, ...sessions], newSession.id)
  return newSession
}

export function switchSession(projectId: string, sessionId: string): WorkspaceSession {
  const { sessions } = loadSessions(projectId)
  const target = sessions.find((session) => session.id === sessionId)
  if (target) {
    saveSessions(projectId, sessions, target.id)
    return target
  }
  return sessions[0] || createSession(projectId)
}

export function updateActiveSession(projectId: string, partial: Partial<WorkspaceSession>): WorkspaceSession {
  const { sessions, activeSession } = loadSessions(projectId)
  const updatedSession = { ...activeSession, ...partial, updatedAt: Date.now() }
  saveSessions(projectId, sessions.map((session) => session.id === updatedSession.id ? updatedSession : session), updatedSession.id)
  return updatedSession
}

export function renameSession(projectId: string, sessionId: string, newTitle: string): void {
  const { sessions, activeSession } = loadSessions(projectId)
  const trimmed = newTitle.trim() || '未命名对话'
  saveSessions(projectId, sessions.map((session) => session.id === sessionId ? { ...session, title: trimmed, updatedAt: Date.now() } : session), activeSession.id)
}

export function deleteSession(projectId: string, sessionId: string): WorkspaceSession {
  const { sessions, activeSession } = loadSessions(projectId)
  let nextList = sessions.filter((session) => session.id !== sessionId)
  if (!nextList.length) nextList = [createDefaultSession('image', '新探索对话')]
  const nextActive = activeSession.id === sessionId ? nextList[0] : nextList.find((session) => session.id === activeSession.id) ?? nextList[0]
  saveSessions(projectId, nextList, nextActive.id, sessionId)
  return nextActive
}

export function subscribeSessionChange(callback: () => void): () => void {
  window.addEventListener('latent-studio:session-updated', callback)
  return () => window.removeEventListener('latent-studio:session-updated', callback)
}

export async function flushSessionWrites(projectId: string): Promise<void> {
  while (true) {
    const pending = writeChains.get(projectId)
    await pending
    if (writeChains.get(projectId) === pending) return
  }
}

export async function flushAllSessionWrites(): Promise<void> {
  while (true) {
    const pending = [...writeChains.entries()]
    await Promise.all(pending.map(([, write]) => write))
    if (pending.length === writeChains.size && pending.every(([projectId, write]) => writeChains.get(projectId) === write)) return
  }
}

export function getSessionPersistenceError(projectId: string): string | undefined {
  return persistenceErrors.get(projectId)
}

export function getSessionLoadIssues(projectId: string): ConversationLoadIssue[] {
  return (loadIssues.get(projectId) ?? []).map((issue) => ({ ...issue }))
}

export async function retrySessionWrites(projectId: string): Promise<void> {
  const { sessions, activeSession } = loadSessions(projectId)
  saveSessions(projectId, sessions, activeSession.id)
  await flushSessionWrites(projectId)
}

export function clearSessionCache(projectId?: string): void {
  if (projectId) {
    cache.delete(projectId)
    previewData.delete(projectId)
    writeChains.delete(projectId)
    persistenceErrors.delete(projectId)
    loadIssues.delete(projectId)
    pendingRemovals.delete(projectId)
    return
  }
  cache.clear()
  previewData.clear()
  writeChains.clear()
  persistenceErrors.clear()
  loadIssues.clear()
  pendingRemovals.clear()
}
