import { randomUUID } from 'node:crypto'
import type { AgentConfirmationAction, AgentPermission, AgentRunInput, AgentRunResult, AgentSkillCandidate, AgentSkillContext, AgentStep, AgentStreamEvent, PromptSearchResult, SkillRunResult } from '../../shared/contracts/agent'
import type { TextGenerationResult, TextImagePart, TextMessage, TextReasoningEffort, TextToolCall, TextToolDefinition, TextUsage } from '../../shared/contracts/text'
import type { ImageApi, ImageReference, ImageRequestInput, ImageTaskRecord } from '../../shared/contracts/images'
import type { ProjectContextDocument } from '../../shared/contracts/context'
import type { SearchResponse } from '../../shared/contracts/search'
import type { MemoryEntry, ProjectAsset, PromptAsset, SaveMemoryEntryInput, SavePromptAssetInput, UpdateMemoryEntryInput, UpdatePromptAssetInput } from '../../shared/contracts/library'
import { resolveAgentImageCount } from '../../shared/agent-planning'
import { buildImageTaskPrompt } from '../../shared/image-task-prompt'
import { referenceCapabilityError } from '../../shared/reference-images'
import { textTokenUpperBound } from '../../shared/token-estimator'
import { fitTextModelContext } from './context-budget'

const DEFAULT_MAX_STEPS = 8
const MAX_STEPS = 12
const MAX_PROMPTS = 16
const MAX_TOOL_OUTPUT = 24_000
const MAX_ATTACHMENT_CONTEXT_TOKENS = 160_000

export interface AgentRunnerDependencies {
  generate(input: { modelProfileId: string; request: { system: string; messages: readonly TextMessage[]; tools: readonly TextToolDefinition[]; maxTokens: number; includeUsage?: boolean; reasoningEffort?: TextReasoningEffort; officialCompactionItems?: AgentRunInput['officialCompactionItems'] }; signal?: AbortSignal }): Promise<TextGenerationResult>
  generateStream?(input: { modelProfileId: string; request: { system: string; messages: readonly TextMessage[]; tools: readonly TextToolDefinition[]; maxTokens: number; includeUsage?: boolean; reasoningEffort?: TextReasoningEffort; officialCompactionItems?: AgentRunInput['officialCompactionItems'] }; signal?: AbortSignal }, emit: (event: AgentStreamEvent) => void): Promise<TextGenerationResult>
  search(input: { query: string; maxResults?: number; signal?: AbortSignal }): Promise<SearchResponse>
  searchPrompts?(input: { query: string; limit: number }): Promise<PromptAsset[]>
  searchPromptLibrary?(input: { query: string; limit: number }): Promise<PromptSearchResult[]>
  getPromptDetail?(input: { id: string }): Promise<PromptAsset | null>
  readFile(input: { filePath: string; maxBytes?: number; signal?: AbortSignal }): Promise<ProjectContextDocument>
  readProjectMemory?(input: { id: string }): Promise<MemoryEntry | null>
  readProjectAssetMetadata?(input: { id: string }): Promise<ProjectAsset | null>
  readImageReferences?(references: readonly ImageReference[]): Promise<TextImagePart[]>
  runSkill(input: { skillId: string; entrypoint: string; args?: string[]; timeoutMs?: number; maxOutputBytes?: number; signal?: AbortSignal }): Promise<SkillRunResult>
  writeProjectDocument?(input: { title: string; content: string; filename?: string; extension?: string }): Promise<unknown>
  updateProjectDocument?(input: { filePath: string; title: string; content: string }): Promise<unknown>
  deleteProjectDocument?(input: { filePath: string }): Promise<void>
  createProjectMemory?(input: Omit<SaveMemoryEntryInput, 'scope' | 'projectRoot'>): Promise<MemoryEntry>
  updateProjectMemory?(input: Omit<UpdateMemoryEntryInput, 'scope' | 'projectRoot'>): Promise<MemoryEntry>
  deleteProjectMemory?(input: { id: string }): Promise<void>
  createPersonalPrompt?(input: Omit<SavePromptAssetInput, 'scope' | 'projectRoot'> & { scope?: 'global' | 'project' }): Promise<PromptAsset>
  updatePersonalPrompt?(input: Omit<UpdatePromptAssetInput, 'scope' | 'projectRoot'> & { scope: 'global' | 'project' }): Promise<PromptAsset>
  deletePersonalPrompt?(input: { id: string; scope: 'global' | 'project' }): Promise<void>
  listSkillCandidates?(mode: 'text' | 'agent'): Promise<AgentSkillCandidate[]>
  resolveSkills?(prompt: string, selectedSkillId: string | undefined, mode: 'text' | 'agent'): Promise<AgentSkillContext[]>
  image?: ImageApi
  getImageModelCapabilities?(modelProfileId: string): readonly string[]
  getProjectRoot?: () => string | undefined
  persistence?: AgentSessionPersistence
}

export interface AgentSessionSnapshot {
  id: string
  input: AgentRunInput
  messages: TextMessage[]
  steps: AgentStep[]
  text: string
  imageTasks: ImageTaskRecord[]
  documents: ProjectContextDocument[]
  searchResults?: SearchResponse
  promptResults?: PromptSearchResult[]
  usage?: TextUsage
  pending?: TextToolCall & { parsed: Record<string, unknown>; stepId: string; confirmationAction: AgentConfirmationAction }
  confirmed: boolean
  stepCount: number
  cancelled: boolean
  projectRoot?: string
  status: AgentRunResult['status']
  skills?: AgentSkillContext[]
  skillCandidates?: AgentSkillCandidate[]
  activeSkillIds?: string[]
  skillsResolved?: boolean
  updatedAt: string
}

export interface AgentSessionPersistence {
  load(projectRoot: string): Promise<AgentSessionSnapshot[]>
  save(snapshot: AgentSessionSnapshot): Promise<void>
}

interface AgentSession {
  id: string
  input: AgentRunInput
  messages: TextMessage[]
  steps: AgentStep[]
  text: string
  imageTasks: ImageTaskRecord[]
  documents: ProjectContextDocument[]
  searchResults?: SearchResponse
  promptResults?: PromptSearchResult[]
  usage?: TextUsage
  pending?: TextToolCall & { parsed: Record<string, unknown>; stepId: string; confirmationAction: AgentConfirmationAction }
  confirmed: boolean
  stepCount: number
  controller: AbortController
  cancelled: boolean
  projectRoot?: string
  status?: AgentRunResult['status']
  skills?: AgentSkillContext[]
  skillCandidates?: AgentSkillCandidate[]
  activeSkillIds?: string[]
  skillsResolved?: boolean
  emit?: (event: AgentStreamEvent) => void
}

