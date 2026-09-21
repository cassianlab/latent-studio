import type { AgentStep, AgentSkillContext, ImageVariationPlan, PromptSearchResult } from './agent'
import type { ImageTaskRecord } from './images'
import type { SearchResult } from './search'
import type { TextGenerationResult, TextReasoningEffort } from './text'

export type WorkspaceMode = 'text' | 'image' | 'agent'

export interface ConversationDocumentArtifact {
  type: 'document'
  operation: 'created' | 'updated'
  relativePath: string
  name: string
  extension?: string
  mimeType?: string
  byteLength?: number
  modifiedAt?: string
}

export interface ConversationPromptArtifact {
  type: 'prompt'
  operation: 'created' | 'updated'
  id: string
  scope: 'global' | 'project'
  name: string
  promptKind?: 'prompt' | 'template' | 'style'
  collection?: string
  category?: string
}

export type ConversationArtifact = ConversationDocumentArtifact | ConversationPromptArtifact

export interface SessionMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  pending?: boolean
  pendingStage?: 'preparing' | 'compacting' | 'waiting'
  error?: string
  cancelled?: boolean
  usage?: TextGenerationResult['usage']
  sources?: SearchResult[]
  reasoningEffort?: TextReasoningEffort
  mode?: WorkspaceMode
  imageTaskIds?: string[]
  agentSteps?: AgentStep[]
  activatedSkillIds?: string[]
  toolContext?: string
  promptResults?: PromptSearchResult[]
  artifacts?: ConversationArtifact[]
  createdAt: number
}

export interface ConversationCompactionState {
  summary: string
  throughMessageId: string
  updatedAt: number
  compressionMode?: 'official' | 'observational' | 'local'
  fallbackReason?: string
  estimatedFixedTokens?: number
  coveredMessageCount?: number
  coveredFromAt?: number
  coveredThroughAt?: number
  keyItemCount?: number
  /** Opaque OpenAI Responses items used only for later model requests. */
  officialItems?: import('./text').JsonObject[]
}

export interface SessionResultCard {
  id: string
  title: string
  status: ImageTaskRecord['status']
  task?: ImageTaskRecord
}

export interface WorkspaceSession {
  id: string
  title: string
  mode: WorkspaceMode
  agentWriteEnabled: boolean
  createdAt: number
  updatedAt: number
  messages: SessionMessage[]
  results: SessionResultCard[]
  skillContexts: AgentSkillContext[]
  compaction?: ConversationCompactionState
  imagePlan: ImageVariationPlan | null
  imageLastPrompt: string
  agentPlan: ImageVariationPlan | null
  agentLastPrompt: string
}

export type ConversationLoadIssueCode = 'payload-too-large' | 'invalid-json' | 'invalid-session'

export interface ConversationLoadIssue {
  code: ConversationLoadIssueCode
}

export interface ConversationLoadResult {
  sessions: WorkspaceSession[]
  activeId?: string
  issues?: ConversationLoadIssue[]
}

export interface ConversationApi {
  load(input: { projectId: string; legacySessions?: readonly WorkspaceSession[]; legacyActiveId?: string }): Promise<ConversationLoadResult>
  save(input: { projectId: string; session: WorkspaceSession }): Promise<void>
  remove(input: { projectId: string; sessionId: string }): Promise<void>
  setActive(input: { projectId: string; sessionId: string }): Promise<void>
  onFlushRequested(listener: () => void | Promise<void>): () => void
}
