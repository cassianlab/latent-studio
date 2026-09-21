import { useEffect, useMemo, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import * as Tooltip from '@radix-ui/react-tooltip'
import { AlertTriangle, AudioLines, Check, Film, Hand, ImagePlus, Layers3, Link2, Maximize2, MousePointer2, Play, Save, ShieldAlert, StickyNote, Trash2, Type, Upload, X, ZoomIn, ZoomOut } from 'lucide-react'
import { Arrow, Circle, Group, Image as KonvaImage, Label, Layer, Rect, Stage, Tag, Text } from 'react-konva'
import type Konva from 'konva'
import { getCanvasApi } from '../../renderer/editor/canvas-api'
import { getLibraryApi } from '../../renderer/library/library-api'
import { getSelectedAssets, subscribeSelectedAssets } from '../../renderer/library/asset-selection'
import type { ProjectAsset } from '../../shared/contracts/library'
import type { CanvasItem, CanvasLink, CanvasPoint, CanvasState, HandleDirection } from '../../shared/contracts/canvas'
import { isForegroundCanvasLink } from './canvas-layering'
import { subscribeCanvasContent, type CanvasContentDraft } from './canvas-content-bridge'
import { chooseConnectionSides, findConnectionTarget, getCanvasRouteControls, getHandlePoint, getPointAtRouteRatio, moveCanvasRouteBend, moveCanvasRouteSegment, routeCanvasLink, routeCanvasPreview, toCanvasPoints, type CanvasRect } from './canvas-routing'
import './canvas-workspace.css'

type CanvasTool = 'select' | 'hand' | 'link'
type BoardItem = CanvasItem
type BoardLink = CanvasLink

const initialItems: BoardItem[] = []
const initialLinks: BoardLink[] = []

function hydrateCanvas(saved: CanvasState | null): { items: BoardItem[]; links: BoardLink[]; scale: number; position: { x: number; y: number }; selection: CanvasState['selection'] } {
  if (!saved) return { items: initialItems, links: initialLinks, scale: 1, position: { x: 0, y: 0 }, selection: { selectedId: null, selectedIds: [], selectedLinkId: null } }
  const items = saved.items.map(item => item.localFile ? { ...item, source: undefined, valid: false } : item)
  return { items, links: saved.links.map(link => link.autoPoints || link.manualPoints ? link : createAutomaticRoute(items, link)), scale: saved.viewport.scale, position: saved.viewport.position, selection: saved.selection }
}

function getVisualHeight(item: BoardItem) {
  return item.type === 'image' && item.valid !== false ? item.height + 30 : item.height
}

function getRoutingRect(item: BoardItem): CanvasRect {
  return { id: item.id, x: item.x, y: item.y, width: item.width, height: getVisualHeight(item) }
}

function createAutomaticRoute(items: BoardItem[], link: BoardLink): BoardLink {
  const from = items.find(item => item.id === link.from)
  const to = items.find(item => item.id === link.to)
  if (!from || !to) return link
  const rects = items.map(getRoutingRect)
  const automatic = !link.fromSide || !link.toSide ? chooseConnectionSides(getRoutingRect(from), getRoutingRect(to), rects) : null
  const fromSide = link.fromSide || automatic!.fromSide
  const toSide = link.toSide || automatic!.toSide
  const route = toCanvasPoints(routeCanvasLink(getRoutingRect(from), getRoutingRect(to), fromSide, toSide, rects))
  return { ...link, fromSide, toSide, autoPoints: route.slice(1, -1), manualPoints: undefined }
}

function fitContain(imgWidth: number, imgHeight: number, boxWidth: number, boxHeight: number) {
  if (!imgWidth || !imgHeight || !boxWidth || !boxHeight) return { x: 0, y: 0, width: boxWidth, height: boxHeight }
  const imgRatio = imgWidth / imgHeight
  const boxRatio = boxWidth / boxHeight
  if (imgRatio > boxRatio) {
    const width = boxWidth
    const height = boxWidth / imgRatio
    return { x: 0, y: (boxHeight - height) / 2, width, height }
  } else {
    const height = boxHeight
    const width = boxHeight * imgRatio
    return { x: (boxWidth - width) / 2, y: 0, width, height }
  }
}

function readImageDimensions(src: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height })
    img.onerror = () => resolve(null)
    img.src = src
  })
}

function isInsideSelection(item: BoardItem, selection: { left: number; top: number; right: number; bottom: number }) {
  const itemRight = item.x + item.width
  const itemBottom = item.y + getVisualHeight(item)
  return item.x < selection.right && itemRight > selection.left && item.y < selection.bottom && itemBottom > selection.top
}

function CanvasTip({ label, children }: { label: string; children: React.ReactElement }) {
  return <Tooltip.Root delayDuration={220}><Tooltip.Trigger asChild>{children}</Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="tooltip" side="right" sideOffset={8}>{label}</Tooltip.Content></Tooltip.Portal></Tooltip.Root>
}

function CanvasButton({ label, active = false, disabled = false, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick?: () => void; children: React.ReactNode }) {
  return <CanvasTip label={label}><button type="button" className={`canvas-tool ${active ? 'active' : ''}`} aria-label={label} disabled={disabled} onClick={onClick}>{children}</button></CanvasTip>
}

function detectMediaType(file: File): 'image' | 'video' | 'audio' | null {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('audio/')) return 'audio'
  const name = file.name.toLowerCase()
  if (/\.(png|jpe?g|webp|gif|svg|bmp|avif|tiff?|ico)$/i.test(name)) return 'image'
  if (/\.(mp4|webm|mov|mkv|avi|m4v|ogv)$/i.test(name)) return 'video'
  if (/\.(mp3|wav|m4a|aac|ogg|flac|wma)$/i.test(name)) return 'audio'
  return null
}

