import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, readdir, rename, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import type { PromptAsset } from '../../shared/contracts/library'
import { LibraryError } from './errors'
import { normalizeNanmiPromptRecord } from './prompt-import-normalization'

const MAX_ARCHIVE_BYTES = 250 * 1024 * 1024
const DOWNLOAD_PARTS = 4
const DOWNLOAD_ATTEMPTS = 3
const DOWNLOAD_TIMEOUT = 300_000
const NORMALIZE_BATCH_SIZE = 100

export interface NanmiManifest {
  dataset_version: string
  release_repo: string
  db: { asset: string; tag: string; sha256: string; bytes: number }
}

export interface NanmiCatalogPrompt {
  sourceKey: string
  sourcePublishedAt?: string
  name: string
  content: string
  kind?: 'prompt' | 'template' | 'style'
  tags: string[]
  collection: string
  category: string
  primaryLocale?: PromptAsset['primaryLocale']
  translations?: PromptAsset['translations']
  description?: string
  previewUrl?: string
  sourceUrl?: string
}

interface NanmiCatalogInput {
  manifest: NanmiManifest
  tag: string
  collection: string
  repositoryUrl: string
  fetch: typeof globalThis.fetch
  cacheDirectory?: string
}

interface ByteRange {
  index: number
  start: number
  end: number
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

export function parseNanmiManifest(text: string): NanmiManifest {
  let value: Partial<NanmiManifest>
  try {
    value = JSON.parse(text) as Partial<NanmiManifest>
  } catch {
    throw new LibraryError('read-failed', 'NanmiCoder Open Image Prompts 提示词索引格式无效')
  }
  if (!value || typeof value.dataset_version !== 'string' || typeof value.release_repo !== 'string' || !value.db || typeof value.db.asset !== 'string' || typeof value.db.tag !== 'string' || !/^[a-f0-9]{64}$/i.test(value.db.sha256) || !Number.isInteger(value.db.bytes) || value.db.bytes < 1 || value.db.bytes > MAX_ARCHIVE_BYTES) {
    throw new LibraryError('read-failed', 'NanmiCoder 数据清单格式无效')
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.release_repo) || !/^[A-Za-z0-9._-]+$/.test(value.db.asset) || !/^[A-Za-z0-9._-]+$/.test(value.db.tag)) {
    throw new LibraryError('read-failed', 'NanmiCoder 数据清单包含无效下载地址')
  }
  return value as NanmiManifest
}

function archiveRanges(bytes: number): ByteRange[] {
  const size = Math.ceil(bytes / DOWNLOAD_PARTS)
  const ranges: ByteRange[] = []
  for (let index = 0; index < DOWNLOAD_PARTS; index += 1) {
    const start = index * size
    if (start >= bytes) break
    ranges.push({ index, start, end: Math.min(bytes - 1, start + size - 1) })
  }
  return ranges
}

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
    throw error
  }
}

function validContentRange(value: string | null, start: number, end: number, total: number): boolean {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value ?? '')
  return Boolean(match && Number(match[1]) === start && Number(match[2]) === end && Number(match[3]) === total)
}

async function downloadRange(url: string, path: string, range: ByteRange, total: number, fetchImplementation: typeof globalThis.fetch): Promise<void> {
  const expectedBytes = range.end - range.start + 1
  for (let attempt = 0; attempt < DOWNLOAD_ATTEMPTS; attempt += 1) {
    let receivedBytes = await fileSize(path)
    if (receivedBytes === expectedBytes) return
    if (receivedBytes > expectedBytes) {
      await rm(path, { force: true })
      receivedBytes = 0
    }
    const requestStart = range.start + receivedBytes
    let response: Response
    try {
      response = await fetchImplementation(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT),
        headers: { range: `bytes=${requestStart}-${range.end}` },
      })
    } catch (error) {
      if (attempt === DOWNLOAD_ATTEMPTS - 1) throw error
      await wait(150 * (attempt + 1))
      continue
    }
    if (response.status !== 206 || !response.body || !validContentRange(response.headers.get('content-range'), requestStart, range.end, total) || (response.url && !response.url.startsWith('https://'))) {
      const error = new LibraryError('read-failed', response.status === 206 ? 'NanmiCoder 数据库分段响应无效' : `NanmiCoder 数据库不支持断点下载（HTTP ${response.status}）`)
      if (!retryableStatus(response.status) || attempt === DOWNLOAD_ATTEMPTS - 1) throw error
      await wait(150 * (attempt + 1))
      continue
    }
    try {
      let streamedBytes = 0
      const remainingBytes = expectedBytes - receivedBytes
      const limiter = new Transform({ transform(chunk, _encoding, callback) {
        streamedBytes += chunk.length
        if (streamedBytes > remainingBytes) return callback(new Error('NanmiCoder 数据库分段过大'))
        callback(null, chunk)
      } })
      await pipeline(Readable.fromWeb(response.body as never), limiter, createWriteStream(path, { flags: receivedBytes ? 'a' : 'w' }))
      if (await fileSize(path) === expectedBytes) return
    } catch (error) {
      if (attempt === DOWNLOAD_ATTEMPTS - 1) throw error
    }
    await wait(150 * (attempt + 1))
  }
  throw new LibraryError('read-failed', 'NanmiCoder 数据库分段下载失败')
}

