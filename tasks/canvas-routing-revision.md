# 画布连接线路由与编辑

- [x] 四个方向的起点和终点连接点都可显式选择
- [x] 拖拽过程中终点和箭头根据悬停素材实时吸附
- [x] 正交路由保持起点与终点方向，并避开画布上的素材
- [x] 双击连接线可直接新建或编辑连接文字
- [x] 保留连接线选择、键盘删除、移动节点后自动重排
- [x] 折点和线段中点可拖动，控制点始终保持在线路上
- [x] 选中连接线、连接文字和控制点位于素材上方
- [x] 路由回归测试、构建和 Playwright 交互验收通过

验收（2026-09-13）：`node --test tests/canvas-routing.test.mjs` 8/8 通过；`npm run build` 与 `git diff --check` 通过。Playwright 已验证折点和线段中点斜向拖动后全部控制点仍在线上、四点折线包含 2 个可拖折点和 1 个可拖中点、选中连接线层级高于全部素材且穿过备注卡片时不被遮挡。截图见 `output/playwright/canvas-control-points-fixed.png` 与 `output/playwright/canvas-selected-link-above-materials-fixed.png`。
