import { access, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { EmbeddingProvider } from './prompt-search'

const MODEL_ID = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2'
const MODEL_REVISION = '2c4055b12046f11709e9df2c122e59ffbdc2f900'
const MODEL_LICENSE = 'Apache-2.0'
const MODEL_DIMENSIONS = 384

async function directoryBytes(path: string): Promise<number> {
  let total = 0
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name)
    if (entry.isDirectory()) total += await directoryBytes(child)
    else if (entry.isFile()) total += (await stat(child)).size
  }
  return total
}

export function createLocalEmbeddingProvider(modelRoot: string): EmbeddingProvider {
  const installPath = join(modelRoot, 'paraphrase-multilingual-minilm-l12-v2')
  const markerPath = join(installPath, '.installed.json')
  let extractor: ((texts: readonly string[], options: { pooling: 'mean'; normalize: true }) => Promise<{ tolist(): number[][] }>) | undefined

  const load = async () => {
    if (extractor) return extractor
    await mkdir(installPath, { recursive: true })
    const transformers = await import('@huggingface/transformers')
    transformers.env.cacheDir = installPath
    transformers.env.allowRemoteModels = true
    const pipeline = await transformers.pipeline('feature-extraction', MODEL_ID, { revision: MODEL_REVISION })
    extractor = pipeline as unknown as typeof extractor
    if (!extractor) throw new Error('本地向量模型加载失败')
    return extractor
  }

  return {
    descriptor: {
      modelId: MODEL_ID,
      version: MODEL_REVISION,
      sourceUrl: `https://huggingface.co/${MODEL_ID}`,
      license: MODEL_LICENSE,
      dimensions: MODEL_DIMENSIONS,
    },
    async install() {
      const model = await load()
      const probe = await model(['安装健康检查'], { pooling: 'mean', normalize: true })
      if (probe.tolist()[0]?.length !== MODEL_DIMENSIONS) throw new Error('本地向量模型健康检查失败')
      await writeFile(markerPath, JSON.stringify({ modelId: MODEL_ID, revision: MODEL_REVISION, installedAt: new Date().toISOString() }), 'utf8')
      return { installPath, diskBytes: await directoryBytes(installPath) }
    },
    async isInstalled() {
      try { await access(markerPath); return true } catch { return false }
    },
    async embed(texts) {
      const model = await load()
      const output = await model(texts, { pooling: 'mean', normalize: true })
      return output.tolist()
    },
    async uninstall() {
      extractor = undefined
      await rm(installPath, { recursive: true, force: true })
    },
  }
}
