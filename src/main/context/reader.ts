import { promises as nodeFs } from 'node:fs'
import { basename, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import type {
  ContextDocumentKind,
  ContextFileSystem,
  ProjectContextDocument,
  ProjectContextErrorCode,
  ReadProjectDocumentInput,
} from '../../shared/contracts/context'
import { MAX_ATTACHMENT_FILE_BYTES } from '../../shared/contracts/context'
import { DocumentExtractionError, extractDocument } from './extractor'

export const DEFAULT_CONTEXT_FILE_MAX_BYTES = 1024 * 1024
export const MAX_CONTEXT_FILE_BYTES = 4 * 1024 * 1024

export const contextFileSystem: ContextFileSystem = {
  realpath: nodeFs.realpath,
  stat: nodeFs.stat,
  readFile: nodeFs.readFile,
}

export class ProjectContextError extends Error {
  constructor(public readonly code: ProjectContextErrorCode, message: string) {
    super(message)
    this.name = 'ProjectContextError'
  }
}

function isWithin(rootPath: string, candidatePath: string): boolean {
  const childPath = relative(rootPath, candidatePath)
  return childPath !== '' && childPath !== '..' && !childPath.startsWith(`..${sep}`) && !isAbsolute(childPath)
}

function candidatePath(projectRoot: string, filePath: string): string {
  if (!projectRoot || !isAbsolute(projectRoot)) {
    throw new ProjectContextError('invalid-project-root', 'Project root must be an absolute path')
  }
  if (!filePath || typeof filePath !== 'string') {
    throw new ProjectContextError('invalid-path', 'A selected file path is required')
  }

  const rootPath = resolve(projectRoot)
  const selectedPath = resolve(filePath)
  const resolvedPath = isAbsolute(filePath) ? selectedPath : resolve(rootPath, filePath)
  if (!isWithin(rootPath, resolvedPath)) {
    throw new ProjectContextError('invalid-path', 'Selected file must be inside the current project')
  }
  return resolvedPath
}

function kindForPath(filePath: string): { kind: ContextDocumentKind; mimeType: 'text/markdown' | 'text/plain' | 'application/json' | 'application/pdf' | 'application/msword' | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' } {
  const extension = extname(filePath).toLowerCase()
  if (extension === '.md' || extension === '.markdown') return { kind: 'markdown', mimeType: 'text/markdown' }
  if (extension === '.txt' || extension === '.text') return { kind: 'plain-text', mimeType: 'text/plain' }
  if (extension === '.json') return { kind: 'json', mimeType: 'application/json' }
  if (extension === '.pdf') return { kind: 'pdf', mimeType: 'application/pdf' }
  if (extension === '.doc') return { kind: 'word', mimeType: 'application/msword' }
  if (extension === '.docx') return { kind: 'word', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
  throw new ProjectContextError('unsupported-type', '当前文件类型不支持加入上下文')
}

function requestedLimit(maxBytes: number | undefined): number {
  if (maxBytes === undefined) return DEFAULT_CONTEXT_FILE_MAX_BYTES
  if (!Number.isInteger(maxBytes) || maxBytes <= 0 || maxBytes > MAX_CONTEXT_FILE_BYTES) {
    throw new ProjectContextError('invalid-limit', `Context file limit must be between 1 and ${MAX_CONTEXT_FILE_BYTES} bytes`)
  }
  return maxBytes
}

function requestedAttachmentLimit(maxBytes: number | undefined): number {
  if (maxBytes === undefined) return MAX_ATTACHMENT_FILE_BYTES
  if (!Number.isInteger(maxBytes) || maxBytes <= 0 || maxBytes > MAX_ATTACHMENT_FILE_BYTES) {
    throw new ProjectContextError('invalid-limit', `Attachment limit must be between 1 and ${MAX_ATTACHMENT_FILE_BYTES} bytes`)
  }
  return maxBytes
}

function attachmentExcerpt(value: string): string {
  if (Buffer.byteLength(value, 'utf8') <= MAX_CONTEXT_FILE_BYTES) return value
  const marker = '\n\n...[附件较大，已仅提取前 4 MiB；需要后续内容时请拆分文件后重新上传]'
  const budget = MAX_CONTEXT_FILE_BYTES - Buffer.byteLength(marker, 'utf8')
  let low = 0
  let high = value.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (Buffer.byteLength(value.slice(0, middle), 'utf8') <= budget) low = middle
    else high = middle - 1
  }
  return `${value.slice(0, low)}${marker}`
}

function classifyReadError(error: unknown, path: string): ProjectContextError {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  if (code === 'ENOENT' || code === 'ENOTDIR') return new ProjectContextError('missing-file', `Selected file does not exist: ${path}`)
  return new ProjectContextError('read-failed', `Unable to read selected file: ${path}`)
}

async function readCanonicalDocument(
  canonicalPath: string,
  relativePath: string,
  sourceLimit: number,
  fs: ContextFileSystem,
  excerptLargeText = false,
): Promise<ProjectContextDocument> {
  const { kind, mimeType } = kindForPath(canonicalPath)
  let details: { isFile(): boolean; size: number }
  try {
    details = await fs.stat(canonicalPath)
  } catch (error) {
    throw classifyReadError(error, canonicalPath)
  }
  if (!details.isFile()) throw new ProjectContextError('not-a-file', 'Selected path is not a regular file')
  if (details.size > sourceLimit) throw new ProjectContextError('file-too-large', `Selected file exceeds the ${sourceLimit}-byte limit`)

  let bytes: Buffer
  try {
    bytes = await fs.readFile(canonicalPath)
  } catch (error) {
    throw classifyReadError(error, canonicalPath)
  }
  if (bytes.byteLength > sourceLimit) throw new ProjectContextError('file-too-large', `Selected file exceeds the ${sourceLimit}-byte limit`)

  let extracted: Awaited<ReturnType<typeof extractDocument>>
  try {
    extracted = await extractDocument(canonicalPath, bytes)
  } catch (error) {
    if (error instanceof DocumentExtractionError) throw new ProjectContextError(error.code, error.message)
    throw new ProjectContextError('invalid-document', '文档文本提取失败')
  }
  const text = excerptLargeText ? attachmentExcerpt(extracted.text) : extracted.text
  if (!excerptLargeText && Buffer.byteLength(text, 'utf8') > sourceLimit) throw new ProjectContextError('file-too-large', `提取后的文档文本超过 ${sourceLimit} 字节限制`)

  return {
    summary: {
      relativePath,
      fileName: basename(canonicalPath),
      kind: extracted.kind ?? kind,
      mimeType: extracted.mimeType ?? mimeType,
      byteLength: bytes.byteLength,
    },
    text,
  }
}

/** Reads a document selected through an explicit system file-picker action. */
export async function readAttachmentDocument(
  input: { filePath: string; maxBytes?: number },
  fs: ContextFileSystem = contextFileSystem,
): Promise<ProjectContextDocument> {
  if (!input.filePath || !isAbsolute(input.filePath)) throw new ProjectContextError('invalid-path', '附件必须来自系统文件选择器')
  const selectedPath = resolve(input.filePath)
  const limit = requestedAttachmentLimit(input.maxBytes)
  let canonicalPath: string
  try {
    canonicalPath = await fs.realpath(selectedPath)
  } catch (error) {
    throw classifyReadError(error, selectedPath)
  }
  return readCanonicalDocument(canonicalPath, basename(canonicalPath), limit, fs, true)
}

/**
 * Reads one user-selected text document from the current project.
 * The canonical path is read after realpath checks so a symlink cannot escape the project.
 */
export async function readProjectDocument(
  input: ReadProjectDocumentInput,
  fs: ContextFileSystem = contextFileSystem,
): Promise<ProjectContextDocument> {
  const selectedPath = candidatePath(input.projectRoot, input.filePath)
  const limit = requestedLimit(input.maxBytes)
  let rootPath: string
  let canonicalPath: string
  try {
    rootPath = await fs.realpath(resolve(input.projectRoot))
    canonicalPath = await fs.realpath(selectedPath)
  } catch (error) {
    throw classifyReadError(error, selectedPath)
  }

  if (!isWithin(rootPath, canonicalPath)) {
    throw new ProjectContextError('invalid-path', 'Selected file must remain inside the current project')
  }

  return readCanonicalDocument(canonicalPath, relative(rootPath, canonicalPath).split(sep).join('/'), limit, fs)
}
