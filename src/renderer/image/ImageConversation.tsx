import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Bot, Check, Sparkles, Trash2 } from 'lucide-react'
import type { ImageQuality, ImageRequestInput, ImageTaskEvent, ImageTaskRecord } from '../../shared/contracts/images'
import type { ModelProfile } from '../../shared/contracts/settings'
import type { ComposerSubmitHandler, ComposerSubmitOptions } from '../../components/ai-input-bar/WorkbenchComposer'
import { getImageApi } from '../settings/image-api'
import { getSettingsApi } from '../settings/settings-api'
import { getAgentApi } from '../agent/agent-api'
import type { ImageVariationPlan } from '../../shared/contracts/agent'
import type { ResultCardItem } from './ResultImageCard'
import type { ConversationCompactionState, SessionMessage } from '../conversation/types'
import { prepareConversationContext, summarizeConversationWithModel } from '../conversation/context-window'
import { buildImagePlanningPrompt, buildImageProviderPrompt, resolveImageOutputFormat, resolveImageSpec } from './image-parameters'
import { getLibraryApi } from '../library/library-api'
import { buildTaskSpecification } from '../conversation/task-spec'
import { buildImageTaskPrompt } from '../../shared/image-task-prompt'
import { fetchCompiledMemories, touchUsedMemories, formatCompiledMemoriesForPrompt, formatMemoriesForImagePrompt } from '../library/memory-injector'
import { referenceAssetToImageReference, referenceCapabilityError } from '../../shared/reference-images'
import { getTextApi } from '../settings/model-api'
import { StreamingStatus } from '../conversation/StreamingStatus'
import { ConversationMessageContent } from '../conversation/ConversationMessageContent'
import { ConversationError } from '../conversation/ConversationError'
import { canReEditTurn, MessageReEditAction } from '../conversation/MessageReEditAction'

export type ResultCard = ResultCardItem

/** Merge queue events and enqueue responses without rendering the same task twice. */
export function mergeResultCards(current: ResultCard[], incoming: ResultCard[]): ResultCard[] {
  const byId = new Map(current.map((item) => [item.id, item]))
  const uniqueIncoming: ResultCard[] = []
  for (const item of incoming) {
    byId.set(item.id, { ...byId.get(item.id), ...item })
    if (!uniqueIncoming.some((next) => next.id === item.id)) uniqueIncoming.push(item)
  }
  const incomingIds = new Set(uniqueIncoming.map((item) => item.id))
  return [...uniqueIncoming.map((item) => byId.get(item.id) as ResultCard), ...current.filter((item) => !incomingIds.has(item.id))]
}

export function buildImageResultMessage(
  tasks: readonly Pick<ImageTaskRecord, 'id'>[],
  createdAt = Date.now(),
  usage?: SessionMessage['usage'],
): SessionMessage {
  return {
    id: `image-assistant-${crypto.randomUUID()}`,
    role: 'assistant',
    mode: 'image',
    text: `已提交 ${tasks.length} 个图片任务，生成结果会在本轮对话中逐张更新。`,
    imageTaskIds: tasks.map((task) => task.id),
    ...(usage ? { usage } : {}),
    createdAt,
  }
}

export interface ImageConversationProps {
  initialResults?: ResultCard[]
  initialPlan?: ImageVariationPlan | null
  initialPrompt?: string
  sessionMessages?: SessionMessage[]
  compaction?: ConversationCompactionState
  onSessionUpdate?: (data: { results?: ResultCard[]; imagePlan?: ImageVariationPlan | null; imageLastPrompt?: string; messages?: SessionMessage[]; compaction?: ConversationCompactionState }) => void
  onAutoTitle?: (title: string) => void
  onBusyChange?: (busy: boolean) => void
  onStopReady?: (stop: (() => void) | undefined) => void
  onSubmitReady?: (submit: ComposerSubmitHandler) => void
  renderMessageResults?: (message: SessionMessage) => React.ReactNode
  onEditMessage?: (text: string) => void
}

