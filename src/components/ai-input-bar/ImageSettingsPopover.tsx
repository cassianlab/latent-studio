import { useEffect, useMemo, useState } from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'
import { Check, ChevronDown, Image, SlidersHorizontal, Sparkles, X } from 'lucide-react'
import type { GlobalSettings, ModelProfile } from '../../shared/contracts/settings'
import { compactModelName, getModelChannelInfo, groupModelsByProvider } from '../../renderer/settings/model-channel'
import type { BatchMode } from './BatchModeDropdown'
import type { ImageParameters } from './ParametersDropdown'
import { DropdownPortal } from './DropdownPortal'
import { isGptImage25Model, resolveImageOutputSize } from '../../renderer/image/image-parameters'
import './image-settings-popover.css'

export interface ImageSettingsPopoverProps {
  imageModelId: string
  imageModels: ModelProfile[]
  onSelectImageModel: (id: string) => void
  settings?: GlobalSettings | null
  parameters: ImageParameters
  onChangeParameters: (params: ImageParameters) => void
  count: string
  onSelectCount: (count: string) => void
  batchMode: BatchMode
  onSelectBatchMode: (mode: BatchMode) => void
  agentMode?: boolean
}

const RATIO_OPTIONS = [
  { value: '自动', label: '自动', desc: '由模型决定' },
  { value: '1:1 方形', label: '1:1', desc: '正方形', shape: '1-1' },
  { value: '3:4 竖版', label: '3:4', desc: '经典竖版', shape: '3-4' },
  { value: '4:3 横版', label: '4:3', desc: '经典画幅', shape: '4-3' },
  { value: '16:9 横版', label: '16:9', desc: '横版电影', shape: '16-9' },
  { value: '9:16 竖版', label: '9:16', desc: '竖屏短视频', shape: '9-16' },
  { value: '21:9 超宽', label: '21:9', desc: '宽银幕', shape: '21-9' },
]

const RESOLUTION_OPTIONS = ['1K', '2K', '4K']
const QUALITY_OPTIONS = ['自动', '最高', '超高', '高', '中', '低']
const FORMAT_OPTIONS = ['PNG', 'JPEG', 'WebP']
const BACKGROUND_OPTIONS = ['自动', '不透明', '透明'] as const
const COUNT_OPTIONS = ['1 个', '2 个', '4 个', '8 个']

