export type SkillScope = 'global' | 'project'
export type SkillSource = 'link' | 'install' | 'builtin'
export type SkillTrustMode = 'controlled' | 'full'
export type SkillScriptRuntime = 'node' | 'python' | 'shell'
export type SkillPermission = 'filesystem-read' | 'filesystem-write' | 'network' | 'process'

export interface SkillInstallation {
  id: string
  name: string
  displayName: string
  description?: string
  note?: string
  rootPath: string
  scope: SkillScope
  source: SkillSource
  enabled: boolean
  trusted: boolean
  trustMode: SkillTrustMode
  contentHash: string
  updatedAt: string
  /** Declared by SKILL.md; omitted only for legacy installations. */
  permissions?: SkillPermission[]
  /** Declared by SKILL.md; omitted only for legacy installations. */
  runtimes?: SkillScriptRuntime[]
  /** Project-scoped Skills require an explicit grant before Agent execution. */
  projectAuthorized?: boolean
  /** Legacy routing hints retained when rescanning existing installations. */
  triggerKeywords?: string[]
  excludeKeywords?: string[]
  /** Bundled Skills are hidden through an index tombstone instead of deleting app files. */
  hidden?: boolean
}

export interface LinkSkillInput {
  sourcePath: string
  displayName?: string
  note?: string
  scope?: SkillScope
}

export interface InstallSkillInput {
  sourcePath: string
  displayName?: string
  note?: string
  scope?: SkillScope
}

export interface UpdateSkillInput {
  id: string
  displayName?: string
  note?: string
  enabled?: boolean
  trusted?: boolean
  trustMode?: SkillTrustMode
  projectAuthorized?: boolean
}

export interface SkillApi {
  list(): Promise<SkillInstallation[]>
  link(input: LinkSkillInput): Promise<SkillInstallation>
  install(input: InstallSkillInput): Promise<SkillInstallation>
  update(input: UpdateSkillInput): Promise<SkillInstallation>
  remove(id: string): Promise<void>
  rescan(id: string): Promise<SkillInstallation>
}
