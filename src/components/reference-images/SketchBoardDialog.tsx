import { useEffect, useReducer, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Brush, Check, Eraser, Redo2, RotateCcw, Trash2, Undo2, X } from 'lucide-react'
import { emptySketchHistory, sketchHistoryReducer, type SketchPoint, type SketchStroke } from './sketch-board-state'
import { HoverTip } from '../../renderer/common/HoverTip'

const CANVAS_WIDTH = 1280
const CANVAS_HEIGHT = 720
const CANVAS_BACKGROUND = '#f7f5f1'
const COLORS = ['#171716', '#c73542', '#2f6feb', '#d99b22']
type SketchTool = 'brush' | 'object-eraser' | 'pixel-eraser'
type EraserTool = Exclude<SketchTool, 'brush'>

function drawStroke(context: CanvasRenderingContext2D, stroke: SketchStroke): void {
  if (!stroke.points.length) return
  context.save()
  context.strokeStyle = stroke.tool === 'eraser' ? CANVAS_BACKGROUND : stroke.color
  context.fillStyle = context.strokeStyle
  context.lineWidth = stroke.width
  context.lineCap = 'round'
  context.lineJoin = 'round'
  if (stroke.points.length === 1) {
    context.beginPath()
    context.arc(stroke.points[0].x, stroke.points[0].y, stroke.width / 2, 0, Math.PI * 2)
    context.fill()
  } else {
    context.beginPath()
    context.moveTo(stroke.points[0].x, stroke.points[0].y)
    for (const point of stroke.points.slice(1)) context.lineTo(point.x, point.y)
    context.stroke()
  }
  context.restore()
}

function renderCanvas(canvas: HTMLCanvasElement, strokes: readonly SketchStroke[]): void {
  const context = canvas.getContext('2d')
  if (!context) return
  context.fillStyle = CANVAS_BACKGROUND
  context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
  for (const stroke of strokes) drawStroke(context, stroke)
}

