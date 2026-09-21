import { promises as fs } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { InMemoryRecentProjectsStore } from '../../src/main/projects/recent'

const electronMock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const choices: string[] = []
  return {
    handlers,
    choices,
    electron: {
      app: { getPath: () => '/tmp/latent-studio-test-user-data' },
      dialog: {
        showOpenDialog: async () => {
          const path = choices.shift()
          return path ? { canceled: false, filePaths: [path] } : { canceled: true, filePaths: [] }
        },
      },
      ipcMain: {
        handle: (channel: string, listener: (...args: unknown[]) => unknown) => { handlers.set(channel, listener) },
        removeHandler: (channel: string) => { handlers.delete(channel) },
      },
    },
  }
})

vi.mock('electron', () => electronMock.electron)

const { registerProjectIpc } = await import('../../src/main/projects/ipc')
const { registerSettingsIpc } = await import('../../src/main/settings/ipc')

const roots: string[] = []

afterEach(async () => {
  electronMock.handlers.clear()
  electronMock.choices.splice(0)
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'latent-studio-ipc-'))
  roots.push(root)
  return root
}

function handler(channel: string): (...args: unknown[]) => unknown {
  const value = electronMock.handlers.get(channel)
  if (!value) throw new Error(`Missing handler: ${channel}`)
  return value
}

describe('project IPC', () => {
  it('creates, lists, opens, relocates, and unregisters handlers', async () => {
    const root = await makeRoot()
    const recent = new InMemoryRecentProjectsStore()
    const unregister = registerProjectIpc({ window: {} as BrowserWindow, recent })

    electronMock.choices.push(root)
    const created = await handler('projects:create')({}, { name: 'IPC 项目' }) as { id: string; path: string }
    expect(created.path).toBe(root)

    const listed = await handler('projects:list-recent')({}) as Array<{ id: string; available?: boolean }>
    expect(listed).toEqual([expect.objectContaining({ id: created.id, available: true })])

    electronMock.choices.push(root)
    const opened = await handler('projects:open')({}, { projectRoot: '/tmp/renderer-supplied-path' }) as { id: string }
    expect(opened.id).toBe(created.id)

    electronMock.choices.push(root)
    const relocated = await handler('projects:relocate')({}, { id: created.id }) as { id: string }
    expect(relocated.id).toBe(created.id)

    unregister()
    expect(electronMock.handlers.size).toBe(0)
  })

  it('marks missing recent paths unavailable without exposing filesystem handles', async () => {
    const root = await makeRoot()
    const recent = new InMemoryRecentProjectsStore()
    await recent.add({ id: 'missing', name: 'Missing', path: join(root, 'gone'), openedAt: new Date().toISOString() })
    const unregister = registerProjectIpc({ window: {} as BrowserWindow, recent })

    const listed = await handler('projects:list-recent')({}) as Array<Record<string, unknown>>
    expect(listed[0]).toMatchObject({ id: 'missing', available: false })
    expect(listed[0]).not.toHaveProperty('database')
    unregister()
    await fs.rm(root, { recursive: true, force: true })
  })

  it('waits for project transition work before exposing the opened project', async () => {
    const root = await makeRoot()
    const recent = new InMemoryRecentProjectsStore()
    let release: (() => void) | undefined
    const onProjectOpened = vi.fn(() => new Promise<void>((resolve) => { release = resolve }))
    const unregister = registerProjectIpc({ window: {} as BrowserWindow, recent, onProjectOpened })

    electronMock.choices.push(root)
    const opening = handler('projects:create')({}, { name: '持久化切换' }) as Promise<{ id: string }>
    await vi.waitFor(() => expect(onProjectOpened).toHaveBeenCalledOnce())

    let settled = false
    void opening.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)

    release?.()
    await expect(opening).resolves.toMatchObject({ id: expect.any(String) })
    unregister()
  })
})

describe('settings IPC', () => {
  it('registers only typed settings commands and removes them cleanly', async () => {
    const settings = {
      get: () => ({ connections: [], models: [] }),
      saveConnection: (input: unknown) => ({ id: 'c1', name: (input as { name: string }).name, providerType: 'openai', baseUrl: 'https://example.com', hasApiKey: true, maxConcurrency: 1, createdAt: '', updatedAt: '' }),
      deleteConnection: () => undefined,
      saveModel: () => ({ id: 'm1', connectionId: 'c1', modelId: 'gpt', name: 'GPT', kind: 'text', capabilities: [], createdAt: '', updatedAt: '' }),
      deleteModel: () => undefined,
      setDefaults: () => ({ connections: [], models: [] }),
    }
    const unregister = registerSettingsIpc({ store: settings as never })
    expect(electronMock.handlers.has('settings:get')).toBe(true)
    await expect(handler('settings:save-connection')({}, { name: '测试' })).resolves.toMatchObject({ id: 'c1' })
    unregister()
    expect([...electronMock.handlers.keys()].some((channel) => channel.startsWith('settings:'))).toBe(false)
  })
})
