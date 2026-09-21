import type { CanvasPoint, HandleDirection } from '../../shared/contracts/canvas'
export type { CanvasPoint, HandleDirection } from '../../shared/contracts/canvas'

export type CanvasRect = {
  id: string
  x: number
  y: number
  width: number
  height: number
}

export type ConnectionTarget = {
  id: string
  side: HandleDirection
  point: CanvasPoint
}

export type CanvasRouteControl = {
  kind: 'anchor' | 'bend' | 'segment'
  index: number
  point: CanvasPoint
  axis?: 'horizontal' | 'vertical'
}

const routeMargin = 24
const turnCost = 32
const epsilon = .001
const directions: HandleDirection[] = ['top', 'right', 'bottom', 'left']

export function inferDirection(from: CanvasRect, to: CanvasRect): HandleDirection {
  const dx = (to.x + to.width / 2) - (from.x + from.width / 2)
  const dy = (to.y + to.height / 2) - (from.y + from.height / 2)
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left'
  return dy >= 0 ? 'bottom' : 'top'
}

export function oppositeDirection(direction: HandleDirection): HandleDirection {
  if (direction === 'right') return 'left'
  if (direction === 'left') return 'right'
  if (direction === 'bottom') return 'top'
  return 'bottom'
}

export function getHandlePoint(rect: CanvasRect, direction: HandleDirection): CanvasPoint {
  if (direction === 'top') return { x: rect.x + rect.width / 2, y: rect.y }
  if (direction === 'right') return { x: rect.x + rect.width, y: rect.y + rect.height / 2 }
  if (direction === 'bottom') return { x: rect.x + rect.width / 2, y: rect.y + rect.height }
  return { x: rect.x, y: rect.y + rect.height / 2 }
}

export function getClosestHandleDirection(rect: CanvasRect, point: CanvasPoint): HandleDirection {
  return directions.reduce((closest, direction) => {
    const candidate = getHandlePoint(rect, direction)
    const current = getHandlePoint(rect, closest)
    return distance(candidate, point) < distance(current, point) ? direction : closest
  }, directions[0])
}

export function findConnectionTarget(rects: CanvasRect[], point: CanvasPoint, sourceId: string, snapDistance = 22): ConnectionTarget | null {
  let result: { target: ConnectionTarget; distance: number } | null = null
  for (const rect of rects) {
    if (rect.id === sourceId || !isPointInRect(point, inflateRect(rect, snapDistance))) continue
    const side = getClosestHandleDirection(rect, point)
    const handle = getHandlePoint(rect, side)
    const next = { target: { id: rect.id, side, point: handle }, distance: distance(handle, point) }
    if (!result || next.distance < result.distance) result = next
  }
  return result?.target || null
}

export function chooseConnectionSides(from: CanvasRect, to: CanvasRect, obstacles: CanvasRect[] = []) {
  let best = { fromSide: inferDirection(from, to), toSide: oppositeDirection(inferDirection(from, to)), score: Number.POSITIVE_INFINITY }
  for (const fromSide of directions) {
    for (const toSide of directions) {
      const points = routeForSides(from, to, fromSide, toSide, obstacles)
      const score = getRouteScore(points)
      if (score < best.score) best = { fromSide, toSide, score }
    }
  }
  return { fromSide: best.fromSide, toSide: best.toSide }
}

export function routeCanvasLink(from: CanvasRect, to: CanvasRect, fromSide?: HandleDirection, toSide?: HandleDirection, obstacles: CanvasRect[] = [], manualPoints: CanvasPoint[] = []) {
  if (!fromSide || !toSide) {
    const automatic = chooseConnectionSides(from, to, obstacles)
    fromSide ||= automatic.fromSide
    toSide ||= automatic.toSide
  }
  if (manualPoints.length) return routeManualPoints(from, to, fromSide, toSide, manualPoints)
  return routeForSides(from, to, fromSide, toSide, obstacles)
}

export function routeCanvasPreview(from: CanvasRect, pointer: CanvasPoint, fromSide: HandleDirection, obstacles: CanvasRect[] = []) {
  const targetSide = inferPointerTargetSide(getHandlePoint(from, fromSide), pointer)
  const target = { id: '__pointer__', x: pointer.x, y: pointer.y, width: 0, height: 0 }
  return routeForSides(from, target, fromSide, targetSide, obstacles)
}

export function getPointAtRouteRatio(values: number[], ratio = .5): CanvasPoint {
  const points = toCanvasPoints(values)
  const lengths = points.slice(0, -1).map((point, index) => distance(point, points[index + 1]))
  const total = lengths.reduce((sum, length) => sum + length, 0)
  if (!total) return points[0] || { x: 0, y: 0 }
  let remaining = total * ratio
  for (let index = 0; index < lengths.length; index += 1) {
    if (remaining <= lengths[index]) {
      const start = points[index]
      const end = points[index + 1]
      const segmentRatio = lengths[index] ? remaining / lengths[index] : 0
      return { x: start.x + (end.x - start.x) * segmentRatio, y: start.y + (end.y - start.y) * segmentRatio }
    }
    remaining -= lengths[index]
  }
  return points.at(-1) || { x: 0, y: 0 }
}

