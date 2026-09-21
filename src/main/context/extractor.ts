import { execFile } from 'node:child_process'
import { inflateRawSync, inflateSync } from 'node:zlib'

const MAX_EXTRACTED_BYTES = 4 * 1024 * 1024

export type ExtractedDocumentKind = 'markdown' | 'plain-text' | 'json' | 'pdf' | 'word'

export interface ExtractedDocument {
  kind: ExtractedDocumentKind
  mimeType: 'text/markdown' | 'text/plain' | 'application/json' | 'application/pdf' | 'application/msword' | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  text: string
}

export class DocumentExtractionError extends Error {
  constructor(public readonly code: 'extraction-unavailable' | 'invalid-document' | 'invalid-utf8', message: string) {
    super(message)
    this.name = 'DocumentExtractionError'
  }
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  } catch {
    throw new DocumentExtractionError('invalid-utf8', '文档不是有效的 UTF-8 文本')
  }
}

function decodeEntities(value: string): string {
  return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
}

function zipEntry(bytes: Uint8Array, name: string): Uint8Array | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const signature = 0x06054b50
  let end = -1
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65_557); index -= 1) {
    if (view.getUint32(index, true) === signature) { end = index; break }
  }
  if (end < 0) return null
  const count = view.getUint16(end + 10, true)
  const directoryOffset = view.getUint32(end + 16, true)
  let cursor = directoryOffset
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) return null
    const method = view.getUint16(cursor + 10, true)
    const compressedSize = view.getUint32(cursor + 20, true)
    const nameLength = view.getUint16(cursor + 28, true)
    const extraLength = view.getUint16(cursor + 30, true)
    const commentLength = view.getUint16(cursor + 32, true)
    const localOffset = view.getUint32(cursor + 42, true)
    const entryName = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength))
    if (entryName === name) {
      if (view.getUint32(localOffset, true) !== 0x04034b50) return null
      const localNameLength = view.getUint16(localOffset + 26, true)
      const localExtraLength = view.getUint16(localOffset + 28, true)
      const start = localOffset + 30 + localNameLength + localExtraLength
      const compressed = bytes.subarray(start, start + compressedSize)
      try {
        const result = method === 0 ? compressed : method === 8 ? inflateRawSync(compressed) : null
        return result && result.byteLength <= MAX_EXTRACTED_BYTES ? result : null
      } catch {
        return null
      }
    }
    cursor += 46 + nameLength + extraLength + commentLength
  }
  return null
}

function extractDocx(bytes: Uint8Array): string {
  const xmlBytes = zipEntry(bytes, 'word/document.xml')
  if (!xmlBytes) throw new DocumentExtractionError('invalid-document', 'Word 文档缺少可读取的正文')
  const xml = decodeUtf8(xmlBytes)
  const text = decodeEntities(xml
    .replace(/<w:tab\s*\/?>/g, '\t')
    .replace(/<w:br\s*\/?>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, ''))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (!text) throw new DocumentExtractionError('invalid-document', 'Word 文档没有可读取的正文')
  return text
}

function unescapePdfLiteral(value: string): string {
  return value.replace(/\\([\\()nrtbf])/g, (_match, code: string) => ({ '\\': '\\', '(': '(', ')': ')', n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }[code] ?? code))
    .replace(/\\([0-7]{1,3})/g, (_match, octal: string) => String.fromCharCode(Number.parseInt(octal, 8)))
}

function pdfStringValue(value: string): string {
  if (value.startsWith('<') && value.endsWith('>')) {
    const hex = value.slice(1, -1).replace(/\s/g, '')
    const bytes = Uint8Array.from(Buffer.from(hex.length % 2 ? `${hex}0` : hex, 'hex'))
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { return Buffer.from(bytes).toString('latin1') }
  }
  return unescapePdfLiteral(value.slice(1, -1))
}

