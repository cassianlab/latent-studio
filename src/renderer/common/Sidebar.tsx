import { ChevronDown, CircleHelp, Menu, ScrollText } from 'lucide-react'
import * as Tooltip from '@radix-ui/react-tooltip'
import type { PageKey } from '../../mock-data'
import { navItems } from '../../mock-data'
import type { ProjectSummary } from '../../shared/contracts/projects'

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

export interface SidebarProps {
  page: PageKey
  onPage: (key: PageKey) => void
  collapsed: boolean
  onCollapse: () => void
  project: ProjectSummary
  onOpenProjectSwitcher: () => void
  onOpenLogs: () => void
  onOpenFeedback: () => void
}

export function Sidebar({
  page,
  onPage,
  collapsed,
  onCollapse,
  project,
  onOpenProjectSwitcher,
  onOpenLogs,
  onOpenFeedback,
}: SidebarProps): React.ReactElement {
  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="brand-row">
        <img src="./icon.png" alt="" />
        <span>Latent Studio</span>
        <IconButton label={collapsed ? '展开导航' : '收起导航'} onClick={onCollapse}>
          <Menu size={17} />
        </IconButton>
      </div>
      <HoverTip label="切换项目" side="right">
        <button
          type="button"
          className="project-switcher"
          aria-label="切换项目"
          onClick={onOpenProjectSwitcher}
        >
          <span className="project-dot">{project.name.slice(0, 1)}</span>
          <span>
            <strong>{project.name}</strong>
            <small>本地项目 · 点击切换</small>
          </span>
          <ChevronDown size={15} />
        </button>
      </HoverTip>
      <nav>
        {navItems.map((item) => (
          <HoverTip key={item.key} label={item.label} side="right">
            <button
              type="button"
              aria-label={item.label}
              className={page === item.key ? 'selected' : ''}
              onClick={() => onPage(item.key)}
            >
              <item.icon size={18} />
              <span>{item.label}</span>
            </button>
          </HoverTip>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <div className="mock-note">
          <span />
          <p>
            <strong>本地项目工作区</strong>
            <small>数据保存在当前项目</small>
          </p>
        </div>
        <HoverTip label="查看最近 48 小时运行日志" side="right">
          <button type="button" aria-label="运行日志" onClick={onOpenLogs}>
            <ScrollText size={18} />
            <span>运行日志</span>
          </button>
        </HoverTip>
        <HoverTip label="原型反馈与关于" side="right">
          <button type="button" aria-label="原型反馈与关于" onClick={onOpenFeedback}>
            <CircleHelp size={18} />
            <span>原型反馈</span>
          </button>
        </HoverTip>
      </div>
    </aside>
  )
}
