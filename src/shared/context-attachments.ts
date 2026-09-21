import type { ProjectContextDocument } from './contracts/context'

const MAX_ATTACHMENT_CONTEXT_CHARS = 24_000
const TRUNCATION_MARKER = '\n[附件内容已截断]'

function fitDocumentText(text: string, budget: number): string {
  if (text.length <= budget) return text
  if (budget <= TRUNCATION_MARKER.length) return TRUNCATION_MARKER.slice(0, budget)
  return `${text.slice(0, budget - TRUNCATION_MARKER.length).trimEnd()}${TRUNCATION_MARKER}`
}

export function appendAttachmentContext(prompt: string, documents: readonly ProjectContextDocument[]): string {
  if (!documents.length) return prompt
  const headers = documents.map((document) => `附件：${document.summary.fileName}\n`)
  const separatorLength = Math.max(0, documents.length - 1) * 2
  const contentBudget = Math.max(0, MAX_ATTACHMENT_CONTEXT_CHARS - headers.reduce((total, header) => total + header.length, separatorLength))
  const perDocument = Math.floor(contentBudget / documents.length)
  const context = documents.map((document, index) => `${headers[index]}${fitDocumentText(document.text, perDocument)}`).join('\n\n')
  return `${prompt}\n\n请同时参考以下用户附件：\n${context}`
}
