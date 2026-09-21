import { describe, expect, it } from 'vitest'
import { buildImageTaskPrompt } from '../../src/shared/image-task-prompt'

describe('image task constraints', () => {
  it('sends the same character constraints with distinct shot prompts', () => {
    const invariants = ['银发女主角，红色外套', '写实电影风格']
    for (const prompt of ['雨夜广角镜头', '室内近景镜头']) {
      const result = buildImageTaskPrompt(prompt, invariants)
      expect(result).toContain(prompt)
      for (const invariant of invariants) expect(result).toContain(invariant)
    }
  })

  it('does not add empty constraints or duplicate rules', () => {
    expect(buildImageTaskPrompt('画一只猫', [])).toBe('画一只猫')
    const result = buildImageTaskPrompt('画一只猫', [' 白色毛发 ', '', '白色毛发'])
    expect(result.match(/白色毛发/g)).toHaveLength(1)
  })
})
