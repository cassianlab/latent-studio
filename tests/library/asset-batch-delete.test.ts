import { describe, expect, it } from 'vitest'
import type { ProjectAsset } from '../../src/shared/contracts/library'
import {
  createMockAsset,
  getRangeSelectedIds,
  isGeneratedAsset,
  summarizeBatchAssets,
} from '../../src/renderer/library/asset-batch-utils'

describe('asset-batch-utils', () => {
  const assetGenerated1: ProjectAsset = {
    id: 'gen-1',
    name: 'shot-001.png',
    relativePath: 'outputs/shot-001.png',
    sourceName: 'shot-001.png',
    category: 'output',
    origin: 'generated',
    mimeType: 'image/png',
    extension: '.png',
    byteLength: 2048000,
    modifiedAt: '2026-09-17T10:00:00Z',
    importedAt: '2026-09-17T10:00:00Z',
    previewable: true,
  }

  const assetGenerated2: ProjectAsset = {
    id: 'gen-2',
    name: 'shot-002.png',
    relativePath: 'outputs/shot-002.png',
    sourceName: 'shot-002.png',
    category: 'scene',
    origin: 'generated',
    mimeType: 'image/png',
    extension: '.png',
    byteLength: 1024000,
    modifiedAt: '2026-09-17T10:05:00Z',
    importedAt: '2026-09-17T10:05:00Z',
    previewable: true,
  }

  const assetImported1: ProjectAsset = {
    id: 'imp-1',
    name: 'character-concept.png',
    relativePath: 'assets/characters/hero.png',
    sourceName: 'hero.png',
    category: 'character',
    origin: 'imported',
    mimeType: 'image/png',
    extension: '.png',
    byteLength: 512000,
    modifiedAt: '2026-09-16T12:00:00Z',
    importedAt: '2026-09-16T12:00:00Z',
    previewable: true,
  }

  const assetImported2: ProjectAsset = {
    id: 'imp-2',
    name: 'prop-sword.png',
    relativePath: 'assets/props/sword.png',
    sourceName: 'sword.png',
    category: 'prop',
    origin: 'imported',
    mimeType: 'image/png',
    extension: '.png',
    byteLength: 256000,
    modifiedAt: '2026-09-16T12:30:00Z',
    importedAt: '2026-09-16T12:30:00Z',
    previewable: true,
  }

  describe('isGeneratedAsset', () => {
    it('identifies asset with origin: generated as generated', () => {
      expect(isGeneratedAsset(assetGenerated1)).toBe(true)
      expect(isGeneratedAsset(assetGenerated2)).toBe(true)
    })

    it('identifies asset with relativePath in outputs/ as generated', () => {
      const asset: ProjectAsset = {
        ...assetImported1,
        relativePath: 'outputs/test.png',
        origin: undefined,
      }
      expect(isGeneratedAsset(asset)).toBe(true)
    })

    it('identifies external imported asset as not generated', () => {
      expect(isGeneratedAsset(assetImported1)).toBe(false)
      expect(isGeneratedAsset(assetImported2)).toBe(false)
    })
  })

  describe('summarizeBatchAssets', () => {
    it('accurately computes total counts, origin breakdowns, and byte sizes', () => {
      const all = [assetGenerated1, assetGenerated2, assetImported1, assetImported2]
      const summary = summarizeBatchAssets(all)

      expect(summary.total).toBe(4)
      expect(summary.generated).toBe(2)
      expect(summary.imported).toBe(2)
      expect(summary.totalBytes).toBe(2048000 + 1024000 + 512000 + 256000)
    })

    it('handles empty batch correctly', () => {
      const summary = summarizeBatchAssets([])
      expect(summary.total).toBe(0)
      expect(summary.generated).toBe(0)
      expect(summary.imported).toBe(0)
      expect(summary.totalBytes).toBe(0)
    })
  })

  describe('getRangeSelectedIds', () => {
    const list = [assetGenerated1, assetGenerated2, assetImported1, assetImported2]

    it('selects single item when anchor is null', () => {
      const result = getRangeSelectedIds(list, null, 'gen-2', new Set())
      expect(Array.from(result)).toEqual(['gen-2'])
    })

    it('selects continuous range forward from anchor to target', () => {
      const result = getRangeSelectedIds(list, 'gen-1', 'imp-1', new Set())
      expect(Array.from(result)).toEqual(['gen-1', 'gen-2', 'imp-1'])
    })

    it('selects continuous range backward from target to anchor', () => {
      const result = getRangeSelectedIds(list, 'imp-2', 'gen-2', new Set())
      expect(Array.from(result)).toEqual(['gen-2', 'imp-1', 'imp-2'])
    })

    it('preserves existing selections outside the newly selected range', () => {
      const existing = new Set(['gen-1'])
      const result = getRangeSelectedIds(list, 'imp-1', 'imp-2', existing)
      expect(Array.from(result)).toContain('gen-1')
      expect(Array.from(result)).toContain('imp-1')
      expect(Array.from(result)).toContain('imp-2')
    })
  })

  describe('createMockAsset', () => {
    it('creates valid mock ProjectAsset with appropriate fields', () => {
      const mock = createMockAsset({ id: 'hero', name: '英雄主角', role: '角色' }, 0)
      expect(mock.id).toBe('mock-hero')
      expect(mock.name).toBe('英雄主角')
      expect(mock.category).toBe('character')
      expect(mock.relativePath).toBe('assets/mock-1.png')
      expect(mock.previewable).toBe(true)
    })
  })
})
