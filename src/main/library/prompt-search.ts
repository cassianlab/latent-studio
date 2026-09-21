import { createHash, randomUUID } from 'node:crypto'
import type { PromptSearchResult } from '../../shared/contracts/agent'
import type { EmbeddingModelStatus, PromptAsset } from '../../shared/contracts/library'
import { PROMPT_SEARCH_FTS_SCHEMA, type GlobalDatabase } from '../config'
import { canonicalPromptContent as canonical, normalizePromptSearchText as normalize, promptSearchEvidence as evidence, promptSearchGrams as grams, promptSearchTerms as terms, rankPromptAssets } from '../../shared/prompt-ranking'

export { rankPromptAssets } from '../../shared/prompt-ranking'

const LEXICAL_INDEX_KEY = 'prompt_search_lexical_version'
const LEXICAL_INDEX_VERSION = '4'
const SEARCH_INDEX_CONTENT_LENGTH = 2_000
const SEARCH_INDEX_CJK_GRAM_LIMIT = 96
const MIN_VECTOR_SIMILARITY = 0.32
const LEXICAL_REBUILD_BATCH_SIZE = 20

export interface EmbeddingProviderDescriptor { modelId: string; version: string; sourceUrl: string; license: string; dimensions: number }
export interface EmbeddingProvider {
  descriptor: EmbeddingProviderDescriptor
  install(): Promise<{ installPath: string; diskBytes: number }>
  isInstalled(): Promise<boolean>
  embed(texts: readonly string[]): Promise<number[][]>
  uninstall(): Promise<void>
}

interface SearchRow {
  prompt_id: string; title: string; content: string; category: string; collection_name: string; tags: string
  favorite: number; kind: PromptAsset['kind']; preview_url: string | null; source_url: string | null; content_hash: string; updated_at: string
  _primaryLocale?: PromptAsset['primaryLocale']; _translations?: PromptAsset['translations']; _description?: string
}
interface VectorRow { item_id: string; vector_blob: Uint8Array }

function hash(item: PromptAsset): string { return createHash('sha256').update([item.name, item.content, item.translations?.['zh-CN'] ?? '', item.translations?.en ?? '', item.description ?? '', item.category, item.collection, item.tags.join('\n'), String(item.favorite), item.kind].join('\0')).digest('hex') }
function toBytes(values: readonly number[]): Uint8Array { return new Uint8Array(Float32Array.from(values).buffer.slice(0)) }
function fromBytes(value: Uint8Array): Float32Array {
  if (value.byteOffset % Float32Array.BYTES_PER_ELEMENT === 0) return new Float32Array(value.buffer, value.byteOffset, value.byteLength / Float32Array.BYTES_PER_ELEMENT)
  return new Float32Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength))
}
function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length || !a.length) return 0
  let dot = 0; let an = 0; let bn = 0
  for (let i = 0; i < a.length; i += 1) { dot += a[i] * b[i]; an += a[i] ** 2; bn += b[i] ** 2 }
  return an && bn ? dot / Math.sqrt(an * bn) : 0
}
function asset(row: SearchRow): PromptAsset {
  return { id: row.prompt_id, name: row.title, content: row.content, kind: row.kind, scope: 'global', version: 1, tags: row.tags ? row.tags.split('\n').filter(Boolean) : [], favorite: row.favorite === 1, collection: row.collection_name, category: row.category, ...(row._primaryLocale ? { primaryLocale: row._primaryLocale } : {}), ...(row._translations ? { translations: row._translations } : {}), ...(row._description ? { description: row._description } : {}), ...(row.preview_url ? { previewUrl: row.preview_url } : {}), ...(row.source_url ? { sourceUrl: row.source_url } : {}), createdAt: row.updated_at, updatedAt: row.updated_at }
}

interface StoredPromptRow { id: string; name: string; content: string; created_at: string; updated_at: string }

