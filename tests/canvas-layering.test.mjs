import assert from 'node:assert/strict'
import test from 'node:test'
import { isForegroundCanvasLink } from '../src/components/canvas/canvas-layering.ts'

test('a manually adjusted link stays above materials after it is deselected', () => {
  const link = { id: 'manual-link', manualPoints: [{ x: 320, y: 240 }] }

  assert.equal(isForegroundCanvasLink(link, null), true)
})

test('the selected link is foreground while untouched automatic links stay behind materials', () => {
  const link = { id: 'automatic-link' }

  assert.equal(isForegroundCanvasLink(link, link.id), true)
  assert.equal(isForegroundCanvasLink(link, null), false)
})
