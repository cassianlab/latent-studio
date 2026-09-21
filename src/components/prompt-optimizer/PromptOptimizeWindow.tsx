import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import * as Tooltip from '@radix-ui/react-tooltip'
import { Check, Clipboard, Columns2, History, Sparkles, X } from 'lucide-react'
import './prompt-optimize-window.css'
import { getSettingsApi } from '../../renderer/settings/settings-api'
import { getTextApi } from '../../renderer/settings/model-api'
import type { GlobalSettings, ModelProfile } from '../../shared/contracts/settings'
import { formatModelCapsuleLabel } from '../../renderer/settings/model-channel'
import { ProviderModelPicker } from '../ai-input-bar/ProviderModelPicker'

function WindowTip({ label, children }: { label: string; children: React.ReactElement }) {
  return <Tooltip.Root delayDuration={220}><Tooltip.Trigger asChild>{children}</Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="tooltip" side="bottom" sideOffset={7}>{label}</Tooltip.Content></Tooltip.Portal></Tooltip.Root>
}

const optimizedExample = '雨夜便利店内，林默身穿深灰风衣，左眉短疤清晰可辨；正面中景，玻璃倒影将重逢的两人分隔在画面两侧。湿地反光，低饱和暖高光，35mm 电影颗粒，克制真实，避免蓝紫霓虹与赛博朋克元素。'

export function resolveOptimizerModelId(settings: GlobalSettings, workbenchTextModelId?: string): string | null {
  if (!workbenchTextModelId) return settings.defaultTextModelId && settings.models.some((model) => model.id === settings.defaultTextModelId && model.kind === 'text')
    ? settings.defaultTextModelId
    : null
  return settings.models.some((model) => model.id === workbenchTextModelId && model.kind === 'text') ? workbenchTextModelId : null
}

