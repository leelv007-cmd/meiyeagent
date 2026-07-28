# 票 01 · 冻结 ContentPackage 聚合合同 + 十条状态契约（12 个状态字面量）
> 建设面: E1 成品收敛 ｜ 决策: DEC-CONTENTPACKAGE-SOLE ｜ Blocked-by: 无（可立即启动）

> 基线说明（2026-07-15）：本票中的“零命中/未实现”类描述仅指当时快照；当前代码已有 ContentPackage contracts 与 wiring，开放票仍表示治理/验收未闭环，不代表实现为空。

<!-- decision-ticket-map:start -->
```json
{
  "ticketId": "01",
  "decisionIds": [
    "DEC-CONTENTPACKAGE-SOLE"
  ],
  "guardrailDecisionIds": [
    "DEC-D01-REAL-DONE"
  ],
  "gapIds": [
    "G-SPLIT-FACTS"
  ],
  "contractIds": [],
  "blockedBy": [],
  "closureEvidence": [
    "docs/evidence/contentpackage/ticket-01/README.md",
    "docs/evidence/contentpackage/ticket-01/seam-evidence.json",
    "docs/evidence/contentpackage/ticket-01/continuous-seam-journey.webm",
    "docs/evidence/contentpackage/ticket-01/02-content-library-after.png",
    "docs/evidence/contentpackage/real-run-0003/journey/before-after-comparison.md",
    "docs/evidence/contentpackage/real-run-0003/journey/run-manifest.json"
  ],
  "resolution": "completed",
  "status": "closed"
}
```
<!-- decision-ticket-map:end -->

## 差距锚点

- **全仓源码 ContentPackage 零命中（2026-07-15 复核仍为 0）**：`grep -rn "ContentPackage"` 在 `apps/`、`packages/`、`mkfast-template-main/` 的全部 ts/tsx/sql 命中 0 条；仅 ADR-0011、spec 与评审文档文本提及。ADR-0011 "已核实全仓零命中即真实空白"未漂移——唯一成品聚合今天不存在，票 06–17 无合同可依。
- **三套结果事实并存（ADR-0011 病灶，逐条实核）**：
  - 旧 Product `ContentItem`：`packages/contracts/src/product.ts:117-130`，status 为 `candidate|draft|abandoned|published`，带 `variants: ContentVariant[]`（`:108-115`，platform + versions + currentVersionId）——形态最接近成品但属旧三套第一套，D06 判只读迁移来源。
  - P1 `CreativeContent`：`apps/core/src/p1/operations/types.ts:731-741`，status **只有 `'accepted'` 一个字面量**（`:739`），无 draft/generating/needs_replacement 任何其他态，十条状态契约无处安放；无版本、无三平台 variants、无 rights/compliance、无导出回执、无复用血缘——全字段就是 id/workspaceId/workId/jobId/title/body/assetIds/status/createdAt/acceptedAt。
  - 独立 `DurableVideoWorkflow`：`apps/core/src/p1/model-supply/index.ts:2569-2598`，六状态（draft/running/awaiting_quality_review/cancel_requested/completed/cancelled，`:2584-2590`），成片 `composedAsset` 是工作流内部字段（`:2591`），completed 后没有任何命令把成片写进任何内容事实——第三套。
