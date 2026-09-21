import { useEffect, useMemo, useState } from 'react'
import { Check, Inbox, LoaderCircle, Plus, RefreshCw } from 'lucide-react'
import { assets as mockAssets } from '../../mock-data'
import type { ProjectAsset, ProjectAssetCategory } from '../../shared/contracts/library'
import type { ImageEditorLaunch } from '../../shared/contracts/editor'
import { getLibraryApi } from './library-api'
import { getImageApi } from '../settings/image-api'
import {
  getSelectedAssets,
  publishSelectedAssets,
  subscribeSelectedAssets,
  toggleReferenceAssetSelection,
} from './asset-selection'
import { dispatchCanvasContent } from '../../components/canvas/canvas-content-bridge'
import { AssetCard } from './AssetCard'
import { AssetInspector } from './AssetInspector'
import { DeleteAssetDialog } from './DeleteAssetDialog'
import { BatchDeleteAssetDialog } from './BatchDeleteAssetDialog'
import { AssetsFilterBar } from './AssetsFilterBar'
import { AssetsActionToolbar } from './AssetsActionToolbar'
import { createMockAsset, getRangeSelectedIds, isGeneratedAsset } from './asset-batch-utils'
import './AssetsLibraryPage.css'

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }): React.ReactElement {
  return (
    <div className="start-state error" role="alert">
      <span>{message}</span>
      <button className="icon-button" aria-label="重试" onClick={onRetry}>
        <RefreshCw size={16} />
      </button>
    </div>
  )
}

