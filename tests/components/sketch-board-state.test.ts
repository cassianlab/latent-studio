import { describe, expect, it } from 'vitest'
import { sketchHistoryReducer, type SketchStroke } from '../../src/components/reference-images/sketch-board-state'

const stroke: SketchStroke = { tool: 'brush', color: '#111111', width: 8, points: [{ x: 1, y: 1 }, { x: 5, y: 5 }] }

describe('sketch board history', () => {
  it('supports commit, undo, redo and clear as reversible actions', () => {
    const committed = sketchHistoryReducer({ past: [], present: [], future: [] }, { type: 'commit', stroke })
    expect(committed.present).toEqual([stroke])
    const undone = sketchHistoryReducer(committed, { type: 'undo' })
    expect(undone.present).toEqual([])
    expect(sketchHistoryReducer(undone, { type: 'redo' }).present).toEqual([stroke])
    const cleared = sketchHistoryReducer(committed, { type: 'clear' })
    expect(cleared.present).toEqual([])
    expect(sketchHistoryReducer(cleared, { type: 'undo' }).present).toEqual([stroke])
  })

  it('erases the entire topmost stroke at the pointer and restores it with undo', () => {
    const lower = { ...stroke, color: '#222222', points: [{ x: 0, y: 20 }, { x: 100, y: 20 }] }
    const upper = { ...stroke, color: '#c73542', points: [{ x: 50, y: 0 }, { x: 50, y: 100 }] }
    const state = { past: [], present: [lower, upper], future: [] }

    const erased = sketchHistoryReducer(state, { type: 'erase-at', point: { x: 52, y: 22 }, tolerance: 8 })

    expect(erased.present).toEqual([lower])
    expect(sketchHistoryReducer(erased, { type: 'undo' }).present).toEqual([lower, upper])
  })
})
