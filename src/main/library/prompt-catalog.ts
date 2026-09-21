import { createHash } from 'node:crypto'
import type { GlobalDatabase } from '../config'
import type { PromptAsset, PromptAssetStore, PromptCatalogSource, PromptCatalogSourceInfo, SavePromptAssetInput, SyncPromptCatalogResult } from '../../shared/contracts/library'
import { promptCategoryLabel } from '../../shared/prompt-categories'
import { LibraryError } from './errors'
import { removePromptSearchDocument } from './prompt-search'
import { cleanNanmiCatalogCache, loadNanmiCatalog, parseNanmiManifest } from './nanmi-catalog'

type PromptCatalogFormat = 'gpt-image-2' | 'youmind-api' | 'wangrunlin-json' | 'vigo-json' | 'stretchcloud-json' | 'nanimicoder-release'

export interface PromptCatalogSourceDefinition {
  id: PromptCatalogSource
  displayName: string
  repositoryUrl: string
  url: string
  tag: string
  collections: string[]
  format: PromptCatalogFormat
  model?: 'gpt-image-2' | 'nano-banana-pro'
  campaign?: 'gpt-image-2-prompts' | 'nano-banana-pro-prompts'
}

export const PROMPT_CATALOG_SOURCE_DEFINITIONS: readonly PromptCatalogSourceDefinition[] = [
  {
    id: 'youmind-gpt-image-2',
    displayName: 'YouMind GPT Image 2',
    repositoryUrl: 'https://github.com/YouMind-OpenLab/awesome-gpt-image-2',
    url: 'https://youmind.com/youmarketing-api/prompts',
    tag: 'youmind-gpt-image-2',
    collections: ['YouMind GPT Image 2'],
    format: 'youmind-api',
    model: 'gpt-image-2',
    campaign: 'gpt-image-2-prompts',
  },
  {
    id: 'wangrunlin-gpt-image-2-5',
    displayName: 'wangrunlin GPT Image 2.5',
    repositoryUrl: 'https://github.com/wangrunlin/awesome-gpt-image-2-5-prompts',
    url: 'https://raw.githubusercontent.com/wangrunlin/awesome-gpt-image-2-5-prompts/main/data/catalog.json',
    tag: 'wangrunlin-gpt-image-2-5',
    collections: ['wangrunlin GPT Image 2.5'],
    format: 'wangrunlin-json',
  },
  {
    id: 'vigo-ai-visual-prompt-cookbook',
    displayName: 'AI Visual Prompt Cookbook',
    repositoryUrl: 'https://github.com/VigoZhao/AI-Visual-Prompt-Cookbook',
    url: 'https://api.github.com/repos/VigoZhao/AI-Visual-Prompt-Cookbook/git/trees/main?recursive=1',
    tag: 'vigo-ai-visual-prompt-cookbook',
    collections: ['AI Visual Prompt Cookbook'],
    format: 'vigo-json',
  },
  {
    id: 'stretchcloud-gpt-image-prompt-2-5',
    displayName: 'stretchcloud GPT Image 2.5',
    repositoryUrl: 'https://github.com/stretchcloud/awesome-gpt-image-prompt-2.5',
    url: 'https://raw.githubusercontent.com/stretchcloud/awesome-gpt-image-prompt-2.5/main/data/prompts.json',
    tag: 'stretchcloud-gpt-image-prompt-2-5',
    collections: ['stretchcloud GPT Image 2.5'],
    format: 'stretchcloud-json',
  },
  {
    id: 'nanimicoder-open-image-prompts',
    displayName: 'NanmiCoder Open Image Prompts',
    repositoryUrl: 'https://github.com/NanmiCoder/open-image-prompts',
    url: 'https://api.github.com/repos/NanmiCoder/open-image-prompts/contents/data/dataset-manifest.json?ref=main',
    tag: 'nanimicoder-open-image-prompts',
    collections: ['NanmiCoder Open Image Prompts'],
    format: 'nanimicoder-release',
  },
  {
    id: 'awesome-gpt-image-2',
    displayName: 'freestylefly GPT Image 2',
    repositoryUrl: 'https://github.com/freestylefly/awesome-gpt-image-2',
    url: 'https://raw.githubusercontent.com/freestylefly/awesome-gpt-image-2/main/data/cases.json',
    tag: 'awesome-gpt-image-2',
    collections: ['Awesome GPT Image 2'],
    format: 'gpt-image-2',
  },
] as const

export function describePromptCatalogSources(items: readonly PromptAsset[]): PromptCatalogSourceInfo[] {
  return PROMPT_CATALOG_SOURCE_DEFINITIONS.map((source) => ({
    id: source.id,
    displayName: source.displayName,
    repositoryUrl: source.repositoryUrl,
    localCount: items.filter((item) => item.source === 'import' && item.tags.includes(source.tag)).length,
  }))
}

const RETIRED_PROMPT_CATALOG_SOURCES = [
  { id: 'prompts.chat', tags: ['prompts.chat'], collections: ['prompts.chat'] },
  { id: 'awesome-prompts', tags: ['awesome-prompts'], collections: ['Awesome Prompts'] },
  { id: 'evolink-gpt-image-2', tags: ['evolink-gpt-image-2'], collections: ['EvoLink GPT Image 2'] },
  { id: 'youmind-nano-banana-pro', tags: ['youmind-nano-banana-pro'], collections: ['YouMind Nano Banana Pro'] },
] as const

