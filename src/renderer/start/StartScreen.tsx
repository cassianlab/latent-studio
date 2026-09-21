import React, { useMemo, useState } from 'react'
import {
  ArrowRight,
  Bot,
  Clapperboard,
  FolderOpen,
  FolderPlus,
  Layers,
  LoaderCircle,
  Palette,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
} from 'lucide-react'
import type { ProjectSummary } from '../../shared/contracts/projects'
import { APP_VERSION } from '../../shared/app-version'
import { useStartProjects, type StartProjectsState } from './use-start-projects'
import './start-screen.css'

export interface WorkflowTemplate {
  id: string
  typeClass: 'film' | 'character' | 'style' | 'refine'
  title: string
  desc: string
  tag: string
  icon: React.ComponentType<{ size?: number }>
  defaultProjectName: string
  defaultProjectDesc: string
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'film-storyboard',
    typeClass: 'film',
    title: '影视分镜导演',
    desc: '剧本镜头拆解、光影氛围锚定与多机位分镜连续生成',
    tag: '多镜头连续',
    icon: Clapperboard,
    defaultProjectName: '余烬计划-分镜创作',
    defaultProjectDesc: '电影分镜连续生成，多画面保持构图与光影风格连续性',
  },
  {
    id: 'character-concept',
    typeClass: 'character',
    title: '角色形象设计',
    desc: '角色三视图、面部一致性锚定与多动作姿态衍生',
    tag: '角色一致性',
    icon: Bot,
    defaultProjectName: '赛博纪元-主角设计',
    defaultProjectDesc: '核心主角三视图及多视角表情姿态设定，保持人脸一致',
  },
  {
    id: 'style-lab',
    typeClass: 'style',
    title: '视觉风格探索',
    desc: '艺术调性探索、光影材质预演与参考素材情绪板',
    tag: '灵感情绪板',
    icon: Palette,
    defaultProjectName: '黑白胶片风格实验',
    defaultProjectDesc: '高对比度黑白光影与冷色胶片颗粒质感探索',
  },
  {
    id: 'hires-inpaint',
    typeClass: 'refine',
    title: '高清修复重绘',
    desc: '画板精准标注局部修改、细节擦除与 4K 超分扩图',
    tag: '局部标注精修',
    icon: Layers,
    defaultProjectName: '概念图细节精修',
    defaultProjectDesc: '画面局部瑕疵标注消除与主体边缘细节增强',
  },
]

function formatOpenedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '最近打开'
  const days = Math.floor((Date.now() - date.getTime()) / 86400000)
  return days <= 0 ? '刚刚编辑' : `${days} 天前`
}

function getCoverClass(name: string): string {
  const code = name.charCodeAt(0) || 0
  const colors = ['red-cover', 'blue-cover', 'amber-cover', 'purple-cover']
  return colors[code % colors.length]
}

function ProjectRow({
  project,
  onOpen,
  onRelocate,
  busy,
}: {
  project: ProjectSummary
  onOpen: () => void
  onRelocate: () => void
  busy: boolean
}) {
  return (
    <div className="project-row-wrap">
      <button
        type="button"
        className="project-row"
        onClick={onOpen}
        disabled={busy}
        title={`打开项目：${project.name}`}
      >
        <span className={`project-cover ${getCoverClass(project.name)}`}>
          {project.name.slice(0, 1)}
        </span>
        <div className="project-info">
          <strong>{project.name}</strong>
          <small>
            {project.description || project.displayPath} · {formatOpenedAt(project.openedAt)}
          </small>
        </div>
        <ArrowRight size={16} className="project-row-arrow" />
      </button>
      <button
        type="button"
        className="project-relocate"
        onClick={onRelocate}
        disabled={busy}
        aria-label={`重新定位 ${project.name}`}
        title="项目路径已移动？点击重新指定文件夹"
      >
        重新定位
      </button>
    </div>
  )
}

export interface StartScreenProps {
  onOpenProject: (project: ProjectSummary) => void
  projectsState?: StartProjectsState
}

export function filterRecentProjects(projects: ProjectSummary[], query: string): ProjectSummary[] {
  if (!query.trim()) return projects
  const q = query.trim().toLowerCase()
  return projects.filter(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      p.displayPath.toLowerCase().includes(q) ||
      (p.description && p.description.toLowerCase().includes(q))
  )
}

