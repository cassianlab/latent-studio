import type { ConversationCompactionState, SessionMessage } from './types'
import type { TextApi } from '../../shared/contracts/text'
import type { AgentSkillContext } from '../../shared/contracts/agent'
import { estimateContextTokens, estimateTextTokens, MODEL_CONTEXT_WINDOW_TOKENS, textTokenUpperBound, trimTextToTokenUpperBound, trimTextToTokens } from '../../shared/token-estimator'

export const CONTEXT_WINDOW_TOKENS = MODEL_CONTEXT_WINDOW_TOKENS
export const CONTEXT_COMPACTION_THRESHOLD = 200_000
// Keep the model-facing context deliberately small after compaction. The full
// transcript remains in the conversation store and stays readable in the UI.
const CONTEXT_TARGET_TOKENS = 48_000
const RECENT_MESSAGE_TOKENS = 18_000
const MAX_SUMMARY_TOKENS = 12_000
const MAX_PROTECTED_ANCHOR_TOKENS = 2_000
const SUMMARY_TIMEOUT_MS = 30_000

export interface PreparedContextMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ConversationSummaryInput {
  previousSummary?: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
}

export interface PrepareConversationContextInput {
  messages: readonly SessionMessage[]
  state?: ConversationCompactionState
  fixedContext?: readonly string[]
  forceCompaction?: boolean
  onCompactionStart?: () => void | Promise<void>
  summarize?: (input: ConversationSummaryInput) => Promise<string>
}

export interface PreparedConversationContext {
  messages: PreparedContextMessage[]
  state?: ConversationCompactionState
  compacted: boolean
  usedFallback: boolean
  estimatedTokens: number
}

const SUMMARY_SYSTEM_PROMPT = `你是对话上下文观察器。把旧观察与新增对话合并为紧凑、可继续执行的中文观察记录。
必须按以下栏目输出；没有内容时写“无”：
## 当前目标
## 已确认事实与约束
## 决策与用户偏好
## 产物、路径与工具结果
## 未完成事项
## 变更记录

规则：
1. 保留精确的名称、数量、顺序、文件路径、模型、Skill、错误与可复用工具结果。
2. 新消息明确修改旧决定或偏好时，用新值更新对应栏目，并在“变更记录”说明旧值已失效；不要同时把冲突值写成当前状态。
3. 保留尚未解决的问题和下一步，删除闲聊、重复表达和已失效的中间推理。
4. 不得添加原文没有的事实，不要评价用户，不要输出思维过程。`
const SUMMARY_REQUEST_TARGET_TOKENS = 32_000

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('模型摘要压缩超时')), timeoutMs)
      }),
    ])
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}

function contextTokenUpperBound(messages: readonly string[], fixedContext: readonly string[] = []): number {
  return [...fixedContext, ...messages].reduce((total, value) => total + textTokenUpperBound(value) + 8, 0)
}

export async function summarizeConversationWithModel(api: Pick<TextApi, 'generate'>, modelProfileId: string, input: ConversationSummaryInput): Promise<string> {
  let summary = input.previousSummary ? trimToTokens(input.previousSummary, MAX_SUMMARY_TOKENS) : ''
  let batch: ConversationSummaryInput['messages'] = []
  const requestContent = (items: ConversationSummaryInput['messages']) => `${summary ? `上一版摘要：\n${summary}\n\n` : ''}需要压缩的对话：\n${items.map((message) => `${message.role === 'user' ? '用户' : '助手'}：${message.content}`).join('\n\n')}`
  const flush = async () => {
    if (!batch.length) return
    const result = await api.generate({
      modelProfileId,
      request: {
        system: SUMMARY_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: requestContent(batch) }],
        maxTokens: 6_000,
      },
    })
    summary = result.text.trim()
    if (!summary) throw new Error('压缩摘要为空')
    summary = trimToTokens(summary, MAX_SUMMARY_TOKENS)
    batch = []
  }
  for (const message of input.messages) {
    const candidate = [...batch, message]
    if (batch.length && contextTokenUpperBound([SUMMARY_SYSTEM_PROMPT, requestContent(candidate)]) >= SUMMARY_REQUEST_TARGET_TOKENS) await flush()
    const rolePrefix = message.role === 'user' ? '用户：' : '助手：'
    const available = Math.max(8_000, SUMMARY_REQUEST_TARGET_TOKENS - contextTokenUpperBound([SUMMARY_SYSTEM_PROMPT, requestContent(batch), rolePrefix]))
    batch.push({ ...message, content: trimTextToTokenUpperBound(message.content, available) })
  }
  await flush()
  return summary
}

export { estimateContextTokens } from '../../shared/token-estimator'

function trimToTokens(value: string, maxTokens: number): string {
  return trimTextToTokens(value, maxTokens)
}