- **"采用后内容库 0 条"断裂链（商户可见）**：前端采用发 `accept_creative_asset`（`mkfast-template-main/src/product/unified-creation-workbench.tsx:2357`、`copy-candidate-selector-model.ts:204`）→ core 写 `state.creativeContents`（`apps/core/src/p1/operations/application-service.ts:5641`）→ 内容库页读的却是 `state.contents`（旧 Product 投影，`mkfast-template-main/src/routes/dashboard/content.tsx:100`，ADR 所引行号未漂移；drafts/published 过滤在 `:136,141`）。两套事实靠投影拼接，动作与生命周期断裂。
- **采用写死单元素数组**：`application-service.ts:5572` `acceptCreativeAsset(context, assetId)` 只收单个 assetId，`:5631` `assetIds: [asset.id]`（ADR-0011 所引 `:5638` 已漂移，实际 `:5631`，`push` 在 `:5641`）——"一条文案 + 多张有序图成一个图文成品"在类型层就不可能。
- **契约层空白**：`packages/contracts/src/p1.ts` 全文 114 行只有模块请求 envelope（`:18-28`）与文案三候选 schema（`:32-47`），无任何成品聚合、状态机或平台 variant 合同。contracts 包是 web 与 core 共享的唯一合同层（`content.tsx:19` 已 `import ... from '@meiye/contracts'` 证明消费通道存在），聚合合同不冻结在这里，票 06/09 各自造形状必然分叉。
- **票界**：本票只冻结合同并交付最小 tracer（schema + 状态机 + 最小命令/查询 + 契约测试 + expand 持久层），**不改采用链路**（票 06）、**不改内容库读源与导航**（票 07）、**不接视频**（票 08）、**不做迁移**（票 17）、**不接任何 UI**。锁定不变量：状态用语只用「创作中 / 可使用 / 需处理」（D14）；D4 不重开——采用仍是 3 选 1 单选，采用后进 Package 版本体系（ADR-0008 × ADR-0011）。

## 现状代码入口（实核 file:line）

- `packages/contracts/src/p1.ts:18-28,32-47`：现有 P1 envelope 与候选 schema；全文实读确认无聚合合同。新 schema 不塞进本文件，另立 `content-package.ts`。
- `packages/contracts/src/index.ts:3-6`：contracts 包 re-export 面，新文件在此挂出。
- `packages/contracts/src/product.ts:108-130`：旧 `ContentVariant`/`ContentItem`——variants+versions 结构可借鉴形态，但对象本身只读不动（D06）。
- `packages/contracts/src/uiux.ts:373-384`：`requiredP1Capability` 的 operations 分支——`accept_creative_asset`/`transition_task` → `content.review`，其余命令默认 `content.create`、query 默认 `workspace.read`。新命令的授权映射改这里，有现成先例。
- `apps/core/src/p1/foundation/application-service.ts:282-303`：`executeModule` 唯一 seam 命令入口——`payloadHash({name,input})` + `claimModuleCommand` 已内建 replay / in_progress / 同 key 异 payload `IDEMPOTENCY_CONFLICT`（错误释放白名单见 `:355-360`）。spec §6 的幂等要求由 seam 免费继承，**禁止自造第二套幂等**。
- `apps/core/src/p1/operations/foundation-module.ts:433-437`：`accept_creative_asset` 命令注册形态（switch case → service 方法）；query 分发自 `:712` 起。新 case 照此追加。
- `apps/core/src/p1/operations/application-service.ts:5572-5666`：`acceptCreativeAsset` 全体——本票**不改它**（归票 06），只作断裂证据与 audit/`creationEvent`/仓储事务形态参照。
- `apps/core/src/p1/operations/types.ts:731-741,1123`：`CreativeContent` 与 `state.creativeContents`——expand 时在同层新增 `contentPackages`，不动旧字段。
- `apps/core/src/p1/operations/postgres-repository.ts:236-245`：`p1_creative_contents`（workspace_id/id/payload jsonb/updated_at，PK(workspace_id,id) + payload 表达式索引）——新表 `p1_content_packages` 的既有模式模板。
- `apps/core/src/main.ts:530-532`：`OperationsFoundationModule` 生产装配点——模块已注册，本票零装配变更，只在模块内加 case。
- `apps/core/src/server.ts:780-817,858-885`：`/workspaces/:id/p1/commands|query` HTTP seam——通用 module+action 透传，新 action 零路由变更；BFF 侧同理（`mkfast-template-main/src/routes/api/core/p1/commands.ts` 通用代理）。
- `apps/core/src/p1/model-supply/index.ts:2569-2598`：`DurableVideoWorkflow`——childRun 引用词表（runType）与"供应商 URL 过期用 owned archive"语义（`clipAssets/composedAsset` 均为 `OwnedAsset`）的来源。
- `apps/core/src/p1/operations/application-service.test.ts:24-46`：契约测试 setup 形态（`MemoryOperationsRepository` + Recorded adapters + 直调 service 外部行为）——新测试照此，不 mock 内部。

