import React, { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { LibraryScope, MemoryCategory, MemoryEntry } from '../../shared/contracts/library'
import { inferMemoryCategory, isExclusiveMemoryCategory, MEMORY_CATEGORY_OPTIONS } from '../../shared/memory/categories'
import { getLibraryApi } from './library-api'

export interface MemoryPreset {
  id: string
  title: string
  scope: LibraryScope
  category: MemoryCategory
  source: string
  content: string
}

export const PRESET_TEMPLATES: MemoryPreset[] = [
  {
    id: 'film-grain',
    title: '柯达胶片电影调色设定',
    scope: 'global',
    category: 'visual-style',
    source: '导演视觉规范',
    content: '所有画面优先呈现柯达胶片（Kodak Portra 400）颗粒质感，色温偏暖，暗部泛微绿，高光柔和泛光，避免塑料感与过饱和 CG 质感。',
  },
  {
    id: 'character-aria',
    title: '主角艾莉亚（Aria）外观设定',
    scope: 'project',
    category: 'character',
    source: '项目角色集',
    content: '主角艾莉亚：24岁东亚女性，银灰色微卷中短发，右眉尾有微小疤痕，常穿深灰机能防水风衣配琥珀色护目镜，眼神坚定克制。',
  },
  {
    id: 'composition-rules',
    title: '16:9 电影构图与光学景深',
    scope: 'project',
    category: 'composition',
    source: '分镜构图指南',
    content: '镜头严格遵循 16:9 画幅与三分构图法则，中景和特写需保留真实大光圈浅景深散景，前后景层次分明，具有空间纵深感。',
  },
  {
    id: 'cyber-atmosphere',
    title: '赛博雨夜光影氛围基调',
    scope: 'project',
    category: 'visual-style',
    source: '世界观美学',
    content: '场景设定为雨夜街头，潮湿地面具有清晰霓虹水洼反光，冷青与品红交织的双色温侧逆光，空气中有漫反射水汽丁达尔光束。',
  },
  {
    id: 'negative-constraint',
    title: '负向畸变与质感约束',
    scope: 'global',
    category: 'negative',
    source: '品质质检规范',
    content: '严格禁止肢体畸变、多余手指、重影脸部扭曲、塑料皮肤质感及低分辨率涂抹感；画面整体需保留真实细节纹理。',
  },
]

export interface MemoryEditorModalProps {
  open: boolean
  item?: MemoryEntry
  initialPreset?: MemoryPreset
  initialTitle?: string
  initialContent?: string
  initialScope?: LibraryScope
  initialSource?: string
  onClose: () => void
  onSaved: () => Promise<void> | void
}

export function MemoryEditorModal({
  open,
  item,
  initialPreset,
  initialTitle,
  initialContent,
  initialScope,
  initialSource,
  onClose,
  onSaved,
}: MemoryEditorModalProps): React.ReactElement | null {
  const [title, setTitle] = useState(item?.title ?? initialPreset?.title ?? initialTitle ?? '')
  const [content, setContent] = useState(item?.content ?? initialPreset?.content ?? initialContent ?? '')
  const [scope, setScope] = useState<LibraryScope>(item?.scope ?? initialPreset?.scope ?? initialScope ?? 'project')
  const [category, setCategory] = useState<MemoryCategory>(item?.category ?? initialPreset?.category ?? inferMemoryCategory({ title: initialTitle ?? '', content: initialContent ?? '' }))
  const [categoryTouched, setCategoryTouched] = useState(false)
  const [source, setSource] = useState(item?.source ?? initialPreset?.source ?? initialSource ?? '')
  const [active, setActive] = useState(item ? item.active !== false : true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      if (item) {
        setTitle(item.title)
        setContent(item.content)
        setScope(item.scope)
        setCategory(item.category ?? inferMemoryCategory(item))
        setSource(item.source ?? '')
        setActive(item.active !== false)
      } else if (initialPreset) {
        setTitle(initialPreset.title)
        setContent(initialPreset.content)
        setScope(initialPreset.scope)
        setCategory(initialPreset.category)
        setSource(initialPreset.source)
        setActive(true)
      } else {
        setTitle(initialTitle ?? '')
        setContent(initialContent ?? '')
        setScope(initialScope ?? 'project')
        setCategory(inferMemoryCategory({ title: initialTitle ?? '', content: initialContent ?? '' }))
        setSource(initialSource ?? '')
        setActive(true)
      }
      setError(null)
      setCategoryTouched(false)
    }
  }, [item, initialPreset, initialTitle, initialContent, initialScope, initialSource, open])

  if (!open) return null

  const handleSave = async () => {
    if (!title.trim() || !content.trim()) return
    setBusy(true)
    setError(null)
    try {
      const api = getLibraryApi()
      if (item) {
        await api.updateMemory({
          id: item.id,
          scope: item.scope,
          title: title.trim(),
          content: content.trim(),
          source: source.trim() || undefined,
          category,
          active,
        })
      } else {
        await api.saveMemory({
          title: title.trim(),
          content: content.trim(),
          scope,
          category,
          source: source.trim() || undefined,
          active,
        })
      }
      await onSaved()
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '记忆保存失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="memory-modal-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="memory-modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="memory-modal-header">
          <div>
            <h3>{item ? '编辑记忆约束' : (initialContent ? '保存为项目记忆' : '新建持久记忆')}</h3>
            <p>已启用的记忆会在后续文本多轮对话与智能分镜规划中自动注入</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </div>

        <div className="memory-modal-body">
          {!item && (
            <div className="memory-modal-field">
              <label>生效作用域</label>
              <div className="memory-scope-selector">
                <button
                  type="button"
                  className={`scope-option-card ${scope === 'project' ? 'selected' : ''}`}
                  onClick={() => setScope('project')}
                >
                  <strong>当前项目限定</strong>
                  <small>仅在此工程生效，适合角色、剧本与特定分镜约束</small>
                </button>
                <button
                  type="button"
                  className={`scope-option-card ${scope === 'global' ? 'selected' : ''}`}
                  onClick={() => setScope('global')}
                >
                  <strong>全局通用偏好</strong>
                  <small>跨所有项目生效，适合色彩偏好、胶片质感等个人习惯</small>
                </button>
              </div>
            </div>
          )}

          <div className="memory-modal-field">
            <label>
              记忆标题
              <span>{title.length}/80</span>
            </label>
            <input
              value={title}
              onChange={(e) => {
                const nextTitle = e.target.value
                setTitle(nextTitle)
                if (!categoryTouched) setCategory(inferMemoryCategory({ title: nextTitle, content }))
              }}
              placeholder="例如：主角艾莉亚外观设定、柯达胶片电影质感…"
              maxLength={80}
              autoFocus
            />
          </div>

          <div className="memory-modal-field">
            <label>记忆类别</label>
            <select
              value={category}
              onChange={(event) => {
                setCategory(event.target.value as MemoryCategory)
                setCategoryTouched(true)
              }}
            >
              {MEMORY_CATEGORY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <small className="memory-modal-help">
              {isExclusiveMemoryCategory(category)
                ? '此类别同一作用域只保留最新记忆；项目记忆优先于全局记忆。'
                : '此类别可与其他不同标题的记忆同时生效。'}
            </small>
          </div>

          <div className="memory-modal-field">
            <label>
              核心设定内容（指令/约束/特征）
              <span>{content.length}/5000</span>
            </label>
            <textarea
              value={content}
              onChange={(e) => {
                const nextContent = e.target.value
                setContent(nextContent)
                if (!categoryTouched) setCategory(inferMemoryCategory({ title, content: nextContent }))
              }}
              placeholder="描述大模型在分镜规划和画面提示词中必须遵守的角色特征、画风规则或负面排除项…"
              rows={6}
            />
          </div>

          <div className="memory-modal-field">
            <label>来源说明（可选）</label>
            <input
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="例如：从第3轮对话提炼、导演设定集、用户明确指示"
              maxLength={100}
            />
          </div>

          <div className="memory-toggle-field">
            <div>
              <strong>当前启用状态</strong>
              <small>{active ? '此记忆处于激活状态，模型将持续遵守' : '此记忆已暂停，暂时不会影响模型输出'}</small>
            </div>
            <button
              type="button"
              className={`toggle ${active ? 'on' : ''}`}
              onClick={() => setActive(!active)}
              aria-label={active ? '停用记忆' : '启用记忆'}
            >
              <span />
            </button>
          </div>

          {error && <div className="form-error">{error}</div>}
        </div>

        <div className="memory-modal-footer">
          <button type="button" className="secondary" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => void handleSave()}
            disabled={busy || !title.trim() || !content.trim()}
          >
            {busy ? '正在保存…' : item ? '保存修改' : '确认创建'}
          </button>
        </div>
      </div>
    </div>
  )
}
