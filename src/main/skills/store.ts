import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from 'node:path'
import type { InstallSkillInput, LinkSkillInput, SkillInstallation, SkillPermission, SkillScope, SkillScriptRuntime, SkillSource, UpdateSkillInput } from '../../shared/contracts/skills'

interface SkillFile { version: 1; items: SkillInstallation[] }

function isDirectory(value: string): Promise<boolean> {
  return fs.stat(value).then((details) => details.isDirectory()).catch(() => false)
}

function requiredSource(value: string): string {
  if (typeof value !== 'string' || !value.trim() || !isAbsolute(value)) throw new Error('Skill 路径必须是绝对路径')
  return resolve(value)
}

function safeName(value: string): string {
  const name = value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  if (!name) throw new Error('Skill 名称无效')
  return name.slice(0, 96)
}

function isWithin(root: string, target: string): boolean {
  const boundary = resolve(root)
  const candidate = resolve(target)
  return candidate === boundary || candidate.startsWith(`${boundary}${sep}`)
}

const ALL_RUNTIMES: SkillScriptRuntime[] = ['node', 'python', 'shell']

function listField(text: string, key: string): string[] | undefined {
  const frontmatter = text.match(/^---\s*\n([\s\S]*?)\n---/)
  const raw = frontmatter?.[1].match(new RegExp(`^${key}:\\s*(.+)$`, 'mi'))?.[1]?.trim()
  if (raw === undefined) return undefined
  const value = raw.replace(/^\[|\]$/g, '').split(',').map((item) => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
  return value
}

function declaredList<T extends string>(text: string, key: string, allowed: readonly T[], fallback: T[]): T[] {
  const values = listField(text, key)
  if (values === undefined) return [...fallback]
  if (values.some((value) => !allowed.includes(value as T))) throw new Error(`Skill ${key} 声明包含不支持的值`)
  return [...new Set(values)] as T[]
}

function parseSkill(name: string, text: string): { displayName: string; description?: string; permissions: SkillPermission[]; runtimes: SkillScriptRuntime[]; triggerKeywords?: string[]; excludeKeywords?: string[] } {
  const frontmatter = text.match(/^---\s*\n([\s\S]*?)\n---/)
  const field = (key: string): string | undefined => frontmatter?.[1].match(new RegExp(`^${key}:\\s*(.+)$`, 'mi'))?.[1]?.trim().replace(/^['"]|['"]$/g, '')
  return {
    displayName: field('name') || name,
    ...(field('description') ? { description: field('description') } : {}),
    permissions: declaredList(text, 'permissions', ['filesystem-read', 'filesystem-write', 'network', 'process'], []),
    runtimes: declaredList(text, 'runtimes', ALL_RUNTIMES, []),
    ...(listField(text, 'triggerKeywords') ? { triggerKeywords: listField(text, 'triggerKeywords') } : {}),
    ...(listField(text, 'excludeKeywords') ? { excludeKeywords: listField(text, 'excludeKeywords') } : {}),
  }
}

async function hashSkillTree(root: string): Promise<string> {
  const files: string[] = []
  const visit = async (directory: string, relativeDirectory: string): Promise<void> => {
    const entries = (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))
    for (const entry of entries) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) throw new Error('Skill 目录不允许包含符号链接')
      if (entry.isDirectory()) {
        await visit(path, relativePath)
      } else if (entry.isFile()) {
        const digest = createHash('sha256').update(await fs.readFile(path)).digest('hex')
        files.push(`${relativePath}\0${digest}`)
      }
    }
  }
  await visit(root, '')
  return createHash('sha256').update(files.join('\n')).digest('hex')
}

async function inspectRoot(root: string): Promise<{ name: string; displayName: string; description?: string; hash: string; permissions: SkillPermission[]; runtimes: SkillScriptRuntime[]; triggerKeywords?: string[]; excludeKeywords?: string[] }> {
  if (!(await isDirectory(root))) throw new Error('Skill 目录不存在或不可访问')
  const skillFile = join(root, 'SKILL.md')
  const text = await fs.readFile(skillFile, 'utf8')
  const hash = await hashSkillTree(root)
  const metadata = parseSkill(safeName(basename(root)), text)
  return { name: safeName(basename(root)), ...metadata, hash }
}