## 改造方案（步骤级）

垂直切片：合同（contracts）→ 域状态机（core domain）→ Application Service 命令/查询 → 授权与注册 → 持久层 expand → BFF 通道核验 → 契约测试与留证。每层都落地，但每层只落"冻结合同 + 最小 tracer"所需。

1. **冻结聚合 schema（`packages/contracts/src/content-package.ts` 新文件，`index.ts:6` 后挂出）**。按 ADR-0011 §Decision D05 聚合形态逐字段落 zod：
   - `contentPackageKindSchema = z.enum(['image_text','video'])`；`contentPackagePlatformSchema = z.enum(['xiaohongshu','douyin','video_account'])`。
   - `contentPackageStatusSchema`：十条状态契约覆盖的 **12 个可达状态字面量**——`draft/needs_input/generating/verifying/partial/review_ready/accepted/needs_replacement/cancelling/cancelled/save_unknown/export_failed`（第十条"供应商 URL 过期"是不变状态规则，不是新值；export_failed 语义=成品不回退，已成功版本/回执全保留）。
   - 子结构：`source`（storeProfile/grounding/brief 引用 + 有序真实素材 assetIds）、`generated`（有序生成 assetIds + `childRuns[]`：runType ∈ `creative_job|canvas_image_job|durable_video_workflow` + runId）、`versions[]`（title/body/orderedAssetIds/derivedFromVersionId + currentVersionId，采用后进版本体系）、`variants`（三平台各自 versions + currentVersionId，形态借 `product.ts:108-115` 但版本结构对齐新 schema）、`rights`（authorized/revoked + revokedAt）、`compliance`（watermark/aigcLabel 开关位，烧录落地归票 15）、`exportReceipts[]`（platform/status/artifactAssetId/failureCategory，成品引用 owned Asset，禁临时 URL）、`lineage`（reusedFromPackageId）、`legacySource?`（sourceType ∈ 旧三套 + sourceId + mappingConfidence ∈ exact/partial/unknown，票 17 消费，unknown 不补造）。
   - `CONTENT_PACKAGE_STATUS_CONTRACTS` 常量：十条契约逐条（场景 / 状态 / 必须行为原文，来源 FINAL-REVIEW §7.3 表 + ADR-0011），合同即代码，契约测试按它驱动。
   - `contentPackageStatusGroup(status)` 纯函数 + `z.enum(['creating','usable','needs_attention'])`：D14 三态唯一映射源——建议冻结为 创作中=draft/generating/verifying/cancelling、可使用=review_ready/accepted、需处理=needs_input/partial/needs_replacement/save_unknown/export_failed/cancelled；`review_ready→可使用` 作为冻结评审显式确认项。映射必须全射（每个 status 恰有一组），**映射不得成为另一套状态机**（spec §5）。
2. **冻结命令/查询名与 payload schema 全集（同文件）**，并标注实现票；01 只实现 tracer 子集，未实现命令**不注册**（沿 foundation-module 未知 action 的既有失败路径，禁止注册假成功桩）：
   - 01 实现：`create_content_package`（kind + source，落 draft 或缺件即 needs_input）、`cancel_content_package`（cancelling/cancelled 契约）、`revoke_content_package_rights`（→needs_replacement，撤权契约）；查询 `content_package`（详情）、`content_packages`（库列表投影，含 statusGroup）。
   - 仅冻结 schema：`adopt_into_content_package`（票 06；payload 显式约束=单条 copy 候选〔3 选 1 单选，D4 不重开〕+ ~~可选多张有序视觉 assetIds~~ **至少 1 张、有序多张（1..n）的视觉 assetIds** → 单个 package + 首版本，不接受多候选数组）、`attach_content_package_generation`（票 06/08/09；childRun + 有序生成资产，幂等）、`edit_content_package_version`/`rollback_content_package_version`（票 12）、`generate_content_package_variant`/`edit_content_package_variant`（票 11/12）、`export_content_package`（票 13；schema 里显式写死 rights.state=revoked → conflict）、`reuse_content_package`（票 14）；查询 `content_package_versions`（12）、`content_package_lineage`（14）。

   > 治理批注 2026-07-17：用户拍板，对齐 HEAD `289d93e7` 的冻结实现。本项对应 DoD-6「冻结签收与 gate 解锁」：adopt 的 `visualAssetIds` 必须至少 1 张并保持提交顺序，`packages/contracts/src/content-package.ts:501-505` 的 `.min(1)` 与空数组失败测试是冻结口径；“可选多张”为过时歧义。
