export default async function verifyUiMatrix(page) {
  const errors = []
  const captureError = (message) => { if (message.type() === 'error') errors.push(message.text()) }
  page.on('console', captureError)
  const screenshots = []
  const capture = async (name) => {
    const path = `output/playwright/phase9-${name}.png`
    await page.waitForTimeout(350)
    await page.screenshot({ path, scale: 'css', animations: 'disabled' })
    screenshots.push(path)
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) {
      throw new Error(`Horizontal overflow: ${name}`)
    }
  }
  try {
    const previewProject = page.getByRole('button', { name: '余 余烬计划 雨夜重逢视觉探索 · 刚刚编辑' })
    if (await previewProject.count()) await previewProject.click()
    await page.getByRole('button', { name: '提示词库', exact: true }).click()
    if (!await page.getByRole('heading', { name: '标准商品图模板', exact: true }).count()) {
      await page.getByRole('button', { name: '新建提示词', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: '新建提示词' })
      await dialog.getByRole('textbox', { name: '名称', exact: true }).fill('标准商品图模板')
      await dialog.getByRole('button', { name: '模板', exact: true }).click()
      await dialog.getByRole('textbox', { name: '内容', exact: true }).fill('为 {{产品名称}} 生成干净、真实的商品图。保持品牌色、材质与统一背景。')
      await dialog.getByRole('textbox', { name: '标签', exact: true }).fill('商品图, 标准化')
      await dialog.getByRole('checkbox', { name: '加入收藏' }).check()
      await dialog.getByRole('button', { name: '创建提示词' }).click()
      await page.getByRole('heading', { name: '标准商品图模板', exact: true }).waitFor()
    }
    await page.getByRole('combobox', { name: '按提示词类型筛选' }).selectOption('template')
    await page.getByRole('button', { name: '只看收藏' }).click()
    await page.getByRole('heading', { name: '标准商品图模板', exact: true }).waitFor()
    await page.getByRole('button', { name: '技能', exact: true }).click()
    await page.getByRole('button', { name: '当前项目', exact: true }).click()
    if (!await page.getByRole('button', { name: '编辑 本地 Skill' }).count()) {
      await page.getByRole('button', { name: '链接本地 Skill' }).click()
    }
    for (const [width, height] of [[1024, 720], [1440, 900], [1920, 1080]]) {
      await page.setViewportSize({ width, height })
      for (const theme of ['light', 'dark']) {
        const switchTheme = page.getByRole('button', { name: theme === 'dark' ? '切换深色' : '切换浅色', exact: true })
        if (await switchTheme.count()) await switchTheme.click()
        await page.getByRole('button', { name: '技能', exact: true }).click()
        await page.getByRole('button', { name: '当前项目', exact: true }).click()
        await capture(`skills-${width}-${theme}`)
        await page.getByRole('button', { name: '编辑 本地 Skill' }).first().click()
        await page.getByRole('textbox', { name: '显示名称' }).waitFor()
        await capture(`skill-editor-${width}-${theme}`)
        await page.getByRole('button', { name: '关闭 Skill 编辑器' }).click()
        await page.getByRole('button', { name: '提示词库', exact: true }).click()
        await capture(`prompts-${width}-${theme}`)
        await page.getByRole('button', { name: '新建提示词', exact: true }).click()
        await page.getByRole('textbox', { name: '名称', exact: true }).waitFor()
        await capture(`prompt-editor-${width}-${theme}`)
        await page.getByRole('button', { name: '关闭', exact: true }).click()
        await page.getByRole('button', { name: '工作台', exact: true }).click()
        await page.getByRole('button', { name: '生图模型：Flux Kontext Pro', exact: true }).click()
        await page.getByText('Agent 默认数量', { exact: true }).waitFor()
        await capture(`image-settings-${width}-${theme}`)
        await page.getByRole('button', { name: '关闭参数面板' }).click()
      }
    }
    if (errors.length) throw new Error(`Runtime errors: ${errors.join('\n')}`)
    console.log(JSON.stringify({ screenshots, errors }))
  } finally {
    page.off('console', captureError)
  }
}