const tools: readonly TextToolDefinition[] = [
  { name: 'search_web', description: '联网搜索公开资料。仅在用户需要最新信息或外部事实时调用。', inputSchema: { type: 'object', properties: { query: { type: 'string' }, maxResults: { type: 'integer', minimum: 1, maximum: 20 } }, required: ['query'] } },
  { name: 'search_prompt_library', description: '检索用户自己的、项目内的和已同步的开源提示词。需要视觉方向、成熟提示词或可复用模板时调用。', inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 10 } }, required: ['query'] } },
  { name: 'get_prompt_detail', description: '按提示词 ID 读取完整正文和元数据。', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'read_project_file', description: '读取当前项目内的 Markdown 或纯文本文件。', inputSchema: { type: 'object', properties: { filePath: { type: 'string' }, maxBytes: { type: 'integer', minimum: 1, maximum: 4194304 } }, required: ['filePath'] } },
  { name: 'read_project_memory', description: '按记忆 ID 读取当前项目的稳定设定或约束。', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'read_project_asset_metadata', description: '按素材 ID 读取当前项目素材的分类、类型、大小和项目相对路径。', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'create_project_document', description: '在当前项目 documents/ 目录创建全新文档。仅当没有已知目标文档，或用户明确要求新建、副本、另存为时调用；修改已有文档不得调用。', inputSchema: { type: 'object', properties: { title: { type: 'string' }, content: { type: 'string' }, filename: { type: 'string' }, extension: { type: 'string', enum: ['md', 'txt', 'json'] } }, required: ['title', 'content'] } },
  { name: 'update_project_document', description: '修改当前项目 documents/ 中已有文档的文档名和内容。必须使用上下文工具结果中的已有 relativePath，不得改用新建工具。调用后必须等待用户确认。', inputSchema: { type: 'object', properties: { filePath: { type: 'string' }, title: { type: 'string' }, content: { type: 'string' } }, required: ['filePath', 'title', 'content'] } },
  { name: 'delete_project_document', description: '删除当前项目 documents/ 中的文档。调用后必须等待用户确认。', inputSchema: { type: 'object', properties: { filePath: { type: 'string' } }, required: ['filePath'] } },
  { name: 'create_project_memory', description: '新增当前项目记忆。仅在用户明确要求保存项目规则、偏好或设定时调用。', inputSchema: { type: 'object', properties: { title: { type: 'string' }, content: { type: 'string' }, active: { type: 'boolean' }, source: { type: 'string' } }, required: ['title', 'content'] } },
  { name: 'update_project_memory', description: '覆盖当前项目记忆。调用后必须等待用户确认。', inputSchema: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, content: { type: 'string' }, active: { type: 'boolean' }, source: { type: 'string' } }, required: ['id'] } },
  { name: 'delete_project_memory', description: '删除当前项目记忆。调用后必须等待用户确认。', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'create_personal_prompt', description: '新增全新的用户个人提示词或模板。已知目标提示词 ID 时不得调用；仓库导入提示词只读，不能通过此工具覆盖。', inputSchema: { type: 'object', properties: { name: { type: 'string' }, content: { type: 'string' }, scope: { type: 'string', enum: ['global', 'project'] }, kind: { type: 'string', enum: ['prompt', 'template', 'style'] }, tags: { type: 'array', items: { type: 'string' } }, favorite: { type: 'boolean' }, collection: { type: 'string' }, category: { type: 'string' }, previewUrl: { type: 'string' }, sourceUrl: { type: 'string' } }, required: ['name', 'content'] } },
  { name: 'update_personal_prompt', description: '修改已有用户个人提示词或模板。必须使用上下文工具结果中的已有 id 和 scope，不得改用新建工具。调用后必须等待用户确认；仓库导入提示词只读。', inputSchema: { type: 'object', properties: { id: { type: 'string' }, scope: { type: 'string', enum: ['global', 'project'] }, name: { type: 'string' }, content: { type: 'string' }, kind: { type: 'string', enum: ['prompt', 'template', 'style'] }, tags: { type: 'array', items: { type: 'string' } }, favorite: { type: 'boolean' }, collection: { type: 'string' }, category: { type: 'string' }, previewUrl: { type: 'string' }, sourceUrl: { type: 'string' } }, required: ['id', 'scope'] } },
  { name: 'delete_personal_prompt', description: '删除用户个人提示词或模板。调用后必须等待用户确认；仓库导入提示词只读。', inputSchema: { type: 'object', properties: { id: { type: 'string' }, scope: { type: 'string', enum: ['global', 'project'] } }, required: ['id', 'scope'] } },
  { name: 'activate_skills', description: '从当前授权候选中激活本轮真正需要的 Skill。先说明选择理由；激活后系统才会读取完整指令。', inputSchema: { type: 'object', properties: { skillIds: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 4 }, reason: { type: 'string' } }, required: ['skillIds', 'reason'] } },
  { name: 'run_skill', description: '执行用户已启用且已信任的 Skill 脚本。只能使用已安装 Skill 的相对入口。', inputSchema: { type: 'object', properties: { skillId: { type: 'string' }, entrypoint: { type: 'string' }, args: { type: 'array', items: { type: 'string' } }, timeoutMs: { type: 'integer' }, maxOutputBytes: { type: 'integer' } }, required: ['skillId', 'entrypoint'] } },
  { name: 'create_image_tasks', description: '创建图片生成或参考图修改任务。每个提示词对应一个任务并发提交；执行方式由当前 Agent 模式决定。创建前先为每个任务确定简洁名称。角色外观、服装和画风等共享约束应写入 invariants。修改上一张结果时必须设置 usePreviousImage。', inputSchema: { type: 'object', properties: { prompts: { type: 'array', items: { type: 'object', properties: { title: { type: 'string', description: '4-16 个中文字符或同等长度的任务名称', maxLength: 24 }, prompt: { type: 'string' } }, required: ['title', 'prompt'] }, minItems: 1, maxItems: 16 }, invariants: { type: 'array', items: { type: 'string' }, maxItems: 16 }, mode: { type: 'string', enum: ['smart', 'same'] }, usePreviousImage: { type: 'boolean' } }, required: ['prompts'] } },
  { name: 'control_image_tasks', description: '暂停、恢复、取消或重试图片任务。', inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['pause', 'resume', 'cancel', 'retry'] }, taskIds: { type: 'array', items: { type: 'string' } } }, required: ['action'] } },
]

