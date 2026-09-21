import type { TextReasoningEffort } from '../contracts/text'
import type { ModelCapabilitySource } from '../contracts/models'

export const REASONING_EFFORT_LABELS: Record<TextReasoningEffort, string> = {
  auto: '自动',
  none: '关闭',
  minimal: '最低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最高',
}

export const REASONING_EFFORT_HINTS: Record<TextReasoningEffort, string> = {
  auto: '使用供应商默认值，不发送显式思考强度',
  none: '关闭思考推理',
  minimal: '极轻度思考，响应更快',
  low: '低强度思考，适合直接问答与快节奏创作',
  medium: '适中思考，平衡生成质量与耗时',
  high: '深度思考，多轮自检与推理，耗时与成本增加',
  xhigh: '极高思考，最严谨推理与长思考预算',
  max: '最大强度思考',
}

export interface ModelReasoningInfo {
  supported: TextReasoningEffort[]
  defaultEffort: TextReasoningEffort
  source: ModelCapabilitySource
}

/**
 * Known model IDs that natively support OpenAI reasoning_effort in Chat Completions.
 * Reference: https://developers.openai.com/api/docs/guides/reasoning
 */
export const KNOWN_OPENAI_REASONING_PATTERNS = [
  /^o1/i,
  /^o3/i,
  /^o4/i,
  /(^|[-/_])(o1|o3|o4)/i,
  /(^|[-/_])gpt-5/i,
  /gpt-5/i,
  /codex/i,
  /r1/i,
  /reasoner/i,
  /thinking/i,
  /qwq/i,
  /claude-3[-.]7/i,
  /claude-code/i,
  /kimi-k/i,
]

export const KNOWN_XHIGH_PATTERNS = [
  /gpt-5/i,
  /codex/i,
  /xhigh/i,
]

/**
 * Returns supported reasoning efforts, default effort, and source for a model.
 */
export function getSupportedReasoningEfforts(model: {
  modelId: string
  capabilities?: readonly string[]
  providerType?: string
}): ModelReasoningInfo {
  const capabilities = model.capabilities ?? []
  const modelId = model.modelId.trim().toLowerCase()
  const providerType = model.providerType ?? ''

  // 1. Explicit capabilities from profile
  const declaredExplicit: TextReasoningEffort[] = []
  for (const cap of capabilities) {
    if (cap.startsWith('reasoning:')) {
      const effort = cap.slice('reasoning:'.length) as TextReasoningEffort
      if (effort in REASONING_EFFORT_LABELS && !declaredExplicit.includes(effort)) {
        declaredExplicit.push(effort)
      }
    }
  }

  const hasGenericReasoning = capabilities.includes('reasoning-effort')
  if (declaredExplicit.length > 0 || hasGenericReasoning) {
    const supported: TextReasoningEffort[] = ['auto']
    if (hasGenericReasoning) {
      supported.push('low', 'medium', 'high')
    }
    for (const eff of declaredExplicit) {
      if (!supported.includes(eff)) {
        supported.push(eff)
      }
    }
    if (
      KNOWN_XHIGH_PATTERNS.some((pattern) => pattern.test(modelId)) ||
      modelId.includes('xhigh') ||
      capabilities.includes('reasoning:xhigh')
    ) {
      if (!supported.includes('xhigh')) {
        supported.push('xhigh')
      }
    }
    return {
      supported,
      defaultEffort: 'auto',
      source: 'user',
    }
  }

  // 2. Known adapter models for OpenAI official provider or explicit reasoning models
  const isOpenAiFamily = providerType === 'openai' || providerType === 'openai-compatible'
  const isReasoningModel = KNOWN_OPENAI_REASONING_PATTERNS.some((pattern) => pattern.test(modelId))
  // Special exception: o1-preview does not support reasoning_effort
  if (isOpenAiFamily && isReasoningModel && !modelId.includes('o1-preview')) {
    const supported: TextReasoningEffort[] = ['auto', 'low', 'medium', 'high']
    if (
      KNOWN_XHIGH_PATTERNS.some((pattern) => pattern.test(modelId)) ||
      modelId.includes('xhigh') ||
      capabilities.includes('reasoning:xhigh')
    ) {
      supported.push('xhigh')
    }
    return {
      supported,
      defaultEffort: 'auto',
      source: 'adapter',
    }
  }

  // 3. Fallback for all other models: only 'auto' supported, source: 'unconfirmed'
  return {
    supported: ['auto'],
    defaultEffort: 'auto',
    source: 'unconfirmed',
  }
}

export function isReasoningEffortSupported(
  model: { modelId: string; capabilities?: readonly string[]; providerType?: string },
  effort: TextReasoningEffort,
): boolean {
  if (effort === 'auto') return true
  const info = getSupportedReasoningEfforts(model)
  return info.supported.includes(effort)
}