export function toCanvasPoints(values: number[]) {
  const points: CanvasPoint[] = []
  for (let index = 0; index < values.length; index += 2) points.push({ x: values[index], y: values[index + 1] })
  return points
}

export function getCanvasRouteControls(values: number[]): CanvasRouteControl[] {
  const points = toCanvasPoints(values)
  const pointControls = points.map((point, index): CanvasRouteControl => ({
    kind: index === 0 || index === points.length - 1 ? 'anchor' : 'bend',
    index,
    point,
  }))
  const segmentControls = points.slice(1, -2).flatMap((point, offset): CanvasRouteControl[] => {
    const index = offset + 1
    const next = points[index + 1]
    if (!next || (point.x === next.x && point.y === next.y)) return []
    const axis = point.y === next.y ? 'horizontal' : 'vertical'
    return [{ kind: 'segment', index, axis, point: { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 } }]
  })
  return [...pointControls, ...segmentControls]
}

export function moveCanvasRouteSegment(values: number[], segmentIndex: number, coordinate: number) {
  const points = toCanvasPoints(values).map(point => ({ ...point }))
  const start = points[segmentIndex]
  const end = points[segmentIndex + 1]
  if (!start || !end || segmentIndex <= 0 || segmentIndex >= points.length - 2) return points
  if (start.y === end.y) {
    start.y = coordinate
    end.y = coordinate
  } else if (start.x === end.x) {
    start.x = coordinate
    end.x = coordinate
  }
  return points
}

export function moveCanvasRouteBend(values: number[], bendIndex: number, nextPoint: CanvasPoint) {
  const points = toCanvasPoints(values).map(point => ({ ...point }))
  const previous = points[bendIndex - 1]
  const current = points[bendIndex]
  const next = points[bendIndex + 1]
  if (!previous || !current || !next || bendIndex <= 0 || bendIndex >= points.length - 1) return points
  const adjusted = { ...nextPoint }
  const previousHorizontal = previous.y === current.y
  const nextHorizontal = current.y === next.y

  if (bendIndex === 1) {
    if (previousHorizontal) adjusted.y = previous.y
    else adjusted.x = previous.x
  } else if (previousHorizontal) previous.y = adjusted.y
  else previous.x = adjusted.x

  if (bendIndex === points.length - 2) {
    if (nextHorizontal) adjusted.y = next.y
    else adjusted.x = next.x
  } else if (nextHorizontal) next.y = adjusted.y
  else next.x = adjusted.x

  points[bendIndex] = adjusted
  return points
}

function routeManualPoints(from: CanvasRect, to: CanvasRect, fromSide: HandleDirection, toSide: HandleDirection, manualPoints: CanvasPoint[]) {
  const sourcePoint = getHandlePoint(from, fromSide)
  const targetPoint = getHandlePoint(to, toSide)
  const points = manualPoints.map(point => ({ ...point }))
  if (axisForDirection(fromSide) === 'horizontal') points[0].y = sourcePoint.y
  else points[0].x = sourcePoint.x
  if (axisForDirection(toSide) === 'horizontal') points[points.length - 1].y = targetPoint.y
  else points[points.length - 1].x = targetPoint.x
  return flattenPoints([sourcePoint, ...points, targetPoint])
}

function routeForSides(from: CanvasRect, to: CanvasRect, fromSide: HandleDirection, toSide: HandleDirection, obstacles: CanvasRect[]) {
  const sourcePoint = getHandlePoint(from, fromSide)
  const targetPoint = getHandlePoint(to, toSide)
  const allRects = uniqueRects([from, to, ...obstacles])
  const { sourceOuter, targetOuter } = getSourceAndTargetOuterRects(from, to)
  const inflated = allRects.map(rect => rect.id === from.id ? sourceOuter : rect.id === to.id ? targetOuter : inflateRect(rect, routeMargin))
  const nextSourcePoint = getOuterPoint(sourcePoint, sourceOuter, fromSide)
  const nextTargetPoint = getOuterPoint(targetPoint, targetOuter, toSide)
  const path = findOrthogonalPath(nextSourcePoint, nextTargetPoint, inflated, axisForDirection(fromSide), axisForDirection(toSide))
  const core = path || fallbackRoute(nextSourcePoint, nextTargetPoint, inflated)
  return flattenPoints(simplifyPoints([sourcePoint, ...core, targetPoint]))
}

