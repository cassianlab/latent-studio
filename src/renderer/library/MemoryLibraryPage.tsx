import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Brain,
  Check,
  Clock,
  Copy,
  FolderLock,
  Globe,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  X,
  Zap,
} from 'lucide-react'
import type { LibraryScope, MemoryEntry } from '../../shared/contracts/library'
import { compileMemories } from '../../shared/memory/compiler'
import { memoryCategoryLabel, resolveMemoryCategory } from '../../shared/memory/categories'
import { getLibraryApi } from './library-api'
import { MemoryEditorModal, PRESET_TEMPLATES, type MemoryPreset } from './MemoryEditorModal'
import { DeleteMemoryDialog } from './DeleteMemoryDialog'
import './MemoryLibraryPage.css'

export { PRESET_TEMPLATES }

export interface MemoryFilterOptions {
  search?: string
  scope?: 'all' | LibraryScope
  status?: 'all' | 'active' | 'inactive'
}

function isMemoryActive(item: MemoryEntry): boolean {
  return item.active !== false
}

/**
 * 记忆本地快速过滤，避免输入搜索词时重复触发 Electron IPC 读盘
 */
export function filterMemories(items: MemoryEntry[], options: MemoryFilterOptions): MemoryEntry[] {
  const query = (options.search ?? '').trim().toLowerCase()
  const scope = options.scope ?? 'all'
  const status = options.status ?? 'all'

  return items.filter((item) => {
    if (scope !== 'all' && item.scope !== scope) return false
    if (status === 'active' && !isMemoryActive(item)) return false
    if (status === 'inactive' && isMemoryActive(item)) return false
    if (query) {
      const titleMatch = item.title.toLowerCase().includes(query)
      const contentMatch = item.content.toLowerCase().includes(query)
      const sourceMatch = (item.source ?? '').toLowerCase().includes(query)
      const categoryMatch = memoryCategoryLabel(resolveMemoryCategory(item)).toLowerCase().includes(query)
      if (!titleMatch && !contentMatch && !sourceMatch && !categoryMatch) {
        return false
      }
    }
    return true
  })
}

/**
 * 返回被覆盖记忆 ID -> 实际生效记忆，同时包含语义类别冲突和作用域覆盖。
 */
export function detectMemoryConflicts(items: MemoryEntry[]): Map<string, MemoryEntry> {
  const projectMemories = items.filter((m) => m.scope === 'project')
  const globalMemories = items.filter((m) => m.scope === 'global')
  const compiled = compileMemories({ projectMemories, globalMemories })
  const conflictMap = new Map<string, MemoryEntry>()
  for (const overridden of compiled.overriddenMemories) {
    conflictMap.set(overridden.memory.id, overridden.overriddenBy)
  }
  return conflictMap
}

/**
 * 格式化最近使用时间，若无记录显示“暂未使用”
 */
export function formatLastUsedTime(lastUsedAt?: string): string {
  if (!lastUsedAt) return '暂未使用'
  try {
    const date = new Date(lastUsedAt)
    if (isNaN(date.getTime())) return '暂未使用'
    const pad = (n: number) => n.toString().padStart(2, '0')
    const year = date.getFullYear()
    const month = pad(date.getMonth() + 1)
    const day = pad(date.getDate())
    const hours = pad(date.getHours())
    const minutes = pad(date.getMinutes())
    return `${year}-${month}-${day} ${hours}:${minutes}`
  } catch {
    return '暂未使用'
  }
}