async function assembleArchive(directory: string, archivePath: string, ranges: readonly ByteRange[], expectedHash: string): Promise<void> {
  const pendingPath = `${archivePath}.pending`
  await rm(pendingPath, { force: true })
  const hash = createHash('sha256')
  try {
    for (const range of ranges) {
      const verifier = new Transform({ transform(chunk, _encoding, callback) {
        hash.update(chunk)
        callback(null, chunk)
      } })
      await pipeline(createReadStream(join(directory, `archive.part-${range.index}`)), verifier, createWriteStream(pendingPath, { flags: range.index === 0 ? 'w' : 'a' }))
    }
    if (hash.digest('hex') !== expectedHash.toLocaleLowerCase()) {
      await Promise.all(ranges.map((range) => rm(join(directory, `archive.part-${range.index}`), { force: true })))
      throw new LibraryError('read-failed', 'NanmiCoder 数据库包校验失败')
    }
    await rename(pendingPath, archivePath)
    await Promise.all(ranges.map((range) => rm(join(directory, `archive.part-${range.index}`), { force: true })))
  } catch (error) {
    await rm(pendingPath, { force: true })
    throw error
  }
}

async function ensureArchive(input: NanmiCatalogInput, directory: string): Promise<string> {
  const archivePath = join(directory, 'prompts.db.gz')
  const ranges = archiveRanges(input.manifest.db.bytes)
  if (await fileSize(archivePath) === input.manifest.db.bytes) {
    await Promise.all([
      ...ranges.map((range) => rm(join(directory, `archive.part-${range.index}`), { force: true })),
      rm(`${archivePath}.pending`, { force: true }),
    ])
    return archivePath
  }
  await rm(archivePath, { force: true })
  const url = `https://github.com/${input.manifest.release_repo}/releases/download/${input.manifest.db.tag}/${input.manifest.db.asset}`
  await Promise.all(ranges.map((range) => downloadRange(url, join(directory, `archive.part-${range.index}`), range, input.manifest.db.bytes, input.fetch)))
  await assembleArchive(directory, archivePath, ranges, input.manifest.db.sha256)
  return archivePath
}

export async function cleanNanmiCatalogCache(cacheDirectory: string, activeVersion: string): Promise<void> {
  const cacheRoot = join(cacheDirectory, 'nanimicoder-open-image-prompts')
  const entries = await readdir(cacheRoot, { withFileTypes: true })
  await Promise.all(entries.filter((entry) => entry.isDirectory() && entry.name !== activeVersion).map((entry) => rm(join(cacheRoot, entry.name), { recursive: true, force: true })))
}

export async function loadNanmiCatalog(input: NanmiCatalogInput): Promise<NanmiCatalogPrompt[]> {
  const temporary = !input.cacheDirectory
  const cacheRoot = input.cacheDirectory
    ? join(input.cacheDirectory, 'nanimicoder-open-image-prompts')
    : await mkdtemp(join(tmpdir(), 'latent-studio-prompts-'))
  const versionKey = input.manifest.db.sha256.toLocaleLowerCase()
  const directory = temporary ? cacheRoot : join(cacheRoot, versionKey)
  const databasePath = join(directory, 'prompts.db')
  await mkdir(directory, { recursive: true })
  try {
    const archivePath = await ensureArchive(input, directory)
    await rm(databasePath, { force: true })
    try {
      await pipeline(createReadStream(archivePath), createGunzip(), createWriteStream(databasePath, { flags: 'wx' }))
    } catch (error) {
      await rm(archivePath, { force: true })
      throw error
    }
    const { DatabaseSync } = await import('node:sqlite')
    const database = new DatabaseSync(databasePath, { readOnly: true })
    try {
      const statement = database.prepare(`
        WITH zh AS (
          SELECT tweet_id, translated_text FROM (
            SELECT tweet_id, translated_text, ROW_NUMBER() OVER (PARTITION BY tweet_id ORDER BY translation_version DESC) AS row_number
            FROM prompt_translations WHERE locale LIKE 'zh%'
          ) WHERE row_number = 1
        ), media AS (
          SELECT tweet_id, url FROM images WHERE image_index = 1
        ), taxonomy AS (
          SELECT prompt_labels.tweet_id,
                 group_concat(taxonomy_labels.dimension_key || '=' || taxonomy_labels.key || '=' || taxonomy_labels.display_zh, '|') AS labels
          FROM prompt_labels
          JOIN taxonomy_labels ON taxonomy_labels.label_id = prompt_labels.label_id AND taxonomy_labels.taxonomy_version = prompt_labels.taxonomy_version
          WHERE prompt_labels.confidence >= 0.65
          GROUP BY prompt_labels.tweet_id
        )
        SELECT prompts.tweet_id, prompts.author, prompts.tool, prompts.prompt_text, prompts.tweet_url,
               zh.translated_text, media.url AS preview_url, taxonomy.labels
        FROM prompts
        LEFT JOIN zh ON zh.tweet_id = prompts.tweet_id
        LEFT JOIN media ON media.tweet_id = prompts.tweet_id
        LEFT JOIN taxonomy ON taxonomy.tweet_id = prompts.tweet_id
      `)
      const prompts: NanmiCatalogPrompt[] = []
      let count = 0
      for (const row of statement.iterate() as Iterable<Record<string, unknown>>) {
        const prompt = normalizeNanmiPromptRecord(row, { tag: input.tag, collection: input.collection, repositoryUrl: input.repositoryUrl })
        if (prompt) prompts.push(prompt)
        count += 1
        if (count % NORMALIZE_BATCH_SIZE === 0) await wait(0)
      }
      return prompts
    } finally {
      database.close()
    }
  } catch (error) {
    if (error instanceof LibraryError) throw error
    throw new LibraryError('read-failed', error instanceof Error ? error.message : 'NanmiCoder 数据库导入失败')
  } finally {
    await rm(databasePath, { force: true })
    if (temporary) await rm(directory, { recursive: true, force: true })
  }
}
