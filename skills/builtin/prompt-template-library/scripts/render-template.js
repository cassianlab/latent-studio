import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const index = JSON.parse(readFileSync(join(root, 'index.json'), 'utf8'))
const args = process.argv.slice(2)

function output(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

if (args[0] === '--list') {
  output({ version: index.version, templates: index.templates.map(({ id, title, category, recommendedRatio }) => ({ id, title, category, recommendedRatio })) })
  process.exit(0)
}

if (args[0] !== '--render' || !args[1]) {
  output({ error: '用法：--list 或 --render <template-id> key=value ...' })
  process.exit(2)
}

const template = index.templates.find((item) => item.id === args[1])
if (!template) {
  output({ error: `模板不存在：${args[1]}` })
  process.exit(1)
}

const values = Object.fromEntries(args.slice(2).map((item) => {
  const separator = item.indexOf('=')
  return separator < 1 ? [item, ''] : [item.slice(0, separator), item.slice(separator + 1)]
}))
const missingVariables = template.variables.filter((key) => !String(values[key] ?? '').trim())
const prompt = template.prompt.replace(/\{\{([^{}]+)\}\}/g, (full, key) => String(values[key.trim()] ?? full))
output({ templateId: template.id, title: template.title, category: template.category, recommendedRatio: template.recommendedRatio, prompt, missingVariables })
