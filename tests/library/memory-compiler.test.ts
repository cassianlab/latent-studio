import { describe, expect, it } from 'vitest'
import type { MemoryEntry } from '../../src/shared/contracts/library'
import {
  compileMemories,
  formatCompiledMemoriesForPrompt,
  formatMemoriesForImagePrompt,
  type CompiledMemoryResult,
} from '../../src/renderer/library/memory-compiler'

describe('memory compilation, overriding, budgeting and audit references', () => {
  const globalMem1: MemoryEntry = {
    id: 'g-1',
    title: '赛博朋克色调',
    content: '青蓝与洋红对撞，雨夜霓虹漫反射。',
    scope: 'global',
    version: 1,
    active: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }

  const globalMem2: MemoryEntry = {
    id: 'g-2',
    title: '电影宽画幅',
    content: '采用变形宽银幕镜头，具有轻微椭圆焦外光斑。',
    scope: 'global',
    version: 1,
    active: true,
    createdAt: '2026-01-02T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
  }

  const globalInactive: MemoryEntry = {
    id: 'g-inactive',
    title: '停用规则',
    content: '已废弃的旧画风。',
    scope: 'global',
    version: 1,
    active: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }

  const projMem1: MemoryEntry = {
    id: 'p-1',
    title: '主角外观设定',
    content: '主角名为艾莉亚，黑色短发，穿带反光条的风衣。',
    scope: 'project',
    version: 2,
    active: true,
    createdAt: '2026-01-03T00:00:00Z',
    updatedAt: '2026-01-03T00:00:00Z',
  }

  const projOverrideMem: MemoryEntry = {
    id: 'p-override',
    title: '赛博朋克色调', // same title as g-1
    content: '当前项目特殊覆盖：以暗黄与工业灰为主，禁止洋红高光。',
    scope: 'project',
    version: 1,
    active: true,
    createdAt: '2026-01-04T00:00:00Z',
    updatedAt: '2026-01-04T00:00:00Z',
  }

  it('filters inactive memories and overrides global memory when project memory has matching title', () => {
    const result = compileMemories({
      globalMemories: [globalMem1, globalMem2, globalInactive],
      projectMemories: [projMem1, projOverrideMem],
    })

    // Inactive is excluded
    expect(result.items.some((item) => item.id === 'g-inactive')).toBe(false)

    // Global mem1 is overridden by project override mem
    const overridden = result.overriddenGlobals.find((o) => o.globalMemory.id === 'g-1')
    expect(overridden).toBeDefined()
    expect(overridden?.overriddenBy.id).toBe('p-override')

    // Result items include project items and non-overridden global items
    const ids = result.items.map((i) => i.id)
    expect(ids).toContain('p-1')
    expect(ids).toContain('p-override')
    expect(ids).toContain('g-2')
    expect(ids).not.toContain('g-1')

    // Project items take precedence before global items
    expect(ids.indexOf('p-1')).toBeLessThan(ids.indexOf('g-2'))
  })

  it('produces structured audit references with ID, version, and scope', () => {
    const result = compileMemories({
      globalMemories: [globalMem2],
      projectMemories: [projMem1],
    })

    expect(result.auditRefs).toEqual([
      { id: 'p-1', version: 2, scope: 'project' },
      { id: 'g-2', version: 1, scope: 'global' },
    ])
  })

  it('enforces character budget without cutting off mid-sentence', () => {
    const longMem1: MemoryEntry = {
      id: 'p-long-1',
      title: '详细长规则1',
      content: 'A'.repeat(300),
      scope: 'project',
      version: 1,
      active: true,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    }
    const longMem2: MemoryEntry = {
      id: 'p-long-2',
      title: '详细长规则2',
      content: 'B'.repeat(300),
      scope: 'project',
      version: 1,
      active: true,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    }

    // Budget of 400 chars cannot accommodate both (each item ~320 chars with title)
    const result = compileMemories({
      projectMemories: [longMem1, longMem2],
      maxChars: 400,
    })

    expect(result.items).toHaveLength(1)
    expect(result.items[0].id).toBe('p-long-1')
    expect(result.items[0].content).toBe('A'.repeat(300)) // Not sliced mid-sentence!
    expect(result.droppedCount).toBe(1)
  })

  it('formats compiled memories cleanly into LLM prompt text', () => {
    const result = compileMemories({
      globalMemories: [globalMem2],
      projectMemories: [projMem1],
    })

    const formatted = formatCompiledMemoriesForPrompt(result)
    expect(formatted).toContain('【已激活的长期记忆与创作规则设定】')
    expect(formatted).toContain('【主角外观设定】(项目限定约束)')
    expect(formatted).toContain('【电影宽画幅】(全局视觉偏好)')
    expect(formatted).toContain('本轮明确要求与长期记忆冲突时，以本轮要求为准')
    expect(formatMemoriesForImagePrompt(result)).toContain('current prompt explicitly conflicts, follow the current prompt')
  })

  it('keeps only the newest memory in an exclusive category within the same scope', () => {
    const retro: MemoryEntry = {
      ...globalMem1,
      id: 'style-retro',
      title: '偏好复古风',
      content: '默认使用复古胶片风格。',
      category: 'visual-style',
      updatedAt: '2026-01-01T00:00:00Z',
    }
    const technology: MemoryEntry = {
      ...globalMem1,
      id: 'style-technology',
      title: '偏好科技风',
      content: '默认使用未来科技风格。',
      category: 'visual-style',
      updatedAt: '2026-02-01T00:00:00Z',
    }

    const result = compileMemories({ globalMemories: [retro, technology] })

    expect(result.items.map((item) => item.id)).toEqual(['style-technology'])
    expect(result.overriddenMemories).toContainEqual(expect.objectContaining({
      memory: expect.objectContaining({ id: 'style-retro' }),
      overriddenBy: expect.objectContaining({ id: 'style-technology' }),
      reason: 'newer-in-scope',
    }))
  })

  it('lets project memory override a newer global memory in the same exclusive category', () => {
    const globalStyle: MemoryEntry = {
      ...globalMem1,
      id: 'global-style',
      title: '全局科技风',
      category: 'visual-style',
      updatedAt: '2026-03-01T00:00:00Z',
    }
    const projectStyle: MemoryEntry = {
      ...projMem1,
      id: 'project-style',
      title: '项目复古风',
      category: 'visual-style',
      updatedAt: '2026-01-01T00:00:00Z',
    }

    const result = compileMemories({ globalMemories: [globalStyle], projectMemories: [projectStyle] })

    expect(result.items.map((item) => item.id)).toEqual(['project-style'])
    expect(result.overriddenMemories).toContainEqual(expect.objectContaining({
      memory: expect.objectContaining({ id: 'global-style' }),
      overriddenBy: expect.objectContaining({ id: 'project-style' }),
      reason: 'project-priority',
    }))
  })

  it('infers legacy visual-style conflicts while keeping unrelated additive memories', () => {
    const retro = { ...globalMem1, id: 'legacy-retro', title: '喜欢复古风', updatedAt: '2026-01-01T00:00:00Z' }
    const technology = { ...globalMem1, id: 'legacy-tech', title: '喜欢科技风', updatedAt: '2026-02-01T00:00:00Z' }
    const camera = { ...globalMem2, id: 'camera-rule', title: '常用镜头', content: '50mm 镜头' }

    const result = compileMemories({ globalMemories: [retro, technology, camera] })

    expect(result.items.map((item) => item.id)).toEqual(['legacy-tech', 'camera-rule'])
  })

  it('points every overridden version to the final winner', () => {
    const oldest = { ...globalMem1, id: 'style-oldest', title: '复古风格', category: 'visual-style' as const, updatedAt: '2026-01-01T00:00:00Z' }
    const middle = { ...globalMem1, id: 'style-middle', title: '现代风格', category: 'visual-style' as const, updatedAt: '2026-02-01T00:00:00Z' }
    const newest = { ...globalMem1, id: 'style-newest', title: '科技风格', category: 'visual-style' as const, updatedAt: '2026-03-01T00:00:00Z' }

    const result = compileMemories({ globalMemories: [oldest, middle, newest] })

    expect(result.items.map((item) => item.id)).toEqual(['style-newest'])
    expect(result.overriddenMemories.map((item) => [item.memory.id, item.overriddenBy.id])).toEqual([
      ['style-oldest', 'style-newest'],
      ['style-middle', 'style-newest'],
    ])
  })
})
