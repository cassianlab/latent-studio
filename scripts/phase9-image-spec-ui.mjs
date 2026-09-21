export default async function verifyImageSpecifications(page) {
  const errors = []
  const onConsole = (message) => { if (message.type() === 'error') errors.push(message.text()) }
  page.on('console', onConsole)
  try {
    const close = page.getByRole('button', { name: '关闭参数面板' })
    if (await close.count()) await close.click()
    for (const [width, height] of [[1024, 720], [1440, 900], [1920, 1080]]) {
      await page.setViewportSize({ width, height })
      for (const theme of ['light', 'dark']) {
        const themeButton = page.getByRole('button', { name: theme === 'light' ? '切换浅色' : '切换深色', exact: true })
        if (await themeButton.count()) await themeButton.click()
        await page.getByRole('button', { name: '生图模型：Flux Kontext Pro', exact: true }).click()
        const panel = page.locator('.image-settings-panel')
        await panel.getByRole('button', { name: '16:9 横版电影', exact: true }).click()
        await panel.getByRole('button', { name: '4K', exact: true }).click()
        await panel.getByText('4096x2304 px', { exact: true }).waitFor()
        const format = panel.getByRole('combobox', { name: '选择图片输出格式' })
        for (const value of ['PNG', 'JPEG', 'WebP']) {
          await format.selectOption(value)
          await page.locator('.inspector .key-values span').filter({ hasText: '输出格式' }).getByText(value, { exact: true }).waitFor()
        }
        await format.scrollIntoViewIfNeeded()
        await format.focus()
        await page.screenshot({ path: `output/playwright/phase9-image-spec-${width}-${theme}.png`, animations: 'disabled', scale: 'css' })
        const bounds = await format.boundingBox()
        if (!bounds || bounds.y < 0 || bounds.y + bounds.height > height) throw new Error('Output format is clipped')
        if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Horizontal overflow')
        await close.click()
      }
    }
    if (errors.length) throw new Error(errors.join('\n'))
    console.log(JSON.stringify({ viewports: 3, themes: 2, formats: ['PNG', 'JPEG', 'WebP'], outputSize: '4096x2304', errors }))
  } finally {
    page.off('console', onConsole)
  }
}
