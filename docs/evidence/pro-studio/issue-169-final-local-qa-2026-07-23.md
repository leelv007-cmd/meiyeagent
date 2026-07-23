# Issue #169 Pro Studio 最终本地 QA 与证据收口（2026-07-23）

状态：`local candidate / external gates blocked`。本记录的代码基线为
`main@66cdfb7c4b3c4aee988debf8d13f2bd4fd6ec1c5`；没有 push、PR、远端
Issue 或发布状态变更。本地单测、构建和 bundle 结果不能替代浏览器、数据库、
实时 provider 或受保护发布环境的通过证据。

## 结论边界

- G01–G48 的逐行核销依据为
  [`upstream-parity-gap-baseline-2026-07-22.md`](./upstream-parity-gap-baseline-2026-07-22.md)。
  下表记录当前代码和本地单测映射，不把它们写成浏览器或 release pass。
- G42 仍为 `defer`：没有新增 Agent 对话/本机桥/Agent shell。`forbidden-surface`
  单测验证内核不导入 vendor local-agent panel。
- 浏览器 B0 已尝试，但没有进入可见 UI：被动诊断时 3000、4100、4200 均无监听，
  `pg_isready -h 127.0.0.1 -p 54329 -U meiye` 返回 `no response`，Docker 列容器
  API 返回 HTTP 500。随后实际运行
  `pnpm --dir mkfast-template-main e2e tests/e2e/specs/pro-studio-k2-canvas.spec.ts`，
  Playwright 的 `webServer` 在 PostgreSQL migration 阶段因 SQLSTATE `42P07`
  `DrizzleQueryError`（`relation payment_webhook_settlement_outbox already exists`）退出 1，
  并报 `Process from config.webServer was not able to start`。浏览器没有启动、没有截图，
  且没有清理或修改数据库。
- `pnpm pro-studio:conformance` 的本地源码/构建误报已消除；其最终非零退出仅保留
  外部/受保护证据问题：缺 pinned `PRO_STUDIO_UPSTREAM_ROOT`、生产 security drill、
  named manual approval、N2 recovery、audio speech/SFX activation、pricing approval
  和 upsell validation。它不是 release pass。
- #146/#147 的 protected workflow、真实 provider、生产 security drill 与人工审批
  未在本工作树执行，保持阻塞。fixture/recorded 证据不得升格为这些门的通过。

## 本次命令结果

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `pnpm --filter @meiye/canvas test` | 通过：272 pass、0 fail、1 skip | skip 为 trusted payment claim 的条件测试；不代表真实支付。 |
| `pnpm --filter @meiye/canvas typecheck` | 通过 | `tsc --noEmit`。 |
| `pnpm --filter @meiye/canvas typecheck:production` | 通过 | production tsconfig。 |
| `pnpm --filter @meiye/canvas check` | 通过 | Biome + 两类 TypeScript；128 files，零 warning。首次运行发现 #168 export 相邻文件的 9 个格式/导入/隐式 any 错误，已以最小改动修正后复跑。 |
| `pnpm --filter @meiye/canvas build` | 通过 | Next production build；生成的 `next-env.d.ts` 差异已恢复。 |
| `pnpm --filter @meiye/canvas verify:bundle` | 通过 | Canvas 初始 bundle 仍在 450 KiB gzip 门内。 |
| `node --test scripts/pro-studio/conformance-gate.test.mjs` | 通过：23 pass | 覆盖 SSE BFF 单入口和 token-query 脱敏器误报回归。 |
| `pnpm build`（`mkfast-template-main`） | 通过 | Vite client + SSR 均完成；仅有既有 route-test 扫描及大 chunk warning。生成的 Inlang `.gitignore` 已恢复。 |
| `pnpm uiux:bundle-check` | 通过 | initial CSS gzip 42,988 B；initial JS gzip 329,168 B，小于 Main Web 350,000 B 门。 |
| `pnpm pro-studio:conformance` | 阻塞（预期非零） | 只剩上方列出的上游/受保护发布证据；无 client direct-fetch 或 build token-query 本地 finding。 |
| `pnpm --dir mkfast-template-main e2e tests/e2e/specs/pro-studio-k2-canvas.spec.ts` | 阻塞（退出 1，浏览器未启动） | `webServer` migration 的 PostgreSQL `42P07` `DrizzleQueryError`：`relation payment_webhook_settlement_outbox already exists`；随后 `Process from config.webServer was not able to start`；未修改数据库。 |

## G01–G48 矩阵

记号：`C+U` = 已检查代码并有本地 unit/contract 覆盖，且该覆盖包含在本次 Canvas
全测；`C` = 已检查当前源代码，但本次没有独立的行级单测；`B0` = 浏览器 harness 已
尝试但在 PostgreSQL migration 前置失败，未产生可见 UI 证据。所有 `C+U` 都只是本地
候选证据。