function getSourceAndTargetOuterRects(source: CanvasRect, target: CanvasRect) {
  const sourceMargins = { top: routeMargin, right: routeMargin, bottom: routeMargin, left: routeMargin }
  const targetMargins = { top: routeMargin, right: routeMargin, bottom: routeMargin, left: routeMargin }
  const horizontalGap = target.x - (source.x + source.width)
  const reverseHorizontalGap = source.x - (target.x + target.width)
  const verticalGap = target.y - (source.y + source.height)
  const reverseVerticalGap = source.y - (target.y + target.height)
  if (horizontalGap > 0 && horizontalGap < routeMargin * 2) sourceMargins.right = targetMargins.left = horizontalGap / 2
  if (reverseHorizontalGap > 0 && reverseHorizontalGap < routeMargin * 2) sourceMargins.left = targetMargins.right = reverseHorizontalGap / 2
  if (verticalGap > 0 && verticalGap < routeMargin * 2) sourceMargins.bottom = targetMargins.top = verticalGap / 2
  if (reverseVerticalGap > 0 && reverseVerticalGap < routeMargin * 2) sourceMargins.top = targetMargins.bottom = reverseVerticalGap / 2
  return { sourceOuter: expandRect(source, sourceMargins), targetOuter: expandRect(target, targetMargins) }
}

function findOrthogonalPath(start: CanvasPoint, end: CanvasPoint, obstacles: CanvasRect[], startAxis: 'horizontal' | 'vertical', endAxis: 'horizontal' | 'vertical') {
  if (isPointInsideAny(start, obstacles) || isPointInsideAny(end, obstacles)) return null
  const xs = uniqueNumbers([start.x, end.x, ...obstacles.flatMap(rect => [rect.x, rect.x + rect.width])])
  const ys = uniqueNumbers([start.y, end.y, ...obstacles.flatMap(rect => [rect.y, rect.y + rect.height])])
  const points = xs.flatMap(x => ys.map(y => ({ x, y }))).filter(point => !isPointInsideAny(point, obstacles))
  const pointIndex = new Map(points.map((point, index) => [pointKey(point), index]))
  const startIndex = pointIndex.get(pointKey(start))
  const endIndex = pointIndex.get(pointKey(end))
  if (startIndex === undefined || endIndex === undefined) return null
  const neighbors = points.map(() => [] as number[])

  for (const indexes of groupPointIndexes(points, 'x').values()) connectVisibleNeighbors(indexes, points, neighbors, obstacles, 'y')
  for (const indexes of groupPointIndexes(points, 'y').values()) connectVisibleNeighbors(indexes, points, neighbors, obstacles, 'x')

  type Axis = 'horizontal' | 'vertical'
  type QueueItem = { index: number; axis: Axis; cost: number; state: string }
  const startState = `${startIndex}:${startAxis}`
  const queue: QueueItem[] = [{ index: startIndex, axis: startAxis, cost: 0, state: startState }]
  const costs = new Map([[startState, 0]])
  const previous = new Map<string, string>()

  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost)
    const current = queue.shift() as QueueItem
    if (current.cost !== costs.get(current.state)) continue
    for (const nextIndex of neighbors[current.index]) {
      const nextAxis: Axis = points[current.index].x === points[nextIndex].x ? 'vertical' : 'horizontal'
      const nextState = `${nextIndex}:${nextAxis}`
      const nextCost = current.cost + distance(points[current.index], points[nextIndex]) + (current.axis === nextAxis ? 0 : turnCost)
      if (nextCost >= (costs.get(nextState) ?? Number.POSITIVE_INFINITY)) continue
      costs.set(nextState, nextCost)
      previous.set(nextState, current.state)
      queue.push({ index: nextIndex, axis: nextAxis, cost: nextCost, state: nextState })
    }
  }

  const endStates = (['horizontal', 'vertical'] as Axis[]).map(axis => {
    const state = `${endIndex}:${axis}`
    return { state, cost: (costs.get(state) ?? Number.POSITIVE_INFINITY) + (axis === endAxis ? 0 : turnCost) }
  }).sort((a, b) => a.cost - b.cost)
  if (!Number.isFinite(endStates[0].cost)) return null

  const route: CanvasPoint[] = []
  let state: string | undefined = endStates[0].state
  while (state) {
    route.unshift(points[Number(state.split(':')[0])])
    state = previous.get(state)
  }
  return route
}

function groupPointIndexes(points: CanvasPoint[], axis: 'x' | 'y') {
  const groups = new Map<number, number[]>()
  points.forEach((point, index) => groups.set(point[axis], [...(groups.get(point[axis]) || []), index]))
  return groups
}

