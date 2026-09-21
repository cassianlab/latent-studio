import { describe, expect, it, afterEach, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const electronMock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  return {
    handlers,
    electron: {
      dialog: {
        showOpenDialog: vi.fn(),
      },
      ipcMain: {
        handle: (channel: string, listener: (...args: unknown[]) => unknown) => { handlers.set(channel, listener) },
        removeHandler: (channel: string) => { handlers.delete(channel) },
      },
    },
  }
})

vi.mock('electron', () => electronMock.electron)

const { registerContextIpc } = await import('../../src/main/context/ipc')
const { registerModelsIpc } = await import('../../src/main/models/ipc')

function handler(channel: string): (...args: unknown[]) => unknown {
  const value = electronMock.handlers.get(channel)
  if (!value) throw new Error(`Missing handler: ${channel}`)
  return value
}

afterEach(() => electronMock.handlers.clear())

describe('context IPC', () => {
  it('requires an active project and reads only through the resolver', async () => {
    let root: string | undefined
    const unregister = registerContextIpc({ getProjectRoot: () => root })
    await expect(handler('context:read-project-file')({}, { filePath: 'notes.md' })).rejects.toMatchObject({ code: 'no-active-project' })
    root = await mkdtemp(join(tmpdir(), 'latent-studio-context-ipc-'))
    try {
      await writeFile(join(root, 'notes.md'), '# 已读取', 'utf8')
      await expect(handler('context:read-project-file')({}, { filePath: 'notes.md' })).resolves.toMatchObject({ text: '# 已读取' })
    } finally {
      unregister()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reads multiple explicitly selected attachments through a narrow IPC command', async () => {
    const root = await mkdtemp(join(tmpdir(), 'latent-studio-attachments-ipc-'))
    const first = join(root, 'first.md')
    const second = join(root, 'second.txt')
    await writeFile(first, '# 一', 'utf8')
    await writeFile(second, '二', 'utf8')
    electronMock.electron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [first, second] })
    const unregister = registerContextIpc({ window: {} as BrowserWindow, getProjectRoot: () => undefined })
    try {
      await expect(handler('context:choose-and-read-attachments')({})).resolves.toEqual([
        expect.objectContaining({ summary: expect.objectContaining({ relativePath: 'first.md' }), text: '# 一' }),
        expect.objectContaining({ summary: expect.objectContaining({ relativePath: 'second.txt' }), text: '二' }),
      ])
    } finally {
      unregister()
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('model IPC', () => {
  it('registers only the narrow model commands and removes them', () => {
    const unregister = registerModelsIpc({ store: {} as never })
    expect([...electronMock.handlers.keys()]).toEqual(expect.arrayContaining([
      'models:discover', 'models:generate', 'models:start-stream', 'models:stop-stream',
    ]))
    unregister()
    expect(electronMock.handlers.size).toBe(0)
  })
})
