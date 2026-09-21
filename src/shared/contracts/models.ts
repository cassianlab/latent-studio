import type { ProviderType } from './settings'

/** Capabilities that can be explicitly confirmed for an enabled model. */
export type ModelCapability =
  | 'streaming'
  | 'tool-calls'
  | 'vision'
  | 'native-search'
  | 'reference-image'
  | 'multi-reference'
  | 'annotation-edit'

export type ModelCapabilitySource = 'unconfirmed' | 'adapter' | 'user'

/**
 * A provider model returned by discovery. Candidates are never enabled by
 * discovery; capabilities remain unconfirmed unless an adapter explicitly
 * declares them or the user confirms them.
 */
export interface ModelDiscoveryCandidate {
  id: string
  displayName: string
  description?: string
  providerType: ProviderType
  /** Provider resource name, when it differs from the model id (Gemini). */
  providerModelName?: string
  capabilities: readonly ModelCapability[]
  capabilitySource: ModelCapabilitySource
}

export type ModelDiscoveryProtocol = 'openai.models' | 'anthropic.models' | 'gemini.models'

export interface ModelDiscoveryResult {
  providerType: ProviderType
  protocol: ModelDiscoveryProtocol
  models: ModelDiscoveryCandidate[]
  /** Provider pagination token, when another page can be requested. */
  nextPageToken?: string
  fetchedAt: string
}