const imageToolNames = new Set(['create_image_tasks', 'control_image_tasks'])
const agentOnlyToolNames = new Set(['activate_skills'])
const writeToolNames = new Set(['create_project_document', 'update_project_document', 'delete_project_document', 'create_project_memory', 'update_project_memory', 'delete_project_memory', 'create_personal_prompt', 'update_personal_prompt', 'delete_personal_prompt'])
const projectReadToolNames = new Set(['read_project_file', 'read_project_memory', 'read_project_asset_metadata'])
const toolActivityLabels: Record<string, { phase: 'tool' | 'image'; label: string }> = {
  search_web: { phase: 'tool', label: '正在联网检索' },
  search_prompt_library: { phase: 'tool', label: '正在检索提示词库' },
  get_prompt_detail: { phase: 'tool', label: '正在读取提示词详情' },
  read_project_file: { phase: 'tool', label: '正在读取项目资料' },
  read_project_memory: { phase: 'tool', label: '正在读取项目记忆' },
  read_project_asset_metadata: { phase: 'tool', label: '正在读取素材信息' },
  activate_skills: { phase: 'tool', label: '正在选择合适的 Skill' },
  run_skill: { phase: 'tool', label: '正在执行 Skill' },
  create_image_tasks: { phase: 'image', label: '正在提交图片任务' },
  control_image_tasks: { phase: 'image', label: '正在更新图片任务' },
  create_project_document: { phase: 'tool', label: '正在写入项目文档' },
  update_project_document: { phase: 'tool', label: '正在更新项目文档' },
  delete_project_document: { phase: 'tool', label: '正在删除项目文档' },
  create_project_memory: { phase: 'tool', label: '正在写入项目记忆' },
  update_project_memory: { phase: 'tool', label: '正在更新项目记忆' },
  delete_project_memory: { phase: 'tool', label: '正在删除项目记忆' },
  create_personal_prompt: { phase: 'tool', label: '正在保存个人提示词' },
  update_personal_prompt: { phase: 'tool', label: '正在更新个人提示词' },
  delete_personal_prompt: { phase: 'tool', label: '正在删除个人提示词' },
}
const writeToolPermissions = new Map<string, AgentPermission>([
  ['create_project_document', 'write-project-documents'], ['update_project_document', 'write-project-documents'], ['delete_project_document', 'write-project-documents'],
  ['create_project_memory', 'write-project-memories'], ['update_project_memory', 'write-project-memories'], ['delete_project_memory', 'write-project-memories'],
  ['create_personal_prompt', 'write-personal-prompts'], ['update_personal_prompt', 'write-personal-prompts'], ['delete_personal_prompt', 'write-personal-prompts'],
])
const confirmationToolActions = new Map<string, AgentConfirmationAction>([
  ['update_project_document', 'update-project-document'], ['delete_project_document', 'delete-project-document'],
  ['update_project_memory', 'update-project-memory'], ['delete_project_memory', 'delete-project-memory'],
  ['update_personal_prompt', 'update-personal-prompt'], ['delete_personal_prompt', 'delete-personal-prompt'],
])

function confirmationActionForTool(name: string): AgentConfirmationAction {
  return confirmationToolActions.get(name) ?? 'create-image-tasks'
}

function toolsForMode(input: AgentRunInput, imageAvailable: boolean): readonly TextToolDefinition[] {
  const permissions = new Set(input.permissions ?? [])
  const projectContext = input.projectContext ?? input.mode !== 'text'
  return tools.filter((tool) => {
    if (input.mode === 'text' && imageToolNames.has(tool.name)) return false
    if (!imageAvailable && imageToolNames.has(tool.name)) return false
    if (input.mode === 'text' && agentOnlyToolNames.has(tool.name)) return false
    if (input.mode === 'text' && writeToolNames.has(tool.name)) return false
    if (!projectContext && projectReadToolNames.has(tool.name)) return false
    const requiredPermission = writeToolPermissions.get(tool.name)
    if (requiredPermission && !permissions.has(requiredPermission)) return false
    if (input.mode === 'text' && tool.name === 'search_web' && input.search !== true) return false
    return true
  })
}

function validSkillContexts(input: readonly AgentSkillContext[] | undefined): AgentSkillContext[] {
  const contexts = new Map<string, AgentSkillContext>()
  for (const skill of input ?? []) {
    if (!skill?.id?.trim() || !skill.name?.trim() || !skill.displayName?.trim() || !skill.contentHash?.trim() || !skill.instructions?.trim()) continue
    contexts.set(skill.id, { ...skill })
  }
  return [...contexts.values()]
}

function mergeSkillContexts(previous: readonly AgentSkillContext[], current: readonly AgentSkillContext[], messageId?: string): AgentSkillContext[] {
  const merged = new Map(previous.map((skill) => [skill.id, skill]))
  for (const skill of current) {
    merged.set(skill.id, {
      ...skill,
      ...(messageId ? { activatedAtMessageId: messageId } : {}),
    })
  }
  return [...merged.values()]
}

