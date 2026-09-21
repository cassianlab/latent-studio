import { useEffect, useMemo, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import {
  ArrowRight,
  Blocks,
  FileText,
  Image,
  LayoutDashboard,
  ListChecks,
  Moon,
  PanelsTopLeft,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Sun,
  WandSparkles,
  X,
  Brain,
} from 'lucide-react'
import type { PageKey } from '../../mock-data'
import { getLibraryApi } from '../library/library-api'
import type { PromptAsset } from '../../shared/contracts/library'

export interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onNavigate: (page: PageKey) => void
  onToggleTheme: () => void
  dark: boolean
  onOpenNewPrompt?: () => void
  onOpenAssetsImport?: () => void
}

interface CommandItem {
  id: string
  title: string
  category: '导航' | '快捷操作' | '提示词'
  icon: typeof LayoutDashboard
  hint?: string
  action: () => void
}

export function CommandPalette({
  open,
  onOpenChange,
  onNavigate,
  onToggleTheme,
  dark,
  onOpenNewPrompt,
  onOpenAssetsImport,
}: CommandPaletteProps): React.ReactElement {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [prompts, setPrompts] = useState<PromptAsset[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) {
      setQuery('')
      setSelectedIndex(0)
      return
    }
    void getLibraryApi()
      .listPrompts({ scope: 'project' })
      .then((items) => setPrompts(items.slice(0, 10)))
      .catch(() => setPrompts([]))
  }, [open])

  const staticCommands = useMemo<CommandItem[]>(() => {
    const nav: CommandItem[] = [
      { id: 'page-workspace', title: '前往 工作台', category: '导航', icon: LayoutDashboard, hint: '探索、图片与 Agent', action: () => { onNavigate('workspace'); onOpenChange(false) } },
      { id: 'page-canvas', title: '前往 视觉画布', category: '导航', icon: PanelsTopLeft, hint: '无限白板与镜头连接', action: () => { onNavigate('canvas'); onOpenChange(false) } },
      { id: 'page-assets', title: '前往 素材库', category: '导航', icon: Image, hint: '角色、场景与参考图', action: () => { onNavigate('assets'); onOpenChange(false) } },
      { id: 'page-documents', title: '前往 项目文档', category: '导航', icon: FileText, hint: '剧本、设定与本地文件', action: () => { onNavigate('documents'); onOpenChange(false) } },
      { id: 'page-prompts', title: '前往 提示词库', category: '导航', icon: WandSparkles, hint: '可复用模板与风格', action: () => { onNavigate('prompts'); onOpenChange(false) } },
      { id: 'page-skills', title: '前往 技能', category: '导航', icon: Blocks, hint: '管理与审计 Agent Skill', action: () => { onNavigate('skills'); onOpenChange(false) } },
      { id: 'page-tasks', title: '前往 任务中心', category: '导航', icon: ListChecks, hint: '队列、进度与连接状态', action: () => { onNavigate('tasks'); onOpenChange(false) } },
      { id: 'page-memory', title: '前往 记忆', category: '导航', icon: Brain, hint: '项目稳定偏好与约束', action: () => { onNavigate('memory'); onOpenChange(false) } },
      { id: 'page-settings', title: '前往 项目设置', category: '导航', icon: Settings2, hint: '项目配置与模型绑定', action: () => { onNavigate('settings'); onOpenChange(false) } },
      { id: 'page-global-settings', title: '前往 全局模型设置', category: '导航', icon: Settings2, hint: 'API Key 与连接管理', action: () => { onNavigate('global-settings'); onOpenChange(false) } },
    ]

    const actions: CommandItem[] = [
      { id: 'act-theme', title: dark ? '切换为 浅色模式' : '切换为 深色控制台', category: '快捷操作', icon: dark ? Sun : Moon, hint: '快速切换工作区主题', action: () => { onToggleTheme(); onOpenChange(false) } },
      { id: 'act-prompt-new', title: '新建 提示词', category: '快捷操作', icon: Plus, hint: '保存新提示词或模板', action: () => { onNavigate('prompts'); onOpenNewPrompt?.(); onOpenChange(false) } },
      { id: 'act-assets-import', title: '导入 本地素材', category: '快捷操作', icon: Image, hint: '添加角色或场景参考图', action: () => { onNavigate('assets'); onOpenAssetsImport?.(); onOpenChange(false) } },
    ]

    return [...nav, ...actions]
  }, [dark, onNavigate, onOpenAssetsImport, onOpenChange, onOpenNewPrompt, onToggleTheme])

  const promptCommands = useMemo<CommandItem[]>(() => {
    return prompts.map((p) => ({
      id: `prompt-${p.id}`,
      title: `提示词: ${p.name}`,
      category: '提示词',
      icon: Sparkles,
      hint: p.content.slice(0, 45),
      action: () => {
        onNavigate('prompts')
        onOpenChange(false)
      },
    }))
  }, [onNavigate, onOpenChange, prompts])

  const filteredCommands = useMemo(() => {
    const all = [...staticCommands, ...promptCommands]
    const clean = query.trim().toLowerCase()
    if (!clean) return all
    return all.filter((item) =>
      item.title.toLowerCase().includes(clean) ||
      (item.hint && item.hint.toLowerCase().includes(clean)) ||
      item.category.toLowerCase().includes(clean)
    )
  }, [promptCommands, query, staticCommands])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredCommands.length))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => (prev - 1 + filteredCommands.length) % Math.max(1, filteredCommands.length))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = filteredCommands[selectedIndex]
      if (item) item.action()
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay command-palette-overlay" />
        <Dialog.Content
          className="command-palette-content"
          aria-describedby="command-palette-desc"
          onKeyDown={handleKeyDown}
        >
          <div className="command-palette-header">
            <Search size={17} className="command-palette-icon" />
            <input
              ref={inputRef}
              type="text"
              className="command-palette-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索页面、操作、提示词... (↑↓ 选择，Enter 确认)"
              autoFocus
              aria-label="全局指令搜索"
            />
            {query && (
              <button
                type="button"
                className="icon-button small"
                onClick={() => setQuery('')}
                aria-label="清空输入"
              >
                <X size={14} />
              </button>
            )}
            <kbd className="command-palette-esc">ESC</kbd>
          </div>
          <Dialog.Title className="sr-only">全局指令与搜索</Dialog.Title>
          <div id="command-palette-desc" className="sr-only">
            通过键盘检索应用内的各个模块与快捷操作
          </div>

          <div className="command-palette-list" role="listbox">
            {filteredCommands.length === 0 ? (
              <div className="command-palette-empty">没有找到与「{query}」匹配的指令或资源</div>
            ) : (
              filteredCommands.map((item, index) => {
                const Icon = item.icon
                const isSelected = index === selectedIndex
                return (
                  <div
                    key={item.id}
                    role="option"
                    aria-selected={isSelected}
                    className={`command-palette-item ${isSelected ? 'selected' : ''}`}
                    onClick={() => item.action()}
                    onMouseEnter={() => setSelectedIndex(index)}
                  >
                    <span className="command-item-icon">
                      <Icon size={16} />
                    </span>
                    <div className="command-item-info">
                      <span className="command-item-title">{item.title}</span>
                      {item.hint && <small className="command-item-hint">{item.hint}</small>}
                    </div>
                    <span className="command-item-category pill">{item.category}</span>
                    <ArrowRight size={13} className="command-item-arrow" />
                  </div>
                )
              })
            )}
          </div>

          <footer className="command-palette-footer">
            <span>Latent Studio · 桌面端控制台</span>
            <div className="command-palette-shortcuts">
              <span><kbd>↑</kbd><kbd>↓</kbd> 导航</span>
              <span><kbd>↵</kbd> 跳转</span>
              <span><kbd>ESC</kbd> 关闭</span>
            </div>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