export function MemoryLibraryPage(): React.ReactElement {
  const [items, setItems] = useState<MemoryEntry[]>([])
  const [scope, setScope] = useState<'all' | LibraryScope>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [showPresets, setShowPresets] = useState(false)
  const [editor, setEditor] = useState<{
    open: boolean
    item?: MemoryEntry
    initialPreset?: MemoryPreset
  }>({ open: false })
  const [deletingMemory, setDeletingMemory] = useState<MemoryEntry | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const api = useMemo(() => getLibraryApi(), [])

  // 仅在初次加载、保存、切换状态或删除后调用 API，搜索按键不触发主进程读取
  const loadMemories = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [projectMemories, globalMemories] = await Promise.all([
        api.listMemories({ scope: 'project' }),
        api.listMemories({ scope: 'global' }),
      ])
      setItems([...projectMemories, ...globalMemories])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '读取记忆数据失败')
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => {
    void loadMemories()
  }, [loadMemories])

  // 本地即时过滤搜索与状态
  const filteredItems = useMemo(
    () => filterMemories(items, { search, scope, status: statusFilter }),
    [items, search, scope, statusFilter]
  )

  // 冲突检测
  const conflictMap = useMemo(() => detectMemoryConflicts(items), [items])
  const compiledMemories = useMemo(() => compileMemories({
    projectMemories: items.filter((item) => item.scope === 'project'),
    globalMemories: items.filter((item) => item.scope === 'global'),
  }), [items])

  const stats = useMemo(() => {
    const total = items.length
    const active = compiledMemories.items.length
    const projectCount = items.filter((i) => i.scope === 'project').length
    const globalCount = items.filter((i) => i.scope === 'global').length
    return { total, active, projectCount, globalCount }
  }, [compiledMemories.items.length, items])

  const handleToggle = async (item: MemoryEntry) => {
    const nextActive = !isMemoryActive(item)
    // 乐观 UI 更新
    setItems((prev) =>
      prev.map((i) => (i.id === item.id && i.scope === item.scope ? { ...i, active: nextActive } : i)),
    )
    try {
      await api.updateMemory({
        id: item.id,
        scope: item.scope,
        active: nextActive,
      })
    } catch (cause) {
      // 失败回滚
      setItems((prev) =>
        prev.map((i) => (i.id === item.id && i.scope === item.scope ? { ...i, active: item.active } : i)),
      )
      setError(cause instanceof Error ? cause.message : '更新记忆状态失败')
    }
  }

  const handleRemove = (item: MemoryEntry) => {
    setDeletingMemory(item)
  }

  const handleConfirmDelete = async () => {
    if (!deletingMemory) return
    setDeleteBusy(true)
    try {
      await api.removeMemory({ id: deletingMemory.id, scope: deletingMemory.scope })
      setDeletingMemory(null)
      await loadMemories()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '删除记忆失败')
    } finally {
      setDeleteBusy(false)
    }
  }

  const handleCopy = (item: MemoryEntry) => {
    void navigator.clipboard.writeText(item.content)
    setCopiedId(item.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  return (
    <div className="content-page">
      <div className="memory-page">
        {/* Page Header */}
        <div className="memory-header-row">
          <div className="memory-header-info">
            <h2>记忆与设定库</h2>
            <p>持久化存储视觉风格、角色外观与镜头约束；所有生效记忆会在对话与分镜规划时自动注入模型上下文。</p>
          </div>
          <div className="memory-header-actions">
            <button
              type="button"
              className="secondary small"
              onClick={() => setShowPresets(!showPresets)}
              title="查看推荐记忆预设"
            >
              <Sparkles size={14} />
              {showPresets ? '收起预设' : '预设模板'}
            </button>
            <button
              type="button"
              className="primary small"
              onClick={() => setEditor({ open: true })}
            >
              <Plus size={15} />
              添加记忆
            </button>
          </div>
        </div>

        {/* Stats bar */}
        <div className="memory-stats-bar">
          <div className="memory-stat-card">
            <span className="stat-label"><Brain size={13} /> 全部记忆</span>
            <span className="stat-value">{stats.total}</span>
          </div>
          <div className="memory-stat-card">
            <span className="stat-label"><Zap size={13} /> 实际注入</span>
            <span className="stat-value active">{stats.active}</span>
          </div>
          <div className="memory-stat-card">
            <span className="stat-label"><FolderLock size={13} /> 当前项目限定</span>
            <span className="stat-value">{stats.projectCount}</span>
          </div>
          <div className="memory-stat-card">
            <span className="stat-label"><Globe size={13} /> 全局视觉通用</span>
            <span className="stat-value">{stats.globalCount}</span>
          </div>
        </div>

        {/* Presets Panel */}
        {showPresets && (
          <div className="memory-presets-panel">
            <div className="presets-panel-header">
              <span><Sparkles size={13} /> 点击即可快速应用经典记忆模板</span>
              <button
                type="button"
                className="icon-button"
                onClick={() => setShowPresets(false)}
                aria-label="关闭预设栏"
              >
                <X size={14} />
              </button>
            </div>
            <div className="presets-chips">
              {PRESET_TEMPLATES.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className="preset-chip-btn"
                  onClick={() => setEditor({ open: true, initialPreset: preset })}
                >
                  <Plus size={12} />
                  <span>{preset.title}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Filter and Search Toolbar */}
        <div className="memory-filter-toolbar">
          <div className="memory-scope-tabs">
            <button
              type="button"
              className={scope === 'all' ? 'active' : ''}
              onClick={() => setScope('all')}
            >
              全部作用域
            </button>
            <button
              type="button"
              className={scope === 'project' ? 'active' : ''}
              onClick={() => setScope('project')}
            >
              当前项目
            </button>
            <button
              type="button"
              className={scope === 'global' ? 'active' : ''}
              onClick={() => setScope('global')}
            >
              全局通用
            </button>
          </div>

          <div className="memory-scope-tabs">
            <button
              type="button"
              className={statusFilter === 'all' ? 'active' : ''}
              onClick={() => setStatusFilter('all')}
            >
              全部状态
            </button>
            <button
              type="button"
              className={statusFilter === 'active' ? 'active' : ''}
              onClick={() => setStatusFilter('active')}
            >
              仅已启用
            </button>
            <button
              type="button"
              className={statusFilter === 'inactive' ? 'active' : ''}
              onClick={() => setStatusFilter('inactive')}
            >
              仅已暂停
            </button>
          </div>

          <div className="memory-search-wrapper">
            <Search size={14} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索记忆标题、内容或来源…"
            />
            {search && (
              <button
                type="button"
                className="icon-button"
                onClick={() => setSearch('')}
                aria-label="清空搜索"
              >
                <X size={13} />
              </button>
            )}
          </div>
        </div>

        {/* Content Area */}
        {loading ? (
          <div className="start-state">
            <LoaderCircle size={18} className="spin" />
            正在读取记忆设定…
          </div>
        ) : error ? (
          <div className="start-state error">
            <p>{error}</p>
            <button type="button" className="secondary small" onClick={() => void loadMemories()}>
              <RefreshCw size={13} /> 重试
            </button>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="start-state">
            <Brain size={24} style={{ opacity: 0.5, marginBottom: 8 }} />
            <p>
              {search || scope !== 'all' || statusFilter !== 'all'
                ? '未找到符合筛选条件的记忆项'
                : '暂无持久记忆。建议点击上方「预设模板」或「添加记忆」创建首条视觉约束。'}
            </p>
          </div>
        ) : (
          <div className="memory-grid">
            {filteredItems.map((item) => {
              const isCopied = copiedId === item.id
              const isActive = isMemoryActive(item)
              const overridingMemory = conflictMap.get(item.id)
              const lastUsedLabel = formatLastUsedTime(item.lastUsedAt)
              const categoryLabel = memoryCategoryLabel(resolveMemoryCategory(item))

              return (
                <article
                  key={`${item.scope}-${item.id}`}
                  className={`memory-card ${isActive ? 'active' : 'inactive'} ${overridingMemory ? 'has-conflict' : ''}`}
                >
                  <div className="memory-card-header">
                    <div className="memory-badges">
                      <span className={`memory-badge ${item.scope}`}>
                        {item.scope === 'project' ? '当前项目' : '全局通用'}
                      </span>
                      <span className={`memory-badge ${isActive && !overridingMemory ? 'status-on' : 'status-off'}`}>
                        {overridingMemory ? '○ 已覆盖' : isActive ? '● 生效中' : '○ 已暂停'}
                      </span>
                      <span className="memory-badge category">{categoryLabel}</span>
                    </div>
                    <button
                      type="button"
                      className={`toggle ${isActive ? 'on' : ''}`}
                      onClick={() => void handleToggle(item)}
                      aria-label={isActive ? '停用记忆' : '启用记忆'}
                      title={isActive ? '点击停用' : '点击启用'}
                    >
                      <span />
                    </button>
                  </div>

                  <div className="memory-card-body">
                    {overridingMemory && (
                      <div className="memory-conflict-banner" role="alert">
                        <AlertTriangle size={13} className="memory-conflict-icon" />
                        <span>
                          {overridingMemory.scope === 'project' && item.scope === 'global'
                            ? `已被项目记忆《${overridingMemory.title}》覆盖`
                            : `已被较新的同类记忆《${overridingMemory.title}》覆盖`}
                        </span>
                      </div>
                    )}

                    <h4 className="memory-card-title" title={item.title}>
                      {item.title}
                    </h4>

                    <div className="memory-card-meta">
                      <span className="memory-meta-item">来源: {item.source || '手动维护'}</span>
                      <span className="memory-meta-divider">·</span>
                      <span className="memory-meta-item memory-meta-version">v{item.version}</span>
                      <span className="memory-meta-divider">·</span>
                      <span
                        className="memory-meta-item"
                        title={item.lastUsedAt ? `最近调用时间: ${item.lastUsedAt}` : '暂无模型调用记录'}
                      >
                        <Clock size={11} />
                        最近使用: {lastUsedLabel}
                      </span>
                    </div>

                    <p className="memory-card-content" title="记忆规则详情">
                      {item.content}
                    </p>
                  </div>

                  <div className="memory-card-footer">
                    <span className="memory-footer-date">
                      更新于 {item.updatedAt ? new Date(item.updatedAt).toLocaleDateString() : '未知'}
                    </span>
                    <div className="memory-footer-actions">
                      <button
                        type="button"
                        className="memory-action-btn"
                        onClick={() => handleCopy(item)}
                        title={isCopied ? '已复制内容' : '复制记忆内容'}
                      >
                        {isCopied ? <Check size={13} style={{ color: 'var(--green)' }} /> : <Copy size={13} />}
                      </button>
                      <button
                        type="button"
                        className="memory-action-btn"
                        onClick={() => setEditor({ open: true, item })}
                        title="编辑记忆"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        type="button"
                        className="memory-action-btn danger"
                        onClick={() => void handleRemove(item)}
                        title="删除记忆"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        )}

        {/* Modal */}
        <MemoryEditorModal
          open={editor.open}
          item={editor.item}
          initialPreset={editor.initialPreset}
          onClose={() => setEditor({ open: false })}
          onSaved={loadMemories}
        />
        <DeleteMemoryDialog
          open={Boolean(deletingMemory)}
          memory={deletingMemory}
          busy={deleteBusy}
          onClose={() => setDeletingMemory(null)}
          onConfirm={handleConfirmDelete}
        />
      </div>
    </div>
  )
}

export default MemoryLibraryPage
