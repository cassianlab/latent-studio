import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bot, Check } from 'lucide-react'
import type { ComposerSubmitHandler, ComposerSubmitOptions } from '../../components/ai-input-bar/WorkbenchComposer'
import type { ImageTaskEvent, ImageTaskRecord } from '../../shared/contracts/images'
import type { AgentActivityPhase, AgentRunResult, AgentSkillContext, ImageVariationPlan } from '../../shared/contracts/agent'
import { getAgentApi } from './agent-api'
import { getImageApi } from '../settings/image-api'
import { getSettingsApi } from '../settings/settings-api'
import type { ResultCardItem } from '../image/ResultImageCard'
import type { ConversationArtifact, ConversationCompactionState, SessionMessage } from '../conversation/types'
import { prepareConversationContext, retainSkillContextsAfterCompaction, summarizeConversationWithModel } from '../conversation/context-window'
import { getTextApi } from '../settings/model-api'
import { resolveAgentImageParameters, resolveImageOutputFormat, resolveImageSpec } from '../image/image-parameters'
import { getLibraryApi } from '../library/library-api'
import { fetchCompiledMemories, formatCompiledMemoriesForPrompt } from '../library/memory-injector'
import { buildAgentAssistantMessage, findLatestCompletedImage, mergeAgentMessages } from './agent-conversation-model'
import { REASONING_EFFORT_LABELS } from '../../shared/models/reasoning'
import { CompactionStatusCard } from '../conversation/CompactionStatusCard'
import { PromptSearchCards } from './PromptSearchCards'
import { AgentExecutionStatus } from './AgentExecutionStatus'
import { ConversationMessageContent } from '../conversation/ConversationMessageContent'
import { ConversationScrollAnchor } from '../conversation/conversation-scroll'
import { ConversationError } from '../conversation/ConversationError'
import { ConversationArtifacts } from './ConversationArtifacts'
import { canReEditTurn, MessageReEditAction } from '../conversation/MessageReEditAction'
import { referenceAssetToImageReference } from '../../shared/reference-images'

export type AgentResult = ResultCardItem

export interface AgentConversationProps {
  conversationId: string
  initialResults?: AgentResult[]
  initialPlan?: ImageVariationPlan | null
  initialPrompt?: string
  sessionMessages?: SessionMessage[]
  skillContexts?: AgentSkillContext[]
  compaction?: ConversationCompactionState
  onSessionUpdate?: (data: { results?: AgentResult[]; agentPlan?: ImageVariationPlan | null; agentLastPrompt?: string; messages?: SessionMessage[]; skillContexts?: AgentSkillContext[]; compaction?: ConversationCompactionState }) => void
  onAutoTitle?: (title: string) => void
  onBusyChange?: (busy: boolean) => void
  onStopReady?: (stop: (() => void) | undefined) => void
  onSubmitReady?: (submit: ComposerSubmitHandler) => void
  renderMessageResults?: (message: SessionMessage) => React.ReactNode
  onEditMessage?: (text: string) => void
}

