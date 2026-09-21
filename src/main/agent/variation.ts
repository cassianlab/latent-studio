import { randomUUID } from 'node:crypto'
import type { BatchPlanMode, ImageVariation, ImageVariationPlan } from '../../shared/contracts/agent'

const MAX_VARIATIONS = 16

function asText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`图片计划缺少${field}`)
  return value.trim()
}

function normalize(value: string): string { return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase() }

export function validateImageVariationPlan(value: unknown, count: number, mode: BatchPlanMode): ImageVariationPlan {
  if (!Number.isInteger(count) || count < 1 || count > MAX_VARIATIONS) throw new Error(`图片数量需要是 1-${MAX_VARIATIONS} 的整数`)
  if (!value || typeof value !== 'object') throw new Error('图片计划格式无效')
  const root = value as Record<string, unknown>
  let invariants: string[] = []
  if (Array.isArray(root.invariants)) {
    invariants = root.invariants
      .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
      .map((item) => item.trim())
  } else if (typeof root.invariants === 'string' && root.invariants.trim()) {
    invariants = [root.invariants.trim()]
  } else if (typeof root.invariant === 'string' && root.invariant.trim()) {
    invariants = [root.invariant.trim()]
  } else if (Array.isArray(root.invariant)) {
    invariants = root.invariant
      .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
      .map((item) => item.trim())
  }
  if (mode === 'smart' && invariants.length === 0) {
    invariants = ['保持画面主体核心特征与视觉基调一致']
  }
  if (!Array.isArray(root.variations) || root.variations.length !== count) throw new Error(`图片计划必须包含 ${count} 个变体`)
  const variations: ImageVariation[] = root.variations.map((item, index) => {
    if (!item || typeof item !== 'object') throw new Error(`第 ${index + 1} 个变体格式无效`)
    const entry = item as Record<string, unknown>
    const references = Array.isArray(entry.referenceAssetIds) ? entry.referenceAssetIds.filter((id): id is string => typeof id === 'string' && Boolean(id.trim())).map((id) => id.trim()) : undefined
    return { id: typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : randomUUID(), title: asText(entry.title, `第 ${index + 1} 个变体标题`), prompt: asText(entry.prompt, `第 ${index + 1} 个变体提示词`), difference: asText(entry.difference, `第 ${index + 1} 个变体差异`), ...(references?.length ? { referenceAssetIds: references } : {}) }
  })
  if (mode === 'smart') {
    const unique = new Set(variations.map((item) => normalize(item.prompt)))
    if (unique.size !== variations.length) throw new Error('智能变体计划包含重复提示词，请重新规划')
  }
  const notes = Array.isArray(root.notes) ? root.notes.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim()) : undefined
  return { mode, invariants, variations, ...(notes?.length ? { notes } : {}) }
}

export function parseImageVariationPlan(text: string, count: number, mode: BatchPlanMode): ImageVariationPlan {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
  const raw = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch {
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start < 0 || end <= start) throw new Error('图片模型未返回有效 JSON 计划')
    try { parsed = JSON.parse(raw.slice(start, end + 1)) } catch { throw new Error('图片模型未返回有效 JSON 计划') }
  }
  return validateImageVariationPlan(parsed, count, mode)
}