function hydrateSearchRow(row: SearchRow, stored: StoredPromptRow): SearchRow {
  let content = stored.content
  let kind: PromptAsset['kind'] = 'prompt'
  let tags: string[] = []
  let favorite = false
  let collection = '个人'
  let category = '未分类'
  let previewUrl: string | null = null
  let sourceUrl: string | null = null
  let primaryLocale: PromptAsset['primaryLocale']
  let translations: PromptAsset['translations']
  let description: string | undefined
  try {
    const parsed = JSON.parse(stored.content) as Record<string, unknown>
    if (parsed.marker === 'latent-studio-prompt-v1' && typeof parsed.content === 'string') {
      content = parsed.content
      if (parsed.kind === 'prompt' || parsed.kind === 'template' || parsed.kind === 'style') kind = parsed.kind
      if (Array.isArray(parsed.tags)) tags = parsed.tags.filter((tag): tag is string => typeof tag === 'string')
      favorite = parsed.favorite === true
      if (typeof parsed.collection === 'string' && parsed.collection) collection = parsed.collection
      if (typeof parsed.category === 'string' && parsed.category) category = parsed.category
      if (typeof parsed.previewUrl === 'string') previewUrl = parsed.previewUrl
      if (typeof parsed.sourceUrl === 'string') sourceUrl = parsed.sourceUrl
      if (parsed.primaryLocale === 'zh-CN' || parsed.primaryLocale === 'en' || parsed.primaryLocale === 'und') primaryLocale = parsed.primaryLocale
      if (parsed.translations && typeof parsed.translations === 'object') {
        const value = parsed.translations as Record<string, unknown>
        translations = { ...(typeof value['zh-CN'] === 'string' ? { 'zh-CN': value['zh-CN'] } : {}), ...(typeof value.en === 'string' ? { en: value.en } : {}) }
      }
      if (typeof parsed.description === 'string') description = parsed.description
    }
  } catch {
    // Legacy prompt rows may contain plain text.
  }
  return { ...row, title: stored.name, content, category, collection_name: collection, tags: tags.join('\n'), favorite: favorite ? 1 : 0, kind, preview_url: previewUrl, source_url: sourceUrl, updated_at: stored.updated_at, _primaryLocale: primaryLocale, _translations: translations, _description: description } as SearchRow
}

export function upsertPromptSearchDocument(database: GlobalDatabase, item: PromptAsset): void {
  const itemHash = hash(item)
  database.run('INSERT INTO prompt_search_documents (prompt_id,title,content,category,collection_name,tags,favorite,kind,preview_url,source_url,content_hash,updated_at) VALUES (?,\'\',\'\',\'\',\'\',\'\',0,?,NULL,NULL,?,?) ON CONFLICT(prompt_id) DO UPDATE SET title=\'\',content=\'\',category=\'\',collection_name=\'\',tags=\'\',favorite=0,kind=excluded.kind,preview_url=NULL,source_url=NULL,content_hash=excluded.content_hash,updated_at=excluded.updated_at', item.id, item.kind, itemHash, item.updatedAt)
  const rowId = database.all<{ row_id: number }>('SELECT rowid AS row_id FROM prompt_search_documents WHERE prompt_id = ?', item.id)[0]?.row_id
  if (rowId === undefined) return
  database.run('DELETE FROM prompt_search_fts WHERE rowid = ?', rowId)
  const indexedContent = [item.content, item.translations?.['zh-CN'], item.translations?.en, item.description].filter(Boolean).join('\n').slice(0, SEARCH_INDEX_CONTENT_LENGTH)
  const indexedText = `${item.name} ${item.category} ${item.collection} ${item.tags.join(' ')} ${indexedContent}`
  database.run('INSERT INTO prompt_search_fts (rowid,title,category,collection_name,tags,content,cjk_terms) VALUES (?,?,?,?,?,?,?)', rowId, item.name, item.category, item.collection, item.tags.join(' '), indexedContent, [...new Set(grams(indexedText, SEARCH_INDEX_CJK_GRAM_LIMIT))].join(' '))
}

