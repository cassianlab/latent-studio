import { useEffect, useState } from 'react'
import { ArrowRight, Check, Copy, FolderGit2, Layers, Sliders } from 'lucide-react'
import type { ProjectSummary } from '../../shared/contracts/projects'

interface ProjectPreferences {
  defaultRatio: string
  defaultResolution: string
  quality: string
  autoSaveToAssets: boolean
  confirmBeforeRun: boolean
}

const defaultPreferences: ProjectPreferences = {
  defaultRatio: '16:9 横版',
  defaultResolution: '2K',
  quality: '平衡标准',
  autoSaveToAssets: true,
  confirmBeforeRun: false,
}

export function ProjectSettingsPage({
  project,
  onOpenGlobalSettings,
}: {
  project: ProjectSummary
  onOpenGlobalSettings: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [preferences, setPreferences] = useState<ProjectPreferences>(defaultPreferences)
  const [savedHint, setSavedHint] = useState(false)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(`latent-studio:project-prefs:${project.id}`)
      if (stored) {
        setPreferences({ ...defaultPreferences, ...JSON.parse(stored) })
      } else {
        setPreferences(defaultPreferences)
      }
    } catch {
      setPreferences(defaultPreferences)
    }
  }, [project.id])

  const updatePreference = <K extends keyof ProjectPreferences>(key: K, value: ProjectPreferences[K]) => {
    const next = { ...preferences, [key]: value }
    setPreferences(next)
    try {
      localStorage.setItem(`latent-studio:project-prefs:${project.id}`, JSON.stringify(next))
      setSavedHint(true)
      window.setTimeout(() => setSavedHint(false), 1500)
    } catch {}
  }

  const copyPath = async () => {
    const path = project.path || project.displayPath
    if (!path) return
    await navigator.clipboard?.writeText(path)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="content-page project-settings-page">
      <div className="section-heading">
        <div>
          <h2>项目设置</h2>
          <p>当前项目专属工作区配置，与全局模型及服务商设置相互独立。</p>
        </div>
        <div className="project-settings-actions">
          {savedHint && <span className="pill green">已保存</span>}
          <button type="button" className="secondary small" onClick={onOpenGlobalSettings}>
            前往全局模型设置 <ArrowRight size={14} />
          </button>
        </div>
      </div>

      <div className="project-settings-tabs-nav">
        <span className="project-settings-tab active">当前项目设置（{project.name}）</span>
        <button type="button" className="project-settings-tab link" onClick={onOpenGlobalSettings}>
          全局服务商与模型设置 →
        </button>
      </div>

      <div className="project-settings-container">
        <section className="project-settings-card">
          <div className="project-settings-card-head">
            <FolderGit2 size={18} />
            <div>
              <strong>项目基本信息</strong>
              <small>本地项目元数据与存储位置</small>
            </div>
          </div>
          <div className="project-settings-grid">
            <div className="project-info-row">
              <span className="info-label">项目名称</span>
              <span className="info-value"><strong>{project.name}</strong></span>
            </div>
            {project.description && (
              <div className="project-info-row">
                <span className="info-label">项目描述</span>
                <span className="info-value">{project.description}</span>
              </div>
            )}
            <div className="project-info-row">
              <span className="info-label">存储路径</span>
              <div className="info-path-box">
                <code>{project.path || project.displayPath}</code>
                <button type="button" className="secondary small" onClick={() => void copyPath()} title="复制完整路径">
                  {copied ? <><Check size={13} />已复制</> : <><Copy size={13} />复制路径</>}
                </button>
              </div>
            </div>
            <div className="project-info-row">
              <span className="info-label">最近访问</span>
              <span className="info-value">
                {project.openedAt ? new Date(project.openedAt).toLocaleString('zh-CN') : '刚刚'}
              </span>
            </div>
          </div>
        </section>

        <section className="project-settings-card">
          <div className="project-settings-card-head">
            <Sliders size={18} />
            <div>
              <strong>项目生图偏好预设</strong>
              <small>针对当前项目设定默认的生成画幅、分辨率和输出控制</small>
            </div>
          </div>
          <div className="form-grid project-prefs-grid">
            <label>
              默认画幅比例
              <select
                value={preferences.defaultRatio}
                onChange={(e) => updatePreference('defaultRatio', e.target.value)}
              >
                <option value="16:9 横版">16:9 横版 (电影/桌面)</option>
                <option value="4:3 经典">4:3 经典 (纪录片/传统画幅)</option>
                <option value="1:1 正方形">1:1 正方形 (头像/构图特写)</option>
                <option value="9:16 竖版">9:16 竖版 (海报/手机)</option>
              </select>
            </label>

            <label>
              默认分辨率规格
              <select
                value={preferences.defaultResolution}
                onChange={(e) => updatePreference('defaultResolution', e.target.value)}
              >
                <option value="1K">1K (快速预览 · 1024×576)</option>
                <option value="2K">2K (高清母版 · 2048×1152)</option>
                <option value="4K">4K (模型原生上限 · 3840×2160)</option>
              </select>
            </label>

            <label>
              生图质量与算力倾向
              <select
                value={preferences.quality}
                onChange={(e) => updatePreference('quality', e.target.value)}
              >
                <option value="速度优先">速度优先 (降低步数，极速产出)</option>
                <option value="平衡标准">平衡标准 (兼顾细节与响应)</option>
                <option value="画质优先">画质优先 (充分精修与重绘)</option>
              </select>
            </label>
          </div>

          <div className="project-prefs-toggles">
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={preferences.autoSaveToAssets}
                onChange={(e) => updatePreference('autoSaveToAssets', e.target.checked)}
              />
              <div>
                <strong>自动归档生成图片至素材库</strong>
                <small>工作台中生成的满意识别图将自动保存在项目素材库的“生成结果”分组中</small>
              </div>
            </label>

            <label className="toggle-row">
              <input
                type="checkbox"
                checked={preferences.confirmBeforeRun}
                onChange={(e) => updatePreference('confirmBeforeRun', e.target.checked)}
              />
              <div>
                <strong>批量任务前进行确认</strong>
                <small>当单次提交超过 4 张图片生成任务时，弹出预估耗时与二次确认提示</small>
              </div>
            </label>
          </div>
        </section>

        <section className="project-settings-card">
          <div className="project-settings-card-head">
            <Layers size={18} />
            <div>
              <strong>项目目录结构规范</strong>
              <small>本地项目文件夹自动维护的结构规范</small>
            </div>
          </div>
          <div className="directory-structure-list">
            <div className="dir-item">
              <code>documents/</code>
              <span>项目剧本、大纲与参考文档</span>
            </div>
            <div className="dir-item">
              <code>assets/</code>
              <span>角色原画、道具资产与场景参考图</span>
            </div>
            <div className="dir-item">
              <code>outputs/</code>
              <span>AI 生图与局部修改的最终产物</span>
            </div>
            <div className="dir-item">
              <code>.latent-studio/</code>
              <span>本地项目 SQLite 数据库与缓存索引</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
