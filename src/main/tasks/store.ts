import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import type { CreateTaskInput, TaskEvent, TaskListInput, TaskRecord, TaskStatus } from '../../shared/contracts/tasks'
import type { ImageTaskRecord } from '../../shared/contracts/images'
import { conciseTaskTitle } from '../../shared/task-title'

interface Snapshot { version: 1; paused: boolean; tasks: TaskRecord[] }

const MAX_ATTEMPTS = 10

function validAttempts(value: number | undefined): number {
  const candidate = value ?? 1
  if (!Number.isInteger(candidate) || candidate < 1 || candidate > MAX_ATTEMPTS) throw new RangeError(`任务最大尝试次数需要是 1-${MAX_ATTEMPTS} 的整数`)
  return candidate
}

function clone(task: TaskRecord): TaskRecord {
  return { ...task, ...(task.payload ? { payload: { ...task.payload } } : {}), ...(task.error ? { error: { ...task.error } } : {}) }
}

function validTask(value: unknown): value is TaskRecord {
  if (!value || typeof value !== 'object') return false
  const task = value as Partial<TaskRecord>
  return typeof task.id === 'string' && typeof task.title === 'string' && typeof task.kind === 'string' &&
    ['pending', 'running', 'paused', 'completed', 'failed', 'cancelled'].includes(task.status as string) &&
    typeof task.progress === 'number' && Number.isFinite(task.progress) && typeof task.attempts === 'number' &&
    typeof task.maxAttempts === 'number' && typeof task.createdAt === 'string' && typeof task.updatedAt === 'string'
}

async function readSnapshot(path: string): Promise<Snapshot> {
  try {
    const parsed = JSON.parse(await fs.readFile(path, 'utf8')) as Partial<Snapshot>
    if (parsed.version !== 1 || !Array.isArray(parsed.tasks) || !parsed.tasks.every(validTask)) throw new Error('invalid task snapshot')
    const tasks = parsed.tasks.map(clone)
    return { version: 1, paused: parsed.paused === true, tasks }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, paused: false, tasks: [] }
    throw Object.assign(new Error('任务快照损坏或无法读取'), { code: 'corrupt-tasks', cause: error })
  }
}

async function writeSnapshot(path: string, snapshot: Snapshot): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
    await fs.rename(temporary, path)
  } catch (error) {
    try { await fs.unlink(temporary) } catch { /* best effort cleanup */ }
    throw error
  }
}

export interface TaskStoreOptions { now?: () => string }

const sharedStores = new Map<string, TaskStore>()

export function sharedTaskStore(projectRoot: string): TaskStore {
  let store = sharedStores.get(projectRoot)
  if (!store) { store = new TaskStore(projectRoot); sharedStores.set(projectRoot, store) }
  return store
}

export function clearSharedTaskStores(): void { sharedStores.clear() }

export class TaskStore {
  private readonly path: string
  private readonly now: () => string
  private tasks = new Map<string, TaskRecord>()
  private paused = false
  private loaded = false
  private writing: Promise<void> = Promise.resolve()
  private readonly listeners = new Set<(event: TaskEvent) => void>()

  constructor(projectRoot: string, options: TaskStoreOptions = {}) {
    this.path = join(projectRoot, '.latent-studio', 'tasks.json')
    this.now = options.now ?? (() => new Date().toISOString())
  }

  async load(): Promise<void> {
    if (this.loaded) return
    const snapshot = await readSnapshot(this.path)
    this.paused = snapshot.paused
    let recovered = false
    for (const task of snapshot.tasks) {
      if (task.status === 'running') { task.status = 'paused'; recovered = true }
      this.tasks.set(task.id, task)
    }
    this.loaded = true
    if (recovered) await this.persist()
  }

  onEvent(listener: (event: TaskEvent) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }

  private emit(type: TaskEvent['type'], task: TaskRecord): void {
    const event = { type, task: clone(task) }
    for (const listener of this.listeners) { try { listener(event) } catch { /* observers cannot break task state */ } }
  }

  private async persist(): Promise<void> {
    const snapshot = { version: 1 as const, paused: this.paused, tasks: [...this.tasks.values()].map(clone) }
    this.writing = this.writing.catch(() => undefined).then(() => writeSnapshot(this.path, snapshot))
    await this.writing
  }

  async create(input: CreateTaskInput): Promise<TaskRecord> {
    await this.load()
    if (typeof input.title !== 'string' || !input.title.trim()) throw new TypeError('任务标题不能为空')
    const id = input.id?.trim() || randomUUID()
    if (this.tasks.has(id)) throw new Error(`任务已存在：${id}`)
    const timestamp = this.now()
    const task: TaskRecord = { id, title: conciseTaskTitle(input.title, '任务'), kind: input.kind?.trim() || 'generic', status: this.paused ? 'paused' : 'pending', progress: 0, attempts: 0, maxAttempts: validAttempts(input.maxAttempts), createdAt: timestamp, updatedAt: timestamp, ...(input.payload ? { payload: { ...input.payload } } : {}) }
    this.tasks.set(id, task)
    await this.persist()
    this.emit('created', task)
    return clone(task)
  }

  async list(input: TaskListInput = {}): Promise<TaskRecord[]> {
    await this.load()
    const archived = input.archived === true
    return [...this.tasks.values()].filter((task) => Boolean(task.archivedAt) === archived).map(clone)
  }
  async isPaused(): Promise<boolean> { await this.load(); return this.paused }
  async get(id: string): Promise<TaskRecord | undefined> { await this.load(); return this.tasks.get(id) && clone(this.tasks.get(id) as TaskRecord) }