3. **域状态机（`apps/core/src/p1/operations/content-package.ts` 新文件）**：纯函数 `transitionContentPackage(pkg, event)` + 转换表，十条契约的必须行为编码为守卫：needs_input 不创建付费任务、generating/verifying 原幂等键只查询、partial 保留成功 childRun 仅重试失败、save_unknown 幂等查询不重复版本、needs_replacement 阻止新导出意图、export_failed 不回退已成功版本与回执、cancelled 限制重提、URL 过期只换 owned archive 引用不改状态。types.ts `:1123` 旁 expand `contentPackages: ContentPackage[]`。
4. **Application Service 命令/查询（`application-service.ts` 追加，不碰既有方法）**：`createContentPackage`/`cancelContentPackage`/`revokeContentPackageRights`/`getContentPackage`/`listContentPackages`，沿 `acceptCreativeAsset` 的 authorize + 仓储事务 + `this.audit` + `this.creationEvent` 形态；状态变更一律过第 3 步纯函数，不在 service 内散写 if。
5. **注册与授权**：`foundation-module.ts` 命令 switch 加 3 case、query switch 加 2 case；`uiux.ts:373-384` 加一行——`revoke_content_package_rights` → `content.review`（与 accept_creative_asset 同级），其余走默认 `content.create`/`workspace.read` 零改动。
6. **持久层 expand（`postgres-repository.ts` + `MemoryOperationsRepository`）**：`p1_content_packages` 表照 `:236-245` 模式（workspace_id/id/payload jsonb/updated_at，PK(workspace_id,id)），加 `(workspace_id, (payload->>'status'), updated_at DESC)` 索引。**纯新增**：不触旧三套任何表、不加双写、不写迁移（票 17）。
7. **BFF 通道核验（零代码变更预期）**：确认 `mkfast-template-main` 的 p1 commands/query 通用代理对新 action 直通（module 枚举未变，走 `operations`）；contracts 新导出对 web 可 import。此步只留核验记录，UI 消费归票 06/07。
8. **契约测试与留证**：
   - `content-package.test.ts`（operations 目录，照 `application-service.test.ts:24-46` setup）打 Application Service 外部行为：创建→查询同对象且 statusGroup 三态之一；同 idempotency key 重放返回同一 package 不产生第二个；同 key 异 payload 得 `IDEMPOTENCY_CONFLICT`；cancel/revoke 转换与限制重提；workspace 隔离（B 工作区查不到 A 的包）。
   - 状态机测试按 `CONTENT_PACKAGE_STATUS_CONTRACTS` 逐条断言必须行为（域级，合同文本与断言一一对应）；映射全射断言（新增 status 不配组即编译/测试双失败）。
   - `postgres-repository.test.ts` 扩新表：真实事务 + workspace 隔离（prior art 沿用）。
   - 既有全量测试零改动零回归。测试是工程护栏，不是关票理由。
   - 证据落 `docs/evidence/contentpackage/ticket-01/`：真实运行服务上的 seam 往返记录、零回归走查记录、冻结评审签收记录。

## DoD（全部必须是用户可见行为）

