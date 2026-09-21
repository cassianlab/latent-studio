export * from './contracts'
export * from './errors'
export * from './http'
export * from './stream'
export * from './openai-compatible'
export * from './anthropic'
export * from './gemini'
export * from './discovery'

import type { TextAdapterOptions, TextModelAdapter, TextProvider } from './contracts'
import { AnthropicTextAdapter } from './anthropic'
import { GeminiTextAdapter } from './gemini'
import { OpenAICompatibleTextAdapter } from './openai-compatible'

export function createTextModelAdapter(options: TextAdapterOptions): TextModelAdapter {
  const provider: TextProvider = options.providerType ?? 'openai-compatible'
  if (provider === 'anthropic') return new AnthropicTextAdapter(options)
  if (provider === 'gemini') return new GeminiTextAdapter(options)
  return new OpenAICompatibleTextAdapter({ ...options, providerType: provider })
}
