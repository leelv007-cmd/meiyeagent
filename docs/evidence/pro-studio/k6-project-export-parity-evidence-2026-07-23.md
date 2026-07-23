# K6 项目管理 / ZIP 导出对标（G43–G48）验证证据（2026-07-23）

状态：`local candidate / real-stack verified`。代码基线 `canvas-k6`（起于
`main@d6787b29`）。本记录只覆盖 Issue #168（PRO-K6）残差，未 push、未改远端 Issue
状态；`MODEL_EXECUTION_MODE=fixture`。

## 背景：#168 残差的真实面貌

G43（项目卡片）/ G44（删除确认）/ G45（语言泄漏清除）/ G46（加载态）/ G48（ZIP 导出）
+ adoption selector 在 `d6787b29` 基线上**功能均已落地并接线**：`canvas-shell.tsx` 的
project-rail / project-card / 组件化删除弹窗（`project-dialogs.tsx` 的
`DeleteProjectsDialog`，已替换 `window.confirm/prompt`）、`project-journey.ts` 的商家安全
投影（`merchantSafeWorkspaceDisplayName` + `projectCardMetadata`）、ZIP 导出全链路
（client `canvas-export-client.ts` → HTTP `backend-port.ts` exportCanvas → server
`canvas-export.ts` `CanvasRevisionExportService`，manifest `pro-studio-canvas-export/v1`）。
真实残差 = **缺 Playwright 端到端证据**（尤其 ZIP 导出的下载 + manifest 校验腿）+ vozeb
重复死件清理。

**但真机 e2e 首跑揭出一个被单测漏掉的 P0 阻塞缺陷**（见下"根因"节）：ZIP 导出在真实
Postgres 下 100% 失败。功能"接线了"不等于"跑得通"——合同/单测用 fake 仓库，从未触及
真库那条会崩的 SQL。

## 根因：导出回执 advisory-lock 键含 NUL 字节（真库必崩，单测测不到）

- **现象**：Test 2 点"下载 ZIP"后 `waitForEvent('download')` 超时；截图状态栏实锤
  "导出失败：Canvas export is not available."（服务端 `unavailableExport()` /
  `EXPORT_NOT_AVAILABLE`）。
- **定位**：`CanvasRevisionExportService.export()` 把内部异常 catch 吞成 unavailable 且不写
  audit。临时在三处 catch 加诊断日志重跑，抓到被吞的真实异常：
  `[k6dbg] claim failed: invalid byte sequence for encoding "UTF8": 0x00`。
- **真凶**：`apps/core/src/pro-studio/postgres-canvas-export-receipt-repository.ts` 的
  `locked()` 用 `pg_advisory_xact_lock(hashtext($1))`，而 `$1` =
  `` `${workspaceId}\0${userId}\0${idempotencyKeyHash}` ``——用 **NUL（0x00）** 做分隔符。
  Postgres text 类型不能承载 NUL 字节，直接抛错 → `claim` 抛错 → 被吞成 unavailable →
  下载永不触发。`locked` 被 `claim` 与 `complete` 共用，一处即两处。
- **为何单测没抓到**：`postgres-canvas-export-receipt-repository.test.ts` 用**假 query
  mock**（内存模拟 audit ledger），advisory-lock 的 SQL 只被记录、从不真正执行，NUL 永不
  触达 Postgres；canvas-export 合同测试也用 fake 回执仓库。只有真库 e2e 才会触发。
- **修复**（最小外科）：把 NUL 分隔的复合键在 JS 内先 `sha256` 成无 NUL 的 hex 摘要，再交给
  `hashtext($1)`。保持每个 `(workspaceId, userId, idempotencyKeyHash)` 元组的确定性
  advisory-lock 语义（claim / complete 仍锁同一键），只让 Postgres 收到 NUL-free 字符串。
- **同类 bug 排查**：其余 `\0` 用法（`advanced-canvas-project.ts` `this.key()`、
  `canvas-asset-facade.ts`）均为**内存 Map key**（不入 pg，安全）；其他 pg advisory-lock
  （adoption / product / entitlement-pools）用单值 `hashtext($1)` 无 NUL。无其他实例。

## G43–G48 证据矩阵

