import { useMemo, useState } from 'react'
import {
  Activity, Archive, ArrowDown, ArrowUp, Check, ChevronDown, CircleHelp, Clock3,
  Command, Copy, FileImage, FolderKanban, ImagePlus, Layers3, Menu, Moon, MoreHorizontal,
  Pause, Pencil, Play, Plus, RotateCcw, Search, Send, Settings2, Sparkles, Sun,
  Trash2, Upload, WandSparkles, X, Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import './phase0.css'

type Mode = 'text' | 'image' | 'agent'
type Panel = 'queue' | 'assets' | 'library' | 'settings' | null
type TaskState = '运行中' | '排队中' | '已暂停' | '失败'

const modes: { key: Mode; label: string; hint: string }[] = [
  { key: 'text', label: '文本', hint: '研究、写作与资料整理' },
  { key: 'image', label: '图片', hint: '生成、变体与参考图' },
  { key: 'agent', label: 'Agent', hint: '对话协作与按需执行' },
]
const nav = [
  ['工作台', Activity], ['视觉画布', Layers3], ['素材库', FileImage], ['任务中心', Clock3],
  ['提示词库', WandSparkles], ['Skills', Zap], ['记忆', Archive], ['项目设置', Settings2],
] as const
const images = ['/refs/scene-1.png', '/refs/scene-2.png', '/refs/scene-3.png', '/refs/scene-5.png']
const resourceLinks: { label: string; icon: LucideIcon; detail: string }[] = [
  { label: '提示词库', icon: WandSparkles, detail: '12 个项目提示词' },
  { label: 'Skills', icon: Zap, detail: '2 个已启用 Skill' },
  { label: '记忆', icon: Archive, detail: '3 条已确认约束' },
]

function Icon({ label, children, onClick, active = false }: { label: string; children: React.ReactNode; onClick?: () => void; active?: boolean }) {
  return <button className={`p0-icon ${active ? 'is-active' : ''}`} aria-label={label} title={label} onClick={onClick}>{children}</button>
}

function QueuePanel({ tasks, onChange }: { tasks: { id: string; title: string; state: TaskState; progress: number }[]; onChange: (id: string, state: TaskState) => void }) {
  return <aside className="p0-panel p0-queue"><div className="p0-panel-head"><div><span className="p0-eyebrow">任务中心</span><h2>生成队列</h2></div><Icon label="关闭" onClick={() => onChange('close', '运行中')}><X size={16} /></Icon></div><div className="p0-queue-summary"><strong>{tasks.filter(t => t.state === '运行中').length}</strong><span>运行中</span><strong>{tasks.filter(t => t.state === '排队中').length}</strong><span>排队中</span><button onClick={() => tasks.forEach(task => onChange(task.id, '已暂停'))}><Pause size={14} />全部暂停</button></div><div className="p0-task-list">{tasks.map(task => <div className="p0-task" key={task.id}><div className="p0-task-top"><span className={`p0-status ${task.state.replace('中', '')}`}></span><strong>{task.title}</strong><span>{task.state}</span></div><div className="p0-progress"><i style={{ width: `${task.progress}%` }} /></div><div className="p0-task-foot"><small>{task.id} · Flux Kontext Pro</small>{task.state === '运行中' && <Icon label="暂停" onClick={() => onChange(task.id, '已暂停')}><Pause size={14} /> </Icon>}{task.state === '已暂停' && <Icon label="继续" onClick={() => onChange(task.id, '运行中')}><Play size={14} /> </Icon>}{task.state === '失败' && <Icon label="重试" onClick={() => onChange(task.id, '排队中')}><RotateCcw size={14} /> </Icon>}<Icon label="取消" onClick={() => onChange(task.id, '失败')}><Trash2 size={14} /></Icon></div></div>)}</div></aside>
}

function AssetsPanel({ selected, onSelect, onClose }: { selected: number[]; onSelect: (index: number) => void; onClose: () => void }) {
  return <aside className="p0-panel p0-assets"><div className="p0-panel-head"><div><span className="p0-eyebrow">当前项目</span><h2>素材与参考图</h2></div><Icon label="关闭" onClick={onClose}><X size={16} /></Icon></div><div className="p0-asset-tools"><button className="p0-secondary"><Upload size={14} />导入素材</button><button className="p0-secondary"><Search size={14} />搜索</button></div><p className="p0-panel-note">选择的素材会作为当前提示词的参考，不会自动上传或执行。</p><div className="p0-asset-grid">{images.map((src, i) => <button className={`p0-asset ${selected.includes(i) ? 'selected' : ''}`} onClick={() => onSelect(i)} key={src}><img src={src} alt={`参考图 ${i + 1}`} /><span><b>{['林默 · 角色定妆', '雨夜便利店', '旧式录音机', '深夜街角 v2'][i]}</b><small>{selected.includes(i) ? '已选择' : '点击加入参考'}</small></span>{selected.includes(i) && <Check size={14} />}</button>)}</div></aside>
}

function ResourcePanel({ onClose, onOpen }: { onClose: () => void; onOpen: (panel: Panel) => void }) {
  return <aside className="p0-panel p0-resources"><div className="p0-panel-head"><div><span className="p0-eyebrow">项目资源</span><h2>快速入口</h2></div><Icon label="关闭" onClick={onClose}><X size={16} /></Icon></div>{resourceLinks.map(({ label, icon: Comp, detail }) => <button className="p0-resource" key={label} onClick={() => onOpen(label === 'Skills' ? 'settings' : 'library')}><span className="p0-resource-icon"><Comp size={16} /></span><span><b>{label}</b><small>{detail}</small></span><ArrowDown size={14} /></button>)}<div className="p0-resource-note"><CircleHelp size={15} /><span>阶段 0 原型<br /><small>当前操作只改变演示状态</small></span></div></aside>
}

function SettingsPanel({ onClose }: { onClose: () => void }) {
  return <aside className="p0-panel p0-settings"><div className="p0-panel-head"><div><span className="p0-eyebrow">偏好设置</span><h2>项目设置</h2></div><Icon label="关闭" onClick={onClose}><X size={16} /></Icon></div><label className="p0-field">项目名称<input defaultValue="余烬计划" /></label><label className="p0-field">默认画幅<select defaultValue="16:9"><option>16:9</option><option>4:3</option><option>1:1</option></select></label><div className="p0-setting-row"><span><b>减少动画</b><small>尊重系统偏好，降低过渡效果</small></span><input type="checkbox" defaultChecked /></div><div className="p0-setting-row"><span><b>执行前确认</b><small>原型中始终停在确认节点</small></span><input type="checkbox" defaultChecked /></div><button className="p0-primary" onClick={onClose}>完成</button></aside>
}

function Phase0Prototype() {
  const [dark, setDark] = useState(false)
  const [mode, setMode] = useState<Mode>('image')
  const [panel, setPanel] = useState<Panel>(null)
  const [navOpen, setNavOpen] = useState(true)
  const [projectOpen, setProjectOpen] = useState(false)
  const [preview, setPreview] = useState<number | null>(null)
  const [selected, setSelected] = useState<number[]>([0, 1])
  const [prompt, setPrompt] = useState('雨夜便利店中的林默，深灰风衣，克制电影感；玻璃倒影分隔两人，湿地反光，低饱和暖高光。')
  const [sent, setSent] = useState(false)
  const [tasks, setTasks] = useState([{ id: 'IMG-205', title: '橱窗倒影 · 变体 02', state: '运行中' as TaskState, progress: 68 }, { id: 'IMG-206', title: '手部特写 · 变体 03', state: '排队中' as TaskState, progress: 0 }, { id: 'IMG-207', title: '远景剪影 · 变体 04', state: '已暂停' as TaskState, progress: 24 }])
  const currentMode = useMemo(() => modes.find(item => item.key === mode) ?? modes[1], [mode])
  const changeTask = (id: string, state: TaskState) => { if (id !== 'close') setTasks(items => items.map(task => task.id === id ? { ...task, state } : task)) }
  const submit = () => { if (!prompt.trim()) return; setSent(true); setTasks(items => [{ id: `IMG-${208 + items.length}`, title: '新提示词 · 预览任务', state: '排队中', progress: 0 }, ...items]) }
  return <div className={`p0-shell ${dark ? 'dark' : ''}`}>
    <aside className={`p0-sidebar ${navOpen ? '' : 'collapsed'}`}><div className="p0-brand"><img src="/icon.png" alt="" /><strong>{navOpen && 'Latent Studio'}</strong><Icon label={navOpen ? '收起导航' : '展开导航'} onClick={() => setNavOpen(value => !value)}><Menu size={17} /></Icon></div><button className="p0-project" onClick={() => setProjectOpen(value => !value)}><span>余</span>{navOpen && <span><b>余烬计划</b><small>本地项目 · 原型</small></span>}<ChevronDown size={14} /></button>{projectOpen && navOpen && <div className="p0-project-menu"><button onClick={() => setProjectOpen(false)}>余烬计划 <Check size={14} /></button><button onClick={() => setProjectOpen(false)}>短片试验场</button><button onClick={() => setProjectOpen(false)}><Plus size={14} />新建项目</button></div>}<nav>{nav.map(([label, Comp], i) => <button key={label} className={i === 0 ? 'selected' : ''} onClick={() => label === '任务中心' ? setPanel('queue') : label === '素材库' ? setPanel('assets') : label === '项目设置' ? setPanel('settings') : label === '提示词库' || label === 'Skills' || label === '记忆' ? setPanel('library') : undefined}><Comp size={17} />{navOpen && <span>{label}</span>}{label === '任务中心' && navOpen && <b>3</b>}</button>)}</nav><div className="p0-side-foot"><span className="p0-live"></span>{navOpen && <span><b>原型模式</b><small>不会调用真实模型</small></span>}<Icon label="帮助"><CircleHelp size={17} /></Icon></div></aside>
    <main className="p0-main"><header className="p0-topbar"><div className="p0-title"><span className="p0-breadcrumb">工作台</span><span>/</span><strong>{currentMode.label}创作</strong><span className="p0-sim">模拟状态</span></div><div className="p0-top-actions"><button className="p0-search"><Search size={15} /><span>搜索项目</span><kbd>⌘ K</kbd></button><Icon label={dark ? '切换浅色' : '切换深色'} onClick={() => setDark(value => !value)}>{dark ? <Sun size={17} /> : <Moon size={17} />}</Icon><Icon label="打开设置" onClick={() => setPanel('settings')}><Settings2 size={17} /></Icon></div></header>
      <section className="p0-workspace"><div className="p0-workspace-head"><div><span className="p0-eyebrow">余烬计划 / 第一幕</span><h1>把想法变成可控的画面</h1><p>在一个工作台里描述、参考、检查，再决定下一步。</p></div><div className="p0-head-actions"><button className="p0-secondary" onClick={() => setPanel('queue')}><Clock3 size={15} />任务队列 <b>{tasks.length}</b></button><button className="p0-secondary" onClick={() => setPanel('assets')}><ImagePlus size={15} />参考图 <b>{selected.length}</b></button></div></div>
        <div className="p0-canvas"><div className="p0-canvas-grid"></div><div className="p0-canvas-copy"><span className="p0-cursor"><Command size={14} /> 当前项目</span><h2>{sent ? '任务已加入队列' : '从一句画面描述开始'}</h2><p>{sent ? '你可以在任务中心暂停、取消或调整方向。' : '选择一种模式，输入想法，然后在右侧上下文中补充参考。'}</p><div className="p0-state-row"><span className="p0-state-dot green"></span>本地工作区已就绪<span className="p0-state-divider">·</span><span>最近编辑 2 分钟前</span></div></div><div className="p0-preview-strip">{images.map((src, i) => <button key={src} onClick={() => setPreview(i)} className={preview === i ? 'selected' : ''}><img src={src} alt={`生成预览 ${i + 1}`} /><span>{i === 0 ? '角色参考' : i === 1 ? '场景参考' : `预览 ${i - 1}`}</span></button>)}</div></div>
        <div className="p0-composer"><div className="p0-mode-tabs">{modes.map(item => <button key={item.key} className={mode === item.key ? 'selected' : ''} onClick={() => { setMode(item.key); setSent(false) }}><span className={`p0-mode-dot ${item.key}`}></span>{item.label}<small>{item.hint}</small></button>)}</div><div className="p0-compose-body"><textarea value={prompt} onChange={event => setPrompt(event.target.value)} aria-label="输入创作描述" placeholder={currentMode.hint} /><div className="p0-compose-meta"><span><Sparkles size={14} />{mode === 'image' ? '图片提示词优化 · 已启用' : mode === 'agent' ? '@shot-planner · 等待确认' : '项目资料 · 可引用'}</span><span>{prompt.length} / 2000</span></div></div><div className="p0-compose-foot"><div><button className="p0-tool" onClick={() => setPanel('assets')}><ImagePlus size={15} />添加参考</button><button className="p0-tool" onClick={() => setPanel('library')}><WandSparkles size={15} />提示词库</button><button className="p0-tool"><Plus size={15} />附件</button></div><div className="p0-send-group"><button className="p0-model">Flux Kontext Pro <ChevronDown size={13} /></button>{mode === 'image' && <button className="p0-model">4 张 <ChevronDown size={13} /></button>}<button className="p0-send" onClick={submit} aria-label="加入队列"><Send size={17} /></button></div></div></div><div className="p0-footnote"><span>阶段 0 原型 · 不会调用真实模型、联网或执行 Skill</span><span>Enter 发送 · Shift + Enter 换行</span></div></section>
      {panel === 'queue' && <QueuePanel tasks={tasks} onChange={changeTask} />}{panel === 'assets' && <AssetsPanel selected={selected} onSelect={index => setSelected(items => items.includes(index) ? items.filter(item => item !== index) : [...items, index])} onClose={() => setPanel(null)} />}{panel === 'library' && <ResourcePanel onClose={() => setPanel(null)} onOpen={setPanel} />}{panel === 'settings' && <SettingsPanel onClose={() => setPanel(null)} />}
    </main>{preview !== null && <div className="p0-lightbox" role="dialog" aria-modal="true"><button className="p0-lightbox-close" onClick={() => setPreview(null)} aria-label="关闭预览"><X size={20} /></button><div className="p0-lightbox-card"><img src={images[preview]} alt="大图预览" /><div><span className="p0-eyebrow">图片预览 / {preview + 1}</span><h2>{['林默 · 角色定妆', '雨夜便利店', '旧式录音机', '深夜街角 v2'][preview]}</h2><p>预览状态可演示。点击编辑入口后，阶段 0 只展示编辑器界面，不提交任务。</p><button className="p0-primary" onClick={() => setPreview(null)}><Pencil size={15} />打开编辑器入口</button></div></div></div>}
  </div>
}

export default Phase0Prototype
