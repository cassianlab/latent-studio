export type PromptTemplateParameterKind = 'required' | 'optional' | 'select'

export interface PromptTemplateParameter {
  name: string
  token: string
  kind: PromptTemplateParameterKind
  options: string[]
  defaultValue?: string
}

interface ParameterOccurrence extends PromptTemplateParameter {
  start: number
  end: number
}

const PARAMETER_NAME = /^[\p{L}\p{N}_\-\s·]{1,40}$/u

function isEscaped(value: string, index: number): boolean {
  let slashes = 0
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) slashes += 1
  return slashes % 2 === 1
}

function normalizedName(value: string): string | undefined {
  const name = value.trim().replace(/\s+/g, ' ')
  return PARAMETER_NAME.test(name) ? name : undefined
}

function bracketParameter(body: string, token: string): PromptTemplateParameter | undefined {
  const separator = body.indexOf('：') >= 0 ? body.indexOf('：') : body.indexOf(':')
  if (separator < 0) {
    const name = normalizedName(body)
    return name ? { name, token, kind: 'optional', options: [] } : undefined
  }
  const name = normalizedName(body.slice(0, separator))
  const options = body.slice(separator + 1).split('/').map((value) => value.trim()).filter(Boolean)
  if (!name || options.length < 2 || options.some((value) => value.length > 80 || /[\[\]{}]/.test(value))) return undefined
  return { name, token, kind: 'select', options }
}

function argumentParameter(body: string, token: string): PromptTemplateParameter | undefined {
  if (!/^argument\b/i.test(body.trim())) return undefined
  const attributes = new Map<string, string>()
  for (const match of body.matchAll(/([A-Za-z][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attributes.set(match[1].toLocaleLowerCase(), match[2] ?? match[3] ?? '')
  }
  const name = normalizedName(attributes.get('name') ?? '')
  if (!name) return undefined
  const defaultValue = attributes.get('default')?.trim()
  return { name, token, kind: 'required', options: [], ...(defaultValue ? { defaultValue } : {}) }
}

function occurrences(template: string): ParameterOccurrence[] {
  const result: ParameterOccurrence[] = []
  let unnamedCount = 0
  for (let index = 0; index < template.length; index += 1) {
    const opening = template[index]
    if ((opening !== '{' && opening !== '[') || isEscaped(template, index)) continue
    if (opening === '{' && template[index + 1] === '{') {
      const literalEnd = template.indexOf('}}', index + 2)
      if (literalEnd >= 0) index = literalEnd + 1
      continue
    }
    const closing = opening === '{' ? '}' : ']'
    const end = template.indexOf(closing, index + 1)
    if (end < 0 || isEscaped(template, end)) continue
    if (opening === '[' && (template[end + 1] === '(' || template[index - 1] === '!' || template.slice(index, end + 1).includes('://'))) continue
    const token = template.slice(index, end + 1)
    const body = template.slice(index + 1, end)
    const fallbackName = body.trim() ? undefined : `参数 ${++unnamedCount}`
    const parameter = opening === '{'
      ? (() => {
          const argument = argumentParameter(body, token)
          if (argument) return argument
          const name = normalizedName(body) ?? fallbackName
          return name ? { name, token, kind: 'required' as const, options: [] } : undefined
        })()
      : fallbackName
        ? { name: fallbackName, token, kind: 'optional' as const, options: [] }
        : bracketParameter(body, token)
    if (!parameter) continue
    result.push({ ...parameter, start: index, end: end + 1 })
    index = end
  }
  return result
}

function kindPriority(kind: PromptTemplateParameterKind): number {
  if (kind === 'required') return 3
  if (kind === 'select') return 2
  return 1
}

export function parsePromptTemplate(template: string): PromptTemplateParameter[] {
  const parameters = new Map<string, PromptTemplateParameter>()
  for (const occurrence of occurrences(template)) {
    const existing = parameters.get(occurrence.name)
    if (!existing) {
      parameters.set(occurrence.name, { name: occurrence.name, token: occurrence.token, kind: occurrence.kind, options: [...occurrence.options], ...(occurrence.defaultValue ? { defaultValue: occurrence.defaultValue } : {}) })
      continue
    }
    if (kindPriority(occurrence.kind) > kindPriority(existing.kind)) {
      parameters.set(occurrence.name, { name: occurrence.name, token: occurrence.token, kind: occurrence.kind, options: [...occurrence.options], ...(occurrence.defaultValue ? { defaultValue: occurrence.defaultValue } : {}) })
    }
  }
  return [...parameters.values()]
}

function cleanOptionalGaps(value: string): string {
  return value
    .replace(/[ \t]+([,.;:，。；：!?])/g, '$1')
    .replace(/([,;:，。；：])(?:\s*[,;:，。；：])+/g, '$1')
    .replace(/^\s*[,;:，。；：]+\s*|\s*[,;:，。；：]+\s*$/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

export function applyPromptTemplate(template: string, values: Readonly<Record<string, string>>): string {
  const matches = occurrences(template)
  let result = ''
  let cursor = 0
  for (const match of matches) {
    result += template.slice(cursor, match.start)
    result += values[match.name]?.trim() ?? ''
    cursor = match.end
  }
  result += template.slice(cursor)
  return cleanOptionalGaps(result)
    .replace(/\{\{([^{}]*)\}\}/g, '{$1}')
    .replace(/\\([{}\[\]])/g, '$1')
}
