import assert from 'node:assert/strict'
import test from 'node:test'
import { findConnectionTarget, getCanvasRouteControls, getHandlePoint, moveCanvasRouteBend, moveCanvasRouteSegment, routeCanvasLink } from '../src/components/canvas/canvas-routing.ts'

function toPoints(values) {
  const points = []
  for (let index = 0; index < values.length; index += 2) points.push({ x: values[index], y: values[index + 1] })
  return points
}

function crossesRectInterior(a, b, rect) {
  if (a.x === b.x) {
    return a.x > rect.x && a.x < rect.x + rect.width && Math.max(a.y, b.y) > rect.y && Math.min(a.y, b.y) < rect.y + rect.height
  }
  return a.y > rect.y && a.y < rect.y + rect.height && Math.max(a.x, b.x) > rect.x && Math.min(a.x, b.x) < rect.x + rect.width
}

test('left-to-left route enters the target through its requested left handle', () => {
  const source = { id: 'source', x: 100, y: 80, width: 220, height: 140 }
  const target = { id: 'target', x: 110, y: 360, width: 220, height: 140 }
  const points = toPoints(routeCanvasLink(source, target, 'left', 'left'))
  const end = getHandlePoint(target, 'left')
  const beforeEnd = points.at(-2)

  assert.deepEqual(points.at(-1), end)
  assert.ok(beforeEnd.x < end.x, 'the final segment must approach a left handle from outside the target')
  assert.equal(beforeEnd.y, end.y)
})

test('route avoids a material between the source and target', () => {
  const source = { id: 'source', x: 80, y: 120, width: 180, height: 120 }
  const blocker = { id: 'blocker', x: 350, y: 80, width: 220, height: 200 }
  const target = { id: 'target', x: 660, y: 120, width: 180, height: 120 }
  const points = toPoints(routeCanvasLink(source, target, 'right', 'left', [source, blocker, target]))

  for (let index = 0; index < points.length - 1; index += 1) {
    assert.equal(crossesRectInterior(points[index], points[index + 1], blocker), false, `segment ${index} crosses the blocker`)
  }
})

test('pointer near the target left edge snaps to its left handle', () => {
  const source = { id: 'source', x: 100, y: 80, width: 220, height: 140 }
  const target = { id: 'target', x: 110, y: 360, width: 220, height: 140 }
  const result = findConnectionTarget([source, target], { x: 106, y: 430 }, source.id)

  assert.deepEqual(result, { id: target.id, side: 'left', point: { x: 110, y: 430 } })
})

test('manual bend points keep both bound endpoints attached', () => {
  const source = { id: 'source', x: 80, y: 120, width: 180, height: 120 }
  const target = { id: 'target', x: 660, y: 120, width: 180, height: 120 }
  const manualPoints = [{ x: 300, y: 180 }, { x: 300, y: 340 }, { x: 630, y: 340 }, { x: 630, y: 180 }]
  const points = toPoints(routeCanvasLink(source, target, 'right', 'left', [source, target], manualPoints))

  assert.deepEqual(points[0], getHandlePoint(source, 'right'))
  assert.deepEqual(points.at(-1), getHandlePoint(target, 'left'))
  assert.ok(points.some(point => point.y === 340), 'manual segment position should be retained')
})

test('all source and target side combinations keep their entry directions', () => {
  const source = { id: 'source', x: 300, y: 120, width: 180, height: 120 }
  const target = { id: 'target', x: 320, y: 420, width: 180, height: 120 }
  const sides = ['top', 'right', 'bottom', 'left']

  for (const fromSide of sides) {
    for (const toSide of sides) {
      const points = toPoints(routeCanvasLink(source, target, fromSide, toSide, [source, target]))
      const start = points[0]
      const afterStart = points[1]
      const beforeEnd = points.at(-2)
      const end = points.at(-1)
      const leavesOutward = fromSide === 'left' ? afterStart.x < start.x : fromSide === 'right' ? afterStart.x > start.x : fromSide === 'top' ? afterStart.y < start.y : afterStart.y > start.y
      const entersFromOutside = toSide === 'left' ? beforeEnd.x < end.x : toSide === 'right' ? beforeEnd.x > end.x : toSide === 'top' ? beforeEnd.y < end.y : beforeEnd.y > end.y

      assert.ok(leavesOutward, `${fromSide} source route must leave outward`)
      assert.ok(entersFromOutside, `${toSide} target route must enter from outside`)
      assert.ok(points.slice(0, -1).every((point, index) => point.x === points[index + 1].x || point.y === points[index + 1].y), `${fromSide} to ${toSide} route must stay orthogonal`)
    }
  }
})

test('route controls expose every interior bend and movable segment', () => {
  const values = [520, 390, 520, 366, 300, 366, 300, 338]
  const controls = getCanvasRouteControls(values)

  assert.deepEqual(controls.filter(control => control.kind === 'bend').map(control => control.index), [1, 2])
  assert.deepEqual(controls.filter(control => control.kind === 'segment').map(control => control.index), [1])
})

test('dragging the first bend keeps the endpoint fixed and the route orthogonal', () => {
  const values = [520, 390, 520, 366, 300, 366, 300, 338]
  const points = moveCanvasRouteBend(values, 1, { x: 610, y: 250 })

  assert.deepEqual(points[0], { x: 520, y: 390 })
  assert.deepEqual(points[1], { x: 520, y: 250 })
  assert.deepEqual(points[2], { x: 300, y: 250 })
  assert.ok(points.slice(0, -1).every((point, index) => point.x === points[index + 1].x || point.y === points[index + 1].y))
})

test('dragging an interior segment keeps both endpoints fixed and the handle on the line', () => {
  const values = [520, 390, 520, 366, 300, 366, 300, 338]
  const points = moveCanvasRouteSegment(values, 1, 248)
  const control = getCanvasRouteControls(points.flatMap(point => [point.x, point.y])).find(item => item.kind === 'segment' && item.index === 1)

  assert.deepEqual(points[0], { x: 520, y: 390 })
  assert.deepEqual(points.at(-1), { x: 300, y: 338 })
  assert.deepEqual(control?.point, { x: 410, y: 248 })
  assert.ok(points.slice(0, -1).every((point, index) => point.x === points[index + 1].x || point.y === points[index + 1].y))
})
