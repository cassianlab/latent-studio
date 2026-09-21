import type { PromptAsset } from './contracts/library'

const SYNONYMS: Record<string, string[]> = {
  '人物': ['人像', '肖像', 'portrait', 'character'], '人像': ['人物', '肖像', 'portrait'],
  '肖像': ['人物', '人像', 'portrait'], '风景': ['风光', '景观', 'landscape'], '风光': ['风景', 'landscape'],
  '商品': ['产品', '电商', 'product'], '产品': ['商品', '电商', 'product'], '电商': ['商品', '产品', 'product'],
  '海报': ['平面', 'poster', 'typography'], '摄影': ['写实', '照片', 'photo'], '徽章': ['纪念章', '纪念品', 'badge', 'pin'],
}

export function normalizePromptSearchText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim()
}

export function promptSearchGrams(value: string, limit = Number.POSITIVE_INFINITY): string[] {
  const result: string[] = []
  for (const sequence of normalizePromptSearchText(value).match(/[\p{Script=Han}]+/gu) ?? []) {
    if (sequence.length <= 3) {
      result.push(sequence)
      if (result.length >= limit) return result
    }
    for (const size of [2, 3]) {
      for (let index = 0; index <= sequence.length - size; index += 1) {
        result.push(sequence.slice(index, index + size))
        if (result.length >= limit) return result
      }
    }
  }
  return result
}

export function promptSearchTerms(query: string): string[] {
  const normalized = normalizePromptSearchText(query)
  const result = [...(normalized.match(/[a-z0-9][a-z0-9-]*/g) ?? []), ...promptSearchGrams(normalized)]
  for (const [term, aliases] of Object.entries(SYNONYMS)) if (normalized.includes(term)) result.push(...aliases)
  return [...new Set(result.flatMap((term) => [term, ...promptSearchGrams(term)]).filter(Boolean))]
}

export function canonicalPromptContent(value: string): string {
  return normalizePromptSearchText(value).replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\s+/g, ' ').trim()
}

export function promptSearchEvidence(item: PromptAsset, query: string, queryTerms = promptSearchTerms(query), normalizedQuery = normalizePromptSearchText(query)): { value: number; matches: string[] } {
  const title = normalizePromptSearchText(item.name)
  const category = normalizePromptSearchText(item.category)
  const content = normalizePromptSearchText([item.content, item.translations?.['zh-CN'], item.translations?.en, item.description].filter(Boolean).join(' '))
  const tags = item.tags.map(normalizePromptSearchText)
  const collection = normalizePromptSearchText(item.collection)
  let value = 0
  const matches = new Set<string>()
  const covered = new Set<string>()
  for (const term of queryTerms) {
    if (title.includes(term)) { value += 8; covered.add(term); matches.add(`标题“${term}”`) }
    if (category.includes(term)) { value += 6; covered.add(term); matches.add(`分类“${item.category}”`) }
    if (tags.some((tag) => tag.includes(term)) || collection.includes(term)) { value += 3; covered.add(term); matches.add(`标签“${term}”`) }
    if (content.includes(term)) { value += 2; covered.add(term); matches.add(`正文“${term}”`) }
  }
  const coverage = queryTerms.length ? covered.size / queryTerms.length : 0
  value += coverage * 12 + (coverage === 1 && queryTerms.length > 1 ? 8 : 0)
  if (title.includes(normalizedQuery)) { value += 10; matches.add('标题完整匹配') }
  if (content.includes(normalizedQuery)) { value += 6; matches.add('正文完整匹配') }
  if (item.favorite) value += 0.25
  return { value, matches: [...matches] }
}

export function rankPromptAssets(items: readonly PromptAsset[], query: string, limit = 4): PromptAsset[] {
  const normalizedQuery = normalizePromptSearchText(query)
  if (!normalizedQuery) return []
  const queryTerms = promptSearchTerms(query)
  const ranked = items.map((item) => ({ item, value: promptSearchEvidence(item, query, queryTerms, normalizedQuery).value })).filter((item) => item.value > 0).sort((a, b) => b.value - a.value || Number(b.item.favorite) - Number(a.item.favorite) || b.item.updatedAt.localeCompare(a.item.updatedAt) || a.item.id.localeCompare(b.item.id))
  const seen = new Set<string>()
  const result: PromptAsset[] = []
  for (const entry of ranked) {
    const key = canonicalPromptContent(entry.item.content)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(entry.item)
    if (result.length >= Math.min(4, Math.max(1, limit))) break
  }
  return result
}
