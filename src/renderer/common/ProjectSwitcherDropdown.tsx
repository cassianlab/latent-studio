import { useEffect, useRef, useState } from 'react'
import { FolderOpen, LoaderCircle, LogOut, Settings2 } from 'lucide-react'
import type { ProjectSummary } from '../../shared/contracts/projects'
import { flushSessionWrites } from '../conversation/session-store'
import { getProjectApi, type ProjectApi } from '../start/project-api'

export async function openProjectForSwitch(
  currentProjectId: string,
  target: ProjectSummary | undefined,
  dependencies: { flush: typeof flushSessionWrites; open: ProjectApi['open'] } = {
    flush: flushSessionWrites,
    open: (input) => getProjectApi().open(input),
  },
): Promise<ProjectSummary | null> {
  await dependencies.flush(currentProjectId)
  return dependencies.open(target ? { projectRoot: target.path } : undefined)
}

export interface ProjectSwitcherDropdownProps {
  currentProject: ProjectSummary
  open: boolean
  onOpenChange: (open: boolean) => void
  onSwitchProject: (project: ProjectSummary) => void
  onBackToStart: () => void
  onOpenSettings: () => void
}

export function ProjectSwitcherDropdown({
  currentProject,
  open,
  onOpenChange,
  onSwitchProject,
  onBackToStart,
  onOpenSettings,
}: ProjectSwitcherDropdownProps): React.ReactElement | null {
  const [recents, setRecents] = useState<ProjectSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [switchError, setSwitchError] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    let disposed = false
    setLoading(true)
    void getProjectApi()
      .listRecent()
      .then((items) => {
        if (!disposed) setRecents(items)
      })
      .catch(() => {
        if (!disposed) setRecents([])
      })
      .finally(() => {
        if (!disposed) setLoading(false)
      })
    return () => {
      disposed = true
    }
  }, [open])

  // 点击外部关闭
  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onOpenChange(false)
      }
    }
    window.addEventListener('mousedown', handleClickOutside)
    return () => window.removeEventListener('mousedown', handleClickOutside)
  }, [onOpenChange, open])

  if (!open) return null

  const handleSwitch = async (target?: ProjectSummary) => {
    if (switching) return
    setSwitching(true)
    setSwitchError(null)
    try {
      const selected = await openProjectForSwitch(currentProject.id, target)
      if (selected) {
        onSwitchProject(selected)
        onOpenChange(false)
      }
    } catch (cause) {
      setSwitchError(cause instanceof Error ? cause.message : '项目切换失败')
    } finally {
      setSwitching(false)
    }
  }

  const otherProjects = recents.filter((p) => p.id !== currentProject.id)

  return (
    <div className="project-switcher-menu" ref={menuRef} role="menu" aria-label="项目快速切换">
      <div className="project-switcher-current">
        <div className="project-dot">{currentProject.name.slice(0, 1)}</div>
        <div className="project-switcher-current-meta">
          <strong>{currentProject.name}</strong>
          <small>{currentProject.displayPath || currentProject.path}</small>
        </div>
        <span className="pill green">当前</span>
      </div>

      <div className="project-switcher-divider" />

      {otherProjects.length > 0 && (
        <div className="project-switcher-recents">
          <div className="project-switcher-section-title">切换到最近项目</div>
          {otherProjects.slice(0, 5).map((project) => (
            <button
              type="button"
              key={project.id}
              className="project-switcher-item"
              onClick={() => void handleSwitch(project)}
              disabled={switching}
            >
              <div className="project-dot-sm">{project.name.slice(0, 1)}</div>
              <div className="project-switcher-item-info">
                <strong>{project.name}</strong>
                <small>{project.displayPath || project.path}</small>
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="project-switcher-divider" />

      <div className="project-switcher-actions">
        {switchError && <p className="project-switcher-error" role="alert">{switchError}</p>}
        <button
          type="button"
          className="project-switcher-action-button"
          onClick={() => void handleSwitch()}
          disabled={switching}
        >
          {switching ? <LoaderCircle size={15} className="spin" /> : <FolderOpen size={15} />}
          <span>{switching ? '正在切换项目…' : '打开其他本地项目文件夹...'}</span>
        </button>

        <button
          type="button"
          className="project-switcher-action-button"
          disabled={switching}
          onClick={() => {
            onOpenSettings()
            onOpenChange(false)
          }}
        >
          <Settings2 size={15} />
          <span>当前项目设置</span>
        </button>

        <button
          type="button"
          className="project-switcher-action-button"
          disabled={switching}
          onClick={() => {
            onBackToStart()
            onOpenChange(false)
          }}
        >
          <LogOut size={15} />
          <span>返回开始屏幕</span>
        </button>
      </div>
    </div>
  )
}
