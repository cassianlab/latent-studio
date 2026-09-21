import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import type { SearchResponse, SearchResult } from '../../shared/contracts/search'

const SEARCH_ENDPOINT = 'https://html.duckduckgo.com/html/'
const MAX_QUERY_LENGTH = 500
const DEFAULT_MAX_RESULTS = 8
const MAX_RESULTS = 20

export type SearchFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function query(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > MAX_QUERY_LENGTH) throw new Error(`搜索关键词需要是 1-${MAX_QUERY_LENGTH} 个字符`)
  return value.trim()
}

function maxResults(value: number | undefined): number {
  const candidate = value ?? DEFAULT_MAX_RESULTS
  if (!Number.isInteger(candidate) || candidate < 1 || candidate > MAX_RESULTS) throw new Error(`搜索结果数量需要是 1-${MAX_RESULTS} 的整数`)
  return candidate
}

function decodeHtml(value: string): string {
  return value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim()
}

function resultUrl(href: string): string | undefined {
  const value = decodeHtml(href)
  try {
    const url = new URL(value, SEARCH_ENDPOINT)
    if (url.hostname === 'duckduckgo.com' && url.pathname === '/l/') {
      const target = url.searchParams.get('uddg')
      if (target) return new URL(target).toString()
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined
    return url.toString()
  } catch { return undefined }
}

function parseResults(html: string, limit: number): SearchResult[] {
  const results: SearchResult[] = []
  const pattern = /<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  const matches = [...html.matchAll(pattern)]
  for (const [index, match] of matches.entries()) {
    const url = resultUrl(match[1] ?? '')
    const title = decodeHtml((match[2] ?? '').replace(/<[^>]+>/g, ''))
    if (!url || !title || results.some((item) => item.url === url)) continue
    const start = match.index ?? 0
    const end = matches[index + 1]?.index ?? html.length
    const block = html.slice(start, end)
    const snippetMatch = block.match(/class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div)>/i)
    const snippet = decodeHtml((snippetMatch?.[1] ?? '').replace(/<[^>]+>/g, ''))
    results.push({ title, url, snippet, source: new URL(url).hostname })
    if (results.length >= limit) break
  }
  return results
}

interface SearchSnapshot { version: 1; items: SearchResponse[] }

async function persist(root: string, response: SearchResponse): Promise<void> {
  const path = join(root, '.latent-studio', 'search.json')
  await fs.mkdir(dirname(path), { recursive: true })
  let previous: SearchSnapshot = { version: 1, items: [] }
  try {
    const parsed = JSON.parse(await fs.readFile(path, 'utf8')) as Partial<SearchSnapshot>
    if (parsed.version === 1 && Array.isArray(parsed.items)) previous = { version: 1, items: parsed.items.filter((item): item is SearchResponse => Boolean(item && typeof item === 'object' && typeof item.query === 'string' && Array.isArray(item.results))) }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('搜索历史损坏或无法读取')
  }
  const next = { version: 1 as const, items: [response, ...previous.items.filter((item) => item.query !== response.query)].slice(0, 50) }
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  try { await fs.writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, 'utf8'); await fs.rename(temporary, path) } catch (error) { try { await fs.unlink(temporary) } catch {} ; throw error }
}

export interface SearchServiceOptions { fetch?: SearchFetch; getProjectRoot?: () => string | undefined }

export async function searchWeb(input: { query: string; maxResults?: number; signal?: AbortSignal }, options: SearchServiceOptions = {}): Promise<SearchResponse> {
  const selectedQuery = query(input.query)
  const limit = maxResults(input.maxResults)
  const fetchImplementation = options.fetch ?? fetch
  const endpoint = `${SEARCH_ENDPOINT}?q=${encodeURIComponent(selectedQuery)}`
  let response: Response
  const timeout = AbortSignal.timeout(20_000)
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout
  try { response = await fetchImplementation(endpoint, { headers: { accept: 'text/html', 'user-agent': 'Latent Studio/0.2' }, redirect: 'error', signal }) } catch (error) {
    if (input.signal?.aborted) throw Object.assign(new Error('联网搜索已取消'), { code: 'cancelled' })
    throw new Error(`联网搜索失败：${error instanceof Error ? error.message : '网络错误'}`)
  }
  if (!response.ok) throw new Error(`联网搜索失败（HTTP ${response.status}）`)
  const html = await response.text()
  const result: SearchResponse = { query: selectedQuery, searchedAt: new Date().toISOString(), results: parseResults(html, limit) }
  const root = options.getProjectRoot?.()
  if (root) await persist(root, result)
  return result
}
