import { useEffect, useRef, useState } from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'
import { AtSign, FileText, Gauge, Globe2, Paperclip, Send, ShieldCheck, Sparkles, Square, WandSparkles, X } from 'lucide-react'
import type { Mode } from '../../mock-data'
import { PromptOptimizeWindow } from '../prompt-optimizer/PromptOptimizeWindow'
import { promptSelectionEvent } from '../../renderer/library/prompt-selection'
import { getSettingsApi } from '../../renderer/settings/settings-api'
import type { GlobalSettings, ModelProfile } from '../../shared/contracts/settings'
import type { AgentPermission } from '../../shared/contracts/agent'
import { getModelChannelInfo, groupModelsByChannel } from '../../renderer/settings/model-channel'
import { AIInputComposerShell } from './AIInputComposerShell'
import { CountDropdown } from './CountDropdown'
import { BatchModeDropdown, type BatchMode } from './BatchModeDropdown'
import { GenerationTypeDropdown } from './GenerationTypeDropdown'
import { ParametersDropdown, type ImageParameters } from './ParametersDropdown'
import { ImageSettingsPopover } from './ImageSettingsPopover'
import { ModelDropdown } from './ModelDropdown'
import { PromptQuickPicker } from './PromptQuickPicker'
import type { TextReasoningEffort } from '../../shared/contracts/text'
import type { ReferenceAsset } from '../../shared/reference-images'
import { MAX_CONTEXT_ATTACHMENTS, type ProjectContextDocument } from '../../shared/contracts/context'
import { getSupportedReasoningEfforts } from '../../shared/models/reasoning'
import { ReferenceAttachmentList, ReferenceImagePicker } from '../reference-images'
import { getSelectedAssets, publishSelectedAssets, removeReferenceAsset, subscribeSelectedAssets } from '../../renderer/library/asset-selection'
import { ContextAttachmentList } from './ContextAttachmentList'
import { getSkillApi } from '../../renderer/skills/skill-api'
import { SkillCommandMenu } from './SkillCommandMenu'
import { clearSkillCommandDraft, eligibleComposerSkills, parseSkillCommand, resolveSkillMenuKey, skillCommandQuery } from './skill-commands'
import './ai-input-bar.css'

const defaultParameters: ImageParameters = {
  ratio: '16:9 横版',
  resolution: '2K',
  quality: '自动',
  format: 'PNG',
  background: '自动',
}

function ComposerTip({ label, children }: { label: string; children: React.ReactElement }) {
  return <Tooltip.Root delayDuration={220}><Tooltip.Trigger asChild>{children}</Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="tooltip" side="top" sideOffset={7}>{label}</Tooltip.Content></Tooltip.Portal></Tooltip.Root>
}

function ToolButton({ label, active = false, pressed, children, onClick, disabled = false }: { label: string; active?: boolean; pressed?: boolean; children: React.ReactNode; onClick?: () => void; disabled?: boolean }) {
  return <ComposerTip label={label}><button type="button" className={`ai-input-bar__tool-button ${active ? 'active' : ''}`} aria-label={label} aria-pressed={pressed} onClick={onClick} disabled={disabled}>{children}</button></ComposerTip>
}

const allAgentWritePermissions: AgentPermission[] = [
  'write-project-documents',
  'write-project-memories',
  'write-personal-prompts',
]

export function getAgentWritePermissions(enabled: boolean): AgentPermission[] {
  return enabled ? [...allAgentWritePermissions] : []
}

export function resolveComposerImageCount(mode: Mode, value: string, explicitlySelected: boolean): number | undefined {
  if (mode === 'text' || (mode === 'agent' && !explicitlySelected)) return undefined
  return Number.parseInt(value, 10) || 1
}

export function resolveComposerEditDraftValue(current: string, previousEditId: string | undefined, editDraft: { id: string; text: string } | undefined): string {
  if (editDraft) return editDraft.text
  return previousEditId ? '' : current
}

