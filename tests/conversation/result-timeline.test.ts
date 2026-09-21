import { describe, expect, it } from 'vitest'
import { assignResultsToMessages, partitionGalleryResults } from '../../src/renderer/conversation/result-timeline'

describe('conversation result timeline', () => {
  it('keeps explicit task references on their original assistant turn', () => {
    const assignments = assignResultsToMessages([
      { id: 'user-1', role: 'user', text: '第一轮', createdAt: 100 },
      { id: 'assistant-1', role: 'assistant', text: '已提交', imageTaskIds: ['task-1'], createdAt: 110 },
      { id: 'user-2', role: 'user', text: '第二轮', createdAt: 200 },
      { id: 'assistant-2', role: 'assistant', text: '已完成', imageTaskIds: ['task-2'], createdAt: 210 },
    ], [
      { id: 'task-1', title: '第一轮图片', status: 'completed' },
      { id: 'task-2', title: '第二轮图片', status: 'completed' },
    ])

    expect(assignments.get('assistant-1')).toEqual(['task-1'])
    expect(assignments.get('assistant-2')).toEqual(['task-2'])
  })

  it('places legacy unlinked results after the closest preceding turn', () => {
    const assignments = assignResultsToMessages([
      { id: 'user-1', role: 'user', text: '第一轮', createdAt: 100 },
      { id: 'assistant-1', role: 'assistant', text: '第一轮完成', createdAt: 120 },
      { id: 'user-2', role: 'user', text: '第二轮', createdAt: 300 },
      { id: 'assistant-2', role: 'assistant', text: '第二轮完成', createdAt: 320 },
    ], [
      { id: 'legacy-1', title: '旧图片', status: 'completed', task: { id: 'legacy-1', connectionId: 'image', status: 'completed', request: { prompt: '第一轮图片' }, progress: 100, attempts: 1, createdAt: '1970-01-01T00:00:00.200Z', updatedAt: '1970-01-01T00:00:00.220Z' } },
    ])

    expect(assignments.get('assistant-1')).toEqual(['legacy-1'])
    expect(assignments.get('assistant-2')).toBeUndefined()
  })

  it('keeps failed and cancelled tasks out of the image-card grid', () => {
    const partitioned = partitionGalleryResults([
      { id: 'completed', title: '完成图片', status: 'completed' },
      { id: 'running', title: '生成中', status: 'running' },
      { id: 'failed', title: '失败任务', status: 'failed' },
      { id: 'cancelled', title: '取消任务', status: 'cancelled' },
    ])

    expect(partitioned.cards.map((result) => result.id)).toEqual(['completed', 'running'])
    expect(partitioned.unfinished.map((result) => result.id)).toEqual(['failed', 'cancelled'])
  })
})
