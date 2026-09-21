export default async function verifyAgentPlanning(page) {
  const errors = []
  const captureError = (message) => {
    if (message.type() === 'error') errors.push(message.text())
  }
  page.on('console', captureError)
  try {
    await page.reload()
    // The browser fixture replaces only the image IPC boundary, not Agent planning UI.
    await page.evaluate(() => {
      const listeners = new Set()
      const tasks = []
      window.latentStudio = {
        images: {
          enqueue: async (input) => {
            if (input.request.outputSize !== '2048x1152' || input.request.outputFormat !== 'png') {
              throw new Error('Agent dropped the export dimensions or format')
            }
            if (!input.request.prompt.includes('【所有图片共享的固定约束】')) {
              throw new Error('Agent dropped the shared image invariants')
            }
            const task = { id: crypto.randomUUID(), connectionId: 'qa-connection', request: { ...input.request, model: 'qa-image' }, status: 'pending', attempts: 0, maxRetries: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
            tasks.push(task)
            setTimeout(() => {
              task.status = 'completed'
              for (const listener of listeners) listener({ type: 'completed', task: structuredClone(task) })
            }, 100)
            return structuredClone(task)
          },
          onTaskEvent: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
          list: async () => structuredClone(tasks),
          cancel: async () => false,
          pause: async () => {},
          resume: async () => {},
        },
      }
    })
    await page.getByRole('button', { name: '余 余烬计划 雨夜重逢视觉探索 · 刚刚编辑' }).click()
    await page.getByRole('textbox', { name: '输入提示词' }).fill('生成两张雨夜图片')
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await page.getByRole('textbox', { name: '第 2 个镜头标题', exact: true }).waitFor()
    await page.waitForTimeout(200)
    if (await page.getByRole('textbox', { name: /第 \d+ 个镜头标题/ }).count() !== 2) {
      throw new Error('Agent did not prioritize the user-requested image count')
    }
    await page.getByRole('button', { name: '确认并并发生成' }).click()
    await page.locator('.plan-head .pill').filter({ hasText: '已完成' }).waitFor()
    if (await page.locator('.plan-head .pill').filter({ hasText: '等待确认' }).count()) {
      throw new Error('Completed Agent plan returned to awaiting confirmation')
    }
    if (errors.some((text) => text.includes('Cannot update a component'))) {
      throw new Error('Agent planning updated parent state during render')
    }
    console.log(JSON.stringify({ agentImageCount: 2, planStatus: 'completed', errors }))
  } finally {
    page.off('console', captureError)
  }
}