export function removePromptSearchDocument(database: GlobalDatabase, id: string): void {
  const rowId = database.all<{ row_id: number }>('SELECT rowid AS row_id FROM prompt_search_documents WHERE prompt_id = ?', id)[0]?.row_id
  if (rowId !== undefined) database.run('DELETE FROM prompt_search_fts WHERE rowid = ?', rowId)
  database.run('DELETE FROM prompt_search_documents WHERE prompt_id = ?', id)
  database.run('DELETE FROM prompt_embeddings WHERE item_id = ?', id)
}
export function mergeSearchablePromptAssets(globalItems: readonly PromptAsset[], projectItems: readonly PromptAsset[] = []): PromptAsset[] {
  const result: PromptAsset[] = []
  const ids = new Set<string>()
  for (const item of [...projectItems, ...globalItems]) {
    if (item.deletedAt || ids.has(item.id)) continue
    ids.add(item.id)
    result.push(item)
  }
  return result
}

export interface PromptSearchServiceOptions {
  database: GlobalDatabase
  listGlobalPrompts: () => Promise<PromptAsset[]>
  listGlobalPromptPage?: (afterRowId: number, limit: number) => Promise<{ items: PromptAsset[]; nextCursor: number | null }>
  listProjectPrompts?: () => Promise<PromptAsset[]>
  embeddingProvider?: EmbeddingProvider
}