- **零回归对照（当前 vs 改造后，对照证据之一）**：商户在真实 dev 环境走既有旅程——登录 → 工作台生成文案 → 3 选 1 采用 → 打开 `/dashboard/content` → 视频工作流页——每一步行为与改造前完全一致：采用照常成功、内容库照常渲染、无新增报错或状态错乱。改造前后各留一份录屏/截图对照。expand 并存"不破坏"是本票直接触达商户的第一承诺。
- **同源成品事实活演示（主对照证据）**：在同一真实运行服务（真实 Postgres，非 fixture）上，以商户 workspace 身份经产品同一命令通道（BFF `/api/core/p1` → core seam）创建一个 kind=image_text、含一条文案 + 3 张有序图引用的 ContentPackage，随后 `content_packages` 查询**立即**返回同一对象——与当前"工作台采用后 `/dashboard/content` 显示 0 条"（`content.tsx:100` 读 `state.contents`、采用写 `creativeContents` 的断裂）形成当前 vs 改造后对照。演示记录（命令、correlationId、查询结果、时间戳）落 `docs/evidence/contentpackage/ticket-01/`。
- **状态用语可见且唯一**：上述查询投影对每个包给出且仅给出「创作中 / 可使用 / 需处理」之一（语义键 + 中文标签由合同纯函数唯一给出），不存在无分组状态；票 06/07/16 的任何界面禁止自算第二套映射。
- **撤权与取消即刻可见**：对演示包执行撤权后，查询立即显示需处理（needs_replacement）与 rights=revoked；执行取消后显示已取消且重复提交得到明确 conflict 而非第二个包。"撤权阻止新导出"以冻结合同条款 + 域层守卫交付，其 seam 可见行为随票 13 的导出命令上线——本票不冒充导出已可用。
- **重复动作不产生重复成品**：同一幂等键重放创建命令，内容库查询里的成品数量不变——"幂等查询不重复版本"从合同文本变成真实服务上可观察的行为。
- **冻结签收与 gate 解锁（DoD-6）**：~~票 06/09 负责人对 schema、命令表、十条状态契约文本逐项签收，冻结版本记录进 evidence；guard（decision-ticket-map）据此解锁集内其他票的关闭资格。~~ 本票以「冻结签收记录（2026-07-17）」作为签收权威：票 06/09 消费口径经 batch-T2/T3 交叉核验一致，并由用户拍板签收；guard（decision-ticket-map）据此解锁集内其他票的关闭资格。此后任何 schema 变更必须走变更记录并通知消费票，不得静默改。

> 治理批注 2026-07-17：用户拍板，以本票新增的「冻结签收记录（2026-07-17）」补齐 DoD-6；原“另行形成 06/09 负责人签收与 evidence 记录”的要求由本次用户拍板签收 supersede，不再作为独立缺口重复验收。
- **关票边界（禁止项）**：不得以"types/schema 写完""单测绿""fixture 覆盖十条状态契约""后端就绪"关票——必须零回归走查 + 真实服务 seam 往返演示 + 消费者签收三者齐备。本票关闭 ≠ 商户闭环完成：北极星"真实跑通链路数"已由 real-run-0002 从 0 增至 1，但本票与其余 closure gate 仍保持 open；商户在 `/dashboard` 看到成品入库的 UI 证据归票 06/07，真实端到端留证归票 22（D01 硬 Gate）；对外口径受 ADR-0011 约束——迁移与真实验收完成前，不得把本架构描述为已上线能力。

## 冻结签收记录（2026-07-17）

- **冻结范围**：12 个状态字面量、唯一三组映射与中文标签、adopt schema（含 `.min(1)`）——以 HEAD `289d93e7` 的 `packages/contracts/src/content-package.ts` 为冻结基线。
- **消费者一致性核验**：票 06、09 的消费口径已由 2026-07-16 关票分析（`.scratch/ticket-closure-analysis-2026-07-16/batch-T2.md`、`batch-T3.md`）交叉核验一致。
- **签收权威**：用户拍板 2026-07-17；后续任何合同变更须新增治理批注并通知消费票。

### 冻结后变更记录

