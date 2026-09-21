import { describe, expect, it } from 'vitest'
import { createMainRuntime } from '../../src/main/runtime'
import type { GlobalDatabase } from '../../src/main/config'
import type { SafeStoragePort } from '../../src/main/credentials'

function fakeSafeStorage(): SafeStoragePort {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value),
    decryptString: (value) => value.toString(),
  }
}

describe('main runtime', () => {
  it('initializes process-owned services under the user-data directory', async () => {
    const calls: string[] = []
    const database: GlobalDatabase = { exec: (sql) => calls.push(sql), run: () => undefined, all: () => [{ name: 'kind' }], close: () => calls.push('close') }
    const runtime = await createMainRuntime('/tmp/latent-studio-user-data', {
      databaseFactory: async (path) => {
        expect(path).toBe('/tmp/latent-studio-user-data/global.db')
        return database
      },
      safeStorage: fakeSafeStorage(),
    })

    expect(calls[0]).toContain('CREATE TABLE IF NOT EXISTS settings')
    expect(runtime.credentialStore.encryptApiKey('key')).not.toContain('key')
    runtime.close()
    expect(calls).toContain('close')
  })
})
