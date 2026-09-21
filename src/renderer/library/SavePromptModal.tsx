import React, { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Check, Copy, LoaderCircle, X } from 'lucide-react'
import { getLibraryApi } from './library-api'

export interface SavePromptModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialContent?: string
}

export function SavePromptModal({
  open,
  onOpenChange,
  initialContent,
}: SavePromptModalProps): React.ReactElement | null {
  const [name, setName] = useState(() => (initialContent ? (initialContent.split(/\n+/)[0]?.slice(0, 60) || '新提示词') : '雨夜重逢 · 正面中景'))
  const [content, setContent] = useState(() => initialContent || '')
  const [scope, setScope] = useState<'project' | 'global'>('project')
  const [kind, setKind] = useState<'prompt' | 'template' | 'style'>('prompt')
  const [collection, setCollection] = useState('个人')
  const [category, setCategory] = useState('未分类')
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    if (initialContent) {
      setContent(initialContent)
      setName(initialContent.split(/\n+/)[0]?.slice(0, 60) || '新提示词')
    }
    setCopied(false)
    setError(null)
  }, [initialContent, open])

  const copyPrompt = async () => {
    if (!content.trim()) return
    try {
      if (!navigator.clipboard) throw new Error('当前环境不支持复制')
      await navigator.clipboard.writeText(content)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '提示词复制失败')
    }
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await getLibraryApi().quickSavePrompt({
        name: name.trim(),
        content: content.trim(),
        scope,
        kind,
        collection: collection.trim() || '个人',
        category: category.trim() || '未分类',
        source: 'generation',
      })
      onOpenChange(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '提示词保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content" style={{ width: 'min(520px, calc(100vw - 40px))' }}>
          <div className="dialog-head">
            <div>
              <Dialog.Title>保存提示词</Dialog.Title>
              <Dialog.Description>保留原始、优化和实际执行版本</Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="icon-button" aria-label="关闭">
                <X size={18} />
              </button>
            </Dialog.Close>
          </div>

          <label>
            名称
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="输入提示词名称"
              maxLength={120}
              autoFocus
            />
          </label>

          <div className="choice-row">
            <button
              type="button"
              className={scope === 'project' ? 'selected' : ''}
              onClick={() => setScope('project')}
            >
              当前项目
            </button>
            <button
              type="button"
              className={scope === 'global' ? 'selected' : ''}
              onClick={() => setScope('global')}
            >
              全局
            </button>
          </div>

          <div className="choice-row">
            <button
              type="button"
              className={kind === 'prompt' ? 'selected' : ''}
              onClick={() => setKind('prompt')}
            >
              提示词
            </button>
            <button
              type="button"
              className={kind === 'template' ? 'selected' : ''}
              onClick={() => setKind('template')}
            >
              模板
            </button>
            <button
              type="button"
              className={kind === 'style' ? 'selected' : ''}
              onClick={() => setKind('style')}
            >
              风格
            </button>
          </div>

          <div className="prompt-editor-taxonomy" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label>
              分组
              <input
                value={collection}
                onChange={(event) => setCollection(event.target.value)}
                maxLength={120}
                placeholder="个人"
              />
            </label>
            <label>
              分类
              <input
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                maxLength={120}
                placeholder="未分类"
              />
            </label>
          </div>

          <label>
            实际执行提示词
            <textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              rows={5}
              placeholder="输入提示词内容…"
            />
          </label>

          <div className="dialog-note">
            同名内容不会覆盖，将保存为新版本。
            {error && <span className="dialog-error" style={{ color: 'var(--accent)', marginLeft: 8 }}>{error}</span>}
          </div>

          <footer>
            <button
              type="button"
              className="secondary"
              onClick={() => void copyPrompt()}
              disabled={!content.trim()}
            >
              {copied ? <Check size={14} className="text-green" /> : <Copy size={14} />}
              <span>{copied ? '已复制' : '复制提示词'}</span>
            </button>
            <Dialog.Close asChild>
              <button type="button" className="secondary" disabled={saving}>
                取消
              </button>
            </Dialog.Close>
            <button
              type="button"
              className="primary"
              onClick={() => void save()}
              disabled={saving || !name.trim() || !content.trim() || !collection.trim() || !category.trim()}
            >
              {saving ? <LoaderCircle size={14} className="spin" /> : null}
              <span>{saving ? '保存中…' : '保存到提示词库'}</span>
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