function connectVisibleNeighbors(indexes: number[], points: CanvasPoint[], neighbors: number[][], obstacles: CanvasRect[], sortAxis: 'x' | 'y') {
  indexes.sort((a, b) => points[a][sortAxis] - points[b][sortAxis])
  for (let index = 0; index < indexes.length - 1; index += 1) {
    const from = indexes[index]
    const to = indexes[index + 1]
    if (obstacles.some(rect => segmentCrossesRectInterior(points[from], points[to], rect))) continue
    neighbors[from].push(to)
    neighbors[to].push(from)
  }
}

function fallbackRoute(start: CanvasPoint, end: CanvasPoint, obstacles: CanvasRect[]) {
  if (start.x === end.x || start.y === end.y) return [start, end]
  const horizontalFirst = [start, { x: end.x, y: start.y }, end]
  const verticalFirst = [start, { x: start.x, y: end.y }, end]
  const crossingCount = (points: CanvasPoint[]) => points.slice(0, -1).reduce((count, point, index) => count + obstacles.filter(rect => segmentCrossesRectInterior(point, points[index + 1], rect)).length, 0)
  return crossingCount(horizontalFirst) <= crossingCount(verticalFirst) ? horizontalFirst : verticalFirst
}

function inferPointerTargetSide(source: CanvasPoint, target: CanvasPoint): HandleDirection {
  const dx = target.x - source.x
  const dy = target.y - source.y
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'left' : 'right'
  return dy >= 0 ? 'top' : 'bottom'
}

function axisForDirection(direction: HandleDirection) {
  return direction === 'left' || direction === 'right' ? 'horizontal' : 'vertical'
}

function getOuterPoint(point: CanvasPoint, outer: CanvasRect, direction: HandleDirection): CanvasPoint {
  if (direction === 'top') return { x: point.x, y: outer.y }
  if (direction === 'right') return { x: outer.x + outer.width, y: point.y }
  if (direction === 'bottom') return { x: point.x, y: outer.y + outer.height }
  return { x: outer.x, y: point.y }
}

function inflateRect(rect: CanvasRect, margin: number): CanvasRect {
  return { ...rect, x: rect.x - margin, y: rect.y - margin, width: rect.width + margin * 2, height: rect.height + margin * 2 }
}

function expandRect(rect: CanvasRect, margins: { top: number; right: number; bottom: number; left: number }): CanvasRect {
  return { ...rect, x: rect.x - margins.left, y: rect.y - margins.top, width: rect.width + margins.left + margins.right, height: rect.height + margins.top + margins.bottom }
}

function uniqueRects(rects: CanvasRect[]) {
  const result = new Map<string, CanvasRect>()
  rects.forEach(rect => result.set(rect.id, rect))
  return [...result.values()]
}

function uniqueNumbers(values: number[]) {
  return [...new Set(values)].sort((a, b) => a - b)
}

function pointKey(point: CanvasPoint) {
  return `${point.x},${point.y}`
}

function isPointInRect(point: CanvasPoint, rect: CanvasRect) {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height
}

function isPointInsideAny(point: CanvasPoint, rects: CanvasRect[]) {
  return rects.some(rect => point.x > rect.x + epsilon && point.x < rect.x + rect.width - epsilon && point.y > rect.y + epsilon && point.y < rect.y + rect.height - epsilon)
}

function segmentCrossesRectInterior(from: CanvasPoint, to: CanvasPoint, rect: CanvasRect) {
  if (from.x === to.x) {
    return from.x > rect.x + epsilon && from.x < rect.x + rect.width - epsilon && Math.max(from.y, to.y) > rect.y + epsilon && Math.min(from.y, to.y) < rect.y + rect.height - epsilon
  }
  if (from.y === to.y) {
    return from.y > rect.y + epsilon && from.y < rect.y + rect.height - epsilon && Math.max(from.x, to.x) > rect.x + epsilon && Math.min(from.x, to.x) < rect.x + rect.width - epsilon
  }
  return true
}

function simplifyPoints(points: CanvasPoint[]) {
  const deduplicated = points.filter((point, index) => index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y)
  if (deduplicated.length <= 2) return deduplicated
  return deduplicated.filter((point, index) => {
    if (index === 0 || index === deduplicated.length - 1) return true
    const previous = deduplicated[index - 1]
    const next = deduplicated[index + 1]
    return !((previous.x === point.x && point.x === next.x) || (previous.y === point.y && point.y === next.y))
  })
}

function flattenPoints(points: CanvasPoint[]) {
  return points.flatMap(point => [point.x, point.y])
}

function getRouteScore(values: number[]) {
  const points = toCanvasPoints(values)
  const length = points.slice(0, -1).reduce((sum, point, index) => sum + distance(point, points[index + 1]), 0)
  return length + Math.max(0, points.length - 2) * turnCost
}

function distance(from: CanvasPoint, to: CanvasPoint) {
  return Math.abs(from.x - to.x) + Math.abs(from.y - to.y)
}
