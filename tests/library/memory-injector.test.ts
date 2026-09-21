import { describe, expect, it } from 'vitest'
import type { LibraryApi, MemoryEntry } from '../../src/shared/contracts/library'
import {
  fetchActiveMemories,
  fetchCompiledMemories,
  formatMemoriesSystemPrompt,
  touchUsedMemories,
} from '../../src/renderer/library/memory-injector'

describe('memory-injector', () => {
  it('formats active memories into system prompt constraints accurately', () => {
    const mockMemories: MemoryEntry[] = [
      {
        id: 'mem-1',
        title: '胶片质感设定',
        content: '柯达胶片 Portra 400 颗粒质感，暖色调。',
        scope: 'global',
        version: 1,
        active: true,
        source: '导演视觉规范',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
      {
        id: 'mem-2',
        title: '主角外观设定',
        content: '艾莉亚：银发短发，机能风雨衣。',
        scope: 'project',
        version: 2,
        active: true,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
    ]

    const prompt = formatMemoriesSystemPrompt(mockMemories)
    expect(prompt).toContain('【已激活的长期记忆与创作规则设定】')
    expect(prompt).toContain('【胶片质感设定】(全局视觉偏好 · 来源: 导演视觉规范)')
    expect(prompt).toContain('柯达胶片 Portra 400 颗粒质感，暖色调。')
    expect(prompt).toContain('【主角外观设定】(项目限定约束)')
    expect(prompt).toContain('艾莉亚：银发短发，机能风雨衣。')
  })

  it('returns empty string when memories list is empty', () => {
    expect(formatMemoriesSystemPrompt([])).toBe('')
  })

  it('fetches only active memories across scopes and filters inactive items', async () => {
    const fakeApi: Partial<LibraryApi> = {
      listMemories: async ({ scope }) => {
        if (scope === 'project') {
          return [
            {
              id: 'p-1',
              title: '项目记忆1',
              content: '内容1',
              scope: 'project',
              version: 1,
              active: true,
              createdAt: '2026-01-01',
              updatedAt: '2026-01-01',
            },
            {
              id: 'p-2',
              title: '已停用记忆',
              content: '内容2',
              scope: 'project',
              version: 1,
              active: false,
              createdAt: '2026-01-01',
              updatedAt: '2026-01-01',
            },
          ]
        }
        return [
          {
            id: 'g-1',
            title: '全局偏好1',
            content: '内容3',
            scope: 'global',
            version: 1,
            active: true,
            createdAt: '2026-01-01',
            updatedAt: '2026-01-01',
          },
        ]
      },
    }

    const activeMemories = await fetchActiveMemories(fakeApi as LibraryApi)
    expect(activeMemories).toHaveLength(2)
    expect(activeMemories.map((m) => m.id)).toEqual(['p-1', 'g-1'])
  })

  it('handles API errors gracefully without throwing', async () => {
    const errorApi: Partial<LibraryApi> = {
      listMemories: async () => {
        throw new Error('Database locked')
      },
    }

    const result = await fetchActiveMemories(errorApi as LibraryApi)
    expect(result).toEqual([])
  })

  it('fetchCompiledMemories returns audit references and handles conflict overrides', async () => {
    const fakeApi: Partial<LibraryApi> = {
      listMemories: async ({ scope }) => {
        if (scope === 'project') {
          return [
            {
              id: 'proj-1',
              title: '质感规范',
              content: '项目特定胶片质感',
              scope: 'project',
              version: 2,
              active: true,
              createdAt: '2026-01-01',
              updatedAt: '2026-01-01',
            },
          ]
        }
        return [
          {
            id: 'glob-1',
            title: '质感规范',
            content: '全局胶片质感（应被覆盖）',
            scope: 'global',
            version: 1,
            active: true,
            createdAt: '2026-01-01',
            updatedAt: '2026-01-01',
          },
        ]
      },
    }

    const compiled = await fetchCompiledMemories(fakeApi as LibraryApi)
    expect(compiled.items).toHaveLength(1)
    expect(compiled.items[0].id).toBe('proj-1')
    expect(compiled.overriddenGlobals).toHaveLength(1)
    expect(compiled.overriddenGlobals[0].globalMemory.title).toBe('质感规范')
    expect(compiled.overriddenGlobals[0].overriddenBy.id).toBe('proj-1')
    expect(compiled.auditRefs).toEqual([
      { id: 'proj-1', version: 2, scope: 'project' },
    ])
  })

  it('keeps global memory while excluding project memory when project context is disabled', async () => {
    const requestedScopes: string[] = []
    const fakeApi: Partial<LibraryApi> = {
      listMemories: async ({ scope }) => {
        requestedScopes.push(scope)
        return [{
          id: scope === 'global' ? 'global-1' : 'project-1',
          title: scope === 'global' ? '全局偏好' : '项目设定',
          content: scope === 'global' ? '暖色光' : '银色短发',
          scope,
          version: 1,
          active: true,
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01',
        }]
      },
    }

    const compiled = await fetchCompiledMemories(fakeApi as LibraryApi, { includeProject: false })
    expect(requestedScopes).toEqual(['global'])
    expect(compiled.items.map((item) => item.id)).toEqual(['global-1'])
  })

  it('touchUsedMemories invokes updateMemory with correct scopes and lastUsedAt timestamp', async () => {
    const updatedEntries: Array<{ id: string; scope: string; lastUsedAt?: string }> = []
    const fakeApi: Partial<LibraryApi> = {
      updateMemory: async (input) => {
        updatedEntries.push(input as { id: string; scope: string; lastUsedAt?: string })
        return {} as MemoryEntry
      },
    }

    await touchUsedMemories(fakeApi as LibraryApi, [
      { id: 'proj-1', scope: 'project' },
      { id: 'glob-1', scope: 'global' },
    ])

    expect(updatedEntries).toHaveLength(2)
    expect(updatedEntries[0].id).toBe('proj-1')
    expect(updatedEntries[0].scope).toBe('project')
    expect(typeof updatedEntries[0].lastUsedAt).toBe('string')
    expect(updatedEntries[1].id).toBe('glob-1')
    expect(updatedEntries[1].scope).toBe('global')
    expect(typeof updatedEntries[1].lastUsedAt).toBe('string')
  })

  it('touchUsedMemories safely does nothing when refs array is empty', async () => {
    let callCount = 0
    const fakeApi: Partial<LibraryApi> = {
      updateMemory: async () => {
        callCount++
        return {} as MemoryEntry
      },
    }

    await touchUsedMemories(fakeApi as LibraryApi, [])
    expect(callCount).toBe(0)
  })
})
