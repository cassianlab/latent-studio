import type { TextMessage } from '../../shared/contracts/text'
import type { TextToolDefinition } from '../../shared/contracts/text'
import { MODEL_CONTEXT_WINDOW_TOKENS, textTokenUpperBound, trimTextToTokenUpperBound } from '../../shared/token-estimator'

const MODEL_CONTEXT_RESERVE_TOKENS = 8_000
const IMAGE_CONTEXT_TOKENS = 8_000

function messageTokens(message: TextMessage): number {
  const metadata = textTokenUpperBound(`${message.role}\n${message.name ?? ''}\n${message.toolCallId ?? ''}`)
    + (message.toolCalls ?? []).reduce((total, call) => total + textTokenUpperBound(`${call.id}\n${call.name}\n${call.arguments}`), 0)
  if (typeof message.content === 'string') return textTokenUpperBound(message.content) + metadata + 8
  return message.content.reduce((total, part) => total + (part.type === 'text' ? textTokenUpperBound(part.text) : IMAGE_CONTEXT_TOKENS), metadata + 8)
}

interface MessageBlock {
  indexes: number[]
  size: number
  safe: boolean
}

function messageBlocks(messages: readonly TextMessage[]): MessageBlock[] {
  const blocks: MessageBlock[] = []
  for (let index = 0; index < messages.length;) {
    const message = messages[index]
    if (message.role === 'tool') {
      blocks.push({ indexes: [index], size: messageTokens(message), safe: false })
      index += 1
      continue
    }
    if (message.role !== 'assistant' || !message.toolCalls?.length) {
      blocks.push({ indexes: [index], size: messageTokens(message), safe: true })
      index += 1
      continue
    }

    const indexes = [index]
    const expectedIds = new Set(message.toolCalls.map((call) => call.id))
    const receivedIds = new Set<string>()
    let cursor = index + 1
    while (cursor < messages.length && messages[cursor].role === 'tool') {
      indexes.push(cursor)
      const toolCallId = messages[cursor].toolCallId
      if (toolCallId) receivedIds.add(toolCallId)
      cursor += 1
    }
    blocks.push({
      indexes,
      size: indexes.reduce((total, itemIndex) => total + messageTokens(messages[itemIndex]), 0),
      safe: [...expectedIds].every((id) => receivedIds.has(id)),
    })
    index = cursor
  }
  return blocks
}

export function fitTextModelContext(system: string, messages: readonly TextMessage[], tools: readonly TextToolDefinition[] = []): { system: string; messages: TextMessage[] } {
  let latestUserIndex = -1
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') { latestUserIndex = index; break }
  }
  const blocks = messageBlocks(messages)
  const latestUserBlock = blocks.find((block) => block.indexes.includes(latestUserIndex))
  const toolTokens = textTokenUpperBound(JSON.stringify(tools))
  const inputBudget = Math.max(0, MODEL_CONTEXT_WINDOW_TOKENS - MODEL_CONTEXT_RESERVE_TOKENS - toolTokens)
  const reservedUserTokens = latestUserBlock?.safe ? latestUserBlock.size : 0
  const fittedSystem = trimTextToTokenUpperBound(system, Math.max(0, inputBudget - reservedUserTokens))
  let remaining = inputBudget - textTokenUpperBound(fittedSystem)
  const selectedBlocks = new Set<MessageBlock>()
  if (latestUserBlock?.safe && latestUserBlock.size <= remaining) {
    selectedBlocks.add(latestUserBlock)
    remaining -= latestUserBlock.size
  }
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index]
    if (selectedBlocks.has(block) || !block.safe) continue
    if (block.size > remaining) break
    selectedBlocks.add(block)
    remaining -= block.size
  }
  const selectedIndexes = new Set([...selectedBlocks].flatMap((block) => block.indexes))
  const fittedMessages = messages.filter((_, index) => selectedIndexes.has(index))
  return { system: fittedSystem, messages: fittedMessages }
}
