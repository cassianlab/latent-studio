import type { LibraryApi, MemoryEntry } from '../../shared/contracts/library'
import {
  compileMemories,
  formatCompiledMemoriesForPrompt,
  formatMemoriesForImagePrompt,
  type CompiledMemoryResult,
} from './memory-compiler'

export { compileMemories, formatCompiledMemoriesForPrompt, formatMemoriesForImagePrompt }
export type { CompiledMemoryResult }

/**
 * 获取并编译已生效的长期记忆（包含冲突覆盖、字符/条目预算与结构化引用）
 */
export async function fetchCompiledMemories(
  api: LibraryApi,
  options: { includeProject?: boolean } = {},
): Promise<CompiledMemoryResult> {
  try {
    const [projectMemories, globalMemories] = await Promise.all([
      options.includeProject === false
        ? Promise.resolve([])
        : api.listMemories({ scope: 'project', activeOnly: true }).catch(() => []),
      api.listMemories({ scope: 'global', activeOnly: true }).catch(() => []),
    ])
    return compileMemories({ projectMemories, globalMemories })
  } catch {
    return compileMemories({})
  }
}

/**
 * 获取当前已启用的所有长期记忆（自动去重与预算控制），出错安全降级返回空数组
 */
export async function fetchActiveMemories(api: LibraryApi): Promise<MemoryEntry[]> {
  const compiled = await fetchCompiledMemories(api)
  return compiled.items
}

/**
 * 将启用的记忆格式化为大语言模型的 System Prompt 设定约束段落
 */
export function formatMemoriesSystemPrompt(memories: MemoryEntry[]): string {
  if (!memories.length) return ''
  const compiled = compileMemories({ projectMemories: memories })
  return formatCompiledMemoriesForPrompt(compiled)
}

/**
 * 任务执行成功后，标记相关记忆条目的最近使用时间 (lastUsedAt)
 */
export async function touchUsedMemories(
  api: LibraryApi,
  refs: Array<{ id: string; scope?: 'project' | 'global' } | string>,
): Promise<void> {
  if (!refs.length) return
  const now = new Date().toISOString()
  await Promise.all(
    refs.map(async (item) => {
      const id = typeof item === 'string' ? item : item.id
      const explicitScope = typeof item === 'object' ? item.scope : undefined
      const scopes: Array<'project' | 'global'> = explicitScope ? [explicitScope] : ['project', 'global']
      for (const scope of scopes) {
        try {
          await api.updateMemory({ id, scope, lastUsedAt: now })
          break
        } catch {
          // If not in this scope, continue
        }
      }
    }),
  )
}
