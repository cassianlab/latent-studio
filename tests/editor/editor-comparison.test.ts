import { describe, expect, it } from 'vitest'
import { calculateCurtainSplit } from '../../src/renderer/editor/editor-model'

describe('editor comparison model and split calculation', () => {
  const containerRect = { left: 100, width: 800 }

  it('calculates 50% split at midpoint', () => {
    // 100 + 400 = 500 -> 50%
    const split = calculateCurtainSplit(500, containerRect)
    expect(split).toBe(50)
  })

  it('calculates 25% and 75% splits correctly', () => {
    // 100 + 200 = 300 -> 25%
    expect(calculateCurtainSplit(300, containerRect)).toBe(25)
    // 100 + 600 = 700 -> 75%
    expect(calculateCurtainSplit(700, containerRect)).toBe(75)
  })

  it('clamps split to minimum and maximum percent bounds', () => {
    // clientX far to the left (< 0%)
    expect(calculateCurtainSplit(50, containerRect, 5, 95)).toBe(5)
    // clientX far to the right (> 100%)
    expect(calculateCurtainSplit(1000, containerRect, 5, 95)).toBe(95)
  })

  it('handles default boundary limits (0 to 100)', () => {
    expect(calculateCurtainSplit(-50, containerRect)).toBe(0)
    expect(calculateCurtainSplit(1200, containerRect)).toBe(100)
  })

  it('gracefully returns 50% when container has zero or invalid width', () => {
    expect(calculateCurtainSplit(300, { left: 100, width: 0 })).toBe(50)
    expect(calculateCurtainSplit(300, { left: 100, width: -100 })).toBe(50)
  })
})
