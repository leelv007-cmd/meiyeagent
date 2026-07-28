# 票 05 · 默认/fixture 模式核心闭环可跑通收尾 + 首屏报错兜底
> 阶段: Phase 0 · 共同前置 ｜ 差距: P0-7 ｜ 决策依据: ADR-0010

<!-- decision-ticket-map:start -->
```json
{
  "ticketId": "05",
  "decisionIds": [
    "DEC-PATH-B"
  ],
  "guardrailDecisionIds": [],
  "gapIds": [
    "P0-7"
  ],
  "contractIds": [],
  "blockedBy": [],
  "closureEvidence": [
    "docs/reviews/uiux-upgrade-b-ticket-closure-2026-07-14.md"
  ],
  "resolution": "superseded",
  "status": "closed"
}
```
<!-- decision-ticket-map:end -->

## 差距锚点

- P0-7 是 `partial` 且报告建议降级：旧结论“fixture 模式永久禁用、闭环整条跑不通”已被 2026-07-13 修复推翻；仍成立的是默认 `.env.example` 使用 `recorded`，新克隆无凭据时无法体验生成，以及 fixture 缺“本地测试可用”可见标识、ISSUE-002 尚未浏览器复验。
- 报告 §六共同前置第 5 项另有截图实证：首屏曾直接显示 `weekly_review ... data is undefined` 与内部参数；本票只做首屏/核心旅程的友好失败态、重试与原始错误隔离，不扩成全站错误系统。
- ADR-0010 与 MAP 的验收纪律：核心闭环必须由用户真实走完并截图；后端已有分支、接口、组件、桶导出或单测均不能单独关票。
- 边界：复用已修复的 fixture 执行链，不把 fixture 伪装成生产 `live_verified`；不改 D3“对话式外壳、结构化内核”，不重开 D4，L-1 贴链接抓取不复活，模型仍显式选择且禁止跨品牌 Auto/静默换模。

## 现状代码入口（实核 file:line）

- `.env.example:9-12`：默认 `MODEL_EXECUTION_MODE=recorded`；默认启动不激活 recorded deployments，因此新克隆无供应商凭据时没有可提交模型。报告的 `:12` 未漂移。
- `apps/core/src/p1/model-supply/runtime-config.ts:25-78`：fixture 会激活 recorded deployments；`:218-234` 强制 fixture 仅可用于 `APP_ENV=e2e`，该安全边界必须保留。
- `apps/core/src/p1/model-supply/adapters.ts:1550-1566`：recorded 为 `recorded_only`，fixture 为 `local_fixture_verified`。报告引用的 fixture 分支 `:1559` 未漂移。
- `apps/core/src/main.ts:181-201`、`apps/core/src/job-worker.ts:181-184`：Core、legacy Core 与 Worker 仅在 `local_fixture_verified` 时放行 recorded execution；报告引用的 `:182` 均准确。
- `apps/core/src/p1/model-supply/foundation-module.ts:441-488`：fixture 放行时 `rank >= 2` 产出 `available:true`，但事实口径仍为 `availability:'recorded'`、activation evidence 仍是 `recorded`；报告的 `:471` 未漂移。
- `apps/core/src/p1/model-supply/foundation-module.test.ts:175-201`：当前已有 fixture 下 `available===true` 且 `availability==='recorded'` 的断言；报告的 `:195` 未漂移，但它只是旁证，不是关票证据。
- `mkfast-template-main/src/p1/settings-view-model.ts:288-392`：目录归一化能读 activation/availability，却在返回视图时只保留 `available`，丢掉“本地 fixture”身份；`mkfast-template-main/src/p1/model-settings.tsx:73-80,153-180` 因而只能显示笼统“可用/暂不可用”，无法显示“本地测试可用”。
- `mkfast-template-main/src/product/unified-creation-workbench.tsx:198-203,287-293`：工作台选择首个可用模型；`:830-838` 不可用时明确禁止静默切换供应商；`:917-932` 仍以 `selectedModel.available` 等条件控制提交。报告的 `:830-836,921` 未漂移。
- `package.json:9-18`：根 `dev` 只并行启动 Web/Core，Worker 另需 `dev:worker`；即使模型可提交，默认开发入口也未保证异步 Job 被消费。
- `mkfast-template-main/src/p1/client.ts:15-23` 会把服务端 message 直接装入 `Error`；`mkfast-template-main/src/product/operations-task-page.tsx:165-178` 与 `mkfast-template-main/src/product/unified-creation-workbench.tsx:523-529` 仍把 `error.message` 原样呈现。旧首页截图路径已变更为工作台，但原始技术错误泄漏风险仍在当前代码中。

## 改造方案（步骤级 + 涉及文件清单）

