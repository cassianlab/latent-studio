import { describe, expect, it } from 'vitest'
import type { ModelProfile } from '../../src/shared/contracts/settings'
import { buildTaskSpecification } from '../../src/renderer/conversation/task-spec'

describe('task specification builder pure function', () => {
  const mockTextModel: ModelProfile = {
    id: 'text-cfg-1',
    connectionId: 'conn-1',
    modelId: 'o3-mini',
    name: 'OpenAI o3-mini',
    kind: 'text',
    capabilities: ['reasoning-effort'],
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  }

  const mockImageModel: ModelProfile = {
    id: 'img-cfg-1',
    connectionId: 'conn-2',
    modelId: 'gpt-image-2.5-sunburst',
    name: 'GPT Image 2.5 Sunburst',
    kind: 'image',
    capabilities: [],
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  }

  describe('text mode task specification', () => {
    it('builds valid text task spec with reasoning effort and memories', () => {
      const spec = buildTaskSpecification({
        mode: 'text',
        prompt: '编写一个电影故事梗概',
        textModel: mockTextModel,
        reasoningEffort: 'high',
        compiledMemories: {
          items: [
            { id: 'm-1', title: '科幻基调', content: '硬科幻', scope: 'project', version: 1, active: true, createdAt: '', updatedAt: '' },
          ],
          auditRefs: [{ id: 'm-1', version: 1, scope: 'project' }],
          overriddenGlobals: [],
          overriddenMemories: [],
          totalChars: 30,
          droppedCount: 0,
        },
      })

      expect(spec.isValid).toBe(true)
      expect(spec.mode).toBe('text')
      expect(spec.reasoningEffort).toBe('high')
      expect(spec.textModel?.modelId).toBe('o3-mini')
      expect(spec.memoryRefs).toHaveLength(1)
      expect(spec.memorySummary.activeCount).toBe(1)
      expect(spec.validationErrors).toHaveLength(0)
    })

    it('returns validation error and recovery action when text model is missing', () => {
      const spec = buildTaskSpecification({
        mode: 'text',
        prompt: '测试无模型',
        textModel: null,
      })

      expect(spec.isValid).toBe(false)
      expect(spec.validationErrors).toContain('未配置文本模型')
      expect(spec.recoveryActions?.some((a) => a.type === 'configure-text-model')).toBe(true)
    })
  })

  describe('image mode task specification', () => {
    it('builds image task spec using GPT Image 2.5 dimensions and quality', () => {
      const spec = buildTaskSpecification({
        mode: 'image',
        prompt: '雨夜穿雨衣的主角',
        imageModel: mockImageModel,
        parameters: {
          ratio: '16:9 横版',
          resolution: '4K',
          quality: '超高',
          background: '透明',
        },
      })

      expect(spec.isValid).toBe(true)
      expect(spec.mode).toBe('image')
      expect(spec.imageModel?.modelId).toBe('gpt-image-2.5-sunburst')
      expect(spec.imageSpec?.size).toBe('3840x2160')
      expect(spec.imageSpec?.quality).toBe('xhigh')
      expect(spec.imageSpec?.background).toBe('transparent')
      expect(spec.imageSpec?.degraded).toBe(false)
    })

    it('returns validation error and recovery action when image model is missing', () => {
      const spec = buildTaskSpecification({
        mode: 'image',
        prompt: '测试无图片模型',
        imageModel: null,
      })

      expect(spec.isValid).toBe(false)
      expect(spec.validationErrors).toContain('未配置图片模型')
      expect(spec.recoveryActions?.some((a) => a.type === 'configure-image-model')).toBe(true)
    })

    it('rejects multiple references when the image model only supports one', () => {
      const singleReferenceModel = { ...mockImageModel, capabilities: ['reference-image'] }
      const references = ['a', 'b'].map((id) => ({
        id,
        name: `${id}.png`,
        relativePath: `assets/${id}.png`,
        sourceName: `${id}.png`,
        category: 'reference' as const,
        mimeType: 'image/png',
        byteLength: 10,
        modifiedAt: '',
        importedAt: '',
        previewable: true,
      }))

      const spec = buildTaskSpecification({
        mode: 'image',
        prompt: '融合两张参考图',
        imageModel: singleReferenceModel,
        references,
      })

      expect(spec.isValid).toBe(false)
      expect(spec.validationErrors).toContain('当前图片模型未声明多参考图能力，请更换模型或只保留一张参考图')
    })
  })

  describe('agent mode task specification', () => {
    it('builds complete agent task spec requiring both text and image specifications', () => {
      const spec = buildTaskSpecification({
        mode: 'agent',
        prompt: '设计一套主角分镜并生成对应图片',
        textModel: mockTextModel,
        imageModel: mockImageModel,
        reasoningEffort: 'medium',
        parameters: {
          ratio: '1:1 方形',
          resolution: '2K',
          quality: '自动',
        },
      })

      expect(spec.isValid).toBe(true)
      expect(spec.mode).toBe('agent')
      expect(spec.textModel?.modelId).toBe('o3-mini')
      expect(spec.imageModel?.modelId).toBe('gpt-image-2.5-sunburst')
      expect(spec.reasoningEffort).toBe('medium')
      expect(spec.imageSpec?.size).toBe('2048x2048')
    })
  })
})