function captureVideoThumbnail(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    video.playsInline = true
    const url = URL.createObjectURL(file)
    video.src = url
    let resolved = false
    const finish = (result: string | null) => {
      if (!resolved) {
        resolved = true
        video.src = ''
        URL.revokeObjectURL(url)
        resolve(result)
      }
    }
    video.onloadeddata = () => {
      video.currentTime = Math.min(0.5, (video.duration || 1) / 2)
    }
    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth || 320
        canvas.height = video.videoHeight || 180
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
          finish(canvas.toDataURL('image/jpeg', 0.8))
          return
        }
      } catch {}
      finish(null)
    }
    video.onerror = () => finish(null)
    setTimeout(() => finish(null), 1200)
  })
}

function useBoardImages(items: BoardItem[]) {
  const [images, setImages] = useState<Record<string, HTMLImageElement>>({})
  const sources = useMemo(
    () => items.map((item) => `${item.id}:${item.thumbnail || (item.type === 'image' ? item.source : '')}`).join('|'),
    [items]
  )
  useEffect(() => {
    items.forEach((item) => {
      const src = item.thumbnail || (item.type === 'image' ? item.source : undefined)
      if (!src || images[item.id]) return
      const image = new window.Image()
      image.onload = () => setImages((current) => ({ ...current, [item.id]: image }))
      image.onerror = () => {}
      image.src = src
    })
  }, [images, items, sources])
  return images
}