  async syncImage(task: ImageTaskRecord, modelProfileId?: string, projectRoot?: string): Promise<TaskRecord> {
    await this.load()
    const existing = this.tasks.get(task.id)
    if (existing && existing.kind !== 'image') throw new Error(`任务已存在：${task.id}`)
    const status: TaskStatus = task.status
    const progress = status === 'completed' ? 100 : status === 'running' ? 50 : 0
    const payload = {
      source: 'image',
      connectionId: task.connectionId,
      modelProfileId,
      projectRoot,
      request: task.request,
      maxRetries: task.maxRetries,
      imageTask: task,
    } satisfies Record<string, unknown>
    const record: TaskRecord = existing ? { ...existing, status, progress, attempts: task.attempts, maxAttempts: task.maxRetries + 1, updatedAt: task.updatedAt, payload, ...(task.error ? { error: task.error } : { error: undefined }) } : {
      id: task.id,
      title: conciseTaskTitle(task.title || task.request.prompt, '图片生成任务'),
      kind: 'image',
      status,
      progress,
      attempts: task.attempts,
      maxAttempts: task.maxRetries + 1,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      payload,
      ...(task.error ? { error: task.error } : {}),
    }
    this.tasks.set(task.id, record)
    await this.persist()
    this.emit(existing ? (status === 'pending' && existing.status !== 'pending' ? 'pending' : status) : 'created', record)
    return clone(record)
  }

  async listImageTasks(input: TaskListInput = {}): Promise<ImageTaskRecord[]> {
    await this.load()
    const archived = input.archived === true
    return [...this.tasks.values()].filter((task) => task.kind === 'image' && Boolean(task.archivedAt) === archived).flatMap((task) => {
      const value = task.payload?.imageTask
      if (!value || typeof value !== 'object') return []
      const image = value as ImageTaskRecord
      const status = task.status === 'running' ? 'paused' : task.status
      const modelProfileId = task.payload?.modelProfileId
      return [{ ...image, title: task.title, status: status as ImageTaskRecord['status'], attempts: task.attempts, updatedAt: task.updatedAt, ...(task.archivedAt ? { archivedAt: task.archivedAt } : {}), ...(typeof modelProfileId === 'string' ? { modelProfileId } : {}), ...(task.error ? { error: task.error as ImageTaskRecord['error'] } : {}) }]
    })
  }

  async rename(id: string, title: string): Promise<TaskRecord | null> {
    await this.load()
    const candidate = typeof title === 'string' ? title.trim() : ''
    if (!candidate) throw new TypeError('任务标题不能为空')
    const task = this.tasks.get(id)
    if (!task) return null
    task.title = candidate
    if (task.payload?.imageTask && typeof task.payload.imageTask === 'object') {
      (task.payload.imageTask as Record<string, unknown>).title = candidate
    }
    task.updatedAt = this.now()
    await this.persist()
    this.emit('renamed', task)
    return clone(task)
  }

  async cancel(id: string): Promise<boolean> { return this.transition(id, ['pending', 'running', 'paused'], 'cancelled') }

  async retry(id: string): Promise<boolean> {
    await this.load()
    const task = this.tasks.get(id)
    if (!task || task.archivedAt || !['failed', 'cancelled', 'paused'].includes(task.status)) return false
    task.status = this.paused ? 'paused' : 'pending'; task.error = undefined; task.updatedAt = this.now()
    await this.persist(); this.emit('retrying', task); return true
  }

  async archive(id: string): Promise<boolean> {
    await this.load()
    const task = this.tasks.get(id)
    if (!task || task.archivedAt || !['completed', 'failed', 'cancelled'].includes(task.status)) return false
    task.archivedAt = this.now()
    task.updatedAt = task.archivedAt
    await this.persist()
    this.emit('archived', task)
    return true
  }

  async restore(id: string): Promise<boolean> {
    await this.load()
    const task = this.tasks.get(id)
    if (!task?.archivedAt) return false
    task.archivedAt = undefined
    task.updatedAt = this.now()
    await this.persist()
    this.emit('restored', task)
    return true
  }

  async remove(id: string): Promise<boolean> {
    await this.load()
    const task = this.tasks.get(id)
    if (!task || !['completed', 'failed', 'cancelled'].includes(task.status)) return false
    this.tasks.delete(id)
    await this.persist()
    this.emit('removed', task)
    return true
  }

  async pause(): Promise<void> {
    await this.load(); this.paused = true
    for (const task of this.tasks.values()) if (task.payload?.source !== 'image' && (task.status === 'pending' || task.status === 'running')) { task.status = 'paused'; task.updatedAt = this.now(); this.emit('paused', task) }
    await this.persist()
  }

  async resume(): Promise<void> {
    await this.load(); this.paused = false
    for (const task of this.tasks.values()) if (task.payload?.source !== 'image' && task.status === 'paused') { task.status = 'pending'; task.updatedAt = this.now(); this.emit('pending', task) }
    await this.persist()
  }

  private async transition(id: string, from: TaskStatus[], status: TaskStatus): Promise<boolean> {
    await this.load(); const task = this.tasks.get(id)
    if (!task || !from.includes(task.status)) return false
    task.status = status; task.updatedAt = this.now(); if (status === 'cancelled') task.error = { code: 'cancelled', message: '任务已取消' }
    await this.persist(); this.emit(status, task); return true
  }
}
