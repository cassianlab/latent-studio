export interface PromptLibraryCache {
  clearCache(): Promise<void>
}

export async function releasePromptLibraryResources(cache?: PromptLibraryCache): Promise<void> {
  await cache?.clearCache()
}