export function removeRetiredPromptCatalogImports(database: GlobalDatabase): number {
  const rows = database.all<{ id: string; content: string }>('SELECT id, content FROM global_prompts')
  const retiredIds = rows.flatMap((row) => {
    try {
      const value = JSON.parse(row.content) as { marker?: unknown; source?: unknown; collection?: unknown; tags?: unknown }
      const tags = Array.isArray(value.tags) ? value.tags : []
      const retired = RETIRED_PROMPT_CATALOG_SOURCES.some((source) => source.collections.some((collection) => collection === value.collection)
        || source.tags.some((tag) => tags.includes(tag)))
      return value.marker === 'latent-studio-prompt-v1' && value.source === 'import' && retired
        ? [row.id]
        : []
    } catch {
      return []
    }
  })
  database.exec('BEGIN IMMEDIATE')
  try {
    for (const id of retiredIds) {
      database.run('DELETE FROM global_prompts WHERE id = ?', id)
      removePromptSearchDocument(database, id)
    }
    for (const source of RETIRED_PROMPT_CATALOG_SOURCES) {
      database.run('UPDATE prompt_catalog_sources SET enabled = 0 WHERE id = ?', source.id)
      database.run('DELETE FROM prompt_catalog_checkpoints WHERE source_id = ?', source.id)
    }
    database.exec('COMMIT')
    return retiredIds.length
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

const SOURCES: Record<string, PromptCatalogSourceDefinition> = Object.fromEntries(PROMPT_CATALOG_SOURCE_DEFINITIONS.map((source) => [source.id, source]))

const GPT_IMAGE_2_IMAGE_ROOT = 'https://raw.githubusercontent.com/freestylefly/awesome-gpt-image-2/main/data'
const VIGO_RAW_ROOT = 'https://raw.githubusercontent.com/VigoZhao/AI-Visual-Prompt-Cookbook/main'
const MAX_CATALOG_BYTES = 24 * 1024 * 1024
const MAX_CATALOG_ITEMS = 50_000
const MAX_PAGED_CATALOG_BYTES = 250 * 1024 * 1024
const MAX_VIGO_STYLE_BYTES = 256 * 1024
const MAX_YOUMIND_PAGES = 500
const YOUMIND_CURSOR_FORMAT_VERSION = 2
const CATALOG_FETCH_ATTEMPTS = 3
const CATALOG_PLAN_BATCH_SIZE = 100

interface CatalogPrompt {
  sourceKey: string
  sourcePublishedAt?: string
  name: string
  content: string
  kind?: 'prompt' | 'template' | 'style'
  tags: string[]
  collection: string
  category: string
  primaryLocale?: PromptAsset['primaryLocale']
  translations?: PromptAsset['translations']
  description?: string
  previewUrl?: string
  sourceUrl?: string
}

interface YouMindCursor {
  latestPublishedAt: string
  formatVersion: number
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

async function fetchCatalogResource(
  fetchImplementation: typeof globalThis.fetch,
  url: string,
  init: RequestInit,
  timeout: number,
): Promise<Response> {
  let lastError: unknown
  for (let attempt = 0; attempt < CATALOG_FETCH_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchImplementation(url, { ...init, signal: AbortSignal.timeout(timeout) })
      if (!retryableStatus(response.status) || attempt === CATALOG_FETCH_ATTEMPTS - 1) return response
      lastError = new LibraryError('read-failed', `提示词源暂时不可用（HTTP ${response.status}）`)
    } catch (error) {
      lastError = error
      if (attempt === CATALOG_FETCH_ATTEMPTS - 1) throw error
    }
    await wait(150 * (attempt + 1))
  }
  throw lastError
}

interface ImportedPromptSourceStore extends PromptAssetStore {
  listImportedBySource(input: { tag: string; collections: readonly string[]; sourceKeys?: readonly string[] }): Promise<PromptAsset[]>
  countImportedBySource(input: { tag: string; collections: readonly string[] }): number
}

function localizedText(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (!value || typeof value !== 'object') return ''
  const record = value as Record<string, unknown>
  for (const locale of ['zh-CN', 'zh', 'en']) {
    if (typeof record[locale] === 'string' && record[locale].trim()) return record[locale].trim()
  }
  return Object.values(record).find((item): item is string => typeof item === 'string' && Boolean(item.trim()))?.trim() ?? ''
}

function localizedValue(value: unknown, locale: 'zh-CN' | 'en'): string {
  if (!value || typeof value !== 'object') return ''
  const candidate = (value as Record<string, unknown>)[locale]
  return typeof candidate === 'string' ? candidate.trim() : ''
}

function localizedSteps(value: unknown, locale: 'zh-CN' | 'en'): string {
  return Array.isArray(value) ? value.map((item) => localizedValue(item, locale)).filter(Boolean).join('\n\n') : ''
}

function promptLocale(value: string): PromptAsset['primaryLocale'] {
  if (/^[\x00-\x7F\s]+$/.test(value) && /[A-Za-z]{3}/.test(value)) return 'en'
  if (/\p{Script=Han}/u.test(value) && !/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value)) return 'zh-CN'
  return 'und'
}

function conciseCatalogTitle(title: string, description: string, content: string): string {
  const stripped = title.replace(/^(?:提示词|prompt|第\s*\d+\s*张分镜图提示词|图\s*\d+\s*的提示词)\s*[：:👇-]*\s*/iu, '').replace(/\s+/g, ' ').trim()
  const normalizedContent = content.replace(/\s+/g, ' ').trim()
  const copiedFromContent = Boolean(stripped && normalizedContent.startsWith(stripped))
  const source = (title.length > 40 || copiedFromContent) && description.trim() ? description.trim() : stripped || title.trim()
  const firstClause = source.split(/[。！？!?\n]/, 1)[0]?.trim() || source
  return firstClause.slice(0, 40)
}

function nanmiCategory(labels: string, content: string): string {
  const value = `${labels} ${content.slice(0, 1_500)}`.toLocaleLowerCase()
  const rules: Array<[RegExp, string]> = [
    [/portrait|beauty|人物|肖像|人像|美妆/, '人像'],
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

function jsonRoot(text: string, sourceName: string): unknown {
  try { return JSON.parse(text) } catch { throw new LibraryError('read-failed', `${sourceName} 提示词索引格式无效`) }
}

function catalogCategory(value: unknown, fallback = '图片创作'): string {
  if (typeof value !== 'string' || !value.trim()) return fallback
  const normalized = value.trim()
  const explicit: Record<string, string> = {
    editing: '其他', products: '产品', design: '海报与平面', education: '其他', entertainment: '场景叙事', general: '其他',
    'exclusive-web': '界面与图标', 'exclusive web design': '界面与图标', web: '界面与图标', ui: '界面与图标', portrait: '人像', portraits: '人像', landscape: '风景', photography: '摄影', illustration: '插画', poster: '海报与平面', typography: '文字排版',
  }
  const direct = explicit[normalized.toLocaleLowerCase()]
  if (direct) return direct
  const label = promptCategoryLabel(normalized)
  const aliases: Record<string, string> = {
    '商品与电商': '产品', '插画与艺术': '插画', '场景与叙事': '场景叙事', '摄影与写实': '摄影', '角色与人物': '角色设计',
    '建筑与空间': '建筑与室内', '界面设计': '界面与图标', '海报与字体设计': '海报与平面', '图表与信息图': '海报与平面',
    '品牌与标志': '商业广告', '3D 创作': '三维', '海报': '海报与平面', '图标设计': '界面与图标', '缩略图设计': '商业广告',
  }
  return aliases[label] ?? fallback
}

function firstHttpsUrl(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = item && typeof item === 'object' ? httpsUrl((item as Record<string, unknown>).url) : httpsUrl(item)
      if (url) return url
    }
  }
  return httpsUrl(value)
}

function httpsUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

function isoDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined
}

