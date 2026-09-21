export type AnnotationTool =
  | 'select'
  | 'pen'
  | 'rect'
  | 'arrow'
  | 'text'
  | 'crop'
  | 'object-eraser'
  | 'pixel-eraser'

const TOOL_SHORTCUTS: Readonly<Record<string, AnnotationTool>> = {
  v: 'select',
  p: 'pen',
  r: 'rect',
  a: 'arrow',
  t: 'text',
  c: 'crop',
  e: 'object-eraser',
}

export function annotationToolForShortcut(key: string): AnnotationTool | null {
  return TOOL_SHORTCUTS[key.toLocaleLowerCase()] ?? null
}

export interface Point {
  x: number
  y: number
}

export interface Bounds {
  width: number
  height: number
}

export interface CropBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface BaseAnnotationItem {
  id: string
  color: string
  strokeWidth: number
}

export interface PenAnnotationItem extends BaseAnnotationItem {
  type: 'pen'
  points: number[]
}

export interface RectAnnotationItem extends BaseAnnotationItem {
  type: 'rect'
  x: number
  y: number
  width: number
  height: number
}

export interface ArrowAnnotationItem extends BaseAnnotationItem {
  type: 'arrow'
  points: number[] // [startX, startY, endX, endY]
}

export interface TextAnnotationItem extends BaseAnnotationItem {
  type: 'text'
  x: number
  y: number
  text: string
  fontSize: number
}

export interface PixelEraserItem extends BaseAnnotationItem {
  type: 'pixel-eraser'
  points: number[]
}

export type AnnotationItem =
  | PenAnnotationItem
  | RectAnnotationItem
  | ArrowAnnotationItem
  | TextAnnotationItem
  | PixelEraserItem

function distToSegmentSquared(p: Point, v: Point, w: Point): number {
  const l2 = (w.x - v.x) ** 2 + (w.y - v.y) ** 2
  if (l2 === 0) return (p.x - v.x) ** 2 + (p.y - v.y) ** 2
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2
  t = Math.max(0, Math.min(1, t))
  return (p.x - (v.x + t * (w.x - v.x))) ** 2 + (p.y - (v.y + t * (w.y - v.y))) ** 2
}

export function hitTestItem(item: AnnotationItem, point: Point, tolerance = 4): boolean {
  switch (item.type) {
    case 'pen':
    case 'pixel-eraser': {
      const radius = item.strokeWidth / 2 + tolerance
      const radiusSq = radius * radius
      const pts = item.points
      for (let i = 0; i < pts.length - 2; i += 2) {
        const v = { x: pts[i], y: pts[i + 1] }
        const w = { x: pts[i + 2], y: pts[i + 3] }
        if (distToSegmentSquared(point, v, w) <= radiusSq) {
          return true
        }
      }
      return false
    }
    case 'arrow': {
      const radius = item.strokeWidth / 2 + tolerance + 4
      const radiusSq = radius * radius
      const pts = item.points
      if (pts.length < 4) return false
      const v = { x: pts[0], y: pts[1] }
      const w = { x: pts[2], y: pts[3] }
      return distToSegmentSquared(point, v, w) <= radiusSq
    }
    case 'rect': {
      const minX = Math.min(item.x, item.x + item.width) - tolerance
      const maxX = Math.max(item.x, item.x + item.width) + tolerance
      const minY = Math.min(item.y, item.y + item.height) - tolerance
      const maxY = Math.max(item.y, item.y + item.height) + tolerance
      return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY
    }
    case 'text': {
      const approxWidth = (item.text.length * item.fontSize * 0.6) + tolerance
      const approxHeight = item.fontSize + tolerance
      return (
        point.x >= item.x - tolerance &&
        point.x <= item.x + approxWidth &&
        point.y >= item.y - tolerance &&
        point.y <= item.y + approxHeight
      )
    }
    default:
      return false
  }
}

export function findHitItem(items: readonly AnnotationItem[], point: Point, tolerance = 4): AnnotationItem | null {
  for (let i = items.length - 1; i >= 0; i--) {
    if (hitTestItem(items[i], point, tolerance)) {
      return items[i]
    }
  }
  return null
}

export function removeHitItem(
  items: readonly AnnotationItem[],
  point: Point,
  tolerance = 4
): { items: AnnotationItem[]; deletedItem: AnnotationItem | null } {
  const hit = findHitItem(items, point, tolerance)
  if (!hit) {
    return { items: [...items], deletedItem: null }
  }
  return {
    items: items.filter((item) => item.id !== hit.id),
    deletedItem: hit,
  }
}

export function clampZoom(zoom: number, min = 0.1, max = 8.0): number {
  return Math.max(min, Math.min(max, zoom))
}

export function calculateFitZoom({
  image,
  viewport,
  padding = 24,
}: {
  image: Bounds
  viewport: Bounds
  padding?: number
}): number {
  if (image.width <= 0 || image.height <= 0 || viewport.width <= 0 || viewport.height <= 0) return 1
  const availableWidth = Math.max(1, viewport.width - padding * 2)
  const availableHeight = Math.max(1, viewport.height - padding * 2)
  return clampZoom(Math.min(availableWidth / image.width, availableHeight / image.height))
}

export interface ZoomPanCalculationInput {
  currentZoom: number
  targetZoom: number
  currentPan: Point
  pointer: Point
  /** Layout origin of the canvas inside the viewport before and after zoom. */
  currentOrigin?: Point
  targetOrigin?: Point
  minZoom?: number
  maxZoom?: number
}