| G | 基线能力 | 当前本地代码/测试证据 | 浏览器/阻塞 |
| --- | --- | --- | --- |
| G01 | 五类节点与默认尺寸 | C+U：`kernel-node-adapter.ts`；五类映射和 toolbar defaults 测试。 | B0 |
| G02 | 富节点状态、失败重试、中文状态 | C+U：`kernel-node-adapter.ts`、`node-generation-workbench.tsx`；状态中文化与 retry/cancel contract。 | B0 |
| G03 | 文本字号、mention、生图入口 | C+U：`kernel-canvas-surface.tsx`、`resource-workflow-ui.tsx`、`node-generation-workbench.tsx`；font-size 与 mention tests。 | B0 |
| G04 | 图片大图预览 | C+U：`kernel-canvas-surface.tsx`；owned-image preview test。 | B0 |
| G05 | batch stack/主结果选择 | C+U：`node-generation-workbench.tsx`、`generation-batch-orchestrator.ts`；count/partial failure/primary state tests。 | B0 |
| G06 | 四角 resize、比例锁定、freeResize | C+U：`kernel-canvas-surface.tsx`；resize clamp、media ratio、freeResize tests。 | B0 |
| G07 | 左右连接手柄 | C+U：`kernel-canvas-surface.tsx`；normalized connection tests。 | B0 |
| G08 | 选中/关联/连接目标高亮 | C：`kernel-canvas-surface.tsx` 的 selected/connection drag state；未有本次可见 UI run。 | B0 |
| G09 | 图片信息和资源角标 | C+U：`kernel-node-info.ts`；desensitized image metadata tests。 | B0 |
| G10 | Cmd/Ctrl 框选与 Shift 追加 | C+U：`kernel-canvas-surface.tsx`；command marquee 与 modifier selection tests。 | B0 |
| G11 | 多选 toggle 与 Cmd/Ctrl+A | C+U：surface shortcut/selection tests。 | B0 |
| G12 | 拖线与落空白创建 | C+U：surface connection-drag/create state；connection normalization tests。 | B0 |
| G13 | 连线选择、右键、删除 | C+U：surface connection projection；selected connection/node deletion test。 | B0 |
| G14 | 节点右键复制/删除 | C+U：surface context actions；copy and deletion tests。 | B0 |
| G15 | 小地图 | C：surface 挂载 `Minimap`。 | B0 |
| G16 | 小地图开关、重置、缩放、帮助 | C：surface + `k2-canvas-toolbar.tsx` 控件；未有本次逐控件浏览器确认。 | B0 |
| G17 | 完整快捷键 | C+U：complete canvas shortcut routing test。 | B0 |
| G18 | 复制节点、连线和重定位 | C+U：copy preserves internal edges and relocates group test。 | B0 |
| G19 | 文件拖入和剪贴板图文 | C+U：clipboard payload routing test；上传校验测试。 | B0 |
| G20 | 点/线/空白网格 | C：surface background mode source；未有独立本地浏览器证据。 | B0 |
| G21 | 工程头部/重命名 | C+U：`canvas-shell.tsx`、`project-dialogs.tsx`；project naming journey contracts。产品化 dialog 不等同于上游 inline 的浏览器等价证明。 | B0 |
| G22 | dock 工具栏与五类创建 | C+U：`k2-canvas-toolbar.tsx`、node adapter；five node toolbar defaults test。 | B0 |
| G23 | hover 工具条 | C+U：`kernel-node-hover-toolbar.tsx`；merchant-safe hover info test。 | B0 |
| G24 | 节点信息弹窗/脱敏 JSON | C+U：`kernel-node-info.ts`；info projection/redaction tests。 | B0 |
| G25 | 图片工具栏自定义 | C+U：`image-quick-tools.ts`；catalog/legacy config/local preference tests。 | B0 |
| G26 | 交互式裁剪 | C+U：`retouch-dialogs.tsx`、`retouch-crop.ts`；eight-handle locked crop tests。 | B0 |
| G27 | 局部蒙版重绘 | C+U：`retouch-dialogs.tsx`、`retouch-adapter.ts`；PNG mask lineage and invalid mask tests。 | B0 |
| G28 | 1K/2K/4K 放大 | C+U：`retouch-adapter.ts`；size/algorithm/owned child lineage tests。 | B0 |
| G29 | 网格切分 | C+U：`retouch-adapter.ts`；1–12 grid/layout/lineage tests。 | B0 |
| G30 | AI 多角度 | C+U：`retouch-dialogs.tsx`、`retouch-generation.ts`；bounded angle prompt contract test。 | B0 |
| G31 | 反推提示词 | C+U：`retouch-generation.ts`；authorized image only + durable Config marker tests。 | B0 |
| G32 | 节点内联生成面板 | C+U：`node-generation-workbench.tsx`；context workbench render test。 | B0 |
| G33 | Config 节点生成面板 | C+U：workbench config context + six operation action test。 | B0 |
| G34 | mention chip Composer/只注入引用资源 | C+U：`resource-workflow-ui.tsx`、`resource-workflow.ts`；chip keyboard/recovery and explicit-input tests。 | B0 |
| G35 | 图片/视频/音频参数与比例 | C+U：generation workbench/strict DTO；quality/video/audio/custom-ratio frozen tests。 | B0 |
| G36 | 1–15 批量、部分失败、确认 | C+U：batch orchestrator；1/15 bounds、quote failure、confirmation and refunds tests。 | B0 |
| G37 | 失败重试复用参数 | C+U：generation contract state；retry/cancel only fixed BackendPort actions test。 | B0 |
| G38 | 文本流式回填和断线恢复 | C+U：`canvas-text-stream.ts`；authenticated SSE, Last-Event-ID and recoverable cursor tests。 | B0 |
| G39 | 提示词分类搜索和兼容性 | C+U：`resource-workflow-ui.tsx`；cursor/category/query and safe presentation tests。 | B0 |
| G40 | 资源 @mention | C+U：resource composer；candidate/chip/delete/explicit DTO tests。 | B0 |
| G41 | 素材三类 tab/搜索/分页/视频音频上传 | C+U：asset picker + resource workflow；cursor and image/video/audio validation tests。 | B0 |
| G42 | Agent 对话助手外壳 | `defer`：按基线独立票；forbidden-surface tests 防止引入 local Agent bridge。 | 不适用；不得伪造为 pass |
| G43 | 工程信息、重命名、单项导出 | C+U：`canvas-shell.tsx`、`project-dialogs.tsx`、`canvas-export-client.ts`；project metadata/export intent tests。 | B0 |
| G44 | 产品化删除确认 | C+U：`DeleteProjectsDialog` 和 project selection/delete contracts。 | B0 |
| G45 | 隐藏 workspace/type/seed 标识 | C+U：project journey、node info、generation workbench tests 均检查 merchant-safe labels。 | B0 |
| G46 | 加载骨架 | C：`canvas-shell.tsx` load state 与 `resource-workflow-ui.tsx` loading states；无独立可见浏览器证据。 | B0 |
| G47 | 用户侧模型选择 | C+U：`node-generation-workbench.tsx`、catalog contract；只显示 active current-operation models，audio 无 live evidence 时 fail-closed。 | B0 |
| G48 | Canvas ZIP 数据导出 | C+U：`canvas-export.ts`、Core asset client、dialog/client；frozen revision、policy fail-closed、receipt idempotency、redaction、size cap tests。 | B0；非真实生产存储/权限证明 |

