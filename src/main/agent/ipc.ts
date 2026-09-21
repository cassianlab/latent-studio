import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { AgentApi, AgentPermission, AgentRunInput, AgentRunResult, AgentSkillContext, AgentStreamEvent, PlanImageInput, PlanImageResult, RunSkillInput, SkillRunResult } from '../../shared/contracts/agent'
import type { ImageApi } from '../../shared/contracts/images'
import { MAX_CONTEXT_FILE_BYTES, readProjectDocument } from '../context/reader'
import { searchWeb } from '../search/service'
import type { SettingsStore } from '../settings'
import { createTextModelService } from '../models/service'
import { parseImageVariationPlan } from './variation'
import { SkillStore } from '../skills/store'
import { runSkill } from './skill-runner'
import { AgentRunner } from './runner'
import { appendSkillRunLog } from './run-log'
import { ProjectAgentStore } from './store'
import type { ProjectDatabase } from '../projects/database'
import type { GlobalDatabase } from '../config'
import { GlobalMemoryStore, GlobalPromptStore } from '../library/global'
import { ProjectMemoryStore, ProjectPromptStore } from '../library/project'
import { ProjectMetadataService } from '../library/metadata'
import { ProjectAssetService } from '../library/assets'
import { compileMemories, formatCompiledMemoriesForPrompt } from '../../shared/memory/compiler'
import { MAX_ATTACHMENT_FILE_BYTES, MAX_CONTEXT_ATTACHMENTS, type ContextDocumentKind, type ProjectContextDocument } from '../../shared/contracts/context'
import { readAgentReferenceImages } from './reference-image-reader'
import { fitTextModelContext } from './context-budget'
import { PromptSearchService, rankPromptAssets } from '../library/prompt-search'
import { createLocalEmbeddingProvider } from '../library/local-embedding-provider'
import { ensureLegacyPromptImports } from '../library/prompt-import-normalization'

const channels = { planImage: 'agent:plan-image', runSkill: 'agent:run-skill', cancelSkill: 'agent:cancel-skill', run: 'agent:run', streamEvent: 'agent:text-stream-event', confirm: 'agent:confirm', cancel: 'agent:cancel', list: 'agent:list' } as const
const MAX_CONTEXT_MESSAGES = 512
const MAX_CONTEXT_MESSAGE_BYTES = 1024 * 1024
const MAX_CONTEXT_MESSAGES_BYTES = 4 * 1024 * 1024
const MAX_SKILL_CONTEXTS = 64
const MAX_SKILL_INSTRUCTION_BYTES = 256 * 1024
const MAX_SKILL_CONTEXT_BYTES = 2 * 1024 * 1024
const MAX_ATTACHMENT_CONTEXT_BYTES = 8 * 1024 * 1024
const MAX_OFFICIAL_COMPACTION_BYTES = 4 * 1024 * 1024
const MAX_MEMORY_CONTEXT_BYTES = 64 * 1024
const MAX_MEMORY_REFS = 25

function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' ? value as Record<string, unknown> : {} }
function requiredText(value: unknown, message: string): string { if (typeof value !== 'string' || !value.trim()) throw new Error(message); return value.trim() }
function count(value: unknown): number { if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 16) throw new Error('图片数量需要是 1-16 的整数'); return value as number }
function byteLength(value: string): number { return Buffer.byteLength(value, 'utf8') }

function boundedText(value: unknown, emptyMessage: string, maxBytes: number, largeMessage: string): string {
  const result = requiredText(value, emptyMessage)
  if (byteLength(result) > maxBytes) throw new Error(largeMessage)
  return result
}

function contextMessageInputs(value: unknown): AgentRunInput['contextMessages'] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error('历史消息格式无效')
  if (value.length > MAX_CONTEXT_MESSAGES) throw new Error(`历史消息数量不能超过 ${MAX_CONTEXT_MESSAGES} 条`)
  let totalBytes = 0
  return value.map((item) => {
    const message = record(item)
    if (!['system', 'user', 'assistant'].includes(String(message.role))) throw new Error('历史消息角色无效')
    const content = boundedText(message.content, '历史消息内容不能为空', MAX_CONTEXT_MESSAGE_BYTES, '单条历史消息过大')
    totalBytes += byteLength(content)
    if (totalBytes > MAX_CONTEXT_MESSAGES_BYTES) throw new Error('历史消息总大小过大')
    return { role: message.role as 'system' | 'user' | 'assistant', content }
  })
}

