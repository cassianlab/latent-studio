/** Project document formats that can be read into a model context. */
export type ContextDocumentKind = 'markdown' | 'plain-text' | 'json' | 'pdf' | 'word'

export interface ContextDocumentSummary {
  relativePath: string
  fileName: string
  kind: ContextDocumentKind
  mimeType: 'text/markdown' | 'text/plain' | 'application/json' | 'application/pdf' | 'application/msword' | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  byteLength: number
}

/** Renderer-safe result from a project document read. */
export interface ProjectContextDocument {
  summary: ContextDocumentSummary
  text: string
}

export interface ReadProjectDocumentInput {
  projectRoot: string
  filePath: string
  /** A lower per-request limit may be supplied; the service still enforces its hard limit. */
  maxBytes?: number
}

export interface ContextApi {
  readProjectFile(input: Omit<ReadProjectDocumentInput, 'projectRoot'>): Promise<ProjectContextDocument>
  chooseAndReadProjectFile(): Promise<ProjectContextDocument | null>
  chooseAndReadAttachments(): Promise<ProjectContextDocument[]>
}

export const MAX_CONTEXT_ATTACHMENTS = 8
export const MAX_ATTACHMENT_FILE_BYTES = 50 * 1024 * 1024

export type ProjectContextErrorCode =
  | 'invalid-project-root'
  | 'invalid-path'
  | 'missing-file'
  | 'not-a-file'
  | 'unsupported-type'
  | 'extraction-unavailable'
  | 'invalid-document'
  | 'file-too-large'
  | 'invalid-utf8'
  | 'invalid-limit'
  | 'read-failed'

export interface ContextFileSystem {
  realpath(path: string): Promise<string>
  stat(path: string): Promise<{ isFile(): boolean; size: number }>
  readFile(path: string): Promise<Buffer>
}
