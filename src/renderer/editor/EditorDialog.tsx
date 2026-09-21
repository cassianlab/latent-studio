import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import * as Tooltip from '@radix-ui/react-tooltip'
import { Arrow, Layer, Line, Rect, Stage, Text } from 'react-konva'
import type Konva from 'konva'
import { Columns2, Expand, Maximize2, Minimize2, X, ZoomIn, ZoomOut } from 'lucide-react'
import type { ImageEditorLaunch, ImageEditorVersion } from '../../shared/contracts/editor'
import { getEditorApi } from './editor-api'
import { getImageApi } from '../settings/image-api'
import { getSettingsApi } from '../settings/settings-api'
import { getTextApi } from '../settings/model-api'
import {
  calculateFitZoom,
  calculateZoomAroundPoint,
  clampZoom,
  annotationToolForShortcut,
  EditorHistory,
  removeHitItem,
  resolveExportDimensions,
  type AnnotationItem,
  type AnnotationTool,
  type CropBounds,
  type Point,
} from './editor-model'
import { EditorToolbar } from './EditorToolbar'
import { EditorInspector } from './EditorInspector'
import { EditorComparisonView } from './EditorComparisonView'
import './editor.css'

function HoverTip({
  label,
  children,
  side = 'top',
}: {
  label: string
  children: React.ReactElement
  side?: 'top' | 'right' | 'bottom' | 'left'
}) {
  return (
    <Tooltip.Root delayDuration={220}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tooltip" side={side} sideOffset={7}>
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

function IconButton({
  label,
  children,
  onClick,
  active = false,
  className = '',
  disabled = false,
  side = 'top',
}: {
  label: string
  children: React.ReactNode
  onClick?: () => void
  active?: boolean
  className?: string
  disabled?: boolean
  side?: 'top' | 'right' | 'bottom' | 'left'
}) {
  return (
    <HoverTip label={label} side={side}>
      <button
        type="button"
        className={`icon-button ${className} ${active ? 'active' : ''}`}
        onClick={onClick}
        aria-label={label}
        disabled={disabled}
      >
        {children}
      </button>
    </HoverTip>
  )
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
}

export interface EditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  launch?: ImageEditorLaunch
}

export function EditorDialog({ open, onOpenChange, launch }: EditorDialogProps): React.ReactElement {
  const [tool, setTool] = useState<AnnotationTool>('select')
  const [items, setItems] = useState<AnnotationItem[]>([])
  const historyRef = useRef<EditorHistory<AnnotationItem[]>>(new EditorHistory<AnnotationItem[]>([]))
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  const [brushColor, setBrushColor] = useState('#df3e45')
  const [brushSize, setBrushSize] = useState(24)
  const [annotationText, setAnnotationText] = useState('注意此区域')
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 })
  const [compare, setCompare] = useState(false)
  const [suggestion, setSuggestion] = useState('按标注区域进行局部修改')
  const [crop, setCrop] = useState<CropBounds | undefined>(undefined)

  const [submitting, setSubmitting] = useState(false)
  const [optimizing, setOptimizing] = useState(false)
  const [submittedTaskId, setSubmittedTaskId] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [versions, setVersions] = useState<ImageEditorVersion[]>([])
  const [restoredVersion, setRestoredVersion] = useState<ImageEditorVersion | null>(null)
  const [restoredPreview, setRestoredPreview] = useState<string | null>(null)
  const [versionLoading, setVersionLoading] = useState(false)
  const [manualSizeMode, setManualSizeMode] = useState<'auto' | 'default' | 'maximized'>('auto')
  const [windowWidth, setWindowWidth] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1200))

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const isCurrentlyMaximized =
    manualSizeMode === 'maximized' || (manualSizeMode === 'auto' && windowWidth >= 1400)

  const toggleMaximize = useCallback(() => {
    setManualSizeMode((prev) => {
      const currentlyMax = prev === 'maximized' || (prev === 'auto' && window.innerWidth >= 1400)
      return currentlyMax ? 'default' : 'maximized'
    })
  }, [])

  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number }>({ width: 1024, height: 768 })
  const drawingRef = useRef(false)
  const isSpacePressedRef = useRef(false)
  const lastMousePosRef = useRef<Point | null>(null)
  const stageRef = useRef<Konva.Stage>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const stageSpaceRef = useRef<HTMLDivElement>(null)
  const fitModeRef = useRef(true)

  const updateHistory = useCallback((next: AnnotationItem[]) => {
    historyRef.current.push(next)
    setItems(next)
    setCanUndo(historyRef.current.canUndo)
    setCanRedo(historyRef.current.canRedo)
  }, [])

  const undo = useCallback(() => {
    const prev = historyRef.current.undo()
    if (prev !== null) {
      setItems(prev)
      setCanUndo(historyRef.current.canUndo)
      setCanRedo(historyRef.current.canRedo)
    }
  }, [])

  const redo = useCallback(() => {
    const next = historyRef.current.redo()
    if (next !== null) {
      setItems(next)
      setCanUndo(historyRef.current.canUndo)
      setCanRedo(historyRef.current.canRedo)
    }
  }, [])

  const sourcePreview = restoredPreview ?? launch?.preview ?? ''
  const sourceReference = restoredVersion?.source ?? launch?.source
  const parentVersionId = restoredVersion?.id ?? launch?.parentVersionId
  const canSubmit = Boolean(sourceReference)

  const fitImageToViewport = useCallback((imageSize = naturalSize) => {
    const viewport = viewportRef.current
    if (!viewport) return
    const viewportSize = { width: viewport.clientWidth, height: viewport.clientHeight }
    if (!viewportSize.width || !viewportSize.height) return
    fitModeRef.current = true
    setZoom(calculateFitZoom({ image: imageSize, viewport: viewportSize }))
    setPan({ x: 0, y: 0 })
  }, [naturalSize])

  useEffect(() => {
    if (!open) return
    setManualSizeMode('auto')
    setTool('select')
    setItems([])
    historyRef.current.clear([])
    setCanUndo(false)
    setCanRedo(false)
    setSubmittedTaskId(null)
    setSubmitError(null)
    setRestoredVersion(null)
    setRestoredPreview(null)
    setOptimizing(false)
    setBrushColor('#df3e45')
    setBrushSize(24)
    setAnnotationText('注意此区域')
    drawingRef.current = false
    lastMousePosRef.current = null
    fitModeRef.current = true
    setNaturalSize(
      launch?.width && launch?.height
        ? { width: launch.width, height: launch.height }
        : { width: 1024, height: 768 }
    )
    setPan({ x: 0, y: 0 })
    setCrop(undefined)
    setSuggestion('移除画面右侧多余杂物，让主体轮廓更清晰；红色标注仅指示修改区域，输出图不要保留。')
    setVersionLoading(true)
    void getEditorApi()
      .listVersions()
      .then((items) => setVersions(items.filter((item) => !launch?.title || item.title === launch.title).slice(0, 8)))
      .catch(() => setVersions([]))
      .finally(() => setVersionLoading(false))
  }, [launch, open])

  useEffect(() => {
    if (!open || !viewportRef.current) return
    const viewport = viewportRef.current
    const observer = new ResizeObserver(() => {
      if (fitModeRef.current) fitImageToViewport()
    })
    observer.observe(viewport)
    requestAnimationFrame(() => fitImageToViewport())
    return () => observer.disconnect()
  }, [fitImageToViewport, open])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTextEntryTarget(e.target)) return
      if (e.code === 'Space') isSpacePressedRef.current = true
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        undo()
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        redo()
      } else if (!e.metaKey && !e.ctrlKey && !e.altKey) {
        const nextTool = annotationToolForShortcut(e.key)
        if (nextTool) {
          e.preventDefault()
          setTool(nextTool)
        }
      }
    }
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') isSpacePressedRef.current = false
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [open, undo, redo])

  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const container = viewportRef.current
    const stageSpace = stageSpaceRef.current
    if (!container || !stageSpace) return
    const rect = container.getBoundingClientRect()
    const stageRect = stageSpace.getBoundingClientRect()
    const pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9
    const targetZoom = clampZoom(zoom * zoomFactor)
    fitModeRef.current = false
    const currentOrigin = { x: stageRect.left - rect.left, y: stageRect.top - rect.top }
    const currentSize = { width: naturalSize.width * zoom, height: naturalSize.height * zoom }
    const targetSize = { width: naturalSize.width * targetZoom, height: naturalSize.height * targetZoom }
    const targetOrigin = {
      x: currentOrigin.x + (currentSize.width - targetSize.width) / 2,
      y: currentOrigin.y + (currentSize.height - targetSize.height) / 2,
    }
    const { nextZoom, nextPan } = calculateZoomAroundPoint({
      currentZoom: zoom,
      targetZoom,
      currentPan: pan,
      pointer,
      currentOrigin,
      targetOrigin,
    })
    setZoom(nextZoom)
    setPan(nextPan)
  }, [naturalSize.height, naturalSize.width, pan, zoom])

  const onImageLoaded = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    if (img.naturalWidth && img.naturalHeight) {
      const imageSize = { width: img.naturalWidth, height: img.naturalHeight }
      setNaturalSize(imageSize)
      requestAnimationFrame(() => fitImageToViewport(imageSize))
    }
  }

  const getCanvasPointer = (stage: Konva.Stage | null): Point | null => {
    if (!stage) return null
    const pos = stage.getPointerPosition()
    return pos ? { x: pos.x, y: pos.y } : null
  }

  const pointerDown = useCallback((e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (isSpacePressedRef.current || tool === 'select') return
    const stage = stageRef.current
    const p = getCanvasPointer(stage)
    if (!p) return

    if (tool === 'object-eraser') {
      const { items: nextItems, deletedItem } = removeHitItem(items, p, 8)
      if (deletedItem) {
        updateHistory(nextItems)
      }
      return
    }

    drawingRef.current = true
    const id = `item-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

    if (tool === 'pen' || tool === 'pixel-eraser') {
      const newItem: AnnotationItem = {
        id,
        type: tool,
        color: tool === 'pixel-eraser' ? '#ffffff' : brushColor,
        strokeWidth: tool === 'pixel-eraser' ? brushSize * 1.5 : brushSize,
        points: [p.x, p.y],
      }
      setItems((prev) => [...prev, newItem])
    } else if (tool === 'rect') {
      const newItem: AnnotationItem = {
        id,
        type: 'rect',
        color: brushColor,
        strokeWidth: Math.max(3, Math.round(brushSize / 4)),
        x: p.x,
        y: p.y,
        width: 0,
        height: 0,
      }
      setItems((prev) => [...prev, newItem])
    } else if (tool === 'arrow') {
      const newItem: AnnotationItem = {
        id,
        type: 'arrow',
        color: brushColor,
        strokeWidth: Math.max(3, Math.round(brushSize / 4)),
        points: [p.x, p.y, p.x, p.y],
      }
      setItems((prev) => [...prev, newItem])
    } else if (tool === 'text') {
      const text = annotationText.trim()
      if (text) {
        const newItem: AnnotationItem = {
          id,
          type: 'text',
          color: brushColor,
          strokeWidth: 1,
          x: p.x,
          y: p.y,
          text,
          fontSize: Math.max(16, brushSize),
        }
        updateHistory([...items, newItem])
      }
      drawingRef.current = false
    } else if (tool === 'crop') {
      setCrop({ x: p.x, y: p.y, width: 0, height: 0 })
    }
  }, [annotationText, brushColor, brushSize, items, tool, updateHistory])

  const pointerMove = useCallback((e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (!drawingRef.current) return
    const stage = stageRef.current
    const p = getCanvasPointer(stage)
    if (!p) return

    if (tool === 'crop') {
      setCrop((prev) => prev ? { ...prev, width: p.x - prev.x, height: p.y - prev.y } : undefined)
      return
    }

    setItems((prev) => {
      if (!prev.length) return prev
      const next = [...prev]
      const last = next[next.length - 1]

      if (last.type === 'pen' || last.type === 'pixel-eraser') {
        next[next.length - 1] = { ...last, points: [...last.points, p.x, p.y] }
      } else if (last.type === 'rect') {
        next[next.length - 1] = { ...last, width: p.x - last.x, height: p.y - last.y }
      } else if (last.type === 'arrow') {
        next[next.length - 1] = { ...last, points: [last.points[0], last.points[1], p.x, p.y] }
      }
      return next
    })
  }, [tool])

  const pointerUp = useCallback(() => {
    if (!drawingRef.current) return
    drawingRef.current = false
    if (tool === 'crop') {
      if (crop && (Math.abs(crop.width) < 20 || Math.abs(crop.height) < 20)) {
        setCrop(undefined)
      } else if (crop) {
        const x = crop.width < 0 ? crop.x + crop.width : crop.x
        const y = crop.height < 0 ? crop.y + crop.height : crop.y
        setCrop({ x, y, width: Math.abs(crop.width), height: Math.abs(crop.height) })
      }
      return
    }
    updateHistory(items)
  }, [crop, items, tool, updateHistory])

  const onViewportMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button === 1 || isSpacePressedRef.current || tool === 'select') {
      fitModeRef.current = false
      lastMousePosRef.current = { x: e.clientX, y: e.clientY }
    }
  }

  const onViewportMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (lastMousePosRef.current) {
      const dx = e.clientX - lastMousePosRef.current.x
      const dy = e.clientY - lastMousePosRef.current.y
      setPan((prev) => ({ x: prev.x + dx, y: prev.y + dy }))
      lastMousePosRef.current = { x: e.clientX, y: e.clientY }
    }
  }

  const onViewportMouseUp = () => {
    lastMousePosRef.current = null
  }

  const restoreVersion = async (version: ImageEditorVersion) => {
    setVersionLoading(true)
    setSubmitError(null)
    try {
      const preview = await getEditorApi().getVersionPreview(version.id)
      if (!preview) throw new Error('该编辑版本的预览文件已不存在')
      setRestoredVersion(version)
      setRestoredPreview(preview)
      setSuggestion(version.suggestion)
      setItems([])
      historyRef.current.clear([])
      setCanUndo(false)
      setCanRedo(false)
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : '编辑版本读取失败')
    } finally {
      setVersionLoading(false)
    }
  }

  const optimizeSuggestion = async () => {
    if (optimizing) return
    setOptimizing(true)
    setSubmitError(null)
    try {
      const settings = await getSettingsApi().get()
      const model = settings.defaultTextModelId ?? settings.models.find((item) => item.kind === 'text')?.id
      if (!model) throw new Error('请先在模型设置中启用一个文本模型')
      const result = await getTextApi().generate({
        modelProfileId: model,
        request: {
          system: '你是图片编辑提示词优化器。只返回一段简洁、可执行的中文修改建议，明确修改对象、区域、保留内容和不要保留的标记。',
          messages: [{ role: 'user', content: suggestion }],
          maxTokens: 500,
        },
      })
      if (!result.text.trim()) throw new Error('文本模型没有返回优化结果')
      setSuggestion(result.text.trim())
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : '修改建议优化失败')
    } finally {
      setOptimizing(false)
    }
  }

  const createChildVersion = async () => {
    if (!canSubmit || !sourceReference || !launch || !stageRef.current || submitting) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const image = imageRef.current
      if (!image?.complete || image.naturalWidth === 0) throw new Error('原图尚未加载完成')
      const exportDim = resolveExportDimensions({
        naturalWidth: naturalSize.width,
        naturalHeight: naturalSize.height,
        crop,
      })

      const composite = document.createElement('canvas')
      composite.width = exportDim.width
      composite.height = exportDim.height
      const context = composite.getContext('2d')
      if (!context) throw new Error('无法创建标注图层')

      if (crop) {
        context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, exportDim.width, exportDim.height)
      } else {
        context.drawImage(image, 0, 0, exportDim.width, exportDim.height)
      }

      const stageCanvas = stageRef.current.toCanvas({ pixelRatio: 1 })
      if (crop) {
        context.drawImage(stageCanvas, crop.x, crop.y, crop.width, crop.height, 0, 0, exportDim.width, exportDim.height)
      } else {
        context.drawImage(stageCanvas, 0, 0)
      }

      const marked = composite.toDataURL('image/png')
      const settings = await getSettingsApi().get()
      const model = settings.defaultImageModelId ?? settings.models.find((item) => item.kind === 'image')?.id
      if (!model) throw new Error('请先在模型设置中启用一个图片模型')
      const imageModel = settings.models.find((item) => item.id === model && item.kind === 'image')

      const annotationReference = { type: 'data' as const, data: marked, mimeType: 'image/png', filename: 'annotation.png' }
      const references = imageModel?.capabilities.includes('multi-reference') && sourceReference
        ? [sourceReference, annotationReference]
        : [annotationReference]

      const task = await getImageApi().enqueue({
        modelProfileId: model,
        request: {
          operation: 'edit',
          prompt: `${suggestion.trim() || '按标注区域进行局部修改'}\n标注图中的颜色与线条仅用于说明修改位置，输出图片中不要保留任何标记。`,
          references,
          metadata: { editorVersion: 'child', ...(parentVersionId ? { parentVersionId } : {}) },
        },
      })
      setSubmittedTaskId(task.id)
      await getEditorApi().saveVersion({
        title: launch.title,
        ...(parentVersionId ? { parentVersionId } : {}),
        ...(sourceReference ? { source: sourceReference } : {}),
        markedDataUrl: marked,
        suggestion: suggestion.trim() || '按标注区域进行局部修改',
        taskId: task.id,
      })
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : '创建子版本失败')
    } finally {
      setSubmitting(false)
    }
  }

  const renderedItems = useMemo(
    () =>
      items.map((item) => {
        switch (item.type) {
          case 'rect':
            return (
              <Rect
                key={item.id}
                x={item.x}
                y={item.y}
                width={item.width}
                height={item.height}
                stroke={item.color}
                strokeWidth={item.strokeWidth}
              />
            )
          case 'arrow':
            return (
              <Arrow
                key={item.id}
                points={item.points}
                stroke={item.color}
                fill={item.color}
                strokeWidth={item.strokeWidth}
                pointerLength={12}
                pointerWidth={12}
              />
            )
          case 'text':
            return (
              <Text
                key={item.id}
                x={item.x}
                y={item.y}
                text={item.text}
                fontSize={item.fontSize}
                fill={item.color}
                fontStyle="bold"
              />
            )
          case 'pixel-eraser':
            return (
              <Line
                key={item.id}
                points={item.points}
                stroke="#000000"
                strokeWidth={item.strokeWidth}
                lineCap="round"
                lineJoin="round"
                globalCompositeOperation="destination-out"
              />
            )
          case 'pen':
          default:
            return (
              <Line
                key={item.id}
                points={item.points}
                stroke={item.color}
                strokeWidth={item.strokeWidth}
                lineCap="round"
                lineJoin="round"
                globalCompositeOperation="source-over"
              />
            )
        }
      }),
    [items]
  )

  const exportDim = resolveExportDimensions({
    naturalWidth: naturalSize.width,
    naturalHeight: naturalSize.height,
    crop,
  })

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay editor-overlay" />
        <Dialog.Content
          className={`editor-dialog ${
            manualSizeMode === 'maximized'
              ? 'is-maximized'
              : manualSizeMode === 'default'
              ? 'force-default'
              : ''
          }`}
        >
          <Tooltip.Provider delayDuration={150}>
            <header onDoubleClick={toggleMaximize} title="双击切换窗口最大化/还原">
              <div>
                <Dialog.Title>标注局部修改</Dialog.Title>
                <Dialog.Description>
                  {launch?.title ?? '图片'} · {exportDim.width}×{exportDim.height}
                  {exportDim.isCropped ? '（已裁剪）' : '（原图规格）'}
                </Dialog.Description>
              </div>
              <div className="editor-actions">
                <button
                  type="button"
                  className={`secondary ${compare ? 'compare-active' : ''}`}
                  onClick={() => setCompare((v) => !v)}
                >
                  <Columns2 size={16} />
                  {compare ? '退出对比' : '版本对比'}
                </button>
                <IconButton
                  label={isCurrentlyMaximized ? '还原默认大小' : '最大化窗口'}
                  side="bottom"
                  onClick={toggleMaximize}
                >
                  {isCurrentlyMaximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                </IconButton>
                <Dialog.Close asChild>
                  <button type="button" className="icon-button" aria-label="关闭">
                    <X size={19} />
                  </button>
                </Dialog.Close>
              </div>
            </header>

            <div className="editor-body">
              <EditorToolbar
                tool={tool}
                onSelectTool={setTool}
                canUndo={canUndo}
                canRedo={canRedo}
                hasItems={items.length > 0}
                hasCrop={Boolean(crop)}
                onUndo={undo}
                onRedo={redo}
                onClear={() => { updateHistory([]); setCrop(undefined) }}
                onClearCrop={() => setCrop(undefined)}
              />

              <main
                className={`canvas-area ${compare ? 'compare-mode' : ''} tool-${tool} ${tool === 'select' ? 'panning' : ''}`}
                ref={viewportRef}
                onWheel={compare ? undefined : handleWheel}
                onMouseDown={compare ? undefined : onViewportMouseDown}
                onMouseMove={compare ? undefined : onViewportMouseMove}
                onMouseUp={compare ? undefined : onViewportMouseUp}
                onMouseLeave={compare ? undefined : onViewportMouseUp}
              >
                {compare ? (
                  <EditorComparisonView
                    sourcePreview={sourcePreview}
                    naturalSize={naturalSize}
                    renderedItems={renderedItems}
                    versions={versions}
                    itemCount={items.length}
                    onExitCompare={() => setCompare(false)}
                  />
                ) : (
                  <div ref={stageSpaceRef} className="canvas-stage-space" style={{ width: naturalSize.width * zoom, height: naturalSize.height * zoom }}>
                    <div
                      className="canvas-stage-wrapper"
                      style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
                    >
                    <img
                      ref={imageRef}
                      src={sourcePreview}
                      alt="待标注大图"
                      onLoad={onImageLoaded}
                      style={{ width: naturalSize.width, height: naturalSize.height }}
                    />
                    <Stage
                      width={naturalSize.width}
                      height={naturalSize.height}
                      ref={stageRef}
                      onMouseDown={pointerDown}
                      onMouseMove={pointerMove}
                      onMouseUp={pointerUp}
                      onTouchStart={pointerDown}
                      onTouchMove={pointerMove}
                      onTouchEnd={pointerUp}
                    >
                      <Layer>{renderedItems}</Layer>
                    </Stage>
                    {crop && (
                      <div
                        className="editor-crop-overlay"
                        style={{
                          left: crop.x,
                          top: crop.y,
                          width: crop.width,
                          height: crop.height,
                        }}
                      />
                    )}
                    </div>
                  </div>
                )}

                {!compare && (
                  <div className="zoom-bar">
                    <IconButton label="缩小" onClick={() => { fitModeRef.current = false; setZoom((v) => clampZoom(v - 0.15)) }}>
                      <ZoomOut size={16} />
                    </IconButton>
                    <span>{Math.round(zoom * 100)}%</span>
                    <IconButton label="放大" onClick={() => { fitModeRef.current = false; setZoom((v) => clampZoom(v + 0.15)) }}>
                      <ZoomIn size={16} />
                    </IconButton>
                    <IconButton
                      label="适应窗口"
                      onClick={() => fitImageToViewport()}
                    >
                      <Expand size={16} />
                    </IconButton>
                  </div>
                )}
              </main>

              <EditorInspector
                tool={tool}
                annotationText={annotationText}
                onChangeAnnotationText={setAnnotationText}
                brushColor={brushColor}
                onChangeBrushColor={setBrushColor}
                brushSize={brushSize}
                onChangeBrushSize={setBrushSize}
                suggestion={suggestion}
                onChangeSuggestion={setSuggestion}
                onOptimizeSuggestion={() => void optimizeSuggestion()}
                optimizing={optimizing}
                restoredVersion={restoredVersion}
                versions={versions}
                versionLoading={versionLoading}
                onRestoreVersion={(ver) => void restoreVersion(ver)}
                canSubmit={canSubmit}
                submitting={submitting}
                compare={compare}
                submittedTaskId={submittedTaskId}
                submitError={submitError}
                exportWidth={exportDim.width}
                exportHeight={exportDim.height}
                onCreateChildVersion={() => void createChildVersion()}
              />
            </div>
          </Tooltip.Provider>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export default EditorDialog
