# UIUX Upgrade B 验收报告

> 历史基线：本报告属于 2026-07-13 UIUX 验收快照；其 `pnpm check` PASS 不代表当前 HEAD 全量通过，当前验证以最新一致性报告和现场命令结果为准。

- 生成日期：2026-07-13（Asia/Shanghai）
- 当前分支：`main`
- 审计时 HEAD：`3d34a92ad77a1cbd286616fc0d8e231695a91bd4`
- 候选提交：本报告所在提交（由 Git 记录，不在提交内自引用哈希）
- 当前判定：**开发实现完成；候选构建验收、外部对标和真实运行证据待补**
- 权威来源：`docs/adr/0010-uiux-upgrade-path-b-and-streaming-verdict.md`、`.scratch/uiux-upgrade-b/MAP.md`、`.scratch/creatok-uiux-wayfinding/assets/13-uiux-acceptance-matrix.md`

## 判定边界

本报告区分三类结论：

1. **实现证据**：代码、自动化测试场景和当前产品截图表明功能已接入主路径。
2. **候选构建证据**：必须在同一最终提交、同一测试数据和相同视口重新运行并留证；当前工作区尚未形成候选提交，因此现有截图只作为实现证据索引。
3. **外部或真实运行证据**：竞品真实页面、真实模型供应商、真实长任务生命周期或真实设备证据。fixture、静态原型、DOM 摘要、curl、单测及 Workers/BFF 传输证明均不能替代这些证据。

Playwright 当前默认以 `APP_ENV=e2e` 和 `MODEL_EXECUTION_MODE=fixture` 启动。fixture 可证明产品 UI、BFF、持久化和状态机行为，但不能证明真实供应商调用、真实供应商耗时或生产可用性。截图文件存在也不等于生成该截图的整条测试已通过。

## 验证命令

| 命令 | 当前结果 | 说明 |
|---|---|---|
| `node scripts/uiux/decision-ticket-guard.mjs` | PASS | 10 decisions、24 gaps、12 contracts、25 tickets；同步由 `pnpm check` 复验。 |
| `pnpm check` | PASS | Contracts/Core 类型检查通过；Web Biome 检查 472 个文件；secret scan 扫描 1276 个文件、0 findings。 |
| `pnpm typecheck` | PASS | Contracts、Core、Web 全部通过；Web locale compile 同步通过。 |
| `pnpm test` | PASS | Core 391 passed / 20 conditional skipped；Web 229 passed；UIUX scripts 17 passed；0 failed。 |
| `pnpm e2e` | PASS | 81 passed / 1 production-candidate-only skipped / 0 failed，用时 8.1m；完整视频 workflow 45.3s，取消并刷新恢复 13.4s。 |
| `pnpm build` | PASS | Contracts/Core 通过；Web client 14,580 modules、SSR 16,849 modules 构建成功。 |
| `pnpm uiux:bundle-check` | PASS | Initial CSS 34,581 B gzip；initial JS 304,229 B gzip；lazy Polotno 585,490 B gzip。 |
| `pnpm --filter @meiye/web locale:check` | PASS | 中英文 2,979 个 locale keys 一致。 |
| production-candidate Wrangler streaming smoke | PASS | Wrangler 候选中，paced fixture 经 Core → Workers/BFF 到浏览器保持多 chunk 且首尾间隔 >100ms；详见 `wrangler-streaming-proof.md`。仅证明传输链，不能标记为 live-provider proof。 |

## I01-I12 体验合同

所有体验合同在外部证据和同一候选构建证据齐全前均为 **pending / non-green**。

