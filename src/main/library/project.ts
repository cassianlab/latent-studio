import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { parse, resolve } from 'node:path'
import type {
  ListMemoryEntriesInput,
  ListPromptAssetsInput,
  MemoryEntry,
  MemoryEntryStore,
  PromptAsset,
  PromptAssetStore,
  SaveMemoryEntryInput,
  SavePromptAssetInput,
  UpdatePromptAssetInput,
  UpdateMemoryEntryInput,
} from '../../shared/contracts/library'
import { assertScope, LibraryError, normalizeTags, optionalText, requiredText } from './errors'
import type { PromptAssetSource } from '../../shared/contracts/library'
import { isMemoryCategory } from '../../shared/memory/categories'

interface PromptFile {
  format: 1
  items: PromptAsset[]
}

interface MemoryFile {
  format: 1
  items: MemoryEntry[]
}

const PROMPT_FILE = ['.latent-studio', 'prompt-library.json']
const MEMORY_FILE = ['.latent-studio', 'memory-library.json']

function ensureProjectScope(scope: unknown, projectRoot: unknown): string {
  if (assertScope(scope) !== 'project') throw new LibraryError('invalid-scope', '项目存储只能保存 project 范围内容')
  if (typeof projectRoot !== 'string' || !projectRoot.trim() || !parse(projectRoot).root || resolve(projectRoot) === parse(resolve(projectRoot)).root) {
    throw new LibraryError('invalid-project-root', '项目根目录必须是绝对且非根路径')
  }
  return resolve(projectRoot)
}

async function assertProjectRoot(projectRoot: string): Promise<string> {
  const rootPath = ensureProjectScope('project', projectRoot)
  let canonical: string
  try {
    canonical = await fs.realpath(rootPath)
    const details = await fs.stat(canonical)
    if (!details.isDirectory()) throw new Error('not-directory')
  } catch (error) {
    if (error instanceof LibraryError) throw error
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new LibraryError('invalid-project-root', '项目根目录不存在')
    if ((error as Error).message === 'not-directory') throw new LibraryError('invalid-project-root', '项目根目录不是文件夹')
    throw new LibraryError('invalid-project-root', '无法访问项目根目录')
  }
  return canonical
}

async function readJson<T>(path: string, fallback: T, type: 'prompt' | 'memory'): Promise<T> {
  try {
    const text = await fs.readFile(path, 'utf8')
    const value = JSON.parse(text) as Partial<{ format: number; items: unknown }>
    if (value.format !== 1 || !Array.isArray(value.items)) throw new Error('invalid')
    return value as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback
    if (error instanceof SyntaxError || (error as Error).message === 'invalid') {
      throw new LibraryError('corrupt-library', `${type === 'prompt' ? '提示词' : '记忆'}库文件损坏`)
    }
    throw new LibraryError('read-failed', '无法读取项目内容库')
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const directory = resolve(path, '..')
  await fs.mkdir(directory, { recursive: true })
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await fs.rename(temporaryPath, path)
  } catch (error) {
    try { await fs.unlink(temporaryPath) } catch { /* best effort cleanup */ }
    throw new LibraryError('read-failed', `无法写入项目内容库：${(error as Error).message}`)
  }
}

function promptPath(root: string): string { return resolve(root, ...PROMPT_FILE) }
function memoryPath(root: string): string { return resolve(root, ...MEMORY_FILE) }

