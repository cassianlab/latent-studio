import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Check, CloudDownload, Database, LoaderCircle, Plus, RefreshCw, Star } from 'lucide-react'
import type { LibraryScope, PromptAsset, PromptAssetKind, PromptCatalogSourceInfo } from '../../shared/contracts/library'
import { promptCategoryLabel } from '../../shared/prompt-categories'
import { getLibraryApi } from './library-api'
import { publishSelectedPrompt } from './prompt-selection'
import { filterPromptAssets, type PromptSourceFilter } from './prompt-filters'
import { PromptCard } from './PromptCard'
import { PromptSyncProgress } from './PromptSyncProgress'
import { EmbeddingModelDialog } from './EmbeddingModelDialog'
import { syncPromptCatalogWithEmbeddings, type PromptCatalogSyncProgress } from './prompt-sync'
import { PromptEditorDialog } from './PromptEditorDialog'
import './PromptLibraryPage.css'

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }): React.ReactElement {
  return <div className="start-state error" role="alert"><span>{message}</span><button className="icon-button" aria-label="重试" onClick={onRetry}><RefreshCw size={16} /></button></div>
}

function ScopeTabs({ value, onChange }: { value: 'all' | LibraryScope; onChange: (value: 'all' | LibraryScope) => void }): React.ReactElement {
  return <div className="memory-tabs"><button className={value === 'all' ? 'active' : ''} onClick={() => onChange('all')}>全部</button><button className={value === 'global' ? 'active' : ''} onClick={() => onChange('global')}>全局</button><button className={value === 'project' ? 'active' : ''} onClick={() => onChange('project')}>当前项目</button></div>
}

