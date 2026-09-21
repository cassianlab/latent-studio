import { randomUUID } from 'node:crypto'
import type { GlobalDatabase } from '../config'
import { LibraryError } from './errors'
import {
  defaultQuickPrompts,
  isQuickPrompt,
  isQuickPromptCategory,
  validQuickPromptText,
  type QuickPrompt,
  type QuickPromptInput,
} from '../../shared/quick-prompts'

const INITIALIZED_KEY = 'quick-prompts-initialized-v1'

interface QuickPromptRow {
  id: string
  title: string
  prompt: string
  category: string
  description: string | null
  source_prompt_id: string | null
  updated_at: string
}

function decode(row: QuickPromptRow): QuickPrompt {
  if (!row || !isQuickPromptCategory(row.category)) throw new LibraryError('read-failed', '快捷灵感数据损坏')
  return {
    id: row.id,
    title: row.title,
    prompt: row.prompt,
    category: row.category,
    ...(row.description ? { description: row.description } : {}),
    ...(row.source_prompt_id ? { sourcePromptId: row.source_prompt_id } : {}),
    updatedAt: row.updated_at,
  }
}

function optional(value: string | undefined, max: number): string | undefined {
  const text = value?.trim()
  return text ? text.slice(0, max) : undefined
}

export class GlobalQuickPromptStore {
  constructor(private readonly database: GlobalDatabase) {}

  async list(legacyItems?: readonly QuickPrompt[]): Promise<QuickPrompt[]> {
    this.initialize(legacyItems)
    return this.database.all<QuickPromptRow>('SELECT id, title, prompt, category, description, source_prompt_id, updated_at FROM quick_prompts ORDER BY rowid ASC').map(decode)
  }

  async save(input: QuickPromptInput): Promise<QuickPrompt> {
    this.initialize()
    if (!isQuickPromptCategory(input.category)) throw new LibraryError('invalid-input', '快捷提示词分类无效')
    const id = input.id?.trim() || `quick-${randomUUID()}`
    const title = validQuickPromptText(input.title, '快捷提示词名称', 80)
    const prompt = validQuickPromptText(input.prompt, '快捷提示词内容', 20_000)
    const description = optional(input.description, 160)
    const sourcePromptId = optional(input.sourcePromptId, 200)
    const now = new Date().toISOString()
    this.database.run(
      'INSERT INTO quick_prompts (id, title, prompt, category, description, source_prompt_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title = excluded.title, prompt = excluded.prompt, category = excluded.category, description = excluded.description, source_prompt_id = excluded.source_prompt_id, updated_at = excluded.updated_at',
      id, title, prompt, input.category, description ?? null, sourcePromptId ?? null, now,
    )
    return decode(this.database.all<QuickPromptRow>('SELECT id, title, prompt, category, description, source_prompt_id, updated_at FROM quick_prompts WHERE id = ?', id)[0])
  }

  async remove(id: string): Promise<void> {
    this.initialize()
    const normalized = validQuickPromptText(id, '快捷提示词标识', 200)
    if (!this.database.all<{ id: string }>('SELECT id FROM quick_prompts WHERE id = ?', normalized)[0]) throw new LibraryError('not-found', '快捷提示词不存在')
    this.database.run('DELETE FROM quick_prompts WHERE id = ?', normalized)
  }

  initialize(legacyItems?: readonly QuickPrompt[]): void {
    if (this.database.all<{ value: string }>('SELECT value FROM settings WHERE key = ?', INITIALIZED_KEY)[0]) return
    const initial = legacyItems !== undefined && legacyItems.every(isQuickPrompt) ? legacyItems : defaultQuickPrompts()
    for (const item of initial) {
      this.database.run(
        'INSERT OR IGNORE INTO quick_prompts (id, title, prompt, category, description, source_prompt_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        item.id, item.title, item.prompt, item.category, item.description ?? null, item.sourcePromptId ?? null, item.updatedAt,
      )
    }
    this.database.run('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at', INITIALIZED_KEY, '1', new Date().toISOString())
  }
}
