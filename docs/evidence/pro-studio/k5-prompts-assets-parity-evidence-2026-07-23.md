# K5 提示词库 / @mention / 素材对标（G39–G41）验证证据（2026-07-23）

状态：`local candidate / layered verification`。代码基线 `canvas-k5`（起于
`main@d6787b29`）。本记录只覆盖 Issue #167（PRO-K5）残差，未 push、未改远端 Issue
状态；`MODEL_EXECUTION_MODE=fixture`。真实 live 发布证据仍归 #119 / #146。

## 背景：#167 残差的真实面貌

复核 `d6787b29` 基线：三个资源工作流控件**其实已经实现并接线**——
`PromptLibrary` / `CanvasAssetPicker` / `ResourceMentionComposer`
（`apps/canvas/src/client/resource-workflow-ui.tsx`），逻辑纯函数
（`resource-workflow.ts`）与单测齐备，且 `runtime-panel.tsx` / `canvas-shell.tsx`
已消费它们。真实残差是：**一个真 bug（提示词库恒 503）** + 缺浏览器证据 + 一处 A3
治理状态未闭环 + 一条 stale e2e 断言。

## 真 bug：`listPrompts` 恒 503（PROMPT_CATALOG_UNAVAILABLE）

`runtime-panel.tsx` 的 `PromptLibrary` 通过 Canvas facade 动作 `listPrompts` 读取
**受治理的提示词目录**（`kernel-mount-contract.test.ts` 明令 RuntimePanel 不得直接
引用本地种子语料）。而 `backend-port.ts:1082-1089` 的 `listPrompts` 分支在
`this.options.prompts` 缺失时抛 `CanvasContractError("PROMPT_CATALOG_UNAVAILABLE",503)`。

根因：`server/runtime.ts` 装配 `CanvasBackendPort` 时注册了 agent/assets/
entitlement/exports/generation/projects/securityAudit/sessions/workspace，**独缺
`prompts`**。故 `options.prompts` 永远 undefined → 每次打开提示词库都恒 503，库永远
报错、种子语料（`CANVAS_PROMPT_SEEDS`，40 条，此前**无任何生产消费者**）永不可达。

### 修复（接线 + 边界修正）

| 改动 | 文件 | 说明 |
| --- | --- | --- |
| 种子数据移到共享位置 | `client/prompt-seeds.ts` → **`shared/prompt-seeds.ts`**（+移动同名单测） | 服务端 provider 需消费种子，但项目**无 server→client 既有跨界**；移到 `src/shared/` 使 client 助手/测试与 server provider 共用**单一事实源**，避免运行时装配层 import `client/`。同步更新 `prompt-seed-actions.ts` / `engineering-ticket-journeys.test.ts` 引用，并把 `src/shared` 纳入 `check` 脚本 biome 范围。 |
| 服务端目录来源 | **`server/prompt-catalog.ts`**（新增） | `listCanvasPromptSeeds()` 把每条产品自有种子映射为 `{category,id,prompt,title}`；`promptSeedCategory(operation)` 按能力打**可回环**分类标记（image.generate→"视觉"，可被 `resource-workflow.promptCapabilities` 还原为 image.generate，故能力激活时可插入）；`promptSeedTitle` 从提示词首句派生**人话 title**，不泄漏内部 fileName。类型不锁死单一 operation（helper 接受完整 `CanvasGenerationOperation` 枚举，为未来非图像种子就绪）。 |
| 接线 provider | `server/runtime.ts` | options 增 `prompts: { async list() { return listCanvasPromptSeeds(); } }`。 |

修复后：`listPrompts` 返回 40 条种子（cursorPage 单页 ≤50，全量一页返回），提示词库
不再 503。

## A3 治理：`a3EvidenceStatus:"pending"` → 已闭环

`a3-authorization-2026-07-19.md` §2 明确 disposition：
> Prompt / seed corpora from Vozeb — **Not authorized for bulk copy.** Pro Studio
> seeds remain **product-owned static recipes (Ticket 16)**, not a Vozeb dump.

