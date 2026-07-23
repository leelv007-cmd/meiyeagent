# K4 节点生成 UI 集成对标（G32–G47）分层验证证据（2026-07-23）

状态：`local candidate / browser + layered verification`。代码基线 `canvas-k4`（起于
`main@d6787b29`）。本记录只覆盖 Issue #166（PRO-K4）残差，未 push、未改远端 Issue
状态；`MODEL_EXECUTION_MODE=fixture`。真实 live 发布证据仍归 #119 / #146。

## 背景：#166 残差的真实面貌

`CanvasNodeGenerationWorkbench`（`apps/canvas/src/client/node-generation-workbench.tsx`）
由 `canvas-shell.tsx` 的「节点生成」工具栏按钮打开，复用 #167 的 `ResourceMentionComposer`、
服务端 `getCatalog`、`quote/submit/retry/cancelGeneration` 既有动作，并用
`generation-batch-orchestrator.ts` 做策略 B 前端 fan-out（N 次单张）。功能与后端通路
**已落地并接线**（scout 复核零 stub/TODO），单测/合同测试扎实。真实残差是
**缺浏览器证据**（证据文档 `issue-166-node-generation-ui-integration.md:48-49` 自认
「非浏览器/live/db 验收证据」），不是缺功能。本轮补齐浏览器 e2e。

## 关键环境事实（决定分层边界）

Canvas 工作台目录（`getCatalog`）的能力**激活**取决于「已验证工作区供给」
（`ensureVerifiedWorkspaceProvisioned` → `register_gift` + `provision_model_defaults`），
该供给**只由 Main→Core 代理请求同步触发**（`src/lib/core-client.ts`），
**pro-studio→canvas 单独的流程不触发**（Canvas 的 `getCatalog` 路径不经过它）。
e2e webServer 已配置平台默认模型（`E2E_PLATFORM_DEFAULT_MODEL_IMAGE=gpt-image-2` 等）。
经实测（丢弃式探针捕获 `getCatalog` 响应）：

- 进 canvas 前**先访问 Main 仪表盘路由**（`/dashboard`）触发供给后，目录变为：
  `image.generate=active`（模型 `gpt-image-2`，`allowedParameters=[width,height]`）、
  `video.generate=active`（`seedance-2`）、`audio.speech=active`（`audio-speech-fixture`）。
- `image.edit` / `text.respond` / `audio.sfx` **保持 inactive**（非平台默认，不激活）。

因此：**image.generate = 平台已 seed 且可激活 → 完整浏览器旅程**；
**image.edit / text.respond = 未 seed → 诚实降级 e2e + 分层（单测/合同）**。此边界与 K3
（image.edit/text.respond 未 seed）一致，且诚实纪律下不伪造激活。

> 注（供 main 参考，非本票缺陷）：`gpt-image-2` 只暴露 `width/height`，不含 `ratio`；
> 故「自定义比例」控件对该模型不出现，G35 以自定义 width/height 作浏览器证据，比例归一化
> 归分层。此外工作台不做轮询（设计如此），提交后任务停在「核对中/额度已预留」可取消态，
> 不自然到达 failed，故「重新生成」按钮不出现（见 G37）。

## G32–G47 证据矩阵

| G | 能力 | 通路 | 逻辑（纯函数/合同） | UI/浏览器 | 结果 |
|---|---|---|---|---|---|
| G32 | 内联生成面板 | 工作台挂载 | `node-generation-contract.test.ts`、`generation-adapter.test.ts` | **test1**：选中图片节点→「节点生成」→ `.node-generation-workbench` 可见 | ✅ 完整 |
| G33 | 配置面板 | 生成方式/模型/参数/数量 | `node-generation-contract.test.ts`（availability/controls/strict 参数） | **test1**：「编辑图片/生成图片」动作（aria-pressed）+ 模型选择 + 生成设置 + 生成数量 | ✅ 完整 |
| G34 | @mention 复用 #167 composer | `ResourceMentionComposer` | `resource-workflow*.test.ts`（@提及键盘/chips） | **test1**：向 `role=textbox`「生成提示词…」输入指令启用报价（同一 #167 composer，作用域限工作台） | ✅ 完整（提及键盘导航分层） |
| G35 | 设置 + 自定义比例 | 严格参数/比例归一 | `generation-ui-contract`（`isStrictCanvasGenerationParameterValue`/`normalizeCanvasGenerationRatio`） | **test1**：自定义 width/height 设置进入冻结报价（模型 gpt-image-2 的实参） | ✅ 设置完整；自定义**比例**控件依模型（本模型不暴露）→ 归一化分层 |
| G36 | 数量/批量/部分失败 | 策略 B fan-out N×单张 | `generation-batch-orchestrator.test.ts:144`（部分报价失败阻断确认、提交归零） | **test1**：生成数量=2 → 报价汇总「2 项」/「已报价」×2 → 确认提交 → 批量生成结果「已提交 2/2」 | ✅ 数量/批量完整；部分失败分层 |
| G05 | 批量堆叠 | 堆叠 + 主图 + 展开 | `node-generation-contract.test.ts:368`（快照保留冻结输入 + 主图/重试/取消/刷新） | **test1**：「展开全部」→ 2 张 `.canvas-generation-job-card`；点「设为主图」→ 卡头 `第 1 项`→`主图` | ✅ 完整 |
| G37 | 冻结参数重试 | 重试复用冻结输入 | `node-generation-contract.test.ts:368/452`（冻结输入保留 + 仅用固定 BackendPort 动作 + 隐藏标识） | **test1**：任务停在「核对中/额度已预留」可取消态（工作台不轮询）；`failed` 才现「重新生成」→ 本 fixture 不自然产生 | ⚠️ 分层（retry e2e 需 recorded 失败供给，与 #119 同源） |
| G38 | 文本流 SSE | `text.respond` + `canvas-text-stream` | `canvas-text-stream.test.ts`（SSE 序号/游标/recoverable 不重试） | **test2**：`text.respond` 诚实标未激活（非平台默认）→ 文本流入口门控 | ⚠️ 分层（text.respond 未 seed；完整 SSE 流 e2e 需激活 text 供给） |
| G47 | 内联 ModelPicker（诚实） | `unavailableModelReason` 剥离 provider/deployment | `node-generation-contract`（`isSafeDisplayText` 过滤 provider/deployment/uuid/token/url） | **test2**：image.edit/text.respond 输出商家安全的未激活原因，**无 provider/deployment/llm-/ws_/uuid/https 泄漏**；**test1**：可用模型标签脱敏为「可用模型 N」 | ✅ 完整 |
| — | 诚实降级 fail-closed | availability 未激活即门控 | `node-generation-contract.test.ts`（availability/`hasActiveGenerationModel`） | **test2**：image.edit 默认不可用（模型选择 disabled + 安全原因 + 报价按钮 disabled）；切「生成图片」证明可用侧被区分 | ✅ |
| — | 后端真连（非假 job） | 固定 BackendPort 动作 | — | **test1**：`uiActions` 含 `createProject/createCheckpoint/quoteGeneration/submitGeneration`（真打服务端） | ✅ |
| — | 批量快照持久 | 服务端持久 + 一次性水合 | `node-generation-contract.test.ts:368`（reconcile 幂等） | **test1**：设主图后 save→reload→重开工作台，批量堆叠「已提交 2/2」水合恢复 | ✅ |

