import { promises as fs } from 'node:fs'
import { basename, dirname, extname, isAbsolute, parse, relative, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ListProjectItemsInput, ProjectItemInput, ProjectItemKind, ProjectItemMetadata, ProjectMetadataStore, SaveProjectDocumentInput, UpdateProjectDocumentInput } from '../../shared/contracts/library'
import { LibraryError } from './errors'

const DEFAULT_MAX_ENTRIES = 500
const HARD_MAX_ENTRIES = 10_000

function isWithin(root: string, candidate: string, allowEqual = false): boolean {
  const child = relative(root, candidate)
  if (allowEqual && child === '') return true
  return child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child)
}

function validateRootInput(projectRoot: unknown): string {
  if (typeof projectRoot !== 'string' || !isAbsolute(projectRoot) || parse(resolve(projectRoot)).root === resolve(projectRoot)) {
    throw new LibraryError('invalid-project-root', '项目根目录必须是绝对且非根路径')
  }
  return resolve(projectRoot)
}

async function canonicalRoot(projectRoot: unknown): Promise<string> {
  const root = validateRootInput(projectRoot)
  try {
    const real = await fs.realpath(root)
    if (!(await fs.stat(real)).isDirectory()) throw new LibraryError('invalid-project-root', '项目根目录不是文件夹')
    return real
  } catch (error) {
    if (error instanceof LibraryError) throw error
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new LibraryError('invalid-project-root', '项目根目录不存在')
    throw new LibraryError('invalid-project-root', '无法访问项目根目录')
  }
}

async function canonicalChild(root: string, requestedPath: string, expected: 'file' | 'directory' | 'either' = 'either'): Promise<{ lexicalPath: string; canonicalPath: string; details: { isFile(): boolean; isDirectory(): boolean; size: number; mtimeMs: number } }> {
  if (typeof requestedPath !== 'string' || !requestedPath.trim() || requestedPath.includes('\0')) throw new LibraryError('invalid-path', '路径无效')
  const lexicalPath = isAbsolute(requestedPath) ? resolve(requestedPath) : resolve(root, requestedPath)
  const lexicalWithin = isWithin(root, lexicalPath, true)
  // An absolute path may use a symlinked spelling of the project root. In that
  // case the canonical-path check below is authoritative; relative traversal
  // is rejected before touching the filesystem.
  if (!lexicalWithin && !isAbsolute(requestedPath)) throw new LibraryError('outside-project', '路径必须位于当前项目内')
  let canonicalPath: string
  try {
    canonicalPath = await fs.realpath(lexicalPath)
  } catch (error) {
    if (!lexicalWithin) throw new LibraryError('outside-project', '路径必须位于当前项目内')
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'ENOTDIR') throw new LibraryError('missing-path', '路径不存在')
    throw new LibraryError('read-failed', '无法解析路径')
  }
  if (!isWithin(root, canonicalPath, true)) throw new LibraryError('outside-project', '路径不能通过符号链接离开项目')
  let details: { isFile(): boolean; isDirectory(): boolean; size: number; mtimeMs: number }
  try { details = await fs.stat(canonicalPath) } catch { throw new LibraryError('read-failed', '无法读取路径元数据') }
  if (expected === 'file' && !details.isFile()) throw new LibraryError('not-a-file', '路径不是文件')
  if (expected === 'directory' && !details.isDirectory()) throw new LibraryError('not-a-directory', '路径不是文件夹')
  // Keep the user's project-relative spelling when it is inside the canonical
  // root; absolute paths through a symlinked root use the canonical spelling
  // so that relativePath remains stable and never escapes the project.
  return { lexicalPath: lexicalWithin ? lexicalPath : canonicalPath, canonicalPath, details }
}

function classify(relativePath: string): ProjectItemKind {
  const top = relativePath.split('/')[0]
  if (top === 'documents') return 'document'
  if (top === 'assets') return 'asset'
  if (top === 'outputs') return 'output'
  return 'other'
}

