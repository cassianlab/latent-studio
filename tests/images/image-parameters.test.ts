import { describe, expect, it } from 'vitest'
import { buildImagePlanningPrompt, buildImageProviderPrompt, enrichPromptWithParameters, resolveAgentImageParameters, resolveImageBackground, resolveImageOutputSize, resolveImageQuality, resolveImageOutputFormat, resolveImageSpec } from '../../src/renderer/image/image-parameters'
import { compileMemories, formatMemoriesForImagePrompt } from '../../src/shared/memory/compiler'

describe('image-parameters resolution', () => {
  it('includes enabled memory in the prompt sent to a single or batch image model', () => {
    const compiled = compileMemories({ projectMemories: [{ id: 'p1', scope: 'project', title: '人物外观', content: '银发短发', version: 1, active: true, createdAt: '', updatedAt: '' }] })
    const memory = formatMemoriesForImagePrompt(compiled)
    expect(buildImageProviderPrompt('雨夜人像', undefined, memory)).toContain('银发短发')
    expect(buildImageProviderPrompt('雨夜人像')).toBe('雨夜人像')
  })
  it('lets explicit natural-language image parameters override composer defaults', () => {
    expect(resolveAgentImageParameters('先生成一张竖版 4K 图片看看效果', {
      ratio: '16:9 横版', resolution: '2K', quality: '自动', format: 'PNG',
    })).toEqual({ ratio: '9:16 竖版', resolution: '4K', quality: '自动', format: 'PNG' })
    expect(resolveAgentImageParameters('生成 3:4 的高清 JPG 海报', {
      ratio: '1:1 方形', resolution: '2K', quality: '自动', format: 'PNG',
    })).toEqual({ ratio: '3:4', resolution: '2K', quality: '高', format: 'JPG' })
  })
  it('uses official GPT Image dimensions for 1K, 2K and 4K requests', () => {
    expect(resolveImageSpec({ modelId: 'gpt-image-2', ratio: '16:9', resolution: '1K' }).size).toBe('1088x608')
    expect(resolveImageSpec({ modelId: 'gpt-image-2.5-sunburst', ratio: '16:9', resolution: '2K' }).size).toBe('2048x1152')
    expect(resolveImageSpec({ modelId: 'gpt-image-2.5-flare', ratio: '16:9', resolution: '4K' }).size).toBe('3840x2160')
    expect(resolveImageSpec({ modelId: 'gpt-image-2.5-sunburst', ratio: '9:16', resolution: '4K' }).size).toBe('2160x3840')
    expect(resolveImageSpec({ modelId: 'gpt-image-2', ratio: '1:1', resolution: '2K' }).size).toBe('2048x2048')
  })

  it('leaves dimensions unset when the aspect ratio is automatic', () => {
    expect(resolveImageSpec({ modelId: 'gpt-image-2.5-sunburst', ratio: '自动', resolution: '2K' })).toMatchObject({
      size: undefined,
      outputSize: undefined,
    })
    expect(resolveImageOutputSize({ ratio: '自动', resolution: '2K', quality: '自动' })).toBeNull()
  })

  it('uses valid square request and export dimensions at every resolution', () => {
    for (const [resolution, expected] of [['1K', '1024x1024'], ['2K', '2048x2048'], ['4K', '2880x2880']] as const) {
      const spec = resolveImageSpec({ modelId: 'gpt-image-2.5-sunburst', ratio: '1:1', resolution })
      expect(spec.size).toBe(expected)
      expect(spec.outputSize).toBe(expected)
    }
  })

  it('keeps every supported ratio valid at each resolution', () => {
    for (const ratio of ['16:9', '1:1', '9:16', '4:3', '3:4', '21:9']) {
      for (const resolution of ['1K', '2K', '4K']) {
        const spec = resolveImageSpec({ modelId: 'gpt-image-2.5-sunburst', ratio, resolution })
        const [width, height] = spec.size.split('x').map(Number)
        expect(spec.outputSize).toBe(spec.size)
        expect(width % 16).toBe(0)
        expect(height % 16).toBe(0)
        expect(Math.max(width, height)).toBeLessThanOrEqual(3840)
        expect(width * height).toBeGreaterThanOrEqual(655360)
        expect(width * height).toBeLessThanOrEqual(8294400)
      }
    }
  })

  it('keeps provider request size separate from the exact local export size', () => {
    const spec = resolveImageSpec({ modelId: 'gpt-image-2.5-sunburst', ratio: '16:9', resolution: '4K' })
    expect(spec.size).toBe('3840x2160')
    expect(spec.outputSize).toBe('3840x2160')
    expect(spec.degraded).toBe(false)
  })

  it('maps GPT Image 2 and 2.5 quality levels', () => {
    expect(resolveImageSpec({ modelId: 'gpt-image-2', quality: '超高' }).quality).toBe('high')
    expect(resolveImageSpec({ modelId: 'gpt-image-2.5-sunburst', quality: '超高' }).quality).toBe('xhigh')
    expect(resolveImageSpec({ modelId: 'gpt-image-2.5-flare', quality: '最高' }).quality).toBe('max')
    expect(resolveImageQuality({ quality: '自动' })).toBe('auto')
  })

  it('resolves a stable output format for persistence', () => {
    expect(resolveImageOutputFormat({ format: 'WebP' })).toBe('webp')
    expect(resolveImageOutputFormat({ format: 'JPEG' })).toBe('jpeg')
    expect(resolveImageOutputFormat(undefined)).toBe('png')
  })

  it('uses an alpha-capable format for GPT Image 2.5 transparent backgrounds', () => {
    expect(resolveImageBackground('gpt-image-2.5-sunburst', { background: '透明' })).toBe('transparent')
    expect(resolveImageBackground('gpt-image-2.5-flare', { background: '不透明' })).toBe('opaque')
    expect(resolveImageBackground('gpt-image-2', { background: '透明' })).toBeUndefined()
    expect(resolveImageOutputFormat({ format: 'JPEG', background: '透明' })).toBe('png')
    expect(resolveImageOutputFormat({ format: 'WebP', background: '透明' })).toBe('webp')
  })

  it('keeps image prompts unchanged', () => {
    const prompt = '赛博朋克雨夜街道，银发女主角'
    expect(enrichPromptWithParameters(prompt, { ratio: '16:9', quality: '最高', resolution: '4K' })).toBe(prompt)
  })

  it('keeps document attachments in text planning and out of image-provider prompts', () => {
    const attachment = {
      summary: { relativePath: 'brief.md', fileName: 'brief.md', kind: 'markdown' as const, mimeType: 'text/markdown' as const, byteLength: 12 },
      text: '附件中的人物设定',
    }

    expect(buildImagePlanningPrompt('生成角色图', [attachment])).toContain('附件中的人物设定')
    expect(buildImageProviderPrompt('生成角色图', { ratio: '16:9', quality: '最高', resolution: '4K' })).toBe('生成角色图')
  })

  it('shares planning context fairly across multiple oversized attachments', () => {
    const documents = [
      {
        summary: { relativePath: 'first.md', fileName: 'first.md', kind: 'markdown' as const, mimeType: 'text/markdown' as const, byteLength: 30_000 },
        text: `第一份开头${'甲'.repeat(30_000)}`,
      },
      {
        summary: { relativePath: 'second.md', fileName: 'second.md', kind: 'markdown' as const, mimeType: 'text/markdown' as const, byteLength: 30_000 },
        text: `第二份开头${'乙'.repeat(30_000)}`,
      },
    ]

    const prompt = buildImagePlanningPrompt('生成角色图', documents)

    expect(prompt).toContain('附件：first.md')
    expect(prompt).toContain('第一份开头')
    expect(prompt).toContain('附件：second.md')
    expect(prompt).toContain('第二份开头')
    expect(prompt.match(/附件内容已截断/g)).toHaveLength(2)
  })
})