export interface ComposerSubmitOptions {
  search?: boolean
  projectContext?: boolean
  permissions?: AgentPermission[]
  count?: number
  batchMode?: BatchMode
  textModelId?: string
  imageModelId?: string
  parameters?: ImageParameters
  reasoningEffort?: TextReasoningEffort
  requireConfirmation?: boolean
  skillId?: string
  referenceAssets?: ReferenceAsset[]
  contextDocuments?: ProjectContextDocument[]
}

export type ComposerSubmitHandler = (value: string, options?: ComposerSubmitOptions) => Promise<boolean>

export function isContextCompactionCommand(value: string): boolean {
  return /^\/(?:压缩|compact)$/i.test(value.trim())
}

export async function submitComposerDraft(
  draft: string,
  setDraft: React.Dispatch<React.SetStateAction<string>>,
  submit: () => Promise<boolean>,
): Promise<boolean> {
  setDraft('')
  let accepted = false
  try {
    accepted = await submit()
    return accepted
  } finally {
    if (!accepted) setDraft((current) => current || draft)
  }
}

export function WorkbenchComposer({ mode, onMode, agentWriteEnabled = true, onAgentWriteEnabledChange, onSubmit, onStop, onOpenPrompts, onCompactContext, contextUsage, busy = false, compacting = false, editDraft, onCancelEdit, onEditSubmitted }: { mode: Mode; onMode: (mode: Mode) => void; agentWriteEnabled?: boolean; onAgentWriteEnabledChange?: (enabled: boolean) => void; onSubmit?: ComposerSubmitHandler; onStop?: () => void; onOpenPrompts?: () => void; onCompactContext?: () => Promise<boolean>; contextUsage?: { usedTokens: number; capacityTokens: number; percent: number; estimated?: boolean; reasoningTokens?: number }; busy?: boolean; compacting?: boolean; editDraft?: { id: string; text: string }; onCancelEdit?: () => void; onEditSubmitted?: () => void }) {
  const [value, setValue] = useState(editDraft?.text ?? '')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const previousEditDraftId = useRef(editDraft?.id)
  const [quickPickerOpen, setQuickPickerOpen] = useState(false)
  const [projectContextEnabled, setProjectContextEnabled] = useState(mode === 'agent')
  const [optimizerOpen, setOptimizerOpen] = useState(false)
  const [installedSkills, setInstalledSkills] = useState<Awaited<ReturnType<ReturnType<typeof getSkillApi>['list']>>>([])
  const [skillMenuIndex, setSkillMenuIndex] = useState(0)
  const [parameters, setParameters] = useState(defaultParameters)
  const [count, setCount] = useState('1 个')
  const [countExplicitlySelected, setCountExplicitlySelected] = useState(false)
  const [batchMode, setBatchMode] = useState<BatchMode>('smart')
  const [searchEnabled, setSearchEnabled] = useState(false)
  const [settings, setSettings] = useState<GlobalSettings | null>(null)
  const [textModelId, setTextModelId] = useState('')
  const [imageModelId, setImageModelId] = useState('')
  const [reasoningEffort, setReasoningEffort] = useState<TextReasoningEffort>('auto')
  const [agentAutoExecute, setAgentAutoExecute] = useState(() => localStorage.getItem('latent-studio:agent-execution') !== 'confirm')
  const [referenceAssets, setReferenceAssets] = useState<ReferenceAsset[]>(() => getSelectedAssets())
  const [contextDocuments, setContextDocuments] = useState<ProjectContextDocument[]>([])
  const [attachmentStatus, setAttachmentStatus] = useState<{ text: string; error?: boolean } | null>(null)
  const [commandStatus, setCommandStatus] = useState<{ text: string; error?: boolean } | null>(null)
  const hasImageOutput = mode === 'image' || mode === 'agent'
  const skillQuery = (mode === 'text' || mode === 'agent') && !isContextCompactionCommand(value) ? skillCommandQuery(value) : null
  const filteredSkills = eligibleComposerSkills(installedSkills).filter((skill) => {
    if (skillQuery === null) return false
    const query = skillQuery.toLocaleLowerCase()
    return !query || skill.name.toLocaleLowerCase().includes(query) || skill.displayName.toLocaleLowerCase().includes(query)
  })
  const skillMenuOpen = skillQuery !== null
  const selectSkill = (skill: (typeof filteredSkills)[number] | undefined) => {
    if (!skill) return
    setValue(`/${skill.name} `)
    setSkillMenuIndex(0)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }
  const toggleQuickPicker = () => {
    const nextOpen = !quickPickerOpen
    if (nextOpen) setValue((current) => clearSkillCommandDraft(current))
    setQuickPickerOpen(nextOpen)
  }

  useEffect(() => subscribeSelectedAssets(setReferenceAssets), [])

  useEffect(() => {
    setValue((current) => resolveComposerEditDraftValue(current, previousEditDraftId.current, editDraft))
    previousEditDraftId.current = editDraft?.id
    if (editDraft) requestAnimationFrame(() => textareaRef.current?.focus())
  }, [editDraft])

  useEffect(() => {
    setProjectContextEnabled(mode === 'agent')
  }, [mode])

  useEffect(() => {
    if (mode !== 'text' && mode !== 'agent') return
    void getSkillApi().list().then(setInstalledSkills).catch(() => setInstalledSkills([]))
  }, [mode])

  useEffect(() => {
    let disposed = false
    const loadSettings = async () => {
      try {
        const next = await getSettingsApi().get()
        if (disposed) return
        setSettings(next)
        const textDefault = next.defaultTextModelId ?? next.models.find((model) => model.kind === 'text')?.id ?? ''
        const imageDefault = next.defaultImageModelId ?? next.models.find((model) => model.kind === 'image')?.id ?? ''
        setTextModelId((prev) => (prev && next.models.some((m) => m.id === prev) ? prev : textDefault))
        setImageModelId((prev) => (prev && next.models.some((m) => m.id === prev) ? prev : imageDefault))
      } catch {}
    }
    void loadSettings()
    const onSettingsUpdated = () => { void loadSettings() }
    window.addEventListener('latent-studio:settings-updated', onSettingsUpdated)
    return () => {
      disposed = true
      window.removeEventListener('latent-studio:settings-updated', onSettingsUpdated)
    }
  }, [])

  useEffect(() => {
    const onEffortChanged = (event: Event) => {
      const nextEffort = (event as CustomEvent<TextReasoningEffort>).detail
      if (nextEffort && nextEffort !== reasoningEffort) {
        setReasoningEffort(nextEffort)
      }
    }
    window.addEventListener('latent-studio:reasoning-effort-updated', onEffortChanged)
    return () => window.removeEventListener('latent-studio:reasoning-effort-updated', onEffortChanged)
  }, [reasoningEffort])

  // Restore only a choice that the selected connection can actually send.
  useEffect(() => {
    if (!textModelId) return
    const model = settings?.models.find((item) => item.id === textModelId)
    const providerType = settings?.connections.find((item) => item.id === model?.connectionId)?.providerType
    try {
      const raw = localStorage.getItem('latent-studio:reasoning-history')
      const hist = raw ? JSON.parse(raw) : {}
      const remembered = hist[textModelId] as TextReasoningEffort | undefined
      const supported = model && providerType !== 'openai-compatible'
        ? getSupportedReasoningEfforts({ modelId: model.modelId, capabilities: model.capabilities, providerType }).supported
        : ['auto', 'low', 'medium', 'high', 'xhigh']
      setReasoningEffort(remembered && supported.includes(remembered) ? remembered : 'auto')
    } catch { setReasoningEffort('auto') }
  }, [textModelId, settings])

  const handleReasoningEffortChange = (effort: TextReasoningEffort) => {
    setReasoningEffort(effort)
    if (textModelId) {
      try {
        const key = 'latent-studio:reasoning-history'
        const raw = localStorage.getItem(key)
        const hist = raw ? JSON.parse(raw) : {}
        hist[textModelId] = effort
        localStorage.setItem(key, JSON.stringify(hist))
      } catch {}
    }
    window.dispatchEvent(new CustomEvent('latent-studio:reasoning-effort-updated', { detail: effort }))

  }

  // Textarea expands vertically based on content without changing width
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    const scrollHeight = el.scrollHeight
    const minHeight = 64
    const maxHeight = 240
    if (scrollHeight > maxHeight) {
      el.style.height = `${maxHeight}px`
      el.style.overflowY = 'auto'
    } else {
      el.style.height = `${Math.max(minHeight, scrollHeight)}px`
      el.style.overflowY = 'hidden'
    }
  }, [value])

  useEffect(() => {
    const onPrompt = (event: Event) => { const prompt = (event as CustomEvent<string>).detail; if (typeof prompt === 'string') setValue((current) => current ? `${current}\n${prompt}` : prompt) }
    window.addEventListener(promptSelectionEvent, onPrompt)
    return () => window.removeEventListener(promptSelectionEvent, onPrompt)
  }, [])
  const changeModel = (kind: 'text' | 'image', id: string) => {
    if (kind === 'text') setTextModelId(id); else setImageModelId(id)
    window.dispatchEvent(new CustomEvent('latent-studio:model-selection', { detail: { kind, id, name: settings?.models.find((model) => model.id === id)?.name } }))
  }
  const handleParametersChange = (next: ImageParameters) => {
    setParameters(next)
    window.dispatchEvent(new CustomEvent('latent-studio:parameters-updated', { detail: next }))
  }

  const handleAgentAutoExecute = (enabled: boolean) => {
    setAgentAutoExecute(enabled)
    localStorage.setItem('latent-studio:agent-execution', enabled ? 'auto' : 'confirm')
  }

  const chooseAttachments = async () => {
    const api = typeof window !== 'undefined' ? window.latentStudio?.context : undefined
    if (!api) { setAttachmentStatus({ text: '桌面应用中才能上传附件', error: true }); return }
    setAttachmentStatus(null)
    try {
      const incoming = await api.chooseAndReadAttachments()
      if (!incoming.length) return
      setContextDocuments((current) => {
        const merged = [...current]
        for (const document of incoming) {
          const duplicate = merged.some((item) => item.summary.fileName === document.summary.fileName && item.summary.byteLength === document.summary.byteLength)
          if (!duplicate && merged.length < MAX_CONTEXT_ATTACHMENTS) merged.push(document)
        }
        return merged
      })
      setAttachmentStatus({ text: `已选择 ${incoming.length} 个附件` })
    } catch (cause) {
      setAttachmentStatus({ text: cause instanceof Error ? cause.message : '附件上传失败', error: true })
    }
  }

  const chooseProjectFile = async () => {
    const api = typeof window !== 'undefined' ? window.latentStudio?.context : undefined
    if (!api) { setAttachmentStatus({ text: '桌面应用中才能读取项目文件', error: true }); return }
    setAttachmentStatus(null)
    try {
      const document = await api.chooseAndReadProjectFile()
      if (!document) return
      setContextDocuments((current) => current.some((item) => item.summary.relativePath === document.summary.relativePath)
        ? current
        : [...current, document].slice(0, MAX_CONTEXT_ATTACHMENTS))
      setAttachmentStatus({ text: `已读取 ${document.summary.fileName}` })
    } catch (cause) {
      setAttachmentStatus({ text: cause instanceof Error ? cause.message : '项目文件读取失败', error: true })
    }
  }

  const submit = async () => {
    if (isContextCompactionCommand(value)) {
      if (busy || compacting || !onCompactContext) return
      setCommandStatus(null)
      const accepted = await onCompactContext()
      if (accepted) {
        setValue('')
        setCommandStatus({ text: '上下文压缩完成，占用已更新' })
      } else {
        setCommandStatus({ text: '当前上下文内容较少，暂时无需压缩', error: true })
      }
      return
    }
    const command = mode === 'text' || mode === 'agent' ? parseSkillCommand(value, installedSkills) : { prompt: value.trim() }
    const prompt = command.prompt
    if (!prompt || busy || !onSubmit) return
    const imageCount = resolveComposerImageCount(mode, count, countExplicitlySelected)
    const accepted = await submitComposerDraft(value, setValue, () => onSubmit(
      prompt,
      mode === 'text'
        ? {
            ...(searchEnabled ? { search: true } : {}),
            projectContext: projectContextEnabled,
            ...(textModelId ? { textModelId } : {}),
            ...(reasoningEffort ? { reasoningEffort } : {}),
            ...(command.skillId ? { skillId: command.skillId } : {}),
            ...(referenceAssets.length ? { referenceAssets: [...referenceAssets] } : {}),
            ...(contextDocuments.length ? { contextDocuments: [...contextDocuments] } : {}),
          }
        : {
            ...(imageCount === undefined ? {} : { count: imageCount }),
            batchMode,
            parameters,
            projectContext: projectContextEnabled,
            ...(mode === 'agent' && agentWriteEnabled ? { permissions: getAgentWritePermissions(true) } : {}),
            ...(textModelId ? { textModelId } : {}),
            ...(imageModelId ? { imageModelId } : {}),
            ...(reasoningEffort ? { reasoningEffort } : {}),
            ...(referenceAssets.length ? { referenceAssets: [...referenceAssets] } : {}),
            ...(contextDocuments.length ? { contextDocuments: [...contextDocuments] } : {}),
            ...(mode === 'agent' ? { requireConfirmation: !agentAutoExecute } : {}),
            ...(command.skillId ? { skillId: command.skillId } : {}),
          }
    ))
    if (accepted) {
      if (editDraft) onEditSubmitted?.()
      setCount('1 个')
      setCountExplicitlySelected(false)
      setBatchMode('smart')
      if (referenceAssets.length) publishSelectedAssets([])
      if (contextDocuments.length) setContextDocuments([])
      setAttachmentStatus(null)
    }
  }
  const placeholder = mode === 'text'
    ? '研究、写作或整理项目资料...'
    : mode === 'image'
      ? '描述画面主体、构图、光线与风格...'
      : '和 Agent 对话，按需要搜索、调用 Skill 或生成图片...'
  const cancelEdit = () => {
    setValue('')
    onCancelEdit?.()
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  const leftTools = <>
    <ToolButton label="上传附件" onClick={() => void chooseAttachments()} disabled={busy}><Paperclip size={16} /></ToolButton>
    {mode === 'text' && <ToolButton label="读取项目文件" onClick={() => void chooseProjectFile()} disabled={busy}><FileText size={16} /></ToolButton>}
    <ReferenceImagePicker assets={referenceAssets} disabled={busy} onChange={publishSelectedAssets} />
    <ToolButton
      label={quickPickerOpen ? '收起快捷提示词' : '快捷提示词灵感'}
      active={quickPickerOpen}
      onClick={toggleQuickPicker}
    >
      <WandSparkles size={16} />
    </ToolButton>
    {hasImageOutput && <ToolButton label="提示词优化" active={optimizerOpen} onClick={() => setOptimizerOpen(current => !current)}><Sparkles size={16} /></ToolButton>}
    <ToolButton
      label={projectContextEnabled ? '已关联项目上下文（点击关闭）' : '未关联项目上下文（点击开启）'}
      active={projectContextEnabled}
      onClick={() => setProjectContextEnabled((prev) => !prev)}
    >
      <AtSign size={16} />
    </ToolButton>
    {mode === 'agent' && <ToolButton
      label={agentWriteEnabled ? 'Agent 写入权限已开启（点击关闭）' : 'Agent 写入权限已关闭（点击开启）'}
      active={agentWriteEnabled}
      pressed={agentWriteEnabled}
      onClick={() => onAgentWriteEnabledChange?.(!agentWriteEnabled)}
      disabled={busy}
    ><ShieldCheck size={16} /></ToolButton>}
    {mode === 'text' && <ToolButton label={searchEnabled ? '联网搜索已开启' : '开启联网搜索'} active={searchEnabled} onClick={() => setSearchEnabled(current => !current)}><Globe2 size={16} /></ToolButton>}
  </>

  const controls = <>
    {mode === 'agent' && <label className="agent-execution-toggle" title={agentAutoExecute ? '图片任务将直接进入队列' : '图片任务会等待确认'}><input type="checkbox" checked={agentAutoExecute} onChange={(event) => handleAgentAutoExecute(event.target.checked)} /><span aria-hidden="true"><i /></span><b>{agentAutoExecute ? '自动执行' : '确认后执行'}</b></label>}
    <GenerationTypeDropdown value={mode} onSelect={onMode} />
    {(mode === 'text' || mode === 'image' || mode === 'agent') && (
      <ModelDropdown
        kind="文本模型"
        name="未配置文本模型"
        models={settings?.models.filter((model) => model.kind === 'text') ?? []}
        settings={settings}
        value={textModelId}
        onChange={(id) => changeModel('text', id)}
        reasoningEffort={reasoningEffort}
        onChangeReasoningEffort={handleReasoningEffortChange}
      />
    )}
    {hasImageOutput && (
      <ImageSettingsPopover
        imageModelId={imageModelId}
        imageModels={settings?.models.filter((model) => model.kind === 'image') ?? []}
        onSelectImageModel={(id) => changeModel('image', id)}
        settings={settings}
        parameters={parameters}
        onChangeParameters={handleParametersChange}
        count={count}
        onSelectCount={(nextCount) => {
          setCount(nextCount)
          setCountExplicitlySelected(true)
        }}
        batchMode={batchMode}
        onSelectBatchMode={setBatchMode}
        agentMode={mode === 'agent'}
      />
    )}
  </>
  const contextUsageEstimated = Boolean(contextUsage?.estimated && contextUsage.usedTokens > 0)

  return <div className="composer-wrap workbench-composer">
    <AIInputComposerShell
      preview={(editDraft || contextDocuments.length || referenceAssets.length || attachmentStatus || commandStatus) ? <div className="composer-preview-stack">
        {editDraft && <div className="composer-editing-status" role="status"><span>重新编辑已停止的消息</span><button type="button" aria-label="取消重新编辑" onClick={cancelEdit}><X size={13} />取消</button></div>}
        <ContextAttachmentList documents={contextDocuments} onRemove={(index) => setContextDocuments((current) => current.filter((_, itemIndex) => itemIndex !== index))} />
        <ReferenceAttachmentList assets={referenceAssets} onRemove={(id) => publishSelectedAssets(removeReferenceAsset(referenceAssets, id))} />
        {attachmentStatus && <p className={`composer-attachment-status ${attachmentStatus.error ? 'error' : ''}`} role={attachmentStatus.error ? 'alert' : 'status'}>{attachmentStatus.text}</p>}
        {commandStatus && <p className={`composer-attachment-status ${commandStatus.error ? 'error' : ''}`} role={commandStatus.error ? 'alert' : 'status'}>{commandStatus.text}</p>}
      </div> : undefined}
      textarea={<textarea ref={textareaRef} className="ai-input-bar__textarea" rows={2} value={value} onChange={event => { setValue(event.target.value); setSkillMenuIndex(0); if (event.target.value.startsWith('/')) setQuickPickerOpen(false) }} onKeyDown={event => {
        if (skillMenuOpen) {
          const action = resolveSkillMenuKey(event.key, filteredSkills.length, skillMenuIndex, event.shiftKey)
          if (action) {
            event.preventDefault()
            if (action.type === 'dismiss') setValue('')
            if (action.type === 'move') setSkillMenuIndex(action.index)
            if (action.type === 'select') selectSkill(filteredSkills[action.index])
            return
          }
        }
        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit() }
      }} placeholder={placeholder} aria-label="输入提示词" aria-controls={skillMenuOpen ? 'skill-command-menu' : undefined} aria-expanded={skillMenuOpen} aria-activedescendant={skillMenuOpen && filteredSkills.length ? `skill-command-option-${skillMenuIndex}` : undefined} disabled={busy} />}
      leftTools={leftTools}
      controls={controls}
      sendButton={busy && onStop
        ? (
          <ComposerTip label="停止生成">
            <button
              type="button"
              className="ai-input-bar__send-btn ai-input-bar__send-btn--stop"
              aria-label="停止生成"
              onClick={onStop}
            >
              <Square size={14} fill="currentColor" />
            </button>
          </ComposerTip>
        )
        : (
          <ComposerTip label={value.trim() ? "发送 (Enter)" : "请输入提示词"}>
            <button
              type="button"
              className={`ai-input-bar__send-btn ${value.trim() && !busy ? 'active' : ''}`}
              aria-label="发送"
              onClick={() => void submit()}
              disabled={busy || compacting || !value.trim()}
            >
              <Send size={16} />
            </button>
          </ComposerTip>
        )}
    />
    <div className="composer-footnote">
      <span>{mode === 'agent' ? `Agent 会自主选择 Skill、调用工具并${agentAutoExecute ? '直接执行' : '等待确认'}` : mode === 'image' ? '提示词与图片参数将随任务保存' : '可读取附件与参考图，输入 / 调用 Skill'}</span>
      <span className="composer-footnote__end">
        {contextUsage && (
          <ComposerTip label={`${contextUsage.usedTokens === 0 ? '尚无上下文' : contextUsageEstimated ? '本地估算' : '供应商统计'}：上下文 ${contextUsage.percent}% 已用；${contextUsage.usedTokens.toLocaleString('zh-CN')} / ${contextUsage.capacityTokens.toLocaleString('zh-CN')} tokens${contextUsage.reasoningTokens ? `；含推理 ${contextUsage.reasoningTokens.toLocaleString('zh-CN')} tokens` : ''}`}>
            <button type="button" className="context-usage-button" aria-label={`上下文${contextUsageEstimated ? '估算' : ''}已用 ${contextUsage.percent}%`} onClick={() => setValue('/压缩')} disabled={busy || compacting}>
              <span className="context-usage-ring" style={{ '--context-percent': `${contextUsage.percent * 3.6}deg` } as React.CSSProperties}><Gauge size={11} /></span>
              <span>{compacting ? '压缩中' : `上下文${contextUsageEstimated ? '约 ' : ' '}${contextUsage.percent}%`}</span>
            </button>
          </ComposerTip>
        )}
        <span>Enter 发送 · Shift + Enter 换行</span>
      </span>
    </div>
    {skillMenuOpen && <SkillCommandMenu skills={filteredSkills} activeIndex={skillMenuIndex} onActiveIndex={setSkillMenuIndex} onSelect={selectSkill} />}
    <PromptQuickPicker
      open={quickPickerOpen}
      onClose={() => setQuickPickerOpen(false)}
      onInsertPrompt={(text) =>
        setValue((prev) => {
          if (!prev.trim()) return text
          const trimmed = prev.trim()
          if (trimmed.endsWith(',') || trimmed.endsWith('，')) {
            return `${trimmed} ${text}`
          }
          return `${trimmed}, ${text}`
        })
      }
      onOpenFullLibrary={() => {
        setQuickPickerOpen(false)
        onOpenPrompts?.()
      }}
    />
    <PromptOptimizeWindow open={optimizerOpen} onOpenChange={setOptimizerOpen} originalPrompt={value} onApply={setValue} workbenchTextModelId={textModelId} />
  </div>
}