export function calculateZoomAroundPoint({
  currentZoom,
  targetZoom,
  currentPan,
  pointer,
  currentOrigin = { x: 0, y: 0 },
  targetOrigin = currentOrigin,
  minZoom = 0.1,
  maxZoom = 8.0,
}: ZoomPanCalculationInput): { nextZoom: number; nextPan: Point } {
  const nextZoom = clampZoom(targetZoom, minZoom, maxZoom)
  if (currentZoom === 0) return { nextZoom, nextPan: currentPan }
  const canvasPoint = {
    x: (pointer.x - currentOrigin.x - currentPan.x) / currentZoom,
    y: (pointer.y - currentOrigin.y - currentPan.y) / currentZoom,
  }
  const nextPanX = pointer.x - targetOrigin.x - canvasPoint.x * nextZoom
  const nextPanY = pointer.y - targetOrigin.y - canvasPoint.y * nextZoom
  return {
    nextZoom,
    nextPan: { x: nextPanX, y: nextPanY },
  }
}

export function rotateItem(
  item: AnnotationItem,
  angleDeg: 90 | 180 | 270,
  bounds: Bounds
): AnnotationItem {
  if (angleDeg === 90) {
    switch (item.type) {
      case 'pen':
      case 'pixel-eraser': {
        const nextPts: number[] = []
        for (let i = 0; i < item.points.length; i += 2) {
          const x = item.points[i]
          const y = item.points[i + 1]
          nextPts.push(bounds.height - y, x)
        }
        return { ...item, points: nextPts }
      }
      case 'arrow': {
        return {
          ...item,
          points: [
            bounds.height - item.points[1],
            item.points[0],
            bounds.height - item.points[3],
            item.points[2],
          ],
        }
      }
      case 'rect': {
        const newX = bounds.height - item.y - item.height
        const newY = item.x
        return {
          ...item,
          x: newX,
          y: newY,
          width: item.height,
          height: item.width,
        }
      }
      case 'text': {
        return {
          ...item,
          x: bounds.height - item.y,
          y: item.x,
        }
      }
    }
  }
  return item
}

export function flipItem(
  item: AnnotationItem,
  axis: 'horizontal' | 'vertical',
  bounds: Bounds
): AnnotationItem {
  if (axis === 'horizontal') {
    switch (item.type) {
      case 'pen':
      case 'pixel-eraser': {
        const nextPts: number[] = []
        for (let i = 0; i < item.points.length; i += 2) {
          nextPts.push(bounds.width - item.points[i], item.points[i + 1])
        }
        return { ...item, points: nextPts }
      }
      case 'arrow': {
        return {
          ...item,
          points: [
            bounds.width - item.points[0],
            item.points[1],
            bounds.width - item.points[2],
            item.points[3],
          ],
        }
      }
      case 'rect': {
        return {
          ...item,
          x: bounds.width - item.x - item.width,
        }
      }
      case 'text': {
        return {
          ...item,
          x: bounds.width - item.x,
        }
      }
    }
  } else {
    // vertical
    switch (item.type) {
      case 'pen':
      case 'pixel-eraser': {
        const nextPts: number[] = []
        for (let i = 0; i < item.points.length; i += 2) {
          nextPts.push(item.points[i], bounds.height - item.points[i + 1])
        }
        return { ...item, points: nextPts }
      }
      case 'arrow': {
        return {
          ...item,
          points: [
            item.points[0],
            bounds.height - item.points[1],
            item.points[2],
            bounds.height - item.points[3],
          ],
        }
      }
      case 'rect': {
        return {
          ...item,
          y: bounds.height - item.y - item.height,
        }
      }
      case 'text': {
        return {
          ...item,
          y: bounds.height - item.y,
        }
      }
    }
  }
}

export class EditorHistory<T> {
  private past: T[] = []
  private present: T
  private future: T[] = []

  constructor(initial: T) {
    this.present = initial
  }

  get current(): T {
    return this.present
  }

  get canUndo(): boolean {
    return this.past.length > 0
  }

  get canRedo(): boolean {
    return this.future.length > 0
  }

  push(next: T): void {
    this.past.push(this.present)
    this.present = next
    this.future = []
  }

  undo(): T | null {
    if (!this.canUndo) return null
    const previous = this.past.pop()!
    this.future.unshift(this.present)
    this.present = previous
    return this.present
  }

  redo(): T | null {
    if (!this.canRedo) return null
    const next = this.future.shift()!
    this.past.push(this.present)
    this.present = next
    return this.present
  }

  clear(initial: T): void {
    this.past = []
    this.present = initial
    this.future = []
  }
}

export interface ExportDimensionsInput {
  naturalWidth: number
  naturalHeight: number
  crop?: CropBounds
}

export interface ResolvedExportDimensions {
  width: number
  height: number
  isCropped: boolean
  crop?: CropBounds
}

export function resolveExportDimensions(input: ExportDimensionsInput): ResolvedExportDimensions {
  if (input.crop && input.crop.width > 0 && input.crop.height > 0) {
    return {
      width: Math.round(input.crop.width),
      height: Math.round(input.crop.height),
      isCropped: true,
      crop: input.crop,
    }
  }
  return {
    width: input.naturalWidth,
    height: input.naturalHeight,
    isCropped: false,
  }
}

export type ComparisonViewMode = 'curtain' | 'side-by-side'

/**
 * 计算卷帘对比模式下鼠标/触摸点对应的分割百分比 (0 - 100)
 */
export function calculateCurtainSplit(
  clientX: number,
  containerRect: { left: number; width: number },
  minPercent: number = 0,
  maxPercent: number = 100,
): number {
  if (containerRect.width <= 0) return 50
  const ratio = (clientX - containerRect.left) / containerRect.width
  const percent = Math.round(ratio * 100)
  return Math.min(Math.max(percent, minPercent), maxPercent)
}