function promptItem(value: unknown): PromptAsset {
  if (!value || typeof value !== 'object') throw new LibraryError('corrupt-library', '提示词库包含无效条目')
  const item = value as Partial<PromptAsset>
  if (typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.content !== 'string' || typeof item.createdAt !== 'string' || typeof item.updatedAt !== 'string') {
    throw new LibraryError('corrupt-library', '提示词库包含无效条目')
  }
  return {
    id: item.id,
    name: item.name,
    content: item.content,
    kind: item.kind === 'template' || item.kind === 'style' ? item.kind : 'prompt',
    scope: 'project',
    version: Number.isInteger(item.version) && (item.version as number) > 0 ? item.version as number : 1,
    tags: normalizeTags(item.tags),
    favorite: item.favorite === true,
    collection: optionalText(item.collection, '提示词分组', 120) ?? '个人',
    category: optionalText(item.category, '提示词分类', 120) ?? '未分类',
    ...(item.primaryLocale === 'zh-CN' || item.primaryLocale === 'en' || item.primaryLocale === 'und' ? { primaryLocale: item.primaryLocale } : {}),
    ...(item.translations && typeof item.translations === 'object' ? { translations: { ...(typeof item.translations['zh-CN'] === 'string' ? { 'zh-CN': item.translations['zh-CN'] } : {}), ...(typeof item.translations.en === 'string' ? { en: item.translations.en } : {}) } } : {}),
    ...(typeof item.description === 'string' ? { description: item.description } : {}),
    ...(item.source ? { source: item.source } : {}),
    ...(typeof item.previewUrl === 'string' ? { previewUrl: item.previewUrl } : {}),
    ...(typeof item.sourceUrl === 'string' ? { sourceUrl: item.sourceUrl } : {}),
    ...(typeof item.deletedAt === 'string' ? { deletedAt: item.deletedAt } : {}),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }
}

function memoryItem(value: unknown): MemoryEntry {
  if (!value || typeof value !== 'object') throw new LibraryError('corrupt-library', '记忆库包含无效条目')
  const item = value as Partial<MemoryEntry>
  if (typeof item.id !== 'string' || typeof item.title !== 'string' || typeof item.content !== 'string' || typeof item.createdAt !== 'string' || typeof item.updatedAt !== 'string') {
    throw new LibraryError('corrupt-library', '记忆库包含无效条目')
  }
  return {
    id: item.id,
    title: item.title,
    content: item.content,
    scope: 'project',
    version: Number.isInteger(item.version) && (item.version as number) > 0 ? item.version as number : 1,
    active: item.active !== false,
    ...(isMemoryCategory(item.category) ? { category: item.category } : {}),
    ...(item.source ? { source: item.source } : {}),
    ...(item.lastUsedAt ? { lastUsedAt: item.lastUsedAt } : {}),
    ...(item.deletedAt ? { deletedAt: item.deletedAt } : {}),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }
}

function filterText(value: string, search: string | undefined): boolean {
  return !search || value.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
}

function nextVersion<T extends { name: string; version: number }>(items: T[], name: string): number {
  return Math.max(0, ...items.filter((item) => item.name === name).map((item) => item.version)) + 1
}

function nextMemoryVersion(items: MemoryEntry[], title: string): number {
  return Math.max(0, ...items.filter((item) => item.title === title).map((item) => item.version)) + 1
}

function promptSource(value: unknown): PromptAssetSource | undefined {
  if (value === undefined) return undefined
  if (value !== 'manual' && value !== 'generation' && value !== 'optimization' && value !== 'import') {
    throw new LibraryError('invalid-input', '提示词来源无效')
  }
  return value
}

/** Project-scoped prompt assets stored in the project's hidden metadata directory. */
export class ProjectPromptStore implements PromptAssetStore {
  private writeChain: Promise<unknown> = Promise.resolve()