function officialCompactionInputs(value: unknown): AgentRunInput['officialCompactionItems'] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || !value.every((item) => Boolean(item) && typeof item === 'object' && !Array.isArray(item))) throw new Error('官方压缩上下文格式无效')
  let serialized = ''
  try { serialized = JSON.stringify(value) } catch { throw new Error('官方压缩上下文格式无效') }
  if (byteLength(serialized) > MAX_OFFICIAL_COMPACTION_BYTES) throw new Error('官方压缩上下文过大')
  return JSON.parse(serialized) as AgentRunInput['officialCompactionItems']
}

function attachmentInputs(value: unknown): ProjectContextDocument[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error('附件格式无效')
  if (value.length > MAX_CONTEXT_ATTACHMENTS) throw new Error(`单轮最多上传 ${MAX_CONTEXT_ATTACHMENTS} 个附件`)
  const kinds: readonly ContextDocumentKind[] = ['markdown', 'plain-text', 'json', 'pdf', 'word']
  let totalBytes = 0
  return value.map((item) => {
    const document = record(item)
    const summary = record(document.summary)
    if (typeof document.text !== 'string' || typeof summary.fileName !== 'string' || typeof summary.relativePath !== 'string' || !kinds.includes(summary.kind as ContextDocumentKind) || typeof summary.mimeType !== 'string' || !Number.isInteger(summary.byteLength) || (summary.byteLength as number) < 0) throw new Error('附件格式无效')
    if ((summary.byteLength as number) > MAX_ATTACHMENT_FILE_BYTES) throw new Error(`${summary.fileName} 超过 50 MB 附件上限`)
    const contentBytes = byteLength(document.text)
    if (contentBytes > MAX_CONTEXT_FILE_BYTES) throw new Error('单个附件内容过大')
    totalBytes += contentBytes
    if (totalBytes > MAX_ATTACHMENT_CONTEXT_BYTES) throw new Error('附件内容总大小过大')
    return { text: document.text, summary: { fileName: summary.fileName, relativePath: summary.relativePath, kind: summary.kind as ContextDocumentKind, mimeType: summary.mimeType as ProjectContextDocument['summary']['mimeType'], byteLength: summary.byteLength as number } }
  })
}

import type { TextGenerateInput, TextGenerationResult, TextReasoningEffort } from '../../shared/contracts/text'

const VALID_REASONING_EFFORTS = ['auto', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
function parseReasoningEffort(val: unknown): TextReasoningEffort | undefined {
  if (typeof val === 'string' && (VALID_REASONING_EFFORTS as readonly string[]).includes(val)) {
    return val as TextReasoningEffort
  }
  return undefined
}

function memoryRefInputs(value: unknown): AgentRunInput['memoryRefs'] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > MAX_MEMORY_REFS) throw new Error('记忆引用格式无效')
  return value.map((item) => {
    const ref = record(item)
    if (!Number.isInteger(ref.version) || (ref.version as number) < 1 || (ref.scope !== 'project' && ref.scope !== 'global')) throw new Error('记忆引用格式无效')
    return { id: requiredText(ref.id, '记忆标识缺失'), version: ref.version as number, scope: ref.scope }
  })
}

function input(raw: unknown): PlanImageInput {
  const value = record(raw)
  const mode = value.mode === 'same' ? 'same' : 'smart'
  const contextMessages = contextMessageInputs(value.contextMessages)
  const memoryRefs = memoryRefInputs(value.memoryRefs)
  return {
    modelProfileId: requiredText(value.modelProfileId, '文本模型配置标识缺失'),
    prompt: requiredText(value.prompt, '图片目标不能为空'),
    count: count(value.count),
    mode,
    ...(typeof value.skillId === 'string' && value.skillId.trim() ? { skillId: value.skillId.trim() } : {}),
    ...(Array.isArray(value.references) ? { references: value.references as PlanImageInput['references'] } : {}),
    ...(contextMessages?.length ? { contextMessages: contextMessages as PlanImageInput['contextMessages'] } : {}),
    ...(parseReasoningEffort(value.reasoningEffort) ? { reasoningEffort: parseReasoningEffort(value.reasoningEffort) } : {}),
    ...(typeof value.projectContext === 'boolean' ? { projectContext: value.projectContext } : {}),
    ...(typeof value.memoryContext === 'string' && value.memoryContext.trim() ? { memoryContext: boundedText(value.memoryContext, '记忆上下文不能为空', MAX_MEMORY_CONTEXT_BYTES, '记忆上下文过大') } : {}),
    ...(memoryRefs?.length ? { memoryRefs } : {}),
  }
}