- **2026-07-17 / `810e0d4`**：`needs_replacement` 的允许动作增加 `edit_text`。原因是素材撤权只应阻断继续导出或复用被撤素材，不应阻断商户抢救仍有效的文字内容；状态字面量、三组可见状态、命令 payload 与持久化 schema 均未变化。消费者通知范围：票 07（详情动作呈现）、票 12（版本编辑）、票 15（撤权后的导出守卫）、票 16（移动编辑）。对应服务守卫与 UI 行为测试随该提交落地。
- **2026-07-17 / 本轮实现**：冻结命令 `attach_content_package_generation` 从“仅有 schema”推进为可执行公共 seam；命令 payload 未变化。消费者通知范围：票 06/09（独立媒体回挂同一图文包）、票 11/12（主版本与三平台当前版本继承有序媒体）、票 22（真实旅程必须断言生成资产属于同一聚合根）。

## Blocked-by / Blocks

- **Blocked-by**：无（波次 0，可立即开工）。决策前置已齐：ADR-0011 accepted（2026-07-14），D05/D06/D14 已拍板，无待决项。
- **Blocks（直接）**：票 06（采用写 ContentPackage：文案+多图成一品）、票 09（真实素材进媒体生成——生成落包经 `attach_content_package_generation` 合同）。
- **Blocks（传导）**：经 06 解阻 07/08/11/16，再传导 12/13/14/17，汇聚票 22（北极星 0→1）。本票是最长串行链 01→06→11→13→15 的第一跳，工期下界从这里起算。
- **全局 gate（guard 强制）**：ContentPackage 聚合合同冻结前，集内**任何**票不得关闭——包括无依赖的 02–05。与旧集"后端票等前端票回挂证据才关"相反，本票必须**先**关（合同冻结即关票事件），其余票才有关闭资格；因此 DoD 的冻结签收项是硬条件。

## 风险与回退

- **合同冻结过早僵化 / 欠设计返工**：12 状态 + 全命令 payload 一次冻结，票 06–14 实现时可能发现字段缺口。控制：冻结 = 版本化冻结（变更走变更记录 + 消费票通知，不静默改）；tracer 只实现最小命令避免推测性实现；06/09 负责人签收是冻结生效条件，缺口在签收评审暴露而非实现中途。回退：schema 版本号递增 + 变更记录，不原地改语义。
- **三态映射漂移成第二状态机**：UI 或 BFF 各自 if-else 映射状态是最可能的回潮。控制：纯函数唯一映射源进 contracts 包，全射断言锁死；票 06/07/16 的 DoD 引用本合同映射为验收口径。
- **export_failed / review_ready 语义争议**：export_failed 是否独立状态值、review_ready 归「可使用」还是「需处理」，实现者容易各自理解。控制：两点都写进 `CONTENT_PACKAGE_STATUS_CONTRACTS` 常量与冻结评审 checklist，签收时逐条确认；export_failed 的"成品不回退"由转换表断言（已成功版本/回执/资产不被清除）。
- **expand 期误双写或误改旧路径**：控制：本票 diff 不触 `acceptCreativeAsset`（`:5572-5666`）、product-service、video workflow 任何写路径；既有测试零改动作为机械护栏。回退：新表 + 新命令注册是纯增量，revert 即回到改造前，旧事实零损失。
- **jsonb payload 查询性能**：沿 `p1_creative_contents` 既有 jsonb 模式起步，status 表达式索引先行；若票 07 内容库列表出现真实瓶颈，再按证据加投影列——不提前做关系列拆解（成熟组件优先，不自造框架）。
- **幂等语义分叉**：新命令若绕过 `executeModule` 的 `claimModuleCommand` 自写幂等，会造出第二套真相。禁止该旁路；契约测试显式断言 replay 与 conflict 行为来自 seam 既有机制。
- **"合同票"变"文档票"**：只写 schema 不接 seam、或只测 fixture 不上真实服务，会重演"票关了体验没到"。控制：DoD 的真实服务往返演示 + 零回归走查是硬条件；两轮评审熔断（D04）适用于冻结评审本身。
