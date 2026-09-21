import { describe, expect, it } from 'vitest'
import type { ProjectItemMetadata } from '../../src/shared/contracts/library'

const DOCUMENT_EXTENSIONS = new Set([
  '.md', '.markdown', '.txt', '.text', '.json', '.pdf', '.doc', '.docx',
])

type DocumentCategoryFilter = 'all' | 'markdown' | 'text' | 'data' | 'other'

function matchesFilter(item: ProjectItemMetadata, filter: DocumentCategoryFilter): boolean {
  const ext = item.extension?.toLowerCase() ?? ''
  if (filter === 'markdown') return ext === '.md' || ext === '.markdown'
  if (filter === 'text') return ext === '.txt' || ext === '.text'
  if (filter === 'data') return ext === '.json'
  if (filter === 'other') return ['.pdf', '.doc', '.docx'].includes(ext)
  return true
}

function filterDocuments(
  items: ProjectItemMetadata[],
  filter: DocumentCategoryFilter,
  search: string
): ProjectItemMetadata[] {
  const query = search.trim().toLowerCase()
  return items.filter((item) => {
    if (item.isDirectory) return false
    if (!DOCUMENT_EXTENSIONS.has(item.extension?.toLowerCase() ?? '')) return false
    if (!matchesFilter(item, filter)) return false
    if (query) {
      const nameMatch = item.name.toLowerCase().includes(query)
      const pathMatch = item.relativePath.toLowerCase().includes(query)
      if (!nameMatch && !pathMatch) return false
    }
    return true
  })
}

describe('ProjectDocumentsPage filter & search logic', () => {
  const testItems: ProjectItemMetadata[] = [
    { relativePath: 'documents/script.md', name: 'script.md', kind: 'document', extension: '.md', isDirectory: false, byteLength: 2048 },
    { relativePath: 'documents/outline.markdown', name: 'outline.markdown', kind: 'document', extension: '.markdown', isDirectory: false, byteLength: 1024 },
    { relativePath: 'documents/notes.txt', name: 'notes.txt', kind: 'document', extension: '.txt', isDirectory: false, byteLength: 512 },
    { relativePath: 'documents/character-data.json', name: 'character-data.json', kind: 'document', extension: '.json', isDirectory: false, byteLength: 4096 },
    { relativePath: 'documents/storyboard.pdf', name: 'storyboard.pdf', kind: 'document', extension: '.pdf', isDirectory: false, byteLength: 1048576 },
    { relativePath: 'documents/subfolder', name: 'subfolder', kind: 'document', isDirectory: true },
    { relativePath: 'assets/hero.png', name: 'hero.png', kind: 'asset', extension: '.png', isDirectory: false, byteLength: 204800 },
  ]

  it('filters out directories and non-document extensions', () => {
    const docs = filterDocuments(testItems, 'all', '')
    expect(docs).toHaveLength(5)
    expect(docs.map((d) => d.name)).toEqual([
      'script.md',
      'outline.markdown',
      'notes.txt',
      'character-data.json',
      'storyboard.pdf',
    ])
  })

  it('filters by category tabs correctly', () => {
    const md = filterDocuments(testItems, 'markdown', '')
    expect(md.map((d) => d.name)).toEqual(['script.md', 'outline.markdown'])

    const txt = filterDocuments(testItems, 'text', '')
    expect(txt.map((d) => d.name)).toEqual(['notes.txt'])

    const json = filterDocuments(testItems, 'data', '')
    expect(json.map((d) => d.name)).toEqual(['character-data.json'])

    const other = filterDocuments(testItems, 'other', '')
    expect(other.map((d) => d.name)).toEqual(['storyboard.pdf'])
  })

  it('searches by name and relative path', () => {
    const searchResult = filterDocuments(testItems, 'all', 'character')
    expect(searchResult.map((d) => d.name)).toEqual(['character-data.json'])

    const searchPath = filterDocuments(testItems, 'all', 'documents/script')
    expect(searchPath.map((d) => d.name)).toEqual(['script.md'])
  })
})
