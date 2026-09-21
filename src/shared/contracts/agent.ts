import type { ImageBackground, ImageOutputFormat, ImageQuality, ImageRequestInput, ImageTaskRecord } from './images'
import type { ProjectContextDocument } from './context'
import type { SearchResponse } from './search'
import type { JsonObject, TextReasoningEffort, TextUsage } from './text'

export type BatchPlanMode = 'smart' | 'same'

export interface ImageVariation {
  id: string
  title: string
  prompt: string
  difference: string
  referenceAssetIds?: string[]
}

export interface ImageVariationPlan {
  mode: BatchPlanMode
  invariants: string[]
  variations: ImageVariation[]
  notes?: string[]
  usage?: TextUsage
}

export interface PlanImageInput {
  modelProfileId: string
  prompt: string
  count: number
  mode: BatchPlanMode
  skillId?: string
  references?: ImageRequestInput['references']
  contextMessages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  reasoningEffort?: TextReasoningEffort
  projectContext?: boolean
  memoryContext?: string
  memoryRefs?: Array<{ id: string; version: number; scope: 'project' | 'global' }>
}

export interface PlanImageResult extends ImageVariationPlan {
  sourceModelProfileId: string
}

export type SkillScriptRuntime = 'node' | 'python' | 'shell'

export interface RunSkillInput {
  /** Optional caller-generated id so an in-flight direct Skill run can be cancelled. */
  runId?: string
  skillId: string
  entrypoint: string
  args?: string[]
  timeoutMs?: number
  maxOutputBytes?: number
}

export interface SkillRunResult {
  runId?: string
  skillId: string
  entrypoint: string
  runtime: SkillScriptRuntime
  exitCode: number | null
  signal?: string
  stdout: string
  stderr: string
  truncated: boolean
  timedOut: boolean
  durationMs: number
}

export type AgentStepKind = 'model' | 'tool' | 'confirmation' | 'final'
export type AgentStepStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'awaiting-confirmation'
export type AgentConfirmationAction = 'create-image-tasks' | 'update-project-document' | 'delete-project-document' | 'update-project-memory' | 'delete-project-memory' | 'update-personal-prompt' | 'delete-personal-prompt'

export type AgentRunMode = 'text' | 'agent'
export type AgentPermission = 'write-project-documents' | 'write-project-memories' | 'write-personal-prompts'

export interface AgentSkillContext {
  id: string
  name: string
  displayName: string
  description?: string
  contentHash: string
  instructions: string
  activatedAtMessageId?: string
}

export interface AgentSkillCandidate {
  id: string
  name: string
  displayName: string
  description?: string
}

export interface PromptSearchResult {
  id: string
  title: string
  content: string
  category: string
  type: 'prompt' | 'template' | 'style' | 'fragment'
  collection?: string
  thumbnailUrl?: string
  sourceUrl?: string
  score: number
  reason: string
  retrievalMode: 'hybrid' | 'lexical'
  embeddingModel?: string
  fallbackReason?: string
}

export interface AgentStep {
  id: string
  kind: AgentStepKind
  name: string
  status: AgentStepStatus
  input?: Record<string, unknown>
  output?: unknown
  error?: string
  startedAt: string
  finishedAt?: string
}

export interface AgentRunInput {
  /** Optional caller-generated id so an in-flight run can be cancelled before it returns. */
  runId?: string
  /** Stable workspace conversation id shared by text and Agent turns. */
  conversationId?: string
  /** Visible user-message id that activated the selected Skill. */
  messageId?: string
  /** Text mode shares the Agent loop but never receives image-generation tools. */
  mode?: AgentRunMode
  /** Text mode exposes web search only when the user enables it. */
  search?: boolean
  /** Allows this turn to retrieve current-project documents, memories, prompts, and asset metadata. */
  projectContext?: boolean
  /** Narrow write capabilities granted for this turn. Destructive calls still require confirmation. */
  permissions?: AgentPermission[]
  modelProfileId: string
  imageModelProfileId?: string
  /** Composer count used only when the user did not state an image count in the prompt. */
  imageCount?: number
  skillId?: string
  /** Skill instruction snapshots retained by the uncompressed conversation. */
  skillContexts?: AgentSkillContext[]
  prompt: string
  /** Prior user/assistant turns supplied by the renderer for conversational Agent runs. */
  contextMessages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  /** Opaque canonical context returned by OpenAI Responses compaction. */
  officialCompactionItems?: JsonObject[]
  /** Documents explicitly selected as attachments for this turn. */
  attachments?: ProjectContextDocument[]
  references?: ImageRequestInput['references']
  /** Recent output that the Agent may opt into for an image-edit follow-up. */
  previousImageReferences?: ImageRequestInput['references']
  maxSteps?: number
  requireConfirmation?: boolean
  reasoningEffort?: TextReasoningEffort
  imageRequest?: {
    size?: string
    outputSize?: string
    quality?: ImageQuality
    background?: ImageBackground
    outputFormat?: ImageOutputFormat
  }
  memoryContext?: string
  memoryRefs?: Array<{ id: string; version: number; scope: 'project' | 'global' }>
}

export type AgentRunStatus = 'completed' | 'awaiting-confirmation' | 'failed' | 'cancelled'

export interface AgentRunResult {
  runId: string
  status: AgentRunStatus
  text: string
  steps: AgentStep[]
  pendingConfirmation?: {
    action: AgentConfirmationAction
    toolName?: string
    input: Record<string, unknown>
  }
  imageTasks?: ImageTaskRecord[]
  searchResults?: SearchResponse
  promptResults?: PromptSearchResult[]
  documents?: ProjectContextDocument[]
  skillContexts?: AgentSkillContext[]
  usage?: TextUsage
}

export type AgentActivityPhase = 'thinking' | 'tool' | 'image'
export type AgentStreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'text_reset' }
  | { type: 'activity'; phase: AgentActivityPhase; label: string }
export interface AgentStreamEventPayload { runId: string; event: AgentStreamEvent }

export interface AgentApi {
  planImage(input: PlanImageInput): Promise<PlanImageResult>
  runSkill(input: RunSkillInput): Promise<SkillRunResult>
  run(input: AgentRunInput): Promise<AgentRunResult>
  onStreamEvent(listener: (payload: AgentStreamEventPayload) => void): () => void
  confirm(runId: string): Promise<AgentRunResult>
  cancel(runId: string): Promise<AgentRunResult>
  cancelSkill(runId: string): Promise<boolean>
  list(): Promise<AgentRunResult[]>
}
