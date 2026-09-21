import type { ProjectAsset } from '../../shared/contracts/library'

export function isGeneratedAsset(asset: ProjectAsset): boolean {
  return (
    asset.origin === 'generated' ||
    asset.category === 'output' ||
    asset.relativePath.startsWith('outputs/') ||
    asset.relativePath.includes('/outputs/')
  )
}

export function getRangeSelectedIds(
  items: readonly ProjectAsset[],
  anchorId: string | null,
  targetId: string,
  currentSelectedIds: ReadonlySet<string>,
): Set<string> {
  const next = new Set(currentSelectedIds)
  if (!anchorId || anchorId === targetId) {
    next.add(targetId)
    return next
  }

  const anchorIndex = items.findIndex((item) => item.id === anchorId)
  const targetIndex = items.findIndex((item) => item.id === targetId)

  if (anchorIndex === -1 || targetIndex === -1) {
    next.add(targetId)
    return next
  }

  const start = Math.min(anchorIndex, targetIndex)
  const end = Math.max(anchorIndex, targetIndex)

  for (let i = start; i <= end; i++) {
    next.add(items[i].id)
  }

  return next
}

export interface BatchSummary {
  total: number
  generated: number
  imported: number
  totalBytes: number
}

export function summarizeBatchAssets(assets: readonly ProjectAsset[]): BatchSummary {
  let generated = 0
  let imported = 0
  let totalBytes = 0

  for (const asset of assets) {
    totalBytes += asset.byteLength || 0
    if (isGeneratedAsset(asset)) {
      generated++
    } else {
      imported++
    }
  }

  return {
    total: assets.length,
    generated,
    imported,
    totalBytes,
  }
}

export function createMockAsset(item: { id: string | number; name: string; role?: string }, index: number): ProjectAsset {
  return {
    id: `mock-${item.id}`,
    name: item.name,
    relativePath: `assets/mock-${index + 1}.png`,
    sourceName: item.name,
    category: item.role === '角色' ? 'character' : item.role === '场景' ? 'scene' : 'prop',
    mimeType: 'image/png',
    extension: '.png',
    byteLength: 0,
    modifiedAt: '',
    importedAt: '',
    previewable: true,
  }
}

