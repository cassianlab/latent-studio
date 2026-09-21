import { afterEach, describe, expect, it } from 'vitest'
import { getProjectApi, projectError } from '../../src/renderer/start/project-api'

const originalWindow = globalThis.window

afterEach(() => {
  if (originalWindow) globalThis.window = originalWindow
  else Reflect.deleteProperty(globalThis, 'window')
})

describe('start project api', () => {
  it('falls back to an in-memory adapter without preload', async () => {
    Reflect.deleteProperty(globalThis, 'window')
    const api = getProjectApi()
    const projects = await api.listRecent()

    expect(projects.length).toBeGreaterThan(0)
    await expect(api.create({ name: '浏览器预览' })).resolves.toMatchObject({ name: '浏览器预览' })
  })

  it('uses the complete host api when preload is available', async () => {
    const host = {
      listRecent: async () => [],
      create: async () => null,
      open: async () => null,
      relocate: async () => null,
    }
    globalThis.window = { latentStudio: { projects: host } } as typeof window

    expect(getProjectApi()).toBe(host)
  })
})

describe('projectError', () => {
  it('preserves moved-project information for the relocation UI', () => {
    const project = { id: 'p1', name: 'Moved', path: '/old', displayPath: '~/old', openedAt: new Date().toISOString() }
    expect(projectError({ code: 'project-moved', message: '项目已移动' }, project)).toEqual({ code: 'project-moved', message: '项目已移动', project })
  })

  it('normalizes unknown failures', () => {
    expect(projectError(new Error('boom'))).toMatchObject({ code: 'unknown', message: 'boom' })
  })
})
