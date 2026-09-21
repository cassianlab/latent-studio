export function buildImageTaskPrompt(prompt: string, invariants: readonly string[] = [], memoryContext?: string): string {
  const rules = [...new Set(invariants.map((rule) => rule.trim()).filter(Boolean))]
  const taskPrompt = rules.length
    ? `${prompt}\n\n【所有图片共享的固定约束】\n${rules.map((rule) => `- ${rule}`).join('\n')}\n保持以上角色外观、服装和画风约束；只改变当前镜头明确要求变化的部分。`
    : prompt
  return memoryContext ? `${taskPrompt}\n\n${memoryContext}` : taskPrompt
}