function normalizeObservation(value: string): string {
  const trimmed = value.trim()
  if (/^## 当前目标/m.test(trimmed) && /^## 未完成事项/m.test(trimmed)) return trimmed
  return `## 当前目标\n${trimmed}\n\n## 已确认事实与约束\n无\n\n## 决策与用户偏好\n无\n\n## 产物、路径与工具结果\n无\n\n## 未完成事项\n无\n\n## 变更记录\n无`
}

function protectedAnchors(messages: readonly SessionMessage[]): string[] {
  const content = messages.map(messageContext).join('\n')
  const anchors = new Set<string>()
  const patterns = [
    /https?:\/\/[^\s<>"')\]}，。！？]+/g,
    /\/(?:[^/\s，。！？]+\/)+[^/\s，。！？]+/g,
    /\b[a-z][a-z0-9]*(?:[-_.][a-z0-9]+){2,}\b/gi,
    /\b\d+(?:\.\d+)?\s*(?:px|kb|mb|gb|秒|分钟|小时|张|个|次)\b/gi,
    /\b\d+\s*[:x×]\s*\d+\b/gi,
  ]
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) anchors.add(match[0])
  }
  for (const sentence of content.split(/[。！？\n]+/)) {
    const trimmed = sentence.trim()
    if (trimmed && trimmed.length <= 240 && /(必须|不要|不得|改为|保持|只能|固定|禁止|务必)/.test(trimmed)) anchors.add(trimmed)
  }
  return [...anchors]
}

function preserveAnchors(summary: string, messages: readonly SessionMessage[]): string {
  const missing = protectedAnchors(messages).filter((anchor) => !summary.includes(anchor))
  if (!missing.length) return summary
  const lines: string[] = []
  for (const anchor of missing) {
    const candidate = [...lines, `- ${anchor}`]
    if (estimateContextTokens(candidate) > MAX_PROTECTED_ANCHOR_TOKENS) break
    lines.push(`- ${anchor}`)
  }
  return lines.length ? `## 受保护原文\n${lines.join('\n')}\n\n${summary}` : summary
}

function messageContext(message: SessionMessage): string {
  const artifacts = message.artifacts?.map((artifact) => artifact.type === 'document'
    ? `当前文档成果：${artifact.relativePath}（${artifact.name}）`
    : `当前提示词成果：ID=${artifact.id}，范围=${artifact.scope}，名称=${artifact.name}`)
  return [message.text, message.toolContext, artifacts?.length ? `【当前对话成果引用】\n${artifacts.join('\n')}` : undefined].filter(Boolean).join('\n\n').trim()
}

function compactLine(message: SessionMessage): string {
  const role = message.role === 'user' ? '用户' : '助手'
  const normalized = messageContext(message).replace(/\s+/g, ' ').trim()
  const excerpt = normalized.length > 1_100
    ? `${normalized.slice(0, 850)} … ${normalized.slice(-180)}`
    : normalized
  return `- [${role}] ${excerpt}`
}

function fallbackSummary(previousSummary: string | undefined, messages: readonly SessionMessage[]): string {
  const sections = ['【本地压缩摘要】']
  if (previousSummary?.trim()) sections.push(`已有摘要：\n${trimToTokens(previousSummary.trim(), 12_000)}`)
  sections.push('早期对话要点：')
  const lines: string[] = []
  let tokens = estimateContextTokens(sections)
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const line = compactLine(messages[index])
    const lineTokens = estimateContextTokens([line])
    if (tokens + lineTokens > MAX_SUMMARY_TOKENS) break
    lines.unshift(line)
    tokens += lineTokens
  }
  sections.push(lines.join('\n') || '- 早期对话已被折叠，保留最近原文继续任务。')
  return trimToTokens(sections.join('\n\n'), MAX_SUMMARY_TOKENS)
}

function summaryMessage(summary: string): PreparedContextMessage {
  return { role: 'system', content: `以下是本会话较早内容的历史对话压缩摘要。将其作为连续上下文，不要伪造摘要中没有的细节：\n\n${summary}` }
}

function afterBoundary(messages: readonly SessionMessage[], state: ConversationCompactionState | undefined): SessionMessage[] {
  if (!state) return messages.filter((message) => !message.pending && !message.error && messageContext(message)).map((message) => ({ ...message }))
  const boundary = messages.findIndex((message) => message.id === state.throughMessageId)
  const start = boundary >= 0 ? boundary + 1 : 0
  return messages.slice(start).filter((message) => !message.pending && !message.error && messageContext(message)).map((message) => ({ ...message }))
}

