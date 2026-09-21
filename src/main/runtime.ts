import { join } from 'node:path'
import { openGlobalDatabase, type GlobalDatabase, type GlobalDatabaseFactory } from './config'
import { createElectronSafeStoragePort, SafeStorageCredentialStore, type SafeStoragePort } from './credentials'
import { createErrorLogger, type ErrorLogger } from './logging'

export interface MainRuntime {
  readonly globalDatabase: GlobalDatabase
  readonly errorLogger: ErrorLogger
  readonly diagnosticLogger: ErrorLogger
  readonly credentialStore: SafeStorageCredentialStore
  close(): void
}

export interface MainRuntimeOptions {
  databaseFactory?: GlobalDatabaseFactory
  safeStorage?: SafeStoragePort
}

/** Creates process-owned services after Electron has selected its user-data directory. */
export async function createMainRuntime(userDataPath: string, options: MainRuntimeOptions = {}): Promise<MainRuntime> {
  const globalDatabase = await openGlobalDatabase(join(userDataPath, 'global.db'), options.databaseFactory)
  try {
    const safeStorage = options.safeStorage ?? await createElectronSafeStoragePort()
    const errorLogger = createErrorLogger(join(userDataPath, 'logs', 'errors.jsonl'))
    const diagnosticLogger = createErrorLogger(join(userDataPath, 'logs', 'diagnostics.jsonl'))
    await Promise.all([errorLogger.readRecent(), diagnosticLogger.readRecent()])
    const credentialStore = new SafeStorageCredentialStore(safeStorage)

    return {
      globalDatabase,
      errorLogger,
      diagnosticLogger,
      credentialStore,
      close: () => globalDatabase.close?.(),
    }
  } catch (error) {
    globalDatabase.close?.()
    throw error
  }
}
