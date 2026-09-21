import { promises as fs } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { ImageDataReference, ImageReference } from '../../shared/contracts/images'
import type { TextImagePart } from '../../shared/contracts/text'
import { detectReferenceImageMimeType, isSupportedReferenceMimeType, MAX_REFERENCE_IMAGE_BYTES, MAX_REFERENCE_IMAGES } from '../../shared/reference-images'

function isWithin(root: string, candidate: string): boolean {
  const child = relative(root, candidate)
  return child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child)
}

function validateImage(bytes: Uint8Array, declaredMimeType?: string): TextImagePart {
  if (!bytes.byteLength || bytes.byteLength > MAX_REFERENCE_IMAGE_BYTES) throw new Error('参考图大小无效或超过 20 MiB')
  const mimeType = detectReferenceImageMimeType(bytes)
  const normalizedDeclaredMimeType = declaredMimeType?.split(';', 1)[0].trim().toLowerCase()
  if (!mimeType || normalizedDeclaredMimeType && (!isSupportedReferenceMimeType(normalizedDeclaredMimeType) || normalizedDeclaredMimeType !== mimeType)) {
    throw new Error('参考图内容不是有效图片或与声明格式不一致')
  }
  return { type: 'image', data: Buffer.from(bytes).toString('base64'), mimeType }
}

function decodeDataReference(reference: ImageDataReference): TextImagePart {
  const raw = reference.data ?? reference.base64
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('参考图数据无效')
  const dataUrl = raw.match(/^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/)
  const encoded = dataUrl?.[2] ?? raw.trim()
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 === 1 || encoded.length > Math.ceil(MAX_REFERENCE_IMAGE_BYTES * 4 / 3) + 4) {
    throw new Error('参考图数据无效或超过 20 MiB')
  }
  return validateImage(Buffer.from(encoded, 'base64'), dataUrl?.[1] ?? reference.mimeType)
}

export async function readAgentReferenceImages(
  references: readonly ImageReference[],
  getProjectRoot: () => string | undefined,
): Promise<TextImagePart[]> {
  if (references.length > MAX_REFERENCE_IMAGES) throw new Error(`单轮最多添加 ${MAX_REFERENCE_IMAGES} 张参考图`)
  const rootValue = getProjectRoot()
  const root = rootValue ? await fs.realpath(resolve(rootValue)) : undefined
  return Promise.all(references.map(async (reference) => {
    if (!('path' in reference)) return decodeDataReference(reference)
    if (!root) throw new Error('请先打开一个项目')
    const lexicalPath = isAbsolute(reference.path) ? resolve(reference.path) : resolve(root, reference.path)
    if (!isWithin(root, lexicalPath)) throw new Error('参考图必须位于当前项目内')
    const canonicalPath = await fs.realpath(lexicalPath)
    if (!isWithin(root, canonicalPath)) throw new Error('参考图不能通过符号链接离开当前项目')
    const details = await fs.stat(canonicalPath)
    if (!details.isFile()) throw new Error('参考图必须是文件')
    if (details.size > MAX_REFERENCE_IMAGE_BYTES) throw new Error('参考图不能超过 20 MiB')
    return validateImage(await fs.readFile(canonicalPath), reference.mimeType)
  }))
}