function promptSourceKey(source: string, id: string): string {
  const key = `source-id:${source}:${id}`
  if (key.length <= 40) return key
  const digest = createHash('sha256').update(`${source}\0${id}`).digest('hex').slice(0, 24)
  return `source-id:${digest}`
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => typeof item === 'string' && item.trim() ? [item.trim().slice(0, 80)] : [])
}

function gptImage2Prompts(text: string, source: string): CatalogPrompt[] {
  let root: unknown
  try { root = JSON.parse(text) } catch { throw new LibraryError('read-failed', 'GPT Image 2 提示词索引格式无效') }
  if (!root || typeof root !== 'object' || !Array.isArray((root as { cases?: unknown }).cases)) {
    throw new LibraryError('read-failed', 'GPT Image 2 提示词索引格式无效')
  }
  return ((root as { cases: unknown[] }).cases).flatMap((value): CatalogPrompt[] => {
    if (!value || typeof value !== 'object') return []
    const item = value as Record<string, unknown>
    const id = typeof item.id === 'number' || typeof item.id === 'string' ? String(item.id).trim() : ''
    const name = typeof item.title === 'string' ? item.title.trim() : ''
    const content = typeof item.prompt === 'string' ? item.prompt.trim() : ''
    if (!id || !name || !content) return []
    const image = typeof item.image === 'string' && /^\/images\/[A-Za-z0-9._-]+$/.test(item.image) ? item.image : undefined
    const sourceUrl = typeof item.githubUrl === 'string' && item.githubUrl.startsWith('https://github.com/freestylefly/awesome-gpt-image-2/') ? item.githubUrl : undefined
    const upstreamCategory = typeof item.category === 'string' ? item.category.trim().slice(0, 80) : ''
    const sourceKey = promptSourceKey(source, id)
    return [{
      sourceKey,
      name,
      content,
      collection: 'Awesome GPT Image 2',
      category: catalogCategory(upstreamCategory, nanmiCategory('', `${name}\n${content}`)),
      tags: [source, upstreamCategory, ...stringArray(item.styles), ...stringArray(item.scenes), sourceKey].filter(Boolean),
      ...(image ? { previewUrl: `${GPT_IMAGE_2_IMAGE_ROOT}${image}` } : {}),
      ...(sourceUrl ? { sourceUrl } : {}),
    }]
  })
}

function youMindCategoryNames(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((category) => {
    if (typeof category === 'string' && category.trim()) return [category.trim()]
    if (!category || typeof category !== 'object') return []
    const record = category as Record<string, unknown>
    return [localizedText(record.name) || localizedText(record.title) || localizedText(record.slug)].filter(Boolean)
  })
}

function youMindPage(text: string, config: PromptCatalogSourceDefinition): { prompts: CatalogPrompt[]; totalPages: number; hasMore: boolean } {
  const root = jsonRoot(text, config.displayName)
  if (!root || typeof root !== 'object' || !Array.isArray((root as Record<string, unknown>).prompts)) {
    throw new LibraryError('read-failed', `${config.displayName} 提示词索引格式无效`)
  }
  const page = root as Record<string, unknown>
  const totalPages = typeof page.totalPages === 'number' && Number.isInteger(page.totalPages) && page.totalPages > 0
    ? Math.min(page.totalPages, MAX_YOUMIND_PAGES)
    : 1
  const prompts = (page.prompts as unknown[]).flatMap((value): CatalogPrompt[] => {
    if (!value || typeof value !== 'object') return []
    const item = value as Record<string, unknown>
    const id = typeof item.id === 'number' || typeof item.id === 'string' ? String(item.id).trim() : ''
    const originalContent = localizedText(item.content)
    const translatedContent = localizedText(item.translatedContent)
    const content = originalContent || translatedContent
    const rawName = localizedText(item.title) || localizedText(item.description)
    if (!id || !rawName || !content) return []
    const description = localizedText(item.description)
    const name = conciseCatalogTitle(rawName, description, translatedContent || content)
    const categories = youMindCategoryNames(item.promptCategories)
    const previewUrl = firstHttpsUrl(item.mediaThumbnails) ?? firstHttpsUrl(item.media)
    const sourceUrl = httpsUrl(item.sourceLink)
    const platform = localizedText(item.sourcePlatform)
    const sourcePublishedAt = isoDate(item.sourcePublishedAt)
    const sourceKey = promptSourceKey(config.tag, id)
    return [{
      sourceKey,
      ...(sourcePublishedAt ? { sourcePublishedAt } : {}),
      name,
      content,
      primaryLocale: originalContent ? promptLocale(originalContent) : 'zh-CN',
      ...(translatedContent && translatedContent !== content ? { translations: { 'zh-CN': translatedContent } } : {}),
      ...(description ? { description } : {}),
      collection: config.collections[0],
      category: catalogCategory(categories[0], nanmiCategory('', `${name}\n${content}`)),
      tags: [config.tag, 'image', ...categories, ...(platform ? [platform] : []), sourceKey],
      ...(previewUrl ? { previewUrl } : {}),
      ...(sourceUrl ? { sourceUrl } : {}),
    }]
  })
  return { prompts, totalPages, hasMore: page.hasMore === true }
}