export function CanvasWorkspace() {
  const viewportRef = useRef<HTMLDivElement>(null)
  const uploadRef = useRef<HTMLInputElement>(null)
  const [viewport, setViewport] = useState({ width: 900, height: 640 })
  const [tool, setTool] = useState<CanvasTool>('select')
  const [items, setItems] = useState<BoardItem[]>(initialItems)
  const [links, setLinks] = useState<BoardLink[]>(initialLinks)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null)
  const [linkSourceId, setLinkSourceId] = useState<string | null>(null)
  const [linkDrag, setLinkDrag] = useState<{ from: string; direction: HandleDirection; current: { x: number; y: number }; moved: boolean; targetId?: string; targetSide?: HandleDirection } | null>(null)
  const [linkTextEditor, setLinkTextEditor] = useState<{ id: string; draft: string } | null>(null)
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [selectionRect, setSelectionRect] = useState<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null)
  const [mediaOpenId, setMediaOpenId] = useState<string | null>(null)
  const [scale, setScale] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [selectedAssets, setSelectedAssets] = useState<ProjectAsset[]>(() => getSelectedAssets())
  const [savedAt, setSavedAt] = useState('')
  const [confirmAction, setConfirmAction] = useState<'clear' | 'clean' | null>(null)
  const queuedCanvasContent = useRef<CanvasContentDraft[]>([])
  const contentSequence = useRef(0)
  const itemChangesReady = useRef(false)
  const canvasHydrated = useRef(false)
  const images = useBoardImages(items)
  const routingRects = useMemo(() => items.map(getRoutingRect), [items])
  const selectedItem = items.find(item => item.id === selectedId)
  const mediaItem = items.find(item => item.id === mediaOpenId)
  const invalidCount = items.filter(item => item.valid === false).length

  useEffect(() => {
    const element = viewportRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setViewport({ width: Math.max(320, entry.contentRect.width), height: Math.max(320, entry.contentRect.height) }))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => subscribeSelectedAssets(setSelectedAssets), [])

  const appendCanvasContent = (content: CanvasContentDraft) => {
    if (!canvasHydrated.current) {
      queuedCanvasContent.current.push(content)
      return
    }
    const id = `${content.id || 'image'}-${Date.now()}-${contentSequence.current++}`
    setItems(current => [...current, { ...content, id, x: 150 + current.length * 28, y: 100 + current.length * 22, width: 320, height: 190 }])
    setSelectedId(id)
    setSelectedIds([id])
    setSelectedLinkId(null)
    setTool('select')
  }

  useEffect(() => subscribeCanvasContent(appendCanvasContent), [items.length])

  useEffect(() => {
    let cancelled = false
    void getCanvasApi().load().then(saved => {
      if (cancelled) return
      if (!saved) {
        canvasHydrated.current = true
        queuedCanvasContent.current.splice(0).forEach(appendCanvasContent)
        return
      }
      const hydrated = hydrateCanvas(saved)
      setItems(hydrated.items)
      setLinks(hydrated.links)
      setScale(hydrated.scale)
      setPosition(hydrated.position)
      setSelectedId(hydrated.selection.selectedId)
      setSelectedIds(hydrated.selection.selectedIds)
      setSelectedLinkId(hydrated.selection.selectedLinkId)
      canvasHydrated.current = true
      queuedCanvasContent.current.splice(0).forEach(appendCanvasContent)
    }).catch(() => {
      canvasHydrated.current = true
      queuedCanvasContent.current.splice(0).forEach(appendCanvasContent)
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!itemChangesReady.current) {
      itemChangesReady.current = true
      return
    }
    setSavedAt('')
  }, [items, links])

  const moveItem = (id: string, x: number, y: number) => setItems(current => current.map(item => item.id === id ? { ...item, x, y } : item))
  const finishMovingItem = (id: string, x: number, y: number) => {
    const nextItems = items.map(item => item.id === id ? { ...item, x, y } : item)
    setItems(nextItems)
    setLinks(current => current.map(link => link.from === id || link.to === id ? createAutomaticRoute(nextItems, link) : link))
    setDraggingItemId(null)
  }
  const worldPointFromStage = (stage: Konva.Stage | null) => {
    const point = stage?.getPointerPosition()
    if (!point) return null
    return { x: (point.x - position.x) / scale, y: (point.y - position.y) / scale }
  }
  const completeLink = (targetId: string, targetSide?: HandleDirection) => {
    if (!linkDrag || linkDrag.from === targetId) return
    const source = items.find(item => item.id === linkDrag.from)
    const target = items.find(item => item.id === targetId)
    if (!source || !target) return
    const fromSide = linkDrag.direction
    const toSide = targetSide || linkDrag.targetSide || chooseConnectionSides(getRoutingRect(source), getRoutingRect(target), routingRects).toSide
    const nextLink = createAutomaticRoute(items, { id: `link-${Date.now()}`, from: linkDrag.from, to: targetId, fromSide, toSide })
    setLinks(current => current.some(link => link.from === linkDrag.from && link.to === targetId) ? current : [...current, nextLink])
    setLinkSourceId(null)
    setLinkDrag(null)
    setTool('select')
    setSelectedId(targetId)
    setSelectedIds([targetId])
  }
  const selectItem = (id: string) => {
    if (linkDrag) {
      completeLink(id)
      return
    }
    if (tool === 'link') {
      if (!linkSourceId) {
        setLinkSourceId(id)
        setSelectedId(id)
        setSelectedIds([id])
        setSelectedLinkId(null)
        return
      }
      if (linkSourceId !== id) {
        const source = items.find(item => item.id === linkSourceId)
        const target = items.find(item => item.id === id)
        if (!source || !target) return
        const { fromSide, toSide } = chooseConnectionSides(getRoutingRect(source), getRoutingRect(target), routingRects)
        const nextLink = createAutomaticRoute(items, { id: `link-${Date.now()}`, from: linkSourceId, to: id, fromSide, toSide })
        setLinks(current => current.some(link => link.from === linkSourceId && link.to === id) ? current : [...current, nextLink])
        setSelectedId(id)
        setSelectedIds([id])
        setLinkSourceId(null)
        setTool('select')
      }
      return
    }
    setSelectedId(id)
    setSelectedIds([id])
    setSelectedLinkId(null)
  }
  const removeSelected = () => {
    if (selectedLinkId) {
      setLinks(current => current.filter(link => link.id !== selectedLinkId))
      setSelectedLinkId(null)
      return
    }
    const ids = selectedIds.length ? selectedIds : selectedId ? [selectedId] : []
    if (!ids.length) return
    items.filter(item => ids.includes(item.id) && item.localFile && item.source).forEach(item => URL.revokeObjectURL(item.source as string))
    setItems(current => current.filter(item => !ids.includes(item.id)))
    setLinks(current => current.filter(link => !ids.includes(link.from) && !ids.includes(link.to)))
    setSelectedId(null)
    setSelectedIds([])
  }
  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && (linkDrag || tool === 'link')) {
        event.preventDefault()
        cancelLinking()
        return
      }
      const target = event.target as HTMLElement | null
      const editing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
      if ((event.key === 'Delete' || event.key === 'Backspace') && !editing && (selectedIds.length > 0 || selectedLinkId)) {
        event.preventDefault()
        removeSelected()
      }
    }
    document.addEventListener('keydown', handleKeyboard)
    return () => document.removeEventListener('keydown', handleKeyboard)
  }, [linkDrag, selectedIds, selectedLinkId, tool])
  const saveCanvas = () => {
    if (!canvasHydrated.current) return
    void getCanvasApi().save({ version: 1, items, links, viewport: { scale, position }, selection: { selectedId, selectedIds, selectedLinkId } }).then(() => setSavedAt(new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date()))).catch(() => setSavedAt('保存失败'))
  }
  const confirmCanvasAction = () => {
    if (confirmAction === 'clear') {
      setItems([])
      setLinks([])
    }
    if (confirmAction === 'clean') {
      const invalidIds = new Set(items.filter(item => item.valid === false).map(item => item.id))
      setItems(current => current.filter(item => !invalidIds.has(item.id)))
      setLinks(current => current.filter(link => !invalidIds.has(link.from) && !invalidIds.has(link.to)))
    }
    setSelectedId(null)
    setSelectedIds([])
    setSelectedLinkId(null)
    setConfirmAction(null)
  }
  const updateSelectedNote = (field: 'title' | 'body', value: string) => {
    if (!selectedId) return
    setItems(current => current.map(item => item.id === selectedId ? { ...item, [field]: value } : item))
  }
  const addSelectedAsset = async () => {
    const assets = selectedAssets.filter(item => item.previewable)
    const loaded = await Promise.all(assets.map(async asset => ({ asset, source: await getLibraryApi().getAssetPreview({ id: asset.id }) })))
    loaded.filter((entry): entry is { asset: ProjectAsset; source: string } => Boolean(entry.source)).forEach(({ asset, source }) => appendCanvasContent({ id: `asset-${asset.id}`, type: 'image', title: asset.name, source, mimeType: asset.mimeType }))
  }
  const addNote = () => {
    const id = `note-${Date.now()}`
    setItems(current => [...current, { id, type: 'note', title: '新的画面备注', body: '双击素材可继续进入标注编辑。', x: 260, y: 210, width: 240, height: 116 }])
    setSelectedId(id)
    setTool('select')
  }
  const addLocalMedia = async (files: FileList | null) => {
    if (!files?.length) return
    const fileList = Array.from(files)
    const added: BoardItem[] = []
    for (let index = 0; index < fileList.length; index++) {
      const file = fileList[index]
      const type = detectMediaType(file)
      if (!type) continue
      const source = URL.createObjectURL(file)
      let thumbnail: string | undefined
      if (type === 'video') {
        thumbnail = (await captureVideoThumbnail(file)) ?? undefined
      }
      let width = type === 'audio' ? 280 : 320
      let height = type === 'audio' ? 108 : 190
      if (type === 'image') {
        const dims = await readImageDimensions(source)
        if (dims && dims.width > 0 && dims.height > 0) {
          const ratio = dims.width / dims.height
          if (ratio < 0.85) {
            width = 240
            height = 280
          } else if (ratio <= 1.25) {
            width = 260
            height = 260
          } else {
            width = 320
            height = Math.max(180, Math.min(260, Math.round(320 / ratio)))
          }
        }
      }
      added.push({
        id: `local-${Date.now()}-${index}`,
        type,
        title: file.name,
        source,
        thumbnail,
        mimeType: file.type || `${type}/*`,
        localFile: true,
        x: 170 + (items.length + index) * 24,
        y: 110 + (items.length + index) * 20,
        width,
        height,
      })
    }
    if (!added.length) return
    setItems(current => [...current, ...added])
    setSelectedId(added[added.length - 1].id)
    setSelectedLinkId(null)
    setTool('select')
  }
  const startLinking = () => {
    if (tool === 'link') {
      setTool('select')
      setLinkSourceId(null)
      setLinkDrag(null)
      return
    }
    setTool('link')
    setLinkSourceId(selectedId)
    setSelectedLinkId(null)
  }
  const startHandleLink = (item: BoardItem, direction: HandleDirection) => {
    const point = getHandlePoint(getRoutingRect(item), direction)
    setLinkDrag({ from: item.id, direction, current: point, moved: false })
    setLinkSourceId(item.id)
    setSelectedId(item.id)
    setSelectedIds([item.id])
    setSelectedLinkId(null)
    setTool('link')
  }
  const cancelLinking = () => {
    setTool('select')
    setLinkSourceId(null)
    setLinkDrag(null)
  }
  const updateLinkLabel = (id: string, label: string) => setLinks(current => current.map(link => link.id === id ? { ...link, label } : link))
  const editLinkLabel = (id: string) => {
    const link = links.find(item => item.id === id)
    if (!link) return
    cancelLinking()
    setSelectedId(null)
    setSelectedIds([])
    setSelectedLinkId(id)
    setLinkTextEditor({ id, draft: link.label || '' })
  }
  const commitLinkLabel = () => {
    if (!linkTextEditor) return
    updateLinkLabel(linkTextEditor.id, linkTextEditor.draft.trim())
    setLinkTextEditor(null)
  }
  const moveLinkSegment = (id: string, segmentIndex: number, coordinate: number, values: number[]) => {
    const points = moveCanvasRouteSegment(values, segmentIndex, coordinate)
    setLinks(current => current.map(link => link.id === id ? { ...link, manualPoints: points.slice(1, -1) } : link))
    return { x: (points[segmentIndex].x + points[segmentIndex + 1].x) / 2, y: (points[segmentIndex].y + points[segmentIndex + 1].y) / 2 }
  }
  const moveLinkBend = (id: string, bendIndex: number, nextPoint: CanvasPoint, values: number[]) => {
    const points = moveCanvasRouteBend(values, bendIndex, nextPoint)
    setLinks(currentLinks => currentLinks.map(link => link.id === id ? { ...link, manualPoints: points.slice(1, -1) } : link))
    return points[bendIndex]
  }
  const addLinkLabel = () => {
    if (!selectedLinkId) return
    editLinkLabel(selectedLinkId)
  }
  const zoom = (direction: 1 | -1) => setScale(current => Math.min(2, Math.max(.4, Number((current + direction * .1).toFixed(2)))))
  const fit = () => { setScale(1); setPosition({ x: 0, y: 0 }) }
  const handleWheel = (event: Konva.KonvaEventObject<WheelEvent>) => {
    event.evt.preventDefault()
    const stage = event.target.getStage()
    const pointer = stage?.getPointerPosition()
    if (!stage || !pointer) return
    const oldScale = scale
    const nextScale = Math.min(2, Math.max(.4, oldScale * (event.evt.deltaY > 0 ? .92 : 1.08)))
    const world = { x: (pointer.x - position.x) / oldScale, y: (pointer.y - position.y) / oldScale }
    setScale(nextScale)
    setPosition({ x: pointer.x - world.x * nextScale, y: pointer.y - world.y * nextScale })
  }
  const linkPreviewPoints = (() => {
    if (!linkDrag) return null
    const source = items.find(item => item.id === linkDrag.from)
    if (!source) return null
    const target = linkDrag.targetId ? items.find(item => item.id === linkDrag.targetId) : null
    if (target && linkDrag.targetSide) return routeCanvasLink(getRoutingRect(source), getRoutingRect(target), linkDrag.direction, linkDrag.targetSide, routingRects)
    return routeCanvasPreview(getRoutingRect(source), linkDrag.current, linkDrag.direction, routingRects)
  })()
  const linkTextEditorPosition = (() => {
    if (!linkTextEditor) return null
    const link = links.find(item => item.id === linkTextEditor.id)
    const source = link && items.find(item => item.id === link.from)
    const target = link && items.find(item => item.id === link.to)
    if (!link || !source || !target) return null
    const storedPoints = draggingItemId && (link.from === draggingItemId || link.to === draggingItemId) ? [] : link.manualPoints || link.autoPoints
    const point = getPointAtRouteRatio(routeCanvasLink(getRoutingRect(source), getRoutingRect(target), link.fromSide, link.toSide, routingRects, storedPoints))
    return { left: position.x + point.x * scale, top: position.y + point.y * scale }
  })()
  const renderCanvasLink = (link: BoardLink) => {
    const from = items.find(item => item.id === link.from)
    const to = items.find(item => item.id === link.to)
    if (!from || !to) return null
    const selected = selectedLinkId === link.id
    const storedPoints = draggingItemId && (link.from === draggingItemId || link.to === draggingItemId) ? [] : link.manualPoints || link.autoPoints
    const points = routeCanvasLink(getRoutingRect(from), getRoutingRect(to), link.fromSide, link.toSide, routingRects, storedPoints)
    const labelPosition = getPointAtRouteRatio(points)
    return <Group key={link.id}>
      <Arrow points={points} stroke={selected ? '#e64f58' : '#536f7b'} fill={selected ? '#e64f58' : '#536f7b'} strokeWidth={(selected ? 6 : 4.5) / scale} pointerLength={13 / scale} pointerWidth={12 / scale} hitStrokeWidth={26 / scale} lineCap="round" lineJoin="round" opacity={selected ? 1 : .94} onMouseDown={event => { event.cancelBubble = true; setSelectedLinkId(link.id); setSelectedId(null); setSelectedIds([]); setTool('select'); setLinkSourceId(null) }} onTap={() => { setSelectedLinkId(link.id); setSelectedId(null); setSelectedIds([]); setTool('select'); setLinkSourceId(null) }} onDblClick={event => { event.cancelBubble = true; editLinkLabel(link.id) }} onDblTap={() => editLinkLabel(link.id)} />
      {link.label && linkTextEditor?.id !== link.id && <Label x={labelPosition.x} y={labelPosition.y} offsetX={(link.label.length * 5 + 12) / 2} offsetY={10} listening={false}><Tag fill={selected ? '#fff2f3' : '#ffffff'} stroke={selected ? '#e64f58' : '#c7d5da'} strokeWidth={1 / scale} cornerRadius={4} opacity={.96} /><Text text={link.label} padding={6} fontSize={10 / scale} fill={selected ? '#a93e46' : '#536a74'} /></Label>}
    </Group>
  }
  const renderSelectedLinkControls = (link: BoardLink) => {
    if (link.id !== selectedLinkId) return null
    const from = items.find(item => item.id === link.from)
    const to = items.find(item => item.id === link.to)
    if (!from || !to) return null
    const storedPoints = draggingItemId && (link.from === draggingItemId || link.to === draggingItemId) ? [] : link.manualPoints || link.autoPoints
    const points = routeCanvasLink(getRoutingRect(from), getRoutingRect(to), link.fromSide, link.toSide, routingRects, storedPoints)
    return <Group key={`${link.id}-controls`}>{getCanvasRouteControls(points).map(control => control.kind === 'segment' ? <Circle key={`${link.id}-segment-${control.index}`} x={control.point.x} y={control.point.y} radius={6 / scale} fill="#ffffff" stroke="#e64f58" strokeWidth={2 / scale} draggable onMouseDown={event => { event.cancelBubble = true }} onDragStart={event => { event.cancelBubble = true }} onDragMove={event => { const horizontal = control.axis === 'horizontal'; if (horizontal) event.target.x(control.point.x); else event.target.y(control.point.y); event.target.position(moveLinkSegment(link.id, control.index, horizontal ? event.target.y() : event.target.x(), points)) }} onDragEnd={event => { const horizontal = control.axis === 'horizontal'; if (horizontal) event.target.x(control.point.x); else event.target.y(control.point.y); event.target.position(moveLinkSegment(link.id, control.index, horizontal ? event.target.y() : event.target.x(), points)) }} onMouseEnter={event => { event.target.getStage()!.container().style.cursor = control.axis === 'horizontal' ? 'ns-resize' : 'ew-resize' }} onMouseLeave={event => { event.target.getStage()!.container().style.cursor = 'default' }} /> : <Circle key={`${link.id}-${control.kind}-${control.index}`} x={control.point.x} y={control.point.y} radius={(control.kind === 'bend' ? 5 : 3.5) / scale} fill={control.kind === 'bend' ? '#fff2f3' : '#ffffff'} stroke="#e64f58" strokeWidth={1.5 / scale} draggable={control.kind === 'bend'} listening={control.kind === 'bend'} onMouseDown={event => { event.cancelBubble = true }} onDragStart={event => { event.cancelBubble = true }} onDragMove={event => { const point = moveLinkBend(link.id, control.index, { x: event.target.x(), y: event.target.y() }, points); event.target.position(point) }} onDragEnd={event => { const point = moveLinkBend(link.id, control.index, { x: event.target.x(), y: event.target.y() }, points); event.target.position(point) }} onMouseEnter={event => { if (control.kind === 'bend') event.target.getStage()!.container().style.cursor = 'move' }} onMouseLeave={event => { event.target.getStage()!.container().style.cursor = 'default' }} />)}</Group>
  }

  return <div className="canvas-workspace">
    <header className="canvas-workspace__header"><div><h2>视觉画布</h2><span>{items.length} 个内容 · {links.length} 条连接 · {invalidCount ? `${invalidCount} 个失效内容` : savedAt ? `${savedAt} 已保存` : '有未保存修改'}</span></div><div className="canvas-workspace__header-actions"><button type="button" title="保存画布" aria-label="保存画布" onClick={saveCanvas}><Save size={15} />保存画布</button><button type="button" title="清理失效内容" aria-label={invalidCount ? `清理失效 (${invalidCount})` : '清理失效'} disabled={!invalidCount} onClick={() => setConfirmAction('clean')}><ShieldAlert size={15} />清理失效{invalidCount ? ` (${invalidCount})` : ''}</button><button type="button" title="全部清除" aria-label="全部清除" disabled={!items.length} onClick={() => setConfirmAction('clear')}><Trash2 size={15} />全部清除</button><div className="canvas-workspace__status"><i />本地画布</div></div></header>
    <div className="canvas-workspace__body">
      <aside className="canvas-workspace__toolbar" aria-label="画布工具栏">
        <CanvasButton label="选择与移动内容" active={tool === 'select'} onClick={() => { cancelLinking(); setTool('select') }}><MousePointer2 size={18} /></CanvasButton>
        <CanvasButton label="平移画布" active={tool === 'hand'} onClick={() => { cancelLinking(); setTool('hand') }}><Hand size={18} /></CanvasButton>
        <span />
        <CanvasButton label={selectedAssets.length ? '添加已选项目素材' : '请先在素材库选择图片'} disabled={!selectedAssets.some(item => item.previewable)} onClick={() => { void addSelectedAsset() }}><ImagePlus size={18} /></CanvasButton>
        <CanvasButton label="从本地上传图片、视频或音频" onClick={() => uploadRef.current?.click()}><Upload size={18} /></CanvasButton>
        <input ref={uploadRef} className="canvas-workspace__file-input" type="file" accept="image/*,video/*,audio/*" multiple onChange={event => { addLocalMedia(event.target.files); event.target.value = '' }} />
        <CanvasButton label="添加画面备注" onClick={addNote}><StickyNote size={18} /></CanvasButton>
        <span />
        <CanvasButton label="连接两个内容" active={tool === 'link'} disabled={items.length < 2} onClick={startLinking}><Link2 size={18} /></CanvasButton>
        <CanvasButton label={selectedLinkId ? '删除所选连接' : '删除所选内容'} disabled={!selectedId && !selectedLinkId} onClick={removeSelected}><Trash2 size={18} /></CanvasButton>
      </aside>
      <main className={`canvas-workspace__viewport tool-${tool}`} ref={viewportRef}>
        <Stage
          width={viewport.width}
          height={viewport.height}
          scaleX={scale}
          scaleY={scale}
          x={position.x}
          y={position.y}
          draggable={tool === 'hand'}
          onDragEnd={event => { if (event.target === event.currentTarget) setPosition({ x: event.target.x(), y: event.target.y() }) }}
          onWheel={handleWheel}
          onMouseDown={event => {
            if (event.target !== event.target.getStage()) return
            if (tool === 'select') {
              const point = event.target.getStage()?.getPointerPosition()
              if (point) setSelectionRect({ startX: point.x, startY: point.y, currentX: point.x, currentY: point.y })
            } else if (tool === 'link') {
              setSelectedId(null)
              setSelectedIds([])
              setSelectedLinkId(null)
              setLinkSourceId(null)
              setLinkDrag(null)
            }
          }}
          onMouseMove={event => {
            const stage = event.target.getStage()
            if (linkDrag) {
              const point = worldPointFromStage(stage)
              if (point) setLinkDrag(current => {
                if (!current) return current
                const origin = getHandlePoint(getRoutingRect(items.find(item => item.id === current.from) || items[0]), current.direction)
                const target = findConnectionTarget(routingRects, point, current.from, 24 / scale)
                return { ...current, current: target?.point || point, targetId: target?.id, targetSide: target?.side, moved: current.moved || Math.hypot(point.x - origin.x, point.y - origin.y) > 8 }
              })
            }
            if (selectionRect) {
              const point = stage?.getPointerPosition()
              if (point) setSelectionRect(current => current ? { ...current, currentX: point.x, currentY: point.y } : current)
            }
          }}
          onMouseUp={event => {
            const stage = event.target.getStage()
            if (linkDrag) {
              const point = worldPointFromStage(stage)
              const target = point && findConnectionTarget(routingRects, point, linkDrag.from, 24 / scale)
              if (target) completeLink(target.id, target.side)
              else if (linkDrag.targetId) completeLink(linkDrag.targetId, linkDrag.targetSide)
              else if (linkDrag.moved) cancelLinking()
            }
            if (selectionRect) {
              const point = stage?.getPointerPosition()
              if (point) {
                const selection = { left: Math.min(selectionRect.startX, point.x), top: Math.min(selectionRect.startY, point.y), right: Math.max(selectionRect.startX, point.x), bottom: Math.max(selectionRect.startY, point.y) }
                const worldSelection = { left: (selection.left - position.x) / scale, top: (selection.top - position.y) / scale, right: (selection.right - position.x) / scale, bottom: (selection.bottom - position.y) / scale }
                const ids = items.filter(item => isInsideSelection(item, worldSelection)).map(item => item.id)
                setSelectedIds(ids)
                setSelectedId(ids[0] || null)
                setSelectedLinkId(null)
              }
              setSelectionRect(null)
            }
          }}
          >
          <Layer>
            {links.filter(link => !isForegroundCanvasLink(link, selectedLinkId)).map(renderCanvasLink)}
            {items.map(item => <Group
              key={item.id}
              x={item.x}
              y={item.y}
              draggable={tool === 'select'}
              onMouseDown={event => { if (tool === 'hand') return; event.cancelBubble = true; selectItem(item.id) }}
              onTap={() => { if (tool !== 'hand') selectItem(item.id) }}
              onMouseEnter={() => setHoveredId(item.id)}
              onMouseLeave={() => setHoveredId(current => current === item.id ? null : current)}
              onDblClick={() => { if (item.source) setMediaOpenId(item.id) }}
              onDragStart={() => setDraggingItemId(item.id)}
              onDragMove={event => moveItem(item.id, event.target.x(), event.target.y())}
              onDragEnd={event => finishMovingItem(item.id, event.target.x(), event.target.y())}
            >
              {item.valid === false ? <>
                <Rect width={item.width} height={item.height} fill="#f4f6f7" stroke="#c8d2d6" strokeWidth={1} dash={[6, 4]} cornerRadius={6} />
                <Text text={item.localFile ? '本地文件需重新上传' : '素材已失效'} y={item.height / 2 - 7} width={item.width} align="center" fontSize={12} fill="#89969c" />
              </> : item.type === 'image' ? (() => {
                const img = images[item.id]
                const fit = img ? fitContain(img.naturalWidth || img.width, img.naturalHeight || img.height, item.width, item.height) : null
                return <>
                  <Rect width={item.width} height={item.height + 30} fill="#ffffff" cornerRadius={6} shadowColor="#24404c" shadowOpacity={.12} shadowBlur={16} shadowOffsetY={6} />
                  <Rect width={item.width} height={item.height} fill="#f4f7f8" cornerRadius={[6, 6, 0, 0]} />
                  {img && fit ? (
                    <KonvaImage image={img} x={fit.x} y={fit.y} width={fit.width} height={fit.height} />
                  ) : (
                    <Rect width={item.width} height={item.height} fill="#eef2f4" cornerRadius={[6, 6, 0, 0]} />
                  )}
                  <Text text={item.title} y={item.height} width={item.width} height={30} padding={9} fontSize={11} fill="#43545c" wrap="none" ellipsis />
                </>
              })() : item.type === 'note' ? <>
                <Rect width={item.width} height={item.height} fill="#ffffff" stroke="#d5dfe3" strokeWidth={1} cornerRadius={6} shadowColor="#24404c" shadowOpacity={.12} shadowBlur={14} shadowOffsetY={5} />
                <Rect width={4} height={item.height} fill="#e64f58" cornerRadius={[6, 0, 0, 6]} />
                <Text text="画面备注" x={16} y={13} width={item.width - 30} fontSize={9} fontStyle="bold" fill="#e64f58" />
                <Text text={item.title} x={16} y={32} width={item.width - 30} fontSize={13} fontStyle="bold" fill="#263238" />
                <Text text={item.body} x={16} y={58} width={item.width - 30} fontSize={10} lineHeight={1.6} fill="#66757d" />
              </> : item.type === 'video' ? (() => {
                const vImg = images[item.id]
                const vBoxHeight = item.height - 34
                const vFit = vImg ? fitContain(vImg.naturalWidth || vImg.width, vImg.naturalHeight || vImg.height, item.width, vBoxHeight) : null
                return <>
                  <Rect width={item.width} height={item.height} fill="#ffffff" cornerRadius={6} shadowColor="#24404c" shadowOpacity={.14} shadowBlur={16} shadowOffsetY={6} />
                  <Rect width={item.width} height={vBoxHeight} fill="#1a252c" cornerRadius={[6, 6, 0, 0]} />
                  {vImg && vFit ? (
                    <KonvaImage image={vImg} x={vFit.x} y={vFit.y} width={vFit.width} height={vFit.height} />
                  ) : (
                    <Rect width={item.width} height={vBoxHeight} fill="#25323a" cornerRadius={[6, 6, 0, 0]} />
                  )}
                  <Circle x={item.width / 2} y={vBoxHeight / 2} radius={24} fill="#ffffff" opacity={.94} />
                  <Text text="▶" x={item.width / 2 - 7} y={vBoxHeight / 2 - 10} fontSize={20} fill="#e64f58" />
                  <Text text={item.title} y={vBoxHeight} width={item.width} height={34} padding={10} fontSize={11} fill="#43545c" wrap="none" ellipsis />
                </>
              })() : <>
                <Rect width={item.width} height={item.height} fill="#ffffff" cornerRadius={6} shadowColor="#24404c" shadowOpacity={.12} shadowBlur={14} shadowOffsetY={5} />
                <Rect width={item.width} height={item.height - 32} fill="#edf7fa" cornerRadius={[6, 6, 0, 0]} />
                <Circle x={34} y={38} radius={18} fill="#ffffff" />
                <Text text="▶" x={28} y={29} fontSize={17} fill="#e64f58" />
                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(index => <Rect key={index} x={70 + index * 16} y={34 - (index % 4) * 4} width={4} height={14 + (index % 4) * 8} fill="#7e929b" cornerRadius={2} />)}
                <Text text={item.title} x={16} y={item.height - 24} width={item.width - 32} fontSize={10} fill="#43545c" />
              </>}
              {tool !== 'hand' && (selectedIds.includes(item.id) || hoveredId === item.id || linkDrag?.targetId === item.id) && <>
                {selectedIds.includes(item.id) && <Rect x={-4} y={-4} width={item.width + 8} height={getVisualHeight(item) + 8} stroke="#e64f58" strokeWidth={2 / scale} cornerRadius={8} dash={[7 / scale, 4 / scale]} listening={false} />}
                {(['top', 'right', 'bottom', 'left'] as HandleDirection[]).map(direction => { const point = getHandlePoint({ ...getRoutingRect(item), x: 0, y: 0 }, direction); const target = linkDrag?.targetId === item.id && linkDrag.targetSide === direction; return <Circle key={direction} x={point.x} y={point.y} radius={(target ? 7 : 5) / scale} fill={target ? '#e64f58' : '#ffffff'} stroke="#e64f58" strokeWidth={2 / scale} onMouseDown={event => { event.cancelBubble = true; if (linkDrag) completeLink(item.id, direction); else startHandleLink(item, direction) }} onMouseEnter={() => setHoveredId(item.id)} /> })}
              </>}
            </Group>)}
            {links.filter(link => link.id !== selectedLinkId && isForegroundCanvasLink(link, selectedLinkId)).map(renderCanvasLink)}
            {links.filter(link => link.id === selectedLinkId).map(renderCanvasLink)}
            {links.map(renderSelectedLinkControls)}
            {linkPreviewPoints && <Arrow points={linkPreviewPoints} stroke="#e64f58" fill="#e64f58" dash={[9 / scale, 6 / scale]} strokeWidth={4 / scale} pointerLength={11 / scale} pointerWidth={10 / scale} lineCap="round" lineJoin="round" listening={false} />}
            {selectionRect && <Rect x={(Math.min(selectionRect.startX, selectionRect.currentX) - position.x) / scale} y={(Math.min(selectionRect.startY, selectionRect.currentY) - position.y) / scale} width={Math.abs(selectionRect.currentX - selectionRect.startX) / scale} height={Math.abs(selectionRect.currentY - selectionRect.startY) / scale} fill="#e64f58" opacity={.08} stroke="#e64f58" strokeWidth={1.5 / scale} dash={[6 / scale, 4 / scale]} listening={false} />}
          </Layer>
        </Stage>
        {linkTextEditor && linkTextEditorPosition && <input className="canvas-workspace__link-editor" style={linkTextEditorPosition} autoFocus value={linkTextEditor.draft} aria-label="编辑连接文字" placeholder="输入连接文字" onFocus={event => event.currentTarget.select()} onChange={event => setLinkTextEditor(current => current ? { ...current, draft: event.target.value } : current)} onBlur={commitLinkLabel} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commitLinkLabel() } if (event.key === 'Escape') { event.preventDefault(); setLinkTextEditor(null) } }} />}
        {!items.length && <div className="canvas-workspace__empty"><Layers3 size={22} /><strong>画布为空</strong><span>从工具栏添加项目素材或画面备注</span></div>}
        {tool === 'link' && <div className="canvas-workspace__link-status"><Link2 size={14} /><span>{linkSourceId ? '选择要连接的内容' : '选择连接起点'}</span><button type="button" aria-label="取消连接" title="取消连接" onClick={cancelLinking}><X size={13} /></button></div>}
        <div className="canvas-workspace__zoom">
          <CanvasButton label="缩小画布" onClick={() => zoom(-1)}><ZoomOut size={16} /></CanvasButton>
          <span>{Math.round(scale * 100)}%</span>
          <CanvasButton label="放大画布" onClick={() => zoom(1)}><ZoomIn size={16} /></CanvasButton>
          <CanvasButton label="适应窗口" onClick={fit}><Maximize2 size={16} /></CanvasButton>
        </div>
      </main>
      <aside className="canvas-workspace__layers">
        <div className="canvas-workspace__layers-title"><Layers3 size={16} /><strong>画布内容</strong></div>
        <div className="canvas-workspace__layer-list">{items.slice().reverse().map(item => <button type="button" key={item.id} className={selectedId === item.id ? 'selected' : ''} onClick={() => selectItem(item.id)}><span className={item.type}>{item.valid === false ? <AlertTriangle size={15} /> : item.type === 'image' ? <img src={item.source} alt="" /> : item.type === 'video' ? (item.thumbnail ? <img src={item.thumbnail} alt="" /> : <Film size={15} />) : item.type === 'audio' ? <AudioLines size={15} /> : <StickyNote size={15} />}</span><span><strong>{item.title}</strong><small>{item.valid === false ? '源文件失效' : item.type === 'image' ? '图片素材' : item.type === 'video' ? '本地视频' : item.type === 'audio' ? '本地音频' : '画面备注'}</small></span></button>)}</div>
        {!!links.length && <div className="canvas-workspace__connections"><div className="canvas-workspace__connections-head"><strong>内容连接</strong><button type="button" title={selectedLinkId && links.find(link => link.id === selectedLinkId)?.label ? '编辑当前连接文字' : '为当前连接添加文字'} aria-label={selectedLinkId && links.find(link => link.id === selectedLinkId)?.label ? '编辑连接文字' : '添加连接文字'} disabled={!selectedLinkId} onClick={addLinkLabel}><Type size={13} />{selectedLinkId && links.find(link => link.id === selectedLinkId)?.label ? '编辑文字' : '添加文字'}</button></div>{links.map(link => { const from = items.find(item => item.id === link.from); const to = items.find(item => item.id === link.to); if (!from || !to) return null; return <div className={`canvas-workspace__connection ${selectedLinkId === link.id ? 'selected' : ''}`} key={link.id}><button type="button" className="canvas-workspace__connection-select" onClick={() => { setSelectedLinkId(link.id); setSelectedId(null); setSelectedIds([]); setTool('select'); setLinkSourceId(null) }}><Link2 size={13} /><span>{from.title}</span><b>→</b><span>{to.title}</span></button><input aria-label={`连接文字：${from.title} 到 ${to.title}`} value={link.label || ''} onChange={event => updateLinkLabel(link.id, event.target.value)} placeholder="添加连接文字" /></div> })}</div>}
        {selectedItem?.type === 'note' && <div className="canvas-workspace__note-editor"><strong>编辑画面备注</strong><label>标题<input value={selectedItem.title} onChange={event => updateSelectedNote('title', event.target.value)} /></label><label>内容<textarea value={selectedItem.body} onChange={event => updateSelectedNote('body', event.target.value)} /></label></div>}
        {(selectedItem?.type === 'video' || selectedItem?.type === 'audio' || selectedItem?.type === 'image') && <div className="canvas-workspace__media-inspector"><strong>{selectedItem.type === 'video' ? '视频素材' : selectedItem.type === 'audio' ? '音频素材' : '图片素材'}</strong><small>{selectedItem.mimeType || '本地媒体文件'}</small><button type="button" disabled={!selectedItem.source} onClick={() => setMediaOpenId(selectedItem.id)}><Play size={14} />{selectedItem.source ? (selectedItem.type === 'image' ? '查看大图' : `播放${selectedItem.type === 'video' ? '视频' : '音频'}`) : '需要重新上传'}</button></div>}
      </aside>
    </div>
    <Dialog.Root open={confirmAction !== null} onOpenChange={open => { if (!open) setConfirmAction(null) }}><Dialog.Portal><Dialog.Overlay className="canvas-confirm__overlay" /><Dialog.Content className="canvas-confirm"><div><span><AlertTriangle size={18} /></span><div><Dialog.Title>{confirmAction === 'clear' ? '清空整个画布？' : '清理失效内容？'}</Dialog.Title><Dialog.Description>{confirmAction === 'clear' ? '画布上的全部内容与连接都会移除。已保存的数据会保留到下次保存。' : `将移除 ${invalidCount} 个无法找到源文件的内容。`}</Dialog.Description></div><Dialog.Close asChild><button type="button" title="关闭" aria-label="关闭确认窗口"><X size={17} /></button></Dialog.Close></div><footer><Dialog.Close asChild><button type="button" className="secondary">取消</button></Dialog.Close><button type="button" className="primary" onClick={confirmCanvasAction}><Check size={15} />确认</button></footer></Dialog.Content></Dialog.Portal></Dialog.Root>
    <Dialog.Root open={!!mediaItem?.source} onOpenChange={open => { if (!open) setMediaOpenId(null) }}><Dialog.Portal><Dialog.Overlay className="canvas-media__overlay" /><Dialog.Content className={`canvas-media canvas-media--${mediaItem?.type || 'audio'}`}><header><div><Dialog.Title>{mediaItem?.title}</Dialog.Title><Dialog.Description>{mediaItem?.type === 'video' ? '本地视频预览' : mediaItem?.type === 'audio' ? '本地音频播放' : '图片素材预览'}</Dialog.Description></div><Dialog.Close asChild><button type="button" aria-label="关闭媒体预览"><X size={19} /></button></Dialog.Close></header>{mediaItem?.type === 'image' ? <div className="canvas-media__image"><img src={mediaItem.source} alt={mediaItem.title} /></div> : mediaItem?.type === 'video' ? <video src={mediaItem.source} controls autoPlay /> : mediaItem?.type === 'audio' ? <div className="canvas-media__audio"><AudioLines size={38} /><audio src={mediaItem.source} controls autoPlay /></div> : null}</Dialog.Content></Dialog.Portal></Dialog.Root>
  </div>
}
