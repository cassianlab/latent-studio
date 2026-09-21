import { describe, expect, it } from 'vitest'
import type { MemoryEntry } from '../../src/shared/contracts/library'
import {
  detectMemoryConflicts,
  filterMemories,
  formatLastUsedTime,
} from '../../src/renderer/library/MemoryLibraryPage'

describe('MemoryLibraryPage helper functions', () => {
  const globalMem1: MemoryEntry = {
    id: 'g-1',
    title: '赛博朋克电影调色',
    content: '青蓝与洋红交织，暗部偏青，高光柔和。',
    scope: 'global',
    version: 1,
    active: true,
    source: '导演视觉规范',
    lastUsedAt: '2026-09-10T14:30:00.000Z',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }

  const globalMem2: MemoryEntry = {
    id: 'g-2',
    title: '变形宽银幕景深',
    content: '水平椭圆散景，轻微眩光条纹。',
    scope: 'global',
    version: 2,
    active: true,
    source: '摄影指南',
    lastUsedAt: undefined,
    createdAt: '2026-01-02T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
  }

  const globalInactive: MemoryEntry = {
    id: 'g-inactive',
    title: '旧版胶片质感',
    content: '已废弃的胶片预设。',
    scope: 'global',
    version: 1,
    active: false,
    source: '归档',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }

  const projectMem1: MemoryEntry = {
    id: 'p-1',
    title: '主角艾莉亚设定',
    content: '黑色短发，右眉尾有疤痕，风衣常带反光条。',
    scope: 'project',
    version: 3,
    active: true,
    source: '剧本第一幕',
    lastUsedAt: '2026-09-12T09:15:00.000Z',
    createdAt: '2026-01-03T00:00:00Z',
    updatedAt: '2026-01-03T00:00:00Z',
  }

  const projectOverrideMem: MemoryEntry = {
    id: 'p-override',
    title: '  赛博朋克电影调色  ', // Same title with surrounding whitespace
    content: '本项目限定：色温偏冷绿，禁用洋红高光。',
    scope: 'project',
    version: 1,
    active: true,
    source: '项目分镜脚本',
    createdAt: '2026-01-04T00:00:00Z',
    updatedAt: '2026-01-04T00:00:00Z',
  }

  const projectInactiveOverride: MemoryEntry = {
    id: 'p-inactive-override',
    title: '变形宽银幕景深',
    content: '项目限定宽银幕（已暂停）。',
    scope: 'project',
    version: 1,
    active: false,
    source: '测试暂停',
    createdAt: '2026-01-05T00:00:00Z',
    updatedAt: '2026-01-05T00:00:00Z',
  }

  describe('detectMemoryConflicts', () => {
    it('detects when an active global memory is overridden by an active project memory of the same title', () => {
      const items = [globalMem1, globalMem2, projectMem1, projectOverrideMem]
      const conflicts = detectMemoryConflicts(items)

      expect(conflicts.has('g-1')).toBe(true)
      const overriding = conflicts.get('g-1')
      expect(overriding).toBeDefined()
      expect(overriding?.id).toBe('p-override')
      expect(overriding?.title.trim()).toBe('赛博朋克电影调色')

      // g-2 is not overridden because projectMem1 and projectOverrideMem have different titles
      expect(conflicts.has('g-2')).toBe(false)
    })

    it('does not report conflict when the overriding project memory is inactive', () => {
      const items = [globalMem2, projectInactiveOverride]
      const conflicts = detectMemoryConflicts(items)

      expect(conflicts.has('g-2')).toBe(false)
    })

    it('does not report conflict when the global memory itself is inactive', () => {
      const inactiveGlobalWithConflict: MemoryEntry = {
        ...globalInactive,
        title: '主角艾莉亚设定',
        active: false,
      }
      const items = [inactiveGlobalWithConflict, projectMem1]
      const conflicts = detectMemoryConflicts(items)

      expect(conflicts.has(inactiveGlobalWithConflict.id)).toBe(false)
    })

    it('returns an empty map when there are no conflicts', () => {
      const items = [globalMem2, projectMem1]
      const conflicts = detectMemoryConflicts(items)
      expect(conflicts.size).toBe(0)
    })

    it('reports semantic conflicts between different visual-style titles', () => {
      const retro = { ...globalMem1, id: 'retro', title: '偏好复古风', category: 'visual-style' as const, updatedAt: '2026-01-01T00:00:00Z' }
      const technology = { ...globalMem1, id: 'technology', title: '偏好科技风', category: 'visual-style' as const, updatedAt: '2026-02-01T00:00:00Z' }

      const conflicts = detectMemoryConflicts([retro, technology])

      expect(conflicts.get('retro')?.id).toBe('technology')
    })
  })

  describe('filterMemories', () => {
    const allItems = [globalMem1, globalMem2, globalInactive, projectMem1, projectOverrideMem]

    it('filters by search query matching title', () => {
      const results = filterMemories(allItems, { search: '宽银幕' })
      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('g-2')
    })

    it('filters by search query matching content', () => {
      const results = filterMemories(allItems, { search: '反光条' })
      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('p-1')
    })

    it('filters by search query matching source', () => {
      const results = filterMemories(allItems, { search: '分镜脚本' })
      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('p-override')
    })

    it('performs case-insensitive search', () => {
      const englishMem: MemoryEntry = {
        id: 'eng-1',
        title: 'Kodak Film Look',
        content: 'Warm tones',
        scope: 'global',
        version: 1,
        active: true,
        source: 'Preset',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      }
      const results = filterMemories([englishMem], { search: 'kodak' })
      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('eng-1')
    })

    it('filters by scope', () => {
      const projectOnly = filterMemories(allItems, { scope: 'project' })
      expect(projectOnly.every((i) => i.scope === 'project')).toBe(true)
      expect(projectOnly.map((i) => i.id)).toEqual(['p-1', 'p-override'])

      const globalOnly = filterMemories(allItems, { scope: 'global' })
      expect(globalOnly.every((i) => i.scope === 'global')).toBe(true)
      expect(globalOnly.map((i) => i.id)).toEqual(['g-1', 'g-2', 'g-inactive'])
    })

    it('filters by active status', () => {
      const activeOnly = filterMemories(allItems, { status: 'active' })
      expect(activeOnly.every((i) => i.active)).toBe(true)
      expect(activeOnly.some((i) => i.id === 'g-inactive')).toBe(false)

      const inactiveOnly = filterMemories(allItems, { status: 'inactive' })
      expect(inactiveOnly.every((i) => !i.active)).toBe(true)
      expect(inactiveOnly.map((i) => i.id)).toEqual(['g-inactive'])
    })

    it('treats legacy memories without an active field as enabled', () => {
      const legacy = { ...globalMem1, id: 'legacy-active', active: undefined } as unknown as MemoryEntry

      expect(filterMemories([legacy], { status: 'active' })).toEqual([legacy])
      expect(filterMemories([legacy], { status: 'inactive' })).toEqual([])
    })

    it('combines search, scope, and status filter simultaneously', () => {
      const results = filterMemories(allItems, {
        search: '调色',
        scope: 'project',
        status: 'active',
      })
      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('p-override')
    })

    it('returns all items when search is empty and filters are "all"', () => {
      const results = filterMemories(allItems, { search: '', scope: 'all', status: 'all' })
      expect(results).toHaveLength(allItems.length)
    })
  })

  describe('formatLastUsedTime', () => {
    it('returns "暂未使用" when lastUsedAt is undefined or empty', () => {
      expect(formatLastUsedTime(undefined)).toBe('暂未使用')
      expect(formatLastUsedTime('')).toBe('暂未使用')
    })

    it('returns "暂未使用" when date string is invalid', () => {
      expect(formatLastUsedTime('invalid-date-string')).toBe('暂未使用')
    })

    it('formats valid ISO string into readable date string', () => {
      const formatted = formatLastUsedTime('2026-09-10T14:30:00.000Z')
      expect(formatted).not.toBe('暂未使用')
      expect(formatted).toMatch(/^2026-\d{2}-\d{2} \d{2}:\d{2}$/)
    })
  })
})
