import { MAX_REFERENCE_IMAGES, type ReferenceAsset } from '../../shared/reference-images'

let selected: ReferenceAsset[] = []
const listeners = new Set<(assets: ReferenceAsset[]) => void>()

export function publishSelectedAssets(assets: ReferenceAsset[]): void {
  selected = [...assets].slice(0, MAX_REFERENCE_IMAGES)
  for (const listener of listeners) listener([...selected])
}

export function mergeReferenceAssets(current: readonly ReferenceAsset[], incoming: readonly ReferenceAsset[]): { assets: ReferenceAsset[]; rejected: number } {
  const byId = new Map<string, ReferenceAsset>()
  for (const item of [...current, ...incoming]) if (!byId.has(item.id)) byId.set(item.id, item)
  const values = [...byId.values()]
  return { assets: values.slice(0, MAX_REFERENCE_IMAGES), rejected: Math.max(0, values.length - MAX_REFERENCE_IMAGES) }
}

export function removeReferenceAsset(current: readonly ReferenceAsset[], id: string): ReferenceAsset[] {
  return current.filter((item) => item.id !== id)
}

export function toggleReferenceAssetSelection(current: readonly ReferenceAsset[], item: ReferenceAsset): ReferenceAsset[] {
  return current.some((selectedItem) => selectedItem.id === item.id)
    ? removeReferenceAsset(current, item.id)
    : mergeReferenceAssets(current, [item]).assets
}

export function getSelectedAssets(): ReferenceAsset[] { return [...selected] }

export function subscribeSelectedAssets(listener: (assets: ReferenceAsset[]) => void): () => void {
  listeners.add(listener)
  listener([...selected])
  return () => listeners.delete(listener)
}