| G | 能力 | 通路 | 逻辑/实现 | UI/浏览器 | 结果 |
|---|---|---|---|---|---|
| G43 | 项目卡片 | 商家投影 | `project-journey.ts` `projectCardMetadata`（只出节点/连线计数 + 更新时间，无 id/类型） | **Test 1**：新建两工程 → `.project-card` 可见、`small` 匹配 `/\d+ 个节点 · \d+ 条连线/`、`.project-card-open` 重开切换 active | ✅ 完整 |
| G44 | 删除确认 | 组件 dialog | `project-dialogs.tsx` `DeleteProjectsDialog`（已弃 `window.confirm/prompt`） | **Test 1**：删除 → `getByRole('dialog',{name:'删除 1 个工程？'})` 可见 + 取消/移入回收保留区按钮 + `page.on('dialog')` 守卫断言零原生弹窗 → 确认后卡片移除 | ✅ 完整 |
| G45 | 语言泄漏清除 | 商家安全命名 | `project-journey.ts` `merchantSafeWorkspaceDisplayName`（UUID/ws_/tenant_ 标识符 → 回退"当前工作区"） | **Test 1**：`.workspace-name` 断言非 UUID、非 `ws/workspace/tenant/org` 前缀；卡片仅出中文计数 | ✅ 完整 |
| G46 | 加载态 | 骨架 + aria-busy | `canvas-shell.tsx` `projectLoadState` + `.project-list-skeleton` | **Test 1**：`page.route` 扣住首个 listProjects → 断言"正在加载工程" + `.project-list[aria-busy=true]` → 放行 → 断言隐藏 + `aria-busy=false` | ✅ 完整（确定性，非竞态） |
| G48 | ZIP 导出 | 冻结检查点 → 服务端 ZIP | `canvas-export.ts` `CanvasRevisionExportService`（manifest `pro-studio-canvas-export/v1`）+ 合同测试（`canvas-export.test.ts`：真实 ZIP manifest / 素材装包 / 去重 / 密钥脱敏 / 大小上限 / includeAvailableOnly） | **Test 2**：建工程 + 文字节点 + 检查点 → 导出弹窗 → 下载 ZIP → `waitForEvent('download')` 捕获 → **fflate `unzipSync` 解压** → 校验 `manifest.json` format=`pro-studio-canvas-export/v1` + project.id/revisionId **与导出请求体交叉核对** + `revision.json` 内容含文字节点 | ✅ 完整（含 NUL 阻塞修复） |
| — | adoption selector | 采用/复用 | 基线已落地并接线（`canvas-shell.tsx` RuntimePanel / adoption） | 属既有功能，非本票 e2e 残差；不在本轮新增浏览器断言范围 | ➖ 既有 |
| — | 死件清理 | vozeb 重复组件 | 删除零引用死件 `canvas-project-card.tsx` + `canvas-delete-projects-dialog.tsx` | typecheck 无断裂 | ✅ |

## ZIP 导出下载校验证据（Test 2 硬断言）

真机下载的 `canvas-export.zip` 经 `fflate.unzipSync` 解压后逐项硬断言：

- 下载文件名 `download.suggestedFilename() === 'canvas-export.zip'`。
- 压缩包内容物 `= ['manifest.json', 'revision.json']`（无素材节点故无 `assets/` 项，确定性）。
- `manifest.json`：`format === 'pro-studio-canvas-export/v1'`、`exportReceiptId` 非空、
  `assets === []`、`warnings === []`、`project.id` / `project.revisionId` 非空。
- **完整性交叉核对**：`manifest.project.id === 导出请求体.projectId` 且
  `manifest.project.revisionId === 导出请求体.revisionId`（导出绝不静默改投目标）。
- `revision.json`：`id === manifest.project.revisionId`、`projectId === manifest.project.id`、
  `graph.nodes.length > 0`（冻结前加入的文字节点已进入 revision）。
- 通路断言：`uiActions` 含 `createProject` 与 `exportCanvas`（导出走专用 canvas 导出 action）。

**素材装包腿的诚实边界**：e2e 刻意导出**无素材节点**的冻结检查点——此路径不触达 Core 的
`canvas_export_asset` 远程解析，故对 Core 对象存储/导出策略/回执校验**零依赖**，下载必定
确定性成功。`manifest.assets` 合法为空。素材 → `manifest.assets` 填充 → ZIP `assets/` 项的
**substantive 装包腿由服务端合同/单测覆盖**（`canvas-export.test.ts:154`「exports governed
local imports and generated audio through Core into a real ZIP manifest」等 8 例，含去重/密钥
脱敏/大小上限/includeAvailableOnly 降级）。这是分层验证的诚实边界，非能力伪造。

