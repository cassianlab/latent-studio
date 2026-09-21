import type { LibraryScope, PromptAsset, PromptAssetKind, PromptCatalogSource } from '../../shared/contracts/library'
import { promptCategoryLabel } from '../../shared/prompt-categories'

export type PromptSourceFilter = 'all' | 'mine' | 'open-source' | PromptCatalogSource

export interface PromptAssetFilters {
  scope: 'all' | LibraryScope
  source: PromptSourceFilter
  kind: 'all' | PromptAssetKind
  category: 'all' | string
  favoriteOnly: boolean
}

export function filterPromptAssets(items: PromptAsset[], filters: PromptAssetFilters): PromptAsset[] {
  return items.filter((item) => {
    if (filters.scope !== 'all' && item.scope !== filters.scope) return false
    if (filters.source === 'open-source' && item.source !== 'import') return false
    if (filters.source === 'mine' && item.source === 'import') return false
    if (filters.source !== 'all' && filters.source !== 'mine' && filters.source !== 'open-source' && !item.tags.includes(filters.source)) return false
    if (filters.kind !== 'all' && item.kind !== filters.kind) return false
    if (filters.category !== 'all' && promptCategoryLabel(item.category) !== filters.category) return false
    if (filters.favoriteOnly && !item.favorite) return false
    return true
  })
}