export function ImageConversation({
  initialResults = [],
  initialPlan = null,
  initialPrompt = '',
  sessionMessages = [],
  compaction,
  onSessionUpdate,
  onAutoTitle,
  onBusyChange,
  onStopReady,
  onSubmitReady,
  renderMessageResults,
  onEditMessage,
}: ImageConversationProps): React.ReactElement {
  const [results, setResultsState] = useState<ResultCard[]>(initialResults)
  const [modelId, setModelId] = useState<string | null>(null)
  const [textModelId, setTextModelId] = useState<string | null>(null)
  const [models, setModels] = useState<ModelProfile[]>([])
  const [plan, setPlanState] = useState<ImageVariationPlan | null>(initialPlan)
  const [awaitingPlanConfirmation, setAwaitingPlanConfirmation] = useState(false)
  const [plannedImageModelId, setPlannedImageModelId] = useState<string | null>(null)
  const [plannedReferences, setPlannedReferences] = useState<ImageRequestInput['references']>()
  const [plannedParameters, setPlannedParameters] = useState<ComposerSubmitOptions['parameters']>()
  const [plannedProjectContext, setPlannedProjectContext] = useState(false)
  const [lastPrompt, setLastPromptState] = useState(initialPrompt)
  const [busy, setBusy] = useState(false)
  const [compacting, setCompacting] = useState(false)
  const activeTasks = useRef(new Set<string>())
  const terminalTasks = useRef(new Map<string, ImageTaskRecord>())
  const currentPromptRef = useRef<HTMLDivElement>(null)
  const previousPromptRef = useRef(initialPrompt)
  const api = useMemo(() => getImageApi(), [])
  const agentApi = useMemo(() => getAgentApi(), [])
  const textApi = useMemo(() => getTextApi(), [])

  useEffect(() => {
    setResultsState(initialResults)
  }, [initialResults])

  useEffect(() => {
    setPlanState(initialPlan)
  }, [initialPlan])

  useEffect(() => {
    setLastPromptState(initialPrompt)
  }, [initialPrompt])

  useEffect(() => {
    if (!lastPrompt || previousPromptRef.current === lastPrompt) return
    previousPromptRef.current = lastPrompt
    currentPromptRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' })
  }, [lastPrompt])

  const setResults = useCallback((updater: ResultCard[] | ((prev: ResultCard[]) => ResultCard[])) => {
    setResultsState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      onSessionUpdate?.({ results: next })
      return next
    })
  }, [onSessionUpdate])

  const setPlan = useCallback((valOrFn: ImageVariationPlan | null | ((prev: ImageVariationPlan | null) => ImageVariationPlan | null)) => {
    setPlanState((prev) => {
      const next = typeof valOrFn === 'function' ? valOrFn(prev) : valOrFn
      onSessionUpdate?.({ imagePlan: next })
      return next
    })
  }, [onSessionUpdate])

  const setLastPrompt = useCallback((prompt: string) => {
    setLastPromptState(prompt)
    onSessionUpdate?.({ imageLastPrompt: prompt })
  }, [onSessionUpdate])

  const setBusyState = useCallback((value: boolean) => { setBusy(value); onBusyChange?.(value) }, [onBusyChange])

  useEffect(() => {
    let disposed = false
    void getSettingsApi().get().then((settings) => {
      if (!disposed) {
        setModels(settings.models ?? [])
        setModelId(settings.defaultImageModelId ?? settings.models.find((model) => model.kind === 'image')?.id ?? null)
        setTextModelId(settings.defaultTextModelId ?? settings.models.find((model) => model.kind === 'text')?.id ?? null)
      }
    }).catch(() => { if (!disposed) setModelId(null) })
    return () => { disposed = true }
  }, [])

  useEffect(() => {
    const onModel = (event: Event) => {
      const detail = (event as CustomEvent<{ kind?: string; id?: string }>).detail
      if (detail?.id && detail.kind === 'image') setModelId(detail.id)
      if (detail?.id && detail.kind === 'text') setTextModelId(detail.id)
    }
    window.addEventListener('latent-studio:model-selection', onModel)
    return () => window.removeEventListener('latent-studio:model-selection', onModel)
  }, [])

  useEffect(() => {
    const unsubscribe = api.onTaskEvent((event: ImageTaskEvent) => {
      const task = event.task
      if (['completed', 'failed', 'cancelled'].includes(task.status)) {
        terminalTasks.current.set(task.id, task)
        activeTasks.current.delete(task.id)
        if (activeTasks.current.size === 0) { setBusyState(false); onStopReady?.(undefined) }
      }
      setResults((current) => {
        const index = current.findIndex((item) => item.id === task.id)
        if (index < 0) return task.status === 'pending' || task.status === 'running'
          ? [{ id: task.id, title: '新生成', status: task.status, task }, ...current]
          : current
        const next = [...current]
        next[index] = { ...next[index], status: task.status, task }
        return next
      })
    })
    return unsubscribe
  }, [api, onStopReady, setBusyState])

  const submit = useCallback(async (prompt: string, options?: ComposerSubmitOptions) => {
    const requestedImageModelId = options?.imageModelId ?? modelId
    const requestedTextModelId = options?.textModelId ?? textModelId
    if (busy || !requestedImageModelId) {
      if (!requestedImageModelId) setResults((current) => [...current, { id: `error-${Date.now()}`, title: '未配置模型', status: 'failed' }])
      return false
    }
    const referenceAssets = options?.referenceAssets ?? []
    const contextDocuments = options?.contextDocuments ?? []
    const imageModel = models.find((item) => item.id === requestedImageModelId) ?? null
    const capabilityError = imageModel ? referenceCapabilityError(imageModel.capabilities, referenceAssets.length) : null
    if (capabilityError) {
      setResults((current) => [...current, { id: `error-${Date.now()}`, title: capabilityError, status: 'failed' }])
      return false
    }
    setBusyState(true)
    if (!lastPrompt && onAutoTitle) {
      onAutoTitle(prompt.slice(0, 24))
    }
    setLastPrompt(prompt)
    const baseMessages = sessionMessages.filter((message) => !message.pending)
    const userMessage: SessionMessage = { id: `image-user-${crypto.randomUUID()}`, role: 'user', text: prompt, mode: 'image', createdAt: Date.now() }
    onSessionUpdate?.({ messages: [...baseMessages, userMessage] })
    try {
      const references = referenceAssets.length ? referenceAssets.map(referenceAssetToImageReference) : undefined
      const amount = options?.count ?? 1
      const batchMode = options?.batchMode ?? 'smart'
      let variations: Array<{ title: string; prompt: string }> = [{ title: '新生成', prompt }]
      const libraryApi = getLibraryApi()
      const compiledMemories = await fetchCompiledMemories(libraryApi, { includeProject: options?.projectContext ?? false })
      const imageMemoryContext = formatMemoriesForImagePrompt(compiledMemories)
      if (amount > 1 && batchMode === 'smart') {
        if (!requestedTextModelId) throw new Error('智能变体需要先配置文本模型')
        const preparedContext = await prepareConversationContext({
          messages: sessionMessages,
          ...(compaction ? { state: compaction } : {}),
          fixedContext: [prompt, ...contextDocuments.map((document) => document.text), formatCompiledMemoriesForPrompt(compiledMemories)],
          onCompactionStart: async () => {
            setCompacting(true)
            await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
          },
          summarize: (input) => summarizeConversationWithModel(textApi, requestedTextModelId, input),
        })
        setCompacting(false)
        const nextPlan = await agentApi.planImage({
          modelProfileId: requestedTextModelId,
          prompt: buildImagePlanningPrompt(prompt, contextDocuments),
          count: amount,
          mode: 'smart',
          projectContext: options?.projectContext ?? false,
          ...(references ? { references } : {}),
          ...(preparedContext.messages.length > 0 ? { contextMessages: preparedContext.messages } : {}),
          ...(options?.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
          ...(compiledMemories.items.length > 0 ? { memoryContext: formatCompiledMemoriesForPrompt(compiledMemories) } : {}),
          ...(compiledMemories.auditRefs.length > 0 ? { memoryRefs: compiledMemories.auditRefs } : {}),
        })
        setPlan(nextPlan)
        setAwaitingPlanConfirmation(true)
        setPlannedImageModelId(requestedImageModelId)
        setPlannedReferences(references)
        setPlannedParameters(options?.parameters)
        setPlannedProjectContext(options?.projectContext ?? false)
        if (preparedContext.state) onSessionUpdate?.({ compaction: preparedContext.state })
        setBusyState(false)
        onStopReady?.(undefined)
        return true
      } else if (amount > 1) {
        setPlan({ mode: 'same', invariants: [], variations: Array.from({ length: amount }, (_, index) => ({ id: `same-${index}`, title: `相同提示词 ${index + 1}`, prompt, difference: '用户明确选择相同提示词' })) })
        setAwaitingPlanConfirmation(true)
        setPlannedImageModelId(requestedImageModelId)
        setPlannedReferences(references)
        setPlannedParameters(options?.parameters)
        setPlannedProjectContext(options?.projectContext ?? false)
        setBusyState(false)
        onStopReady?.(undefined)
        return true
      } else {
        setPlan(null)
        setAwaitingPlanConfirmation(false)
        setPlannedImageModelId(null)
        setPlannedReferences(undefined)
        setPlannedParameters(undefined)
        setPlannedProjectContext(false)
      }
      const taskSpec = buildTaskSpecification({
        mode: 'image',
        prompt,
        imageModel,
        parameters: options?.parameters,
        references: referenceAssets,
        compiledMemories,
      })
      if (!taskSpec.isValid) {
        setBusyState(false)
        setResults((current) => [...current, { id: `error-${Date.now()}`, title: taskSpec.validationErrors.join('; '), status: 'failed' }])
        return false
      }
      const taskSize = taskSpec.imageSpec?.size
      const taskQuality = taskSpec.imageSpec?.quality
      const outputFormat = resolveImageOutputFormat(options?.parameters)
      const createdTasks = await Promise.all(variations.map(async (variation) => {
        const prompt = buildImageProviderPrompt(variation.prompt, options?.parameters, imageMemoryContext)
        const task = await api.enqueue({ modelProfileId: requestedImageModelId, request: { prompt, size: taskSize, outputSize: taskSpec.imageSpec?.outputSize, quality: taskQuality, background: taskSpec.imageSpec?.background, outputFormat, ...(references ? { references } : {}) } })
        return task
      }))
      if (compiledMemories.auditRefs.length > 0) {
        void touchUsedMemories(libraryApi, compiledMemories.auditRefs)
      }
      const tasks = createdTasks.map((task) => terminalTasks.current.get(task.id) ?? task)
      for (const task of tasks) if (!['completed', 'failed', 'cancelled'].includes(task.status)) activeTasks.current.add(task.id)
      setResults((current) => mergeResultCards(current, tasks.map((task, index) => ({ id: task.id, title: variations[index]?.title ?? '新生成', status: task.status, task } as ResultCard)))
      )
      onSessionUpdate?.({ messages: [...baseMessages, userMessage, buildImageResultMessage(tasks)] })
      onStopReady?.(() => { void Promise.all([...activeTasks.current].map((id) => api.cancel(id))) })
      if (activeTasks.current.size === 0) { setBusyState(false); onStopReady?.(undefined) }
      return true
    } catch (error) {
      setCompacting(false)
      setBusyState(false)
      onStopReady?.(undefined)
      setResults((current) => [...current, { id: `error-${Date.now()}`, title: error instanceof Error ? error.message : '请求失败', status: 'failed' }])
      return false
    }
  }, [agentApi, api, busy, compaction, lastPrompt, modelId, models, onAutoTitle, onSessionUpdate, onStopReady, sessionMessages, setBusyState, setLastPrompt, setPlan, setResults, textApi, textModelId])

  const updateVariation = useCallback((index: number, field: 'title' | 'prompt', value: string) => {
    setPlan((current) => current ? { ...current, variations: current.variations.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item) } : current)
  }, [])

  const removeVariation = useCallback((index: number) => {
    setPlan((current) => current && current.variations.length > 1 ? { ...current, variations: current.variations.filter((_, itemIndex) => itemIndex !== index) } : current)
  }, [])

  const moveVariation = useCallback((index: number, direction: -1 | 1) => {
    setPlan((current) => {
      if (!current) return current
      const target = index + direction
      if (target < 0 || target >= current.variations.length) return current
      const variations = [...current.variations]
      const [moved] = variations.splice(index, 1)
      variations.splice(target, 0, moved)
      return { ...current, variations }
    })
  }, [])

  const confirmPlan = useCallback(async () => {
    if (!plan || !awaitingPlanConfirmation) return
    const entries = plan.variations.map((variation) => ({ title: variation.title.trim(), prompt: variation.prompt.trim() }))
    if (entries.some((entry) => !entry.title || !entry.prompt)) {
      setResults((current) => [...current, { id: `error-${Date.now()}`, title: '计划中的标题和提示词不能为空', status: 'failed' }])
      return
    }
    const normalized = entries.map((entry) => entry.prompt.replace(/\s+/g, ' ').toLocaleLowerCase())
    if (plan.mode === 'smart' && new Set(normalized).size !== normalized.length) {
      setResults((current) => [...current, { id: `error-${Date.now()}`, title: '智能变体不能使用重复提示词，请修改后再确认', status: 'failed' }])
      return
    }
    const imageModelId = plannedImageModelId ?? modelId
    if (!imageModelId) {
      setResults((current) => [...current, { id: `error-${Date.now()}`, title: '未配置图片模型', status: 'failed' }])
      return
    }
    setPlan((current) => current ? { ...current, variations: current.variations.map((variation, index) => ({ ...variation, title: entries[index].title, prompt: entries[index].prompt })) } : current)
    setAwaitingPlanConfirmation(false)
    setBusyState(true)
    try {
      const libraryApi = getLibraryApi()
      const compiledMemories = await fetchCompiledMemories(libraryApi, { includeProject: plannedProjectContext })
      const imageMemoryContext = formatMemoriesForImagePrompt(compiledMemories)
      const imageModel = models.find((m) => m.id === imageModelId) ?? null
      const taskSpec = buildTaskSpecification({
        mode: 'image',
        prompt: entries[0]?.prompt ?? '',
        imageModel,
        parameters: plannedParameters,
        compiledMemories,
      })
      if (!taskSpec.isValid) {
        setBusyState(false)
        setResults((current) => [...current, { id: `error-${Date.now()}`, title: taskSpec.validationErrors.join('; '), status: 'failed' }])
        return
      }
      const taskSize = taskSpec.imageSpec?.size
      const taskQuality = taskSpec.imageSpec?.quality
      const outputFormat = resolveImageOutputFormat(plannedParameters)
      const createdTasks = await Promise.all(entries.map((variation) => {
        const prompt = buildImageProviderPrompt(buildImageTaskPrompt(variation.prompt, plan.invariants), plannedParameters, imageMemoryContext)
        return api.enqueue({ modelProfileId: imageModelId, title: variation.title, request: { prompt, size: taskSize, outputSize: taskSpec.imageSpec?.outputSize, quality: taskQuality, background: taskSpec.imageSpec?.background, outputFormat, ...(plannedReferences ? { references: plannedReferences } : {}) } })
      }))
      if (compiledMemories.auditRefs.length > 0) {
        void touchUsedMemories(libraryApi, compiledMemories.auditRefs)
      }
      const tasks = createdTasks.map((task) => terminalTasks.current.get(task.id) ?? task)
      for (const task of tasks) if (!['completed', 'failed', 'cancelled'].includes(task.status)) activeTasks.current.add(task.id)
      setResults((current) => mergeResultCards(current, tasks.map((task, index) => ({ id: task.id, title: entries[index]?.title ?? '新生成', status: task.status, task } as ResultCard)))
      )
      onSessionUpdate?.({ messages: [...sessionMessages.filter((message) => !message.pending), buildImageResultMessage(tasks, Date.now(), plan.usage)] })
      onStopReady?.(() => { void Promise.all([...activeTasks.current].map((id) => api.cancel(id))) })
      if (activeTasks.current.size === 0) { setBusyState(false); onStopReady?.(undefined) }
    } catch (error) {
      setBusyState(false)
      onStopReady?.(undefined)
      setResults((current) => [...current, { id: `error-${Date.now()}`, title: error instanceof Error ? error.message : '请求失败', status: 'failed' }])
    }
  }, [api, awaitingPlanConfirmation, modelId, models, onSessionUpdate, onStopReady, plan, plannedImageModelId, plannedParameters, plannedProjectContext, plannedReferences, sessionMessages, setBusyState, setPlan, setResults])

  useEffect(() => { onSubmitReady?.(submit) }, [onSubmitReady, submit])

  return (
    <div className="conversation image-thread">
      {compacting && <StreamingStatus label="正在压缩图片规划上下文…" />}
      {sessionMessages.length ? sessionMessages.map((message, index) => message.role === 'user' ? (
        <div className="conversation-turn" key={message.id} ref={index === sessionMessages.length - 1 ? currentPromptRef : undefined}>
          <div className="message user"><p>{message.text}</p></div>
          {onEditMessage && canReEditTurn(sessionMessages, index, results) && <MessageReEditAction onEdit={() => onEditMessage(message.text)} />}
          {renderMessageResults?.(message)}
        </div>
      ) : (
        <div className="conversation-turn" key={message.id} ref={index === sessionMessages.length - 1 ? currentPromptRef : undefined}>
          <div className="message assistant" aria-busy={message.pending}>
            <div className="avatar"><Bot size={17} /></div>
            <div className="message-bubble">
              <div className="message-meta-header"><span className="message-mode-tag">{message.mode === 'agent' ? 'Agent' : message.mode === 'image' ? '图片模式' : '文本模式'}</span></div>
              {message.error
                ? <ConversationError error={message.error} />
                : <ConversationMessageContent content={message.text} pending={message.pending} />}
            </div>
          </div>
          {renderMessageResults?.(message)}
        </div>
      )) : null}
      {plan && <div className="plan-card compact">
        <div className="plan-head">
          <div>
            <Sparkles size={17} />
            <strong>{plan ? '图片任务计划' : '智能批量计划'}</strong>
            <span className={`pill ${plan ? (awaitingPlanConfirmation ? 'amber' : 'green') : 'amber'}`}>{plan ? (awaitingPlanConfirmation ? '待确认' : '已提交') : '等待输入'}</span>
          </div>
          <span>{plan ? `${plan.variations.length} 个任务 · ${awaitingPlanConfirmation ? '可编辑' : '已进入队列'}` : modelId ? '准备就绪' : '未配置图片模型'}</span>
        </div>
        <div className="invariants">
          <span>不变量</span>
          <p>{plan?.invariants.join('、') || '输入目标后由文本模型提取'}</p>
        </div>
        {plan ? (
          <div className="image-variation-editor">
            {plan.variations.map((item, index) => (
              <div className="image-variation-row" key={item.id}>
                <div className="image-variation-title">
                  <b>{String(index + 1).padStart(2, '0')}</b>
                  <input value={item.title} disabled={!awaitingPlanConfirmation} onChange={(event) => updateVariation(index, 'title', event.target.value)} aria-label={`第 ${index + 1} 个变体标题`} />
                  <div className="image-variation-actions">
                    <button type="button" aria-label="上移变体" title="上移" onClick={() => moveVariation(index, -1)} disabled={!awaitingPlanConfirmation || index === 0}><ArrowUp size={14} /></button>
                    <button type="button" aria-label="下移变体" title="下移" onClick={() => moveVariation(index, 1)} disabled={!awaitingPlanConfirmation || index === plan.variations.length - 1}><ArrowDown size={14} /></button>
                    <button type="button" aria-label="删除变体" title="删除" onClick={() => removeVariation(index)} disabled={!awaitingPlanConfirmation || plan.variations.length <= 1}><Trash2 size={14} /></button>
                  </div>
                </div>
                <textarea value={item.prompt} disabled={!awaitingPlanConfirmation} onChange={(event) => updateVariation(index, 'prompt', event.target.value)} aria-label={`第 ${index + 1} 个变体提示词`} />
                <small>{item.difference}</small>
              </div>
            ))}
          </div>
        ) : (
          <div className="variation-list"><span className="empty-inline">暂无已确认变体</span></div>
        )}
        {awaitingPlanConfirmation && (
          <div className="plan-actions">
            <button className="primary small" onClick={() => void confirmPlan()}><Check size={15} />确认并发生成</button>
          </div>
        )}
      </div>}
    </div>
  )
}

export default ImageConversation