async function fetchYouMindPrompts(config: PromptCatalogSourceDefinition, fetchImplementation: typeof globalThis.fetch, cursor?: YouMindCursor, stopAfterFirstPage = false): Promise<{ prompts: CatalogPrompt[]; receivedBytes: number; version: string; response: Response; incremental: boolean; latestPublishedAt?: string }> {
  if (!config.model || !config.campaign) throw new LibraryError('read-failed', 'YouMind 同步配置不完整')
  const prompts: CatalogPrompt[] = []
  const versionHash = createHash('sha256')
  let receivedBytes = 0
  let lastResponse: Response | undefined
  let bootstrapped = false
  for (let pageNumber = 1; pageNumber <= MAX_YOUMIND_PAGES; pageNumber += 1) {
    const body = JSON.stringify({ model: config.model, page: pageNumber, limit: 100, locale: 'zh-CN', campaign: config.campaign, filterMode: 'imageCategories', sortBy: 'sourcePublishedAt', sortOrder: 'desc' })
    const response = await fetchCatalogResource(fetchImplementation, config.url, {
      method: 'POST',
      redirect: 'error',
      headers: { accept: 'application/json', 'content-type': 'application/json', origin: 'https://youmind.com', referer: `https://youmind.com/zh-CN/${config.campaign}`, 'user-agent': 'Mozilla/5.0 LatentStudio/0.8' },
      body,
    }, 30_000)
    if (!response.ok || response.redirected) throw new LibraryError('read-failed', `YouMind 提示词同步失败（HTTP ${response.status}）`)
    const pageBody = await response.text()
    receivedBytes += Buffer.byteLength(pageBody, 'utf8')
    if (receivedBytes > MAX_PAGED_CATALOG_BYTES) throw new LibraryError('read-failed', 'YouMind 提示词数据过大')
    versionHash.update(pageBody)
    const parsed = youMindPage(pageBody, config)
    const pagePrompts = cursor
      ? parsed.prompts.filter((prompt) => !prompt.sourcePublishedAt || prompt.sourcePublishedAt >= cursor.latestPublishedAt)
      : parsed.prompts
    prompts.push(...pagePrompts)
    lastResponse = response
    if (stopAfterFirstPage && parsed.prompts.some((prompt) => prompt.sourcePublishedAt)) { bootstrapped = true; break }
    if (cursor && parsed.prompts.some((prompt) => prompt.sourcePublishedAt && prompt.sourcePublishedAt <= cursor.latestPublishedAt)) break
    if (pageNumber >= parsed.totalPages || !parsed.hasMore) break
  }
  if (!lastResponse) throw new LibraryError('read-failed', 'YouMind 提示词源未返回数据')
  const latestPublishedAt = prompts.map((prompt) => prompt.sourcePublishedAt).filter((value): value is string => Boolean(value)).sort().at(-1)
  return { prompts, receivedBytes, version: versionHash.digest('hex'), response: lastResponse, incremental: Boolean(cursor) || bootstrapped, ...(latestPublishedAt ? { latestPublishedAt } : {}) }
}

function wangrunlinPrompts(text: string, config: PromptCatalogSourceDefinition): CatalogPrompt[] {
  const root = jsonRoot(text, config.displayName)
  const entries = root && typeof root === 'object' && Array.isArray((root as Record<string, unknown>).entries)
    ? (root as { entries: unknown[] }).entries
    : Array.isArray(root) ? root : []
  return entries.flatMap((value): CatalogPrompt[] => {
    if (!value || typeof value !== 'object') return []
    const item = value as Record<string, unknown>
    const id = typeof item.id === 'string' ? item.id.trim() : ''
    const name = localizedValue(item.title, 'zh-CN') || localizedText(item.title)
    const prompt = item.prompt && typeof item.prompt === 'object' ? item.prompt as Record<string, unknown> : undefined
    const steps = Array.isArray(prompt?.steps) ? prompt.steps : []
    const english = localizedSteps(steps, 'en')
    const chinese = localizedSteps(steps, 'zh-CN')
      || (Array.isArray(prompt?.original_steps) ? prompt.original_steps.filter((step): step is string => typeof step === 'string').join('\n\n').trim() : '')
    const content = english || chinese || localizedText(item.prompt)
    if (!id || !name || !content) return []
    const model = item.model && typeof item.model === 'object' ? localizedText((item.model as Record<string, unknown>).family) : ''
    const source = item.source && typeof item.source === 'object' ? item.source as Record<string, unknown> : undefined
    const previewUrl = firstHttpsUrl(item.previews)
    const sourceKey = promptSourceKey(config.tag, id)
    return [{
      sourceKey,
      name,
      content,
      primaryLocale: english ? 'en' : promptLocale(content),
      ...(english && chinese && english !== chinese ? { translations: { 'zh-CN': chinese } } : {}),
      collection: config.collections[0],
      category: catalogCategory(item.category),
      tags: [config.tag, ...stringArray(item.tags), ...(model ? [model] : []), sourceKey],
      ...(previewUrl ? { previewUrl } : {}),
      sourceUrl: httpsUrl(source?.prompt_url) ?? httpsUrl(source?.url) ?? `${config.repositoryUrl}/blob/main/data/prompts/${id}.json`,
    }]
  })
}

