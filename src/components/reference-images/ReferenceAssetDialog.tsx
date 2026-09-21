import { useEffect, useMemo, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Check, Image, LoaderCircle, Search, X } from 'lucide-react'
import type { LibraryApi, ProjectAsset } from '../../shared/contracts/library'
import { isSupportedReferenceMimeType, MAX_REFERENCE_IMAGES } from '../../shared/reference-images'
import { getLibraryApi } from '../../renderer/library/library-api'
import { toggleReferenceAssetSelection } from '../../renderer/library/asset-selection'

function ReferenceAssetThumbnail({ api, item }: { api: LibraryApi; item: ProjectAsset }): React.ReactElement {
  const frameRef = useRef<HTMLSpanElement>(null)
  const [preview, setPreview] = useState<string | null>(null)
  useEffect(() => {
    let disposed = false
    let observer: IntersectionObserver | undefined
    const load = () => { void api.getAssetPreview({ id: item.id }).then((value) => { if (!disposed) setPreview(value) }).catch(() => undefined) }
    if (typeof IntersectionObserver === 'undefined') load()
    else {
      observer = new IntersectionObserver((entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        observer?.disconnect()
        load()
      }, { rootMargin: '120px' })
      if (frameRef.current) observer.observe(frameRef.current)
    }
    return () => { disposed = true; observer?.disconnect() }
  }, [api, item.id])
  return <span className="reference-asset-card__preview" ref={frameRef}>{preview ? <img src={preview} alt="" /> : <Image size={24} aria-hidden="true" />}</span>
}

export function ReferenceAssetDialog({ open, assets, onOpenChange, onConfirm }: {
  open: boolean
  assets: ProjectAsset[]
  onOpenChange: (open: boolean) => void
  onConfirm: (assets: ProjectAsset[]) => void
}): React.ReactElement {
  const api = useMemo(() => getLibraryApi(), [])
  const [items, setItems] = useState<ProjectAsset[]>([])
  const [selectedAssets, setSelectedAssets] = useState<ProjectAsset[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setSelectedAssets(assets)
    setSearch('')
    setError(null)
  }, [assets, open])

  useEffect(() => {
    if (!open) return
    let disposed = false
    const timer = window.setTimeout(() => {
      setLoading(true)
      void api.listAssets({ search: search.trim() || undefined, maxEntries: 120 }).then((values) => {
        if (!disposed) setItems(values.filter((item) => item.previewable && item.byteLength <= 20 * 1024 * 1024 && isSupportedReferenceMimeType(item.mimeType)))
      }).catch((cause) => { if (!disposed) setError(cause instanceof Error ? cause.message : '素材读取失败') }).finally(() => { if (!disposed) setLoading(false) })
    }, search ? 140 : 0)
    return () => { disposed = true; window.clearTimeout(timer) }
  }, [api, open, search])

  const selectedIds = useMemo(() => new Set(selectedAssets.map((item) => item.id)), [selectedAssets])
  const toggle = (item: ProjectAsset) => {
    setSelectedAssets((current) => {
      if (!current.some((selectedItem) => selectedItem.id === item.id) && current.length >= MAX_REFERENCE_IMAGES) { setError(`单轮最多添加 ${MAX_REFERENCE_IMAGES} 张参考图`); return current }
      setError(null)
      return toggleReferenceAssetSelection(current, item)
    })
  }
  const confirm = () => {
    onConfirm(selectedAssets)
    onOpenChange(false)
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="reference-dialog-overlay" />
        <Dialog.Content className="reference-dialog reference-asset-dialog">
          <header>
            <div><Dialog.Title>从素材库选择</Dialog.Title><Dialog.Description>只显示可用于生图的图片，最多选择 {MAX_REFERENCE_IMAGES} 张</Dialog.Description></div>
            <Dialog.Close asChild><button type="button" className="icon-button" aria-label="关闭素材选择"><X size={17} /></button></Dialog.Close>
          </header>
          <label className="reference-asset-search"><Search size={15} aria-hidden="true" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索图片素材" aria-label="搜索图片素材" /></label>
          {error && <p className="reference-dialog-error" role="alert">{error}</p>}
          <div className="reference-asset-grid" aria-busy={loading}>
            {loading && !items.length ? <div className="reference-dialog-empty"><LoaderCircle className="spin" size={20} />正在读取素材…</div>
              : items.length ? items.map((item) => {
                const selected = selectedIds.has(item.id)
                return <button type="button" className={`reference-asset-card ${selected ? 'selected' : ''}`} aria-pressed={selected} onClick={() => toggle(item)} key={item.id}>
                  <ReferenceAssetThumbnail api={api} item={item} />
                  <span title={item.name}>{item.name}</span>
                  <i aria-hidden="true">{selected && <Check size={13} />}</i>
                </button>
              }) : <div className="reference-dialog-empty"><Image size={28} />没有可用的图片素材</div>}
          </div>
          <footer><span>已选择 {selectedAssets.length}/{MAX_REFERENCE_IMAGES}</span><Dialog.Close asChild><button type="button" className="secondary">取消</button></Dialog.Close><button type="button" className="primary" onClick={confirm}>应用选择</button></footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
