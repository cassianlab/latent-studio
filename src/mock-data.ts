import type { LucideIcon } from 'lucide-react'
import {
  Blocks, BookOpenText, Brain, FileText, Image, LayoutDashboard, PanelsTopLeft,
  ListChecks, MessageSquareText, Settings2, Sparkles, WandSparkles,
} from 'lucide-react'

export type PageKey = 'workspace' | 'canvas' | 'assets' | 'documents' | 'prompts' | 'skills' | 'tasks' | 'settings' | 'global-settings' | 'memory'
export type Mode = 'text' | 'image' | 'agent'

export interface NavItem { key: PageKey; label: string; icon: LucideIcon }
export interface AssetItem { id: number; name: string; role: string; tone: string; image: string; meta: string }
export interface TaskItem { id: string; title: string; status: '完成' | '运行中' | '排队中' | '失败' | '已暂停'; progress: number; model: string; route: string }

export const navItems: NavItem[] = [
  { key: 'workspace', label: '工作台', icon: LayoutDashboard },
  { key: 'canvas', label: '视觉画布', icon: PanelsTopLeft },
  { key: 'assets', label: '素材库', icon: Image },
  { key: 'documents', label: '项目文档', icon: FileText },
  { key: 'prompts', label: '提示词库', icon: WandSparkles },
  { key: 'skills', label: '技能', icon: Blocks },
  { key: 'tasks', label: '任务中心', icon: ListChecks },
  { key: 'memory', label: '记忆', icon: Brain },
  { key: 'settings', label: '项目设置', icon: Settings2 },
]

export const modes = [
  { key: 'text' as const, label: '文本', icon: MessageSquareText, hint: '研究、写作与资料整理' },
  { key: 'image' as const, label: '图片', icon: Sparkles, hint: '生成、变体与参考图重绘' },
  { key: 'agent' as const, label: 'Agent', icon: BookOpenText, hint: '对话协作与按需执行' },
]

export const assets: AssetItem[] = [
  { id: 1, name: '林默 · 角色定妆', role: '角色', tone: 'jade', image: './refs/scene-1.png', meta: '3 张参考 · 已锁定面部特征' },
  { id: 2, name: '雨夜便利店', role: '场景', tone: 'blue', image: './refs/scene-2.png', meta: '16:9 · 霓虹与湿地反光' },
  { id: 3, name: '旧式录音机', role: '道具', tone: 'amber', image: './refs/scene-3.png', meta: '正面 / 侧面 · 暗红按键' },
  { id: 4, name: '低饱和胶片', role: '风格参考', tone: 'rose', image: './refs/scene-4.png', meta: '风格 · 柔和颗粒与暖高光' },
  { id: 5, name: '深夜街角 v2', role: '生成结果', tone: 'violet', image: './refs/scene-5.png', meta: '由任务 IMG-204 派生' },
  { id: 6, name: '红色雨伞', role: '普通参考图', tone: 'red', image: './refs/scene-6.png', meta: '临时引用 · 未复制到项目' },
]

export const tasks: TaskItem[] = [
  { id: 'IMG-204', title: '雨夜重逢 · 正面中景', status: '完成', progress: 100, model: 'Flux Kontext Pro', route: '图像连接 A · 并发 2/3' },
  { id: 'IMG-205', title: '雨夜重逢 · 橱窗倒影', status: '运行中', progress: 68, model: 'Flux Kontext Pro', route: '图像连接 A · 并发 2/3' },
  { id: 'IMG-206', title: '雨夜重逢 · 手部特写', status: '排队中', progress: 0, model: 'Flux Kontext Pro', route: '等待连接槽位' },
  { id: 'IMG-207', title: '雨夜重逢 · 远景剪影', status: '已暂停', progress: 24, model: 'Flux Kontext Pro', route: '用户调整方向' },
  { id: 'TXT-082', title: '优化四镜头视觉提示词', status: '完成', progress: 100, model: 'Claude Sonnet 4', route: '文本连接 B · 原生工具' },
]

export const documents = [
  { title: '第一幕 · 雨夜来电', type: 'Markdown', updated: '刚刚', detail: '1,284 字 · 已关联 4 个分镜' },
  { title: '角色小传 · 林默', type: 'Markdown', updated: '昨天', detail: '856 字 · 引用角色素材' },
  { title: '城市世界观设定', type: 'PDF 提取', updated: '9 月 10 日', detail: '12 页 · 来源文件已保留' },
  { title: '分镜表 v3', type: '结构化分镜', updated: '9 月 9 日', detail: '18 镜 · 派生自第一幕' },
]

export const prompts = [
  { name: '电影感雨夜人像', type: '提示词', scope: '项目', tags: ['电影感', '夜景'], body: 'cinematic rainy night portrait, soft practical light, restrained color...' },
  { name: '四镜头情绪变体', type: '模板', scope: '全局', tags: ['分镜', '变量'], body: '保持 {{character}} 一致，在 {{location}} 生成四个叙事明确的镜头...' },
  { name: '低饱和 35mm', type: '风格', scope: '项目', tags: ['胶片', '质感'], body: 'muted palette, subtle 35mm grain, soft halation, natural skin...' },
]

export const skills = [
  { name: 'shot-planner', label: '分镜规划', source: '已安装 · 全局', trust: '受控执行', enabled: true, note: '把剧本拆成可编辑镜头计划' },
  { name: 'prompt-auditor', label: '提示词审查', source: '链接 · 项目', trust: '首次确认', enabled: true, note: '检查角色一致性与冲突约束' },
  { name: 'palette-extractor', label: '色彩提取', source: '已安装 · 项目', trust: '未授权', enabled: false, note: '从参考图提取可复用色板' },
]

export const memories = [
  { title: '默认使用 16:9 横构图', scope: '全局记忆', source: '用户明确要求', active: true },
  { title: '林默左眉有一道短疤', scope: '项目记忆', source: '角色设定文档', active: true },
  { title: '避免赛博朋克式蓝紫霓虹', scope: '项目记忆', source: '对话候选 · 已确认', active: true },
  { title: '优先保留环境中的生活痕迹', scope: '全局记忆', source: 'Agent 建议 · 待确认', active: false },
]