function scriptInput(raw: unknown): RunSkillInput {
  const value = record(raw)
  if (typeof value.skillId !== 'string' || !value.skillId.trim()) throw new Error('Skill 标识不能为空')
  if (typeof value.entrypoint !== 'string' || !value.entrypoint.trim()) throw new Error('Skill 脚本路径不能为空')
  if (value.args !== undefined && (!Array.isArray(value.args) || !value.args.every((arg) => typeof arg === 'string'))) throw new Error('Skill 参数格式无效')
  return { ...(typeof value.runId === 'string' && value.runId.trim() ? { runId: value.runId.trim() } : {}), skillId: value.skillId.trim(), entrypoint: value.entrypoint.trim(), ...(Array.isArray(value.args) ? { args: value.args as string[] } : {}), ...(typeof value.timeoutMs === 'number' ? { timeoutMs: value.timeoutMs } : {}), ...(typeof value.maxOutputBytes === 'number' ? { maxOutputBytes: value.maxOutputBytes } : {}) }
}

function skillContextInputs(value: unknown): AgentSkillContext[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error('Skill 上下文格式无效')
  if (value.length > MAX_SKILL_CONTEXTS) throw new Error(`Skill 上下文数量不能超过 ${MAX_SKILL_CONTEXTS} 个`)
  let totalBytes = 0
  return value.map((item) => {
    const context = record(item)
    const instructions = boundedText(context.instructions, 'Skill 指令缺失', MAX_SKILL_INSTRUCTION_BYTES, 'Skill 指令过大')
    totalBytes += byteLength(instructions)
    if (totalBytes > MAX_SKILL_CONTEXT_BYTES) throw new Error('Skill 上下文总大小过大')
    return {
      id: requiredText(context.id, 'Skill 标识缺失'),
      name: requiredText(context.name, 'Skill 名称缺失'),
      displayName: requiredText(context.displayName, 'Skill 显示名称缺失'),
      contentHash: requiredText(context.contentHash, 'Skill 内容版本缺失'),
      instructions,
      ...(typeof context.description === 'string' && context.description.trim() ? { description: context.description.trim() } : {}),
      ...(typeof context.activatedAtMessageId === 'string' && context.activatedAtMessageId.trim() ? { activatedAtMessageId: context.activatedAtMessageId.trim() } : {}),
    }
  })
}