export function AgentConversation({
  conversationId,
  initialResults = [],
  initialPrompt = '',
  sessionMessages = [],
  skillContexts = [],
  compaction,
  onSessionUpdate,
  onAutoTitle,
  onBusyChange,
  onStopReady,
  onSubmitReady,
  renderMessageResults,
  onEditMessage,
}: AgentConversationProps): React.ReactElement {
  const agentApi = useMemo(() => getAgentApi(), [])
  const textApi = useMemo(() => getTextApi(), [])
  const imageApi = useMemo(() => getImageApi(), [])
  // agentPlan remains in the session contract for older saved sessions; Agent now renders the conversation directly.
  const [settings, setSettings] = useState<Awaited<ReturnType<ReturnType<typeof getSettingsApi>['get']>> | null>(null)
  const [results, setResultsState] = useState<AgentResult[]>(initialResults)
  const [lastPrompt, setLastPromptState] = useState(initialPrompt)
  const [planning, setPlanning] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [agentRun, setAgentRun] = useState<AgentRunResult | null>(null)
  const [pendingMessages, setPendingMessages] = useState<SessionMessage[]>([])
  const [activity, setActivity] = useState<{ phase: AgentActivityPhase; label: string } | null>(null)
  const activeTasks = useRef(new Set<string>())
  const terminalTasks = useRef(new Map<string, ImageTaskRecord>())
  const sessionMessagesRef = useRef<SessionMessage[]>(sessionMessages)
  const activeRunIdRef = useRef<string | null>(null)
  const pendingSessionSync = useRef({ results: false })

  useEffect(() => {
    setResultsState(initialResults)
  }, [initialResults])

  useEffect(() => {
    setLastPromptState(initialPrompt)
  }, [initialPrompt])

  useEffect(() => {
    sessionMessagesRef.current = sessionMessages
  }, [sessionMessages])

  const setResults = useCallback((updater: AgentResult[] | ((prev: AgentResult[]) => AgentResult[])) => {
    pendingSessionSync.current.results = true
    setResultsState(updater)
  }, [])

  useEffect(() => {
    if (!pendingSessionSync.current.results) return
    pendingSessionSync.current = { results: false }
    onSessionUpdate?.({ results })
  }, [results, onSessionUpdate])

  const setLastPrompt = useCallback((prompt: string) => {
    setLastPromptState(prompt)
    onSessionUpdate?.({ agentLastPrompt: prompt })
  }, [onSessionUpdate])

  const setBusy = useCallback((value: boolean) => { setPlanning(value); onBusyChange?.(value || executing) }, [executing, onBusyChange])
  useEffect(() => {
    let disposed = false
    const loadAll = () => {
      void Promise.all([getSettingsApi().get(), agentApi.list()]).then(([nextSettings, runs]) => {
        if (!disposed) {
          setSettings(nextSettings)
          const pending = runs.find((run) => run.status === 'awaiting-confirmation')
          if (pending) setAgentRun(pending)
        }
      }).catch(() => {})
    }
    loadAll()
    const onSettingsUpdated = () => {
      void getSettingsApi().get().then((nextSettings) => {
        if (!disposed) setSettings(nextSettings)
      }).catch(() => {})
    }
    window.addEventListener('latent-studio:settings-updated', onSettingsUpdated)
    return () => {
      disposed = true
      window.removeEventListener('latent-studio:settings-updated', onSettingsUpdated)
    }
  }, [agentApi])
  useEffect(() => {
    const onModel = (event: Event) => {
      const detail = (event as CustomEvent<{ kind?: string; id?: string }>).detail
      if (!detail?.id) return
      setSettings((current) => current ? { ...current, ...(detail.kind === 'text' ? { defaultTextModelId: detail.id } : { defaultImageModelId: detail.id }) } : current)
    }
    window.addEventListener('latent-studio:model-selection', onModel)
    return () => window.removeEventListener('latent-studio:model-selection', onModel)
  }, [])
  useEffect(() => {
    const unsubscribe = agentApi.onStreamEvent((payload) => {
      if (payload.runId !== activeRunIdRef.current) return
      const event = payload.event
      if (event.type === 'activity') {
        setActivity({ phase: event.phase, label: event.label })
        return
      }
      setPendingMessages((current) => current.map((message) => (message.id === `assistant-${payload.runId}` || message.id === `assistant-confirm-${payload.runId}`)
        ? { ...message, text: event.type === 'text_reset' ? '' : `${message.text}${event.text}`, pendingStage: 'waiting' }
        : message))
    })
    return unsubscribe
  }, [agentApi])
  useEffect(() => {
    const unsubscribe = imageApi.onTaskEvent((event: ImageTaskEvent) => {
      const task = event.task
      setResults((current) => {
        const index = current.findIndex((item) => item.id === task.id)
        if (index < 0) return current
        const next = [...current]
        next[index] = { ...next[index], status: task.status, task }
        return next
      })
      if (['completed', 'failed', 'cancelled'].includes(task.status)) {
        terminalTasks.current.set(task.id, task)
        activeTasks.current.delete(task.id)
        if (activeTasks.current.size === 0) { setExecuting(false); onBusyChange?.(false); onStopReady?.(undefined) }
      }
    })
    return unsubscribe
  }, [imageApi, onBusyChange, onStopReady])

  const selectedTextModel = settings?.models.find((model) => model.id === settings.defaultTextModelId && model.kind === 'text') ?? settings?.models.find((model) => model.kind === 'text')
  const submit = useCallback(async (prompt: string, options?: ComposerSubmitOptions) => {
    if (planning || executing) return false
    const runId = crypto.randomUUID()
    const createdAt = Date.now()
    const baseMessages = sessionMessagesRef.current.filter((message) => !message.pending)
    const userMessage: SessionMessage = { id: `user-${runId}`, role: 'user', text: prompt, mode: 'agent', ...(options?.skillId ? { activatedSkillIds: [options.skillId] } : {}), createdAt }
    const pendingAssistant: SessionMessage = {
      id: `assistant-${runId}`,
      role: 'assistant',
      text: '',
      pending: true,
      pendingStage: 'waiting',
      reasoningEffort: options?.reasoningEffort ?? 'auto',
      createdAt: createdAt + 1,
    }
    setPendingMessages([userMessage, pendingAssistant])
    setActivity({ phase: 'thinking', label: '正在准备对话上下文' })
    activeRunIdRef.current = runId
    setBusy(true)
    if (!baseMessages.length && onAutoTitle) onAutoTitle(prompt.slice(0, 24))
    setLastPrompt(prompt)
    try {
      let activeSettings = settings
      if (!activeSettings) {
        activeSettings = await getSettingsApi().get()
        setSettings(activeSettings)
      }
      const textModel = activeSettings.models.find((model) => model.id === (options?.textModelId ?? activeSettings?.defaultTextModelId) && model.kind === 'text')
        ?? activeSettings.models.find((model) => model.kind === 'text')
      if (!textModel) throw new Error('请先在设置中配置文本模型')
      const imageModel = activeSettings.models.find((model) => model.id === options?.imageModelId && model.kind === 'image')
        ?? activeSettings.models.find((model) => model.id === activeSettings?.defaultImageModelId && model.kind === 'image')
        ?? activeSettings.models.find((model) => model.kind === 'image')
      const referenceAssets = options?.referenceAssets ?? []
      const libraryApi = getLibraryApi()
      const compiledMemories = await fetchCompiledMemories(libraryApi, { includeProject: options?.projectContext ?? true })
      const memoryContext = compiledMemories.items.length > 0 ? formatCompiledMemoriesForPrompt(compiledMemories) : ''
      const visibleSkillContexts = retainSkillContextsAfterCompaction(skillContexts, baseMessages, compaction)
      const preparedContext = await prepareConversationContext({
        messages: baseMessages,
        ...(compaction ? { state: compaction } : {}),
        fixedContext: [prompt, memoryContext, ...visibleSkillContexts.map((skill) => skill.instructions), ...(options?.contextDocuments ?? []).map((document) => document.text)],
        onCompactionStart: async () => {
          setPendingMessages((current) => current.map((message) => message.id === pendingAssistant.id ? { ...message, pendingStage: 'compacting' } : message))
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
        },
        summarize: (input) => summarizeConversationWithModel(textApi, textModel.id, input),
      })
      const submittedSkillContexts = retainSkillContextsAfterCompaction(visibleSkillContexts, baseMessages, preparedContext.state)
      const previousImage = findLatestCompletedImage(results)
      onStopReady?.(() => { void agentApi.cancel(runId) })
      const effectiveParameters = resolveAgentImageParameters(prompt, options?.parameters)
      const imageSpec = imageModel ? resolveImageSpec({ modelId: imageModel.modelId, ratio: effectiveParameters.ratio, resolution: effectiveParameters.resolution, quality: effectiveParameters.quality, background: effectiveParameters.background }) : null
      const next = await agentApi.run({
        runId,
        conversationId,
        messageId: userMessage.id,
        mode: 'agent',
        modelProfileId: textModel.id,
        ...(imageModel ? { imageModelProfileId: imageModel.id } : {}),
        ...(options?.count ? { imageCount: options.count } : {}),
        prompt,
        requireConfirmation: options?.requireConfirmation ?? false,
        projectContext: options?.projectContext ?? true,
        ...(options?.permissions?.length ? { permissions: options.permissions } : {}),
        ...(options?.contextDocuments?.length ? { attachments: options.contextDocuments } : {}),
        ...(imageSpec ? { imageRequest: { size: imageSpec.size, outputSize: imageSpec.outputSize, quality: imageSpec.quality, background: imageSpec.background, outputFormat: resolveImageOutputFormat(effectiveParameters) } } : {}),
        ...(options?.skillId ? { skillId: options.skillId } : {}),
        ...(submittedSkillContexts.length ? { skillContexts: submittedSkillContexts } : {}),
        ...(referenceAssets.length ? { references: referenceAssets.map(referenceAssetToImageReference) } : {}),
        ...(previousImage?.localPath ? { previousImageReferences: [{ type: 'file' as const, path: previousImage.localPath, filename: '上一张生成结果', mimeType: previousImage.mimeType }] } : {}),
        ...(options?.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
        ...(preparedContext.messages.length > 0 ? { contextMessages: preparedContext.messages } : {}),
        ...(memoryContext ? { memoryContext } : {}),
        ...(compiledMemories.auditRefs.length > 0 ? { memoryRefs: compiledMemories.auditRefs } : {}),
      })
      setAgentRun(next)
      if (next.imageTasks?.length) void trackAgentImageTasks(next.imageTasks)
      const assistantMessage = buildAgentAssistantMessage(next, `assistant-${runId}`, createdAt + 2)
      onSessionUpdate?.({ messages: [...baseMessages, userMessage, assistantMessage], ...(next.skillContexts ? { skillContexts: next.skillContexts } : {}), ...(preparedContext.state ? { compaction: preparedContext.state } : {}) })
      setPendingMessages([])
      return next.status !== 'failed' && next.status !== 'cancelled'
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Agent 执行失败'
      const failedMessage: SessionMessage = { id: `assistant-error-${runId}`, role: 'assistant', text: message, error: message, createdAt: createdAt + 2 }
      onSessionUpdate?.({ messages: [...baseMessages, userMessage, failedMessage] })
      setPendingMessages([])
      return false
    } finally {
      if (activeRunIdRef.current === runId) activeRunIdRef.current = null
      setActivity(null)
      setPlanning(false)
      if (activeTasks.current.size === 0) onBusyChange?.(false)
      if (activeTasks.current.size === 0) onStopReady?.(undefined)
    }
  }, [agentApi, compaction, conversationId, executing, onAutoTitle, onBusyChange, onSessionUpdate, onStopReady, planning, results, setBusy, settings, skillContexts, textApi])

  useEffect(() => { onSubmitReady?.(submit) }, [onSubmitReady, submit])

  const trackAgentImageTasks = useCallback(async (createdTasks: ImageTaskRecord[]) => {
    const tasks = await Promise.all(createdTasks.map(async (task) => {
      const terminal = terminalTasks.current.get(task.id)
      if (terminal) return terminal
      try {
        return await imageApi.get(task.id) ?? task
      } catch {
        return task
      }
    }))
    for (const task of tasks) {
      if (['completed', 'failed', 'cancelled'].includes(task.status)) terminalTasks.current.set(task.id, task)
      else activeTasks.current.add(task.id)
    }
    setResults((current) => {
      const next = [...current]
      tasks.forEach((task, index) => {
        const existing = next.findIndex((item) => item.id === task.id)
        const card = { id: task.id, title: existing >= 0 ? next[existing].title : `Agent 任务 ${index + 1}`, status: task.status, task }
        if (existing >= 0) next[existing] = { ...next[existing], ...card }
        else next.push(card)
      })
      return next
    })
    if (activeTasks.current.size > 0) {
      setExecuting(true)
      onBusyChange?.(true)
      onStopReady?.(() => { void Promise.all([...activeTasks.current].map((id) => imageApi.cancel(id))) })
    } else {
      setExecuting(false)
      onBusyChange?.(false)
      onStopReady?.(undefined)
    }
  }, [imageApi, onBusyChange, onStopReady, setResults])

  const confirmAgent = async () => {
    if (!agentRun || agentRun.status !== 'awaiting-confirmation') return
    const runId = agentRun.runId
    activeRunIdRef.current = runId
    setPlanning(true)
    onBusyChange?.(true)
    const pendingId = `assistant-confirm-${runId}`
    setPendingMessages([{ id: pendingId, role: 'assistant', text: '正在提交图片任务…', pending: true, pendingStage: 'preparing', createdAt: Date.now() }])
    setActivity({ phase: 'image', label: '正在提交图片任务' })
    onStopReady?.(() => { void agentApi.cancel(runId) })
    try {
      const result = await agentApi.confirm(agentRun.runId)
      setAgentRun(result)
      if (result.imageTasks?.length) void trackAgentImageTasks(result.imageTasks)
      const continuationText = result.text.startsWith(agentRun.text) ? result.text.slice(agentRun.text.length).trim() : result.text
      onSessionUpdate?.({ messages: mergeAgentMessages(sessionMessagesRef.current, [buildAgentAssistantMessage({ ...result, text: continuationText }, pendingId)]) })
      setPendingMessages([])
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Agent 确认失败'
      onSessionUpdate?.({ messages: mergeAgentMessages(sessionMessagesRef.current, [{ id: pendingId, role: 'assistant', text: message, error: message, createdAt: Date.now() }]) })
      setPendingMessages([])
    } finally {
      if (activeRunIdRef.current === runId) activeRunIdRef.current = null
      setActivity(null)
      setPlanning(false)
      if (activeTasks.current.size === 0) onBusyChange?.(false)
      if (activeTasks.current.size === 0) onStopReady?.(undefined)
    }
  }

  const displayMessages = mergeAgentMessages(sessionMessages, pendingMessages)
  const updateArtifact = (messageId: string, artifactIndex: number, artifact: ConversationArtifact) => {
    const messages = sessionMessagesRef.current.map((message) => message.id === messageId
      ? { ...message, artifacts: message.artifacts?.map((item, index) => index === artifactIndex ? artifact : item) }
      : message)
    sessionMessagesRef.current = messages
    onSessionUpdate?.({ messages })
  }

  return <div className="conversation agent-thread">
    <div className="agent-session-bar" aria-label="Agent 会话状态">
      <span className="pill">Agent 对话</span>
      <span className="agent-session-model">{selectedTextModel?.name ?? '文本模型未配置'}</span>
    </div>
    {compaction && <CompactionStatusCard state={compaction} />}
    {displayMessages.map((message, index) => message.role === 'user' ? (
      <div className="conversation-turn" key={message.id}>
        <div className="message user"><p>{message.text}</p></div>
        {onEditMessage && canReEditTurn(displayMessages, index, results) && <MessageReEditAction onEdit={() => onEditMessage(message.text)} />}
        {renderMessageResults?.(message)}
      </div>
    ) : (
      <div className="conversation-turn" key={message.id}>
        <div className="message assistant" aria-busy={message.pending}>
          <div className="avatar"><Bot size={17} /></div>
          <div className="message-bubble">
            <div className="message-meta-header">
              <span className="model-name-badge">{selectedTextModel?.name ?? '文本模型'}</span>
              {message.reasoningEffort && message.reasoningEffort !== 'auto' && <span className="reasoning-badge">思考：{REASONING_EFFORT_LABELS[message.reasoningEffort]}</span>}
              <span className="message-mode-tag">{message.pending ? '正在处理' : 'Agent'}</span>
            </div>
            <AgentExecutionStatus pending={message.pending} activity={message.pending ? activity : null} steps={message.agentSteps} />
            {message.error
              ? <ConversationError error={message.error} />
              : <ConversationMessageContent content={message.text} pending={message.pending} />}
            {message.promptResults?.length ? <PromptSearchCards results={message.promptResults} /> : null}
            {message.artifacts?.length ? <ConversationArtifacts artifacts={message.artifacts} onArtifactUpdated={(index, artifact) => updateArtifact(message.id, index, artifact)} /> : null}
          </div>
        </div>
        {renderMessageResults?.(message)}
      </div>
    ))}
    {agentRun?.status === 'awaiting-confirmation' && <div className="agent-confirmation" role="group" aria-label="确认 Agent 操作"><span>{agentRun.pendingConfirmation?.action === 'create-image-tasks' ? 'Agent 已根据对话准备好图片任务' : 'Agent 已准备执行一项写入操作'}</span><button className="primary small" onClick={() => void confirmAgent()} disabled={planning}><Check size={15} />确认执行</button></div>}
    <ConversationScrollAnchor version={`${displayMessages.length}:${displayMessages.at(-1)?.text ?? ''}:${planning}:${executing}:${results.length}`} />
  </div>
}

export default AgentConversation