function stretchcloudPrompts(text: string, config: PromptCatalogSourceDefinition): CatalogPrompt[] {
  const root = jsonRoot(text, config.displayName)
  if (!Array.isArray(root)) throw new LibraryError('read-failed', `${config.displayName} 提示词索引格式无效`)
  return root.flatMap((value): CatalogPrompt[] => {
    if (!value || typeof value !== 'object') return []
    const item = value as Record<string, unknown>
    const id = typeof item.n === 'number' || typeof item.n === 'string' ? String(item.n) : ''
    const name = localizedText(item.name)
    const content = localizedText(item.prompt)
    const file = typeof item.file === 'string' && /^[A-Za-z0-9._-]+$/.test(item.file) ? item.file : undefined
    if (!id || !name || !content) return []
    const sourceKey = promptSourceKey(config.tag, id)
    return [{
      sourceKey,
      name,
      content,
      collection: config.collections[0],
      category: catalogCategory(item.categoryLabel ?? item.category, nanmiCategory('', `${name}\n${content}`)),
      tags: [config.tag, ...stringArray(item.tags), sourceKey],
      ...(file ? { previewUrl: `https://raw.githubusercontent.com/stretchcloud/awesome-gpt-image-prompt-2.5/main/data/images/${file}` } : {}),
      sourceUrl: `${config.repositoryUrl}#case-${id}`,
    }]
  })
}

function vigoPrompts(text: string, config: PromptCatalogSourceDefinition): CatalogPrompt[] {
  const parsed = (() => { try { return JSON.parse(text) as unknown } catch { return undefined } })()
  const values = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? [parsed] : []
  if (values.length > 0) {
    return values.flatMap((value): CatalogPrompt[] => {
      if (!value || typeof value !== 'object') return []
      const item = value as Record<string, unknown>
      const slug = localizedText(item.style_slug)
      const name = localizedText(item.style_name)
      const content = localizedText(item.prompt_template) || localizedText(item.prompt) || localizedText(item.style_prompt)
      if (!slug || !name || !content) return []
      const visual = item.visual_deconstruction && typeof item.visual_deconstruction === 'object'
        ? item.visual_deconstruction as Record<string, unknown>
        : undefined
      const summary = localizedText(item.style_summary)
      const styleCategory = localizedText(visual?.style_category)
      const sourceKey = promptSourceKey(config.tag, slug)
      return [{
        sourceKey,
        name,
        content,
        kind: 'style',
        collection: config.collections[0],
        category: nanmiCategory(styleCategory, `${summary}\n${content}`),
        tags: [config.tag, 'style', ...stringArray(item.tags), sourceKey],
        previewUrl: `https://raw.githubusercontent.com/VigoZhao/AI-Visual-Prompt-Cookbook/main/assets/thumbs/${slug}-16x9.jpg`,
        sourceUrl: `${config.repositoryUrl}/blob/main/styles/${slug}/style.json`,
      }]
    })
  }
  const richCards = [...text.matchAll(/<strong><a href="styles\/([^"/]+)">([^<]+)<\/a><\/strong><br>\s*<em>([^<]+)<\/em><br>/g)].map((match): CatalogPrompt => {
    const slug = match[1]
    const sourceKey = promptSourceKey(config.tag, slug)
    return {
      sourceKey,
      name: match[2].trim(),
      content: `${match[3].trim()}\n\n使用该视觉风格生成图像；应用后可继续填写主体、场景和文字内容。`,
      kind: 'style',
      collection: config.collections[0],
      category: '插画与艺术',
      tags: [config.tag, 'style', sourceKey],
      previewUrl: `https://raw.githubusercontent.com/VigoZhao/AI-Visual-Prompt-Cookbook/main/assets/thumbs/${slug}-16x9.jpg`,
      sourceUrl: `${config.repositoryUrl}/blob/main/styles/${slug}/style.json`,
    }
  })
  if (richCards.length) return richCards
  return [...text.matchAll(/^\|\s*([^|]+?)\s*\|\s*\[Copy Prompt\]\(([^)]+)\)\s*\|\s*\[style\.json\]\(([^)]+)\)\s*\|$/gm)].flatMap((match): CatalogPrompt[] => {
    if (match[1].trim() === 'Style' || match[1].trim().startsWith('---')) return []
    const slug = match[2].split('/').pop()?.replace(/\.md$/, '') ?? ''
    if (!slug) return []
    const sourceKey = promptSourceKey(config.tag, slug)
    return [{
      sourceKey,
      name: match[1].trim(),
      content: `使用 ${match[1].trim()} 视觉风格生成图像。`,
      kind: 'style',
      collection: config.collections[0],
      category: '风格',
      tags: [config.tag, 'style', sourceKey],
      previewUrl: `https://raw.githubusercontent.com/VigoZhao/AI-Visual-Prompt-Cookbook/main/assets/thumbs/${slug}-16x9.jpg`,
      sourceUrl: `${config.repositoryUrl}/blob/main/${match[3].replace(/^\.\.\/\.\.\//, '')}`,
    }]
  })
}

function vigoStylePaths(text: string): string[] {
  const root = jsonRoot(text, 'AI Visual Prompt Cookbook')
  if (!root || typeof root !== 'object' || !Array.isArray((root as Record<string, unknown>).tree)) return []
  return (root as { tree: unknown[] }).tree.flatMap((value): string[] => {
    if (!value || typeof value !== 'object') return []
    const item = value as Record<string, unknown>
    if (item.type !== 'blob' || typeof item.path !== 'string') return []
    return /^styles\/[a-z0-9-]+\/style\.json$/.test(item.path) ? [item.path] : []
  }).sort((left, right) => left.localeCompare(right))
}

