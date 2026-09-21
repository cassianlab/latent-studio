import { describe, expect, it } from 'vitest'
import { CredentialError, SafeStorageCredentialStore, type SafeStoragePort } from '../../src/main/credentials/safe-storage'

function fakeSafeStorage(available = true): SafeStoragePort {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value) => Buffer.from(`encrypted:${value}`),
    decryptString: (value) => value.toString().replace(/^encrypted:/, ''),
  }
}

describe('safe storage credentials', () => {
  it('round-trips an API key without exposing it in the contract', () => {
    const store = new SafeStorageCredentialStore(fakeSafeStorage())
    const encrypted = store.encryptApiKey(' secret-key ')
    expect(encrypted).not.toContain('secret-key')
    expect(store.decryptApiKey(encrypted)).toBe('secret-key')
  })

  it('reports an explicit error when encryption is unavailable', () => {
    const store = new SafeStorageCredentialStore(fakeSafeStorage(false))
    expect(() => store.encryptApiKey('secret')).toThrowError(CredentialError)
    expect(() => store.encryptApiKey('secret')).toThrowError(expect.objectContaining({ code: 'encryption-unavailable' }))
  })

  it('rejects empty and malformed stored keys', () => {
    const store = new SafeStorageCredentialStore(fakeSafeStorage())
    expect(() => store.encryptApiKey('   ')).toThrowError(expect.objectContaining({ code: 'invalid-api-key' }))
    expect(() => store.decryptApiKey('   ')).toThrowError(expect.objectContaining({ code: 'decrypt-failed' }))
    expect(() => store.decryptApiKey('not-base64')).toThrowError(expect.objectContaining({ code: 'decrypt-failed' }))
  })
})