async function readFile(path: string): Promise<SkillFile> {
  try {
    const value = JSON.parse(await fs.readFile(path, 'utf8')) as Partial<SkillFile>
    if (value.version !== 1 || !Array.isArray(value.items)) throw new Error('invalid')
    return { version: 1, items: value.items.filter((item): item is SkillInstallation => Boolean(item && typeof item === 'object' && typeof item.id === 'string' && typeof item.rootPath === 'string')) }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, items: [] }
    throw new Error('Skill 索引损坏')
  }
}

async function writeFile(path: string, value: SkillFile): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await fs.rename(temporary, path)
  } catch (error) {
    try { await fs.unlink(temporary) } catch { /* best effort cleanup */ }
    throw error
  }
}

async function copyTree(source: string, target: string): Promise<void> {
  const details = await fs.lstat(source)
  if (details.isSymbolicLink()) throw new Error('安装 Skill 不允许包含符号链接')
  if (details.isDirectory()) {
    await fs.mkdir(target, { recursive: true })
    for (const entry of await fs.readdir(source)) await copyTree(join(source, entry), join(target, entry))
    return
  }
  await fs.copyFile(source, target)
}

export interface SkillStoreOptions {
  userDataPath: string
  getProjectRoot: () => string | undefined
  builtInRoot?: string
}

export interface ResolvedSkillScript {
  installation: SkillInstallation
  path: string
  entrypoint: string
  runtime: 'node' | 'python' | 'shell'
}

export class SkillStore {
  private readonly userDataPath: string
  private readonly getProjectRoot: () => string | undefined
  private readonly builtInRoot?: string
  private readonly writeChains = new Map<string, Promise<unknown>>()

  constructor(options: SkillStoreOptions) {
    this.userDataPath = resolve(options.userDataPath)
    this.getProjectRoot = options.getProjectRoot
    this.builtInRoot = options.builtInRoot
  }

  async list(): Promise<SkillInstallation[]> {
    const items = await this.readScope('global')
    if (this.getProjectRoot()) items.push(...await this.readScope('project'))
    if (this.builtInRoot && await isDirectory(this.builtInRoot)) {
      for (const name of await fs.readdir(this.builtInRoot)) {
        const root = join(this.builtInRoot, name)
        if (!(await isDirectory(root)) || items.some((item) => item.name === name)) continue
        try {
          const metadata = await inspectRoot(root)
          items.push({ id: `builtin:${metadata.name}`, name: metadata.name, displayName: metadata.displayName, ...(metadata.description ? { description: metadata.description } : {}), rootPath: root, scope: 'global', source: 'builtin', enabled: true, trusted: true, trustMode: 'controlled', contentHash: metadata.hash, updatedAt: new Date().toISOString(), permissions: metadata.permissions, runtimes: metadata.runtimes, ...(metadata.triggerKeywords ? { triggerKeywords: metadata.triggerKeywords } : {}), ...(metadata.excludeKeywords ? { excludeKeywords: metadata.excludeKeywords } : {}) })
        } catch { /* an incomplete bundled skill is omitted from the picker */ }
      }
    }
    return items.filter((item) => item.hidden !== true).sort((a, b) => a.displayName.localeCompare(b.displayName, 'zh-CN'))
  }

  async link(input: LinkSkillInput): Promise<SkillInstallation> { return this.add(input, 'link') }
  async install(input: InstallSkillInput): Promise<SkillInstallation> { return this.add(input, 'install') }