async function fetchVigoPrompts(
  indexText: string,
  config: PromptCatalogSourceDefinition,
  fetchImplementation: typeof globalThis.fetch,
): Promise<{ prompts: CatalogPrompt[]; receivedBytes: number }> {
  const paths = vigoStylePaths(indexText)
  if (paths.length === 0) return { prompts: vigoPrompts(indexText, config), receivedBytes: 0 }
  const results = new Array<CatalogPrompt>(paths.length)
  let receivedBytes = 0
  let cursor = 0
  const worker = async () => {
    while (cursor < paths.length) {
      const index = cursor
      cursor += 1
      const path = paths[index]
      const response = await fetchCatalogResource(fetchImplementation, `${VIGO_RAW_ROOT}/${path}`, { redirect: 'error' }, 20_000)
      if (!response.ok || response.redirected) throw new LibraryError('read-failed', `AI Visual Prompt Cookbook 风格下载失败（HTTP ${response.status}）`)
      const declaredLength = Number(response.headers.get('content-length'))
      if (Number.isFinite(declaredLength) && declaredLength > MAX_VIGO_STYLE_BYTES) throw new LibraryError('read-failed', 'AI Visual Prompt Cookbook 风格文件过大')
      const body = await response.text()
      const byteLength = Buffer.byteLength(body, 'utf8')
      if (byteLength > MAX_VIGO_STYLE_BYTES) throw new LibraryError('read-failed', 'AI Visual Prompt Cookbook 风格文件过大')
      receivedBytes += byteLength
      if (receivedBytes > MAX_CATALOG_BYTES) throw new LibraryError('read-failed', '开源提示词数据过大')
      const prompt = vigoPrompts(body, config)[0]
      const expectedSlug = path.split('/')[1]
      if (!prompt || !prompt.sourceUrl?.includes(`/styles/${expectedSlug}/style.json`)) throw new LibraryError('read-failed', 'AI Visual Prompt Cookbook 风格文件格式无效')
      results[index] = prompt
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, paths.length) }, () => worker()))
  return { prompts: results, receivedBytes }
}

function sameImportedPrompt(item: PromptAsset, prompt: CatalogPrompt): boolean {
  return item.name === prompt.name
    && item.content === prompt.content
    && item.kind === (prompt.kind ?? 'prompt')
    && item.previewUrl === prompt.previewUrl
    && item.sourceUrl === prompt.sourceUrl
    && item.collection === prompt.collection
    && item.category === prompt.category
    && item.primaryLocale === prompt.primaryLocale
    && JSON.stringify(item.translations ?? {}) === JSON.stringify(prompt.translations ?? {})
    && item.description === prompt.description
    && item.tags.length === prompt.tags.length
    && prompt.tags.every((tag) => item.tags.includes(tag))
}

interface SyncPromptCatalogInput {
  source: PromptCatalogSource
  store: PromptAssetStore
  database?: GlobalDatabase
  fetch?: typeof globalThis.fetch
  cacheDirectory?: string
}

const ACTIVE_SYNCS = new Map<PromptCatalogSource, Promise<SyncPromptCatalogResult>>()

function recordSyncFailure(database: GlobalDatabase, config: PromptCatalogSourceDefinition, error: unknown, startedAt: string): void {
  const now = new Date().toISOString()
  const message = error instanceof Error ? error.message : '提示词同步失败'
  const errorCode = error instanceof LibraryError ? error.code : 'write-failed'
  const runId = `catalog-sync-${config.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  database.run(
    'INSERT INTO prompt_catalog_sources (id, display_name, repository_url, adapter_id, enabled, last_error_code, last_error_message) VALUES (?, ?, ?, ?, 1, ?, ?) ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, repository_url = excluded.repository_url, adapter_id = excluded.adapter_id, enabled = 1, last_error_code = excluded.last_error_code, last_error_message = excluded.last_error_message',
    config.id, config.displayName, config.repositoryUrl, config.format, errorCode, message,
  )
  database.run(
    'INSERT INTO prompt_catalog_sync_runs (id, source_id, status, records_seen, records_added, records_updated, records_removed, records_skipped, started_at, finished_at, error_code, error_message) VALUES (?, ?, ?, 0, 0, 0, 0, 0, ?, ?, ?, ?)',
    runId, config.id, 'failed', startedAt, now, errorCode, message,
  )
}

function youMindCursor(value: string | undefined): YouMindCursor | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value) as Partial<YouMindCursor>
    const latestPublishedAt = isoDate(parsed.latestPublishedAt)
    return latestPublishedAt && parsed.formatVersion === YOUMIND_CURSOR_FORMAT_VERSION
      ? { latestPublishedAt, formatVersion: YOUMIND_CURSOR_FORMAT_VERSION }
      : undefined
  } catch {
    return undefined
  }
}

function sourceStore(store: PromptAssetStore): ImportedPromptSourceStore | undefined {
  const candidate = store as Partial<ImportedPromptSourceStore>
  return typeof candidate.listImportedBySource === 'function' && typeof candidate.countImportedBySource === 'function'
    ? candidate as ImportedPromptSourceStore
    : undefined
}

async function notModifiedResult(
  input: SyncPromptCatalogInput,
  config: PromptCatalogSourceDefinition,
  response: Response,
  startedAt: string,
  version: string | undefined,
): Promise<SyncPromptCatalogResult> {
  if (!input.database) throw new LibraryError('read-failed', '提示词仓库缺少本地同步状态')
  const scopedStore = sourceStore(input.store)
  const total = scopedStore
    ? scopedStore.countImportedBySource({ tag: config.tag, collections: config.collections })
    : (await input.store.list({ scope: 'global' })).filter((item) => item.source === 'import' && (item.tags.includes(config.tag) || config.collections.includes(item.collection))).length
  const now = new Date().toISOString()
  const runId = `catalog-sync-${input.source}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  input.database.run(
    'INSERT INTO prompt_catalog_sources (id, display_name, repository_url, adapter_id, enabled, last_success_version, last_success_at, last_error_code, last_error_message) VALUES (?, ?, ?, ?, 1, ?, ?, NULL, NULL) ON CONFLICT(id) DO UPDATE SET last_success_version = COALESCE(excluded.last_success_version, prompt_catalog_sources.last_success_version), last_success_at = excluded.last_success_at, last_error_code = NULL, last_error_message = NULL',
    config.id, config.displayName, config.repositoryUrl, config.format, version ?? null, now,
  )
  input.database.run(
    'INSERT INTO prompt_catalog_sync_runs (id, source_id, status, records_seen, records_added, records_updated, records_removed, records_skipped, started_at, finished_at) VALUES (?, ?, ?, ?, 0, 0, 0, ?, ?, ?)',
    runId, config.id, 'not-modified', total, total, startedAt, now,
  )
  if (response.headers.get('etag') || response.headers.get('last-modified')) {
    input.database.run(
      'UPDATE prompt_catalog_checkpoints SET etag = COALESCE(?, etag), last_modified = COALESCE(?, last_modified), updated_at = ? WHERE source_id = ?',
      response.headers.get('etag'), response.headers.get('last-modified'), now, config.id,
    )
  }
  return { source: input.source, imported: 0, updated: 0, removed: 0, skipped: total, total }
}