export function SketchBoardDialog({ open, busy, onOpenChange, onConfirm }: {
  open: boolean
  busy: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (dataUrl: string) => void
}): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const workingStroke = useRef<SketchStroke | null>(null)
  const eraserTriggerRef = useRef<HTMLButtonElement>(null)
  const eraserMenuRef = useRef<HTMLDivElement>(null)
  const [history, dispatch] = useReducer(sketchHistoryReducer, emptySketchHistory)
  const [tool, setTool] = useState<SketchTool>('brush')
  const [eraserTool, setEraserTool] = useState<EraserTool>('object-eraser')
  const [eraserMenuOpen, setEraserMenuOpen] = useState(false)
  const [color, setColor] = useState(COLORS[0])
  const [width, setWidth] = useState(10)

  useEffect(() => { if (open) { dispatch({ type: 'reset' }); setTool('brush'); setEraserTool('object-eraser'); setEraserMenuOpen(false) } }, [open])
  useEffect(() => { if (canvasRef.current) renderCanvas(canvasRef.current, history.present) }, [history.present, open])
  useEffect(() => {
    if (!eraserMenuOpen) return
    window.requestAnimationFrame(() => (eraserMenuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]') ?? eraserMenuRef.current?.querySelector<HTMLButtonElement>('button'))?.focus())
  }, [eraserMenuOpen])

  const handleEraserPickerKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!eraserMenuOpen) return
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setEraserMenuOpen(false); eraserTriggerRef.current?.focus(); return }
    const items = [...(eraserMenuRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    if (!items.length) return
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    const target = event.key === 'Home' ? 0
      : event.key === 'End' ? items.length - 1
        : event.key === 'ArrowDown' ? (current + 1) % items.length
          : event.key === 'ArrowUp' ? (current - 1 + items.length) % items.length
            : -1
    if (target >= 0) { event.preventDefault(); items[target]?.focus() }
  }

  const point = (event: ReactPointerEvent<HTMLCanvasElement>): SketchPoint => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return { x: (event.clientX - bounds.left) * CANVAS_WIDTH / bounds.width, y: (event.clientY - bounds.top) * CANVAS_HEIGHT / bounds.height }
  }
  const start = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    if (tool === 'object-eraser') {
      dispatch({ type: 'erase-at', point: point(event), tolerance: width })
      return
    }
    workingStroke.current = { tool: tool === 'pixel-eraser' ? 'eraser' : 'brush', color, width: tool === 'pixel-eraser' ? width * 2 : width, points: [point(event)] }
    const context = event.currentTarget.getContext('2d')
    if (context) drawStroke(context, workingStroke.current)
  }
  const move = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    if (tool === 'object-eraser') {
      dispatch({ type: 'erase-at', point: point(event), tolerance: width })
      return
    }
    if (!workingStroke.current) return
    const next = point(event)
    workingStroke.current.points.push(next)
    const points = workingStroke.current.points
    const context = event.currentTarget.getContext('2d')
    if (context) drawStroke(context, { ...workingStroke.current, points: points.slice(-2) })
  }
  const finish = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (!workingStroke.current) return
    dispatch({ type: 'commit', stroke: workingStroke.current })
    workingStroke.current = null
  }
  const save = () => {
    const canvas = canvasRef.current
    if (!canvas || !history.present.length) return
    renderCanvas(canvas, history.present)
    onConfirm(canvas.toDataURL('image/png'))
  }
  const chooseEraser = (nextTool: EraserTool) => {
    setEraserTool(nextTool)
    setTool(nextTool)
    setEraserMenuOpen(false)
    eraserTriggerRef.current?.focus()
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="reference-dialog-overlay" />
        <Dialog.Content className="reference-dialog sketch-dialog" onEscapeKeyDown={(event) => { if (eraserMenuOpen) { event.preventDefault(); setEraserMenuOpen(false); window.requestAnimationFrame(() => eraserTriggerRef.current?.focus()) } }}>
          <header><div><Dialog.Title>画板</Dialog.Title><Dialog.Description>用简单线条表达主体位置、镜头方向和构图关系</Dialog.Description></div><Dialog.Close asChild><button type="button" className="icon-button" aria-label="关闭画板"><X size={17} /></button></Dialog.Close></header>
          <div className="sketch-toolbar" role="toolbar" aria-label="画板工具">
            <HoverTip label="画笔"><button type="button" className={tool === 'brush' ? 'active' : ''} onClick={() => { setTool('brush'); setEraserMenuOpen(false) }} aria-label="画笔"><Brush size={16} /></button></HoverTip>
            <div className="sketch-eraser-picker" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setEraserMenuOpen(false) }} onKeyDown={handleEraserPickerKeyDown}>
              <HoverTip label={eraserTool === 'pixel-eraser' ? '普通擦除' : '对象擦除'}><button ref={eraserTriggerRef} type="button" className={tool !== 'brush' ? 'active' : ''} onClick={() => setEraserMenuOpen((value) => !value)} onKeyDown={(event) => { if (!eraserMenuOpen && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setEraserMenuOpen(true) } }} aria-label={`擦除工具：${eraserTool === 'pixel-eraser' ? '普通擦除' : '对象擦除'}`} aria-haspopup="menu" aria-expanded={eraserMenuOpen}><Eraser size={16} /></button></HoverTip>
              {eraserMenuOpen && <div ref={eraserMenuRef} className="sketch-eraser-menu" role="menu" aria-label="选择擦除方式">
                <button type="button" role="menuitemradio" aria-checked={eraserTool === 'object-eraser'} onClick={() => chooseEraser('object-eraser')}><span>对象擦除</span>{eraserTool === 'object-eraser' && <Check size={13} />}</button>
                <button type="button" role="menuitemradio" aria-checked={eraserTool === 'pixel-eraser'} onClick={() => chooseEraser('pixel-eraser')}><span>普通擦除</span>{eraserTool === 'pixel-eraser' && <Check size={13} />}</button>
              </div>}
            </div>
            <span className="sketch-toolbar-divider" />
            <div className="sketch-swatches" aria-label="画笔颜色">{COLORS.map((value) => <button type="button" key={value} className={color === value && tool === 'brush' ? 'active' : ''} style={{ '--sketch-color': value } as CSSProperties} onClick={() => { setColor(value); setTool('brush'); setEraserMenuOpen(false) }} aria-label={`选择颜色 ${value}`} />)}</div>
            <label className="sketch-width">粗细<input type="range" min="2" max="32" step="2" value={width} onChange={(event) => setWidth(Number(event.target.value))} /><b>{width}</b></label>
            <span className="sketch-toolbar-spacer" />
            <HoverTip label="撤销"><button type="button" onClick={() => dispatch({ type: 'undo' })} disabled={!history.past.length} aria-label="撤销"><Undo2 size={16} /></button></HoverTip>
            <HoverTip label="重做"><button type="button" onClick={() => dispatch({ type: 'redo' })} disabled={!history.future.length} aria-label="重做"><Redo2 size={16} /></button></HoverTip>
            <HoverTip label="清空画板"><button type="button" onClick={() => dispatch({ type: 'clear' })} disabled={!history.present.length} aria-label="清空画板"><Trash2 size={16} /></button></HoverTip>
          </div>
          <div className="sketch-stage"><canvas ref={canvasRef} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} aria-label="构图草图画布" /></div>
          <footer><span>16:9 · 1280×720 PNG</span><Dialog.Close asChild><button type="button" className="secondary">取消</button></Dialog.Close><button type="button" className="primary" onClick={save} disabled={busy || !history.present.length}>{busy ? <RotateCcw className="spin" size={14} /> : <Check size={14} />}{busy ? '保存中…' : '作为参考图'}</button></footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