export function PromptLibraryPage({ onApplyPrompt = publishSelectedPrompt }: { onApplyPrompt?: (prompt: string) => void } = {}): React.ReactElement {
  const [items, setItems] = useState<PromptAsset[]>([])
  const [scope, setScope] = useState<'all' | LibraryScope>('all')
  const [source, setSource] = useState<PromptSourceFilter>('all')
  const [kind, setKind] = useState<'all' | PromptAssetKind>('all')
  const [category, setCategory] = useState('all')
  const [favoriteOnly, setFavoriteOnly] = useState(false)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncStatus, setSyncStatus] = useState<string | null>(null)
  const [syncProgress, setSyncProgress] = useState<PromptCatalogSyncProgress | null>(null)
  const [syncResults, setSyncResults] = useState<PromptCatalogSyncProgress[]>([])
  const [error, setError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [editor, setEditor] = useState<{ open: boolean; item?: PromptAsset }>({ open: false })
  const [localCount, setLocalCount] = useState(0)
  const [resultTotal, setResultTotal] = useState(0)
  const [globalOffset, setGlobalOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [categories, setCategories] = useState<string[]>([])
  const [catalogSources, setCatalogSources] = useState<PromptCatalogSourceInfo[]>([])
  const [embeddingOpen, setEmbeddingOpen] = useState(false)
  const [indexingAfterSync, setIndexingAfterSync] = useState(false)
  const api = useMemo(() => getLibraryApi(), [])
  const deferredSearch = useDeferredValue(search)
  const loadVersion = useRef(0)

  useEffect(() => { void api.listPromptCatalogSources().then(setCatalogSources).catch(() => setCatalogSources([])) }, [])
  useEffect(() => () => { loadVersion.current += 1; void api.releasePromptLibraryResources() }, [api])

  const load = async () => {
    const version = ++loadVersion.current
    setLoading(true); setError(null)
    try {
      const [projectItems, globalPage] = await Promise.all([
        scope === 'global' ? Promise.resolve([]) : api.listPrompts({ scope: 'project', search: deferredSearch.trim() || undefined }),
        scope === 'project' ? Promise.resolve({ items: [], total: 0, offset: 0, limit: 60, hasMore: false, categories: [] }) : api.listPromptPage({
          scope: 'global',
          search: deferredSearch.trim() || undefined,
          source,
          kind: kind === 'all' ? undefined : kind,
          category: category === 'all' ? undefined : category,
          favoriteOnly,
          offset: 0,
          limit: 60,
        }),
      ])
      if (version !== loadVersion.current) return
      const filteredProject = filterPromptAssets(projectItems, { scope, source, kind, category, favoriteOnly })
      const nextItems = [...filteredProject, ...globalPage.items]
      setItems(nextItems)
      setGlobalOffset(globalPage.items.length)
      setHasMore(globalPage.hasMore)
      setResultTotal(filteredProject.length + globalPage.total)
      setCategories([...new Set([...globalPage.categories, ...projectItems.map((item) => item.category)].map(promptCategoryLabel))].sort((a, b) => a.localeCompare(b, 'zh-CN')))
      if (!deferredSearch.trim() && scope === 'all' && source === 'all' && kind === 'all' && category === 'all' && !favoriteOnly) setLocalCount(filteredProject.length + globalPage.total)
    } catch (cause) { if (version === loadVersion.current) setError(cause instanceof Error ? cause.message : '提示词库读取失败') } finally { if (version === loadVersion.current) setLoading(false) }
  }
  useEffect(() => {
    void load()
    return () => { loadVersion.current += 1 }
  }, [category, deferredSearch, favoriteOnly, kind, scope, source])

  const loadMore = async () => {
    if (loadingMore || !hasMore || scope === 'project') return
    setLoadingMore(true)
    try {
      const page = await api.listPromptPage({ scope: 'global', search: deferredSearch.trim() || undefined, source, kind: kind === 'all' ? undefined : kind, category: category === 'all' ? undefined : category, favoriteOnly, offset: globalOffset, limit: 60 })
      setItems((current) => [...current, ...page.items])
      setGlobalOffset((current) => current + page.items.length)
      setHasMore(page.hasMore)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '提示词库读取失败') } finally { setLoadingMore(false) }
  }
  const copyPrompt = async (item: PromptAsset, content = item.content) => {
    try { await navigator.clipboard.writeText(content); setCopiedId(item.id); setTimeout(() => setCopiedId(null), 1500) } catch {}
  }
  const toggleFavorite = async (item: PromptAsset) => {
    try {
      await api.updatePrompt({ id: item.id, scope: item.scope, favorite: !item.favorite })
      await load()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '收藏状态更新失败') }
  }
  const remove = async (item: PromptAsset) => {
    if (!window.confirm(`确认删除「${item.name} v${item.version}」？`)) return
    try { await api.removePrompt({ id: item.id, scope: item.scope }); await load() } catch (cause) { setError(cause instanceof Error ? cause.message : '提示词删除失败') }
  }
  const sync = async () => {
    setSyncing(true); setError(null); setSyncStatus(null); setSyncProgress(null); setSyncResults([])
    try {
      const sources = catalogSources.length ? catalogSources : await api.listPromptCatalogSources()
      if (!catalogSources.length) setCatalogSources(sources)
      const labels = new Map(sources.map((item) => [item.id, item.displayName]))
      const syncResult = await syncPromptCatalogWithEmbeddings(api, sources.map((item) => item.id), (progress) => {
        setSyncProgress(progress)
        if (progress.state !== 'syncing') setSyncResults((current) => [...current.filter((item) => item.source !== progress.source), progress])
      }, setIndexingAfterSync)
      const result = syncResult.catalog
      const completed = sources.length - result.failures.length
      const sourceTotal = result.sourceResults.reduce((total, item) => total + (item.result?.total ?? 0), 0)
      const summary = `已同步 ${completed}/${sources.length} 个仓库 · 来源条目 ${sourceTotal} · 新增 ${result.imported} · 更新 ${result.updated} · 移除 ${result.removed} · 未变化 ${result.skipped}`
      const catalogFailure = result.failures.length ? ` · 仓库失败：${result.failures.map((item) => labels.get(item.source) ?? item.source).join('、')}` : ''
      const embeddingSummary = syncResult.embeddingUpdated ? ' · 语义索引已增量更新' : syncResult.embeddingError ? ` · 语义索引失败：${syncResult.embeddingError}` : ''
      setSyncStatus(`${summary}${catalogFailure}${embeddingSummary}`)
      await load()
      setCatalogSources(await api.listPromptCatalogSources())
      setSource('all')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '开源提示词同步失败') } finally { setSyncing(false); setIndexingAfterSync(false) }
  }

  return <div className="content-page" aria-busy={loading || syncing}>
    <div className="section-heading"><div><h2>提示词库</h2><p>本地 {localCount} 条 · 当前筛选 {resultTotal} 条</p></div><div className="prompt-heading-actions"><button className="secondary small" onClick={() => setEmbeddingOpen(true)}><Database size={15} />语义检索</button><button className="secondary small" onClick={() => void sync()} disabled={syncing || !catalogSources.length}><CloudDownload size={15} />{indexingAfterSync ? '正在更新语义索引…' : syncing ? `正在同步 ${catalogSources.length} 个仓库…` : '同步更新'}</button><button className="primary small" onClick={() => setEditor({ open: true })}><Plus size={15} />新建提示词</button></div></div>
    <PromptSyncProgress sources={catalogSources} syncing={syncing} progress={syncProgress} results={syncResults} />
    {syncStatus && <div className="sync-status" role="status"><Check size={14} /><span>{syncStatus}</span></div>}
    <div className="library-toolbar prompt-library-toolbar"><ScopeTabs value={scope} onChange={setScope} /><div className="prompt-source-tabs"><button className={source === 'all' ? 'active' : ''} onClick={() => setSource('all')}>全部</button><button className={source === 'mine' ? 'active' : ''} onClick={() => setSource('mine')}>我的</button>{catalogSources.map((item) => <button key={item.id} className={source === item.id ? 'active' : ''} onClick={() => setSource(item.id)} title={`${item.displayName} · 本地 ${item.localCount} 条 · ${item.repositoryUrl}`}>{item.displayName} <span className="prompt-source-count">{item.localCount}</span></button>)}</div><label className="library-search"><span>搜索</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="名称、提示词、风格或场景" /></label></div>
    <div className="prompt-filter-row">
      <label><span>分类</span><select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="按提示词分类筛选"><option value="all">全部分类</option>{categories.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label><span>类型</span><select value={kind} onChange={(event) => setKind(event.target.value as 'all' | PromptAssetKind)} aria-label="按提示词类型筛选"><option value="all">全部类型</option><option value="prompt">提示词</option><option value="template">模板</option><option value="style">风格</option></select></label>
      <button className={`secondary small prompt-favorite-filter ${favoriteOnly ? 'selected' : ''}`} onClick={() => setFavoriteOnly((value) => !value)} aria-pressed={favoriteOnly}><Star size={14} fill={favoriteOnly ? 'currentColor' : 'none'} />只看收藏</button>
    </div>
    {loading ? <div className="start-state"><LoaderCircle size={17} className="spin" />正在读取提示词库…</div> : error ? <ErrorState message={error} onRetry={() => void load()} /> : items.length ? <><div className="prompt-grid">{items.map((item) => <PromptCard key={`${item.scope}-${item.id}`} item={item} copied={copiedId === item.id} onCopy={(content) => void copyPrompt(item, content)} onApply={(prompt) => { onApplyPrompt(prompt ?? item.content); setSyncStatus(`已将「${item.name}」填入图片模式`) }} onToggleFavorite={() => void toggleFavorite(item)} onEdit={() => setEditor({ open: true, item })} onRemove={() => void remove(item)} />)}</div>{hasMore && <div className="prompt-load-more"><button type="button" className="secondary" onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? '正在加载…' : `加载更多（剩余 ${Math.max(0, resultTotal - items.length)}）`}</button></div>}</> : <div className="start-state">没有符合当前筛选条件的提示词。</div>}
    <PromptEditorDialog open={editor.open} item={editor.item} onOpenChange={(open) => setEditor(open ? editor : { open: false })} onSaved={load} />
    <EmbeddingModelDialog open={embeddingOpen} onClose={() => setEmbeddingOpen(false)} />
  </div>
}

export { MemoryLibraryPage } from './MemoryLibraryPage'
