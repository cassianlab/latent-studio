import { useEffect, useRef, useState } from 'react'
import { Bot, Check, ChevronDown, FileText, History, Pencil, Plus, Sparkles, Trash2, X } from 'lucide-react'
import type { Mode } from '../../mock-data'
import type { WorkspaceSession } from './types'
import { createSession, deleteSession, renameSession, switchSession } from './session-store'

interface SessionHeaderProps {
  projectId: string
  session: WorkspaceSession
  sessions: WorkspaceSession[]
  mode: Mode
  onSessionChange: (session: WorkspaceSession) => void
  onModeChange: (mode: Mode) => void
}

export function SessionHeader({
  projectId,
  session,
  sessions,
  mode,
  onSessionChange,
  onModeChange,
}: SessionHeaderProps): React.ReactElement {
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(session.title)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setTitleDraft(session.title)
  }, [session.title])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false)
      }
    }
    if (dropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [dropdownOpen])

  const handleCreateNew = () => {
    const fresh = createSession(projectId, mode, '新对话')
    onSessionChange(fresh)
    setDropdownOpen(false)
  }

  const handleSelect = (id: string) => {
    const target = switchSession(projectId, id)
    onSessionChange(target)
    onModeChange(target.mode)
    setDropdownOpen(false)
  }

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    const next = deleteSession(projectId, id)
    onSessionChange(next)
    onModeChange(next.mode)
  }

  const handleSaveTitle = () => {
    const trimmed = titleDraft.trim()
    if (trimmed && trimmed !== session.title) {
      renameSession(projectId, session.id, trimmed)
      onSessionChange({ ...session, title: trimmed })
    }
    setEditingTitle(false)
  }

  const modeBadge = (m: Mode) => {
    if (m === 'text') return <span className="session-mode-pill text"><FileText size={11} />文本</span>
    if (m === 'image') return <span className="session-mode-pill image"><Sparkles size={11} />图片</span>
    return <span className="session-mode-pill agent"><Bot size={11} />Agent</span>
  }

  return (
    <div className="thread-title session-header-bar">
      <div className="session-info-wrap">
        <div className="session-title-row">
          {editingTitle ? (
            <div className="session-title-edit-form">
              <input
                type="text"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveTitle()
                  if (e.key === 'Escape') setEditingTitle(false)
                }}
                autoFocus
                className="session-title-input"
              />
              <button type="button" className="icon-btn-micro check" onClick={handleSaveTitle} title="保存标题" aria-label="保存标题">
                <Check size={14} />
              </button>
              <button type="button" className="icon-btn-micro cancel" onClick={() => setEditingTitle(false)} title="取消" aria-label="取消修改标题">
                <X size={14} />
              </button>
            </div>
          ) : (
            <div className="session-title-display">
              <button
                type="button"
                className="session-title-button"
                onClick={() => setEditingTitle(true)}
                title="修改标题"
                aria-label="修改标题"
              >
                <h2>{session.title}</h2>
                <Pencil size={13} />
              </button>
            </div>
          )}

          <div className="session-dropdown-container" ref={dropdownRef}>
            <button
              type="button"
              className={`session-history-trigger ${dropdownOpen ? 'open' : ''}`}
              onClick={() => setDropdownOpen((v) => !v)}
              title="切换历史对话记录"
            >
              <History size={14} />
              <span>历史记录 ({sessions.length})</span>
              <ChevronDown size={13} />
            </button>

            {dropdownOpen && (
              <div className="session-dropdown-menu">
                <div className="session-dropdown-header">
                  <span>历史对话 ({sessions.length})</span>
                  <button type="button" className="new-session-btn" onClick={handleCreateNew}>
                    <Plus size={13} />
                    新建对话
                  </button>
                </div>
                <div className="session-list-scroll">
                  {sessions.map((item) => (
                    <div
                      key={item.id}
                      className={`session-item-row ${item.id === session.id ? 'active' : ''}`}
                      onClick={() => handleSelect(item.id)}
                    >
                      <div className="session-item-info">
                        <div className="session-item-title-row">
                          <strong className="session-item-title">{item.title}</strong>
                          {modeBadge(item.mode)}
                        </div>
                        <small className="session-item-time">
                          {new Date(item.updatedAt).toLocaleString('zh-CN', {
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </small>
                      </div>
                      {sessions.length > 1 && (
                        <button
                          type="button"
                          className="delete-session-btn"
                          onClick={(e) => handleDelete(e, item.id)}
                          title="删除此对话"
                          aria-label={`删除对话「${item.title}」`}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <span className="session-subtitle">
          共享项目上下文 · {mode === 'text' ? '文本模型可真实调用' : mode === 'image' ? '图片队列可真实调用' : 'Agent 可理解目标并协作执行'}
        </span>
      </div>

      <div className="session-actions-right">
        <button
          type="button"
          className="quick-new-session-btn"
          onClick={handleCreateNew}
          title="开启新对话"
        >
          <Plus size={15} />
          <span>新对话</span>
        </button>
      </div>
    </div>
  )
}
