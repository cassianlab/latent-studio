import type { LibraryErrorShape } from '../../shared/contracts/library'

export type LibraryErrorCode =
  | 'invalid-input'
  | 'invalid-scope'
  | 'invalid-project-root'
  | 'invalid-path'
  | 'outside-project'
  | 'missing-path'
  | 'not-a-file'
  | 'not-a-directory'
  | 'too-many-entries'
  | 'corrupt-library'
  | 'not-found'
  | 'read-failed'

export class LibraryError extends Error implements LibraryErrorShape {
  readonly code: LibraryErrorCode

  constructor(code: LibraryErrorCode, message: string) {
    super(message)
    this.name = 'LibraryError'
    this.code = code
  }
}

export function requiredText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string') throw new LibraryError('invalid-input', `${label}必须是文本`)
  const text = value.trim()
  if (!text || text.length > maxLength) {
    throw new LibraryError('invalid-input', `${label}不能为空且不能超过 ${maxLength} 个字符`)
  }
  return text
}

export function optionalText(value: unknown, label: string, maxLength: number): string | undefined {
  if (value === undefined || value === null) return undefined
  return requiredText(value, label, maxLength)
}

export function normalizeTags(tags: readonly string[] | undefined): string[] {
  if (!tags) return []
  if (!Array.isArray(tags)) throw new LibraryError('invalid-input', '标签必须是数组')
  const normalized: string[] = []
  for (const value of tags) {
    if (typeof value !== 'string') throw new LibraryError('invalid-input', '标签必须是文本')
    const tag = value.trim()
    if (!tag || tag.length > 40 || normalized.includes(tag)) continue
    normalized.push(tag)
  }
  return normalized.slice(0, 30)
}

export function assertScope(scope: unknown): 'global' | 'project' {
  if (scope !== 'global' && scope !== 'project') throw new LibraryError('invalid-scope', '范围必须是 global 或 project')
  return scope
}