function observedFixedTokens(messages: readonly SessionMessage[], state?: ConversationCompactionState): number {
  let fixedTokens = state?.estimatedFixedTokens ?? 0
  for (let index = 0; index < messages.length; index += 1) {
    const inputTokens = messages[index].usage?.inputTokens
    if (inputTokens === undefined) continue
    const visiblePrefixTokens = estimateContextTokens(messages.slice(0, index).map(messageContext))
    fixedTokens = Math.max(fixedTokens, inputTokens - visiblePrefixTokens)
  }
  return Math.max(0, Math.round(fixedTokens))
}

export interface ConversationUsage {
  usedTokens: number
  capacityTokens: number
  percent: number
  estimated: boolean
  reasoningTokens?: number
}

export function estimateConversationUsage(
  messages: readonly SessionMessage[],
  state?: ConversationCompactionState,
  fixedContext: readonly string[] = [],
): ConversationUsage {
  const candidates = afterBoundary(messages, state)
  const prepared = [
    ...(state?.summary ? [summaryMessage(state.summary)] : []),
    ...asPrepared(candidates),
  ]
  const locallyEstimatedTokens = estimateContextTokens(
    prepared.map((message) => message.content),
    fixedContext,
  ) + (state?.estimatedFixedTokens ?? 0)
  let usedTokens = locallyEstimatedTokens
  let estimated = true
  let reasoningTokens: number | undefined
  let trailingTokens = 0
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const message = candidates[index]
    const providerTokens = message.usage?.contextTokens ?? message.usage?.totalTokens
    const staleAfterCompaction = state?.updatedAt !== undefined && message.createdAt < state.updatedAt
    if (providerTokens !== undefined && !staleAfterCompaction) {
      const checkpointTokens = providerTokens + trailingTokens
      if (checkpointTokens >= usedTokens) {
        usedTokens = checkpointTokens
        estimated = message.usage?.contextTokens === undefined || trailingTokens > 0
        reasoningTokens = message.usage?.reasoningTokens
      }
    }
    trailingTokens += estimateContextTokens([messageContext(message)])
  }
  const rawPercent = (usedTokens / CONTEXT_WINDOW_TOKENS) * 100
  return {
    usedTokens,
    capacityTokens: CONTEXT_WINDOW_TOKENS,
    percent: usedTokens > 0 ? Math.min(100, Math.max(0.1, Math.round(rawPercent * 10) / 10)) : 0,
    estimated,
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
  }
}

export function retainSkillContextsAfterCompaction(
  skills: readonly AgentSkillContext[],
  messages: readonly SessionMessage[],
  state: ConversationCompactionState | undefined,
): AgentSkillContext[] {
  if (!state) return skills.map((skill) => ({ ...skill }))
  const boundary = messages.findIndex((message) => message.id === state.throughMessageId)
  if (boundary < 0) return skills.map((skill) => ({ ...skill }))
  const compactedIds = new Set(messages.slice(0, boundary + 1).map((message) => message.id))
  return skills.filter((skill) => !skill.activatedAtMessageId || !compactedIds.has(skill.activatedAtMessageId)).map((skill) => ({ ...skill }))
}

function asPrepared(messages: readonly SessionMessage[]): PreparedContextMessage[] {
  return messages.map((message) => ({ role: message.role, content: messageContext(message) }))
}

function recentSlice(messages: readonly SessionMessage[], fixedContext: readonly string[], previousSummary?: string, force = false): { older: SessionMessage[]; recent: SessionMessage[] } {
  if (force && messages.length > 2) return { older: messages.slice(0, -2), recent: messages.slice(-2) }
  const recent: SessionMessage[] = []
  let tokens = contextTokenUpperBound(previousSummary ? [previousSummary] : [], fixedContext)
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    const nextTokens = contextTokenUpperBound([messageContext(message)])
    if (recent.length >= 1 && tokens + nextTokens > RECENT_MESSAGE_TOKENS) break
    recent.unshift(message)
    tokens += nextTokens
  }
  return { older: messages.slice(0, messages.length - recent.length), recent }
}

function fitTarget(summary: string, recent: SessionMessage[], fixedContext: readonly string[]): { summary: string; recent: SessionMessage[] } {
  const fittedRecent = [...recent]
  let fittedSummary = trimTextToTokenUpperBound(summary, MAX_SUMMARY_TOKENS)
  let prepared = [summaryMessage(fittedSummary), ...asPrepared(fittedRecent)]
  while (fittedRecent.length > 1 && contextTokenUpperBound(prepared.map((message) => message.content), fixedContext) >= CONTEXT_TARGET_TOKENS) {
    fittedRecent.shift()
    prepared = [summaryMessage(fittedSummary), ...asPrepared(fittedRecent)]
  }
  const availableSummaryTokens = Math.max(2_000, CONTEXT_TARGET_TOKENS - contextTokenUpperBound(asPrepared(fittedRecent).map((message) => message.content), fixedContext) - 500)
  fittedSummary = trimTextToTokenUpperBound(fittedSummary, Math.min(MAX_SUMMARY_TOKENS, availableSummaryTokens))
  return { summary: fittedSummary, recent: fittedRecent }
}