export function StartScreen({ onOpenProject, projectsState }: StartScreenProps): React.ReactElement {
  const fallbackState = useStartProjects()
  const state = projectsState ?? fallbackState
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const busy = state.action !== null

  const handleSelectTemplate = (tpl: WorkflowTemplate) => {
    setName(tpl.defaultProjectName)
    setDescription(tpl.defaultProjectDesc)
    setCreateOpen(true)
  }

  const handleOpenBlankCreate = () => {
    setName('')
    setDescription('')
    setCreateOpen(true)
  }

  const createProject = async (event: React.FormEvent) => {
    event.preventDefault()
    const project = await state.create({ name, description })
    if (project) onOpenProject(project)
  }

  const filteredProjects = useMemo(() => filterRecentProjects(state.projects, searchQuery), [searchQuery, state.projects])

  return (
    <div className="start-screen" data-testid="start-screen">
      {/* 顶部品牌 */}
      <header className="start-brand stagger-1">
        <img src="./icon.png" alt="Latent Studio" />
        <div>
          <strong>Latent Studio</strong>
          <span>本地图像工作站 · 项目启动页</span>
        </div>
      </header>

      {/* 主体两列内容 */}
      <main className="start-content">
        {/* 左侧：标语、行动按钮、创作工作流模板 */}
        <section className="start-copy">
          <div className="start-badge stagger-1">
            <span className="badge-dot" />
            <span>本地优先 · 影视图像与分镜创作工作站</span>
          </div>

          <h1 className="stagger-2">让一个项目，从灵感走到画面。</h1>
          <p className="stagger-2">
            把文本研究、角色素材、分镜计划和图片版本放进同一个本地工作边界，全流程隐私与高质感呈现。
          </p>

          <div className="start-actions stagger-3">
            <button
              type="button"
              className="primary"
              onClick={handleOpenBlankCreate}
              disabled={busy}
            >
              <Plus size={17} />
              新建项目
            </button>
            <button
              type="button"
              className="secondary"
              onClick={async () => {
                const project = await state.open()
                if (project) onOpenProject(project)
              }}
              disabled={busy}
            >
              <FolderOpen size={16} />
              打开已有项目
            </button>
          </div>

          {/* 创作模板矩阵 */}
          <div className="workflow-templates-section stagger-4">
            <div className="templates-header">
              <Sparkles size={13} />
              <span>推荐创作工作流</span>
            </div>
            <div className="template-grid">
              {WORKFLOW_TEMPLATES.map((tpl) => {
                const IconComponent = tpl.icon
                return (
                  <button
                    type="button"
                    key={tpl.id}
                    className={`template-card ${tpl.typeClass}`}
                    onClick={() => handleSelectTemplate(tpl)}
                    disabled={busy}
                    data-testid={`template-${tpl.id}`}
                  >
                    <div className="template-card-top">
                      <div className="template-icon-wrap">
                        <IconComponent size={16} />
                      </div>
                      <span className="template-tag">{tpl.tag}</span>
                    </div>
                    <span className="template-title">{tpl.title}</span>
                    <span className="template-desc">{tpl.desc}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </section>

        {/* 右侧：最近项目面板 */}
        <section className="recent-block stagger-3">
          <div className="recent-title">
            <strong>最近项目</strong>
            <span>{state.projects.length} 个项目</span>
          </div>

          {state.projects.length > 3 && (
            <div className="recent-search-wrap">
              <Search size={13} className="recent-search-icon" />
              <input
                type="text"
                className="recent-search-input"
                placeholder="搜索最近项目…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="搜索最近项目"
              />
            </div>
          )}

          {state.status === 'loading' && (
            <div className="start-state">
              <LoaderCircle size={17} className="spin" />
              正在读取最近项目…
            </div>
          )}

          {state.status === 'error' && (
            <div className="start-state error">
              <span>{state.error?.message || '无法读取最近项目'}</span>
              <button
                type="button"
                className="icon-button"
                onClick={() => void state.reload()}
                aria-label="重试"
              >
                <RefreshCw size={16} />
              </button>
            </div>
          )}

          {state.movedProject && (
            <div className="start-state error">
              <span>项目“{state.movedProject.name}”已移动，请重新定位。</span>
              <button
                type="button"
                className="secondary small"
                onClick={async () => {
                  const relocated = await state.relocate(state.movedProject!)
                  if (relocated) onOpenProject(relocated)
                }}
              >
                重新定位
              </button>
            </div>
          )}

          {state.status === 'ready' && filteredProjects.length === 0 && (
            <div className="empty-recent-box">
              <div className="empty-recent-icon">
                <FolderPlus size={22} />
              </div>
              <h4>{searchQuery ? '未找到匹配的项目' : '开启你的首个创作项目'}</h4>
              <p>
                {searchQuery
                  ? '请尝试不同的关键词，或清空搜索'
                  : '点击上方“新建项目”或选择左侧工作流模板，开启本地图像创作之旅。'}
              </p>
              {!searchQuery && (
                <button
                  type="button"
                  className="empty-recent-cta"
                  onClick={handleOpenBlankCreate}
                >
                  + 新建空白项目
                </button>
              )}
            </div>
          )}

          {filteredProjects.length > 0 && (
            <div className="recent-list-container">
              {filteredProjects.map((project) => (
                <ProjectRow
                  key={project.id}
                  project={project}
                  busy={busy}
                  onOpen={async () => {
                    const opened = await state.open(project)
                    if (opened) onOpenProject(opened)
                  }}
                  onRelocate={async () => {
                    const relocated = await state.relocate(project)
                    if (relocated) onOpenProject(relocated)
                  }}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      {/* 底部信息 */}
      <footer className="start-footer stagger-5">
        <span>
          {state.error?.code === 'project-moved'
            ? '项目位置已变化，请重新定位后继续'
            : '项目文件夹由应用按需创建，原文件保持安全独立'}
        </span>
        <span>v{APP_VERSION} · 本地工作流引擎</span>
      </footer>

      {/* 新建项目弹窗 */}
      {createOpen && (
        <div
          className="start-create-dialog"
          role="dialog"
          aria-modal="true"
          aria-label="新建项目"
        >
          <form onSubmit={createProject}>
            <h2>新建项目</h2>
            <label>
              项目名称
              <input
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="例如：余烬计划"
              />
            </label>
            <label>
              说明（可选）
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="简述创作目标或主题风格…"
              />
            </label>
            <div>
              <button
                type="button"
                className="secondary"
                onClick={() => setCreateOpen(false)}
              >
                取消
              </button>
              <button
                type="submit"
                className="primary"
                disabled={busy || !name.trim()}
              >
                {busy ? '创建中…' : '选择文件夹并创建'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

export default StartScreen