function pdfOperatorText(source: string): string {
  const output: string[] = []
  const append = (value: string) => { if (value) output.push(value) }
  const readString = (start: number): { value: string; end: number } | null => {
    const opening = source[start]
    if (opening === '<') {
      const end = source.indexOf('>', start + 1)
      return end < 0 ? null : { value: source.slice(start, end + 1), end: end + 1 }
    }
    if (opening !== '(') return null
    let depth = 1
    let end = start + 1
    while (end < source.length && depth > 0) {
      if (source[end] === '\\') { end += 2; continue }
      if (source[end] === '(') depth += 1
      if (source[end] === ')') depth -= 1
      end += 1
    }
    return depth === 0 ? { value: source.slice(start, end), end } : null
  }
  let index = 0
  while (index < source.length) {
    if (source[index] === '(' || source[index] === '<') {
      const parsed = readString(index)
      if (parsed) {
        const after = source.slice(parsed.end).match(/^\s*Tj/)
        if (after) { append(pdfStringValue(parsed.value)); index = parsed.end + after[0].length; continue }
      }
    }
    if (source[index] === '[') {
      const end = source.indexOf('] TJ', index + 1)
      if (end >= 0) {
        const body = source.slice(index + 1, end)
        let cursor = 0
        while (cursor < body.length) {
          if (body[cursor] === '(' || body[cursor] === '<') {
            const parsed = readStringFrom(body, cursor)
            if (parsed) { append(pdfStringValue(parsed.value)); cursor = parsed.end; continue }
          }
          cursor += 1
        }
        index = end + 4
        continue
      }
    }
    index += 1
  }
  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function readStringFrom(source: string, start: number): { value: string; end: number } | null {
  if (source[start] === '<') {
    const end = source.indexOf('>', start + 1)
    return end < 0 ? null : { value: source.slice(start, end + 1), end: end + 1 }
  }
  if (source[start] !== '(') return null
  let depth = 1
  let end = start + 1
  while (end < source.length && depth > 0) {
    if (source[end] === '\\') { end += 2; continue }
    if (source[end] === '(') depth += 1
    if (source[end] === ')') depth -= 1
    end += 1
  }
  return depth === 0 ? { value: source.slice(start, end), end } : null
}

function extractPdf(bytes: Uint8Array): string {
  const source = Buffer.from(bytes)
  const marker = Buffer.from('stream')
  const endMarker = Buffer.from('endstream')
  const chunks: string[] = []
  let cursor = 0
  while (true) {
    const streamStart = source.indexOf(marker, cursor)
    if (streamStart < 0) break
    const streamEnd = source.indexOf(endMarker, streamStart + marker.length)
    if (streamEnd < 0) break
    let dataStart = streamStart + marker.length
    if (source[dataStart] === 0x0d) dataStart += source[dataStart + 1] === 0x0a ? 2 : 1
    else if (source[dataStart] === 0x0a) dataStart += 1
    const headerStart = Math.max(0, source.lastIndexOf(Buffer.from('obj'), streamStart))
    const header = source.subarray(headerStart, streamStart).toString('latin1')
    let data = source.subarray(dataStart, streamEnd)
    if (/\/FlateDecode/.test(header)) {
      try { data = inflateSync(data) } catch { try { data = inflateRawSync(data) } catch { data = Buffer.alloc(0) } }
    }
    if (data.byteLength) chunks.push(data.toString('latin1'))
    cursor = streamEnd + endMarker.length
  }
  const text = pdfOperatorText(chunks.join('\n'))
  if (!text) throw new DocumentExtractionError('invalid-document', 'PDF 中没有可读取的文本层')
  return text
}

function runTextutil(path: string): Promise<string> {
  if (process.platform !== 'darwin') return Promise.reject(new DocumentExtractionError('extraction-unavailable', '旧版 Word 文档提取仅支持 macOS'))
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/textutil', ['-convert', 'txt', '-stdout', path], { encoding: 'utf8', maxBuffer: MAX_EXTRACTED_BYTES, timeout: 30_000 }, (error, stdout) => {
      if (error) { reject(new DocumentExtractionError('invalid-document', '无法提取 Word 文档文本')); return }
      const text = stdout.trim()
      if (!text) reject(new DocumentExtractionError('invalid-document', 'Word 文档没有可读取的正文'))
      else resolve(text)
    })
  })
}

export async function extractDocument(path: string, bytes: Uint8Array): Promise<ExtractedDocument> {
  const extension = path.slice(path.lastIndexOf('.')).toLowerCase()
  if (extension === '.md' || extension === '.markdown') return { kind: 'markdown', mimeType: 'text/markdown', text: decodeUtf8(bytes) }
  if (extension === '.txt' || extension === '.text') return { kind: 'plain-text', mimeType: 'text/plain', text: decodeUtf8(bytes) }
  if (extension === '.json') return { kind: 'json', mimeType: 'application/json', text: decodeUtf8(bytes) }
  if (extension === '.pdf') return { kind: 'pdf', mimeType: 'application/pdf', text: extractPdf(bytes) }
  if (extension === '.docx') return { kind: 'word', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', text: extractDocx(bytes) }
  if (extension === '.doc') return { kind: 'word', mimeType: 'application/msword', text: await runTextutil(path) }
  throw new DocumentExtractionError('extraction-unavailable', '当前文件类型不支持文本提取')
}