| 合同 | 当前实现/截图索引 | 明确缺口 | 判定 |
|---|---|---|---|
| I01 | `02b`、`02d`、`07`、`08`、`21` | 同一候选主旅程；真实视频 workflow；升级后示例店桌面图 | pending |
| I02 | `01`、`01b` | KickArt Agent 真实开场对标 | pending |
| I03 | `03`、`04`、`05`、`05a` | 真实供应商流式；即梦/KickArt 开始—进行中—完成对标 | pending |
| I04 | `09a`、`09b`、`09c`、`10`、`10a`、`10b`、`11a`、`11b` | 真实供应商 lifecycle、真实耗时样本及外部任务状态对标 | pending |
| I05 | `01`、`01b` | KickArt 点击前后与提交结果对标 | pending |
| I06 | `02`、`02a`、`02b`、`02d` | 可灵登录态新截图；同一候选默认/预设/高级/模型卡组合证据 | pending |
| I07 | `02`、`02c` | 同一候选默认套组、自定义套组、提交预览三态的标注对照 | pending |
| I08 | `04`、`04b` | 换一批与两次免费重试完整边界录屏；外部层级对标 | pending |
| I09 | `05`、`05a`、`06`、`06b`、`06c`、`06d` | 同一候选结果/历史/资产同一产物对照；真实生成媒体声明需额外证明 | pending |
| I10 | `10`、`10a`、`10b`、`13` | KickArt 登录态任务中心真实截图及跨页回源录屏 | pending |
| I11 | `22a`–`22d` | 拍照与粘贴行为录屏；即梦输入台同构对标 | pending |
| I12 | `11`、`12`、`24-*`、`25-*` | 品牌外壳桌面/移动；中英菜单与移动中文；外部状态对标；真实设备字体/触控 | pending |

截图短名均位于 `docs/evidence/uiux-upgrade-b/screenshots/`。

## Ticket 04-25

`status` 继续以 `.scratch/uiux-upgrade-b/decision-ticket-map.json` 为准。2026-07-14 起，04–25 因新的产品调整统一以 `superseded` 行政关闭；“实现已落地”和下表保留的缺口都不是验收通过结论。详见 [关票决定](../../reviews/uiux-upgrade-b-ticket-closure-2026-07-14.md)。

| Ticket | 已落地实现与当前证据 | 原 Acceptance 仍缺 | 状态 |
|---|---|---|---|
| 04 | 品牌残留、starter 页面和 `/ai` 旁路已清理；公开旧路由有 E2E 场景 | 当前品牌首页/页脚桌面与移动图；CreatOK/KickArt 公开外壳对标 | closed (superseded) |
| 05 | fixture 生成、recorded 门禁和友好错误恢复；`00`、`00b`、`04` | 同一候选完整闭环、失败态及已有对标三联证据 | closed (superseded) |
| 06 | AI SDK runner、流式端点和结构化三候选接入；`03`、`04` | live-provider 首 token/中断/完成证明及即梦/KickArt 对标 | closed (superseded) |
| 07 | BFF 流透传、前端 partial 消费和停止/重提；`03`、`04`、`05a`；Wrangler 传输证明 | live-provider 与外部三帧 | closed (superseded) |
| 08 | Markdown/ResponseStream 富渲染；`05`、`05a` | 同一候选移动/中断/恢复及即梦/KickArt 对标 | closed (superseded) |
| 09 | 自动 Job 观察、白话阶段和禁假百分比；`09a`、`09b`、`09c` | 真实供应商 lifecycle 与提交—运行—完成对标 | closed (superseded) |
| 10 | 全局任务浮标、未读和回源；`10`、`10a`、`10b` | KickArt 登录态任务中心真实图及完整跨页录屏 | closed (superseded) |
| 11 | 基于 operation/model 的估时与无样本降级；`11a`、`11b` | 真实完成样本及 KickArt/CreatOK 预期管理对标 | closed (superseded) |
| 12 | 低门槛预设、折叠专业参数和显式模型；`02`、`02a` | 同一候选默认/展开两态与已有低密度对标标注 | closed (superseded) |
| 13 | 命名预设隐藏输入并显示素材指导；`02b` | 新取可灵登录态 `/app/special-effects/new` 对标 | closed (superseded) |
| 14 | 模块多选、套组预览和 A/B 四项默认继承；`02`、`02c` | 默认/自定义/提交前三态与允许使用的历史 A+ 对照 | closed (superseded) |
| 15 | 模型/模板视觉卡、预览和额度；`02`、`02d` | 同一候选模型卡及模板画廊与现有 CreatOK 对标 | closed (superseded) |
| 16 | durable video workflow、revision、取消、恢复和旧轨退役；`07`、`07c`、`08`、`09a-video` | live video provider、同 workflow 移动 completed 证据及现有对标 | closed (superseded) |
| 17 | canonical gallery、lightbox 与多入口回源；`06`、`06b`、`06c`、`06d` | 同一候选三入口同产物对照；若宣称真实生成，补 live media 证明 | closed (superseded) |
| 18 | A/B/C 单选、换批和两次免费重试；`04`、`04b` | 换批/重试/第三次阻断完整录屏及外部层级对标 | closed (superseded) |
| 19 | 问候、今日建议和场景 chips；`01`、`01b` | KickArt Agent 开场真实对标 | closed (superseded) |
| 20 | 全局 `Cmd/Ctrl+K` 导航/添加双组；`13` | 跨一级页录屏及现有 CreatOK 工具/资产图标注 | closed (superseded) |
| 21 | 只读零消耗示例店与做同款；`21` | 升级后桌面示例店图及现有 dashboard 对标 | closed (superseded) |
| 22 | 文字、拍照、上传、拖放、粘贴和 durable Asset 引用；`22a`–`22d` | 拍照/粘贴行为录屏及即梦输入台对标 | closed (superseded) |
| 23 | 中文默认、English 切换和路由上下文保持；`11` | 中文默认、用户菜单中英同路由、移动中文截图 | closed (superseded) |
| 24 | 模型标识净化、生成提示和真实 `published` 迁移动效；三张 `24-*` | 即梦/KickArt 生成中与完成状态；同一候选改造前后对照 | closed (superseded) |
| 25 | 18px 产品根字号、48px 触区和中文字体栈；`12`、三张 `25-*` | 379px 三阶段、桌面 Composer、真实设备字体和人工连续点按证据 | closed (superseded) |

