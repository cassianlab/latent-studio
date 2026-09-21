import { describe, expect, it } from 'vitest'
import {
  calculateZoomAroundPoint,
  calculateFitZoom,
  clampZoom,
  annotationToolForShortcut,
  EditorHistory,
  findHitItem,
  flipItem,
  hitTestItem,
  removeHitItem,
  resolveExportDimensions,
  rotateItem,
  type AnnotationItem,
  type CropBounds,
  type PenAnnotationItem,
  type RectAnnotationItem,
} from '../../src/renderer/editor/editor-model'

describe('editor pure geometry and model logic', () => {
  describe('tool shortcuts', () => {
    it('maps editing shortcuts while leaving typing and unrelated keys alone', () => {
      expect(annotationToolForShortcut('v')).toBe('select')
      expect(annotationToolForShortcut('P')).toBe('pen')
      expect(annotationToolForShortcut('e')).toBe('object-eraser')
      expect(annotationToolForShortcut('x')).toBeNull()
    })
  })

  describe('hit testing and object erasure', () => {
    const penItem: PenAnnotationItem = {
      id: 'pen-1',
      type: 'pen',
      color: '#df3e45',
      strokeWidth: 10,
      points: [100, 100, 200, 100, 200, 200],
    }

    const rectItem: RectAnnotationItem = {
      id: 'rect-1',
      type: 'rect',
      color: '#ffffff',
      strokeWidth: 4,
      x: 300,
      y: 300,
      width: 100,
      height: 50,
    }

    it('detects hit on pen stroke within radius + tolerance', () => {
      // Direct hit on segment (100, 100) -> (200, 100) at (150, 102)
      expect(hitTestItem(penItem, { x: 150, y: 102 }, 2)).toBe(true)
      // Miss far away
      expect(hitTestItem(penItem, { x: 150, y: 150 }, 2)).toBe(false)
    })

    it('detects hit on rectangle inside or near border', () => {
      // Inside rect
      expect(hitTestItem(rectItem, { x: 350, y: 320 })).toBe(true)
      // Outside rect
      expect(hitTestItem(rectItem, { x: 200, y: 200 })).toBe(false)
    })

    it('finds topmost hit item among multiple items', () => {
      const items: AnnotationItem[] = [rectItem, penItem]
      // Hit on penItem
      const hit = findHitItem(items, { x: 150, y: 100 }, 5)
      expect(hit?.id).toBe('pen-1')
    })

    it('removes only the hit item in object-erase mode', () => {
      const items: AnnotationItem[] = [penItem, rectItem]
      const result = removeHitItem(items, { x: 150, y: 100 }, 5)
      expect(result.deletedItem?.id).toBe('pen-1')
      expect(result.items).toHaveLength(1)
      expect(result.items[0].id).toBe('rect-1')
    })

    it('returns original array when nothing is hit', () => {
      const items: AnnotationItem[] = [penItem, rectItem]
      const result = removeHitItem(items, { x: 999, y: 999 })
      expect(result.deletedItem).toBeNull()
      expect(result.items).toHaveLength(2)
    })
  })

  describe('zoom and pan calculation', () => {
    it.each([
      [{ width: 2400, height: 800 }, { width: 900, height: 600 }, 0.355],
      [{ width: 800, height: 2400 }, { width: 900, height: 600 }, 0.23],
      [{ width: 1200, height: 1200 }, { width: 900, height: 600 }, 0.46],
    ])('fits %j completely inside %j without changing its aspect ratio', (image, viewport, expected) => {
      const zoom = calculateFitZoom({ image, viewport, padding: 24 })
      expect(zoom).toBeCloseTo(expected, 2)
      expect(image.width * zoom).toBeLessThanOrEqual(viewport.width - 48)
      expect(image.height * zoom).toBeLessThanOrEqual(viewport.height - 48)
      expect((image.width * zoom) / (image.height * zoom)).toBeCloseTo(image.width / image.height)
    })

    it('clamps zoom between 0.1 and 8.0', () => {
      expect(clampZoom(0.05)).toBe(0.1)
      expect(clampZoom(10)).toBe(8.0)
      expect(clampZoom(1.5)).toBe(1.5)
    })

    it('calculates new pan position keeping pointer anchored on canvas', () => {
      // Pointer at (200, 200), current zoom 1.0, current pan (0, 0)
      // canvas point = (200 - 0) / 1.0 = 200
      // When zooming to 2.0:
      // new pan = 200 - 200 * 2.0 = -200
      const { nextZoom, nextPan } = calculateZoomAroundPoint({
        currentZoom: 1.0,
        targetZoom: 2.0,
        currentPan: { x: 0, y: 0 },
        pointer: { x: 200, y: 200 },
      })
      expect(nextZoom).toBe(2.0)
      expect(nextPan).toEqual({ x: -200, y: -200 })
    })

    it('keeps the pointer anchored when the centered canvas origin changes with zoom', () => {
      const { nextZoom, nextPan } = calculateZoomAroundPoint({
        currentZoom: 1,
        targetZoom: 2,
        currentPan: { x: 0, y: 0 },
        pointer: { x: 300, y: 250 },
        currentOrigin: { x: 100, y: 50 },
        targetOrigin: { x: 0, y: -150 },
      })
      expect(nextZoom).toBe(2)
      expect(nextPan).toEqual({ x: -100, y: 0 })
    })
  })

  describe('rotation and flip', () => {
    it('rotates rectangle 90 degrees clockwise within image bounds', () => {
      const rect: RectAnnotationItem = {
        id: 'r1',
        type: 'rect',
        color: '#ff0000',
        strokeWidth: 2,
        x: 10,
        y: 20,
        width: 100,
        height: 50,
      }
      const rotated = rotateItem(rect, 90, { width: 1000, height: 800 })
      expect(rotated.type).toBe('rect')
      if (rotated.type === 'rect') {
        expect(rotated.width).toBe(50)
        expect(rotated.height).toBe(100)
      }
    })

    it('flips item horizontally', () => {
      const pen: PenAnnotationItem = {
        id: 'p1',
        type: 'pen',
        color: '#ff0000',
        strokeWidth: 2,
        points: [100, 50, 200, 50],
      }
      const flipped = flipItem(pen, 'horizontal', { width: 1000, height: 800 })
      expect(flipped.type).toBe('pen')
      if (flipped.type === 'pen') {
        expect(flipped.points).toEqual([900, 50, 800, 50])
      }
    })
  })

  describe('undo and redo history', () => {
    it('manages undo and redo stacks faithfully', () => {
      const history = new EditorHistory<string>('initial')
      expect(history.current).toBe('initial')
      expect(history.canUndo).toBe(false)
      expect(history.canRedo).toBe(false)

      history.push('state-1')
      history.push('state-2')
      expect(history.current).toBe('state-2')
      expect(history.canUndo).toBe(true)

      const undone = history.undo()
      expect(undone).toBe('state-1')
      expect(history.current).toBe('state-1')
      expect(history.canRedo).toBe(true)

      const redone = history.redo()
      expect(redone).toBe('state-2')
      expect(history.current).toBe('state-2')

      history.undo()
      history.push('state-3')
      expect(history.canRedo).toBe(false)
      expect(history.current).toBe('state-3')
    })
  })

  describe('export dimensions resolution', () => {
    it('uses original natural image size when no crop is specified', () => {
      const dim = resolveExportDimensions({
        naturalWidth: 1600,
        naturalHeight: 900,
      })
      expect(dim).toEqual({ width: 1600, height: 900, isCropped: false })
    })

    it('uses crop rectangle dimensions when crop is active', () => {
      const crop: CropBounds = { x: 100, y: 100, width: 800, height: 600 }
      const dim = resolveExportDimensions({
        naturalWidth: 1600,
        naturalHeight: 900,
        crop,
      })
      expect(dim).toEqual({ width: 800, height: 600, isCropped: true, crop })
    })
  })
})