## 已复核的安全与发布边界

- #168 export：本地测试覆盖冻结 revision、服务端授权读取、撤权/过期/private
  retrieval fail-closed、可选 available-only、receipt 幂等、恶意文件名/嵌套 secret
  脱敏、50 MiB 总量上限。它不替代生产对象存储、撤权或真实审核证据。
- Canvas bundle：production build 后的专用 gate 通过；Main Web 350KB 专用 gate 也通过。
  两者均只是当前工作树 build 输出。
- `release-evidence.json` 仍把 security matrix 标为 `partial`，audio activation 标为
  `blocked`，且 pricing/upsell 为 null；没有修改这些记录来伪造通过。
- 本地 conformance 现在能继续扫描 source 与 build，不再把同源 SSE BFF 调用或 export
  脱敏器误报为违规；仍严格拒绝 direct token query、agent shell、local token storage、
  任意 provider target 和本地假任务面。

## 浏览器重跑前置

先恢复 Docker/PostgreSQL，并由测试夹具提供干净、隔离的测试数据库（当前 migration
因已存在的 `payment_webhook_settlement_outbox` 失败）；随后需以 `MODE=e2e` 的真实
Main + Core + Worker + Canvas harness 重跑
`mkfast-template-main/tests/e2e/specs/pro-studio-kernel-ui.spec.ts`、
`pro-studio-k2-canvas.spec.ts`、`pro-studio-cross-service-smoke.spec.ts` 和
`pro-studio-security-boundaries.spec.ts`，再用 snapshot-first Playwright CLI 从可见 UI 完成：
选节点打开生成、catalog fail-closed/参数、@ mention、1–15 报价确认/批量重试取消、SSE
断线恢复、资源工作流、工程新建/重命名/删除/导出与 beforeunload。只有届时的截图和日志
才可写入 `output/playwright/` 并作为 B0 的替代证据。