function text(value: unknown, field: string, max = 4_000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${field}无效`)
  return value.trim()
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('工具参数必须是对象')
  return value as Record<string, unknown>
}

function json(value: unknown): string {
  const serialized = JSON.stringify(value)
  return serialized.length > MAX_TOOL_OUTPUT ? `${serialized.slice(0, MAX_TOOL_OUTPUT)}…` : serialized
}

function parseArguments(call: TextToolCall): Record<string, unknown> {
  try { return object(JSON.parse(call.arguments || '{}')) } catch { throw new Error(`工具 ${call.name} 参数不是有效 JSON`) }
}

function boundedSteps(value: number | undefined): number {
  const candidate = value ?? DEFAULT_MAX_STEPS
  if (!Number.isInteger(candidate) || candidate < 1 || candidate > MAX_STEPS) throw new Error(`Agent 最大步骤需要是 1-${MAX_STEPS} 的整数`)
  return candidate
}

function cancelledError(): Error {
  return Object.assign(new Error('Agent 执行已取消'), { code: 'cancelled' })
}

function isCancelled(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === 'cancelled')
}

function step(name: string, kind: AgentStep['kind'], input?: Record<string, unknown>): AgentStep {
  return { id: randomUUID(), kind, name, status: 'running', ...(input ? { input } : {}), startedAt: new Date().toISOString() }
}

function finish(current: AgentStep, status: AgentStep['status'], output?: unknown, error?: string): AgentStep {
  return { ...current, status, ...(output === undefined ? {} : { output }), ...(error ? { error } : {}), finishedAt: new Date().toISOString() }
}

function appendAssistant(session: AgentSession, result: TextGenerationResult): void {
  session.messages.push({ role: 'assistant', content: result.text, ...(result.toolCalls.length ? { toolCalls: result.toolCalls } : {}) })
  if (!result.toolCalls.length && result.text.trim()) session.text = result.text.trim()
  if (result.usage) {
    const previous = session.usage ?? {}
    const contextTokens = result.usage.contextTokens
      ?? result.usage.totalTokens
      ?? ((result.usage.inputTokens ?? 0) + (result.usage.outputTokens ?? 0))
    session.usage = {
      inputTokens: (previous.inputTokens ?? 0) + (result.usage.inputTokens ?? 0),
      outputTokens: (previous.outputTokens ?? 0) + (result.usage.outputTokens ?? 0),
      totalTokens: (previous.totalTokens ?? 0) + (result.usage.totalTokens ?? 0),
      reasoningTokens: (previous.reasoningTokens ?? 0) + (result.usage.reasoningTokens ?? 0),
      contextTokens,
    }
  }
}

function attachmentMessage(documents: readonly ProjectContextDocument[]): TextMessage | null {
  if (!documents.length) return null
  const headers = documents.map((document) => `附件：${document.summary.fileName}\n`)
  const separatorLength = Math.max(0, documents.length - 1) * 2
  const bodyBudget = Math.max(0, MAX_ATTACHMENT_CONTEXT_TOKENS - headers.reduce((total, header) => total + textTokenUpperBound(header), separatorLength))
  const perDocumentBudget = Math.floor(bodyBudget / documents.length)
  const content = documents.map((document, index) => `${headers[index]}${attachmentExcerpt(document.text, perDocumentBudget)}`).join('\n\n')
  return { role: 'system', content: `用户已为本轮明确上传以下附件，请将其作为可信的任务上下文：\n\n${content}` }
}

function attachmentExcerpt(value: string, maxTokens: number): string {
  if (textTokenUpperBound(value) <= maxTokens) return value
  const marker = '\n\n...[内容过长，已省略中间部分；保留开头和结尾。需要完整分析时请拆分文件后重新上传]...\n\n'
  const contentBudget = Math.max(0, maxTokens - textTokenUpperBound(marker))
  const headBudget = Math.floor(contentBudget * 0.6)
  const tailBudget = contentBudget - headBudget
  let headLow = 0
  let headHigh = value.length
  while (headLow < headHigh) {
    const middle = Math.ceil((headLow + headHigh) / 2)
    if (textTokenUpperBound(value.slice(0, middle)) <= headBudget) headLow = middle
    else headHigh = middle - 1
  }
  let tailLow = headLow
  let tailHigh = value.length
  while (tailLow < tailHigh) {
    const middle = Math.floor((tailLow + tailHigh) / 2)
    if (textTokenUpperBound(value.slice(middle)) <= tailBudget) tailHigh = middle
    else tailLow = middle + 1
  }
  const headEnd = headLow
  const tailStart = tailLow
  return `${value.slice(0, headEnd).trimEnd()}${marker}${value.slice(tailStart).trimStart()}`
}

function promptEntries(input: Record<string, unknown>): Array<{ title: string; prompt: string }> {
  if (!Array.isArray(input.prompts) || input.prompts.length < 1 || input.prompts.length > MAX_PROMPTS) throw new Error(`图片任务数量需要是 1-${MAX_PROMPTS} 个`)
  const entries = input.prompts.map((value, index) => {
    const item = object(value)
    return { title: text(item.title, `第 ${index + 1} 个任务名称`, 24), prompt: text(item.prompt, `第 ${index + 1} 个提示词`, 20_000) }
  })
  if (input.mode !== 'same') {
    const unique = new Set(entries.map((item) => item.prompt.replace(/\s+/g, ' ').toLocaleLowerCase()))
    if (unique.size !== entries.length) throw new Error('智能图片任务不能使用重复提示词，请明确设置 mode 为 same')
  }
  return entries
}

export class AgentRunner {
  private readonly sessions = new Map<string, AgentSession>()
  private readonly persistenceWrites = new Map<string, Promise<void>>()
  private readonly persistenceErrors = new Map<string, unknown>()
  private readonly restoring: Promise<void>

  constructor(private readonly deps: AgentRunnerDependencies) {
    this.restoring = this.restore(this.deps.getProjectRoot?.())
  }

  private async ready(): Promise<void> { await this.restoring }

  private async restore(projectRoot: string | undefined): Promise<void> {
    if (!projectRoot || !this.deps.persistence) return
    for (const snapshot of await this.deps.persistence.load(projectRoot)) {
      this.sessions.set(snapshot.id, { ...snapshot, ...(snapshot.pending ? { pending: { ...snapshot.pending, confirmationAction: snapshot.pending.confirmationAction ?? confirmationActionForTool(snapshot.pending.name) } } : {}), controller: new AbortController() })
    }
  }

  async run(input: AgentRunInput, emit?: (event: AgentStreamEvent) => void): Promise<AgentRunResult> {
    await this.ready()
    const modelProfileId = text(input.modelProfileId, '文本模型配置标识')
    const prompt = text(input.prompt, 'Agent 目标', 20_000)
    const id = input.runId ? text(input.runId, 'Agent 运行标识', 120) : randomUUID()
    if (this.sessions.has(id)) throw new Error('Agent 运行标识已存在')
    const contextMessages = (input.contextMessages ?? []).filter((message) => typeof message.content === 'string' && message.content.trim())
    const uploadedAttachments = (input.attachments ?? []).slice(0, 8)
    const uploadedContext = attachmentMessage(uploadedAttachments)
    const requestedReferences = (input.references ?? []).slice(0, 8)
    const imageParts = requestedReferences.length ? await this.deps.readImageReferences?.(requestedReferences) ?? [] : []
    const userContent = imageParts.length ? [{ type: 'text' as const, text: prompt }, ...imageParts] : prompt
    const session: AgentSession = { id, input: { ...input, runId: id, modelProfileId, prompt, ...(input.maxSteps === undefined ? {} : { maxSteps: boundedSteps(input.maxSteps) }) }, messages: [...contextMessages, ...(uploadedContext ? [uploadedContext] : []), { role: 'user', content: userContent }], steps: [], text: '', imageTasks: [], documents: [...uploadedAttachments], confirmed: false, stepCount: 0, controller: new AbortController(), cancelled: false, projectRoot: this.deps.getProjectRoot?.(), skills: validSkillContexts(input.skillContexts), ...(emit ? { emit } : {}) }
    this.sessions.set(session.id, session)
    return this.loop(session)
  }

  async cancel(runId: string): Promise<AgentRunResult> {
    await this.ready()
    const session = this.sessions.get(text(runId, '运行标识'))
    if (!session) throw new Error('Agent 运行不存在或已过期')
    if (session.cancelled) return this.result(session, 'cancelled')
    const running = session.steps.some((item) => item.status === 'running')
    if (!session.pending && !running) return this.result(session, session.text ? 'completed' : 'failed')
    session.cancelled = true
    session.pending = undefined
    session.controller.abort()
    await Promise.all(session.imageTasks.map((task) => this.deps.image?.cancel(task.id).catch(() => false)))
    for (let index = 0; index < session.steps.length; index += 1) {
      if (session.steps[index]?.status === 'running' || session.steps[index]?.status === 'awaiting-confirmation') {
        session.steps[index] = finish(session.steps[index] as AgentStep, 'cancelled', undefined, 'Agent 执行已取消')
      }
    }
    return this.result(session, 'cancelled')
  }

  dispose(): void {
    this.cancelAll()
    this.sessions.clear()
  }

  async switchProject(projectRoot: string | undefined): Promise<void> {
    await this.ready()
    this.cancelAll()
    await this.flushPersistence()
    this.sessions.clear()
    this.persistenceWrites.clear()
    this.persistenceErrors.clear()
    await this.restore(projectRoot)
  }

  async flushPersistence(): Promise<void> {
    for (const sessionId of this.persistenceErrors.keys()) {
      const session = this.sessions.get(sessionId)
      if (session?.projectRoot) this.persist(session, session.status ?? (session.pending ? 'awaiting-confirmation' : session.cancelled ? 'cancelled' : 'completed'))
    }
    while (true) {
      const pending = [...this.persistenceWrites.entries()]
      await Promise.allSettled(pending.map(([, write]) => write))
      if (pending.length === this.persistenceWrites.size && pending.every(([sessionId, write]) => this.persistenceWrites.get(sessionId) === write)) break
    }
    const failure = this.persistenceErrors.values().next().value
    if (failure !== undefined) throw failure
  }

  async list(): Promise<AgentRunResult[]> {
    await this.ready()
    return [...this.sessions.values()].map((session) => this.result(session, session.status ?? (session.pending ? 'awaiting-confirmation' : session.cancelled ? 'cancelled' : 'completed'), false))
  }

  cancelAll(): void {
    for (const session of this.sessions.values()) {
      if (!session.cancelled) {
        session.cancelled = true
        session.pending = undefined
        session.controller.abort()
        for (let index = 0; index < session.steps.length; index += 1) {
          const current = session.steps[index]
          if (current?.status === 'running' || current?.status === 'awaiting-confirmation') session.steps[index] = finish(current, 'cancelled', undefined, '项目已切换，Agent 执行已取消')
        }
        this.persist(session, 'cancelled')
      }
      void Promise.all(session.imageTasks.map((task) => this.deps.image?.cancel(task.id).catch(() => false)))
    }
  }

  async confirm(runId: string): Promise<AgentRunResult> {
    await this.ready()
    const session = this.sessions.get(text(runId, '运行标识'))
    if (!session) throw new Error('Agent 运行不存在或已过期')
    if (session.cancelled) return this.result(session, 'cancelled')
    if (!session.pending) return this.result(session, session.text ? 'completed' : 'failed')
    const pending = session.pending
    session.pending = undefined
    session.confirmed = true
    const activity = toolActivityLabels[pending.name]
    if (activity) session.emit?.({ type: 'activity', ...activity })
    const output = await this.executeTool(session, pending, pending.parsed, pending.stepId, true)
    session.confirmed = false
    const stepIndex = session.steps.findIndex((item) => item.id === pending.stepId)
    if (stepIndex >= 0) session.steps[stepIndex] = output.step
    session.messages.push({ role: 'tool', toolCallId: pending.id, name: pending.name, content: output.content })
    return this.loop(session)
  }

  private async loop(session: AgentSession): Promise<AgentRunResult> {
    const maxSteps = boundedSteps(session.input.maxSteps)
    if (!session.skillsResolved) {
      const mode = session.input.mode ?? 'agent'
      const resolvedSkills = session.input.skillId
        ? await this.deps.resolveSkills?.(session.input.prompt, session.input.skillId, mode) ?? []
        : []
      session.skills = mergeSkillContexts(session.skills ?? [], resolvedSkills, session.input.messageId)
      session.activeSkillIds = resolvedSkills.map((skill) => skill.id)
      session.skillCandidates = mode === 'agent'
        ? await this.deps.listSkillCandidates?.(mode) ?? []
        : []
      session.skillsResolved = true
    }
    const explicitImageCount = resolveAgentImageCount(session.input.prompt, 0)
    const requestedImageCount = explicitImageCount || session.input.imageCount || 0
    const imageCountContext = explicitImageCount > 0
      ? `\n\n用户明确要求生成 ${explicitImageCount} 张图片，create_image_tasks 必须严格包含 ${explicitImageCount} 个 prompts，不得受界面默认数量影响。`
      : requestedImageCount > 0
        ? session.input.previousImageReferences?.length
          ? `\n\n界面批量数量为 ${requestedImageCount} 张，只适用于新的图片创作。修改上一张且用户未明确数量时，只创建 1 个图片任务；只有新创作时才创建 ${requestedImageCount} 个 prompts。`
          : `\n\n界面设置要求生成 ${requestedImageCount} 张图片；用户未指定数量时，create_image_tasks 必须包含 ${requestedImageCount} 个 prompts。`
        : ''
    const previousImageContext = session.input.previousImageReferences?.length
      ? '\n\n当前会话有一张可用的上一张生成结果。只有当用户是在修改、调整或延续这张图时，才在 create_image_tasks 中设置 usePreviousImage=true；新创作不得设置。'
      : '\n\n当前没有可用的上一张生成结果，不得设置 usePreviousImage。'
    while (session.stepCount < maxSteps) {
      this.assertActive(session)
      session.stepCount += 1
      const modelStep = step('文本模型', 'model')
      session.steps.push(modelStep)
      try {
        session.emit?.({
          type: 'activity',
          phase: 'thinking',
          label: session.stepCount === 1 ? '正在理解你的要求' : '正在整理执行结果',
        })
        const isTextMode = session.input.mode === 'text'
        const activeSkillIds = new Set(session.activeSkillIds ?? [])
        const activeSkills = (session.skills ?? []).filter((skill) => activeSkillIds.has(skill.id))
        const historicalSkills = (session.skills ?? []).filter((skill) => !activeSkillIds.has(skill.id))
        const skillContext = activeSkills.length > 0
          ? `\n\n【当前轮已激活的 Skills】\n${activeSkills.map((skill) => `- Skill ID: ${skill.id}\n  名称: ${skill.displayName} (@${skill.name})\n  用途: ${skill.description ?? '未填写'}\n  指令:\n${skill.instructions.slice(0, 6_000)}`).join('\n\n')}`
          : '\n\n当前轮没有激活 Skill，不要伪造 Skill 调用。'
        const historicalSkillContext = historicalSkills.length > 0
          ? `\n\n【本会话历史 Skill 快照】\n以下内容只用于理解此前对话，不代表当前轮已选择或允许再次执行脚本：\n${historicalSkills.map((skill) => `- ${skill.displayName} (@${skill.name})\n${skill.instructions.slice(0, 6_000)}`).join('\n\n')}`
          : ''
        const skillCandidateContext = !isTextMode && session.skillCandidates?.length
          ? `\n\n【可按需激活的 Skill 候选】\n这里只提供路由元数据，不是完整指令。确有需要时先调用 activate_skills，并记录具体选择理由；不需要 Skill 时直接处理任务。\n${session.skillCandidates.map((skill) => `- ID: ${skill.id}\n  名称: ${skill.displayName} (@${skill.name})\n  用途: ${(skill.description ?? '未填写').slice(0, 400)}`).join('\n')}`
          : ''
        const baseSystem = isTextMode
          ? `你是 Latent Studio 的文本助手。根据用户目标回答，可以读取用户明确提供的附件和参考图，并按需要调用已授权 Skill。${session.input.search ? '用户已开启联网搜索，当问题依赖外部或最新信息时调用搜索。' : '当前未开启联网搜索，不得声称已查询最新网络信息。'}文本模式不能创建或控制图片任务。调用工具时只返回工具调用，不要伪造工具结果。`
          : '你是 Latent Studio 的执行型 Agent。根据用户目标自主决定是否需要联网搜索、检索提示词库、读取项目文件、调用 Skill 或创建图片任务。只能使用下方候选 Skill，不需要时不得强行调用。修改对话中已经创建或更新的文档、提示词时，必须从历史工具结果取得 relativePath 或 id+scope 并调用对应 update 工具；只有用户明确要求新建、副本或另存为时才能再次调用 create 工具。目标不明确时先追问，不得猜测后新建。每次只调用必要工具；创建任务前先确定简洁的任务名称，每个 title 使用 4-16 个中文字符或同等长度的短语，不得复制完整提示词或携带尺寸参数。图片 prompt 必须是可直接执行的画面描述，明确主体、场景、构图、光线和风格；尺寸、质量和格式只能通过请求参数传递，不要写成提示词伪参数。提示词卡片是检索内容的唯一事实源；正文应保留推荐理由、适用场景和结果差异，不要重复或另造提示词正文。用户说“第一个”或“第 1 个”时，指最近一次检索结果中的 #1；要求直接使用时原样调用对应提示词；给出改写要求并要求生成时，按要求改写后调用 create_image_tasks；只说“改写第一个”但缺少改写要求时，必须先追问具体改写目标。调用工具时只返回工具调用，不要伪造工具结果。'
        const availableTools = toolsForMode(session.input, Boolean(this.deps.image))
        const fittedContext = fitTextModelContext(
          baseSystem + skillContext + historicalSkillContext + skillCandidateContext + (isTextMode ? '' : imageCountContext + previousImageContext) + (session.input.memoryContext ? `\n\n${session.input.memoryContext}` : ''),
          session.messages,
          availableTools,
        )
        const modelInput = {
          modelProfileId: session.input.modelProfileId,
          request: {
            system: fittedContext.system,
            messages: fittedContext.messages,
            tools: availableTools,
            maxTokens: 5_000,
            includeUsage: true,
            ...(session.input.reasoningEffort ? { reasoningEffort: session.input.reasoningEffort } : {}),
            ...(session.input.officialCompactionItems?.length ? { officialCompactionItems: session.input.officialCompactionItems } : {}),
          },
          signal: session.controller.signal,
        }
        const generated = this.deps.generateStream
          ? await this.deps.generateStream(modelInput, (event) => session.emit?.(event))
          : await this.deps.generate(modelInput)
        this.assertActive(session)
        session.steps[session.steps.length - 1] = finish(modelStep, 'completed', { text: generated.text, toolCalls: generated.toolCalls.map((call) => call.name) })
        appendAssistant(session, generated)
        if (!generated.toolCalls.length) {
          session.steps.push(finish(step('完成', 'final'), 'completed', generated.text))
          return this.result(session, 'completed')
        }
        if (generated.text.trim() && generated.toolCalls.some((call) => call.name === 'search_prompt_library')) {
          session.emit?.({ type: 'text_reset' })
        }
        for (const call of generated.toolCalls) {
          const parsed = parseArguments(call)
          const confirmationAction = confirmationToolActions.get(call.name)
          const needsConfirmation = (call.name === 'create_image_tasks' && session.input.requireConfirmation !== false) || Boolean(confirmationAction)
          const toolStep = step(call.name, needsConfirmation && !session.confirmed ? 'confirmation' : 'tool', parsed)
          session.steps.push(toolStep)
          if (needsConfirmation && !session.confirmed) {
            const pending = { ...call, parsed, stepId: toolStep.id, confirmationAction: confirmationAction ?? 'create-image-tasks' as const }
            session.pending = pending
            session.steps[session.steps.length - 1] = finish(toolStep, 'awaiting-confirmation', parsed)
            return this.result(session, 'awaiting-confirmation')
          }
          const activity = toolActivityLabels[call.name]
          if (activity) session.emit?.({ type: 'activity', ...activity })
          const output = await this.executeTool(session, call, parsed, toolStep.id, false)
          this.assertActive(session)
          session.steps[session.steps.length - 1] = output.step
          session.messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: output.content })
        }
      } catch (error) {
        if (session.cancelled || isCancelled(error)) return this.result(session, 'cancelled')
        const message = error instanceof Error ? error.message : 'Agent 执行失败'
        session.steps[session.steps.length - 1] = finish(modelStep, 'failed', undefined, message)
        session.text = session.text || message
        return this.result(session, 'failed')
      }
    }
    session.steps.push(finish(step('达到步骤上限', 'final'), 'failed', undefined, 'Agent 达到最大步骤数'))
    return this.result(session, 'failed')
  }

  private async executeTool(session: AgentSession, call: TextToolCall, parsed: Record<string, unknown>, stepId: string, confirmed: boolean): Promise<{ content: string; step: AgentStep }> {
    const current = session.steps.find((item) => item.id === stepId) ?? step(call.name, 'tool', parsed)
    try {
      if (session.input.mode === 'text' && (imageToolNames.has(call.name) || agentOnlyToolNames.has(call.name))) throw new Error('文本模式不允许自动激活 Skill 或执行生图工具')
      if (projectReadToolNames.has(call.name) && !(session.input.projectContext ?? session.input.mode !== 'text')) throw new Error('当前轮未关联项目上下文')
      const requiredPermission = writeToolPermissions.get(call.name)
      if (requiredPermission && !session.input.permissions?.includes(requiredPermission)) throw new Error('当前轮未获得该写入操作的授权')
      let output: unknown
      if (call.name === 'search_web') {
        this.assertActive(session)
        output = await this.deps.search({ query: text(parsed.query, '搜索关键词', 500), ...(typeof parsed.maxResults === 'number' ? { maxResults: parsed.maxResults } : {}), signal: session.controller.signal })
        session.searchResults = output as SearchResponse
      } else if (call.name === 'search_prompt_library') {
        if (!this.deps.searchPrompts && !this.deps.searchPromptLibrary) throw new Error('提示词库检索尚未初始化')
        const limit = typeof parsed.limit === 'number' && Number.isInteger(parsed.limit) ? Math.min(10, Math.max(1, parsed.limit)) : 5
        const query = text(parsed.query, '提示词检索关键词', 500)
        if (this.deps.searchPromptLibrary) {
          session.promptResults = (await this.deps.searchPromptLibrary({ query, limit })).slice(0, 4)
        } else {
          const prompts = await this.deps.searchPrompts!({ query, limit })
          session.promptResults = prompts.slice(0, 4).map((item, index) => ({
          id: item.id,
          title: item.name,
          content: item.content,
          category: item.category || '其他',
          type: item.kind || 'prompt',
          collection: item.collection || '个人',
          ...(item.previewUrl ? { thumbnailUrl: item.previewUrl } : {}),
          ...(item.sourceUrl ? { sourceUrl: item.sourceUrl } : {}),
          score: Math.max(0, 1 - index * 0.12),
          reason: index === 0 ? `与“${query}”最匹配` : `与“${query}”相关的第 ${index + 1} 个结果`,
          retrievalMode: 'lexical' as const,
          ...(item.source === 'import' ? { fallbackReason: '本地向量模型尚未启用，当前使用关键词检索' } : {}),
          }))
        }
        output = session.promptResults
      } else if (call.name === 'get_prompt_detail') {
        if (!this.deps.getPromptDetail) throw new Error('提示词详情读取尚未初始化')
        output = await this.deps.getPromptDetail({ id: text(parsed.id, '提示词标识', 200) })
        if (!output) throw new Error('提示词不存在')
      } else if (call.name === 'read_project_file') {
        this.assertActive(session)
        output = await this.deps.readFile({ filePath: text(parsed.filePath, '项目文件路径', 1_000), ...(typeof parsed.maxBytes === 'number' ? { maxBytes: parsed.maxBytes } : {}), signal: session.controller.signal })
        session.documents.push(output as ProjectContextDocument)
      } else if (call.name === 'read_project_memory') {
        if (!this.deps.readProjectMemory) throw new Error('项目记忆读取尚未初始化')
        output = await this.deps.readProjectMemory({ id: text(parsed.id, '记忆标识', 200) })
        if (!output) throw new Error('项目记忆不存在')
      } else if (call.name === 'read_project_asset_metadata') {
        if (!this.deps.readProjectAssetMetadata) throw new Error('项目素材读取尚未初始化')
        output = await this.deps.readProjectAssetMetadata({ id: text(parsed.id, '素材标识', 200) })
        if (!output) throw new Error('项目素材不存在')
      } else if (call.name === 'activate_skills') {
        if (!Array.isArray(parsed.skillIds) || parsed.skillIds.length < 1 || parsed.skillIds.length > 4) throw new Error('Skill 激活数量需要是 1-4 个')
        const reason = text(parsed.reason, 'Skill 选择理由', 2_000)
        const requestedIds = [...new Set(parsed.skillIds.map((value) => text(value, 'Skill 标识', 200)))]
        const candidates = new Map((session.skillCandidates ?? []).map((skill) => [skill.id, skill]))
        const invalid = requestedIds.find((id) => !candidates.has(id))
        if (invalid) throw new Error(`Skill ${invalid} 不在当前授权候选列表`)
        const activeIds = new Set(session.activeSkillIds ?? [])
        const newlyRequested = requestedIds.filter((id) => !activeIds.has(id))
        const resolved = (await Promise.all(newlyRequested.map((id) => this.deps.resolveSkills?.(session.input.prompt, id, 'agent') ?? []))).flat()
        const resolvedIds = new Set(resolved.map((skill) => skill.id))
        const unresolved = newlyRequested.find((id) => !resolvedIds.has(id))
        if (unresolved) throw new Error(`Skill ${unresolved} 的完整指令不可读取`)
        session.skills = mergeSkillContexts(session.skills ?? [], resolved, session.input.messageId)
        session.activeSkillIds = [...activeIds, ...resolved.map((skill) => skill.id)]
        output = { reason, activated: requestedIds.map((id) => candidates.get(id)) }
      } else if (call.name === 'run_skill') {
        this.assertActive(session)
        const requestedSkillId = text(parsed.skillId, 'Skill 标识')
        const activeSkill = (session.skills ?? []).find((skill) => (skill.id === requestedSkillId || skill.name === requestedSkillId) && session.activeSkillIds?.includes(skill.id))
        if (!activeSkill) throw new Error('该 Skill 本轮未激活，不能执行脚本')
        output = await this.deps.runSkill({ skillId: activeSkill.id, entrypoint: text(parsed.entrypoint, 'Skill 入口', 500), ...(Array.isArray(parsed.args) ? { args: parsed.args.map((value) => text(value, 'Skill 参数', 4_096)) } : {}), ...(typeof parsed.timeoutMs === 'number' ? { timeoutMs: parsed.timeoutMs } : {}), ...(typeof parsed.maxOutputBytes === 'number' ? { maxOutputBytes: parsed.maxOutputBytes } : {}), signal: session.controller.signal })
        this.assertActive(session)
      } else if (call.name === 'create_project_document') {
        if (!this.deps.writeProjectDocument) throw new Error('项目文档写入尚未初始化')
        output = await this.deps.writeProjectDocument({ title: text(parsed.title, '文档标题', 200), content: text(parsed.content, '文档内容', 200_000), ...(typeof parsed.filename === 'string' ? { filename: text(parsed.filename, '文件名', 240) } : {}), ...(typeof parsed.extension === 'string' ? { extension: text(parsed.extension, '文件扩展名', 12) } : {}) })
      } else if (call.name === 'update_project_document') {
        if (!confirmed && confirmationToolActions.has(call.name)) throw new Error('更新项目文档需要用户确认')
        if (!this.deps.updateProjectDocument) throw new Error('项目文档写入尚未初始化')
        output = await this.deps.updateProjectDocument({ filePath: text(parsed.filePath, '文档路径', 1_000), title: text(parsed.title, '文档标题', 200), content: text(parsed.content, '文档内容', 200_000) })
      } else if (call.name === 'delete_project_document') {
        if (!confirmed) throw new Error('删除项目文档需要用户确认')
        if (!this.deps.deleteProjectDocument) throw new Error('项目文档删除尚未初始化')
        await this.deps.deleteProjectDocument({ filePath: text(parsed.filePath, '文档路径', 1_000) })
        output = { deleted: true }
      } else if (call.name === 'create_project_memory') {
        if (!this.deps.createProjectMemory) throw new Error('项目记忆写入尚未初始化')
        output = await this.deps.createProjectMemory({ title: text(parsed.title, '记忆标题', 200), content: text(parsed.content, '记忆内容', 200_000), ...(typeof parsed.active === 'boolean' ? { active: parsed.active } : {}), ...(typeof parsed.source === 'string' ? { source: text(parsed.source, '记忆来源', 500) } : {}) })
      } else if (call.name === 'update_project_memory') {
        if (!confirmed) throw new Error('更新项目记忆需要用户确认')
        if (!this.deps.updateProjectMemory) throw new Error('项目记忆写入尚未初始化')
        output = await this.deps.updateProjectMemory({ id: text(parsed.id, '记忆标识', 200), ...(typeof parsed.title === 'string' ? { title: text(parsed.title, '记忆标题', 200) } : {}), ...(typeof parsed.content === 'string' ? { content: text(parsed.content, '记忆内容', 200_000) } : {}), ...(typeof parsed.active === 'boolean' ? { active: parsed.active } : {}), ...(typeof parsed.source === 'string' ? { source: text(parsed.source, '记忆来源', 500) } : {}) })
      } else if (call.name === 'delete_project_memory') {
        if (!confirmed) throw new Error('删除项目记忆需要用户确认')
        if (!this.deps.deleteProjectMemory) throw new Error('项目记忆删除尚未初始化')
        await this.deps.deleteProjectMemory({ id: text(parsed.id, '记忆标识', 200) })
        output = { deleted: true }
      } else if (call.name === 'create_personal_prompt') {
        if (!this.deps.createPersonalPrompt) throw new Error('个人提示词写入尚未初始化')
        output = await this.deps.createPersonalPrompt({ name: text(parsed.name, '提示词名称', 200), content: text(parsed.content, '提示词内容', 200_000), scope: parsed.scope === 'project' ? 'project' : 'global', ...(parsed.kind === 'template' || parsed.kind === 'style' || parsed.kind === 'prompt' ? { kind: parsed.kind } : {}), ...(Array.isArray(parsed.tags) ? { tags: parsed.tags.map((value) => text(value, '提示词标签', 120)) } : {}), ...(typeof parsed.favorite === 'boolean' ? { favorite: parsed.favorite } : {}), ...(typeof parsed.collection === 'string' ? { collection: text(parsed.collection, '提示词分组', 120) } : {}), ...(typeof parsed.category === 'string' ? { category: text(parsed.category, '提示词分类', 120) } : {}), ...(typeof parsed.previewUrl === 'string' ? { previewUrl: text(parsed.previewUrl, '预览地址', 2_000) } : {}), ...(typeof parsed.sourceUrl === 'string' ? { sourceUrl: text(parsed.sourceUrl, '来源地址', 2_000) } : {}) })
      } else if (call.name === 'update_personal_prompt') {
        if (!confirmed) throw new Error('更新个人提示词需要用户确认')
        if (!this.deps.updatePersonalPrompt) throw new Error('个人提示词写入尚未初始化')
        output = await this.deps.updatePersonalPrompt({ id: text(parsed.id, '提示词标识', 200), scope: parsed.scope === 'project' ? 'project' : 'global', ...(typeof parsed.name === 'string' ? { name: text(parsed.name, '提示词名称', 200) } : {}), ...(typeof parsed.content === 'string' ? { content: text(parsed.content, '提示词内容', 200_000) } : {}), ...(parsed.kind === 'template' || parsed.kind === 'style' || parsed.kind === 'prompt' ? { kind: parsed.kind } : {}), ...(Array.isArray(parsed.tags) ? { tags: parsed.tags.map((value) => text(value, '提示词标签', 120)) } : {}), ...(typeof parsed.favorite === 'boolean' ? { favorite: parsed.favorite } : {}), ...(typeof parsed.collection === 'string' ? { collection: text(parsed.collection, '提示词分组', 120) } : {}), ...(typeof parsed.category === 'string' ? { category: text(parsed.category, '提示词分类', 120) } : {}) })
      } else if (call.name === 'delete_personal_prompt') {
        if (!confirmed) throw new Error('删除个人提示词需要用户确认')
        if (!this.deps.deletePersonalPrompt) throw new Error('个人提示词删除尚未初始化')
        await this.deps.deletePersonalPrompt({ id: text(parsed.id, '提示词标识', 200), scope: parsed.scope === 'project' ? 'project' : 'global' })
        output = { deleted: true }
      } else if (call.name === 'create_image_tasks') {
        const image = this.deps.image
        if (!image) throw new Error('图片生成服务尚未初始化')
        if (!confirmed && session.input.requireConfirmation !== false) throw new Error('创建图片任务需要用户确认')
        const modelProfileId = text(session.input.imageModelProfileId, '图片模型配置标识')
        const entries = promptEntries(parsed)
        const explicitCount = resolveAgentImageCount(session.input.prompt, 0)
        const editsPreviousImage = parsed.usePreviousImage === true && Boolean(session.input.previousImageReferences?.length)
        const requestedCount = explicitCount || (editsPreviousImage ? 1 : session.input.imageCount || 0)
        if (requestedCount > 0 && entries.length !== requestedCount) throw new Error(`用户要求 ${requestedCount} 张图片，但 Agent 规划了 ${entries.length} 个任务，请重新规划`)
        const references = [
          ...(session.input.references ?? []),
          ...(parsed.usePreviousImage === true ? session.input.previousImageReferences ?? [] : []),
        ]
        const capabilities = this.deps.getImageModelCapabilities?.(modelProfileId)
        const capabilityError = capabilities ? referenceCapabilityError(capabilities, references.length) : null
        if (capabilityError) throw new Error(capabilityError)
        const size = session.input.imageRequest?.size || '1024x1024'
        const quality = session.input.imageRequest?.quality || 'auto'
        const outputFormat = session.input.imageRequest?.outputFormat
        const background = session.input.imageRequest?.background
        const outputSize = session.input.imageRequest?.outputSize
        const invariants = Array.isArray(parsed.invariants) ? parsed.invariants.slice(0, 16).map((value) => text(value, '图片共享约束', 2_000)) : []
        this.assertActive(session)
        const tasks = await Promise.all(entries.map((entry) => image.enqueue({ modelProfileId, title: entry.title, maxRetries: 2, request: { prompt: buildImageTaskPrompt(entry.prompt, invariants, session.input.memoryContext), size, quality, ...(background ? { background } : {}), ...(outputSize ? { outputSize } : {}), ...(outputFormat ? { outputFormat } : {}), ...(references.length ? { references } : {}) } })))
        session.imageTasks.push(...tasks)
        this.assertActive(session)
        output = tasks
      } else if (call.name === 'control_image_tasks') {
        output = await this.controlTasks(parsed)
      } else {
        throw new Error(`未知 Agent 工具：${call.name}`)
      }
      return { content: json(output), step: finish(current, 'completed', output) }
    } catch (error) {
      const message = error instanceof Error ? error.message : '工具执行失败'
      return { content: json({ error: message }), step: finish(current, 'failed', undefined, message) }
    }
  }

  private async controlTasks(parsed: Record<string, unknown>): Promise<unknown> {
    const image = this.deps.image
    if (!image) throw new Error('图片生成服务尚未初始化')
    const action = parsed.action
    const ids = Array.isArray(parsed.taskIds) ? parsed.taskIds.map((value) => text(value, '任务标识', 200)) : []
    if (action === 'pause') { await image.pause(); return { action, paused: true } }
    if (action === 'resume') { await image.resume(); return { action, resumed: true } }
    if (!['cancel', 'retry'].includes(String(action)) || !ids.length) throw new Error('取消或重试需要任务标识')
    const results = await Promise.all(ids.map((id) => action === 'cancel' ? image.cancel(id) : image.retry(id)))
    return { action, results }
  }

  private result(session: AgentSession, status: AgentRunResult['status'], persist = true): AgentRunResult {
    session.status = status
    if (persist) this.persist(session, status)
    return { runId: session.id, status, text: session.text, steps: session.steps.map((item) => ({ ...item })), ...(session.pending ? { pendingConfirmation: { action: session.pending.confirmationAction, toolName: session.pending.name, input: session.pending.parsed } } : {}), ...(session.imageTasks.length ? { imageTasks: [...session.imageTasks] } : {}), ...(session.searchResults ? { searchResults: session.searchResults } : {}), ...(session.promptResults?.length ? { promptResults: session.promptResults.map((item) => ({ ...item })) } : {}), ...(session.documents.length ? { documents: [...session.documents] } : {}), ...(session.skills?.length ? { skillContexts: session.skills.map((skill) => ({ ...skill })) } : {}), ...(session.usage ? { usage: { ...session.usage } } : {}) }
  }

  private persist(session: AgentSession, status: AgentRunResult['status']): void {
    if (!this.deps.persistence || !session.projectRoot) return
    const snapshot = this.snapshot(session, status)
    const previous = this.persistenceWrites.get(session.id) ?? Promise.resolve()
    const write = previous.then(
      () => this.deps.persistence?.save(snapshot),
      () => this.deps.persistence?.save(snapshot),
    ).then(() => {
      this.persistenceErrors.delete(session.id)
    }, (error: unknown) => {
      this.persistenceErrors.set(session.id, error)
      throw error
    })
    this.persistenceWrites.set(session.id, write)
    void write.catch(() => undefined)
  }

  private snapshot(session: AgentSession, status: AgentRunResult['status']): AgentSessionSnapshot {
    return { id: session.id, input: session.input, messages: session.messages, steps: session.steps, text: session.text, imageTasks: session.imageTasks, documents: session.documents, ...(session.searchResults ? { searchResults: session.searchResults } : {}), ...(session.promptResults?.length ? { promptResults: session.promptResults } : {}), ...(session.usage ? { usage: session.usage } : {}), ...(session.pending ? { pending: session.pending } : {}), confirmed: session.confirmed, stepCount: session.stepCount, cancelled: session.cancelled, ...(session.projectRoot ? { projectRoot: session.projectRoot } : {}), status, ...(session.skills?.length ? { skills: session.skills } : {}), ...(session.skillCandidates?.length ? { skillCandidates: session.skillCandidates } : {}), ...(session.activeSkillIds?.length ? { activeSkillIds: session.activeSkillIds } : {}), ...(session.skillsResolved ? { skillsResolved: true } : {}), updatedAt: new Date().toISOString() }
  }

  private assertActive(session: AgentSession): void {
    if (this.deps.getProjectRoot && this.deps.getProjectRoot() !== session.projectRoot) {
      session.cancelled = true
      session.controller.abort()
    }
    if (session.cancelled || session.controller.signal.aborted) throw cancelledError()
  }
}