## 外部证据缺口

### 必须新取真实竞品页面

- 04：CreatOK/KickArt 公开外壳桌面与移动。
- 06–08：即梦/KickArt 同任务开始、进行中、完成状态。
- 09–11：KickArt/CreatOK 的真实任务中心、恢复和等待预期。
- 13：可灵真实登录态指定路由。
- 19：KickArt Agent 开场。
- 24：即梦/KickArt 生成中与完成反馈。

### 必须补真实供应商或真实运行证明

- 06–08：真实模型流式、上游失败与最终结构化结果。
- 09–11：真实长任务 lifecycle、供应方完成回流和真实耗时样本。
- 16：真实视频候选、恢复及最终可播放成片。
- 17：若发布材料使用“真实生成结果”表述，必须补真实生成媒体证明。

### 必须补真实设备或人工证明

- 25：安装 HarmonyOS Sans 或 MiSans 的设备字体表现，以及连续点按不误触。
- 当前没有真实目标用户测试。发布材料必须明确写出这一限制，不得把测试账号、自动化 E2E 或内部验收称为真实用户验证。

## Closure 决策

本报告创建时不关闭 04–25。2026-07-14 的新调整随后覆盖了该状态决定：04–25 已统一以 `closed / superseded` 行政收口，但以下原始 Acceptance 关票条件仍未满足：

1. 形成最终候选提交，并在该提交上完成全部验证命令。
2. 以同一候选、同一测试数据和规定视口重新生成当前产品证据。
3. 补齐每票要求的竞品、真实供应商或真实设备证据。
4. 在本报告中把对应 I01–I12 和 ticket 判定更新为 green/closed。
5. 同步更新 `decision-ticket-map.json` 与每张 ticket 顶部 JSON 块；`closureEvidence` 至少包含本报告、当前产品行为证据和对应对标/真实运行证据。

Guard 校验元数据一致、关票原因、依赖关系、证据路径存在和票 02 前置；它仍不校验证据是否来自同一候选、是否为真实竞品或真实供应商。行政关票不得覆盖上述语义。
