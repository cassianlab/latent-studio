import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as Tooltip from '@radix-ui/react-tooltip'
import { CircleAlert, CircleCheck, FolderOpen, Images, ImagePlus, PencilLine } from 'lucide-react'
import { createTemporarySketchReference, MAX_REFERENCE_IMAGES, type ReferenceAsset } from '../../shared/reference-images'
import { getLibraryApi } from '../../renderer/library/library-api'
import { mergeReferenceAssets } from '../../renderer/library/asset-selection'
import { ReferenceAssetDialog } from './ReferenceAssetDialog'
import { SketchBoardDialog } from './SketchBoardDialog'
import './reference-images.css'

const REFERENCE_STATUS_DURATION_MS = 1_500

export function scheduleReferenceStatusDismiss(dismiss: () => void): () => void {
  const timer = globalThis.setTimeout(dismiss, REFERENCE_STATUS_DURATION_MS)
  return () => globalThis.clearTimeout(timer)
}

export function ReferenceImagePicker({ assets, disabled, onChange }: { assets: ReferenceAsset[]; disabled?: boolean; onChange: (assets: ReferenceAsset[]) => void }): React.ReactElement {
  const api = useMemo(() => getLibraryApi(), [])
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [assetDialogOpen, setAssetDialogOpen] = useState(false)
  const [sketchOpen, setSketchOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const statusIsSuccess = status?.startsWith('已添加') === true

  useEffect(() => {
    if (!status?.startsWith('已添加')) return
    return scheduleReferenceStatusDismiss(() => setStatus(null))
  }, [status])

  useEffect(() => {
    if (!menuOpen) return
    const close = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setMenuOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', escape)
    window.requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus())
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape) }
  }, [menuOpen])

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
    if (!items.length) return
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    const target = event.key === 'Home' ? 0
      : event.key === 'End' ? items.length - 1
        : event.key === 'ArrowDown' ? (current + 1) % items.length
          : event.key === 'ArrowUp' ? (current - 1 + items.length) % items.length
            : -1
    if (target >= 0) { event.preventDefault(); items[target]?.focus() }
    if (event.key === 'Escape') { event.preventDefault(); setMenuOpen(false); triggerRef.current?.focus() }
  }

  const add = (incoming: ReferenceAsset[]) => {
    const merged = mergeReferenceAssets(assets, incoming)
    onChange(merged.assets)
    setStatus(merged.rejected ? `已添加可用图片，单轮最多 ${MAX_REFERENCE_IMAGES} 张` : incoming.length ? `已添加 ${incoming.length} 张参考图` : null)
  }
  const chooseLocal = async () => {
    setMenuOpen(false); setBusy(true); setStatus(null)
    try { add(await api.chooseReferenceImages()) } catch (cause) { setStatus(cause instanceof Error ? cause.message : '本地参考图添加失败') } finally { setBusy(false) }
  }
  const useSketch = (dataUrl: string) => {
    const now = new Date()
    add([createTemporarySketchReference({
      id: `temporary-sketch-${crypto.randomUUID()}`,
      name: `构图草图 ${now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`,
      dataUrl,
      createdAt: now.toISOString(),
    })])
    setSketchOpen(false)
  }

  return <>
    <div className="reference-picker" ref={rootRef}>
      <Tooltip.Root delayDuration={220}>
        <Tooltip.Trigger asChild><button ref={triggerRef} type="button" className={`ai-input-bar__tool-button ${menuOpen ? 'active' : ''}`} onClick={() => setMenuOpen((value) => !value)} disabled={disabled || busy} aria-label="选择参考图" aria-expanded={menuOpen} aria-haspopup="menu" aria-controls="reference-image-source-menu"><ImagePlus size={16} /></button></Tooltip.Trigger>
        <Tooltip.Portal><Tooltip.Content className="tooltip" side="top" sideOffset={7}>选择参考图</Tooltip.Content></Tooltip.Portal>
      </Tooltip.Root>
      {menuOpen && <div ref={menuRef} id="reference-image-source-menu" className="reference-picker__menu" role="menu" aria-label="选择参考图来源" onKeyDown={handleMenuKeyDown}>
        <button type="button" role="menuitem" onClick={() => void chooseLocal()} disabled={assets.length >= MAX_REFERENCE_IMAGES}><FolderOpen size={16} /><span>从本地选择参考图</span></button>
        <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setAssetDialogOpen(true) }}><Images size={16} /><span>从素材库选择</span></button>
        <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setSketchOpen(true) }} disabled={assets.length >= MAX_REFERENCE_IMAGES}><PencilLine size={16} /><span>画板</span></button>
      </div>}
    </div>
    {status && typeof document !== 'undefined' && createPortal(
      <span className={`reference-picker__status reference-picker__status--${statusIsSuccess ? 'success' : 'error'}`} role="status">
        {statusIsSuccess ? <CircleCheck size={15} aria-hidden="true" /> : <CircleAlert size={15} aria-hidden="true" />}
        <span>{status}</span>
      </span>,
      document.body,
    )}
    <ReferenceAssetDialog open={assetDialogOpen} assets={assets} onOpenChange={setAssetDialogOpen} onConfirm={onChange} />
    <SketchBoardDialog open={sketchOpen} busy={busy} onOpenChange={setSketchOpen} onConfirm={useSketch} />
  </>
}
