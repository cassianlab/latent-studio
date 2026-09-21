import type { ModelProfile } from '../../shared/contracts/settings'
import type { TextReasoningEffort } from '../../shared/contracts/text'
import type { CompiledMemoryResult, MemoryAuditRef } from '../../shared/memory/compiler'
import { referenceCapabilityError, type ReferenceAsset } from '../../shared/reference-images'
import { resolveImageSpec, type ResolvedImageSpec } from '../image/image-parameters'

export interface BuildTaskSpecificationInput {
  mode: 'text' | 'image' | 'agent'
  prompt: string
  textModel?: ModelProfile | null
  imageModel?: ModelProfile | null
  parameters?: {
    ratio?: string
    resolution?: string
    quality?: string
    background?: string
  }
  reasoningEffort?: TextReasoningEffort
  references?: ReferenceAsset[]
  compiledMemories?: CompiledMemoryResult
}

export interface TaskRecoveryAction {
  type: 'configure-text-model' | 'configure-image-model' | 'fallback-reasoning'
  message: string
}

export interface TaskSpecification {
  mode: 'text' | 'image' | 'agent'
  prompt: string
  textModel?: {
    id: string
    modelId: string
    name: string
  }
  imageModel?: {
    id: string
    modelId: string
    name: string
  }
  reasoningEffort: TextReasoningEffort
  imageSpec?: ResolvedImageSpec
  references: Array<{
    path: string
    filename: string
    mimeType?: string
  }>
  memoryRefs: MemoryAuditRef[]
  memorySummary: {
    activeCount: number
    overriddenCount: number
    totalChars: number
  }
  isValid: boolean
  validationErrors: string[]
  recoveryActions?: TaskRecoveryAction[]
}

export function buildTaskSpecification(input: BuildTaskSpecificationInput): TaskSpecification {
  const validationErrors: string[] = []
  const recoveryActions: TaskRecoveryAction[] = []

  const mode = input.mode
  const prompt = input.prompt.trim()

  // 1. Text model validation
  let textModelSummary: TaskSpecification['textModel']
  if (mode === 'text' || mode === 'agent') {
    if (!input.textModel) {
      validationErrors.push('未配置文本模型')
      recoveryActions.push({
        type: 'configure-text-model',
        message: '前往模型设置添加并启用文本模型',
      })
    } else {
      textModelSummary = {
        id: input.textModel.id,
        modelId: input.textModel.modelId,
        name: input.textModel.name,
      }
    }
  }

  // 2. Image model validation & resolution
  let imageModelSummary: TaskSpecification['imageModel']
  let imageSpec: ResolvedImageSpec | undefined
  if (mode === 'image' || mode === 'agent') {
    if (!input.imageModel) {
      validationErrors.push('未配置图片模型')
      recoveryActions.push({
        type: 'configure-image-model',
        message: '前往模型设置添加并启用图片模型',
      })
    } else {
      imageModelSummary = {
        id: input.imageModel.id,
        modelId: input.imageModel.modelId,
        name: input.imageModel.name,
      }
      imageSpec = resolveImageSpec({
        modelId: input.imageModel.modelId,
        ratio: input.parameters?.ratio,
        resolution: input.parameters?.resolution,
        quality: input.parameters?.quality,
        background: input.parameters?.background,
      })
      const referenceError = referenceCapabilityError(input.imageModel.capabilities, input.references?.length ?? 0)
      if (referenceError) validationErrors.push(referenceError)
    }
  }

  // 3. Reasoning effort
  const reasoningEffort: TextReasoningEffort = input.reasoningEffort ?? 'auto'

  // 4. References normalization
  const references = (input.references ?? []).map((asset) => ({
    path: asset.relativePath,
    filename: asset.name,
    mimeType: asset.mimeType,
  }))

  // 5. Memory references & summary
  const memoryRefs = input.compiledMemories?.auditRefs ?? []
  const memorySummary = {
    activeCount: input.compiledMemories?.items.length ?? 0,
    overriddenCount: input.compiledMemories?.overriddenMemories.length ?? 0,
    totalChars: input.compiledMemories?.totalChars ?? 0,
  }

  return {
    mode,
    prompt,
    textModel: textModelSummary,
    imageModel: imageModelSummary,
    reasoningEffort,
    imageSpec,
    references,
    memoryRefs,
    memorySummary,
    isValid: validationErrors.length === 0,
    validationErrors,
    ...(recoveryActions.length > 0 ? { recoveryActions } : {}),
  }
}
