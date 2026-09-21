export interface SafeStoragePort {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

export type CredentialErrorCode = 'encryption-unavailable' | 'decrypt-failed' | 'invalid-api-key'

export class CredentialError extends Error {
  constructor(public readonly code: CredentialErrorCode, message: string) {
    super(message)
    this.name = 'CredentialError'
  }
}

export interface EncryptedCredentialStore {
  encryptApiKey(apiKey: string): string
  decryptApiKey(encryptedApiKey: string): string
}

export class SafeStorageCredentialStore implements EncryptedCredentialStore {
  constructor(private readonly safeStorage: SafeStoragePort) {}

  encryptApiKey(apiKey: string): string {
    const value = apiKey.trim()
    if (!value) throw new CredentialError('invalid-api-key', 'API key must not be empty')
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new CredentialError('encryption-unavailable', 'Secure credential encryption is unavailable')
    }
    return this.safeStorage.encryptString(value).toString('base64')
  }

  decryptApiKey(encryptedApiKey: string): string {
    const encoded = encryptedApiKey.trim()
    if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
      throw new CredentialError('decrypt-failed', 'Stored API key could not be decrypted')
    }
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new CredentialError('encryption-unavailable', 'Secure credential encryption is unavailable')
    }
    try {
      const value = this.safeStorage.decryptString(Buffer.from(encoded, 'base64')).trim()
      if (!value) throw new Error('empty decrypted value')
      return value
    } catch (error) {
      throw new CredentialError('decrypt-failed', 'Stored API key could not be decrypted')
    }
  }
}

export function encryptApiKey(apiKey: string, safeStorage: SafeStoragePort): string {
  return new SafeStorageCredentialStore(safeStorage).encryptApiKey(apiKey)
}

export function decryptApiKey(encryptedApiKey: string, safeStorage: SafeStoragePort): string {
  return new SafeStorageCredentialStore(safeStorage).decryptApiKey(encryptedApiKey)
}

/** Adapter kept at the Electron boundary; tests inject SafeStoragePort instead. */
export async function createElectronSafeStoragePort(): Promise<SafeStoragePort> {
  const electron = await import('electron')
  return electron.safeStorage
}
