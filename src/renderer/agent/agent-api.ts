import type { AgentApi, PlanImageInput, PlanImageResult } from '../../shared/contracts/agent'

const mockApi: AgentApi = {
  async planImage(input: PlanImageInput): Promise<PlanImageResult> {
    const titles = ['正面中景', '侧面近景', '环境远景', '细节特写', '低角度', '俯视构图', '背影剪影', '反射倒影']
    const contextPrefix = input.contextMessages && input.contextMessages.length > 0
      ? `[关联上下文] `
      : ''
    const variations = Array.from({ length: input.count }, (_, index) => ({ id: `mock-variation-${index}`, title: titles[index] ?? `镜头 ${index + 1}`, prompt: `${contextPrefix}${input.prompt}，${titles[index] ?? `镜头 ${index + 1}`}，电影感构图`, difference: titles[index] ?? `镜头 ${index + 1}` }))
    return { mode: input.mode, invariants: ['用户描述的主体与风格'], variations, sourceModelProfileId: input.modelProfileId }
  },
  async runSkill() { throw new Error('浏览器预览不执行 Skill 脚本') },
  async run(input) {
    const now = new Date().toISOString()
    return { runId: `preview-${Date.now()}`, status: 'completed', text: `预览模式不会执行 Agent 工具链：${input.prompt}`, steps: [{ id: 'preview-step', kind: 'final', name: '预览', status: 'completed', startedAt: now, finishedAt: now }] }
  },
  onStreamEvent() { return () => {} },
  async confirm(runId) { return { runId, status: 'failed', text: '预览模式没有待确认任务', steps: [] } },
  async cancel(runId) { return { runId, status: 'cancelled', text: '预览模式没有正在运行的 Agent', steps: [] } },
  async cancelSkill() { return false },
  async list() { return [] },
}

export function getAgentApi(): AgentApi { return typeof window !== 'undefined' && window.latentStudio?.agent ? window.latentStudio.agent : mockApi }
