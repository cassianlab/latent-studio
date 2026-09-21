import type { AgentActivityPhase, AgentStep } from '../../shared/contracts/agent'

const toolLabels: Record<string, string> = {
  search_web: '联网检索',
  search_prompt_library: '检索提示词库',
  get_prompt_detail: '读取提示词详情',
  read_project_file: '读取项目资料',
  read_project_memory: '读取项目记忆',
  read_project_asset_metadata: '读取素材信息',
  activate_skills: '选择 Skill',
  run_skill: '执行 Skill',
  create_image_tasks: '提交图片任务',
  control_image_tasks: '更新图片任务',
  create_project_document: '创建项目文档',
  update_project_document: '更新项目文档',
  delete_project_document: '删除项目文档',
  create_project_memory: '创建项目记忆',
  update_project_memory: '更新项目记忆',
  delete_project_memory: '删除项目记忆',
  create_personal_prompt: '创建个人提示词',
  update_personal_prompt: '更新个人提示词',
  delete_personal_prompt: '删除个人提示词',
  '文本模型': '分析并组织回复',
  '完成': '整理执行结果',
}

export function agentStepLabel(step: Pick<AgentStep, 'name'>): string {
  return toolLabels[step.name] ?? '执行任务'
}

export interface AgentActivityState {
  phase: AgentActivityPhase
  label: string
}
