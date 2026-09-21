const CHINESE_DIGITS: Record<string, number> = {
  '一': 1,
  '二': 2,
  '两': 2,
  '三': 3,
  '四': 4,
  '五': 5,
  '六': 6,
  '七': 7,
  '八': 8,
  '九': 9,
  '十': 10,
}

function parseChineseCount(value: string): number | undefined {
  if (value in CHINESE_DIGITS) return CHINESE_DIGITS[value]
  if (value.startsWith('十')) return 10 + (CHINESE_DIGITS[value.slice(1)] ?? 0)
  if (value.endsWith('十')) return (CHINESE_DIGITS[value.slice(0, -1)] ?? 0) * 10
  const [tens, ones] = value.split('十')
  if (ones !== undefined) return (CHINESE_DIGITS[tens] ?? 0) * 10 + (CHINESE_DIGITS[ones] ?? 0)
  return undefined
}

export function resolveAgentImageCount(prompt: string, fallback: number): number {
  const match = prompt.match(/(?:^|[^\d])([1-9]|1[0-6])\s*(?:张|幅|个\s*(?:图片|图像|画面|镜头))/)
    ?? prompt.match(/([一二两三四五六七八九十]{1,3})\s*(?:张|幅|个\s*(?:图片|图像|画面|镜头))/)
  if (!match) return fallback
  const parsed = /^\d+$/.test(match[1]) ? Number.parseInt(match[1], 10) : parseChineseCount(match[1])
  return parsed && parsed >= 1 && parsed <= 16 ? parsed : fallback
}
