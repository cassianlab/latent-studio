import type { CanvasItem } from '../../shared/contracts/canvas'

export const canvasContentEvent = 'latent-studio:add-to-canvas'

export interface CanvasContentInput {
  id?: string
  title: string
  source: string
  mimeType?: string
}

export type CanvasContentDraft = Omit<Pick<CanvasItem, 'id' | 'type' | 'title' | 'source' | 'mimeType'>, 'id'> & Partial<Pick<CanvasItem, 'id'>>

const pending: CanvasContentDraft[] = []
const listeners = new Set<(content: CanvasContentDraft) => void>()

export function normalizeCanvasContent(input: CanvasContentInput): CanvasContentDraft | null {
  const source = input.source.trim()
  if (!source) return null
  return {
    ...(input.id?.trim() ? { id: input.id.trim() } : {}),
    type: 'image',
    title: input.title.trim() || '未命名图片',
    source,
    ...(input.mimeType?.trim() ? { mimeType: input.mimeType.trim() } : {}),
  }
}

export function dispatchCanvasContent(input: CanvasContentInput): boolean {
  const detail = normalizeCanvasContent(input)
  if (!detail) return false
  if (typeof window === 'undefined') return false
  if (!listeners.size) pending.push(detail)
  window.dispatchEvent(new CustomEvent<CanvasContentDraft>(canvasContentEvent, { detail }))
  return true
}

export function subscribeCanvasContent(listener: (content: CanvasContentDraft) => void): () => void {
  if (typeof window === 'undefined') return () => undefined
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<CanvasContentDraft>).detail
    if (detail?.type === 'image' && typeof detail.source === 'string') listener(detail)
  }
  listeners.add(listener)
  window.addEventListener(canvasContentEvent, handler)
  for (const content of pending.splice(0)) listener(content)
  return () => { listeners.delete(listener); window.removeEventListener(canvasContentEvent, handler) }
}