export class PromptSearchService {
  private refresh?: Promise<void>
  constructor(private readonly options: PromptSearchServiceOptions) {}
  private async index(): Promise<void> {
    const current = this.options.database.all<{ value: string }>('SELECT value FROM schema_meta WHERE key = ?', LEXICAL_INDEX_KEY)[0]?.value
    if (current === LEXICAL_INDEX_VERSION) return
    if (this.refresh) return this.refresh
    this.refresh = this.rebuildLexical().finally(() => { this.refresh = undefined }); return this.refresh
  }
  private async rebuildLexical(): Promise<void> {
    this.options.database.exec(PROMPT_SEARCH_FTS_SCHEMA)
    const old = new Map(this.options.database.all<{ prompt_id: string; content_hash: string }>('SELECT prompt_id, content_hash FROM prompt_search_documents').map((row) => [row.prompt_id, row.content_hash]))
    const live = new Set<string>()
    const writeBatch = async (items: readonly PromptAsset[]) => {
      for (const item of items) live.add(item.id)
      this.options.database.exec('BEGIN IMMEDIATE')
      try {
        for (const item of items) upsertPromptSearchDocument(this.options.database, item)
        this.options.database.exec('COMMIT')
      } catch (error) { this.options.database.exec('ROLLBACK'); throw error }
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
    if (this.options.listGlobalPromptPage) {
      let cursor = 0
      while (true) {
        const page = await this.options.listGlobalPromptPage(cursor, LEXICAL_REBUILD_BATCH_SIZE)
        if (page.items.length) await writeBatch(page.items)
        if (page.nextCursor === null) break
        cursor = page.nextCursor
      }
    } else {
      const items = await this.options.listGlobalPrompts()
      for (let offset = 0; offset < items.length; offset += LEXICAL_REBUILD_BATCH_SIZE) {
        await writeBatch(items.slice(offset, offset + LEXICAL_REBUILD_BATCH_SIZE))
      }
    }
    const removed = [...old.keys()].filter((id) => !live.has(id))
    for (let offset = 0; offset < removed.length; offset += LEXICAL_REBUILD_BATCH_SIZE) {
      this.options.database.exec('BEGIN IMMEDIATE')
      try {
        for (const id of removed.slice(offset, offset + LEXICAL_REBUILD_BATCH_SIZE)) removePromptSearchDocument(this.options.database, id)
        this.options.database.exec('COMMIT')
      } catch (error) { this.options.database.exec('ROLLBACK'); throw error }
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
    this.options.database.run(
      'INSERT INTO schema_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      LEXICAL_INDEX_KEY,
      LEXICAL_INDEX_VERSION,
    )
  }
  private model() { const provider = this.options.embeddingProvider; return provider ? this.options.database.all<{ status: string; active: number }>('SELECT status, active FROM embedding_models WHERE model_id = ?', provider.descriptor.modelId)[0] : undefined }
  private hydrate(rows: SearchRow[]): SearchRow[] {
    if (!rows.length) return rows
    const stored: StoredPromptRow[] = []
    for (let offset = 0; offset < rows.length; offset += 500) {
      const batch = rows.slice(offset, offset + 500)
      stored.push(...this.options.database.all<StoredPromptRow>(`SELECT id,name,content,created_at,updated_at FROM global_prompts WHERE id IN (${batch.map(() => '?').join(',')})`, ...batch.map((row) => row.prompt_id)))
    }
    const byId = new Map(stored.map((item) => [item.id, item]))
    return rows.map((row) => byId.has(row.prompt_id) ? hydrateSearchRow(row, byId.get(row.prompt_id) as StoredPromptRow) : row)
  }
  private rows(query: string, limit: number): SearchRow[] {
    const expression = terms(query).slice(0, 48).map((term) => `"${term.replaceAll('"', '""')}"`).join(' OR '); if (!expression) return []
    return this.hydrate(this.options.database.all<SearchRow>(`SELECT d.* FROM prompt_search_fts JOIN prompt_search_documents d ON d.rowid=prompt_search_fts.rowid WHERE prompt_search_fts MATCH ? ORDER BY bm25(prompt_search_fts,8,6,3,3,2,1) LIMIT ?`, expression, limit))
  }
  private async vectors(query: string): Promise<Map<string, number>> {
    const provider = this.options.embeddingProvider; const model = this.model(); if (!provider || !model || model.status !== 'ready' || model.active !== 1 || !(await provider.isInstalled())) return new Map()
    const [queryVector] = await provider.embed([query]); const rows = this.options.database.all<VectorRow>('SELECT item_id,vector_blob FROM prompt_embeddings WHERE model_id=? AND model_version=? AND status=?', provider.descriptor.modelId, provider.descriptor.version, 'ready')
    return new Map(rows.map((row) => [row.item_id, cosine(queryVector, fromBytes(row.vector_blob))] as const).filter((item) => item[1] >= MIN_VECTOR_SIMILARITY).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).slice(0, 48))
  }
  private async lexicalFallback(query: string, limit: number, fallbackReason: 'local_embedding_unavailable' | 'local_embedding_error'): Promise<PromptSearchResult[]> {
    await this.index()
    const queryTerms = terms(query)
    const normalizedQuery = normalize(query)
    const projectItems = this.options.listProjectPrompts ? await this.options.listProjectPrompts() : []
    const ranked = rankPromptAssets([...projectItems, ...this.rows(query, 48).map(asset)], query, limit)
    const scores = ranked.map((item) => evidence(item, query, queryTerms, normalizedQuery))
    const max = Math.max(1, ...scores.map((entry) => entry.value))
    return ranked.map((item, index) => ({
      id: item.id,
      title: item.name,
      content: item.content.slice(0, 8_000),
      category: item.category || '其他',
      type: item.kind,
      collection: item.collection,
      ...(item.previewUrl ? { thumbnailUrl: item.previewUrl } : {}),
      ...(item.sourceUrl ? { sourceUrl: item.sourceUrl } : {}),
      score: Number(Math.min(1, 0.5 + scores[index].value / max * 0.5).toFixed(4)),
      reason: scores[index].matches.slice(0, 3).join('、') || '关键词相关',
      retrievalMode: 'lexical' as const,
      fallbackReason,
    }))
  }
  async search(input: { query: string; limit?: number }): Promise<PromptSearchResult[]> {
    const requestedLimit = Number.isFinite(input.limit) ? Math.trunc(input.limit as number) : 4; const limit = Math.min(4, Math.max(1, requestedLimit)); const provider = this.options.embeddingProvider; const model = this.model()
    if (!provider || !model || model.status !== 'ready' || model.active !== 1) return this.lexicalFallback(input.query, limit, 'local_embedding_unavailable')
    let vector = new Map<string, number>(); try { vector = await this.vectors(input.query) } catch (error) { const modelId = provider.descriptor.modelId; this.options.database.run('UPDATE embedding_models SET status=?,active=0,last_error=?,last_health_check_at=? WHERE model_id=?', 'failed', error instanceof Error ? error.message : '本地向量检索失败', new Date().toISOString(), modelId); return this.lexicalFallback(input.query, limit, 'local_embedding_error') }
    if (vector.size === 0) return this.lexicalFallback(input.query, limit, 'local_embedding_unavailable')
    const lexical = this.rows(input.query, 48)
    const projectItems = this.options.listProjectPrompts ? await this.options.listProjectPrompts() : []
    const projectLexical = projectItems.map((item) => ({ item, evidence: evidence(item, input.query) })).filter((entry) => entry.evidence.value > 0).sort((a, b) => b.evidence.value - a.evidence.value || a.item.id.localeCompare(b.item.id))
    const ids = [...new Set([...lexical.map((row) => row.prompt_id), ...vector.keys()])]
    const storedRows = ids.length ? this.hydrate(this.options.database.all<SearchRow>(`SELECT * FROM prompt_search_documents WHERE prompt_id IN (${ids.map(() => '?').join(',')})`, ...ids)).map(asset) : []
    const items = mergeSearchablePromptAssets(storedRows, projectItems)
    if (!items.length) return []
    const lexicalOrder = [...projectLexical.map((entry) => entry.item.id), ...lexical.map((row) => row.prompt_id)]
    const lr = new Map([...new Set(lexicalOrder)].map((id, index) => [id, index + 1]))
    const vr = new Map([...vector.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id], i) => [id, i + 1]))
    const ranked = items.map((item) => { const ev = evidence(item, input.query); return { item, ev, rank: (lr.has(item.id) ? 1 / (60 + (lr.get(item.id) ?? 0)) : 0) + (vr.has(item.id) ? 1 / (60 + (vr.get(item.id) ?? 0)) : 0), vector: vector.get(item.id) ?? 0 } }).filter((entry) => entry.rank > 0).sort((a, b) => b.rank - a.rank || b.ev.value - a.ev.value || b.vector - a.vector || Number(b.item.favorite) - Number(a.item.favorite) || a.item.id.localeCompare(b.item.id)); const seen = new Set<string>(); const result: PromptSearchResult[] = []
    const maxRrf = 2 / 61
    for (const entry of ranked) { const key = canonical(entry.item.content); if (seen.has(key)) continue; seen.add(key); const confidence = Math.min(1, entry.rank / maxRrf); result.push({ id: entry.item.id, title: entry.item.name, content: entry.item.content.slice(0, 8000), category: entry.item.category || '其他', type: entry.item.kind, collection: entry.item.collection, ...(entry.item.previewUrl ? { thumbnailUrl: entry.item.previewUrl } : {}), ...(entry.item.sourceUrl ? { sourceUrl: entry.item.sourceUrl } : {}), score: Number(confidence.toFixed(4)), reason: entry.ev.matches.slice(0, 3).join('、') || '本地语义相似度命中', retrievalMode: 'hybrid', embeddingModel: provider.descriptor.modelId }); if (result.length >= limit) break }
    return result
  }
  async installEmbeddingModel(): Promise<EmbeddingModelStatus> { const provider = this.options.embeddingProvider; if (!provider) throw new Error('当前构建未提供本地向量模型运行时'); const d = provider.descriptor; const now = new Date().toISOString(); this.options.database.run('INSERT INTO embedding_models (model_id,version,source_url,license,status,active,last_health_check_at) VALUES (?,?,?,?,?,0,?) ON CONFLICT(model_id) DO UPDATE SET version=excluded.version,source_url=excluded.source_url,license=excluded.license,status=excluded.status,active=0,last_error=NULL', d.modelId, d.version, d.sourceUrl, d.license, 'downloading', now); try { const installed = await provider.install(); this.options.database.run('UPDATE embedding_models SET install_path=?,disk_bytes=?,status=?,installed_at=?,last_health_check_at=? WHERE model_id=?', installed.installPath, installed.diskBytes, 'installed', now, now, d.modelId) } catch (error) { this.options.database.run('UPDATE embedding_models SET status=?,last_error=? WHERE model_id=?', 'failed', error instanceof Error ? error.message : '模型安装失败', d.modelId); throw error }; return this.embeddingStatus() }
  async updateEmbeddings(operation: 'update' | 'rebuild' = 'update'): Promise<EmbeddingModelStatus> { const provider = this.options.embeddingProvider; if (!provider || !(await provider.isInstalled())) throw new Error('请先安装本地向量模型'); await this.index(); const d = provider.descriptor; if (operation === 'rebuild') this.options.database.run('DELETE FROM prompt_embeddings WHERE model_id=?', d.modelId); const pending = this.hydrate(this.options.database.all<SearchRow>('SELECT d.* FROM prompt_search_documents d LEFT JOIN prompt_embeddings e ON e.item_id=d.prompt_id AND e.model_id=? AND e.model_version=? WHERE e.item_id IS NULL OR e.content_hash<>d.content_hash', d.modelId, d.version)); const run = randomUUID(); const now = new Date().toISOString(); this.options.database.run('INSERT INTO embedding_index_runs (id,model_id,model_version,operation,status,queued_count,processed_count,failed_count,started_at) VALUES (?,?,?,?,?,?,0,0,?)', run, d.modelId, d.version, operation, 'running', pending.length, now); if (pending.length === 0) { const indexed = this.options.database.all<{ count: number }>('SELECT COUNT(*) AS count FROM prompt_embeddings WHERE model_id=? AND model_version=? AND status=?', d.modelId, d.version, 'ready')[0]?.count ?? 0; this.options.database.run('UPDATE embedding_models SET status=?,active=?,last_health_check_at=?,last_error=NULL WHERE model_id=?', indexed > 0 ? 'ready' : 'installed', indexed > 0 ? 1 : 0, now, d.modelId); this.options.database.run('UPDATE embedding_index_runs SET status=?,finished_at=? WHERE id=?', 'completed', now, run); return this.embeddingStatus() } this.options.database.run('UPDATE embedding_models SET status=?,active=0 WHERE model_id=?', 'indexing', d.modelId); let processed = 0
    try { for (let i = 0; i < pending.length; i += 16) { const batch = pending.slice(i, i + 16); const vectors = await provider.embed(batch.map((row) => `标题：${row.title}\n分类：${row.category}\n${row.content}`)); if (vectors.length !== batch.length || vectors.some((v) => v.length !== d.dimensions)) throw new Error('向量模型返回的维度或数量不正确'); for (let j = 0; j < batch.length; j += 1) { const row = batch[j]; this.options.database.run('INSERT INTO prompt_embeddings (item_id,model_id,model_version,content_hash,dimensions,dtype,vector_blob,status,created_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(item_id,model_id,model_version) DO UPDATE SET content_hash=excluded.content_hash,vector_blob=excluded.vector_blob,status=excluded.status', row.prompt_id, d.modelId, d.version, row.content_hash, d.dimensions, 'float32', toBytes(vectors[j]), 'ready', new Date().toISOString()); processed += 1 } this.options.database.run('UPDATE embedding_index_runs SET processed_count=? WHERE id=?', processed, run) } const finished = new Date().toISOString(); this.options.database.run('UPDATE embedding_models SET status=?,active=?,last_health_check_at=?,last_error=NULL WHERE model_id=?', processed ? 'ready' : 'installed', processed ? 1 : 0, finished, d.modelId); this.options.database.run('UPDATE embedding_index_runs SET status=?,processed_count=?,finished_at=? WHERE id=?', 'completed', processed, finished, run) } catch (error) { const message = error instanceof Error ? error.message : '向量索引失败'; this.options.database.run('UPDATE embedding_models SET status=?,active=0,last_error=? WHERE model_id=?', 'failed', message, d.modelId); this.options.database.run('UPDATE embedding_index_runs SET status=?,processed_count=?,failed_count=?,finished_at=?,error_message=? WHERE id=?', 'failed', processed, pending.length - processed, new Date().toISOString(), message, run); throw error }; return this.embeddingStatus() }
  rebuildEmbeddings(): Promise<EmbeddingModelStatus> { return this.updateEmbeddings('rebuild') }
  async clearEmbeddings(): Promise<EmbeddingModelStatus> { const d = this.options.embeddingProvider?.descriptor; if (d) { this.options.database.run('DELETE FROM prompt_embeddings WHERE model_id=?', d.modelId); this.options.database.run('DELETE FROM embedding_index_runs WHERE model_id=?', d.modelId); this.options.database.run('UPDATE embedding_models SET status=?,active=0 WHERE model_id=?', 'installed', d.modelId) }; return this.embeddingStatus() }
  async uninstallEmbeddingModel(): Promise<EmbeddingModelStatus> { const p = this.options.embeddingProvider; if (p) { await p.uninstall(); this.options.database.run('DELETE FROM prompt_embeddings WHERE model_id=?', p.descriptor.modelId); this.options.database.run('DELETE FROM embedding_index_runs WHERE model_id=?', p.descriptor.modelId); this.options.database.run('DELETE FROM embedding_models WHERE model_id=?', p.descriptor.modelId) }; return this.embeddingStatus() }
  async embeddingStatus(): Promise<EmbeddingModelStatus> { const p = this.options.embeddingProvider; if (!p) return { status: 'unavailable', modelId: null, version: null, license: null, sourceUrl: null, diskBytes: 0, indexedCount: 0, totalCount: 0, pendingCount: 0, retrievalMode: 'lexical', fallbackReason: 'local_embedding_unavailable' }; const d = p.descriptor; const model = this.options.database.all<{ status: EmbeddingModelStatus['status']; disk_bytes: number; active: number; installed_at: string | null; last_health_check_at: string | null; last_error: string | null }>('SELECT status,disk_bytes,active,installed_at,last_health_check_at,last_error FROM embedding_models WHERE model_id=?', d.modelId)[0]; const totalCount = this.options.database.all<{ count: number }>('SELECT COUNT(*) AS count FROM prompt_search_documents')[0]?.count ?? 0; const indexedCount = this.options.database.all<{ count: number }>('SELECT COUNT(*) AS count FROM prompt_embeddings WHERE model_id=? AND model_version=? AND status=?', d.modelId, d.version, 'ready')[0]?.count ?? 0; const healthy = model?.status === 'ready' && model.active === 1 && indexedCount > 0; return { status: model?.status ?? 'not-installed', modelId: d.modelId, version: d.version, license: d.license, sourceUrl: d.sourceUrl, diskBytes: model?.disk_bytes ?? 0, indexedCount, totalCount, pendingCount: Math.max(0, totalCount - indexedCount), retrievalMode: healthy ? 'hybrid' : 'lexical', ...(model?.installed_at ? { installedAt: model.installed_at } : {}), ...(model?.last_health_check_at ? { lastHealthCheckAt: model.last_health_check_at } : {}), ...(model?.last_error ? { lastError: model.last_error } : {}), ...(!healthy ? { fallbackReason: 'local_embedding_unavailable' as const } : {}) } }
}