我们的 40 条种子恰是该条所指：`owner:"product"`、`source` 为内部设计文档
`seed-visual-pack-prompts-2026-07-14.md` 的原创美业提示词，非第三方语料。据此把
`CANVAS_PROMPT_SEED_MANIFEST.a3EvidenceStatus` 从 `"pending"` 解为 `"product-owned"`，
并新增 `a3Evidence` 指针指向该授权文档，使 disposition 可审计。这是**记录已确立的
治理结论**（第一方产品自有、按排除法出第三方门），非杜撰放行。

> 边界说明：spec §18 指派 K1 做**上游共享控件**（Vozeb 派生的 image-settings-panel /
> prompt-select-dialog 等组件层）的 A2/A3 授权范围判定——那是不同对象。本条只闭环
> **产品自有种子语料**的 A3 状态（spec §16 的 K5 lane），不越界 K1 的共享控件判定。

### 诚实登记的剩余项（非本轮闭环）

- **种子 schema 的 operation 类型解锁**：spec §16 提"类型不再锁死单一 operation"。
  已兑现——`CanvasPromptSeed.operation` 的**类型**已从字面量 `"image.generate"` 加宽为完整
  `CanvasGenerationOperation` union（见 `shared/prompt-seeds.ts`），接缝层 category helper 亦按
  完整枚举 operation-general。种子**数据值**当前 40 条仍全为 image.generate（设计文档现状），
  未投机填入非图像种子——待真有非图像种子时再随数据落地，避免未使用的 flexibility。这是
  刻意的 surgical 取舍（类型就绪、数据不投机），非遗漏。

## stale e2e 修复

`pro-studio-engineering-tickets.spec.ts` "ticket 16" 原断言已删除的旧 seed `<select>`
下拉（`美业提示词起点（40 条）` / `选择一条产品提供的提示词` / 41 个 option）——该 UI
已被 `PromptLibrary` 取代，断言恒红。改为断言现有受治理提示词库：打开"提示词库"→
弹窗可见 → 种子卡加载（>1）→ **不出现 503 错误输出**。surgical，仅替换 204–220 块，
保留 setup 与截图。**未触** `pro-studio-kernel-ui.spec.ts`（K7 范围）。

## 能力激活门（e2e 环境事实 + 激活方式）

初版 e2e 观测到能力面板全"未激活"，一度误判为 #119 同源诚实降级。**深挖修正了自己的
判断**：`registerE2EUser` 建的用户其实 `emailVerified: true`（`tests/e2e/fixtures/auth.ts:67`），
不是未验证。真因是 verified-workspace 供给（`ensureVerifiedWorkspaceProvisioned`，
`mkfast-template-main/src/lib/core-client.ts:45`，`emailVerified && owner` 时 **inline await** 跑
`provision_model_defaults` → 默认模型 → 能力激活）**只在 Main app 的 authenticated Core 请求路径
触发**；而 `pro-studio → canvas` launch 直连**不发 Main→Core 请求**，故直连进画布时工作区尚未
供给、能力恒未激活。**激活方式**（团队 K4 环境事实复用）：e2e 先访问 `/dashboard`（其 P1 query
走 `forwardAuthenticatedCoreRequest` → inline 跑完供给），再进画布 → `getCatalog` 报 image.generate
已激活 → 完整旅程可跑。

> 全部种子 = `image.generate`（平台 `PREFERENCE_OPERATION_BY_CONFIG_KEY` 四个已 seed 之一：
> copy/image/video/audio 的 generate/speech）。**image.edit/text.respond 平台真不 seed**，即便触发
> 供给也不激活——本票不依赖它们（提示词插入/@mention 是文本/引用操作，只需 image.generate 能力
> 激活以启用 composer 面；真正的"提交生成"job 不在本票 e2e 范围）。故升级走的是可激活的
> operation，未撞"平台真不 seed"的墙。`E2E_PLATFORM_DEFAULT_MODEL_IMAGE=gpt-image-2` 是平台
> 默认**模型配置**，须经上述供给才落到工作区目录激活。

## G39–G41 证据矩阵（完整激活旅程）