  async list(input: ListPromptAssetsInput): Promise<PromptAsset[]> {
    const root = await assertProjectRoot(ensureProjectScope(input.scope, input.projectRoot))
    const file = await readJson<PromptFile>(promptPath(root), { format: 1, items: [] }, 'prompt')
    const items = file.items.map(promptItem).filter((item) => !item.deletedAt)
    return items
      .filter((item) => (input.kind ? item.kind === input.kind : true) && filterText(`${item.name}\n${item.content}\n${item.translations?.['zh-CN'] ?? ''}\n${item.translations?.en ?? ''}\n${item.description ?? ''}\n${item.collection}\n${item.category}\n${item.tags.join(' ')}`, input.search))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async get(input: { id: string; scope: 'global' | 'project'; projectRoot?: string }): Promise<PromptAsset | null> {
    const root = await assertProjectRoot(ensureProjectScope(input.scope, input.projectRoot))
    const id = requiredText(input.id, 'ID', 200)
    const file = await readJson<PromptFile>(promptPath(root), { format: 1, items: [] }, 'prompt')
    return file.items.map(promptItem).find((item) => item.id === id && !item.deletedAt) ?? null
  }

  async save(input: SavePromptAssetInput): Promise<PromptAsset> {
    const root = await assertProjectRoot(ensureProjectScope(input.scope, input.projectRoot))
    const name = requiredText(input.name, '提示词名称', 200)
    const content = requiredText(input.content, '提示词内容', 200_000)
    const kind = input.kind ?? 'prompt'
    if (kind !== 'prompt' && kind !== 'template' && kind !== 'style') throw new LibraryError('invalid-input', '提示词类型无效')
    const tags = normalizeTags(input.tags)
    const source = promptSource(input.source)
    const collection = optionalText(input.collection, '提示词分组', 120) ?? '个人'
    const category = optionalText(input.category, '提示词分类', 120) ?? '未分类'
    return this.enqueue(async () => {
      const file = await readJson<PromptFile>(promptPath(root), { format: 1, items: [] }, 'prompt')
      const now = new Date().toISOString()
      const item: PromptAsset = {
        id: randomUUID(), name, content, kind, scope: 'project', version: nextVersion(file.items.map(promptItem), name), tags,
        favorite: input.favorite === true, collection, category, ...(source ? { source } : {}),
        ...(input.primaryLocale ? { primaryLocale: input.primaryLocale } : {}),
        ...(input.translations ? { translations: { ...input.translations } } : {}),
        ...(input.description?.trim() ? { description: input.description.trim() } : {}),
        ...(input.previewUrl ? { previewUrl: input.previewUrl } : {}), ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
        createdAt: now, updatedAt: now,
      }
      await writeJsonAtomic(promptPath(root), { format: 1, items: [...file.items, item] } satisfies PromptFile)
      return item
    })
  }

  quickSave(input: SavePromptAssetInput): Promise<PromptAsset> { return this.save(input) }

  async update(input: UpdatePromptAssetInput): Promise<PromptAsset> {
    const root = await assertProjectRoot(ensureProjectScope(input.scope, input.projectRoot))
    const id = requiredText(input.id, 'ID', 200)
    return this.enqueue(async () => {
      const file = await readJson<PromptFile>(promptPath(root), { format: 1, items: [] }, 'prompt')
      const items = file.items.map(promptItem)
      const index = items.findIndex((item) => item.id === id)
      if (index < 0) throw new LibraryError('not-found', '提示词不存在')
      const current = items[index]
      if (input.kind !== undefined && !['prompt', 'template', 'style'].includes(input.kind)) throw new LibraryError('invalid-input', '提示词类型无效')
      const updated: PromptAsset = {
        ...current,
        ...(input.name === undefined ? {} : { name: requiredText(input.name, '提示词名称', 200) }),
        ...(input.content === undefined ? {} : { content: requiredText(input.content, '提示词内容', 200_000) }),
        ...(input.kind === undefined ? {} : { kind: input.kind }),
        ...(input.tags === undefined ? {} : { tags: normalizeTags(input.tags) }),
        ...(input.favorite === undefined ? {} : { favorite: input.favorite }),
        ...(input.source === undefined ? {} : { source: input.source }),
        ...(input.collection === undefined ? {} : { collection: optionalText(input.collection, '提示词分组', 120) ?? '个人' }),
        ...(input.category === undefined ? {} : { category: optionalText(input.category, '提示词分类', 120) ?? '未分类' }),
        ...(input.primaryLocale === undefined ? {} : { primaryLocale: input.primaryLocale }),
        ...(input.translations === undefined ? {} : { translations: { ...input.translations } }),
        ...(input.description === undefined ? {} : { description: input.description === null ? undefined : optionalText(input.description, '使用说明', 10_000) }),
        ...(input.previewUrl === undefined ? {} : { previewUrl: input.previewUrl === null ? undefined : optionalText(input.previewUrl, '提示词预览地址', 2_000) }),
        ...(input.sourceUrl === undefined ? {} : { sourceUrl: input.sourceUrl === null ? undefined : optionalText(input.sourceUrl, '提示词来源地址', 2_000) }),
        updatedAt: new Date().toISOString(),
      }
      items[index] = updated
      await writeJsonAtomic(promptPath(root), { format: 1, items } satisfies PromptFile)
      return updated
    })
  }

  async remove(input: { id: string; scope: 'global' | 'project'; projectRoot?: string }): Promise<void> {
    const root = await assertProjectRoot(ensureProjectScope(input.scope, input.projectRoot))
    const id = requiredText(input.id, 'ID', 200)
    return this.enqueue(async () => {
      const file = await readJson<PromptFile>(promptPath(root), { format: 1, items: [] }, 'prompt')
      const items = file.items.map(promptItem)
      const index = items.findIndex((item) => item.id === id && !item.deletedAt)
      if (index < 0) throw new LibraryError('not-found', '提示词不存在')
      items[index] = { ...items[index], deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
      await writeJsonAtomic(promptPath(root), { format: 1, items } satisfies PromptFile)
    })
  }

  async restore(input: { id: string; scope: 'global' | 'project'; projectRoot?: string }): Promise<void> {
    const root = await assertProjectRoot(ensureProjectScope(input.scope, input.projectRoot))
    const id = requiredText(input.id, 'ID', 200)
    return this.enqueue(async () => {
      const file = await readJson<PromptFile>(promptPath(root), { format: 1, items: [] }, 'prompt')
      const items = file.items.map(promptItem)
      const index = items.findIndex((item) => item.id === id && item.deletedAt)
      if (index < 0) throw new LibraryError('not-found', '已删除提示词不存在')
      const { deletedAt: _deletedAt, ...rest } = items[index]
      items[index] = { ...rest, updatedAt: new Date().toISOString() }
      await writeJsonAtomic(promptPath(root), { format: 1, items } satisfies PromptFile)
    })
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.writeChain.then(operation, operation)
    this.writeChain = next.then(() => undefined, () => undefined)
    return next
  }
}

/** Project-scoped memory entries stored separately from prompt assets. */
export class ProjectMemoryStore implements MemoryEntryStore {
  private writeChain: Promise<unknown> = Promise.resolve()

  async list(input: ListMemoryEntriesInput): Promise<MemoryEntry[]> {
    const root = await assertProjectRoot(ensureProjectScope(input.scope, input.projectRoot))
    const file = await readJson<MemoryFile>(memoryPath(root), { format: 1, items: [] }, 'memory')
    return file.items.map(memoryItem)
      .filter((item) => !item.deletedAt && (!input.activeOnly || item.active) && filterText(`${item.title}\n${item.content}`, input.search))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async get(input: { id: string; scope: 'global' | 'project'; projectRoot?: string }): Promise<MemoryEntry | null> {
    const root = await assertProjectRoot(ensureProjectScope(input.scope, input.projectRoot))
    const id = requiredText(input.id, 'ID', 200)
    const file = await readJson<MemoryFile>(memoryPath(root), { format: 1, items: [] }, 'memory')
    return file.items.map(memoryItem).find((item) => item.id === id && !item.deletedAt) ?? null
  }

  async save(input: SaveMemoryEntryInput): Promise<MemoryEntry> {
    const root = await assertProjectRoot(ensureProjectScope(input.scope, input.projectRoot))
    const title = requiredText(input.title, '记忆标题', 200)
    const content = requiredText(input.content, '记忆内容', 200_000)
    const source = optionalText(input.source, '记忆来源', 500)
    return this.enqueue(async () => {
      const file = await readJson<MemoryFile>(memoryPath(root), { format: 1, items: [] }, 'memory')
      const now = new Date().toISOString()
      const item: MemoryEntry = {
        id: randomUUID(), title, content, scope: 'project', version: nextMemoryVersion(file.items.map(memoryItem), title), active: input.active !== false,
        ...(input.category ? { category: input.category } : {}),
        ...(source ? { source } : {}), createdAt: now, updatedAt: now,
      }
      await writeJsonAtomic(memoryPath(root), { format: 1, items: [...file.items, item] } satisfies MemoryFile)
      return item
    })
  }

  async update(input: UpdateMemoryEntryInput): Promise<MemoryEntry> {
    const root = await assertProjectRoot(ensureProjectScope(input.scope, input.projectRoot))
    const id = requiredText(input.id, 'ID', 200)
    return this.enqueue(async () => {
      const file = await readJson<MemoryFile>(memoryPath(root), { format: 1, items: [] }, 'memory')
      const items = file.items.map(memoryItem)
      const index = items.findIndex((item) => item.id === id)
      if (index < 0) throw new LibraryError('not-found', '记忆不存在')
      const current = items[index]
      const title = input.title === undefined ? current.title : requiredText(input.title, '记忆标题', 200)
      const content = input.content === undefined ? current.content : requiredText(input.content, '记忆内容', 200_000)
      const active = input.active === undefined ? current.active : input.active
      if (typeof active !== 'boolean') throw new LibraryError('invalid-input', '记忆状态必须是布尔值')
      const source = input.source === undefined ? current.source : optionalText(input.source, '记忆来源', 500)
      const category = input.category === undefined ? current.category : input.category
      const lastUsedAt = input.lastUsedAt === undefined ? current.lastUsedAt : optionalText(input.lastUsedAt, '最近使用时间', 80)
      const updated: MemoryEntry = {
        ...current,
        title,
        content,
        active,
        ...(category ? { category } : {}),
        ...(category ? {} : { category: undefined }),
        ...(source ? { source } : {}),
        ...(source ? {} : { source: undefined }),
        ...(lastUsedAt ? { lastUsedAt } : {}),
        ...(lastUsedAt ? {} : { lastUsedAt: undefined }),
        updatedAt: new Date().toISOString(),
      }
      items[index] = updated
      await writeJsonAtomic(memoryPath(root), { format: 1, items } satisfies MemoryFile)
      return updated
    })
  }

  async remove(input: { id: string; scope: 'global' | 'project'; projectRoot?: string }): Promise<void> {
    const root = await assertProjectRoot(ensureProjectScope(input.scope, input.projectRoot))
    const id = requiredText(input.id, 'ID', 200)
    return this.enqueue(async () => {
      const file = await readJson<MemoryFile>(memoryPath(root), { format: 1, items: [] }, 'memory')
      const items = file.items.map(memoryItem)
      const index = items.findIndex((item) => item.id === id && !item.deletedAt)
      if (index < 0) throw new LibraryError('not-found', '记忆不存在')
      items[index] = { ...items[index], deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
      await writeJsonAtomic(memoryPath(root), { format: 1, items } satisfies MemoryFile)
    })
  }

  async restore(input: { id: string; scope: 'global' | 'project'; projectRoot?: string }): Promise<void> {
    const root = await assertProjectRoot(ensureProjectScope(input.scope, input.projectRoot))
    const id = requiredText(input.id, 'ID', 200)
    return this.enqueue(async () => {
      const file = await readJson<MemoryFile>(memoryPath(root), { format: 1, items: [] }, 'memory')
      const items = file.items.map(memoryItem)
      const index = items.findIndex((item) => item.id === id && item.deletedAt)
      if (index < 0) throw new LibraryError('not-found', '已删除记忆不存在')
      const { deletedAt: _deletedAt, ...rest } = items[index]
      items[index] = { ...rest, updatedAt: new Date().toISOString() }
      await writeJsonAtomic(memoryPath(root), { format: 1, items } satisfies MemoryFile)
    })
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.writeChain.then(operation, operation)
    this.writeChain = next.then(() => undefined, () => undefined)
    return next
  }
}

export const JsonPromptAssetStore = ProjectPromptStore
export const JsonMemoryEntryStore = ProjectMemoryStore
export const ProjectPromptAssetStore = ProjectPromptStore
export const ProjectMemoryEntryStore = ProjectMemoryStore