function mimeFor(extension: string, isDirectory: boolean): string | undefined {
  if (isDirectory) return undefined
  const map: Record<string, string> = {
    '.md': 'text/markdown', '.markdown': 'text/markdown', '.txt': 'text/plain', '.json': 'application/json',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
    '.pdf': 'application/pdf', '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  }
  return map[extension]
}

function maxEntries(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_ENTRIES
  if (!Number.isInteger(value) || value < 1 || value > HARD_MAX_ENTRIES) throw new LibraryError('invalid-input', `最多只能读取 1-${HARD_MAX_ENTRIES} 项`)
  return value
}

function metadata(root: string, lexicalPath: string, details: { isFile(): boolean; isDirectory(): boolean; size: number; mtimeMs: number }): ProjectItemMetadata {
  const relativePath = relative(root, lexicalPath).split(sep).join('/')
  const name = relativePath ? relativePath.split('/').at(-1)! : parse(root).base
  const isDirectory = details.isDirectory()
  const extension = isDirectory ? undefined : extname(name).toLowerCase() || undefined
  return {
    relativePath,
    name,
    kind: classify(relativePath),
    ...(extension ? { extension } : {}),
    ...(mimeFor(extension ?? '', isDirectory) ? { mimeType: mimeFor(extension ?? '', isDirectory) } : {}),
    isDirectory,
    ...(isDirectory ? {} : { byteLength: details.size }),
    modifiedAt: new Date(details.mtimeMs).toISOString(),
  }
}

function safeDocumentName(input: SaveProjectDocumentInput): string {
  const raw = typeof input.filename === 'string' && input.filename.trim() ? input.filename.trim() : input.title.trim()
  const cleaned = raw.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim()
  let ext = '.md'
  if (input.extension) {
    const candidate = input.extension.startsWith('.') ? input.extension.toLowerCase() : `.${input.extension.toLowerCase()}`
    if (['.md', '.txt', '.json'].includes(candidate)) ext = candidate
  } else {
    const matched = cleaned.match(/\.(md|markdown|txt|json)$/i)
    if (matched) {
      const found = matched[1].toLowerCase()
      ext = found === 'markdown' ? '.md' : `.${found}`
    }
  }
  const base = cleaned.replace(/\.(md|markdown|txt|json)$/i, '').trim()
  if (!base) throw new LibraryError('invalid-input', '文档名称不能为空')
  return `${base.slice(0, 180)}${ext}`
}

function safeUpdatedDocumentName(title: string, extension: string): string {
  const cleaned = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim()
  const base = cleaned.replace(/\.(md|markdown|txt|text|json)$/i, '').trim()
  if (!base) throw new LibraryError('invalid-input', '文档名称不能为空')
  return `${base.slice(0, 180)}${extension}`
}

async function writeDocument(root: string, input: SaveProjectDocumentInput): Promise<ProjectItemMetadata> {
  if (!input || typeof input !== 'object' || typeof input.title !== 'string' || !input.title.trim()) throw new LibraryError('invalid-input', '文档标题不能为空')
  if (typeof input.content !== 'string' || !input.content.trim()) throw new LibraryError('invalid-input', '文档内容不能为空')
  const documentsPath = resolve(root, 'documents')
  await fs.mkdir(documentsPath, { recursive: true })
  const documents = (await canonicalChild(root, documentsPath, 'directory')).canonicalPath
  const filename = safeDocumentName(input)
  const ext = extname(filename)
  const base = filename.slice(0, -ext.length)
  let target = resolve(documents, filename)
  try {
    await fs.access(target)
    target = resolve(documents, `${base}-${Date.now()}-${randomUUID().slice(0, 6)}${ext}`)
  } catch { /* new file */ }
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
  try {
    await fs.writeFile(temporary, `${input.content.trim()}\n`, 'utf8')
    await fs.rename(temporary, target)
    const details = await fs.stat(target)
    return metadata(root, target, details)
  } catch (error) {
    try { await fs.unlink(temporary) } catch { /* best effort cleanup */ }
    throw new LibraryError('read-failed', `无法保存项目文档：${(error as Error).message}`)
  }
}

async function updateDocument(root: string, input: UpdateProjectDocumentInput): Promise<ProjectItemMetadata> {
  if (!input || typeof input !== 'object' || typeof input.filePath !== 'string' || !input.filePath.trim()) throw new LibraryError('invalid-input', '文档路径不能为空')
  if (typeof input.title !== 'string' || !input.title.trim()) throw new LibraryError('invalid-input', '文档标题不能为空')
  if (typeof input.content !== 'string' || !input.content.trim()) throw new LibraryError('invalid-input', '文档内容不能为空')
  const target = await canonicalChild(root, input.filePath, 'file')
  const relativePath = relative(root, target.lexicalPath).split(sep).join('/')
  const extension = extname(relativePath).toLowerCase()
  if (!relativePath.startsWith('documents/') || !['.md', '.markdown', '.txt', '.text', '.json'].includes(extension)) throw new LibraryError('invalid-path', '只能编辑项目文档目录中的文本或数据文件')
  const destination = resolve(dirname(target.lexicalPath), safeUpdatedDocumentName(input.title, extension))
  const renamed = destination !== target.lexicalPath
  if (renamed && target.lexicalPath !== target.canonicalPath) throw new LibraryError('invalid-path', '符号链接文档不能改名')
  if (renamed) {
    try {
      await fs.access(destination)
      throw new LibraryError('invalid-input', '同名文档已存在')
    } catch (error) {
      if (error instanceof LibraryError) throw error
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new LibraryError('read-failed', '无法检查文档名称')
    }
  }
  const temporary = `${target.canonicalPath}.${process.pid}.${Date.now()}.tmp`
  try {
    await fs.writeFile(temporary, `${input.content.trim()}\n`, 'utf8')
    await fs.rename(temporary, target.canonicalPath)
    if (renamed) await fs.rename(target.canonicalPath, destination)
    const savedPath = renamed ? destination : target.lexicalPath
    const details = await fs.stat(savedPath)
    return metadata(root, savedPath, details)
  } catch (error) {
    try { await fs.unlink(temporary) } catch { /* best effort cleanup */ }
    throw new LibraryError('read-failed', `无法更新项目文档：${(error as Error).message}`)
  }
}

async function removeDocument(root: string, filePath: string): Promise<{ trashId: string }> {
  if (typeof filePath !== 'string' || !filePath.trim()) throw new LibraryError('invalid-input', '文档路径不能为空')
  const target = await canonicalChild(root, filePath, 'file')
  const relativePath = relative(root, target.lexicalPath).split(sep).join('/')
  if (!relativePath.startsWith('documents/')) throw new LibraryError('invalid-path', '只能删除项目文档目录中的文件')
  const trashId = randomUUID()
  const trashRoot = resolve(root, '.latent-studio', 'trash')
  const trashPath = resolve(trashRoot, `${trashId}-${basename(target.canonicalPath)}`)
  try {
    await fs.mkdir(trashRoot, { recursive: true })
    await fs.rename(target.canonicalPath, trashPath)
    const indexPath = resolve(trashRoot, 'index.json')
    let index: Array<{ id: string; originalPath: string; trashPath: string }> = []
    try { index = JSON.parse(await fs.readFile(indexPath, 'utf8')) as typeof index } catch { /* first entry */ }
    index.push({ id: trashId, originalPath: relative(root, target.canonicalPath).split(sep).join('/'), trashPath: relative(root, trashPath).split(sep).join('/') })
    await fs.writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new LibraryError('missing-path', '文档不存在')
    throw new LibraryError('read-failed', `无法移入回收区：${(error as Error).message}`)
  }
  return { trashId }
}

async function restoreDocument(root: string, trashId: string): Promise<void> {
  if (typeof trashId !== 'string' || !trashId.trim()) throw new LibraryError('invalid-input', '回收记录标识不能为空')
  const trashRoot = resolve(root, '.latent-studio', 'trash')
  const indexPath = resolve(trashRoot, 'index.json')
  let index: Array<{ id: string; originalPath: string; trashPath: string }>
  try { index = JSON.parse(await fs.readFile(indexPath, 'utf8')) as typeof index } catch { throw new LibraryError('not-found', '回收记录不存在') }
  const entry = index.find((item) => item.id === trashId)
  if (!entry) throw new LibraryError('not-found', '回收记录不存在')
  const destination = resolve(root, entry.originalPath)
  if (!isWithin(root, destination) || !entry.originalPath.startsWith('documents/')) throw new LibraryError('outside-project', '恢复路径无效')
  try {
    await fs.mkdir(resolve(destination, '..'), { recursive: true })
    await fs.rename(resolve(root, entry.trashPath), destination)
    await fs.writeFile(indexPath, `${JSON.stringify(index.filter((item) => item.id !== trashId), null, 2)}\n`, 'utf8')
  } catch (error) {
    throw new LibraryError('read-failed', `无法恢复项目文档：${(error as Error).message}`)
  }
}

/** Read-only project directory metadata with canonical path and symlink checks. */
export class ProjectMetadataService implements ProjectMetadataStore {
  async list(input: ListProjectItemsInput): Promise<ProjectItemMetadata[]> {
    const root = await canonicalRoot(input.projectRoot)
    const target = await canonicalChild(root, input.directory ?? root, 'directory')
    const limit = maxEntries(input.maxEntries)
    const results: ProjectItemMetadata[] = []
    const visited = new Set<string>([target.canonicalPath])
    const pending: Array<{ lexicalPath: string; canonicalPath: string }> = [{ lexicalPath: target.lexicalPath, canonicalPath: target.canonicalPath }]

    while (pending.length > 0 && results.length < limit) {
      const current = pending.shift()!
      let entries: import('node:fs').Dirent[]
      try { entries = await fs.readdir(current.canonicalPath, { withFileTypes: true }) } catch { throw new LibraryError('read-failed', '无法读取项目目录') }
      entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
      for (const entry of entries) {
        if (results.length >= limit) break
        if (!input.includeHidden && entry.name.startsWith('.')) continue
        const lexicalPath = resolve(current.lexicalPath, entry.name)
        const child = await canonicalChild(root, lexicalPath)
        const item = metadata(root, lexicalPath, child.details)
        results.push(item)
        if (input.recursive && child.details.isDirectory() && !visited.has(child.canonicalPath)) {
          visited.add(child.canonicalPath)
          pending.push({ lexicalPath, canonicalPath: child.canonicalPath })
        }
      }
    }
    return results
  }

  async inspect(input: ProjectItemInput): Promise<ProjectItemMetadata> {
    const root = await canonicalRoot(input.projectRoot)
    const child = await canonicalChild(root, input.filePath)
    return metadata(root, child.lexicalPath, child.details)
  }

  async saveDocument(input: SaveProjectDocumentInput & { projectRoot: string }): Promise<ProjectItemMetadata> {
    const root = await canonicalRoot(input.projectRoot)
    return writeDocument(root, input)
  }

  async updateDocument(input: UpdateProjectDocumentInput & { projectRoot: string }): Promise<ProjectItemMetadata> {
    const root = await canonicalRoot(input.projectRoot)
    return updateDocument(root, input)
  }

  async deleteDocument(input: { projectRoot: string; filePath: string }): Promise<{ trashId: string }> {
    const root = await canonicalRoot(input.projectRoot)
    return removeDocument(root, input.filePath)
  }

  async restoreDocument(input: { projectRoot: string; trashId: string }): Promise<void> {
    const root = await canonicalRoot(input.projectRoot)
    return restoreDocument(root, input.trashId)
  }
}

export const ProjectFileMetadataStore = ProjectMetadataService
