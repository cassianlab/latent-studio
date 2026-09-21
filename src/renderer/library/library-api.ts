import type { LibraryApi, MemoryEntry, ProjectAsset, PromptAsset } from '../../shared/contracts/library'
import { rankPromptAssets } from '../../shared/prompt-ranking'
import { defaultQuickPrompts, type QuickPrompt } from '../../shared/quick-prompts'

const prompts: PromptAsset[] = []
const memories: MemoryEntry[] = [
  {
    id: 'mock-memory-1',
    title: '胶片电影质感设定',
    content: '所有画面优先呈现柯达胶片（Kodak Portra 400）颗粒质感，色温偏暖，暗部泛微绿，高光柔和泛光，避免塑料感与过饱和 CG 质感。',
    scope: 'global',
    version: 1,
    active: true,
    source: '默认全局设定',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'mock-memory-2',
    title: '主角统一外观设定',
    content: '主角艾莉亚（Aria）：24岁东亚女性，银灰色微卷中短发，右眉尾有微小疤痕，常穿深灰机能防水风衣配琥珀色护目镜。',
    scope: 'project',
    version: 1,
    active: true,
    source: '项目角色设定集',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'mock-memory-3',
    title: '构图景别与光学虚化规范',
    content: '中景与特写镜头严格遵循 16:9 画幅，主体置于三分法则黄金分割点，景深虚化需具有真实光学大光圈散景效果。',
    scope: 'project',
    version: 1,
    active: false,
    source: '导演构图指南',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
]
const mockAssets: ProjectAsset[] = []
const mockAssetPreviews: Record<string, string> = {}
let mockQuickPrompts: QuickPrompt[] = defaultQuickPrompts()

const mockApi: LibraryApi = {
  async listPrompts(input) {
    const search = input?.search?.trim().toLocaleLowerCase('zh-CN')
    return structuredClone(prompts.filter((item) =>
      !item.deletedAt
      && (!input?.scope || item.scope === input.scope)
      && (!search || [item.name, item.content, item.translations?.['zh-CN'] ?? '', item.translations?.en ?? '', item.description ?? '', item.collection, item.category, ...item.tags].some((value) => value.toLocaleLowerCase('zh-CN').includes(search)))
    ))
  },
  async listPromptPage(input) {
    const items = await mockApi.listPrompts(input)
    const offset = Math.max(0, Math.trunc(input.offset ?? 0))
    const limit = Math.min(100, Math.max(1, Math.trunc(input.limit ?? 60)))
    return { items: items.slice(offset, offset + limit), total: items.length, offset, limit, hasMore: offset + limit < items.length, categories: [...new Set(items.map((item) => item.category))] }
  },
  async releasePromptLibraryResources() {},
  async searchPromptLibrary({ query, limit }) {
    return rankPromptAssets(prompts.filter((item) => !item.deletedAt), query, limit).map((item, index) => ({ id: item.id, title: item.name, content: item.content, category: item.category, type: item.kind, collection: item.collection, ...(item.previewUrl ? { thumbnailUrl: item.previewUrl } : {}), ...(item.sourceUrl ? { sourceUrl: item.sourceUrl } : {}), score: Number((1 - index * 0.1).toFixed(2)), reason: '关键词相关', retrievalMode: 'lexical' as const, fallbackReason: 'local_embedding_unavailable' as const }))
  },
  async getPrompt({ id }) { return prompts.find((item) => item.id === id && !item.deletedAt) ?? null },
  async savePrompt(input) { const item = { id: `mock-prompt-${Date.now()}`, name: input.name, content: input.content, scope: input.scope, kind: input.kind ?? 'prompt', version: 1, tags: [...(input.tags ?? [])], favorite: input.favorite === true, collection: input.collection?.trim() || '个人', category: input.category?.trim() || '未分类', ...(input.source ? { source: input.source } : {}), ...(input.primaryLocale ? { primaryLocale: input.primaryLocale } : {}), ...(input.translations ? { translations: { ...input.translations } } : {}), ...(input.description ? { description: input.description } : {}), ...(input.previewUrl ? { previewUrl: input.previewUrl } : {}), ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as PromptAsset; prompts.unshift(item); return structuredClone(item) },
  async quickSavePrompt(input) { return mockApi.savePrompt(input) },
  async updatePrompt(input) {
    const item = prompts.find((entry) => entry.id === input.id && entry.scope === input.scope)
    if (!item) throw new Error('提示词不存在')
    if (input.name !== undefined) item.name = input.name
    if (input.content !== undefined) item.content = input.content
    if (input.kind !== undefined) item.kind = input.kind
    if (input.tags !== undefined) item.tags = [...input.tags]
    if (input.favorite !== undefined) item.favorite = input.favorite
    if (input.collection !== undefined) item.collection = input.collection
    if (input.category !== undefined) item.category = input.category
    if (input.primaryLocale !== undefined) item.primaryLocale = input.primaryLocale
    if (input.translations !== undefined) item.translations = { ...input.translations }
    if (input.description !== undefined) {
      if (input.description === null) delete item.description
      else item.description = input.description
    }
    if (input.previewUrl !== undefined) {
      if (input.previewUrl === null) delete item.previewUrl
      else item.previewUrl = input.previewUrl
    }
    if (input.sourceUrl !== undefined) {
      if (input.sourceUrl === null) delete item.sourceUrl
      else item.sourceUrl = input.sourceUrl
    }
    item.updatedAt = new Date().toISOString()
    return structuredClone(item)
  },
  async removePrompt({ id }) { const item = prompts.find((value) => value.id === id); if (item) item.deletedAt = new Date().toISOString() },
  async restorePrompt({ id }) { const item = prompts.find((value) => value.id === id); if (item) delete item.deletedAt },
  async syncPromptCatalog({ source }) { return { source, imported: 0, updated: 0, removed: 0, skipped: 0, total: prompts.filter((item) => item.source === 'import').length } },
  async listPromptCatalogSources() { return [
    { id: 'youmind-gpt-image-2', displayName: 'YouMind GPT Image 2', repositoryUrl: 'https://github.com/YouMind-OpenLab/awesome-gpt-image-2', localCount: prompts.filter((item) => item.tags.includes('youmind-gpt-image-2')).length },
    { id: 'wangrunlin-gpt-image-2-5', displayName: 'wangrunlin GPT Image 2.5', repositoryUrl: 'https://github.com/wangrunlin/awesome-gpt-image-2-5-prompts', localCount: prompts.filter((item) => item.tags.includes('wangrunlin-gpt-image-2-5')).length },
    { id: 'vigo-ai-visual-prompt-cookbook', displayName: 'AI Visual Prompt Cookbook', repositoryUrl: 'https://github.com/VigoZhao/AI-Visual-Prompt-Cookbook', localCount: prompts.filter((item) => item.tags.includes('vigo-ai-visual-prompt-cookbook')).length },
    { id: 'stretchcloud-gpt-image-prompt-2-5', displayName: 'stretchcloud GPT Image 2.5', repositoryUrl: 'https://github.com/stretchcloud/awesome-gpt-image-prompt-2.5', localCount: prompts.filter((item) => item.tags.includes('stretchcloud-gpt-image-prompt-2-5')).length },
    { id: 'nanimicoder-open-image-prompts', displayName: 'NanmiCoder Open Image Prompts', repositoryUrl: 'https://github.com/NanmiCoder/open-image-prompts', localCount: prompts.filter((item) => item.tags.includes('nanimicoder-open-image-prompts')).length },
    { id: 'awesome-gpt-image-2', displayName: 'freestylefly GPT Image 2', repositoryUrl: 'https://github.com/freestylefly/awesome-gpt-image-2', localCount: prompts.filter((item) => item.tags.includes('awesome-gpt-image-2')).length },
  ] },
  async getEmbeddingStatus() { return { status: 'unavailable' as const, modelId: null, version: null, license: null, sourceUrl: null, diskBytes: 0, indexedCount: 0, totalCount: 0, pendingCount: 0, retrievalMode: 'lexical' as const, fallbackReason: 'local_embedding_unavailable' as const } },
  async installEmbeddingModel() { return mockApi.getEmbeddingStatus() },
  async updateEmbeddings() { return mockApi.getEmbeddingStatus() },
  async rebuildEmbeddings() { return mockApi.getEmbeddingStatus() },
  async clearEmbeddings() { return mockApi.getEmbeddingStatus() },
  async uninstallEmbeddingModel() { return mockApi.getEmbeddingStatus() },
  async listQuickPrompts() { return structuredClone(mockQuickPrompts) },
  async saveQuickPrompt(input) {
    const item: QuickPrompt = { ...input, id: input.id?.trim() || `mock-quick-${Date.now()}`, title: input.title.trim(), prompt: input.prompt.trim(), updatedAt: new Date().toISOString() }
    const existing = mockQuickPrompts.findIndex((value) => value.id === item.id)
    if (existing >= 0) mockQuickPrompts[existing] = item
    else mockQuickPrompts.push(item)
    return structuredClone(item)
  },
  async removeQuickPrompt({ id }) { mockQuickPrompts = mockQuickPrompts.filter((item) => item.id !== id) },
  async listMemories(input) {
    return structuredClone(
      memories.filter((item) => {
        if (item.deletedAt) return false
        if (input?.scope && item.scope !== input.scope) return false
        if (input?.activeOnly && item.active === false) return false
        if (input?.search) {
          const q = input.search.toLowerCase()
          if (!item.title.toLowerCase().includes(q) && !item.content.toLowerCase().includes(q) && !(item.source?.toLowerCase().includes(q))) return false
        }
        return true
      })
    )
  },
  async getMemory({ id }) { return memories.find((item) => item.id === id && !item.deletedAt) ?? null },
  async saveMemory(input) { const item = { id: `mock-memory-${Date.now()}`, title: input.title, content: input.content, scope: input.scope, version: 1, active: input.active !== false, ...(input.category ? { category: input.category } : {}), ...(input.source ? { source: input.source } : {}), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; memories.unshift(item); return structuredClone(item) },
  async updateMemory(input) {
    const item = memories.find((entry) => entry.id === input.id)
    if (!item) throw new Error('记忆不存在')
    if (input.title !== undefined) item.title = input.title
    if (input.content !== undefined) item.content = input.content
    if (input.active !== undefined) item.active = input.active
    if (input.category !== undefined) item.category = input.category
    if (input.source !== undefined) item.source = input.source
    item.updatedAt = new Date().toISOString()
    return structuredClone(item)
  },
  async removeMemory({ id }) { const item = memories.find((value) => value.id === id); if (item) item.deletedAt = new Date().toISOString() },
  async restoreMemory({ id }) { const item = memories.find((value) => value.id === id); if (item) delete item.deletedAt },
  async listProjectItems() { return [] },
  async inspectProjectItem() { throw new Error('浏览器预览不支持项目文件读取') },
  async saveProjectDocument(input) { return { relativePath: `documents/${input.title.replace(/[^\w\u4e00-\u9fa5-]+/g, '-')}.md`, name: input.title, kind: 'document' as const, extension: '.md', mimeType: 'text/markdown', isDirectory: false, byteLength: input.content.length, modifiedAt: new Date().toISOString() } },
  async updateProjectDocument(input) { return { relativePath: input.filePath, name: input.title, kind: 'document' as const, extension: '.md', mimeType: 'text/markdown', isDirectory: false, byteLength: input.content.length, modifiedAt: new Date().toISOString() } },
  async deleteProjectDocument() { /* mock delete */ },
  async restoreProjectDocument() { /* mock restore */ },
  async importAssets(input) {
    if (input?.filePaths && input.filePaths.length > 0) {
      const now = new Date().toISOString()
      const imported: ProjectAsset[] = input.filePaths.map((fp, idx) => ({
        id: `mock-asset-${Date.now()}-${idx}`,
        name: fp.split(/[/\\]/).pop() ?? 'asset.png',
        sourceName: fp.split(/[/\\]/).pop() ?? 'asset.png',
        category: input.category ?? 'output',
        relativePath: `assets/${fp.split(/[/\\]/).pop() ?? 'asset.png'}`,
        extension: '.png',
        mimeType: 'image/png',
        byteLength: 1024,
        modifiedAt: now,
        importedAt: now,
        previewable: true,
      }))
      mockAssets.unshift(...imported)
      return imported
    }
    throw new Error('浏览器预览不支持文件导入')
  },
  async chooseReferenceImages() { return [] },
  async saveReferenceImage(input) {
    const now = new Date().toISOString()
    const id = `mock-sketch-${Date.now()}`
    const item: ProjectAsset = { id, name: `${input.name}.png`, sourceName: `${input.name}.png`, category: 'reference', relativePath: `assets/${input.name}.png`, extension: '.png', mimeType: 'image/png', byteLength: input.dataUrl.length, modifiedAt: now, importedAt: now, previewable: true, origin: 'imported' }
    mockAssets.unshift(item)
    mockAssetPreviews[id] = input.dataUrl
    return structuredClone(item)
  },
  async listAssets(input) { return structuredClone(mockAssets.filter((item) => !input?.category || item.category === input.category)) },
  async updateAsset({ id, category }) { const item = mockAssets.find((entry) => entry.id === id); if (!item) throw new Error('素材不存在'); item.category = category; return structuredClone(item) },
  async removeAsset({ id }) { const index = mockAssets.findIndex((item) => item.id === id); if (index >= 0) mockAssets.splice(index, 1) },
  async getAssetPreview({ id }) { return mockAssetPreviews[id] ?? null },
  async revealAsset() { return true },
}

export function getLibraryApi(): LibraryApi {
  if (typeof window !== 'undefined' && window.latentStudio?.library) return window.latentStudio.library
  return mockApi
}