## 命令结果

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `pnpm --filter @meiye/canvas test` | 通过：272 pass / 0 fail / 1 skip | 未改 canvas 应用代码；skip 为既有 trusted payment 条件测试。 |
| `pnpm --filter @meiye/canvas typecheck` | 通过（exit 0） | `tsc --noEmit`。 |
| e2e `pro-studio-node-generation.spec.ts` test1（完整 image.generate 旅程） | 通过：1 passed（14.6s） | 隔离栈（PORT=3401/CORE=4401/CANVAS=4501/`meiye_k4`）+ 四服务真机 + fixture；建工程→上传源图→节点生成→切 image.generate→配置数量2/自定义尺寸/模型→报价「2 项」→确认提交→批量堆叠「已提交 2/2」→展开2卡→设为主图→刷新水合恢复。 |
| e2e `pro-studio-node-generation.spec.ts` test2（诚实门控 G38/G47） | 通过：1 passed（7.4s） | image.edit/text.respond 诚实标未激活、报价按钮 disabled、原因无 provider/deployment 泄漏；切 image.generate 证明可用侧被区分。 |
| e2e 汇总 | `2 passed (1.0m)` EXIT=0 | 同一次运行。 |

## 诚实缺口（登记，与 #119 同源）

1. **G37 完整重试 e2e**：「重新生成」仅在 `job.status === "failed"` 出现；工作台不轮询，
   fixture image.generate 提交后停在「核对中/额度已预留」可取消态，不自然到达 failed。
   冻结参数重试由 `node-generation-contract.test.ts:368/452` 证（保留冻结输入 + 仅用固定
   BackendPort 动作）。补齐路径：为 e2e 注入一个 recorded 失败供给再走完整 retry→卡片状态断言。
2. **G38 完整文本流 e2e**：`text.respond` 非平台默认，fixture 未激活（诚实标未激活）。SSE
   序号/游标/recoverable 由 `canvas-text-stream.test.ts` 证。补齐路径：为 e2e seed 一个
   text.respond 供给再走完整流式→文本节点写入断言。
3. **G35 自定义比例控件**：`gpt-image-2` 只暴露 width/height，故比例自定义控件对该模型不渲染；
   比例归一化由 `generation-ui-contract` 单测证。补齐路径：为 e2e seed 一个 ratio 型图片模型。

以上均属「需真实/recorded 供给环境」范畴，非 UI 缺陷，不伪造激活。

## 证据文件

- e2e：`mkfast-template-main/tests/e2e/specs/pro-studio-node-generation.spec.ts`（新增，2 test）
- 实现（既有，本轮未改）：`apps/canvas/src/client/node-generation-workbench.tsx`、
  `node-generation-contract.ts`、`generation-batch-orchestrator.ts`、`canvas-shell.tsx`、
  `resource-workflow-ui.tsx`（#167 composer）
- 纯函数/合同（既有）：`node-generation-contract.test.ts`、
  `generation-batch-orchestrator.test.ts`、`canvas-text-stream.test.ts`、
  `generation-adapter.test.ts`

## 备注：selector / test-id

未新增 test-id。工作台元素均以既有稳定 selector 定位（`aria-label`「节点生成/报价汇总/
批量生成结果」、`role=textbox`「生成提示词…」、动作按钮文案、`.node-generation-workbench`
根类、卡片 `.canvas-generation-job-card` 与其 `<strong>` 卡头），无需额外 test-id，
保持零应用代码改动。
