import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bot, Brain, Check, Copy, FilePlus2, Search, WandSparkles } from 'lucide-react'
import type { AgentSkillContext } from '../../shared/contracts/agent'
import { getSettingsApi } from '../settings/settings-api'
import { getTextApi } from '../settings/model-api'
import { getLibraryApi } from '../library/library-api'
import {
  compileMemories,
  fetchCompiledMemories,
  touchUsedMemories,
  formatCompiledMemoriesForPrompt,
} from '../library/memory-injector'
import type { ComposerSubmitHandler, ComposerSubmitOptions } from '../../components/ai-input-bar/WorkbenchComposer'
import type { ConversationCompactionState, SessionMessage } from '../conversation/types'
import { REASONING_EFFORT_LABELS } from '../../shared/models/reasoning'
import { StreamingStatus } from '../conversation/StreamingStatus'
import { DocumentEditorModal } from '../library/DocumentEditorModal'
import { MemoryEditorModal } from '../library/MemoryEditorModal'
import { getAgentApi } from '../agent/agent-api'
import { buildAgentToolContext } from '../agent/agent-conversation-model'
import { prepareConversationContext, retainSkillContextsAfterCompaction, summarizeConversationWithModel } from '../conversation/context-window'
import { PromptSearchCards } from '../agent/PromptSearchCards'
import { CompactionStatusCard } from '../conversation/CompactionStatusCard'
import { ConversationMessageContent } from '../conversation/ConversationMessageContent'
import { ConversationScrollAnchor } from '../conversation/conversation-scroll'
import { ConversationError } from '../conversation/ConversationError'
import { canReEditTurn, MessageReEditAction } from '../conversation/MessageReEditAction'
import { referenceAssetToImageReference } from '../../shared/reference-images'

export type ConversationMessage = SessionMessage

function modelLabel(modelId: string | null, modelName: string | null): string {
  return modelName ?? modelId ?? '未配置文本模型'
}

function MessageActions({
  onDocument,
  onPrompt,
  onMemory,
  onCopy,
  copied,
}: {
  onDocument: () => void
  onPrompt: () => void
  onMemory: () => void
  onCopy: () => void
  copied: boolean
}): React.ReactElement {
  return (
    <div className="message-actions">
      <button type="button" className="msg-action-btn" onClick={onCopy} title="复制内容">
        {copied ? <Check size={13} className="text-green" /> : <Copy size={13} />}
        <span>{copied ? '已复制' : '复制'}</span>
      </button>
      <button type="button" className="msg-action-btn" onClick={onDocument} title="保存至项目文档">
        <FilePlus2 size={13} />
        <span>保存为文档</span>
      </button>
      <button type="button" className="msg-action-btn" onClick={onPrompt} title="保存为提示词模板">
        <WandSparkles size={13} />
        <span>保存提示词</span>
      </button>
      <button type="button" className="msg-action-btn" onClick={onMemory} title="保存至记忆库">
        <Brain size={13} />
        <span>保存为记忆</span>
      </button>
    </div>
  )
}

