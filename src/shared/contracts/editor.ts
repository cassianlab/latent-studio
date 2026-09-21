import type { ImageReference } from './images'

export interface ImageEditorLaunch {
  title: string
  preview?: string
  source?: ImageReference
  parentVersionId?: string
  width?: number
  height?: number
}

export interface ImageEditorVersion {
  id: string
  title: string
  parentVersionId?: string
  source?: ImageReference
  markedImagePath: string
  suggestion: string
  taskId?: string
  createdAt: string
}

export interface SaveImageEditorVersionInput {
  title: string
  parentVersionId?: string
  source?: ImageReference
  markedDataUrl: string
  suggestion: string
  taskId?: string
}

export interface EditorApi {
  saveVersion(input: Omit<SaveImageEditorVersionInput, 'projectRoot'>): Promise<ImageEditorVersion>
  listVersions(): Promise<ImageEditorVersion[]>
  getVersionPreview(id: string): Promise<string | null>
}
