import { randomUUID } from 'node:crypto'
import type { GlobalDatabase } from '../config'
import type {
  ListMemoryEntriesInput,
  ListPromptPageInput,
  ListPromptAssetsInput,
  MemoryEntry,
  MemoryEntryStore,
  PromptAsset,
  PromptAssetKind,
  PromptAssetSource,
  PromptAssetStore,
  SaveMemoryEntryInput,
  SavePromptAssetInput,
  UpdatePromptAssetInput,
  UpdateMemoryEntryInput,
} from '../../shared/contracts/library'
import { LibraryError, assertScope, normalizeTags, optionalText, requiredText } from './errors'
import { removePromptSearchDocument, upsertPromptSearchDocument } from './prompt-search'
import { isMemoryCategory } from '../../shared/memory/categories'

interface PromptRow {
  row_id?: number
  id: string
  name: string
  content: string
  created_at: string
  updated_at: string
}

export interface PromptPage {
  items: PromptAsset[]
  total: number
  offset: number
  limit: number
  hasMore: boolean
  categories: string[]
}

export interface PromptSearchIndexPage {
  items: PromptAsset[]
  nextCursor: number | null
}

interface MemoryRow {
  row_id?: number
  id: string
  title: string
  content: string
  created_at: string
  updated_at: string
}

interface PromptEnvelope {
  marker: 'latent-studio-prompt-v1'
  content: string
  kind: PromptAssetKind
  tags: string[]
  favorite: boolean
  source?: PromptAssetSource
  collection?: string
  category?: string
  primaryLocale?: PromptAsset['primaryLocale']
  translations?: PromptAsset['translations']
  description?: string
  previewUrl?: string
  sourceUrl?: string
  deletedAt?: string
}

interface MemoryEnvelope {
  marker: 'latent-studio-memory-v1'
  content: string
  active: boolean
  category?: MemoryEntry['category']
  source?: string
  lastUsedAt?: string
  deletedAt?: string
}

const PROMPT_MARKER = 'latent-studio-prompt-v1'
const MEMORY_MARKER = 'latent-studio-memory-v1'

function validId(value: unknown): string {
  return requiredText(value, 'ID', 200)
}

function validKind(value: unknown): PromptAssetKind {
  if (value === undefined) return 'prompt'
  if (value !== 'prompt' && value !== 'template' && value !== 'style') throw new LibraryError('invalid-input', '提示词类型无效')
  return value
}

function validSource(value: unknown): PromptAssetSource | undefined {
  if (value === undefined) return undefined
  if (value !== 'manual' && value !== 'generation' && value !== 'optimization' && value !== 'import') {
    throw new LibraryError('invalid-input', '提示词来源无效')
  }
  return value
}

function promptLocale(value: unknown): PromptAsset['primaryLocale'] | undefined {
  return value === 'zh-CN' || value === 'en' || value === 'und' ? value : undefined
}

function promptTranslations(value: unknown): PromptAsset['translations'] | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const zh = optionalText(record['zh-CN'], '中文译文', 200_000)
  const en = optionalText(record.en, '英文译文', 200_000)
  return zh || en ? { ...(zh ? { 'zh-CN': zh } : {}), ...(en ? { en } : {}) } : undefined
}

function encodePrompt(input: SavePromptAssetInput): string {
  const kind = validKind(input.kind)
  const tags = normalizeTags(input.tags)
  const favorite = input.favorite === true
  const source = validSource(input.source)
  const collection = optionalText(input.collection, '提示词分组', 120)
  const category = optionalText(input.category, '提示词分类', 120)
  const previewUrl = optionalText(input.previewUrl, '提示词预览地址', 2_000)
  const sourceUrl = optionalText(input.sourceUrl, '提示词来源地址', 2_000)
  const primaryLocale = promptLocale(input.primaryLocale)
  const translations = promptTranslations(input.translations)
  const description = optionalText(input.description, '使用说明', 10_000)
  if (kind === 'prompt' && tags.length === 0 && !favorite && source === undefined && !collection && !category && !primaryLocale && !translations && !description && !previewUrl && !sourceUrl) return input.content
  const envelope: PromptEnvelope = { marker: PROMPT_MARKER, content: input.content, kind, tags, favorite, ...(source ? { source } : {}), ...(collection ? { collection } : {}), ...(category ? { category } : {}), ...(primaryLocale ? { primaryLocale } : {}), ...(translations ? { translations } : {}), ...(description ? { description } : {}), ...(previewUrl ? { previewUrl } : {}), ...(sourceUrl ? { sourceUrl } : {}) }
  return JSON.stringify(envelope)
}

