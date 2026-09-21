import { createHash } from 'node:crypto'
import type { PromptLocale, PromptTranslations } from '../../shared/contracts/library'
import type { GlobalDatabase } from '../config'
import { upsertPromptSearchDocument } from './prompt-search'

const NANMI_SOURCE_TAG = 'nanimicoder-open-image-prompts'
const MIGRATION_BATCH_SIZE = 25
const GENERIC_TITLE_TAGS = new Set([
  '文生图', '图生图', '参考图引导', '编辑摄影', '摄影', '写实',
])
const migrationRuns = new WeakMap<GlobalDatabase, Promise<number>>()

function nanmiSourceKey(id: string): string {
  const digest = createHash('sha256').update(`${NANMI_SOURCE_TAG}\0${id}`).digest('hex').slice(0, 24)
  return `source-id:${digest}`
}

function nanmiSourceId(sourceUrl: unknown): string {
  const value = text(sourceUrl)
  const match = value.match(/\/status\/([^/?#]+)|#prompt-([^#]+)/)
  return match ? decodeURIComponent(match[1] ?? match[2] ?? '') : ''
}

export interface NanmiPromptRecord {
  tweet_id?: unknown
  author?: unknown
  tool?: unknown
  prompt_text?: unknown
  translated_text?: unknown
  labels?: unknown
  tweet_url?: unknown
  preview_url?: unknown
}

export interface NanmiPromptSource {
  tag: string
  collection: string
  repositoryUrl: string
}

export interface NormalizedNanmiPrompt {
  sourceKey: string
  name: string
  content: string
  primaryLocale: PromptLocale
  translations?: PromptTranslations
  collection: string
  category: string
  tags: string[]
  previewUrl?: string
  sourceUrl: string
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function httpsUrl(value: unknown): string | undefined {
  const candidate = text(value)
  if (!candidate) return undefined
  try {
    const url = new URL(candidate)
    return url.protocol === 'https:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

function categoryFor(labels: string, content: string): string {
  const value = `${labels} ${content.slice(0, 1_500)}`.toLocaleLowerCase()
  const rules: Array<[RegExp, string]> = [
    [/portrait|beauty|人物|肖像|人像/, '人像'],
    [/landscape|nature|scenery|风景|自然/, '风景'],
    [/product|e-?commerce|商品|产品|电商/, '产品'],
    [/architecture|interior|building|建筑|室内/, '建筑与室内'],
    [/advertis|commercial|brand|广告|商业/, '商业广告'],
    [/poster|graphic.design|海报|平面/, '海报与平面'],
    [/illustration|绘画|插画|艺术/, '插画'],
    [/anime|manga|动漫|漫画/, '动漫'],
    [/photograph|photo.real|摄影|写实/, '摄影'],
    [/fashion|时尚|服装/, '时尚'],
    [/food|beverage|美食|食物|饮品/, '美食'],
    [/(^|[^a-z])3d([^a-z]|$)|c4d|三维/, '三维'],
    [/interface|(^|[^a-z])ui([^a-z]|$)|icon|界面|图标/, '界面与图标'],
    [/character.design|角色设计/, '角色设计'],
    [/story|narrative|scene|故事|叙事|场景/, '场景叙事'],
    [/typograph|lettering|文字|字体|排版/, '文字排版'],
  ]
  return rules.find(([pattern]) => pattern.test(value))?.[1] ?? '其他'
}

function labelNames(labels: string): string[] {
  return [...new Set(labels.split('|').map((label) => label.split('=').at(-1)?.trim() ?? '').filter(Boolean))]
}

function legacyTitle(tags: readonly string[], category: string): string {
  const labels = tags.filter((tag) => (
    tag !== NANMI_SOURCE_TAG
    && !tag.startsWith('source-id:')
    && !GENERIC_TITLE_TAGS.has(tag)
    && !/nano.?banana|midjourney|gemini|gpt|dall.?e|flux|seedream|ideogram/i.test(tag)
  ))
  const selected = [...new Set(labels)].slice(0, 3)
  const sourceId = tags.find((tag) => tag.startsWith('source-id:'))?.split(':').at(-1)?.slice(-8)
  return (selected.length ? selected : [category || '其他', sourceId].filter(Boolean)).join(' · ').slice(0, 40)
}

function localeFor(content: string): PromptLocale {
  if (/^[\x00-\x7F\s]+$/.test(content) && /[A-Za-z]{3}/.test(content)) return 'en'
  if (/\p{Script=Han}/u.test(content) && !/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(content)) return 'zh-CN'
  return 'und'
}

function legacyImportedTitle(name: string, content: string): string {
  const stripped = name.replace(/^(?:提示词|prompt|第\s*\d+\s*张分镜图提示词|图\s*\d+\s*的提示词)\s*[：:👇-]*\s*/iu, '').replace(/\s+/g, ' ').trim()
  const copiedFromContent = content.replace(/\s+/g, ' ').trim().startsWith(stripped)
  if (name.length <= 40 && !copiedFromContent) return name
  return (stripped.split(/[。！？!?\n]/, 1)[0]?.trim() || stripped || name).slice(0, 40)
}

interface LegacyNanmiRow {
  row_id: number
  id: string
  name: string
  content: string
  created_at: string
  updated_at: string
}

interface LegacyPromptEnvelope {
  marker: 'latent-studio-prompt-v1'
  content: string
  kind?: 'prompt' | 'template' | 'style'
  tags?: string[]
  favorite?: boolean
  source?: 'manual' | 'generation' | 'optimization' | 'import'
  collection?: string
  category?: string
  primaryLocale?: PromptLocale
  translations?: PromptTranslations
  description?: string
  previewUrl?: string
  sourceUrl?: string
  deletedAt?: string
}

/** Upgrades legacy repository imports without changing stable IDs or timestamps. */
export async function migrateLegacyPromptImports(database: GlobalDatabase): Promise<number> {
  let cursor = 0
  let migrated = 0
  while (true) {
    const rows = database.all<LegacyNanmiRow>(`
      SELECT rowid AS row_id,id,name,content,created_at,updated_at
      FROM global_prompts
      WHERE rowid > ?
        AND json_valid(content)
        AND json_extract(content,'$.marker') = 'latent-studio-prompt-v1'
        AND json_extract(content,'$.source') = 'import'
        AND (
          json_type(content,'$.primaryLocale') IS NULL
          OR (
            COALESCE(json_extract(content,'$.deletedAt'), '') = ''
            AND EXISTS (SELECT 1 FROM json_each(json_extract(content,'$.tags')) WHERE value = ?)
            AND NOT EXISTS (SELECT 1 FROM json_each(json_extract(content,'$.tags')) WHERE value LIKE 'source-id:%')
            AND (json_extract(content,'$.sourceUrl') LIKE '%/status/%' OR json_extract(content,'$.sourceUrl') LIKE '%#prompt-%')
          )
        )
      ORDER BY rowid
      LIMIT ?
    `, cursor, NANMI_SOURCE_TAG, MIGRATION_BATCH_SIZE)
    if (!rows.length) break
    database.exec('BEGIN IMMEDIATE')
    try {
      for (const row of rows) {
        cursor = row.row_id
        const envelope = JSON.parse(row.content) as LegacyPromptEnvelope
        if (typeof envelope.content !== 'string') continue
        const tags = Array.isArray(envelope.tags) ? envelope.tags.filter((tag): tag is string => typeof tag === 'string') : []
        const category = typeof envelope.category === 'string' ? envelope.category : '其他'
        const isNanmi = tags.includes(NANMI_SOURCE_TAG)
        const needsLocale = envelope.primaryLocale === undefined
        const translated = needsLocale && isNanmi && /\p{Script=Han}/u.test(row.name) && row.name !== envelope.content ? row.name.trim() : ''
        const name = needsLocale ? (isNanmi ? legacyTitle(tags, category) : legacyImportedTitle(row.name, envelope.content)) : row.name
        const primaryLocale = envelope.primaryLocale ?? (isNanmi ? 'en' : localeFor(envelope.content))
        const sourceId = isNanmi && !tags.some((tag) => tag.startsWith('source-id:')) ? nanmiSourceId(envelope.sourceUrl) : ''
        const migratedTags = sourceId ? [...tags, nanmiSourceKey(sourceId)] : tags
        const updatedEnvelope: LegacyPromptEnvelope = {
          ...envelope,
          tags: migratedTags,
          primaryLocale,
          ...(translated ? { translations: { 'zh-CN': translated } } : {}),
        }
        database.run('UPDATE global_prompts SET name = ?, content = ? WHERE id = ?', name, JSON.stringify(updatedEnvelope), row.id)
        upsertPromptSearchDocument(database, {
          id: row.id,
          name,
          content: envelope.content,
          kind: envelope.kind === 'template' || envelope.kind === 'style' ? envelope.kind : 'prompt',
          scope: 'global',
          version: 1,
          tags: migratedTags,
          favorite: envelope.favorite === true,
          source: 'import',
          collection: typeof envelope.collection === 'string' ? envelope.collection : 'NanmiCoder Open Image Prompts',
          category,
          primaryLocale,
          ...(updatedEnvelope.translations ? { translations: updatedEnvelope.translations } : {}),
          ...(typeof envelope.description === 'string' ? { description: envelope.description } : {}),
          ...(typeof envelope.previewUrl === 'string' ? { previewUrl: envelope.previewUrl } : {}),
          ...(typeof envelope.sourceUrl === 'string' ? { sourceUrl: envelope.sourceUrl } : {}),
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        })
        migrated += 1
      }
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  return migrated
}

export function migrateLegacyNanmiPromptImports(database: GlobalDatabase): Promise<number> {
  return migrateLegacyPromptImports(database)
}

export function ensureLegacyPromptImports(database: GlobalDatabase): Promise<number> {
  const running = migrationRuns.get(database)
  if (running) return running
  const migration = migrateLegacyPromptImports(database).catch((error) => {
    migrationRuns.delete(database)
    throw error
  })
  migrationRuns.set(database, migration)
  return migration
}

export function ensureLegacyNanmiPromptImports(database: GlobalDatabase): Promise<number> {
  return ensureLegacyPromptImports(database)
}

export function normalizeNanmiPromptRecord(record: NanmiPromptRecord, source: NanmiPromptSource): NormalizedNanmiPrompt | null {
  const id = text(record.tweet_id)
  const content = text(record.prompt_text)
  if (!id || !content) return null
  const labels = text(record.labels)
  const translated = text(record.translated_text)
  const tool = text(record.tool)
  const category = categoryFor(labels, `${translated}\n${content}`)
  const names = labelNames(labels).slice(0, 3)
  const name = names.length
    ? names.join(' · ').slice(0, 40)
    : [category, tool, id].filter(Boolean).join(' · ').slice(0, 40)
  const sourceKey = nanmiSourceKey(id)
  const previewUrl = httpsUrl(record.preview_url)
  const tweetUrl = httpsUrl(record.tweet_url)
  return {
    sourceKey,
    name,
    content,
    primaryLocale: 'en',
    ...(translated ? { translations: { 'zh-CN': translated } } : {}),
    collection: source.collection,
    category,
    tags: [source.tag, ...(tool ? [tool] : []), ...labelNames(labels).slice(0, 20), sourceKey],
    ...(previewUrl ? { previewUrl } : {}),
    sourceUrl: tweetUrl ?? `${source.repositoryUrl}#prompt-${encodeURIComponent(id)}`,
  }
}