| G | 能力 | 逻辑（纯函数） | UI/浏览器（image.generate 激活后完整旅程） | 结果 |
|---|---|---|---|---|
| G39 | 受治理提示词库 | `prompt-catalog.test.ts`（40 条映射/category=视觉可回环 image.generate/人话 title 不泄漏 fileName）、`prompt-seeds.test.ts`（40 条对齐设计文档 + A3 已解为 product-owned）、`resource-workflow.test.ts`（既有：兼容性/分类/搜索） | **新 e2e test1**：/dashboard 激活 → 能力面板 `图片生成 可用` → 库加载 **40 卡**、无 503 错误输出、`营销画面` 分类页、`listPrompts` 命中 → 点**"插入"** → 提示词落入 composer editor（非空） | ✅ 完整 |
| G40 | @mention 引用资源 | `resource-workflow.test.ts:105`（既有全链：`filterResourceMentionCandidates`/`mentionKeyboardAction`/`findResourceMentionRange`/`insertResourceMention`/`replaceResourceMention`/`removeResourceMention`） | **新 e2e test2**：composer 启用 → **`@ 引用资源`** → 候选菜单（`listbox 资源引用候选`）→ 选中上传素材 option → **已引用 chip**（含"移除"按钮）可见 | ✅ 完整 |
| G41 | 素材选择器插入画布 | `resource-workflow.test.ts`（既有：`validateCanvasUpload` 等） | **新 e2e test2**：上传（→节点1）后点**"插入画布"**→节点2、picker 关闭、`listAssets` 命中 | ✅ 完整 |
| — | 真 bug 不回归 | 契约 | `backend-port.test.ts`（既有：listPrompts 经 category/query 过滤返回）；provider 现由 runtime 真实注册 | ✅ |

## 范围外（非本票缺口）

- **完整生成 job**（quote → submit → GenerationJob → 插入产物）不在本票 e2e 范围——本票收口
  的是资源工作流三面（提示词库 / @mention / 素材选择器），已在 image.generate 激活后完整走通。
  生成 job 的 live/recorded 连通归 #119 / 生成链路票，非本票 G39–G41 残差。

## 命令结果

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `pnpm --filter @meiye/canvas test` | 通过：276 pass / 0 fail / 1 skip | 含新增 `prompt-catalog.test.ts`（3 例）+ A3 解析用例；移动后的 `prompt-seeds.test.ts` 保持 40 条对齐；skip 为既有 trusted payment 条件测试。 |
| `pnpm --filter @meiye/canvas typecheck` | 通过（EXIT 0） | `tsc --noEmit`。 |
| biome（canvas 改动文件 + `src/shared` + e2e spec） | 通过 | `src/shared` 已纳入 `check` 脚本 biome 范围。 |
| e2e 最终合并跑（新 spec + ticket 16，`-g "K5\|ticket 16"`） | **3 passed / EXIT 0**（1.1m） | 四服务真机 + 隔离 PG（`meiye_k5`）+ fixture。 |
| ├ `pro-studio-prompts-assets.spec.ts` G39（库加载 + 兼容提示词插入 composer） | passed（4.6s） | /dashboard 触发供给激活 image.generate → 40 卡、无 503、营销画面分类、listPrompts 命中 → 插入落入 composer。 |
| ├ `pro-studio-prompts-assets.spec.ts` G40/G41（插入画布 + @mention 引用） | passed（4.8s） | 上传→节点1、插入画布→节点2、listAssets 命中；composer 启用 → @候选菜单 → 选中素材 → 已引用 chip。 |
| └ `pro-studio-engineering-tickets.spec.ts` ticket 16（stale 修复） | passed（8.1s） | 断言现有 PromptLibrary 打开、40 卡加载、无 503 错误输出。 |

## 证据文件

- e2e：`mkfast-template-main/tests/e2e/specs/pro-studio-prompts-assets.spec.ts`（新增，2 test）；
  `pro-studio-engineering-tickets.spec.ts`（ticket 16 stale 修复）
- 服务端：`apps/canvas/src/server/prompt-catalog.ts` + `.test.ts`（新增）、
  `runtime.ts`（接线 prompts provider）
- 共享：`apps/canvas/src/shared/prompt-seeds.ts` + `.test.ts`（自 client 迁入，A3 解析 + operation 类型解锁）
- 实现（既有，本轮未改逻辑）：`resource-workflow-ui.tsx`、`resource-workflow.ts`、
  `runtime-panel.tsx`、`canvas-shell.tsx`
