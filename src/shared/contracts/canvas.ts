export type HandleDirection = 'top' | 'right' | 'bottom' | 'left'
export type CanvasPoint = { x: number; y: number }

export type CanvasItemType = 'image' | 'note' | 'video' | 'audio'

export interface CanvasItem {
  id: string
  type: CanvasItemType
  title: string
  source?: string
  thumbnail?: string
  body?: string
  mimeType?: string
  localFile?: boolean
  x: number
  y: number
  width: number
  height: number
  valid?: boolean
}

export interface CanvasLink {
  id: string
  from: string
  to: string
  fromSide?: HandleDirection
  toSide?: HandleDirection
  label?: string
  autoPoints?: CanvasPoint[]
  manualPoints?: CanvasPoint[]
}

export interface CanvasViewport {
  scale: number
  position: CanvasPoint
}

export interface CanvasSelection {
  selectedId: string | null
  selectedIds: string[]
  selectedLinkId: string | null
}

export interface CanvasState {
  version: 1
  items: CanvasItem[]
  links: CanvasLink[]
  viewport: CanvasViewport
  selection: CanvasSelection
}

export interface CanvasApi {
  load(): Promise<CanvasState | null>
  save(state: CanvasState): Promise<CanvasState>
}