export function PromptOptimizeWindow({ open, onOpenChange, originalPrompt, onApply, workbenchTextModelId }: { open: boolean; onOpenChange: (open: boolean) => void; originalPrompt: string; onApply: (prompt: string) => void; workbenchTextModelId?: string }) {
  const [currentPrompt, setCurrentPrompt] = useState(originalPrompt)
  const [requirements, setRequirements] = useState('')
  const [optimizedDraft, setOptimizedDraft] = useState('')
  const [mode, setMode] = useState<'polish' | 'structured'>('polish')
  const [history, setHistory] = useState<'current' | 'requirements' | null>(null)
  const [copied, setCopied] = useState(false)
  const [modelId, setModelId] = useState<string | null>(null)
  const [textModels, setTextModels] = useState<ModelProfile[]>([])
  const [settings, setSettings] = useState<GlobalSettings | null>(null)
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const [modelOverride, setModelOverride] = useState(false)
  const [optimizing, setOptimizing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setCurrentPrompt(originalPrompt)
    setOptimizedDraft('')
    setHistory(null)
    setError(null)
    setModelPickerOpen(false)
    setModelOverride(false)
    void getSettingsApi().get().then((loadedSettings) => {
      setSettings(loadedSettings)
      const models = loadedSettings.models.filter((m) => m.kind === 'text')
      setTextModels(models)
      const selectedId = resolveOptimizerModelId(loadedSettings, workbenchTextModelId)
      setModelId(selectedId)
    }).catch(() => {
      setTextModels([])
      setModelId(null)
    })
  }, [open, originalPrompt, workbenchTextModelId])

  const optimize = async () => {
    if (!currentPrompt.trim() || optimizing) return
    if (!modelId) { setError('请先在模型设置中启用一个文本模型'); return }
    setOptimizing(true)
    setError(null)
    try {
      const format = mode === 'structured' ? '只返回 JSON 对象，字段至少包含 subject、scene、composition、lighting、style、avoid。' : '只返回一段可直接用于图片生成的中文提示词。'
      const result = await getTextApi().generate({ modelProfileId: modelId, request: { system: `你是 Latent Studio 的提示词优化器。保留用户明确的不变量，补全主体、场景、构图、光线、风格和限制条件，删除空泛形容词。${format}`, messages: [{ role: 'user', content: `当前提示词：\n${currentPrompt}\n\n补充要求：\n${requirements || '无'}` }], maxTokens: 1_200 } })
      if (!result.text.trim()) throw new Error('文本模型没有返回优化结果')
      setOptimizedDraft(result.text.trim())
    } catch (cause) { setError(cause instanceof Error ? cause.message : '提示词优化失败') } finally { setOptimizing(false) }
  }
  const copyDraft = async () => {
    if (!optimizedDraft) return
    await navigator.clipboard?.writeText(optimizedDraft)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }
  const apply = () => {
    const prompt = (optimizedDraft || currentPrompt).trim()
    if (!prompt) return
    onApply(prompt)
    onOpenChange(false)
  }

  return <Dialog.Root open={open} onOpenChange={onOpenChange} modal>
    <Dialog.Portal>
      <Dialog.Overlay className="prompt-optimize-overlay" />
      <Dialog.Content
        className={`prompt-optimize-window ${optimizedDraft ? 'has-result' : ''}`}
        onEscapeKeyDown={(event) => {
          if (!modelPickerOpen) return
          event.preventDefault()
          setModelPickerOpen(false)
        }}
      >
        <header className="prompt-optimize-window__header">
          <Dialog.Title><Sparkles size={20} />提示词优化</Dialog.Title>
          <div>
            <WindowTip label={optimizedDraft ? '收起优化结果' : '展开结果区'}><button type="button" aria-label={optimizedDraft ? '收起优化结果' : '展开结果区'} onClick={() => setOptimizedDraft(current => current ? '' : currentPrompt)}><Columns2 size={18} /></button></WindowTip>
            <WindowTip label="复制优化结果"><button type="button" aria-label="复制优化结果" disabled={!optimizedDraft} onClick={copyDraft}>{copied ? <Check size={18} /> : <Clipboard size={18} />}</button></WindowTip>
            <WindowTip label="关闭"><Dialog.Close asChild><button type="button" aria-label="关闭"><X size={21} /></button></Dialog.Close></WindowTip>
          </div>
        </header>
        <div className="prompt-optimize-window__body">
          <div className="prompt-optimize-window__form">
            <section>
              <div className="prompt-optimize-window__label"><label htmlFor="optimizer-current">当前提示词</label><button type="button" aria-label="当前提示词历史" onClick={() => setHistory(current => current === 'current' ? null : 'current')}><History size={17} /></button>{history === 'current' && <div className="prompt-optimize-window__history"><strong>历史提示词</strong><button type="button" onClick={() => { setCurrentPrompt(optimizedExample); setHistory(null) }}>雨夜便利店重逢，克制电影感...</button><button type="button" onClick={() => { setCurrentPrompt('林默站在便利店玻璃窗外，雨水模糊倒影。'); setHistory(null) }}>林默站在便利店玻璃窗外...</button></div>}</div>
              <textarea id="optimizer-current" value={currentPrompt} onChange={event => setCurrentPrompt(event.target.value)} placeholder="输入或编辑要优化的提示词..." />
            </section>
            <section className="requirements">
              <div className="prompt-optimize-window__label"><label htmlFor="optimizer-requirements">补充要求</label><button type="button" aria-label="补充要求历史" onClick={() => setHistory(current => current === 'requirements' ? null : 'requirements')}><History size={17} /></button>{history === 'requirements' && <div className="prompt-optimize-window__history"><strong>历史要求</strong><button type="button" onClick={() => { setRequirements('更电影感，补充镜头语言，强调主体与光线。'); setHistory(null) }}>更电影感，强调主体与光线</button><button type="button" onClick={() => { setRequirements('减少冗余，保留角色不变量。'); setHistory(null) }}>减少冗余，保留角色不变量</button></div>}</div>
              <textarea id="optimizer-requirements" value={requirements} onChange={event => setRequirements(event.target.value)} placeholder="例如：更电影感、补充镜头语言、减少冗余、强调主体与光线..." />
            </section>
          </div>
          {optimizedDraft && <section className="prompt-optimize-window__result"><div className="prompt-optimize-window__result-title"><strong>优化结果</strong><span>可继续编辑</span></div><textarea value={optimizedDraft} onChange={event => setOptimizedDraft(event.target.value)} />{error && <div className="dialog-error">{error}</div>}</section>}
        </div>
        <footer className="prompt-optimize-window__footer">
          <div className="prompt-optimize-window__modes">
            <button type="button" className={mode === 'polish' ? 'active' : ''} onClick={() => setMode('polish')}><Sparkles size={14} />普通润色</button>
            <button type="button" className={mode === 'structured' ? 'active' : ''} onClick={() => setMode('structured')}>结构化 JSON</button>
            <div className="prompt-optimize-window__model-picker-wrap">
              <button
                type="button"
                className="prompt-optimize-window__model-trigger"
                aria-label="选择优化文本模型"
                aria-expanded={modelPickerOpen}
                disabled={textModels.length === 0 || optimizing}
                onClick={() => setModelPickerOpen((current) => !current)}
              >
                {formatModelCapsuleLabel(textModels.find((model) => model.id === modelId), settings, '未配置文本模型')}
                <small>{modelOverride ? '仅本次优化' : '跟随工作台'}</small>
              </button>
              {modelOverride && workbenchTextModelId && (
                <button
                  type="button"
                  className="prompt-optimize-window__follow"
                  onClick={() => {
                    setModelId(resolveOptimizerModelId(settings ?? { groups: [], connections: [], models: [] }, workbenchTextModelId))
                    setModelOverride(false)
                    setModelPickerOpen(false)
                  }}
                >恢复跟随</button>
              )}
              {modelPickerOpen && (
                <div className="prompt-optimize-window__model-popover">
                  <ProviderModelPicker
                    models={textModels}
                    settings={settings}
                    value={modelId}
                    ariaLabel="选择优化文本模型"
                    onSelect={(id) => {
                      setModelId(id)
                      setModelOverride(id !== workbenchTextModelId)
                      setModelPickerOpen(false)
                    }}
                  />
                </div>
              )}
            </div>
          </div>
          <div>{error && !optimizedDraft && <span className="dialog-error">{error}</span>}<button type="button" className="secondary" disabled={!currentPrompt.trim() || optimizing} onClick={() => void optimize()}>{optimizing ? '优化中…' : '开始优化'}</button><button type="button" className="primary" disabled={!(optimizedDraft || currentPrompt).trim()} onClick={apply}>回填</button></div>
        </footer>
        <Dialog.Description className="sr-only">在独立窗口中编辑、优化并回填图片提示词。</Dialog.Description>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
}
