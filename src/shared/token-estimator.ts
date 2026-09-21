export const MODEL_CONTEXT_WINDOW_TOKENS = 258_000

/** A model-agnostic upper bound: no UTF-8 text token can represent fewer than one input byte. */
export function textTokenUpperBound(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

export function estimateTextTokens(value: string): number {
  let ascii = 0
  let nonAscii = 0
  for (const character of value) {
    if (character.charCodeAt(0) <= 0x7f) ascii += 1
    else nonAscii += 1
  }
  return Math.ceil(ascii / 4 + nonAscii * 1.1)
}

export function estimateContextTokens(messages: readonly string[], fixedContext: readonly string[] = []): number {
  return [...fixedContext, ...messages].reduce((total, value) => total + estimateTextTokens(value) + 8, 0)
}

export function trimTextToTokens(value: string, maxTokens: number, suffix = '…'): string {
  if (estimateTextTokens(value) <= maxTokens) return value
  if (maxTokens <= 0) return ''
  const suffixTokens = estimateTextTokens(suffix)
  const contentBudget = Math.max(0, maxTokens - suffixTokens)
  let low = 0
  let high = value.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (estimateTextTokens(value.slice(0, middle)) <= contentBudget) low = middle
    else high = middle - 1
  }
  return `${value.slice(0, low).trimEnd()}${suffix}`
}

export function trimTextToTokenUpperBound(value: string, maxTokens: number, suffix = '…'): string {
  if (textTokenUpperBound(value) <= maxTokens) return value
  if (maxTokens <= 0) return ''
  const suffixTokens = textTokenUpperBound(suffix)
  if (suffixTokens > maxTokens) return ''
  const contentBudget = Math.max(0, maxTokens - suffixTokens)
  let low = 0
  let high = value.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (textTokenUpperBound(value.slice(0, middle)) <= contentBudget) low = middle
    else high = middle - 1
  }
  return `${value.slice(0, low).trimEnd()}${suffix}`
}