function runInput(raw: unknown): AgentRunInput {
  const value = record(raw)
  const modelProfileId = requiredText(value.modelProfileId, '文本模型配置标识缺失')
  const prompt = requiredText(value.prompt, 'Agent 目标不能为空')
  const attachments = attachmentInputs(value.attachments)
  const skillContexts = skillContextInputs(value.skillContexts)
  const contextMessages = contextMessageInputs(value.contextMessages)
  const officialCompactionItems = officialCompactionInputs(value.officialCompactionItems)
  const memoryRefs = memoryRefInputs(value.memoryRefs)
  const imageRequest = value.imageRequest && typeof value.imageRequest === 'object' ? {
    ...(typeof (value.imageRequest as Record<string, unknown>).size === 'string' ? { size: (value.imageRequest as Record<string, unknown>).size as string } : {}),
    ...(typeof (value.imageRequest as Record<string, unknown>).outputSize === 'string' ? { outputSize: (value.imageRequest as Record<string, unknown>).outputSize as string } : {}),
    ...(typeof (value.imageRequest as Record<string, unknown>).quality === 'string' ? { quality: (value.imageRequest as Record<string, unknown>).quality as import('../../shared/contracts/images').ImageQuality } : {}),
    ...(['auto', 'opaque', 'transparent'].includes(String((value.imageRequest as Record<string, unknown>).background)) ? { background: (value.imageRequest as Record<string, unknown>).background as import('../../shared/contracts/images').ImageBackground } : {}),
    ...(['png', 'jpeg', 'webp'].includes(String((value.imageRequest as Record<string, unknown>).outputFormat)) ? { outputFormat: (value.imageRequest as Record<string, unknown>).outputFormat as import('../../shared/contracts/images').ImageOutputFormat } : {}),
  } : undefined
  const allowedPermissions = new Set(['write-project-documents', 'write-project-memories', 'write-personal-prompts'])
  const permissions = Array.isArray(value.permissions)
    ? [...new Set(value.permissions.filter((item): item is AgentPermission => typeof item === 'string' && allowedPermissions.has(item)))]
    : []
  return {
    ...(typeof value.runId === 'string' && value.runId.trim() ? { runId: value.runId.trim() } : {}),
    ...(typeof value.conversationId === 'string' && value.conversationId.trim() ? { conversationId: value.conversationId.trim() } : {}),
    ...(typeof value.messageId === 'string' && value.messageId.trim() ? { messageId: value.messageId.trim() } : {}),
    mode: value.mode === 'text' ? 'text' : 'agent',
    ...(typeof value.search === 'boolean' ? { search: value.search } : {}),
    ...(typeof value.projectContext === 'boolean' ? { projectContext: value.projectContext } : {}),
    ...(permissions.length ? { permissions } : {}),
    modelProfileId,
    prompt,
    ...(contextMessages?.length ? { contextMessages } : {}),
    ...(officialCompactionItems?.length ? { officialCompactionItems } : {}),
    ...(attachments?.length ? { attachments } : {}),
    ...(typeof value.imageModelProfileId === 'string' && value.imageModelProfileId.trim() ? { imageModelProfileId: value.imageModelProfileId.trim() } : {}),
    ...(value.imageCount === undefined ? {} : { imageCount: count(value.imageCount) }),
    ...(typeof value.skillId === 'string' && value.skillId.trim() ? { skillId: value.skillId.trim() } : {}),
    ...(skillContexts?.length ? { skillContexts } : {}),
    ...(Array.isArray(value.references) ? { references: value.references as AgentRunInput['references'] } : {}),
    ...(Array.isArray(value.previousImageReferences) ? { previousImageReferences: value.previousImageReferences as AgentRunInput['previousImageReferences'] } : {}),
    ...(typeof value.maxSteps === 'number' ? { maxSteps: value.maxSteps } : {}),
    ...(typeof value.requireConfirmation === 'boolean' ? { requireConfirmation: value.requireConfirmation } : {}),
    ...(parseReasoningEffort(value.reasoningEffort) ? { reasoningEffort: parseReasoningEffort(value.reasoningEffort) } : {}),
    ...(imageRequest ? { imageRequest } : {}),
    ...(typeof value.memoryContext === 'string' && value.memoryContext.trim() ? { memoryContext: boundedText(value.memoryContext, '记忆上下文不能为空', MAX_MEMORY_CONTEXT_BYTES, '记忆上下文过大') } : {}),
    ...(memoryRefs?.length ? { memoryRefs } : {}),
  }
}

function planningSystemPrompt(mode: PlanImageInput['mode'], amount: number, skill?: string | null, memoryContext?: string | null): string {
  return `你是 Latent Studio 的图片任务规划器。只返回 JSON，不要 Markdown，不要解释。JSON 结构为 {"invariants": string[], "variations": [{"title": string, "prompt": string, "difference": string}], "notes": string[]}。必须返回 ${amount} 个 variations。每个 title 使用 4-16 个中文字符或同等长度的简短词组，概括主体与镜头意图；不得复制完整提示词，不得写尺寸、质量或格式参数。invariants 数组必须包含 1-3 项当前画面需保持一致的核心设定（如角色外观、核心服饰、画风风格等，例如 ["主角核心外貌特征保持一致", "统一画风基调"]）。${mode === 'smart' ? '这是智能变体：每个 prompt 必须不同，并明确改变景别、构图、视角、动作或光线中的至少一项；所有镜头共享的不变量写入 invariants。' : `这是用户明确选择的相同提示词批量：每个 prompt 可以相同，但仍需提供 ${amount} 个独立条目。`} 不要捏造参考图路径。${memoryContext ? `\n\n${memoryContext}` : ''}${skill ? `\n\n下面是用户明确选择的 Skill 指令，只遵循其中与当前图片规划相关的内容：\n${skill.slice(0, 12000)}` : ''}`
}

export interface AgentIpcOptions {
  store: SettingsStore
  userDataPath: string
  getProjectRoot: () => string | undefined
  getProjectDatabase?: (projectRoot: string) => ProjectDatabase | undefined
  builtInRoot?: string
  imageApi?: ImageApi
  onRunner?: (runner: AgentRunner) => void
  database?: GlobalDatabase
}