function migrateOfficialState(state: ConversationCompactionState | undefined): ConversationCompactionState | undefined {
  if (state?.compressionMode !== 'official') return state
  const { officialItems: _ignored, ...readableState } = state
  return { ...readableState, compressionMode: 'observational' }
}

export async function prepareConversationContext(input: PrepareConversationContextInput): Promise<PreparedConversationContext> {
  const fixedContext = input.fixedContext ?? []
  const previousState = migrateOfficialState(input.state)
  const candidates = afterBoundary(input.messages, previousState)
  const existing = [
    ...(previousState?.summary ? [summaryMessage(previousState.summary)] : []),
    ...asPrepared(candidates),
  ]
  const existingTokens = estimateContextTokens(existing.map((message) => message.content), fixedContext)
  const existingUpperBound = contextTokenUpperBound(existing.map((message) => message.content), fixedContext)
  const providerUsageRequiresCompaction = existingTokens < CONTEXT_COMPACTION_THRESHOLD
    && existingUpperBound < CONTEXT_COMPACTION_THRESHOLD
    && estimateConversationUsage(input.messages, previousState, fixedContext).usedTokens >= CONTEXT_COMPACTION_THRESHOLD
  const canForceCompaction = input.forceCompaction === true && candidates.length > 2
  if (!canForceCompaction && !providerUsageRequiresCompaction && existingTokens < CONTEXT_COMPACTION_THRESHOLD && existingUpperBound < CONTEXT_COMPACTION_THRESHOLD) {
    return {
      messages: existing,
      ...(previousState ? { state: previousState } : {}),
      compacted: false,
      usedFallback: false,
      estimatedTokens: existingTokens,
    }
  }

  await input.onCompactionStart?.()
  const { older, recent } = recentSlice(candidates, fixedContext, previousState?.summary, canForceCompaction || providerUsageRequiresCompaction)
  let fallbackReason: string | undefined
  let summary = ''
  let usedFallback = false
  if (older.length && input.summarize) {
    try {
      const generated = (await withTimeout(input.summarize({
        ...(previousState?.summary ? { previousSummary: previousState.summary } : {}),
        messages: older.map((message) => ({ role: message.role, content: messageContext(message) })),
      }), SUMMARY_TIMEOUT_MS)).trim()
      const observation = normalizeObservation(generated)
      if (!generated || estimateTextTokens(observation) > MAX_SUMMARY_TOKENS) throw new Error('压缩摘要无效')
      summary = observation
    } catch (error) {
      usedFallback = true
      fallbackReason = error instanceof Error ? error.message : '模型摘要压缩失败'
    }
  } else {
    usedFallback = true
    fallbackReason = '没有可用的文本模型'
  }
  if (usedFallback) summary = fallbackSummary(previousState?.summary, older)
  summary = preserveAnchors(summary, older)
  const fitted = fitTarget(summary, recent, fixedContext)
  const throughMessageId = older.at(-1)?.id ?? previousState?.throughMessageId ?? candidates[0]?.id
  const coveredMessageCount = (previousState?.coveredMessageCount ?? 0) + older.length
  const keyItemCount = Math.max(1, fitted.summary.split(/\n+/).filter((line) => /^\s*(?:[-*]|\d+[.)])\s+/.test(line)).length)
  const state = throughMessageId ? {
    summary: fitted.summary,
    throughMessageId,
    updatedAt: Date.now(),
    compressionMode: usedFallback ? 'local' as const : 'observational' as const,
    ...(fallbackReason ? { fallbackReason } : {}),
    estimatedFixedTokens: observedFixedTokens(candidates, previousState),
    coveredMessageCount,
    ...(previousState?.coveredFromAt !== undefined ? { coveredFromAt: previousState.coveredFromAt } : older[0]?.createdAt !== undefined ? { coveredFromAt: older[0].createdAt } : {}),
    ...(older.at(-1)?.createdAt !== undefined ? { coveredThroughAt: older.at(-1)!.createdAt } : previousState?.coveredThroughAt !== undefined ? { coveredThroughAt: previousState.coveredThroughAt } : {}),
    keyItemCount,
  } : previousState
  const prepared = [summaryMessage(fitted.summary), ...asPrepared(fitted.recent)]
  const estimatedTokens = estimateContextTokens(prepared.map((message) => message.content), fixedContext)

  return {
    messages: prepared,
    ...(state ? { state } : {}),
    compacted: true,
    usedFallback,
    estimatedTokens,
  }
}