  async update(input: UpdateSkillInput): Promise<SkillInstallation> {
    if (input.projectAuthorized !== undefined && typeof input.projectAuthorized !== 'boolean') throw new Error('项目授权状态无效')
    const found = await this.find(input.id)
    if (!found) throw new Error('Skill 不存在')
    return this.withScope(found.scope, async (items) => {
      const next = { ...found, ...(input.displayName?.trim() ? { displayName: input.displayName.trim() } : {}), ...(input.note === undefined ? {} : { note: input.note.trim() || undefined }), ...(input.enabled === undefined ? {} : { enabled: input.enabled }), ...(input.trusted === undefined ? {} : { trusted: input.trusted }), ...(input.trustMode === undefined ? {} : { trustMode: input.trustMode }), ...(found.scope === 'project' && input.projectAuthorized !== undefined ? { projectAuthorized: input.projectAuthorized } : {}), updatedAt: new Date().toISOString() }
      const updated = items.some((item) => item.id === found.id)
        ? items.map((item) => item.id === found.id ? next : item)
        : [...items, next]
      await this.writeScope(found.scope, updated)
      return next
    })
  }

  async remove(id: string): Promise<void> {
    const found = await this.find(id)
    if (!found) return
    await this.withScope(found.scope, async (items) => {
      if (found.source === 'builtin') {
        const hidden = { ...found, hidden: true, enabled: false, updatedAt: new Date().toISOString() }
        await this.writeScope(found.scope, [...items.filter((item) => item.id !== id && item.name !== found.name), hidden])
        return undefined
      }
      await this.writeScope(found.scope, items.filter((item) => item.id !== id))
      if (found.source === 'install' && isWithin(this.scopeRoot(found.scope), found.rootPath)) await fs.rm(found.rootPath, { recursive: true, force: true })
      return undefined
    })
  }

  async rescan(id: string): Promise<SkillInstallation> {
    const found = await this.find(id)
    if (!found) throw new Error('Skill 不存在')
    const metadata = await inspectRoot(found.rootPath)
    const next = { ...found, name: metadata.name, displayName: found.displayName || metadata.displayName, description: metadata.description ?? found.description, contentHash: metadata.hash, permissions: metadata.permissions, runtimes: metadata.runtimes, ...(metadata.triggerKeywords ? { triggerKeywords: metadata.triggerKeywords } : {}), ...(metadata.excludeKeywords ? { excludeKeywords: metadata.excludeKeywords } : {}), trusted: found.contentHash === metadata.hash ? found.trusted : false, ...(found.contentHash === metadata.hash ? {} : found.scope === 'project' ? { projectAuthorized: false } : {}), updatedAt: new Date().toISOString() }
    await this.withScope(found.scope, async (items) => {
      const updated = items.some((item) => item.id === id) ? items.map((item) => item.id === id ? next : item) : [...items, next]
      await this.writeScope(found.scope, updated)
      return next
    })
    return next
  }

  async instructions(id: string): Promise<string | null> {
    const found = await this.find(id)
    if (!found || !found.enabled || !found.trusted || (found.scope === 'project' && found.projectAuthorized !== true)) return null
    try {
      const metadata = await inspectRoot(found.rootPath)
      if (metadata.hash !== found.contentHash) return null
      return await fs.readFile(join(found.rootPath, 'SKILL.md'), 'utf8')
    } catch { return null }
  }

