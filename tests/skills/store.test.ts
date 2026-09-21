import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SkillStore } from '../../src/main/skills/store'

async function fixture(): Promise<{ root: string; source: string; store: SkillStore }> {
  const root = await mkdtemp(join(tmpdir(), 'latent-skills-'))
  const source = join(root, 'shot-planner')
  await mkdir(join(source, 'scripts'), { recursive: true })
  await writeFile(join(source, 'SKILL.md'), '---\nname: shot-planner\ndescription: 分镜规划\npermissions: [process]\nruntimes: [node]\n---\n内容')
  await writeFile(join(source, 'scripts', 'run.js'), 'console.log(1)')
  return { root, source, store: new SkillStore({ userDataPath: join(root, 'user-data'), getProjectRoot: () => root }) }
}

describe('SkillStore', () => {
  it('links and installs skills with metadata and separate roots', async () => {
    const { root, source, store } = await fixture()
    const linked = await store.link({ sourcePath: source, displayName: '镜头规划', scope: 'project' })
    expect(linked.displayName).toBe('镜头规划')
    expect(linked.trusted).toBe(false)
    const installed = await store.install({ sourcePath: source, scope: 'global' })
    expect(installed.rootPath).toBe(join(root, 'user-data', 'skills', 'shot-planner'))
    expect(await readFile(join(installed.rootPath, 'SKILL.md'), 'utf8')).toContain('shot-planner')
    expect(new Set((await store.list()).map((item) => item.scope))).toEqual(new Set(['global', 'project']))
  })

  it('revokes trust after a rescan detects changed skill content', async () => {
    const { source, store } = await fixture()
    const item = await store.link({ sourcePath: source })
    await store.update({ id: item.id, trusted: true })
    await writeFile(join(source, 'SKILL.md'), '---\nname: shot-planner\npermissions: [process]\nruntimes: [node]\n---\nchanged')
    const rescanned = await store.rescan(item.id)
    expect(rescanned.trusted).toBe(false)
    expect(rescanned.contentHash).not.toBe(item.contentHash)
  })

  it('revokes trust after an executable file changes', async () => {
    const { source, store } = await fixture()
    const item = await store.link({ sourcePath: source })
    await store.update({ id: item.id, trusted: true })
    await writeFile(join(source, 'scripts', 'run.js'), 'console.log(2)')
    const rescanned = await store.rescan(item.id)
    expect(rescanned.trusted).toBe(false)
    expect(rescanned.contentHash).not.toBe(item.contentHash)
  })

  it('does not expose instructions or scripts before trust confirmation', async () => {
    const { source, store } = await fixture()
    const item = await store.link({ sourcePath: source })
    expect(await store.instructions(item.id)).toBeNull()
    await expect(store.resolveScript(item.id, 'scripts/run.js')).rejects.toThrow('信任')
    await store.update({ id: item.id, trusted: true })
    await expect(store.resolveScript(item.id, 'scripts/run.js')).resolves.toMatchObject({ runtime: 'node', entrypoint: 'scripts/run.js' })
  })

  it('requires explicit authorization before executing a project Skill', async () => {
    const { source, store } = await fixture()
    const item = await store.link({ sourcePath: source, scope: 'project' })
    await store.update({ id: item.id, trusted: true })
    expect((await store.list()).find((entry) => entry.id === item.id)?.projectAuthorized).toBe(false)
    await expect(store.instructions(item.id)).resolves.toBeNull()
    await expect(store.resolveScript(item.id, 'scripts/run.js')).rejects.toThrow('当前项目授权')
    const authorized = await store.update({ id: item.id, projectAuthorized: true })
    expect(authorized.projectAuthorized).toBe(true)
    await expect(store.instructions(item.id)).resolves.toContain('shot-planner')
    await expect(store.resolveScript(item.id, 'scripts/run.js')).resolves.toMatchObject({ runtime: 'node' })
    await store.update({ id: item.id, projectAuthorized: false })
    await expect(store.resolveScript(item.id, 'scripts/run.js')).rejects.toThrow('当前项目授权')
  })

  it('records declared permissions and runtimes, and rejects undeclared script execution', async () => {
    const { source, store } = await fixture()
    await writeFile(join(source, 'SKILL.md'), '---\nname: shot-planner\npermissions: [network]\nruntimes: [node]\n---\n内容')
    const item = await store.link({ sourcePath: source })
    expect(item.permissions).toEqual(['network'])
    expect(item.runtimes).toEqual(['node'])
    await store.update({ id: item.id, trusted: true })
    await expect(store.resolveScript(item.id, 'scripts/run.js')).rejects.toThrow('process 脚本执行权限')
    await writeFile(join(source, 'SKILL.md'), '---\nname: shot-planner\npermissions: [process]\nruntimes: [python]\n---\n内容')
    const rescanned = await store.rescan(item.id)
    expect(rescanned.trusted).toBe(false)
    await store.update({ id: item.id, trusted: true })
    await expect(store.resolveScript(item.id, 'scripts/run.js')).rejects.toThrow('node 运行时')
  })

  it('rejects unknown permission declarations instead of silently widening access', async () => {
    const { source, store } = await fixture()
    await writeFile(join(source, 'SKILL.md'), '---\nname: unsafe\npermissions: [camera]\n---\n内容')
    await expect(store.link({ sourcePath: source })).rejects.toThrow('permissions 声明包含不支持的值')
  })

  it('does not run filesystem-writing Skills in controlled trust mode', async () => {
    const { source, store } = await fixture()
    await writeFile(join(source, 'SKILL.md'), '---\nname: writer\npermissions: [process, filesystem-write]\nruntimes: [node]\n---\n内容')
    const item = await store.link({ sourcePath: source })
    await store.update({ id: item.id, trusted: true })
    await expect(store.resolveScript(item.id, 'scripts/run.js')).rejects.toThrow('filesystem-write')
  })

  it('uses the signed SKILL.md declaration instead of trusting mutable index metadata', async () => {
    const { root, source, store } = await fixture()
    await writeFile(join(source, 'SKILL.md'), '---\nname: shot-planner\nruntimes: [node]\n---\n内容')
    const item = await store.link({ sourcePath: source })
    await store.update({ id: item.id, trusted: true })
    const indexPath = join(root, 'user-data', 'skills', 'index.json')
    const index = JSON.parse(await readFile(indexPath, 'utf8')) as { version: number; items: Array<Record<string, unknown>> }
    index.items[0].permissions = ['process']
    index.items[0].runtimes = ['node']
    await writeFile(indexPath, `${JSON.stringify(index)}\n`)
    await expect(store.resolveScript(item.id, 'scripts/run.js')).rejects.toThrow('process 脚本执行权限')
  })

  it('does not expose instructions after a trusted Skill declaration changes', async () => {
    const { source, store } = await fixture()
    const item = await store.link({ sourcePath: source })
    await store.update({ id: item.id, trusted: true })
    await writeFile(join(source, 'SKILL.md'), '---\nname: shot-planner\npermissions: [network]\n---\nchanged')
    await expect(store.instructions(item.id)).resolves.toBeNull()
  })

  it('lists global and bundled skills without an active project and never removes bundled files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'latent-skills-builtins-'))
    const builtInRoot = join(root, 'builtin')
    const builtIn = join(builtInRoot, 'shot-planner')
    await mkdir(builtIn, { recursive: true })
    await writeFile(join(builtIn, 'SKILL.md'), '---\nname: shot-planner\ndescription: 内置\n---\n内容')
    const store = new SkillStore({ userDataPath: join(root, 'user-data'), getProjectRoot: () => undefined, builtInRoot })
    const items = await store.list()
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: 'builtin:shot-planner', source: 'builtin', trusted: true })
    await store.remove(items[0].id)
    await expect(readFile(join(builtIn, 'SKILL.md'), 'utf8')).resolves.toContain('内置')
    expect(await store.list()).toEqual([])
  })

  it('keeps the editable display name and note separate from signed metadata', async () => {
    const { source, store } = await fixture()
    const item = await store.link({ sourcePath: source })
    const updated = await store.update({ id: item.id, displayName: '中文分镜助手', note: '仅用于视频分镜' })
    expect(updated.displayName).toBe('中文分镜助手')
    expect(updated.note).toBe('仅用于视频分镜')
    expect(updated.description).toBe('分镜规划')
  })
})