export function ImageSettingsPopover({
  imageModelId,
  imageModels,
  onSelectImageModel,
  settings,
  parameters,
  onChangeParameters,
  count,
  onSelectCount,
  batchMode,
  onSelectBatchMode,
  agentMode = false,
}: ImageSettingsPopoverProps): React.ReactElement {
  const [open, setOpen] = useState(false)

  const currentModel = imageModels.find((m) => m.id === imageModelId)
  const supportsBackground = isGptImage25Model(currentModel?.modelId) || isGptImage25Model(currentModel?.name)
  const transparentBackground = parameters.background === '透明'
  const displayName = currentModel?.name ?? '生图模型'
  const compactName = currentModel ? compactModelName(currentModel.name, 'image') : '图片模型'
  const ratioLabel = parameters.ratio.split(' ')[0] || '16:9'
  const resolvedOutputSize = resolveImageOutputSize(parameters)
  const imageCount = Number.parseInt(count, 10) || 1
  const channel = currentModel ? getModelChannelInfo(currentModel, settings) : null
  const tipLabel = `生图模型：${displayName}（${ratioLabel} · ${parameters.format ?? 'PNG'}${transparentBackground ? ' · 透明背景' : ''} · ${count}）`
  const providerGroups = useMemo(() => groupModelsByProvider(imageModels, settings), [imageModels, settings])
  const currentProviderId = providerGroups.find((group) => group.models.some((model) => model.id === imageModelId))?.providerId ?? ''
  const [imageProviderId, setImageProviderId] = useState(currentProviderId)
  const activeProvider = providerGroups.find((group) => group.providerId === imageProviderId)

  useEffect(() => {
    if (open) setImageProviderId(currentProviderId || providerGroups[0]?.providerId || '')
  }, [open, currentProviderId, providerGroups])

  return (
    <DropdownPortal
      open={open}
      onOpenChange={setOpen}
      className="image-settings-popover-menu"
      width={360}
      trigger={(ref) => (
        <div ref={ref} className="image-settings-popover-trigger-wrap">
          <Tooltip.Root delayDuration={220}>
            <Tooltip.Trigger asChild>
              <button
                type="button"
                className={`composer-model-capsule image-settings-capsule ${open ? 'open' : ''}`}
                aria-label={`生成数量：${count}；生图模型：${displayName}`}
                aria-expanded={open}
                onClick={() => setOpen((prev) => !prev)}
              >
                <Image size={13} className="capsule-icon" />
                <span className="capsule-label">{compactName}</span>
                <span className="image-count-badge" aria-hidden="true">{imageCount}</span>
                <ChevronDown size={11} className="capsule-chevron" />
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content className="tooltip" side="top" sideOffset={7}>
                {tipLabel}
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        </div>
      )}
    >
      <div className="image-settings-panel">
        <div className="image-settings-panel-head">
          <div className="panel-title-block">
            <SlidersHorizontal size={14} />
            <strong>生图模型与参数控制台</strong>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={() => setOpen(false)}
            aria-label="关闭参数面板"
          >
            <X size={14} />
          </button>
        </div>

        <div className="image-settings-panel-body">
          {/* Section 1: Image Model */}
          <div className="settings-section">
            <div className="section-head-row">
              <label className="section-label">图片生成模型</label>
              <span className="section-hint">{channel?.connectionName ?? '未配置连接'}</span>
            </div>
            <div className="image-model-select-grid">
              <label>
                <span>供应商</span>
                <div className="model-select-wrapper">
                  <select
                    value={imageProviderId}
                    onChange={(event) => setImageProviderId(event.target.value)}
                    className="panel-select"
                    disabled={providerGroups.length === 0}
                    aria-label="选择图片模型供应商"
                  >
                    {providerGroups.length === 0 && <option value="">暂无供应商</option>}
                    {providerGroups.map((group) => <option value={group.providerId} key={group.providerId}>{group.providerName}</option>)}
                  </select>
                </div>
              </label>
              <label>
                <span>模型</span>
                <div className="model-select-wrapper">
                  <select
                    value={activeProvider?.models.some((model) => model.id === imageModelId) ? imageModelId : ''}
                    onChange={(event) => onSelectImageModel(event.target.value)}
                    className="panel-select"
                    disabled={!activeProvider || activeProvider.models.length === 0}
                    aria-label="选择图片生成模型"
                  >
                    {!activeProvider?.models.some((model) => model.id === imageModelId) && <option value="">选择模型</option>}
                    {activeProvider?.models.map((model) => (
                      <option value={model.id} key={model.id}>{model.name} · {model.connectionName}</option>
                    ))}
                  </select>
                </div>
              </label>
            </div>
          </div>

          {/* Section 2: Aspect Ratio */}
          <div className="settings-section">
            <label className="section-label">画面比例</label>
            <div className="ratio-grid">
              {RATIO_OPTIONS.map((opt) => {
                const active = parameters.ratio.startsWith(opt.label)
                return (
                  <button
                    type="button"
                    key={opt.label}
                    className={`ratio-btn ${active ? 'active' : ''}`}
                    onClick={() => onChangeParameters({ ...parameters, ratio: opt.value })}
                    aria-label={`${opt.label}，${opt.desc}`}
                    aria-pressed={active}
                  >
                    {opt.shape && <span className={`ratio-shape ratio-shape--${opt.shape}`} aria-hidden="true" />}
                    <span className="ratio-val">{opt.label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Section 3: Resolution & Quality */}
          <div className="settings-section-row">
            <div className="settings-section-col">
              <label className="section-label">导出分辨率</label>
              <div className="pill-group">
                {RESOLUTION_OPTIONS.map((res) => (
                  <button
                    type="button"
                    key={res}
                    className={`pill-btn ${parameters.resolution === res ? 'active' : ''}`}
                    onClick={() => onChangeParameters({ ...parameters, resolution: res })}
                  >
                    {res}
                  </button>
                ))}
              </div>
            </div>

            <div className="settings-section-col">
              <label className="section-label">画质档位</label>
              <select
                value={parameters.quality}
                onChange={(e) => onChangeParameters({ ...parameters, quality: e.target.value })}
                className="panel-select small"
              >
                {QUALITY_OPTIONS.map((q) => (
                  <option key={q} value={q}>{q}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="settings-section">
            <div className="section-head-row">
              <label className="section-label" htmlFor="image-output-format">输出格式</label>
              <span className="section-hint">{resolvedOutputSize ? `${resolvedOutputSize} px` : '尺寸由模型决定'}</span>
            </div>
            <select
              id="image-output-format"
              value={parameters.format ?? 'PNG'}
              onChange={(e) => onChangeParameters({ ...parameters, format: e.target.value })}
              className="panel-select"
              aria-label="选择图片输出格式"
            >
              {FORMAT_OPTIONS.map((format) => <option key={format} value={format} disabled={transparentBackground && format === 'JPEG'}>{format}</option>)}
            </select>
          </div>

          {supportsBackground && <div className="settings-section">
            <div className="section-head-row">
              <label className="section-label">背景</label>
              <span className="section-hint">透明背景仅支持 PNG / WebP</span>
            </div>
            <div className="background-option-grid" role="group" aria-label="选择图片背景">
              {BACKGROUND_OPTIONS.map((background) => {
                const selected = (parameters.background ?? '自动') === background
                return <button
                  type="button"
                  key={background}
                  className={`background-option ${selected ? 'active' : ''}`}
                  aria-pressed={selected}
                  onClick={() => onChangeParameters({
                    ...parameters,
                    background,
                    ...(background === '透明' && /jpe?g/i.test(parameters.format ?? '') ? { format: 'PNG' } : {}),
                  })}
                >
                  <span className={`background-swatch background-swatch--${background === '透明' ? 'transparent' : background === '不透明' ? 'opaque' : 'auto'}`} aria-hidden="true" />
                  <span>{background}</span>
                </button>
              })}
            </div>
          </div>}

          {/* Section 4: Batch Count & Batch Mode */}
          <div className="settings-section">
            <div className="section-head-row">
              <label className="section-label">{agentMode ? 'Agent 默认数量' : '单次生成数量'}</label>
              <span className="section-hint">{agentMode ? '用户指令中的数量优先' : '并发请求批次'}</span>
            </div>
            <div className="pill-group count-pills">
              {COUNT_OPTIONS.map((c) => (
                <button
                  type="button"
                  key={c}
                  className={`pill-btn ${count === c ? 'active' : ''}`}
                  onClick={() => onSelectCount(c)}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          {imageCount > 1 && <div className="settings-section">
            <label className="section-label">批次模式</label>
            <div className="batch-mode-pills">
              <button
                type="button"
                className={`mode-pill ${batchMode === 'smart' ? 'active' : ''}`}
                onClick={() => onSelectBatchMode('smart')}
              >
                <Sparkles size={13} />
                <div>
                  <strong>智能变体</strong>
                  <small>文本模型自动分发不同构图/光线</small>
                </div>
                {batchMode === 'smart' && <Check size={14} className="check-icon" />}
              </button>
              <button
                type="button"
                className={`mode-pill ${batchMode === 'same' ? 'active' : ''}`}
                onClick={() => onSelectBatchMode('same')}
              >
                <div>
                  <strong>相同提示词</strong>
                  <small>使用同一提示词并发多抽探索</small>
                </div>
                {batchMode === 'same' && <Check size={14} className="check-icon" />}
              </button>
            </div>
          </div>}
        </div>
      </div>
    </DropdownPortal>
  )
}