export function AssetsLibraryPage({ onEditor }: { onEditor: (input?: ImageEditorLaunch) => void }): React.ReactElement {
  const api = useMemo(() => getLibraryApi(), [])
  const previewMode = typeof window !== 'undefined' && !window.latentStudio?.library
  const [items, setItems] = useState<ProjectAsset[]>([])
  const [previews, setPreviews] = useState<Record<string, string>>({})
  const [selectedBatchIds, setSelectedBatchIds] = useState<string[]>([])
  const [referenceIds, setReferenceIds] = useState<string[]>(() => getSelectedAssets().map((a) => a.id))
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null)
  const [selected, setSelected] = useState<ProjectAsset | null>(null)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<ProjectAssetCategory | ''>('')
  const [onlyReferences, setOnlyReferences] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const [remarks, setRemarks] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem('latent-studio:asset-remarks') || '{}')
    } catch {
      return {}
    }
  })
  const [draftRemark, setDraftRemark] = useState('')
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null)
  const [showShortcutsPopover, setShowShortcutsPopover] = useState(false)
  const [deletingAsset, setDeletingAsset] = useState<ProjectAsset | null>(null)
  const [deletingBusy, setDeletingBusy] = useState(false)
  const [showBatchDelete, setShowBatchDelete] = useState(false)
  const [batchDeletingBusy, setBatchDeletingBusy] = useState(false)

  const showToast = (msg: string) => {
    setToastMsg(msg)
    setTimeout(() => setToastMsg((current) => (current === msg ? null : current)), 2000)
  }

  useEffect(() => {
    return subscribeSelectedAssets((assets) => {
      setReferenceIds(assets.map((a) => a.id))
    })
  }, [])

  useEffect(() => {
    setDraftRemark(selected ? remarks[selected.id] ?? '' : '')
  }, [selected?.id, remarks])

  const handleSaveRemark = (assetId: string, newRemark: string) => {
    const trimmed = newRemark.trim()
    const next = { ...remarks }
    if (trimmed) next[assetId] = trimmed
    else delete next[assetId]
    setRemarks(next)
    try {
      localStorage.setItem('latent-studio:asset-remarks', JSON.stringify(next))
    } catch {}
  }

  useEffect(() => {
    const closeOverlays = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return
      setActiveMenuId(null)
      setShowShortcutsPopover(false)
    }
    document.addEventListener('click', closeOverlays)
    document.addEventListener('keydown', closeOverlays)
    return () => {
      document.removeEventListener('click', closeOverlays)
      document.removeEventListener('keydown', closeOverlays)
    }
  }, [])

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const loaded = await api.listAssets({ search: search.trim() || undefined, category: category || undefined })
      const next = loaded.length ? loaded : previewMode ? mockAssets.map(createMockAsset) : []
      setItems(next)
      setSelected((current) => next.find((item) => item.id === current?.id) ?? next[0] ?? null)
      const previewEntries = await Promise.all(
        next
          .filter((item) => item.previewable)
          .map(async (item) => {
            if (item.id.startsWith('mock-')) {
              return [item.id, mockAssets[Number(item.id.slice(5)) - 1]?.image ?? ''] as const
            }
            const value = await api.getAssetPreview({ id: item.id })
            return [item.id, value ?? ''] as const
          }),
      )
      setPreviews(Object.fromEntries(previewEntries.filter(([, value]) => value)))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '素材库读取失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [search, category])

  const displayedItems = useMemo(() => {
    if (!onlyReferences) return items
    return items.filter((item) => referenceIds.includes(item.id))
  }, [items, onlyReferences, referenceIds])
  const libraryReferenceIds = useMemo(
    () => referenceIds.filter((id) => items.some((item) => item.id === id)),
    [items, referenceIds],
  )

  const isAllDisplayedSelected =
    displayedItems.length > 0 && displayedItems.every((item) => selectedBatchIds.includes(item.id))

  const handleToggleSelectAll = () => {
    if (isAllDisplayedSelected) {
      setSelectedBatchIds([])
    } else {
      setSelectedBatchIds(displayedItems.map((it) => it.id))
    }
  }

  const handleCardClick = (item: ProjectAsset, e: React.MouseEvent) => {
    setSelected(item)
    if (e.shiftKey && lastSelectedId) {
      const rangeSet = getRangeSelectedIds(displayedItems, lastSelectedId, item.id, new Set(selectedBatchIds))
      setSelectedBatchIds(Array.from(rangeSet))
    } else if (e.metaKey || e.ctrlKey) {
      setSelectedBatchIds((curr) =>
        curr.includes(item.id) ? curr.filter((id) => id !== item.id) : [...curr, item.id],
      )
      setLastSelectedId(item.id)
    } else {
      setLastSelectedId(item.id)
      if (selectedBatchIds.length > 1) {
        setSelectedBatchIds([item.id])
      }
    }
  }

  const handleToggleCheckbox = (item: ProjectAsset, e: React.MouseEvent) => {
    if (e.shiftKey && lastSelectedId) {
      const rangeSet = getRangeSelectedIds(displayedItems, lastSelectedId, item.id, new Set(selectedBatchIds))
      setSelectedBatchIds(Array.from(rangeSet))
    } else {
      setSelectedBatchIds((curr) =>
        curr.includes(item.id) ? curr.filter((id) => id !== item.id) : [...curr, item.id],
      )
      setLastSelectedId(item.id)
    }
  }

  const handleToggleReference = (item: ProjectAsset) => {
    const nextRefs = toggleReferenceAssetSelection(getSelectedAssets(), item)
    publishSelectedAssets(nextRefs)
    const name = remarks[item.id] || item.name
    showToast(libraryReferenceIds.includes(item.id) ? `已取消参考「${name}」` : `已选作参考「${name}」`)
  }

  const handleBatchSetReference = () => {
    const selectedAssets = items.filter((item) => selectedBatchIds.includes(item.id))
    if (!selectedAssets.length) return
    publishSelectedAssets(selectedAssets)
    showToast(`已将选中的 ${Math.min(selectedAssets.length, 8)} 项设为生图参考`)
  }

  const handleBatchAddToCanvas = () => {
    const selectedAssets = items.filter((item) => selectedBatchIds.includes(item.id))
    for (const asset of selectedAssets) {
      void addAssetToCanvas(asset)
    }
  }

  const importAssets = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.importAssets()
      await load()
      showToast('素材导入成功')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '素材导入失败')
    } finally {
      setBusy(false)
    }
  }

  const handleConfirmDelete = async () => {
    if (!deletingAsset) return
    const target = deletingAsset
    const name = remarks[target.id] || target.name
    const isGenerated = isGeneratedAsset(target)
    setDeletingBusy(true)
    setError(null)
    try {
      if (target.id.startsWith('mock-')) {
        setItems((current) => current.filter((it) => it.id !== target.id))
      } else {
        await api.removeAsset({ id: target.id })
        if (isGenerated) {
          try {
            await getImageApi().remove(target.id, target.relativePath)
          } catch {}
        }
        await load()
      }
      setSelectedBatchIds((ids) => ids.filter((id) => id !== target.id))
      if (selected?.id === target.id) setSelected(null)
      showToast(isGenerated ? `已彻底删除项目原文件「${name}」` : `已从素材库移除「${name}」`)
      setDeletingAsset(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '素材删除失败')
    } finally {
      setDeletingBusy(false)
    }
  }

  const handleConfirmBatchDelete = async () => {
    const targets = items.filter((item) => selectedBatchIds.includes(item.id))
    if (targets.length === 0) return
    setBatchDeletingBusy(true)
    setError(null)
    try {
      const targetIds = new Set(targets.map((t) => t.id))
      for (const target of targets) {
        if (!target.id.startsWith('mock-')) {
          await api.removeAsset({ id: target.id })
          if (isGeneratedAsset(target)) {
            try {
              await getImageApi().remove(target.id, target.relativePath)
            } catch {}
          }
        }
      }
      if (selected && targetIds.has(selected.id)) setSelected(null)
      setSelectedBatchIds([])
      await load()
      showToast(`已批量删除 ${targets.length} 项素材`)
      setShowBatchDelete(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '批量删除失败')
    } finally {
      setBatchDeletingBusy(false)
    }
  }

  const updateCategory = async (next: ProjectAssetCategory) => {
    if (!selected || selected.id.startsWith('mock-') || selected.category === next) return
    setBusy(true)
    setError(null)
    try {
      const updated = await api.updateAsset({ id: selected.id, category: next })
      setItems((current) => current.map((item) => (item.id === updated.id ? updated : item)))
      setSelected(updated)
      showToast('素材分类已更新')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '素材分类更新失败')
    } finally {
      setBusy(false)
    }
  }

  const addAssetToCanvas = async (target: ProjectAsset) => {
    if (!target.previewable) return
    setBusy(true)
    setError(null)
    try {
      let source = previews[target.id]
      if (!source && target.id.startsWith('mock-')) {
        source = mockAssets[Number(target.id.slice(5)) - 1]?.image ?? ''
      }
      if (!source && !target.id.startsWith('mock-')) {
        source = (await api.getAssetPreview({ id: target.id })) ?? ''
      }
      if (!source) throw new Error('素材预览不可用，无法加入画布')
      setPreviews((current) => ({ ...current, [target.id]: source }))
      const name = remarks[target.id] || target.name
      dispatchCanvasContent({ id: `asset-${target.id}`, title: name, source, mimeType: target.mimeType })
      showToast(`已将「${name}」放入画布`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '素材加入画布失败')
    } finally {
      setBusy(false)
    }
  }

  const openEditorForAsset = (target: ProjectAsset) => {
    const launch: ImageEditorLaunch = {
      title: remarks[target.id] || target.name,
      ...(previews[target.id] ? { preview: previews[target.id] } : {}),
      ...(target.id.startsWith('mock-')
        ? {}
        : { source: { type: 'file' as const, path: target.relativePath, filename: target.name, mimeType: target.mimeType } }),
    }
    onEditor(launch)
  }

  const revealAssetInFinder = async (target: ProjectAsset) => {
    try {
      if (previewMode || target.id.startsWith('mock-')) {
        showToast('演示模式不支持在访达中打开')
        return
      }
      await api.revealAsset({ id: target.id, relativePath: target.relativePath })
    } catch {
      showToast('在访达中打开失败')
    }
  }

  const batchSelectedAssets = useMemo(
    () => items.filter((item) => selectedBatchIds.includes(item.id)),
    [items, selectedBatchIds],
  )

  return (
    <div className="content-page asset-page-root">
      <div className="section-heading">
        <div>
          <h2>素材库</h2>
          <p>项目内可复用的角色、场景、道具与参考图 · 勾选进行批量管理</p>
        </div>
        <div className="asset-header-actions">
          <button className="secondary small" onClick={() => void load()} disabled={loading || busy} aria-label="刷新素材库">
            <RefreshCw size={15} />
            刷新
          </button>
          <button className="primary small" onClick={() => void importAssets()} disabled={busy}>
            <Plus size={15} />
            导入素材
          </button>
        </div>
      </div>

      <AssetsFilterBar
        category={category}
        onCategoryChange={setCategory}
        onlyReferences={onlyReferences}
        onToggleOnlyReferences={() => setOnlyReferences((curr) => !curr)}
        referenceCount={libraryReferenceIds.length}
        search={search}
        onSearchChange={setSearch}
        showShortcutsPopover={showShortcutsPopover}
        onToggleShortcutsPopover={() => setShowShortcutsPopover((c) => !c)}
      />

      <AssetsActionToolbar
        totalDisplayed={displayedItems.length}
        selectedCount={selectedBatchIds.length}
        referenceCount={libraryReferenceIds.length}
        isAllDisplayedSelected={isAllDisplayedSelected}
        onToggleSelectAll={handleToggleSelectAll}
        onBatchSetReference={handleBatchSetReference}
        onBatchAddToCanvas={handleBatchAddToCanvas}
        onBatchDelete={() => setShowBatchDelete(true)}
        onClearSelection={() => setSelectedBatchIds([])}
      />

      {error && <ErrorState message={error} onRetry={() => void load()} />}

      {loading ? (
        <div className="start-state">
          <LoaderCircle size={17} className="spin" />
          正在读取素材库…
        </div>
      ) : (
        <div className="asset-layout">
          {displayedItems.length === 0 ? (
            <div className="asset-empty-state">
              <Inbox size={36} />
              <p>{onlyReferences ? '尚未选择任何参考素材' : '未找到匹配的素材'}</p>
            </div>
          ) : (
            <div className="asset-grid">
              {displayedItems.map((item) => (
                <AssetCard
                  key={item.id}
                  item={item}
                  isSelected={selectedBatchIds.includes(item.id)}
                  isReference={libraryReferenceIds.includes(item.id)}
                  isCurrent={selected?.id === item.id}
                  preview={previews[item.id]}
                  remark={remarks[item.id]}
                  isMenuOpen={activeMenuId === item.id}
                  busy={busy}
                  onSelect={(e) => handleCardClick(item, e)}
                  onToggleSelect={(e) => handleToggleCheckbox(item, e)}
                  onDoubleClick={() => openEditorForAsset(item)}
                  onToggleReference={() => handleToggleReference(item)}
                  onToggleMenu={() => setActiveMenuId((curr) => (curr === item.id ? null : item.id))}
                  onCloseMenu={() => setActiveMenuId(null)}
                  onAddToCanvas={() => void addAssetToCanvas(item)}
                  onOpenEditor={() => openEditorForAsset(item)}
                  onRevealInFinder={() => void revealAssetInFinder(item)}
                  onRemove={() => setDeletingAsset(item)}
                />
              ))}
            </div>
          )}

          {selected && (
            <AssetInspector
              selected={selected}
              preview={previews[selected.id]}
              draftRemark={draftRemark}
              busy={busy}
              onChangeDraftRemark={setDraftRemark}
              onSaveRemark={(val) => handleSaveRemark(selected.id, val)}
              onCancelRemark={() => setDraftRemark(remarks[selected.id] ?? '')}
              onUpdateCategory={(cat) => void updateCategory(cat)}
              onClose={() => setSelected(null)}
            />
          )}
        </div>
      )}

      {toastMsg && (
        <div className="asset-toast" role="status">
          <span className="asset-toast-icon">
            <Check size={14} />
          </span>
          <span>{toastMsg}</span>
        </div>
      )}

      <DeleteAssetDialog
        open={deletingAsset !== null}
        target={deletingAsset}
        remark={deletingAsset ? remarks[deletingAsset.id] : undefined}
        previewUrl={deletingAsset ? previews[deletingAsset.id] : undefined}
        busy={deletingBusy}
        onConfirm={handleConfirmDelete}
        onClose={() => {
          if (!deletingBusy) setDeletingAsset(null)
        }}
      />

      <BatchDeleteAssetDialog
        open={showBatchDelete}
        targets={batchSelectedAssets}
        previews={previews}
        remarks={remarks}
        busy={batchDeletingBusy}
        onConfirm={handleConfirmBatchDelete}
        onClose={() => {
          if (!batchDeletingBusy) setShowBatchDelete(false)
        }}
      />
    </div>
  )
}
