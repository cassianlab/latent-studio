import { describe, expect, it } from 'vitest'
import { resolveAgentImageCount, resolveAgentPlanStatus } from '../../src/renderer/agent/agent-plan-state'

describe('Agent image planning state', () => {
  it('uses the image count stated by the user before the parameter fallback', () => {
    expect(resolveAgentImageCount('请生成两张图片', 4)).toBe(2)
    expect(resolveAgentImageCount('生成 3 个镜头', 8)).toBe(3)
    expect(resolveAgentImageCount('做十二幅分镜', 4)).toBe(12)
    expect(resolveAgentImageCount('使用 16:9 画幅生成雨夜画面', 4)).toBe(4)
  })

  it('does not return to awaiting confirmation after tasks finish', () => {
    expect(resolveAgentPlanStatus({ executing: false, paused: false, taskStatuses: ['completed', 'completed'] })).toBe('completed')
    expect(resolveAgentPlanStatus({ executing: false, paused: false, taskStatuses: ['completed', 'failed'] })).toBe('partial')
    expect(resolveAgentPlanStatus({ executing: false, paused: false, taskStatuses: [] })).toBe('awaiting-confirmation')
  })

  it('uses terminal task statuses even if the execution flag is stale', () => {
    expect(resolveAgentPlanStatus({ executing: true, paused: false, taskStatuses: ['completed', 'completed'] })).toBe('completed')
    expect(resolveAgentPlanStatus({ executing: true, paused: false, taskStatuses: ['completed', 'failed'] })).toBe('partial')
    expect(resolveAgentPlanStatus({ executing: true, paused: false, taskStatuses: ['completed', 'running'] })).toBe('running')
  })
})