export function registerAgentIpc({ store, userDataPath, getProjectRoot, getProjectDatabase, builtInRoot, imageApi, onRunner, database }: AgentIpcOptions): () => void {
  const textService = createTextModelService(store)
  const skillStore = new SkillStore({ userDataPath, getProjectRoot, builtInRoot })
  const skillRuns = new Map<string, AbortController>()
  const instructionCache = new Map<string, { contentHash: string; instructions: string }>()
  const legacyPromptMigration = database ? ensureLegacyPromptImports(database) : Promise.resolve(0)
  void legacyPromptMigration.catch(() => {})
  const executeSkill = async (input: RunSkillInput & { signal?: AbortSignal }): Promise<SkillRunResult> => {
    const runId = input.runId ?? (input.signal ? undefined : randomUUID())
    const controller = input.signal ? undefined : new AbortController()
    const logRoot = getProjectRoot() ?? userDataPath
    if (runId && controller) skillRuns.set(runId, controller)
    try {
      const resolved = await skillStore.resolveScript(input.skillId, input.entrypoint)
      const result = await runSkill({ run: resolved, ...(input.args ? { args: input.args } : {}), ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }), ...(input.maxOutputBytes === undefined ? {} : { maxOutputBytes: input.maxOutputBytes }), ...(input.signal ? { signal: input.signal } : controller ? { signal: controller.signal } : {}) })
      try { await appendSkillRunLog(logRoot, resolved, result) } catch { /* logging must not hide a completed Skill run */ }
      return { ...(runId ? { runId } : {}), ...result }
    } finally {
      if (runId) skillRuns.delete(runId)
    }
  }
  const eligibleSkills = async () => (await skillStore.list()).filter((skill) => skill.enabled && skill.trusted && (skill.scope !== 'project' || skill.projectAuthorized === true))
  const listSkillCandidates = async (mode: 'text' | 'agent') => mode === 'agent'
    ? (await eligibleSkills()).map((skill) => ({ id: skill.id, name: skill.name, displayName: skill.displayName, ...(skill.note || skill.description ? { description: skill.note || skill.description } : {}) }))
    : []
  const resolveSkills = async (_prompt: string, selectedSkillId?: string, _mode: 'text' | 'agent' = 'agent') => {
      const available = await skillStore.list()
      if (!selectedSkillId) return []
      const selected = available.find((skill) => skill.id === selectedSkillId || skill.name === selectedSkillId)
      if (!selected || !selected.enabled) throw new Error('指定 Skill 未启用或不存在')
      if (!selected.trusted) throw new Error('指定 Skill 尚未获得信任确认')
      if (selected.scope === 'project' && selected.projectAuthorized !== true) throw new Error('指定 Skill 尚未获得当前项目授权')
      const cached = instructionCache.get(selected.id)
      if (cached && cached.contentHash === selected.contentHash) return [{ id: selected.id, name: selected.name, displayName: selected.displayName, ...(selected.note || selected.description ? { description: selected.note || selected.description } : {}), contentHash: selected.contentHash, instructions: cached.instructions }]
      const instructions = await skillStore.instructions(selected.id)
      if (!instructions) throw new Error('指定 Skill 指令不可读取，请重新扫描')
      instructionCache.set(selected.id, { contentHash: selected.contentHash, instructions })
      return [{ id: selected.id, name: selected.name, displayName: selected.displayName, ...(selected.note || selected.description ? { description: selected.note || selected.description } : {}), contentHash: selected.contentHash, instructions }]
  }
  const streamText = (modelInput: TextGenerateInput & { signal?: AbortSignal }, emit: (event: AgentStreamEvent) => void = () => {}): Promise<TextGenerationResult> => {
    const requestId = randomUUID()
    return new Promise((resolve, reject) => {
      let settled = false
      const cleanup = () => modelInput.signal?.removeEventListener('abort', abort)
      const finish = (callback: () => void) => {
        if (settled) return
        settled = true
        cleanup()
        callback()
      }
      const abort = () => textService.stopStream(requestId)
      if (modelInput.signal?.aborted) {
        reject(Object.assign(new Error('Agent 执行已取消'), { code: 'cancelled' }))
        return
      }
      modelInput.signal?.addEventListener('abort', abort, { once: true })
      void textService.startStream({
        requestId,
        modelProfileId: modelInput.modelProfileId,
        request: { ...modelInput.request, stream: true },
      }, (payload) => {
        if ('event' in payload) {
          if (payload.event.type === 'text_delta') emit(payload.event)
          return
        }
        if ('result' in payload) {
          finish(() => resolve(payload.result))
          return
        }
        finish(() => reject(Object.assign(new Error(payload.error.message), payload.error)))
      }).catch((error) => finish(() => reject(error)))
    })
  }
  const promptSearch = database ? new PromptSearchService({
    database,
    listGlobalPrompts: () => new GlobalPromptStore(database).list({ scope: 'global' }),
    listGlobalPromptPage: (afterRowId, limit) => new GlobalPromptStore(database).listForSearchIndex(afterRowId, limit),
    listProjectPrompts: async () => {
      const projectRoot = getProjectRoot()
      return projectRoot ? new ProjectPromptStore().list({ scope: 'project', projectRoot }) : []
    },
    embeddingProvider: createLocalEmbeddingProvider(join(userDataPath, 'embedding-models')),
  }) : undefined
  const runner = new AgentRunner({
    generate: (input) => textService.generate(input, input.signal),
    generateStream: streamText,
    search: (input) => searchWeb(input, { getProjectRoot }),
    searchPrompts: async ({ query, limit }) => {
      await legacyPromptMigration
      const projectRoot = getProjectRoot()
      const projectItems = projectRoot ? await new ProjectPromptStore().list({ scope: 'project', projectRoot }) : []
      const globalItems = database ? await new GlobalPromptStore(database).listPage({ scope: 'global', search: query, limit: 48 }) : { items: [] }
      return rankPromptAssets([...projectItems, ...globalItems.items], query, limit)
    },
    searchPromptLibrary: promptSearch ? async ({ query, limit }) => { await legacyPromptMigration; return promptSearch.search({ query, limit }) } : undefined,
    getPromptDetail: async ({ id }) => {
      await legacyPromptMigration
      const projectRoot = getProjectRoot()
      const projectPrompt = projectRoot ? await new ProjectPromptStore().get({ id, scope: 'project', projectRoot }) : null
      return projectPrompt ?? (database ? new GlobalPromptStore(database).get({ id, scope: 'global' }) : null)
    },
    readFile: (input) => {
      const projectRoot = getProjectRoot()
      if (!projectRoot) throw Object.assign(new Error('请先打开一个项目'), { code: 'no-active-project' })
      return readProjectDocument({ projectRoot, ...input })
    },
    readProjectMemory: ({ id }) => {
      const projectRoot = getProjectRoot()
      if (!projectRoot) throw Object.assign(new Error('请先打开一个项目'), { code: 'no-active-project' })
      return new ProjectMemoryStore().get({ id, scope: 'project', projectRoot })
    },
    readProjectAssetMetadata: async ({ id }) => {
      const projectRoot = getProjectRoot()
      if (!projectRoot) throw Object.assign(new Error('请先打开一个项目'), { code: 'no-active-project' })
      return (await new ProjectAssetService().list({ projectRoot, maxEntries: 10_000 })).find((asset) => asset.id === id) ?? null
    },
    writeProjectDocument: (input) => {
      const projectRoot = getProjectRoot()
      if (!projectRoot) throw Object.assign(new Error('请先打开一个项目'), { code: 'no-active-project' })
      return new ProjectMetadataService().saveDocument({ projectRoot, ...input })
    },
    updateProjectDocument: (input) => {
      const projectRoot = getProjectRoot()
      if (!projectRoot) throw Object.assign(new Error('请先打开一个项目'), { code: 'no-active-project' })
      return new ProjectMetadataService().updateDocument({ projectRoot, ...input })
    },
    deleteProjectDocument: async (input) => {
      const projectRoot = getProjectRoot()
      if (!projectRoot) throw Object.assign(new Error('请先打开一个项目'), { code: 'no-active-project' })
      await new ProjectMetadataService().deleteDocument({ projectRoot, ...input })
    },
    createProjectMemory: (input) => {
      const projectRoot = getProjectRoot()
      if (!projectRoot) throw Object.assign(new Error('请先打开一个项目'), { code: 'no-active-project' })
      return new ProjectMemoryStore().save({ scope: 'project', projectRoot, ...input })
    },
    updateProjectMemory: (input) => {
      const projectRoot = getProjectRoot()
      if (!projectRoot) throw Object.assign(new Error('请先打开一个项目'), { code: 'no-active-project' })
      return new ProjectMemoryStore().update({ scope: 'project', projectRoot, ...input })
    },
    deleteProjectMemory: async ({ id }) => {
      const projectRoot = getProjectRoot()
      if (!projectRoot) throw Object.assign(new Error('请先打开一个项目'), { code: 'no-active-project' })
      return new ProjectMemoryStore().remove({ scope: 'project', projectRoot, id })
    },
    createPersonalPrompt: (input) => {
      if (input.source === 'import') throw new Error('仓库提示词为只读内容，请先复制到个人提示词')
      const scope = input.scope ?? 'global'
      if (scope === 'project') {
        const projectRoot = getProjectRoot()
        if (!projectRoot) throw Object.assign(new Error('请先打开一个项目'), { code: 'no-active-project' })
        return new ProjectPromptStore().save({ ...input, scope, projectRoot })
      }
      if (!database) throw new Error('全局提示词库尚未初始化')
      return new GlobalPromptStore(database).save({ ...input, scope })
    },
    updatePersonalPrompt: async (input) => {
      const scope = input.scope
      const projectRoot = scope === 'project' ? getProjectRoot() : undefined
      if (scope === 'project' && !projectRoot) throw Object.assign(new Error('请先打开一个项目'), { code: 'no-active-project' })
      const prompts = scope === 'project' ? new ProjectPromptStore() : database ? new GlobalPromptStore(database) : undefined
      if (!prompts) throw new Error('全局提示词库尚未初始化')
      const existing = await prompts.get({ id: input.id, scope, ...(projectRoot ? { projectRoot } : {}) })
      if (!existing) throw new Error('提示词不存在')
      if (existing.source === 'import') throw new Error('仓库提示词为只读内容，请先复制到个人提示词')
      return prompts.update({ ...input, ...(projectRoot ? { projectRoot } : {}) })
    },
    deletePersonalPrompt: async ({ id, scope }) => {
      const projectRoot = scope === 'project' ? getProjectRoot() : undefined
      if (scope === 'project' && !projectRoot) throw Object.assign(new Error('请先打开一个项目'), { code: 'no-active-project' })
      const prompts = scope === 'project' ? new ProjectPromptStore() : database ? new GlobalPromptStore(database) : undefined
      if (!prompts) throw new Error('全局提示词库尚未初始化')
      const existing = await prompts.get({ id, scope, ...(projectRoot ? { projectRoot } : {}) })
      if (!existing) throw new Error('提示词不存在')
      if (existing.source === 'import') throw new Error('仓库提示词为只读内容，请先复制到个人提示词')
      return prompts.remove({ id, scope, ...(projectRoot ? { projectRoot } : {}) })
    },
    readImageReferences: (references) => readAgentReferenceImages(references, getProjectRoot),
    runSkill: executeSkill,
    listSkillCandidates,
    resolveSkills,
    ...(imageApi ? { image: imageApi } : {}),
    getImageModelCapabilities: (modelProfileId) => store.get().models.find((model) => model.id === modelProfileId && model.kind === 'image')?.capabilities ?? [],
    getProjectRoot,
    persistence: getProjectDatabase ? new ProjectAgentStore(getProjectDatabase) : undefined,
  })
  onRunner?.(runner)
  const loadCompiledMemories = async (includeProject: boolean) => {
    const globalMemories = database ? await new GlobalMemoryStore(database).list({ scope: 'global', activeOnly: true }) : []
    const projectRoot = getProjectRoot()
    const projectMemories = includeProject && projectRoot ? await new ProjectMemoryStore().list({ scope: 'project', projectRoot, activeOnly: true }) : []
    return compileMemories({ globalMemories, projectMemories })
  }
  const touchMemoryRefs = async (refs: NonNullable<AgentRunInput['memoryRefs']>): Promise<void> => {
    const now = new Date().toISOString()
    const projectRoot = getProjectRoot()
    await Promise.all(refs.map(async (ref) => {
      try {
        if (ref.scope === 'global' && database) await new GlobalMemoryStore(database).update({ id: ref.id, scope: 'global', lastUsedAt: now })
        if (ref.scope === 'project' && projectRoot) await new ProjectMemoryStore().update({ id: ref.id, scope: 'project', projectRoot, lastUsedAt: now })
      } catch {
        // Usage metadata must not turn a completed model request into a failure.
      }
    }))
  }
  const runAgent = async (raw: unknown, emit?: (payload: { runId: string; event: AgentStreamEvent }) => void): Promise<AgentRunResult> => {
    const parsed = runInput(raw)
    const normalized: AgentRunInput & { runId: string } = { ...parsed, runId: parsed.runId ?? randomUUID() }
    const includeProjectMemory = normalized.projectContext === true
    if (!normalized.memoryContext) {
      try {
        const compiled = await loadCompiledMemories(includeProjectMemory)
        if (compiled.items.length > 0) {
          normalized.memoryContext = formatCompiledMemoriesForPrompt(compiled)
          normalized.memoryRefs = compiled.auditRefs
        }
      } catch {}
    }
    const result = await runner.run(normalized, (event) => emit?.({ runId: normalized.runId, event }))
    if (result.status === 'completed' && normalized.memoryRefs?.length) await touchMemoryRefs(normalized.memoryRefs)
    return result
  }
  const api: AgentApi = {
    async planImage(raw) {
      const request = input(raw)
      const matchedSkills = await resolveSkills(request.prompt, request.skillId)
      const skill = matchedSkills.map((item) => `【${item.displayName}】\n${item.instructions.slice(0, 3000)}`).join('\n\n')
      let memoryContext = request.memoryContext ?? null
      if (!memoryContext) {
        try {
          const compiled = await loadCompiledMemories(request.projectContext === true)
          if (compiled.items.length > 0) memoryContext = formatCompiledMemoriesForPrompt(compiled)
        } catch {
          // Fallback gracefully if database or project reading encounters error.
        }
      }
      const priorMessages = request.contextMessages && request.contextMessages.length > 0
        ? request.contextMessages.map((m) => ({ role: m.role, content: m.content }))
        : []
      const fittedContext = fitTextModelContext(
        planningSystemPrompt(request.mode, request.count, skill, memoryContext),
        [...priorMessages, { role: 'user', content: request.prompt }],
      )
      const result = await streamText({
        modelProfileId: request.modelProfileId,
        request: {
          system: fittedContext.system,
          messages: fittedContext.messages,
          maxTokens: 3000,
          includeUsage: true,
          ...(request.reasoningEffort ? { reasoningEffort: request.reasoningEffort } : {}),
        }
      })
      const plan = parseImageVariationPlan(result.text, request.count, request.mode)
      return { ...plan, sourceModelProfileId: request.modelProfileId, ...(result.usage ? { usage: result.usage } : {}) } satisfies PlanImageResult
    },
    async runSkill(raw) {
      const request = scriptInput(raw)
      return executeSkill(request)
    },
    async run(raw) { return runAgent(raw) },
    onStreamEvent() { return () => {} },
    async confirm(runId) {
      return runner.confirm(requiredText(runId, 'Agent 运行标识'))
    },
    async cancel(runId) {
      return runner.cancel(requiredText(runId, 'Agent 运行标识'))
    },
    async cancelSkill(runId) {
      const controller = skillRuns.get(requiredText(runId, 'Skill 运行标识'))
      if (!controller) return false
      controller.abort()
      return true
    },
    async list() {
      return runner.list()
    },
  }
  const handlers: Array<[string, (event: IpcMainInvokeEvent, raw?: unknown) => unknown]> = [[channels.planImage, (_event, raw) => api.planImage(input(raw))], [channels.runSkill, (_event, raw) => api.runSkill(scriptInput(raw))], [channels.cancelSkill, (_event, raw) => api.cancelSkill(requiredText(record(raw).runId, 'Skill 运行标识'))], [channels.run, (event, raw) => runAgent(raw, (payload) => event.sender.send(channels.streamEvent, payload))], [channels.confirm, (_event, raw) => api.confirm(requiredText(record(raw).runId, 'Agent 运行标识'))], [channels.cancel, (_event, raw) => api.cancel(requiredText(record(raw).runId, 'Agent 运行标识'))], [channels.list, () => api.list()]]
  for (const [channel, handler] of handlers) ipcMain.handle(channel, handler)
  return () => { runner.dispose(); for (const controller of skillRuns.values()) controller.abort(); skillRuns.clear(); textService.dispose(); for (const [channel] of handlers) ipcMain.removeHandler(channel) }
}

export { channels as agentIpcChannels }