function decodePrompt(row: PromptRow, version: number): PromptAsset {
  let content = row.content
  let kind: PromptAssetKind = 'prompt'
  let tags: string[] = []
  let favorite = false
  let source: PromptAssetSource | undefined
  let collection = '个人'
  let category = '未分类'
  let previewUrl: string | undefined
  let sourceUrl: string | undefined
  let primaryLocale: PromptAsset['primaryLocale']
  let translations: PromptAsset['translations']
  let description: string | undefined
  try {
    const parsed = JSON.parse(row.content) as Partial<PromptEnvelope>
    if (parsed.marker === PROMPT_MARKER && typeof parsed.content === 'string') {
      content = parsed.content
      kind = validKind(parsed.kind)
      tags = normalizeTags(parsed.tags)
      favorite = parsed.favorite === true
      source = validSource(parsed.source)
      collection = optionalText(parsed.collection, '提示词分组', 120) ?? collection
      category = optionalText(parsed.category, '提示词分类', 120) ?? category
      previewUrl = optionalText(parsed.previewUrl, '提示词预览地址', 2_000)
      sourceUrl = optionalText(parsed.sourceUrl, '提示词来源地址', 2_000)
      primaryLocale = promptLocale(parsed.primaryLocale)
      translations = promptTranslations(parsed.translations)
      description = optionalText(parsed.description, '使用说明', 10_000)
      const deletedAt = optionalText(parsed.deletedAt, '删除时间', 80)
      if (deletedAt) return { ...decodePrompt({ ...row, content: parsed.content }, version), deletedAt }
    }
  } catch {
    // Plain prompt text is intentionally not required to be JSON.
  }
  return {
    id: row.id,
    name: row.name,
    content,
    kind,
    scope: 'global',
    version,
    tags,
    favorite,
    collection,
    category,
    ...(source ? { source } : {}),
    ...(previewUrl ? { previewUrl } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(primaryLocale ? { primaryLocale } : {}),
    ...(translations ? { translations } : {}),
    ...(description ? { description } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function decodeMemory(row: MemoryRow, version: number): MemoryEntry {
  let content = row.content
  let active = true
  let category: MemoryEntry['category']
  let source: string | undefined
  let lastUsedAt: string | undefined
  try {
    const parsed = JSON.parse(row.content) as Partial<MemoryEnvelope>
    if (parsed.marker === MEMORY_MARKER && typeof parsed.content === 'string') {
      content = parsed.content
      active = parsed.active !== false
      category = isMemoryCategory(parsed.category) ? parsed.category : undefined
      source = optionalText(parsed.source, '记忆来源', 500)
      lastUsedAt = optionalText(parsed.lastUsedAt, '最近使用时间', 80)
      const deletedAt = optionalText(parsed.deletedAt, '删除时间', 80)
      if (deletedAt) return { ...decodeMemory({ ...row, content: parsed.content }, version), deletedAt }
    }
  } catch {
    // Existing rows contain plain memory text.
  }
  return {
    id: row.id,
    title: row.title,
    content,
    scope: 'global',
    version,
    active,
    ...(category ? { category } : {}),
    ...(source ? { source } : {}),
    ...(lastUsedAt ? { lastUsedAt } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function versionsFromRows(rows: Array<{ id: string; name: string; row_id?: number }>): Map<string, number> {
  const counters = new Map<string, number>()
  const versions = new Map<string, number>()
  for (const row of [...rows].sort((a, b) => (a.row_id ?? 0) - (b.row_id ?? 0))) {
    const version = (counters.get(row.name) ?? 0) + 1
    counters.set(row.name, version)
    versions.set(row.id, version)
  }
  return versions
}

function searchMatch(value: string, search: string | undefined): boolean {
  return !search || value.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
}

function ensureGlobalScope(scope: unknown): void {
  if (scope !== undefined && assertScope(scope) !== 'global') throw new LibraryError('invalid-scope', '全局存储只能保存 global 范围内容')
}

/** Persists global prompt assets in the existing global_prompts table. */
export class GlobalPromptStore implements PromptAssetStore {
  private writeChain: Promise<unknown> = Promise.resolve()

  constructor(private readonly database: GlobalDatabase) {}

  async list(input: ListPromptAssetsInput = {}): Promise<PromptAsset[]> {
    ensureGlobalScope(input.scope)
    const rows = this.database.all<PromptRow>('SELECT rowid AS row_id, id, name, content, created_at, updated_at FROM global_prompts ORDER BY updated_at DESC, rowid DESC')
    const decoded = rows.map((row) => decodePrompt(row, 0))
    const versions = versionsFromRows(rows.map((row) => ({ id: row.id, name: row.name, row_id: row.row_id })))
    return decoded
      .map((item) => ({ ...item, version: versions.get(item.id) ?? 1 }))
      .filter((item) => !item.deletedAt && (input.kind ? item.kind === input.kind : true) && searchMatch(`${item.name}\n${item.content}\n${item.translations?.['zh-CN'] ?? ''}\n${item.translations?.en ?? ''}\n${item.description ?? ''}\n${item.collection}\n${item.category}\n${item.tags.join(' ')}`, input.search))
  }

  async listPage(input: ListPromptPageInput = {}): Promise<PromptPage> {
    ensureGlobalScope(input.scope)
    const offset = Math.max(0, Math.trunc(input.offset ?? 0))
    const limit = Math.min(100, Math.max(1, Math.trunc(input.limit ?? 60)))
    const search = input.search?.trim()
    const pattern = search ? `%${search.replaceAll('%', '\\%').replaceAll('_', '\\_')}%` : undefined
    const envelope = "CASE WHEN json_valid(content) THEN content ELSE '{}' END"
    const conditions = [`COALESCE(json_extract(${envelope}, '$.deletedAt'), '') = ''`]
    const params: Array<string | number> = []
    if (pattern) {
      conditions.push(`(name LIKE ? ESCAPE '\\' OR COALESCE(json_extract(${envelope}, '$.content'), content) LIKE ? ESCAPE '\\' OR COALESCE(json_extract(${envelope}, '$.translations.zh-CN'), '') LIKE ? ESCAPE '\\' OR COALESCE(json_extract(${envelope}, '$.translations.en'), '') LIKE ? ESCAPE '\\' OR COALESCE(json_extract(${envelope}, '$.description'), '') LIKE ? ESCAPE '\\' OR COALESCE(json_extract(${envelope}, '$.collection'), '') LIKE ? ESCAPE '\\' OR COALESCE(json_extract(${envelope}, '$.category'), '') LIKE ? ESCAPE '\\')`)
      params.push(pattern, pattern, pattern, pattern, pattern, pattern, pattern)
    }
    if (input.kind) { conditions.push(`COALESCE(json_extract(${envelope}, '$.kind'), 'prompt') = ?`); params.push(input.kind) }
    if (input.category && input.category !== 'all') { conditions.push(`COALESCE(json_extract(${envelope}, '$.category'), '未分类') = ?`); params.push(input.category) }
    if (input.favoriteOnly) conditions.push(`COALESCE(json_extract(${envelope}, '$.favorite'), 0) = 1`)
    if (input.source === 'mine') conditions.push(`COALESCE(json_extract(${envelope}, '$.source'), 'manual') <> 'import'`)
    else if (input.source === 'open-source') conditions.push(`json_extract(${envelope}, '$.source') = 'import'`)
    else if (input.source && input.source !== 'all') {
      conditions.push(`EXISTS (SELECT 1 FROM json_each(json_extract(${envelope}, '$.tags')) WHERE value = ?)`)
      params.push(input.source)
    }
    const where = `WHERE ${conditions.join(' AND ')}`
    const total = this.database.all<{ count: number }>(`SELECT COUNT(*) AS count FROM global_prompts ${where}`, ...params)[0]?.count ?? 0
    const rows = this.database.all<PromptRow & { version: number }>(`SELECT rowid AS row_id, id, name, content, created_at, updated_at, (SELECT COUNT(*) FROM global_prompts versioned WHERE versioned.name = global_prompts.name AND versioned.rowid <= global_prompts.rowid) AS version FROM global_prompts ${where} ORDER BY CASE WHEN COALESCE(json_extract(${envelope}, '$.source'), 'manual') <> 'import' THEN 0 WHEN COALESCE(json_extract(${envelope}, '$.previewUrl'), '') <> '' THEN 1 ELSE 2 END, updated_at DESC, rowid DESC LIMIT ? OFFSET ?`, ...params, limit, offset)
    const items = rows.map((row) => decodePrompt(row, row.version))
    const categories = this.database.all<{ category: string }>(`SELECT DISTINCT COALESCE(json_extract(${envelope}, '$.category'), '未分类') AS category FROM global_prompts WHERE COALESCE(json_extract(${envelope}, '$.deletedAt'), '') = '' ORDER BY category`).map((row) => row.category)
    return { items, total, offset, limit, hasMore: offset + items.length < total, categories }
  }

  async listForSearchIndex(afterRowId = 0, limit = 20): Promise<PromptSearchIndexPage> {
    const pageSize = Math.min(100, Math.max(1, Math.trunc(limit)))
    const rows = this.database.all<PromptRow>('SELECT rowid AS row_id,id,name,content,created_at,updated_at FROM global_prompts WHERE rowid > ? ORDER BY rowid LIMIT ?', Math.max(0, Math.trunc(afterRowId)), pageSize)
    return {
      items: rows.map((row) => decodePrompt(row, 1)).filter((item) => !item.deletedAt),
      nextCursor: rows.length === pageSize ? rows.at(-1)?.row_id ?? null : null,
    }
  }

  async listImportedBySource(input: { tag: string; collections: readonly string[]; sourceKeys?: readonly string[] }): Promise<PromptAsset[]> {
    const envelope = "CASE WHEN json_valid(content) THEN content ELSE '{}' END"
    const sourceConditions = [`EXISTS (SELECT 1 FROM json_each(json_extract(${envelope}, '$.tags')) WHERE value = ?)`]
    const params: string[] = [input.tag]
    if (input.collections.length) {
      sourceConditions.push(`json_extract(${envelope}, '$.collection') IN (${input.collections.map(() => '?').join(',')})`)
      params.push(...input.collections)
    }
    const conditions = [
      `json_extract(${envelope}, '$.marker') = ?`,
      `json_extract(${envelope}, '$.source') = 'import'`,
      `COALESCE(json_extract(${envelope}, '$.deletedAt'), '') = ''`,
      `(${sourceConditions.join(' OR ')})`,
    ]
    params.unshift(PROMPT_MARKER)
    if (input.sourceKeys?.length) {
      conditions.push(`EXISTS (SELECT 1 FROM json_each(json_extract(${envelope}, '$.tags')) WHERE value IN (${input.sourceKeys.map(() => '?').join(',')}))`)
      params.push(...input.sourceKeys)
    }
    const rows = this.database.all<PromptRow>(`SELECT id, name, content, created_at, updated_at FROM global_prompts WHERE ${conditions.join(' AND ')} ORDER BY updated_at DESC`, ...params)
    return rows.map((row) => decodePrompt(row, 1))
  }

  countImportedBySource(input: { tag: string; collections: readonly string[] }): number {
    const envelope = "CASE WHEN json_valid(content) THEN content ELSE '{}' END"
    const sourceConditions = [`EXISTS (SELECT 1 FROM json_each(json_extract(${envelope}, '$.tags')) WHERE value = ?)`]
    const params: string[] = [PROMPT_MARKER, input.tag]
    if (input.collections.length) {
      sourceConditions.push(`json_extract(${envelope}, '$.collection') IN (${input.collections.map(() => '?').join(',')})`)
      params.push(...input.collections)
    }
    return this.database.all<{ count: number }>(`SELECT COUNT(*) AS count FROM global_prompts WHERE json_extract(${envelope}, '$.marker') = ? AND json_extract(${envelope}, '$.source') = 'import' AND COALESCE(json_extract(${envelope}, '$.deletedAt'), '') = '' AND (${sourceConditions.join(' OR ')})`, ...params)[0]?.count ?? 0
  }

  async get(input: { id: string; scope: 'global' | 'project'; projectRoot?: string }): Promise<PromptAsset | null> {
    ensureGlobalScope(input.scope)
    const id = validId(input.id)
    const row = this.database.all<PromptRow>('SELECT rowid AS row_id, id, name, content, created_at, updated_at FROM global_prompts WHERE id = ?', id)[0]
    if (!row) return null
    const version = this.database.all<{ count: number }>('SELECT COUNT(*) AS count FROM global_prompts WHERE name = ? AND rowid <= ?', row.name, row.row_id ?? 0)[0]?.count ?? 1
    const item = decodePrompt(row, version)
    return item.deletedAt ? null : item
  }

  async save(input: SavePromptAssetInput): Promise<PromptAsset> {
    ensureGlobalScope(input.scope)
    const name = requiredText(input.name, '提示词名称', 200)
    const content = requiredText(input.content, '提示词内容', 200_000)
    const encodedContent = encodePrompt({ ...input, name, content, scope: 'global' })
    return this.enqueue(() => {
      const now = new Date().toISOString()
      const id = randomUUID()
      this.database.run('INSERT INTO global_prompts (id, name, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', id, name, encodedContent, now, now)
      const row = this.database.all<PromptRow>('SELECT id, name, content, created_at, updated_at FROM global_prompts WHERE id = ?', id)[0]
      if (!row) throw new LibraryError('read-failed', '提示词保存后无法读取')
      const count = this.database.all<{ count: number }>('SELECT COUNT(*) AS count FROM global_prompts WHERE name = ?', name)[0]?.count ?? 1
      const saved = decodePrompt(row, count)
      upsertPromptSearchDocument(this.database, saved)
      return saved
    })
  }

  quickSave(input: SavePromptAssetInput): Promise<PromptAsset> { return this.save(input) }

  async update(input: UpdatePromptAssetInput): Promise<PromptAsset> {
    ensureGlobalScope(input.scope)
    const id = validId(input.id)
    return this.enqueue(() => {
      const current = this.database.all<PromptRow>('SELECT id, name, content, created_at, updated_at FROM global_prompts WHERE id = ?', id)[0]
      if (!current) throw new LibraryError('not-found', '提示词不存在')
      const old = decodePrompt(current, 1)
      const name = input.name === undefined ? old.name : requiredText(input.name, '提示词名称', 200)
      const content = input.content === undefined ? old.content : requiredText(input.content, '提示词内容', 200_000)
      const encoded = encodePrompt({
        scope: 'global', name, content,
        kind: input.kind === undefined ? old.kind : input.kind,
        tags: input.tags === undefined ? old.tags : input.tags,
        favorite: input.favorite === undefined ? old.favorite : input.favorite,
        ...(input.source === undefined ? (old.source ? { source: old.source } : {}) : { source: input.source }),
        collection: input.collection === undefined ? old.collection : input.collection,
        category: input.category === undefined ? old.category : input.category,
        primaryLocale: input.primaryLocale === undefined ? old.primaryLocale : input.primaryLocale,
        translations: input.translations === undefined ? old.translations : input.translations,
        description: input.description === undefined ? old.description : input.description ?? undefined,
        previewUrl: input.previewUrl === undefined ? old.previewUrl : input.previewUrl ?? undefined,
        sourceUrl: input.sourceUrl === undefined ? old.sourceUrl : input.sourceUrl ?? undefined,
      })
      const now = new Date().toISOString()
      this.database.run('UPDATE global_prompts SET name = ?, content = ?, updated_at = ? WHERE id = ?', name, encoded, now, id)
      const updated = this.database.all<PromptRow>('SELECT id, name, content, created_at, updated_at FROM global_prompts WHERE id = ?', id)[0]
      if (!updated) throw new LibraryError('read-failed', '提示词更新后无法读取')
      const saved = decodePrompt(updated, old.version)
      upsertPromptSearchDocument(this.database, saved)
      return saved
    })
  }

  async remove(input: { id: string; scope: 'global' | 'project'; projectRoot?: string }): Promise<void> {
    ensureGlobalScope(input.scope)
    const id = validId(input.id)
    return this.enqueue(() => {
      const existing = this.database.all<{ id: string }>('SELECT id FROM global_prompts WHERE id = ?', id)[0]
      if (!existing) throw new LibraryError('not-found', '提示词不存在')
      const current = this.database.all<PromptRow>('SELECT id, name, content, created_at, updated_at FROM global_prompts WHERE id = ?', id)[0]
      if (!current) throw new LibraryError('not-found', '提示词不存在')
      const old = decodePrompt(current, 1)
      if (old.deletedAt) throw new LibraryError('not-found', '提示词不存在')
      const encoded = encodePrompt({ scope: 'global', name: old.name, content: old.content, kind: old.kind, tags: old.tags, favorite: old.favorite, ...(old.source ? { source: old.source } : {}), collection: old.collection, category: old.category, ...(old.primaryLocale ? { primaryLocale: old.primaryLocale } : {}), ...(old.translations ? { translations: old.translations } : {}), ...(old.description ? { description: old.description } : {}), ...(old.previewUrl ? { previewUrl: old.previewUrl } : {}), ...(old.sourceUrl ? { sourceUrl: old.sourceUrl } : {}) })
      this.database.run('UPDATE global_prompts SET content = ?, updated_at = ? WHERE id = ?', JSON.stringify({ ...JSON.parse(encoded), deletedAt: new Date().toISOString() }), new Date().toISOString(), id)
      removePromptSearchDocument(this.database, id)
    })
  }

  async restore(input: { id: string; scope: 'global' | 'project' }): Promise<void> {
    ensureGlobalScope(input.scope)
    const id = validId(input.id)
    return this.enqueue(() => {
      const row = this.database.all<PromptRow>('SELECT id, name, content, created_at, updated_at FROM global_prompts WHERE id = ?', id)[0]
      if (!row || !decodePrompt(row, 1).deletedAt) throw new LibraryError('not-found', '已删除提示词不存在')
      const parsed = JSON.parse(row.content) as PromptEnvelope
      delete parsed.deletedAt
      const updatedAt = new Date().toISOString()
      this.database.run('UPDATE global_prompts SET content = ?, updated_at = ? WHERE id = ?', JSON.stringify(parsed), updatedAt, id)
      upsertPromptSearchDocument(this.database, decodePrompt({ ...row, content: JSON.stringify(parsed), updated_at: updatedAt }, 1))
    })
  }

  private enqueue<T>(operation: () => T): Promise<T> {
    const next = this.writeChain.then(operation, operation)
    this.writeChain = next.then(() => undefined, () => undefined)
    return next
  }
}

/** Persists global memory entries in the existing memory_entries table. */
export class GlobalMemoryStore implements MemoryEntryStore {
  private writeChain: Promise<unknown> = Promise.resolve()

  constructor(private readonly database: GlobalDatabase) {}

  async list(input: ListMemoryEntriesInput = {}): Promise<MemoryEntry[]> {
    ensureGlobalScope(input.scope)
    const rows = this.database.all<MemoryRow>('SELECT rowid AS row_id, id, title, content, created_at, updated_at FROM memory_entries ORDER BY updated_at DESC, rowid DESC')
    const decoded = rows.map((row) => decodeMemory(row, 0))
    const versions = versionsFromRows(rows.map((row) => ({ id: row.id, name: row.title, row_id: row.row_id })))
    return decoded
      .map((item) => ({ ...item, version: versions.get(item.id) ?? 1 }))
      .filter((item) => !item.deletedAt && (!input.activeOnly || item.active) && searchMatch(`${item.title}\n${item.content}`, input.search))
  }

  async get(input: { id: string; scope: 'global' | 'project'; projectRoot?: string }): Promise<MemoryEntry | null> {
    ensureGlobalScope(input.scope)
    const id = validId(input.id)
    const row = this.database.all<MemoryRow>('SELECT id, title, content, created_at, updated_at FROM memory_entries WHERE id = ?', id)[0]
    if (!row) return null
    const items = await this.list()
    return items.find((item) => item.id === row.id && !item.deletedAt) ?? null
  }

  async save(input: SaveMemoryEntryInput): Promise<MemoryEntry> {
    ensureGlobalScope(input.scope)
    const title = requiredText(input.title, '记忆标题', 200)
    const content = requiredText(input.content, '记忆内容', 200_000)
    const source = optionalText(input.source, '记忆来源', 500)
    const category = input.category
    const active = input.active !== false
    return this.enqueue(() => {
      const now = new Date().toISOString()
      const id = randomUUID()
      const storedContent = active && category === undefined && source === undefined
        ? content
        : JSON.stringify({ marker: MEMORY_MARKER, content, active, ...(category ? { category } : {}), ...(source ? { source } : {}) } satisfies MemoryEnvelope)
      this.database.run('INSERT INTO memory_entries (id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', id, title, storedContent, now, now)
      const row = this.database.all<MemoryRow>('SELECT id, title, content, created_at, updated_at FROM memory_entries WHERE id = ?', id)[0]
      if (!row) throw new LibraryError('read-failed', '记忆保存后无法读取')
      const count = this.database.all<{ count: number }>('SELECT COUNT(*) AS count FROM memory_entries WHERE title = ?', title)[0]?.count ?? 1
      return decodeMemory(row, count)
    })
  }

  async update(input: UpdateMemoryEntryInput): Promise<MemoryEntry> {
    ensureGlobalScope(input.scope)
    const id = validId(input.id)
    return this.enqueue(() => {
      const current = this.database.all<MemoryRow>('SELECT id, title, content, created_at, updated_at FROM memory_entries WHERE id = ?', id)[0]
      if (!current) throw new LibraryError('not-found', '记忆不存在')
      const old = decodeMemory(current, 1)
      const title = input.title === undefined ? old.title : requiredText(input.title, '记忆标题', 200)
      const content = input.content === undefined ? old.content : requiredText(input.content, '记忆内容', 200_000)
      const active = input.active === undefined ? old.active : input.active
      if (typeof active !== 'boolean') throw new LibraryError('invalid-input', '记忆状态必须是布尔值')
      const source = input.source === undefined ? old.source : optionalText(input.source, '记忆来源', 500)
      const category = input.category === undefined ? old.category : input.category
      const lastUsedAt = input.lastUsedAt === undefined ? old.lastUsedAt : optionalText(input.lastUsedAt, '最近使用时间', 80)
      const now = new Date().toISOString()
      const storedContent = active && category === undefined && source === undefined && lastUsedAt === undefined
        ? content
        : JSON.stringify({ marker: MEMORY_MARKER, content, active, ...(category ? { category } : {}), ...(source ? { source } : {}), ...(lastUsedAt ? { lastUsedAt } : {}) } satisfies MemoryEnvelope)
      this.database.run('UPDATE memory_entries SET title = ?, content = ?, updated_at = ? WHERE id = ?', title, storedContent, now, id)
      const updated = this.database.all<MemoryRow>('SELECT id, title, content, created_at, updated_at FROM memory_entries WHERE id = ?', id)[0]
      if (!updated) throw new LibraryError('read-failed', '记忆更新后无法读取')
      return decodeMemory(updated, old.version)
    })
  }

  async remove(input: { id: string; scope: 'global' | 'project'; projectRoot?: string }): Promise<void> {
    ensureGlobalScope(input.scope)
    const id = validId(input.id)
    return this.enqueue(() => {
      if (!this.database.all<{ id: string }>('SELECT id FROM memory_entries WHERE id = ?', id)[0]) throw new LibraryError('not-found', '记忆不存在')
      const current = this.database.all<MemoryRow>('SELECT id, title, content, created_at, updated_at FROM memory_entries WHERE id = ?', id)[0]
      if (!current) throw new LibraryError('not-found', '记忆不存在')
      const old = decodeMemory(current, 1)
      if (old.deletedAt) throw new LibraryError('not-found', '记忆不存在')
      const content = JSON.stringify({ marker: MEMORY_MARKER, content: old.content, active: old.active, ...(old.category ? { category: old.category } : {}), ...(old.source ? { source: old.source } : {}), ...(old.lastUsedAt ? { lastUsedAt: old.lastUsedAt } : {}), deletedAt: new Date().toISOString() } satisfies MemoryEnvelope)
      this.database.run('UPDATE memory_entries SET content = ?, updated_at = ? WHERE id = ?', content, new Date().toISOString(), id)
    })
  }

  async restore(input: { id: string; scope: 'global' }): Promise<void> {
    ensureGlobalScope(input.scope)
    const id = validId(input.id)
    return this.enqueue(() => {
      const row = this.database.all<MemoryRow>('SELECT id, title, content, created_at, updated_at FROM memory_entries WHERE id = ?', id)[0]
      if (!row || !decodeMemory(row, 1).deletedAt) throw new LibraryError('not-found', '已删除记忆不存在')
      const parsed = JSON.parse(row.content) as MemoryEnvelope
      delete parsed.deletedAt
      this.database.run('UPDATE memory_entries SET content = ?, updated_at = ? WHERE id = ?', JSON.stringify(parsed), new Date().toISOString(), id)
    })
  }

  private enqueue<T>(operation: () => T): Promise<T> {
    const next = this.writeChain.then(operation, operation)
    this.writeChain = next.then(() => undefined, () => undefined)
    return next
  }
}

export const SqlitePromptAssetStore = GlobalPromptStore
export const SqliteMemoryEntryStore = GlobalMemoryStore
export const GlobalPromptAssetStore = GlobalPromptStore
export const GlobalMemoryEntryStore = GlobalMemoryStore
