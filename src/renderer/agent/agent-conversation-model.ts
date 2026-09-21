import type { AgentRunResult } from '../../shared/contracts/agent'
import type { ImageResult } from '../../shared/contracts/images'
import type { ConversationArtifact, SessionMessage } from '../conversation/types'

interface ImageResultCardLike {
  status: string
  task?: { updatedAt?: string; result?: { images: ImageResult[] } }
}

export function findLatestCompletedImage(results: readonly ImageResultCardLike[]): ImageResult | undefined {
  let latest: { image: ImageResult; updatedAt: string } | undefined
  for (const item of results) {
    if (item.status !== 'completed') continue
    const image = item.task?.result?.images.find((candidate) => candidate.localPath)
    if (!image) continue
    const updatedAt = item.task?.updatedAt ?? ''
    if (!latest || updatedAt > latest.updatedAt) latest = { image, updatedAt }
  }
  return latest?.image
}

export function mergeAgentMessages(
  persisted: readonly SessionMessage[],
  pending: readonly SessionMessage[],
): SessionMessage[] {
  const merged = new Map<string, SessionMessage>()
  for (const message of persisted) merged.set(message.id, message)
  for (const message of pending) merged.set(message.id, message)
  return [...merged.values()]
}
function imageTaskCount(result: AgentRunResult): number {
  const prompts = result.pendingConfirmation?.input.prompts
  return Array.isArray(prompts) ? prompts.length : result.imageTasks?.length ?? 0
}

function promptResultsFromSteps(result: AgentRunResult): Array<Pick<NonNullable<AgentRunResult['promptResults']>[number], 'id' | 'title' | 'content'> & Partial<NonNullable<AgentRunResult['promptResults']>[number]>> {
  const output = result.steps.find((step) => step.kind === 'tool' && step.status === 'completed' && step.name === 'search_prompt_library')?.output
  if (!Array.isArray(output)) return []
  return output.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const value = item as Record<string, unknown>
    if (typeof value.id !== 'string' || typeof value.title !== 'string' || typeof value.content !== 'string') return []
    return [{ ...value, id: value.id, title: value.title, content: value.content }]
  }).slice(0, 4)
}

function artifactsFromSteps(result: AgentRunResult): ConversationArtifact[] {
  const artifacts: ConversationArtifact[] = []
  for (const step of result.steps) {
    if (step.kind !== 'tool' || step.status !== 'completed' || !step.output || typeof step.output !== 'object' || Array.isArray(step.output)) continue
    const output = step.output as Record<string, unknown>
    if (step.name === 'create_project_document' || step.name === 'update_project_document') {
      if (typeof output.relativePath !== 'string' || typeof output.name !== 'string') continue
      artifacts.push({
        type: 'document' as const,
        operation: step.name === 'create_project_document' ? 'created' as const : 'updated' as const,
        relativePath: output.relativePath,
        name: output.name,
        ...(typeof output.extension === 'string' ? { extension: output.extension } : {}),
        ...(typeof output.mimeType === 'string' ? { mimeType: output.mimeType } : {}),
        ...(typeof output.byteLength === 'number' ? { byteLength: output.byteLength } : {}),
        ...(typeof output.modifiedAt === 'string' ? { modifiedAt: output.modifiedAt } : {}),
      })
    }
    if (step.name === 'create_personal_prompt' || step.name === 'update_personal_prompt') {
      if (typeof output.id !== 'string' || typeof output.name !== 'string' || (output.scope !== 'global' && output.scope !== 'project')) continue
      artifacts.push({
        type: 'prompt' as const,
        operation: step.name === 'create_personal_prompt' ? 'created' as const : 'updated' as const,
        id: output.id,
        scope: output.scope,
        name: output.name,
        ...(output.kind === 'prompt' || output.kind === 'template' || output.kind === 'style' ? { promptKind: output.kind } : {}),
        ...(typeof output.collection === 'string' ? { collection: output.collection } : {}),
        ...(typeof output.category === 'string' ? { category: output.category } : {}),
      })
    }
  }
  return artifacts
}

export function buildAgentToolContext(result: AgentRunResult): string | undefined {
  const promptResults = result.promptResults?.slice(0, 4) ?? promptResultsFromSteps(result)
  const promptSection = promptResults.length
    ? `【提示词检索结果】\n${promptResults.map((item, index) => [
      `#${index + 1} [${item.id}] ${item.title}`,
      `分组：${typeof item.collection === 'string' ? item.collection : '个人'}`,
      `分类：${typeof item.category === 'string' ? item.category : '其他'}`,
      '提示词：',
      item.content,
    ].join('\n')).join('\n\n')}`
    : undefined
  const sections = result.steps.flatMap((step) => {
    if (step.kind !== 'tool' || step.status !== 'completed' || step.output === undefined) return []
    if (step.name === 'search_prompt_library') return []
    const serialized = typeof step.output === 'string' ? step.output : JSON.stringify(step.output)
    return [`【工具结果：${step.name}】\n${serialized.slice(0, 24_000)}`]
  })
  if (promptSection) sections.unshift(promptSection.slice(0, 24_000))
  return sections.length ? sections.join('\n\n') : undefined
}

export function buildAgentAssistantMessage(
  result: AgentRunResult,
  id: string,
  createdAt = Date.now(),
): SessionMessage {
  const count = imageTaskCount(result)
  const text = result.text.trim()
    || (result.status === 'awaiting-confirmation'
      ? `我已准备好 ${count || 1} 个图片任务，确认后开始生成。`
      : result.promptResults?.length
        ? `已找到 ${result.promptResults.length} 个匹配结果，请从下方卡片中选择。`
      : result.status === 'completed' && count > 0
        ? `已提交 ${count} 个图片任务，生成结果会显示在这里。`
        : result.status === 'cancelled'
          ? '这次 Agent 请求已取消。'
          : '我已处理你的请求。')
  const isError = result.status === 'failed'
  const toolContext = buildAgentToolContext(result)
  const artifacts = artifactsFromSteps(result)
  return {
    id,
    role: 'assistant',
    text,
    ...(toolContext ? { toolContext } : {}),
    ...(result.promptResults?.length ? { promptResults: result.promptResults } : {}),
    ...(artifacts.length ? { artifacts } : {}),
    ...(result.imageTasks?.length ? { imageTaskIds: result.imageTasks.map((task) => task.id) } : {}),
    agentSteps: result.steps,
    ...(result.usage ? { usage: result.usage } : {}),
    ...(isError ? { error: text } : {}),
    ...(result.status === 'cancelled' ? { cancelled: true } : {}),
    createdAt,
  }
}
