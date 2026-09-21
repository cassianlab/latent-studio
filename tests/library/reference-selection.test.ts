import { describe, expect, it } from 'vitest'
import type { ProjectAsset } from '../../src/shared/contracts/library'
import { mergeReferenceAssets, removeReferenceAsset, toggleReferenceAssetSelection } from '../../src/renderer/library/asset-selection'
import { createTemporarySketchReference, referenceAssetToImageReference } from '../../src/shared/reference-images'

function asset(id: string): ProjectAsset {
  return { id, name: `${id}.png`, relativePath: `assets/${id}.png`, sourceName: `${id}.png`, category: 'reference', mimeType: 'image/png', byteLength: 10, modifiedAt: '', importedAt: '', previewable: true }
}

describe('reference asset selection', () => {
  it('merges mixed sources without duplicates and caps the result', () => {
    const current = [asset('existing')]
    const incoming = Array.from({ length: 9 }, (_, index) => asset(index === 0 ? 'existing' : `new-${index}`))
    const result = mergeReferenceAssets(current, incoming)

    expect(result.assets).toHaveLength(8)
    expect(result.assets.filter((item) => item.id === 'existing')).toHaveLength(1)
    expect(result.rejected).toBe(1)
  })

  it('removes one attachment without changing the others', () => {
    expect(removeReferenceAsset([asset('a'), asset('b')], 'a').map((item) => item.id)).toEqual(['b'])
  })

  it('keeps selections made on earlier search result pages', () => {
    const firstSearchSelection = [asset('first')]
    const afterSecondSearch = toggleReferenceAssetSelection(firstSearchSelection, asset('second'))

    expect(afterSecondSearch.map((item) => item.id)).toEqual(['first', 'second'])
    expect(toggleReferenceAssetSelection(afterSecondSearch, asset('first')).map((item) => item.id)).toEqual(['second'])
  })

  it('keeps a sketch in memory and submits it as image data', () => {
    const dataUrl = 'data:image/png;base64,aGVsbG8='
    const reference = createTemporarySketchReference({
      id: 'sketch-1',
      name: '构图草图',
      dataUrl,
      createdAt: '2026-09-19T10:00:00.000Z',
    })

    expect(reference).toMatchObject({
      id: 'sketch-1',
      name: '构图草图.png',
      relativePath: '',
      transientDataUrl: dataUrl,
    })
    expect(referenceAssetToImageReference(reference)).toEqual({
      type: 'data',
      data: dataUrl,
      filename: '构图草图.png',
      mimeType: 'image/png',
    })
  })

  it('keeps library assets as file references', () => {
    expect(referenceAssetToImageReference(asset('library'))).toEqual({
      type: 'file',
      path: 'assets/library.png',
      filename: 'library.png',
      mimeType: 'image/png',
    })
  })
})
