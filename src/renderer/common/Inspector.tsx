import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, PanelRightClose, PanelRightOpen, Plus, Settings, X } from 'lucide-react'
import * as Tooltip from '@radix-ui/react-tooltip'
import type { Mode } from '../../mock-data'
import { getSettingsApi } from '../settings/settings-api'
import { getLibraryApi } from '../library/library-api'
import { fetchCompiledMemories, type CompiledMemoryResult } from '../library/memory-compiler'
import { getSelectedAssets, publishSelectedAssets, subscribeSelectedAssets } from '../library/asset-selection'
import type { ProjectAsset } from '../../shared/contracts/library'
import type { TextReasoningEffort } from '../../shared/contracts/text'
import { REASONING_EFFORT_LABELS } from '../../shared/models/reasoning'
import { resolveImageSpec, type ResolvedImageSpec } from '../image/image-parameters'

function HoverTip({
  label,
  children,
  side = 'top',
}: {
  label: string
  children: React.ReactElement
  side?: 'top' | 'right' | 'bottom' | 'left'
}) {
  return (
    <Tooltip.Root delayDuration={250}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tooltip" side={side} sideOffset={7}>
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

function IconButton({
  label,
  children,
  onClick,
  active = false,
  className = '',
}: {
  label: string
  children: React.ReactNode
  onClick?: () => void
  active?: boolean
  className?: string
}) {
  return (
    <HoverTip label={label}>
      <button
        type="button"
        className={`icon-button ${className} ${active ? 'active' : ''}`}
        onClick={onClick}
        aria-label={label}
      >
        {children}
      </button>
    </HoverTip>
  )
}

export interface InspectorProps {
  mode: Mode
  onOpenAssets: () => void
  onOpenSettings?: () => void
  collapsed?: boolean
  onToggleCollapse?: () => void
}

export function Inspector({
  mode,
  onOpenAssets,
  onOpenSettings,
  collapsed = false,
  onToggleCollapse,
}: InspectorProps): React.ReactElement {
  const [settings, setSettings] = useState<Awaited<ReturnType<ReturnType<typeof getSettingsApi>['get']>> | null>(null)
  const [referenceAssets, setReferenceAssets] = useState<ProjectAsset[]>(() => getSelectedAssets())
  const [parameters, setParameters] = useState({ ratio: '16:9 横版', resolution: '2K', quality: '自动', format: 'PNG' })
  const [reasoningEffort, setReasoningEffort] = useState<TextReasoningEffort>('auto')
  const [compiledMemories, setCompiledMemories] = useState<CompiledMemoryResult | null>(null)
  const [expandedAdvanced, setExpandedAdvanced] = useState(false)
  const steps = 30
  const cfgScale = 7.5
  const seed = '-1'
  const negativePrompt = ''

  useEffect(() => {
    let disposed = false
    const loadSettings = () => {
      void getSettingsApi()
        .get()
        .then((value) => {
          if (!disposed) setSettings(value)
        })
        .catch(() => {})
    }
    loadSettings()

    const loadMemories = () => {
      void fetchCompiledMemories(getLibraryApi())
        .then((res) => {
          if (!disposed) setCompiledMemories(res)
        })
        .catch(() => {})
    }
    loadMemories()

    const onUpdated = () => loadSettings()
    const onModel = (event: Event) => {
      const detail = (event as CustomEvent<{ kind?: string; id?: string }>).detail
      if (!detail?.id) return
      setSettings((current) =>
        current
          ? {
              ...current,
              ...(detail.kind === 'text' ? { defaultTextModelId: detail.id } : { defaultImageModelId: detail.id }),
            }
          : current
      )
    }
    const onParams = (event: Event) => {
      const detail = (event as CustomEvent<{ ratio?: string; resolution?: string; quality?: string; format?: string }>).detail
      if (detail) setParameters((prev) => ({ ...prev, ...detail }))
    }
    const onEffort = (event: Event) => {
      const detail = (event as CustomEvent<TextReasoningEffort>).detail
      if (detail) setReasoningEffort(detail)
    }
    const onMemoriesUpdated = () => loadMemories()

    window.addEventListener('latent-studio:settings-updated', onUpdated)
    window.addEventListener('latent-studio:model-selection', onModel)
    window.addEventListener('latent-studio:parameters-updated', onParams)
    window.addEventListener('latent-studio:reasoning-effort-updated', onEffort)
    window.addEventListener('latent-studio:memories-updated', onMemoriesUpdated)

    return () => {
      disposed = true
      window.removeEventListener('latent-studio:settings-updated', onUpdated)
      window.removeEventListener('latent-studio:model-selection', onModel)
      window.removeEventListener('latent-studio:parameters-updated', onParams)
      window.removeEventListener('latent-studio:reasoning-effort-updated', onEffort)
      window.removeEventListener('latent-studio:memories-updated', onMemoriesUpdated)
    }
  }, [])

  useEffect(() => subscribeSelectedAssets(setReferenceAssets), [])

  const removeReference = (asset: ProjectAsset) => {
    const next = referenceAssets.filter((item) => item.id !== asset.id)
    publishSelectedAssets(next)
  }

  const kind = mode === 'image' ? 'image' : 'text'
  const selected =
    settings?.models.find(
      (model) => model.id === (kind === 'image' ? settings.defaultImageModelId : settings.defaultTextModelId) && model.kind === kind
    ) ?? settings?.models.find((model) => model.kind === kind)
  const connection = selected ? settings?.connections.find((item) => item.id === selected.connectionId) : undefined

  const resolvedImageSpec = useMemo((): ResolvedImageSpec | null => {
    if (mode !== 'image' && mode !== 'agent') return null
    const imgModel =
      selected?.kind === 'image'
        ? selected
        : settings?.models.find((m) => m.id === settings.defaultImageModelId && m.kind === 'image') ??
          settings?.models.find((m) => m.kind === 'image')
    return resolveImageSpec({
      modelId: imgModel?.modelId ?? '',
      ratio: parameters.ratio,
      resolution: parameters.resolution,
      quality: parameters.quality,
    })
  }, [mode, selected, settings, parameters])

  if (collapsed) {
    return (
      <aside className="inspector collapsed" title="点击展开右侧面板">
        <div className="inspector-collapsed-trigger">
          <IconButton label="展开右侧面板" onClick={onToggleCollapse}>
            <PanelRightOpen size={17} />
          </IconButton>
          <span className="inspector-collapsed-text" onClick={onToggleCollapse}>
            当前上下文
          </span>
        </div>
      </aside>
    )
  }

  return (
    <aside className="inspector">
      <div className="inspector-head">
        <span>当前上下文</span>
        {onToggleCollapse && (
          <IconButton label="收起右侧面板" onClick={onToggleCollapse}>
            <PanelRightClose size={17} />
          </IconButton>
        )}
      </div>

      <section>
        <div className="inspector-section-head">
          <label>参考素材 ({referenceAssets.length})</label>
          <IconButton label="添加项目素材" onClick={onOpenAssets}>
            <Plus size={15} />
          </IconButton>
        </div>
        {referenceAssets.length === 0 ? (
          <div className="mini-assets">
            <div className="inspector-empty">在素材库勾选或双击参考图</div>
          </div>
        ) : (
          <div className="inspector-reference-chips">
            {referenceAssets.map((asset) => (
              <div key={asset.id} className="reference-chip" title={asset.name}>
                <span>{asset.name}</span>
                <button
                  type="button"
                  className="reference-chip-remove"
                  onClick={() => removeReference(asset)}
                  aria-label={`移除参考图 ${asset.name}`}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <label>实际路由</label>
        <div className="route-box">
          <span className={`route-dot ${selected ? '' : 'warning'}`} />
          <div className="route-box-main">
            <strong>{selected?.name ?? `未配置${kind === 'image' ? '图片' : '文本'}模型`}</strong>
            <small>
              {connection
                ? `${connection.name} · 最大并发 ${connection.maxConcurrency}`
                : selected
                ? '已分配连接'
                : `请在设置中添加${kind === 'image' ? '图片' : '文本'}模型`}
            </small>
          </div>
          {!selected && onOpenSettings && (
            <button
              type="button"
              className="inspector-recovery-btn"
              onClick={onOpenSettings}
              title="打开设置添加模型"
            >
              <Settings size={12} />
              去配置
            </button>
          )}
        </div>
      </section>

      <section>
        <label>输出规格</label>
        <div className="key-values">
          <span>
            比例<b>{parameters.ratio}</b>
          </span>
          <span>
            分辨率<b>{parameters.resolution}</b>
          </span>
          <span>
            质量<b>{parameters.quality}</b>
          </span>
          {resolvedImageSpec && (
            <>
              <span>模型请求<b>{resolvedImageSpec.size}</b></span>
              <span>导出尺寸<b>{resolvedImageSpec.outputSize}</b></span>
              <span>输出格式<b>{parameters.format}</b></span>
            </>
          )}
          {(mode === 'text' || mode === 'agent') && (
            <button
              type="button"
              className="inspector-interactive-pill"
              title="点击切换思考推理强度（自动 / 低 / 中 / 高 / 极高）"
              onClick={() => {
                const order: TextReasoningEffort[] = ['auto', 'low', 'medium', 'high', 'xhigh']
                const next = order[(order.indexOf(reasoningEffort) + 1) % order.length]
                setReasoningEffort(next)
                window.dispatchEvent(new CustomEvent('latent-studio:reasoning-effort-updated', { detail: next }))
              }}
            >
              <span>思考强度</span>
              <b className="inspector-pill-value">{REASONING_EFFORT_LABELS[reasoningEffort] ?? '自动'} ↻</b>
            </button>
          )}
          <span>
            输出目录<b>项目输出</b>
          </span>
        </div>
        {resolvedImageSpec?.degraded && (
          <div className="inspector-degrade-box" title={resolvedImageSpec.degradeReason}>
            <span>⚠ {resolvedImageSpec.degradeReason}</span>
          </div>
        )}
      </section>

      <section>
        <div className="inspector-section-head">
          <label>生效长期记忆 ({compiledMemories?.items.length ?? 0})</label>
        </div>
        {compiledMemories?.items.length ? (
          <div className="inspector-reference-chips">
            {compiledMemories.items.map((item) => (
              <div
                key={item.id}
                className="reference-chip memory-chip"
                title={`${item.title} (${item.scope === 'project' ? '项目限定约束' : '全局视觉偏好'})\n${item.content}`}
              >
                <span>{item.title}</span>
                <span className={`pill small-pill ${item.scope === 'project' ? 'blue' : 'neutral'}`}>
                  {item.scope === 'project' ? '项目' : '全局'}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="mini-assets">
            <div className="inspector-empty">暂无生效的长期记忆约束</div>
          </div>
        )}
      </section>

      <section className="inspector-advanced-section">
        <button
          type="button"
          className="advanced"
          onClick={() => setExpandedAdvanced((v) => !v)}
          aria-expanded={expandedAdvanced}
        >
          <span>高级生成配置</span>
          <ChevronDown
            size={15}
            style={{
              transform: expandedAdvanced ? 'rotate(180deg)' : 'none',
              transition: 'transform 200ms ease',
            }}
          />
        </button>
        {expandedAdvanced && (
          <div className="advanced-options-panel">
            <div className="advanced-notice-badge">
              当前选中的在线模型协议暂不支持自定义步数/CFG/种子控制。
            </div>
            <div className="advanced-field disabled">
              <div className="advanced-field-label">
                <span>采样步数 (Steps)</span>
                <span className="simulated-tag">暂未支持</span>
              </div>
              <input
                type="range"
                min="15"
                max="50"
                value={steps}
                disabled
                aria-label="采样步数（当前协议不支持）"
              />
            </div>
            <div className="advanced-field disabled">
              <div className="advanced-field-label">
                <span>提示词引导 (CFG)</span>
                <span className="simulated-tag">暂未支持</span>
              </div>
              <input
                type="range"
                min="1.0"
                max="15.0"
                step="0.5"
                value={cfgScale}
                disabled
                aria-label="提示词引导系数（当前协议不支持）"
              />
            </div>
            <div className="advanced-field disabled">
              <div className="advanced-field-label">
                <span>随机种子 (Seed)</span>
                <span className="simulated-tag">暂未支持</span>
              </div>
              <input
                type="text"
                value={seed}
                disabled
                placeholder="-1 为随机"
                aria-label="随机种子（当前协议不支持）"
                className="advanced-input"
              />
            </div>
            <div className="advanced-field disabled">
              <div className="advanced-field-label">
                <span>负面提示词</span>
                <span className="simulated-tag">暂未支持</span>
              </div>
              <textarea
                value={negativePrompt}
                disabled
                placeholder="当前模型不支持负面提示词"
                rows={2}
                aria-label="负面提示词（当前协议不支持）"
                className="advanced-textarea"
              />
            </div>
          </div>
        )}
      </section>
    </aside>
  )
}

export default Inspector
