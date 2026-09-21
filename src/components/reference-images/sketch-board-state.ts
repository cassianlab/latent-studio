export interface SketchPoint { x: number; y: number }

export interface SketchStroke {
  tool: 'brush' | 'eraser'
  color: string
  width: number
  points: SketchPoint[]
}

export interface SketchHistory {
  past: SketchStroke[][]
  present: SketchStroke[]
  future: SketchStroke[][]
}

export type SketchHistoryAction =
  | { type: 'commit'; stroke: SketchStroke }
  | { type: 'erase-at'; point: SketchPoint; tolerance: number }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'clear' }
  | { type: 'reset' }

export const emptySketchHistory: SketchHistory = { past: [], present: [], future: [] }

function distanceToSegment(point: SketchPoint, start: SketchPoint, end: SketchPoint): number {
  const dx = end.x - start.x
  const dy = end.y - start.y
  if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y)
  const position = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(point.x - (start.x + position * dx), point.y - (start.y + position * dy))
}

function hitStroke(stroke: SketchStroke, point: SketchPoint, tolerance: number): boolean {
  const radius = Math.max(0, tolerance) + stroke.width / 2
  if (stroke.points.length === 1) return distanceToSegment(point, stroke.points[0], stroke.points[0]) <= radius
  for (let index = 1; index < stroke.points.length; index += 1) {
    if (distanceToSegment(point, stroke.points[index - 1], stroke.points[index]) <= radius) return true
  }
  return false
}

export function sketchHistoryReducer(state: SketchHistory, action: SketchHistoryAction): SketchHistory {
  if (action.type === 'reset') return emptySketchHistory
  if (action.type === 'commit') return { past: [...state.past, state.present], present: [...state.present, action.stroke], future: [] }
  if (action.type === 'erase-at') {
    const reverseIndex = [...state.present].reverse().findIndex((stroke) => hitStroke(stroke, action.point, action.tolerance))
    if (reverseIndex < 0) return state
    const index = state.present.length - reverseIndex - 1
    return { past: [...state.past, state.present], present: state.present.filter((_, itemIndex) => itemIndex !== index), future: [] }
  }
  if (action.type === 'clear') return state.present.length ? { past: [...state.past, state.present], present: [], future: [] } : state
  if (action.type === 'undo') {
    const previous = state.past.at(-1)
    return previous ? { past: state.past.slice(0, -1), present: previous, future: [state.present, ...state.future] } : state
  }
  const next = state.future[0]
  return next ? { past: [...state.past, state.present], present: next, future: state.future.slice(1) } : state
}