function AssistantMessage({
  message,
  modelName,
  onDocument,
  onPrompt,
  onMemory,
  activityLabel,
}: {
  message: ConversationMessage
  modelName: string
  onDocument: () => void
  onPrompt: () => void
  onMemory: () => void
  activityLabel?: string
}): React.ReactElement {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    if (!message.text) return
    void navigator.clipboard.writeText(message.text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const hasSources = Boolean(message.sources && message.sources.length > 0)

  return (
    <div className="message assistant" aria-busy={message.pending}>
      <div className="avatar"><Bot size={17} /></div>
      <div className="message-bubble">
        <div className="message-meta-header">
          <span className="model-name-badge">{modelName}</span>
          {message.reasoningEffort && message.reasoningEffort !== 'auto' && (
            <span className="reasoning-badge" title="思考强度">
              思考: {REASONING_EFFORT_LABELS[message.reasoningEffort]}
            </span>
          )}
          <span className="message-mode-tag">{message.pending ? (message.text ? '正在输出' : '等待响应') : '文本模式'}</span>
        </div>
        {message.pending && !message.text && (
          <StreamingStatus label={message.pendingStage === 'compacting' ? '正在压缩对话上下文…' : activityLabel ?? (message.pendingStage === 'preparing' ? '正在准备上下文…' : '正在等待模型响应…')} />
        )}
        {message.error
          ? <ConversationError error={message.error} />
          : <ConversationMessageContent content={message.text} pending={message.pending} />}
        {message.promptResults?.length ? <PromptSearchCards results={message.promptResults} /> : null}
        {!message.pending && !message.error && (
          <>
            {hasSources && (
              <div className="sources-card">
                <span className="sources-title"><Search size={12} />网络引用来源 ({message.sources!.length})</span>
                <div className="sources-links">
                  {message.sources!.map((source) => (
                    <a href={source.url} target="_blank" rel="noreferrer" key={source.url} title={source.url}>
                      {source.title || source.url}
                    </a>
                  ))}
                </div>
              </div>
            )}
            <MessageActions
              onDocument={onDocument}
              onPrompt={onPrompt}
              onMemory={onMemory}
              onCopy={handleCopy}
              copied={copied}
            />
          </>
        )}
      </div>
    </div>
  )
}

export interface TextConversationProps {
  conversationId: string
  initialMessages?: SessionMessage[]
  skillContexts?: AgentSkillContext[]
  compaction?: ConversationCompactionState
  onSessionUpdate?: (data: { messages?: SessionMessage[]; skillContexts?: AgentSkillContext[]; compaction?: ConversationCompactionState }) => void
  onAutoTitle?: (title: string) => void
  onBusyChange?: (busy: boolean) => void
  onStopReady?: (stop: (() => void) | undefined) => void
  onSubmitReady?: (submit: ComposerSubmitHandler) => void
  onSavePrompt?: (content: string) => void
  renderMessageResults?: (message: SessionMessage) => React.ReactNode
  onEditMessage?: (text: string) => void
}

export function TextConversation({
  conversationId,
  initialMessages = [],
  skillContexts = [],
  compaction,
  onSessionUpdate,
  onAutoTitle,
  onBusyChange,
  onStopReady,
  onSubmitReady,
  onSavePrompt,
  renderMessageResults,
  onEditMessage,
}: TextConversationProps): React.ReactElement {
  const [messages, setMessagesState] = useState<ConversationMessage[]>(initialMessages)
  const [modelId, setModelId] = useState<string | null>(null)
  const [modelName, setModelName] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [activityLabel, setActivityLabel] = useState<string | undefined>()
  const agentApi = useMemo(() => getAgentApi(), [])
  const textApi = useMemo(() => getTextApi(), [])
  const activeRequest = useRef<string | null>(null)
  const activeMemoryRefs = useRef<Array<{ id: string; scope: 'project' | 'global' }>>([])
  const libraryApi = useMemo(() => getLibraryApi(), [])

  const [savedToast, setSavedToast] = useState<string | null>(null)

  useEffect(() => {
    setMessagesState(initialMessages)
  }, [initialMessages])

  const setMessages = useCallback((updater: (prev: ConversationMessage[]) => ConversationMessage[]) => {
    setMessagesState((prev) => {
      const next = updater(prev)
      return next
    })
  }, [])

  const setBusyState = useCallback((value: boolean) => {
    setBusy(value)
    onBusyChange?.(value)
  }, [onBusyChange])

  useEffect(() => {
    let disposed = false
    void getSettingsApi().get().then((settings) => {
      if (disposed) return
      const selected = settings.models.find((model) => model.id === settings.defaultTextModelId && model.kind === 'text')
        ?? settings.models.find((model) => model.kind === 'text')
      setModelId(selected?.id ?? null)
      setModelName(selected?.name ?? null)
    }).catch(() => {
      if (!disposed) { setModelId(null); setModelName(null) }
    })
    return () => { disposed = true }
  }, [])

  useEffect(() => {
    const onModel = (event: Event) => {
      const detail = (event as CustomEvent<{ kind?: string; id?: string; name?: string }>).detail
      if (detail?.kind === 'text' && detail.id) { setModelId(detail.id); setModelName(detail.name ?? detail.id) }
    }
    window.addEventListener('latent-studio:model-selection', onModel)
    return () => window.removeEventListener('latent-studio:model-selection', onModel)
  }, [])

  useEffect(() => {
    const unsubscribe = agentApi.onStreamEvent((payload) => {
      if (payload.runId !== activeRequest.current) return
      const event = payload.event
      if (event.type === 'activity') {
        setActivityLabel(event.label)
        return
      }
      setMessages((current) => {
        const next = [...current]
        const last = next[next.length - 1]
        if (!last || last.role !== 'assistant' || !last.pending) return current
        next[next.length - 1] = { ...last, text: event.type === 'text_reset' ? '' : `${last.text}${event.text}`, pendingStage: 'waiting' }
        return next
      })
    })
    return () => {
      unsubscribe()
      if (activeRequest.current) void agentApi.cancel(activeRequest.current)
      activeRequest.current = null
      setBusyState(false)
      onStopReady?.(undefined)
    }
  }, [agentApi, onStopReady, setBusyState, setMessages])

  const submit = useCallback(async (prompt: string, options?: ComposerSubmitOptions) => {
    const requestedModelId = options?.textModelId ?? modelId
    if (busy || !requestedModelId) {
      if (!requestedModelId) setMessages((current) => [...current, { id: `error-${Date.now()}`, role: 'assistant', text: '', error: '请先在模型设置中启用一个文本模型', createdAt: Date.now() }])
      return false
    }
    const requestedEffort = options?.reasoningEffort ?? 'auto'
    const runId = crypto.randomUUID()
    const createdAt = Date.now()
    const baseMessages = messages.filter((message) => !message.pending)
    const user: ConversationMessage = { id: `user-${runId}`, role: 'user', text: prompt, mode: 'text', ...(options?.skillId ? { activatedSkillIds: [options.skillId] } : {}), createdAt }
    const assistant: ConversationMessage = { id: `assistant-${runId}`, role: 'assistant', text: '', pending: true, pendingStage: 'preparing', reasoningEffort: requestedEffort, mode: 'text', createdAt: createdAt + 1 }
    
    if (baseMessages.length === 0 && onAutoTitle) {
      onAutoTitle(prompt.slice(0, 24))
    }

    setMessagesState([...baseMessages, user, assistant])
    onSessionUpdate?.({ messages: [...baseMessages, user, assistant] })
    setBusyState(true)
    setActivityLabel('正在准备上下文')
    activeRequest.current = runId
    onStopReady?.(() => { void agentApi.cancel(runId) })
    try {
      const compiledMemories = await fetchCompiledMemories(libraryApi, { includeProject: options?.projectContext ?? false }).catch(() => compileMemories({}))
      activeMemoryRefs.current = compiledMemories.auditRefs
      const memoryContext = formatCompiledMemoriesForPrompt(compiledMemories)
      const visibleSkillContexts = retainSkillContextsAfterCompaction(skillContexts, baseMessages, compaction)
      const preparedContext = await prepareConversationContext({
        messages: baseMessages,
        ...(compaction ? { state: compaction } : {}),
        fixedContext: [prompt, memoryContext, ...visibleSkillContexts.map((skill) => skill.instructions), ...(options?.contextDocuments ?? []).map((document) => document.text)],
        onCompactionStart: async () => {
          setMessages((current) => current.map((message) => message.id === assistant.id ? { ...message, pendingStage: 'compacting' } : message))
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
        },
        summarize: (input) => summarizeConversationWithModel(textApi, requestedModelId, input),
      })
      const submittedSkillContexts = retainSkillContextsAfterCompaction(visibleSkillContexts, baseMessages, preparedContext.state)
      setMessages((current) => current.map((message) => message.id === assistant.id ? { ...message, pendingStage: 'waiting' } : message))
      const referenceAssets = options?.referenceAssets ?? []
      const result = await agentApi.run({
        runId,
        conversationId,
        messageId: user.id,
        mode: 'text',
        modelProfileId: requestedModelId,
        prompt,
        ...(options?.search ? { search: true } : {}),
        projectContext: options?.projectContext ?? false,
        ...(options?.skillId ? { skillId: options.skillId } : {}),
        ...(submittedSkillContexts.length ? { skillContexts: submittedSkillContexts } : {}),
        ...(options?.contextDocuments?.length ? { attachments: options.contextDocuments } : {}),
        ...(referenceAssets.length ? { references: referenceAssets.map(referenceAssetToImageReference) } : {}),
        ...(preparedContext.messages.length ? { contextMessages: preparedContext.messages } : {}),
        ...(requestedEffort ? { reasoningEffort: requestedEffort } : {}),
        ...(memoryContext ? { memoryContext } : {}),
        ...(compiledMemories.auditRefs.length ? { memoryRefs: compiledMemories.auditRefs } : {}),
      })
      const fallbackText = result.status === 'cancelled' ? '已停止生成。' : result.status === 'failed' ? '文本模型请求失败' : '已完成。'
      const finalText = result.text.trim() || fallbackText
      const toolContext = buildAgentToolContext(result)
      const finalAssistant: ConversationMessage = {
        ...assistant,
        text: finalText,
        pending: false,
        ...(toolContext ? { toolContext } : {}),
        ...(result.status === 'failed' ? { error: finalText } : {}),
        ...(result.status === 'cancelled' ? { cancelled: true } : {}),
        ...(result.searchResults?.results.length ? { sources: result.searchResults.results } : {}),
        ...(result.promptResults?.length ? { promptResults: result.promptResults } : {}),
        agentSteps: result.steps,
        ...(result.usage ? { usage: result.usage } : {}),
      }
      const finalMessages = [...baseMessages, user, finalAssistant]
      setMessagesState(finalMessages)
      onSessionUpdate?.({
        messages: finalMessages,
        ...(result.skillContexts ? { skillContexts: result.skillContexts } : {}),
        ...(preparedContext.state ? { compaction: preparedContext.state } : {}),
      })
      if (result.status === 'completed' && activeMemoryRefs.current.length > 0) void touchUsedMemories(libraryApi, activeMemoryRefs.current)
      return result.status === 'completed'
    } catch (error) {
      const message = error instanceof Error ? error.message : '文本模型请求失败'
      const failedMessages = [...baseMessages, user, { ...assistant, text: message, pending: false, error: message }]
      setMessagesState(failedMessages)
      onSessionUpdate?.({ messages: failedMessages })
      return false
    } finally {
      if (activeRequest.current === runId) activeRequest.current = null
      setActivityLabel(undefined)
      setBusyState(false)
      onStopReady?.(undefined)
    }
  }, [agentApi, busy, compaction, conversationId, libraryApi, messages, modelId, onAutoTitle, onSessionUpdate, onStopReady, setBusyState, setMessages, skillContexts, textApi])

  useEffect(() => { onSubmitReady?.(submit) }, [onSubmitReady, submit])

  const [docModal, setDocModal] = useState<{ open: boolean; title: string; content: string } | null>(null)
  const [memoryModal, setMemoryModal] = useState<{ open: boolean; title: string; content: string; source: string } | null>(null)

  const openSaveDocument = useCallback((message: ConversationMessage) => {
    const firstHeading = message.text.match(/^#+\s*(.+)$/m)?.[1]?.trim()
    const firstLine = message.text.split(/\n+/)[0]?.trim()
    const titleCandidate = firstHeading || firstLine || '文本回答'
    const title = titleCandidate.length > 50 ? `${titleCandidate.slice(0, 50)}…` : titleCandidate
    setDocModal({
      open: true,
      title,
      content: message.text,
    })
  }, [])

  const openSaveMemory = useCallback((message: ConversationMessage) => {
    const firstHeading = message.text.match(/^#+\s*(.+)$/m)?.[1]?.trim()
    const firstLine = message.text.split(/\n+/)[0]?.trim()
    const titleCandidate = firstHeading || firstLine || '对话记忆'
    const title = titleCandidate.length > 40 ? `${titleCandidate.slice(0, 40)}…` : titleCandidate
    setMemoryModal({
      open: true,
      title,
      content: message.text,
      source: '从对话提炼',
    })
  }, [])

  return (
    <div className="conversation text-thread">
      {savedToast && (
        <div className="memory-saved-toast" role="status">
          <Brain size={14} />
          <span>{savedToast}</span>
        </div>
      )}
      <div className="date-divider"><span>会话开始</span></div>
      {compaction && <CompactionStatusCard state={compaction} />}
      {messages.length === 0 && (
        <div className="text-conversation-empty">
          <div className="empty-sparkle-icon"><Bot size={26} /></div>
          <h3>AI 文本创意控制台</h3>
          <p>支持多轮对话、项目上下文理解、镜头构思与提示词深度精修</p>
          <div className="starter-chips">
            <button type="button" onClick={() => void submit('为赛博朋克雨夜重逢场景编写 3 组分镜提示词')}>
              “为赛博朋克雨夜重逢场景编写 3 组分镜提示词”
            </button>
            <button type="button" onClick={() => void submit('设计一个银发天使角色的外观特征、光翼与服饰细节')}>
              “设计银发天使角色的外观特征与细节”
            </button>
            <button type="button" onClick={() => void submit('梳理电影级胶片感光影调色要点与摄影机参数')}>
              “梳理电影级光影调色要点与摄影机参数”
            </button>
          </div>
        </div>
      )}
      {messages.map((message, index) =>
        message.role === 'assistant' ? (
          <div className="conversation-turn" key={message.id}>
            <AssistantMessage
              message={message}
              modelName={modelLabel(modelId, modelName)}
              activityLabel={message.pending ? activityLabel : undefined}
              onDocument={() => openSaveDocument(message)}
              onPrompt={() => onSavePrompt?.(message.text)}
              onMemory={() => openSaveMemory(message)}
            />
            {renderMessageResults?.(message)}
          </div>
        ) : (
          <div className="conversation-turn" key={message.id}>
            <div className="message user"><p>{message.text}</p></div>
            {onEditMessage && canReEditTurn(messages, index) && <MessageReEditAction onEdit={() => onEditMessage(message.text)} />}
            {renderMessageResults?.(message)}
          </div>
        ),
      )}
      <ConversationScrollAnchor version={`${messages.length}:${messages.at(-1)?.text ?? ''}:${busy}`} />

      {docModal?.open && (
        <DocumentEditorModal
          open={docModal.open}
          initialTitle={docModal.title}
          initialContent={docModal.content}
          initialFormat="md"
          onClose={() => setDocModal(null)}
          onSaved={() => {
            setSavedToast('已成功保存至项目文档')
            setTimeout(() => setSavedToast(null), 3000)
          }}
        />
      )}
      {memoryModal?.open && (
        <MemoryEditorModal
          open={memoryModal.open}
          initialTitle={memoryModal.title}
          initialContent={memoryModal.content}
          initialScope="project"
          initialSource={memoryModal.source}
          onClose={() => setMemoryModal(null)}
          onSaved={() => {
            setSavedToast('已成功保存至项目记忆，并在后续对话中生效')
            setTimeout(() => setSavedToast(null), 3000)
          }}
        />
      )}
    </div>
  )
}

export default TextConversation