  async resolveScript(id: string, entrypoint: string): Promise<ResolvedSkillScript> {
    const found = await this.find(id)
    if (!found || !found.enabled) throw new Error('Skill 未启用或不存在')
    if (!found.trusted) throw new Error('Skill 尚未获得信任确认')
    if (found.scope === 'project' && found.projectAuthorized !== true) throw new Error('Skill 尚未获得当前项目授权')
    if (!entrypoint.trim() || isAbsolute(entrypoint) || entrypoint.includes('\0')) throw new Error('Skill 脚本路径必须是相对路径')
    const rootPath = await fs.realpath(found.rootPath)
    const metadata = await inspectRoot(rootPath)
    if (metadata.hash !== found.contentHash) throw new Error('Skill 内容已变化，请重新扫描并确认信任')
    const requestedPath = resolve(rootPath, entrypoint)
    if (!isWithin(rootPath, requestedPath)) throw new Error('Skill 脚本必须位于 Skill 目录内')
    const path = await fs.realpath(requestedPath)
    if (!isWithin(rootPath, path)) throw new Error('Skill 脚本不能通过符号链接离开 Skill 目录')
    const details = await fs.stat(path)
    if (!details.isFile()) throw new Error('Skill 脚本路径不是文件')
    const extension = extname(path).toLowerCase()
    const runtime = extension === '.js' ? 'node' : extension === '.py' ? 'python' : extension === '.sh' ? 'shell' : undefined
    if (!runtime) throw new Error('Skill 只支持 .js、.py 和 .sh 脚本')
    const runtimes = metadata.runtimes
    if (!runtimes.includes(runtime)) throw new Error(`Skill 未声明允许使用 ${runtime} 运行时`)
    if (!metadata.permissions.includes('process')) throw new Error('Skill 未声明 process 脚本执行权限')
    if (found.trustMode === 'controlled' && metadata.permissions.includes('filesystem-write')) throw new Error('受控 Skill 禁止 filesystem-write；请改用 Agent 业务工具并单独授权')
    return { installation: found, path, entrypoint: entrypoint.replaceAll('\\', '/'), runtime }
  }

  private scopeRoot(scope: SkillScope): string {
    if (scope === 'global') return join(this.userDataPath, 'skills')
    const root = this.getProjectRoot()
    if (!root) throw new Error('请先打开一个项目')
    return join(resolve(root), '.latent-studio', 'skills')
  }

  private indexPath(scope: SkillScope): string { return join(this.scopeRoot(scope), 'index.json') }

  private async readScope(scope: SkillScope): Promise<SkillInstallation[]> { return (await readFile(this.indexPath(scope))).items }
  private async writeScope(scope: SkillScope, items: SkillInstallation[]): Promise<void> { await writeFile(this.indexPath(scope), { version: 1, items }) }

  private async withScope<T>(scope: SkillScope, operation: (items: SkillInstallation[]) => Promise<T>): Promise<T> {
    const key = scope
    const previous = this.writeChains.get(key) ?? Promise.resolve()
    const next = previous.then(async () => operation(await this.readScope(scope)))
    this.writeChains.set(key, next.then(() => undefined, () => undefined))
    return next
  }

  private async find(id: string): Promise<SkillInstallation | undefined> { return (await this.list()).find((item) => item.id === id) }

  private async add(input: LinkSkillInput | InstallSkillInput, source: SkillSource): Promise<SkillInstallation> {
    const scope = input.scope ?? 'global'
    const sourceRoot = requiredSource(input.sourcePath)
    const metadata = await inspectRoot(sourceRoot)
    const destination = source === 'link' ? sourceRoot : join(this.scopeRoot(scope), metadata.name)
    if (source === 'install') { await fs.rm(destination, { recursive: true, force: true }); await copyTree(sourceRoot, destination) }
    const now = new Date().toISOString()
    const item: SkillInstallation = { id: randomUUID(), name: metadata.name, displayName: input.displayName?.trim() || metadata.displayName, ...(metadata.description ? { description: metadata.description } : {}), ...(input.note?.trim() ? { note: input.note.trim() } : {}), rootPath: destination, scope, source, enabled: true, trusted: false, trustMode: 'controlled', contentHash: metadata.hash, updatedAt: now, permissions: metadata.permissions, runtimes: metadata.runtimes, ...(metadata.triggerKeywords ? { triggerKeywords: metadata.triggerKeywords } : {}), ...(metadata.excludeKeywords ? { excludeKeywords: metadata.excludeKeywords } : {}), ...(scope === 'project' ? { projectAuthorized: false } : {}) }
    return this.withScope(scope, async (items) => { const duplicate = items.find((entry) => entry.name === item.name); const next = duplicate ? { ...item, id: duplicate.id, enabled: duplicate.enabled, trusted: false } : item; await this.writeScope(scope, [...items.filter((entry) => entry.id !== next.id), next]); return next })
  }
}
