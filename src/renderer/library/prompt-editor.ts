import type { LibraryScope, PromptAsset, PromptAssetKind, PromptLocale, SavePromptAssetInput } from '../../shared/contracts/library'

export interface PromptEditorDraft {
  name: string
  content: string
  scope: LibraryScope
  kind: PromptAssetKind
  collection: string
  category: string
  tagsText: string
  favorite: boolean
  primaryLocale: PromptLocale
  translationZh: string
  translationEn: string
  description: string
  previewUrl: string
  sourceUrl: string
}

export interface PromptEditorErrors {
  name?: string
  content?: string
  collection?: string
  category?: string
  previewUrl?: string
  sourceUrl?: string
}

export function createPromptEditorDraft(item?: PromptAsset): PromptEditorDraft {
  return {
    name: item?.name ?? '',
    content: item?.content ?? '',
    scope: item?.source === 'import' ? 'global' : item?.scope ?? 'project',
    kind: item?.kind ?? 'prompt',
    collection: item?.source === 'import' ? '个人' : item?.collection ?? '个人',
    category: item?.category ?? '未分类',
    tagsText: item?.source === 'import' ? '' : item?.tags.join('，') ?? '',
    favorite: item?.favorite === true,
    primaryLocale: item?.primaryLocale ?? 'und',
    translationZh: item?.translations?.['zh-CN'] ?? '',
    translationEn: item?.translations?.en ?? '',
    description: item?.description ?? '',
    previewUrl: item?.previewUrl ?? '',
    sourceUrl: item?.sourceUrl ?? '',
  }
}

function optionalHttpUrl(value: string): boolean {
  if (!value.trim()) return true
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function derivePromptTitle(content: string): string {
  const line = content.trim().split(/\n+/)[0]
    ?.replace(/^\s*(?:prompt|提示词)\s*[:：]\s*/i, '')
    .replace(/\{([^{}]+)\}/g, '$1')
    .replace(/\[([^:[\]]+)(?::[^\]]+)?\]/g, '$1') ?? ''
  const phrase = line.split(/[，。！？!?；;,.]/)[0]?.trim() ?? ''
  return (phrase || line).replace(/\s+/g, ' ').slice(0, 28)
}

export function validatePromptEditorDraft(draft: PromptEditorDraft): PromptEditorErrors {
  return {
    ...(!draft.name.trim() ? { name: '请输入名称' } : {}),
    ...(!draft.content.trim() ? { content: '请输入提示词内容' } : {}),
    ...(!draft.collection.trim() ? { collection: '请输入分组' } : {}),
    ...(!draft.category.trim() ? { category: '请输入分类' } : {}),
    ...(!optionalHttpUrl(draft.previewUrl) ? { previewUrl: '请输入 http 或 https 地址' } : {}),
    ...(!optionalHttpUrl(draft.sourceUrl) ? { sourceUrl: '请输入 http 或 https 地址' } : {}),
  }
}

export function normalizePromptEditorDraft(draft: PromptEditorDraft): SavePromptAssetInput {
  const tags = [...new Set(draft.tagsText.split(/[,，\n]/).map((tag) => tag.trim()).filter(Boolean))].slice(0, 30)
  const translationZh = draft.translationZh.trim()
  const translationEn = draft.translationEn.trim()
  const translations = {
    ...(translationZh && !(draft.primaryLocale === 'zh-CN' && translationZh === draft.content.trim()) ? { 'zh-CN': translationZh } : {}),
    ...(translationEn && !(draft.primaryLocale === 'en' && translationEn === draft.content.trim()) ? { en: translationEn } : {}),
  }
  const description = draft.description.trim()
  const previewUrl = draft.previewUrl.trim()
  const sourceUrl = draft.sourceUrl.trim()
  return {
    name: draft.name.trim(),
    content: draft.content.trim(),
    scope: draft.scope,
    kind: draft.kind,
    collection: draft.collection.trim(),
    category: draft.category.trim(),
    tags,
    favorite: draft.favorite,
    source: 'manual',
    primaryLocale: draft.primaryLocale,
    ...(Object.keys(translations).length ? { translations } : {}),
    ...(description ? { description } : {}),
    ...(previewUrl ? { previewUrl } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
  }
}