1. 固化两种诚实模式：生产/recorded 继续不可执行；本地无凭据体验统一复用 `APP_ENV=e2e + MODEL_EXECUTION_MODE=fixture`，不新增第三套 provider，不放宽 fixture 的环境闸。
2. 把根 `pnpm dev` 收敛为可开箱的本地 fixture 启动入口：同一环境同时拉起 Web、Core、Worker；另保留明确命名的 recorded/生产模拟入口，避免合同探针用途丢失。更新 `.env.example` 注释，使复制默认配置无需供应商 key 即可进入本地体验，同时明确禁止用于生产。
3. 在前端目录视图中保留 `availability` 与 activation status；模型设置页和 Composer 对 `available + recorded` 显示“本地测试可用”徽标/说明，对 `live_verified` 才显示生产可用。不得把两者合并成同一“可用”。
4. 复跑 ISSUE-002 的真实浏览器旅程：新建 Work → 选择 fixture 模型 → 接受执行合同 → 提交 Job → 等待 Worker 消费 → 在同一 Work 看到完成结果与 Asset/Content 记录。只修阻断闭环的问题；成品缩略图画廊仍归票 17。
5. 为主工作台首屏四类读取（Projection、模型目录、运营态势、来源状态）补独立 loading/error/empty 分支：局部失败不抹掉可用的“一句话开工”；模型目录失败时明确说明暂不能生成并提供重试，不用永久 disabled 按钮静默代替错误态。
6. 将核心旅程直接渲染的原始 API message 改为用户可理解的固定文案 + “重试”；correlation ID 可放次级详情/复制入口，模块名、action、JSON、stack 与 `data is undefined` 不进入默认界面。开发日志/遥测仍保留原始错误，避免兜底掩盖根因。
7. 以同一候选构建补桌面浏览器证据并回写 ISSUE-002 状态；fixture 与 recorded 两种模式都要走一遍，证明“本地可体验”没有破坏生产门禁。

涉及文件：

- 修改：`.env.example`、`package.json`。
- 复用并按需最小调整：`apps/core/src/p1/model-supply/runtime-config.ts`、`apps/core/src/main.ts`、`apps/core/src/job-worker.ts`（不得放宽现有 production/fixture 边界）。
- 修改：`mkfast-template-main/src/p1/settings-view-model.ts`、`mkfast-template-main/src/p1/model-settings.tsx`、`mkfast-template-main/src/product/unified-creation-workbench.tsx`、`mkfast-template-main/src/product/operations-task-page.tsx`、`mkfast-template-main/src/lib/correlated-api-error.ts`。
- 浏览器复验入口：`mkfast-template-main/playwright.config.ts` 及既有 UIUX/E2E 旅程；证据归档位置沿用 MAP 的 Exit milestone 约定，实施时由票 02 定版。

## DoD（全部必须是用户可见行为；至少 1 条截图对照项：当前产品 vs 对标产品）

- 新克隆且未配置任何模型供应商凭据的用户，按默认本地启动入口进入工作台后，能看到至少一个明确标为“本地测试可用”的模型；完成必要确认后，提交按钮可点击，不再永久灰置。
- 用户完成一次 fixture 生成后，无需另开隐藏页面或手工改数据库，即可在同一 Work 看见 Job 从提交到完成，并看见对应结果记录；刷新或离开再返回后结果仍在。
- 用户在模型设置页与工作台能清楚区分“本地测试可用”和“生产可用”；切回 recorded/生产模拟模式后，本地 fixture 不可提交，也不会被显示成 `live_verified`，系统不会跨品牌 Auto 或静默换模。
- 模型目录、内容簿、运营态势或来源读取任一失败时，用户仍看到可用的页面骨架、白话说明和“重试”；界面不出现 `data is undefined`、模块/action、JSON、stack 或内部部署证据字符串。
- 用户点击“重试”后，失败区进入可见加载态；恢复时原位显示内容，未恢复时仍停留在友好错误态，不整页白屏、不吞掉已填写的一句话意图。
- 截图对照项：同一桌面视口并排保存当前产品 `docs/evidence/browser-dogfood-2026-07-13/screenshots/issue-002-fixture-models-unavailable.png`、升级后同路由 fixture 可提交截图，以及对标产品 `.scratch/creatok-uiux-wayfinding/assets/screenshots/04-image-generator-desktop-live.jpg`；对照中须肉眼可见“默认不可用 → 本地测试可用且可开跑”，并另附升级后首屏失败态截图证明无红色原始错误/JSON。

## Blocked-by / Blocks

- Blocked-by：无。
- 全局关票闸：即使上述 DoD 已满足，票 02 完成前本票仍不得关闭。
- Blocks：作为 Phase 0 共同前置，本票未关闭时 Phase 1-5 不得进入 frontier；同时阻塞 Path B Exit milestone，不改变 MAP 中 06→07→08、09→10、12→13→14 的依赖链。

## 风险与回退

- fixture 泄漏生产：继续以 `APP_ENV=e2e` 硬闸 + `local_fixture_verified` 身份双重约束；发现非 e2e 可提交时立即回退启动配置并关闭入口，不回退为伪造 `live_verified`。
- “可用”语义被再次压扁：前端必须同时保留布尔可提交性与证据身份；若徽标接线异常，回退到不可提交并显示明确原因，不能把 recorded 当生产可用。
- 默认开发入口并发进程不稳定：可回退为一个明确的本地 fixture 启动命令，但该命令仍须一次拉起 Web/Core/Worker；不得回到需要用户自行猜测两个环境变量和漏启 Worker 的状态。
- 友好兜底掩盖真实故障：原始错误仅留在遥测/日志并关联 correlation ID；UI 回退为固定文案、重试和可复制关联 ID，不回退为直接渲染服务端 message。
- 范围蔓延：本票不做结果画廊、流式、轮询任务中心、Chat clone、链接抓取或候选策略改造；这些仍按 MAP 后续票承接。