async function performPromptCatalogSync(input: SyncPromptCatalogInput, startedAt: string): Promise<SyncPromptCatalogResult> {
  const config = SOURCES[input.source]
  if (!config) throw new LibraryError('invalid-input', '不支持的提示词源')
  const fetchImplementation = input.fetch ?? globalThis.fetch
  let response: Response
  let body = ''
  let receivedBytes = 0
  let catalogVersion: string | undefined
  let prompts: CatalogPrompt[]
  let incremental = false
  let cursorJson: string | undefined
  let nanmiCacheVersion: string | undefined
  const checkpoint = input.database?.all<{ remote_version?: string; etag?: string; last_modified?: string; cursor_json?: string }>('SELECT remote_version, etag, last_modified, cursor_json FROM prompt_catalog_checkpoints WHERE source_id = ?', config.id)[0]
  if (config.format === 'youmind-api') {
    const cursor = youMindCursor(checkpoint?.cursor_json)
    const scopedStore = sourceStore(input.store)
    const upgradingLegacyFormat = Boolean(checkpoint?.cursor_json && !cursor)
    const bootstrapFromExisting = !cursor && !upgradingLegacyFormat && Boolean(scopedStore?.countImportedBySource({ tag: config.tag, collections: config.collections }))
    const catalog = await fetchYouMindPrompts(config, fetchImplementation, cursor, bootstrapFromExisting)
    response = catalog.response
    receivedBytes = catalog.receivedBytes
    catalogVersion = catalog.version
    prompts = catalog.prompts
    incremental = catalog.incremental
    const latestPublishedAt = catalog.latestPublishedAt && (!cursor || catalog.latestPublishedAt > cursor.latestPublishedAt)
      ? catalog.latestPublishedAt
      : cursor?.latestPublishedAt
    if (latestPublishedAt) cursorJson = JSON.stringify({ latestPublishedAt, formatVersion: YOUMIND_CURSOR_FORMAT_VERSION } satisfies YouMindCursor)
  } else {
    const conditionalHeaders: Record<string, string> = {}
    const upgradingWangrunlin = config.format === 'wangrunlin-json' && Boolean(checkpoint) && checkpoint?.cursor_json !== '{"formatVersion":2}'
    if (checkpoint?.etag && !upgradingWangrunlin) conditionalHeaders['if-none-match'] = checkpoint.etag
    if (checkpoint?.last_modified && !upgradingWangrunlin) conditionalHeaders['if-modified-since'] = checkpoint.last_modified
    if (config.format === 'nanimicoder-release') {
      conditionalHeaders.accept = 'application/vnd.github.raw+json'
      conditionalHeaders['user-agent'] = 'Mozilla/5.0 LatentStudio/0.8'
    }
    response = await fetchCatalogResource(fetchImplementation, config.url, {
      redirect: 'error',
      ...(Object.keys(conditionalHeaders).length ? { headers: conditionalHeaders } : {}),
    }, 20_000)
    if (response.status === 304 && input.database) {
      return notModifiedResult(input, config, response, startedAt, checkpoint?.remote_version)
    }
    if (!response.ok || response.redirected) throw new LibraryError('read-failed', `开源提示词同步失败（HTTP ${response.status}）`)
    const declaredLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(declaredLength) && declaredLength > MAX_CATALOG_BYTES) throw new LibraryError('read-failed', '开源提示词数据过大')
    body = await response.text()
    receivedBytes = Buffer.byteLength(body, 'utf8')
    if (receivedBytes > MAX_CATALOG_BYTES) throw new LibraryError('read-failed', '开源提示词数据过大')
    prompts = []
  }
  if (config.format === 'gpt-image-2') {
    prompts = gptImage2Prompts(body, config.tag)
  } else if (config.format === 'wangrunlin-json') {
    prompts = wangrunlinPrompts(body, config)
    cursorJson = '{"formatVersion":2}'
  } else if (config.format === 'stretchcloud-json') {
    prompts = stretchcloudPrompts(body, config)
  } else if (config.format === 'vigo-json') {
    const vigo = await fetchVigoPrompts(body, config, fetchImplementation)
    receivedBytes += vigo.receivedBytes
    prompts = vigo.prompts
  } else if (config.format === 'nanimicoder-release') {
    const manifest = parseNanmiManifest(body)
    catalogVersion = manifest.dataset_version
    nanmiCacheVersion = manifest.db.sha256.toLocaleLowerCase()
    if (input.database && checkpoint?.remote_version === manifest.dataset_version) {
      return notModifiedResult(input, config, response, startedAt, manifest.dataset_version)
    }
    prompts = await loadNanmiCatalog({
      manifest,
      tag: config.tag,
      collection: config.collections[0],
      repositoryUrl: config.repositoryUrl,
      fetch: fetchImplementation,
      cacheDirectory: input.cacheDirectory,
    })
  }
  if (prompts.length > MAX_CATALOG_ITEMS) throw new LibraryError('read-failed', `开源提示词超过 ${MAX_CATALOG_ITEMS} 条限制`)
  if (prompts.length === 0) throw new LibraryError('read-failed', '开源提示词源未返回可用的图片提示词')

  const scopedStore = sourceStore(input.store)
  const existing = scopedStore
    ? await scopedStore.listImportedBySource({ tag: config.tag, collections: config.collections, ...(incremental ? { sourceKeys: prompts.map((prompt) => prompt.sourceKey) } : {}) })
    : await input.store.list({ scope: 'global' })
  const bySourceKey = new Map<string, PromptAsset>()
  const staleImports: PromptAsset[] = []
  for (const item of existing) {
    const key = item.source === 'import' ? item.tags.find((tag) => tag.startsWith('source-id:')) : undefined
    const belongsToSource = item.tags.includes(config.tag) || config.collections.includes(item.collection)
    if (item.source !== 'import' || !belongsToSource) continue
    if (!key || bySourceKey.has(key)) staleImports.push(item)
    else bySourceKey.set(key, item)
  }
  const creates: SavePromptAssetInput[] = []
  const updates: Array<{ current: PromptAsset; input: SavePromptAssetInput }> = []
  let skipped = 0
  for (let index = 0; index < prompts.length; index += 1) {
    const prompt = prompts[index]
    const current = bySourceKey.get(prompt.sourceKey)
    if (current && sameImportedPrompt(current, prompt)) skipped += 1
    else {
      const saveInput: SavePromptAssetInput = {
        name: prompt.name,
        content: prompt.content,
        scope: 'global',
        kind: prompt.kind ?? 'prompt',
        tags: prompt.tags,
        source: 'import',
        collection: prompt.collection,
        category: prompt.category,
        ...(prompt.primaryLocale ? { primaryLocale: prompt.primaryLocale } : {}),
        ...(prompt.translations ? { translations: prompt.translations } : {}),
        ...(prompt.description ? { description: prompt.description } : {}),
        ...(prompt.previewUrl ? { previewUrl: prompt.previewUrl } : {}),
        ...(prompt.sourceUrl ? { sourceUrl: prompt.sourceUrl } : {}),
      }
      if (current) updates.push({ current, input: saveInput })
      else creates.push(saveInput)
    }
    if ((index + 1) % CATALOG_PLAN_BATCH_SIZE === 0) await wait(0)
  }
  if (!incremental) {
    const currentKeys = new Set(prompts.map((prompt) => prompt.sourceKey))
    for (const [key, item] of bySourceKey) {
      if (!currentKeys.has(key)) staleImports.push(item)
    }
  }

  if (input.database) input.database.exec('BEGIN IMMEDIATE')
  try {
    let imported = 0
    let updated = 0
    for (const item of updates) {
      const saveInput = item.input
      await input.store.update({ id: item.current.id, scope: 'global', name: saveInput.name, content: saveInput.content, kind: saveInput.kind, tags: saveInput.tags, source: 'import', collection: saveInput.collection, category: saveInput.category, primaryLocale: saveInput.primaryLocale, translations: saveInput.translations, description: saveInput.description ?? null, previewUrl: saveInput.previewUrl ?? null, sourceUrl: saveInput.sourceUrl ?? null })
      updated += 1
    }
    for (const saveInput of creates) {
      await input.store.save(saveInput)
      imported += 1
    }
    for (const item of staleImports) await input.store.remove({ id: item.id, scope: 'global' })
    const result = { source: input.source, imported, updated, removed: staleImports.length, skipped, total: prompts.length }
    if (input.database) {
      const now = new Date().toISOString()
      const version = catalogVersion ?? createHash('sha256').update(body).digest('hex')
      const runId = `catalog-sync-${input.source}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      input.database.run(
        'INSERT INTO prompt_catalog_sources (id, display_name, repository_url, adapter_id, enabled, last_success_version, last_success_at, last_error_code, last_error_message) VALUES (?, ?, ?, ?, 1, ?, ?, NULL, NULL) ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, repository_url = excluded.repository_url, adapter_id = excluded.adapter_id, enabled = 1, last_success_version = excluded.last_success_version, last_success_at = excluded.last_success_at, last_error_code = NULL, last_error_message = NULL',
        config.id, config.displayName, config.repositoryUrl, config.format, version, now,
      )
      input.database.run(
        'INSERT INTO prompt_catalog_checkpoints (source_id, remote_version, etag, last_modified, cursor_json, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(source_id) DO UPDATE SET remote_version = excluded.remote_version, etag = excluded.etag, last_modified = excluded.last_modified, cursor_json = COALESCE(excluded.cursor_json, prompt_catalog_checkpoints.cursor_json), updated_at = excluded.updated_at',
        config.id, version, response.headers.get('etag'), response.headers.get('last-modified'), cursorJson ?? checkpoint?.cursor_json ?? null, now,
      )
      input.database.run(
        'INSERT INTO prompt_catalog_sync_runs (id, source_id, status, records_seen, records_added, records_updated, records_removed, records_skipped, started_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        runId, config.id, 'succeeded', result.total, result.imported, result.updated, result.removed, result.skipped, startedAt, now,
      )
      input.database.exec('COMMIT')
    }
    if (input.cacheDirectory && nanmiCacheVersion) {
      await cleanNanmiCatalogCache(input.cacheDirectory, nanmiCacheVersion).catch(() => {})
    }
    return result
  } catch (error) {
    if (input.database) input.database.exec('ROLLBACK')
    throw error
  }
}

export async function syncPromptCatalog(input: SyncPromptCatalogInput): Promise<SyncPromptCatalogResult> {
  const active = ACTIVE_SYNCS.get(input.source)
  if (active) return active
  const startedAt = new Date().toISOString()
  const task = performPromptCatalogSync(input, startedAt).catch((error) => {
    const config = SOURCES[input.source]
    if (config && input.database) recordSyncFailure(input.database, config, error, startedAt)
    throw error
  }).finally(() => {
    if (ACTIVE_SYNCS.get(input.source) === task) ACTIVE_SYNCS.delete(input.source)
  })
  ACTIVE_SYNCS.set(input.source, task)
  return task
}
