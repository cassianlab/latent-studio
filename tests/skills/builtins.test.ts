import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SkillStore } from '../../src/main/skills/store'
import { runSkill } from '../../src/main/agent/skill-runner'

const root = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(root, '..', '..')
const builtinsRoot = join(repoRoot, 'skills', 'builtin')

function frontmatter(text: string): string {
  const match = text.match(/^---\s*\n([\s\S]*?)\n---/)
  return match?.[1] ?? ''
}

describe('bundled Skill provenance', () => {
  it('keeps every built-in Skill traceable to the audited canvas commit', async () => {
    const names = (await readdir(builtinsRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()

    expect(names).toEqual(expect.arrayContaining(['creative-brief-planner', 'image-prompt-optimizer', 'shot-planner']))
    for (const name of names) {
      const metadata = frontmatter(await readFile(join(builtinsRoot, name, 'SKILL.md'), 'utf8'))
      if (name === 'prompt-template-library') {
        expect(metadata).toContain('source: legacy 生图/src/shared/prompt-templates.ts')
        expect(metadata).toContain('license: 未声明')
        expect(metadata).toContain('adaptation:')
        continue
      }
      expect(metadata).toContain('source: https://github.com/ljquan/opentu@3daf3100d56cb7aa20ffb4d05784faf4c68903fd')
      expect(metadata).toContain('license: MIT')
      expect(metadata).toContain('adaptation:')
    }
  })

  it('keeps the bundled index deterministic and exposes the migrated prompt Skill', async () => {
    const manifest = JSON.parse(await readFile(join(repoRoot, 'skills', 'index.json'), 'utf8')) as { version: number; skills: Array<{ name: string; path: string }> }
    expect(manifest.version).toBe(1)
    expect(manifest.skills.map((item) => item.name)).toEqual([...manifest.skills].map((item) => item.name).sort())
    const migrated = manifest.skills.find((item) => item.name === 'prompt-template-library')
    expect(migrated?.path).toBe('builtin/prompt-template-library')
    const skillRoot = join(builtinsRoot, 'prompt-template-library')
    const skillIndex = JSON.parse(await readFile(join(skillRoot, 'index.json'), 'utf8')) as { templates: Array<{ id: string; prompt: string; variables: string[] }> }
    expect(skillIndex.templates.map((item) => item.id)).toEqual([...skillIndex.templates].map((item) => item.id).sort())
    expect(new Set(skillIndex.templates.map((item) => item.id)).size).toBe(skillIndex.templates.length)
    expect(skillIndex.templates.every((item) => item.variables.every((key) => item.prompt.includes(`{{${key}}}`)))).toBe(true)
    expect(skillIndex.templates.some((item) => item.prompt.includes('/Users/'))).toBe(false)
    const skillManifest = JSON.parse(await readFile(join(skillRoot, 'manifest.json'), 'utf8')) as { resources: string[] }
    for (const resource of skillManifest.resources) await expect(readFile(join(skillRoot, resource), 'utf8')).resolves.toBeTruthy()
  })

  it('discovers and runs the migrated prompt Skill through the Agent skill path', async () => {
    const store = new SkillStore({ userDataPath: join(repoRoot, 'tmp-test-user-data'), getProjectRoot: () => undefined, builtInRoot: builtinsRoot })
    const item = (await store.list()).find((entry) => entry.name === 'prompt-template-library')
    expect(item).toMatchObject({ id: 'builtin:prompt-template-library', source: 'builtin', trusted: true, enabled: true })
    const script = await store.resolveScript('builtin:prompt-template-library', 'scripts/render-template.js')
    const result = await runSkill({ run: script, args: ['--render', 'photo-cinematic-35mm', 'scene_storyline=雨夜车站'] })
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({ templateId: 'photo-cinematic-35mm', missingVariables: ['ambient_light_source'] })
  })

  it('records why unlicensed legacy content is reference-only', async () => {
    const migration = await readFile(join(repoRoot, 'docs', 'migrations', 'canvas-content.md'), 'utf8')
    expect(migration).toContain('未发现根目录许可证文件')
    expect(migration).toContain('有意不迁移')
    expect(migration).toContain('3daf3100d56cb7aa20ffb4d05784faf4c68903fd')
  })
})