## 命令结果

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `pnpm --filter @meiye/canvas typecheck` | EXIT=0 | 删 2 个 vozeb 死件后 `tsc --noEmit` 无断裂。 |
| `pnpm --filter @meiye/canvas test` | 272 pass / 0 fail / 1 skip | 含导出合同测试三件套；skip=trusted payment 条件测试；死件删除 + canvas-export.ts 还原后仍绿。 |
| `pnpm --filter @meiye/core typecheck` | EXIT=0 | NUL 修复后 `tsc --noEmit`。 |
| core 导出回执测试（2 文件 4 例） | 4 pass / 0 fail | `postgres-canvas-export-receipt-repository.test.ts` + `canvas-export-receipt.test.ts`，NUL 修复不破坏 mock 测试。 |
| e2e `pro-studio-project-export.spec.ts` | **2 passed, EXIT=0**（1.1m） | 真 4 服务栈（Core/Worker/Main/Canvas）+ 隔离 PG `meiye_k6` + fixture；Test 1 项目管理旅程（G43-G46）13.6s、Test 2 ZIP 导出（G48）5.3s。 |

诊断轨迹（可复现）：修复前 `1 passed / 1 failed`（Test 2 `waitForEvent('download')` 超时，
截图=服务端 `EXPORT_NOT_AVAILABLE`）→ 加诊断抓 `claim failed: 0x00` → 修 NUL → `2 passed`。

## 改动文件

- 新增 e2e：`mkfast-template-main/tests/e2e/specs/pro-studio-project-export.spec.ts`（2 test）。
- 修复（P0 导出阻塞）：`apps/core/src/pro-studio/postgres-canvas-export-receipt-repository.ts`
  （advisory-lock 键 NUL → JS sha256 hex；+`createHash` import）。
- 删除死件：`apps/canvas/src/vendor/vozeb/app/(user)/canvas/components/canvas-project-card.tsx`
  + `canvas-delete-projects-dialog.tsx`（删前二次 grep 确认零引用，含组件名）。
- 新增证据：本文件。
- 诊断代码（canvas-export.ts 三处 `[k6dbg]` 日志）已在定位后**全部还原**，源码零残留。

## 遗留缺口（诚实登记）

1. **素材装包 e2e**：ZIP `assets/` 项填充（素材 → manifest.assets → 压缩包字节）未走浏览器
   e2e，由服务端合同/单测覆盖（见上"诚实边界"）。补齐路径：e2e 上传 owned asset + Core
   `canvas_export_asset` 真机解析后，扩 Test 2 断言 `manifest.assets.length>0` 与
   `assets/asset-001.png` 存在。
2. **NUL 修复的回归护栏 = 仅本票真库 e2e（CI 门控须知，⚠️ 高危）**：现有
   `postgres-canvas-export-receipt-repository.test.ts` 是 fake-pool，advisory-lock SQL 从不
   真执行，永远测不到 NUL 崩溃。**该 P0 的唯一回归护栏就是本票这条真库 e2e**——**若 CI 门控
   skip 真库（本仓持久层测试默认 env-gated 跳过，参见默认 `pnpm test` 的 48 skipped），则该
   P0 在 CI 层完全失去护栏，NUL 类回归会静默溜过（异常被吞成 unavailable、下载静默不触发，本
   轮首跑正是此形态）**。建议二选一或并行：①新增 env-gated 真 Postgres 单测，断言
   `claim`/`complete` 对含特殊/边界字符的 workspace/user 不抛错；②把本 spec
   （`pro-studio-project-export.spec.ts`）纳入 CI 真机 e2e job（真 4 服务栈 + 真 PG）。本轮按
   team lead 决定不扩范围加①，此处登记为明确的后续护栏建议。
3. **claim/complete 同键锁语义（修复自证，供复核）**：`locked` 只用
   `(workspaceId, userId, idempotencyKeyHash)` 三字段构键，`claim(input)` 与
   `complete(input.receipt)` 传入的这三字段同源同值；sha256 是这三字段的确定性函数，故两侧算出
   的 hex → `hashtext` → advisory-lock **完全同键**，修复未破坏"同一导出请求 claim/complete
   锁同一键"的序列化语义。
