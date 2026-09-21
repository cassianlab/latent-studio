import { describe, expect, it, vi } from 'vitest'
import { AgentRunner } from '../../src/main/agent/runner'
import type { ImageApi, ImageTaskRecord } from '../../src/shared/contracts/images'

function task(id: string, prompt: string, size?: string, quality?: string): ImageTaskRecord {
  const now = new Date().toISOString()
  return {
    id,
    connectionId: 'test-conn',
    status: 'pending',
    request: { prompt, ...(size ? { size } : {}), ...(quality ? { quality } : {}) },
    progress: 0,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  }
}

describe('agent reasoning and image pipeline', () => {
  it('forwards reasoningEffort to model generation', async () => {
    const generate = vi.fn().mockResolvedValue({
      text: '已生成',
      toolCalls: [],
    })

    const runner = new AgentRunner({
      generate,
      search: vi.fn(),
      readFile: vi.fn(),
      runSkill: vi.fn(),
      image: {
        enqueue: vi.fn(),
        list: vi.fn(),
        get: vi.fn(),
        cancel: vi.fn(),
        retry: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        setConnectionConcurrency: vi.fn(),
        onTaskEvent: vi.fn(() => () => {}),
      },
    })

    await runner.run({
      modelProfileId: 'text-model-1',
      prompt: '请深入思考并回答',
      reasoningEffort: 'high',
    })

    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        modelProfileId: 'text-model-1',
        request: expect.objectContaining({
          reasoningEffort: 'high',
        }),
      }),
    )
  })

  it('uses configured imageRequest size and quality in create_image_tasks tool', async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [{
          id: 'call-1',
          name: 'create_image_tasks',
          arguments: JSON.stringify({
            mode: 'smart',
            prompts: [{ title: '镜头1', prompt: '特写镜头' }],
          }),
        }],
      })
      .mockResolvedValueOnce({
        text: '任务已完成',
        toolCalls: [],
      })

    let enqueuedRequest: any
    const imageMock: ImageApi = {
      enqueue: async ({ request }) => {
        enqueuedRequest = request
        return task('task-1', request.prompt, request.size, request.quality)
      },
      list: async () => [],
      get: async () => null,
      cancel: async () => true,
      retry: async () => true,
      pause: async () => {},
      resume: async () => {},
      setConnectionConcurrency: async () => {},
      onTaskEvent: () => () => {},
    }

    const runner = new AgentRunner({
      generate,
      search: vi.fn(),
      readFile: vi.fn(),
      runSkill: vi.fn(),
      image: imageMock,
    })

    const result = await runner.run({
      modelProfileId: 'text-model-1',
      imageModelProfileId: 'image-model-1',
      prompt: '生成一张 16:9 HD 图片',
      requireConfirmation: false,
      imageRequest: {
        size: '1792x1024',
        quality: 'hd',
      },
    })

    expect(result.status).toBe('completed')
    expect(enqueuedRequest).toMatchObject({
      prompt: '特写镜头',
      size: '1792x1024',
      quality: 'hd',
    })
  })
})
