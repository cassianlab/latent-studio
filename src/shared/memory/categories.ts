import type { MemoryCategory, MemoryEntry } from '../contracts/library'

export const MEMORY_CATEGORY_OPTIONS: ReadonlyArray<{ value: MemoryCategory; label: string; exclusive: boolean }> = [
  { value: 'general', label: '通用规则', exclusive: false },
  { value: 'visual-style', label: '视觉风格', exclusive: true },
  { value: 'color-palette', label: '色彩基调', exclusive: true },
  { value: 'aspect-ratio', label: '画幅比例', exclusive: true },
  { value: 'character', label: '角色设定', exclusive: false },
  { value: 'composition', label: '构图与镜头', exclusive: false },
  { value: 'negative', label: '禁止与排除', exclusive: false },
  { value: 'workflow', label: '工作习惯', exclusive: false },
]

const CATEGORY_VALUES = new Set<MemoryCategory>(MEMORY_CATEGORY_OPTIONS.map((option) => option.value))
const EXCLUSIVE_CATEGORIES = new Set<MemoryCategory>(MEMORY_CATEGORY_OPTIONS.filter((option) => option.exclusive).map((option) => option.value))

export function isMemoryCategory(value: unknown): value is MemoryCategory {
  return typeof value === 'string' && CATEGORY_VALUES.has(value as MemoryCategory)
}

function inferFromText(text: string): MemoryCategory {
  if (/(?:禁止|避免|排除|负向|不得|negative)/i.test(text)) return 'negative'
  if (/(?:角色|主角|人物|外观|服装|发型|character)/i.test(text)) return 'character'
  if (/(?:画幅|宽高比|画面比例|aspect ratio|aspect-ratio)/i.test(text)) return 'aspect-ratio'
  if (/(?:色彩|调色|色调|配色|色温|palette|color grade|color scheme|color tone)/i.test(text)) return 'color-palette'
  if (/(?:风格|画风|美学|质感|复古风|科技风|未来风|赛博风|style|visual look)/i.test(text)) return 'visual-style'
  if (/(?:构图|镜头|景别|景深|机位|composition|camera)/i.test(text)) return 'composition'
  if (/(?:工作流|习惯|命名|交付|workflow)/i.test(text)) return 'workflow'
  return 'general'
}

export function inferMemoryCategory(memory: Pick<MemoryEntry, 'title' | 'content'>): MemoryCategory {
  const titleCategory = inferFromText(memory.title.toLocaleLowerCase())
  return titleCategory === 'general' ? inferFromText(memory.content.toLocaleLowerCase()) : titleCategory
}

export function resolveMemoryCategory(memory: Pick<MemoryEntry, 'title' | 'content' | 'category'>): MemoryCategory {
  return memory.category ?? inferMemoryCategory(memory)
}

export function isExclusiveMemoryCategory(category: MemoryCategory): boolean {
  return EXCLUSIVE_CATEGORIES.has(category)
}

export function memoryCategoryLabel(category: MemoryCategory): string {
  return MEMORY_CATEGORY_OPTIONS.find((option) => option.value === category)?.label ?? '通用规则'
}
