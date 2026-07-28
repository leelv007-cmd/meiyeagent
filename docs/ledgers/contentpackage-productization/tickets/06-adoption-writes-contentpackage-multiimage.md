# 票 06 · 采用写 ContentPackage：文案+多图成一品
> 建设面: E1 成品收敛 ｜ 决策: DEC-CONTENTPACKAGE-SOLE ｜ Blocked-by: 01

<!-- decision-ticket-map:start -->
```json
{
  "ticketId": "06",
  "decisionIds": [
    "DEC-CONTENTPACKAGE-SOLE"
  ],
  "guardrailDecisionIds": [],
  "gapIds": [
    "G-SPLIT-FACTS",
    "G-SINGLE-ASSET"
  ],
  "contractIds": [
    "X-ADOPT-VISIBLE"
  ],
  "blockedBy": [
    "01"
  ],
  "closureEvidence": [],
  "resolution": null,
  "status": "open"
}
```
<!-- decision-ticket-map:end -->

## 差距锚点

- **采用在命令签名层就只能"单素材→单内容"（confirmed）**：`apps/core/src/p1/operations/application-service.ts:5572` `acceptCreativeAsset(context, assetId)` 只收一个 assetId，`:5631` `assetIds: [asset.id]` 写死单元素数组（票面与 ADR-0011 所引 `:5638` 已漂移，实核写死行为 `:5631`，`:5638` 现为 `workId` 字段行）。"一条文案 + 多张有序图组成一个图文成品"（spec User Story 2）在类型与命令两层都不可能——商户采用 N 次只会得到 N 条散落单素材内容。
- **采用写进的事实商户看不见（confirmed，spec Problem Statement 第 1 条）**：采用写 `state.creativeContents`（`application-service.ts:5641` push），内容库 `/dashboard/content` 读的是旧 Product 事实 `state.contents`（`mkfast-template-main/src/routes/dashboard/content.tsx:100` find、`:136-143` drafts/published 过滤，锚点未漂移）。已实核 `apps/core/src/product/` 全部非测试源码零 `creativeContents` 命中——两套事实之间连投影桥都没有，商户采用后打开内容库命中空态 + 示例画廊（`content.tsx:215-231`），"采用了却看到 0 条内容"。
- **采用产物不是成品、进不了版本体系**：`packages/contracts/src/uiux.ts:233-244` `CreativeContent` 全部字段就是 id/workId/jobId/title/body/assetIds/status('accepted' 唯一字面量)/时间戳——无版本、无三平台 variants、无权利合规态、无导出回执。ADR-0008 D4 拍板"采用后进 Package 版本体系"，当前采用后没有任何版本体系可进。
- **交互层同样把成品拆散**：图文 Work 的媒体结果区对每张图单独给"采用为内容"按钮（`mkfast-template-main/src/product/unified-creation-workbench.tsx:2346-2364`，payload 只有 `{ assetId }`），一张图采用=又一条单素材内容；文案 3 选 1 采用（`copy-candidate-selector-model.ts:199-207`）与图的采用互不知晓——成品概念在交互层缺席。
- **票界**：票 01 已冻结 `adopt_into_content_package` 命令 schema（单条 copy 候选〔D4 3 选 1 单选〕+ 可选多张有序视觉 assetIds → 单个 package + 首版本，不接受多候选数组）并交付聚合合同/状态机/`p1_content_packages` 表 tracer；本票是该命令的**第一实现者**——落采用命令、切前端采用链、在内容库给出成品最小可见区。不做读源唯一化/三态分组/一级导航收束（票 07）、不接视频（票 08）、不做 variants（票 11）、不做编辑/版本回滚（票 12）、不迁移不冻结旧命令（票 17）。
- **锁定边界**：D4 不重开——仍一次 3 条、3 选 1 单选，采用后进 Package 版本体系；状态用语只用「创作中 / 可使用 / 需处理」（D14，映射消费票 01 冻结的唯一纯函数）；最高 seam = Product Core Application Service，不新增 seam；新采用只写 ContentPackage、不双写旧三套（D06）。

## 现状代码入口（实核 file:line）

- `apps/core/src/p1/operations/application-service.ts:5572-5667`：`acceptCreativeAsset` 全体，本票的门禁语义来源——`:5590-5593` 同 Asset 重复采用幂等重放；`:5594-5605` 经 `completeCopyCandidateBatch`（`:4257-4286`）校验"完整三候选批次中的 text 资产"；`:5606-5622` 一 Work 一次采用（`COPY_CANDIDATE_ALREADY_ACCEPTED` 409）；`:5624-5641` 内容构造与写入（`:5631` 单元素数组）；`:5642-5645` 回写 `job.outputContentIds`；`:5646-5650` `work.status='accepted'`；`:5651-5664` `this.audit` + `this.creationEvent('first_content_accepted')`。本票新增命令沿用其门禁与 audit 形态，但**不改不删**该方法（旧路径冻结归票 17）。
- `apps/core/src/p1/operations/application-service.ts:4380-4389`：`getCreativeWorkbench` 把 `state.creativeContents` 投影为 `contents`（`:4384`）——当前前端全部"已采用"判定的数据源。
- `apps/core/src/p1/operations/foundation-module.ts:433-437`：`accept_creative_asset` 命令注册形态；查询分发自 `:722` 起——新命令/新查询消费照此追加 case，零路由变更（`apps/core/src/server.ts:780-817,858-885` 通用 module+action 透传；BFF `mkfast-template-main/src/routes/api/core/p1/commands.ts`、`query.ts` 通用代理同理）。
- `apps/core/src/p1/foundation/application-service.ts:282-303`：`executeModule` 的 `payloadHash` + `claimModuleCommand` seam 级幂等（replay / in_progress / 同 key 异 payload `IDEMPOTENCY_CONFLICT`）——新命令免费继承，禁止自造第二套幂等。
- `packages/contracts/src/uiux.ts:373-384`：`requiredP1Capability` `:381` 把 `accept_creative_asset` 归 `content.review`——新采用命令授权照此对齐。
- 票 01 冻结产物（本票的合同前置，落点以其实际产出为准）：`packages/contracts/src/content-package.ts`（聚合 schema、`adopt_into_content_package` payload、`contentPackageStatusGroup` 三态唯一映射）、`apps/core/src/p1/operations/content-package.ts`（`transitionContentPackage` 纯函数 + 十条契约守卫）、`types.ts:1123` 旁 expand 的 `contentPackages`、`postgres-repository.ts` 新表 `p1_content_packages`（模式照 `:236-245` 的 `p1_creative_contents`）——本票**零新表**。
- 前端采用链与"已采用"态消费点（全清单，实核）：`mkfast-template-main/src/product/copy-candidate-selector-model.ts:152-163`（accept 输入）、`:199-207`（构造 `accept_creative_asset`）、`:119-142`（accepted 判定读 `contents` + `job.outputContentIds`，`:126`）；`unified-creation-workbench.tsx:495-503`（`currentContents` + 媒体未采用过滤）、`:1037,1045`（创作记录可见性）、`:2280-2294`（copy.generate 结果区挂 `CopyCandidateSelector`）、`:2296-2376`（媒体结果区逐 Asset 采用，`acceptedContent` 判定 `:2306-2308`、按钮 `:2346-2364`）；`creative-object-page.tsx:290`（Job 详情 contents 计数）。`:1148-1149` 双源相加计数归票 07，本票不动。
- `mkfast-template-main/src/routes/dashboard/content.tsx:100,136-143,215-231`：内容库读 `state.contents` 与空态——本票在该页新增成品最小可见区，主列表、两 Tab（`:239-264`）、L3 交接区（`:268-390`）、页头计数 Badge（`:153-158`）一概不动（归票 07/13）。`:38-45,103-111` 的 search param + source-highlight 锚定形态是"采用完成跳转定位成品卡"的现成参照。
- `mkfast-template-main/src/p1/client.ts:99`：`operationsQuery` 前端 P1 查询封装——内容库成品区与工作台已采用态改读 `content_packages` 查询的通道。
- `apps/core/src/p1/operations/application-service.test.ts:24-46`：契约测试 setup 形态（MemoryOperationsRepository + Recorded adapters + 直调 service 外部行为）。

## 改造方案（步骤级）

垂直切片：契约消费 → Application Service 采用命令 → 授权注册 → 前端采用链与内容库可见 → 测试留证。轴心是一条商户行为：**3 选 1 采用一条文案 + 多张有序图 → 内容库立刻看到一个成品**。

1. **契约消费与签收（`packages/contracts/src/content-package.ts`，票 01 冻结产物）**：按冻结 schema 实现 `adopt_into_content_package`——payload 为 workId + 单条 copy 候选 assetId + 可选多张有序视觉 assetIds（具体字段名以冻结文本为准，本 brief 不另造）；返回投影 = 单个 ContentPackage + 首版本指针。发现字段缺口（如需补 sourceJobId）走票 01 版本化变更记录并通知票 08/09/11，不静默改。本票签收即差距锚点所述"第一消费者签收"义务的兑现。
2. **Application Service 采用命令（`application-service.ts` 追加 `adoptIntoContentPackage`，不碰 `acceptCreativeAsset`）**：
   - 门禁沿旧语义（D4 不重开）：复用 `completeCopyCandidateBatch`（`:4257-4286`）校验候选属完整三候选批次；一 Work 一次采用——同时检查新 `state.contentPackages`（同 workId 的 image_text 包）**与旧事实**（`creativeContents`/`job.outputContentIds`，只读不写），防旧路径已采用的 Work 被二次采用出第二个成品；冲突返回 409。
   - 视觉资产校验：每个有序视觉 assetId 必须是同 Work 下已交付（`ownedAssetId` 落库）的图像 Asset；跨 workspace、未交付、重复项→明确 4xx 拒绝，不静默丢弃（对齐 spec §5"解析失败进入需处理，不静默丢弃"的姿态）。
   - 产出**单个** ContentPackage：kind=image_text；`source` 记 workId 与 brief 引用；`generated`/`childRuns` 记 copy job 与各图 job（runType=creative_job）；首版本 title/body 取所选候选、`orderedAssetIds` 顺序=提交顺序、`currentVersionId` 指向首版本——"采用后进 Package 版本体系"从这里成立。状态一律经票 01 的 `transitionContentPackage` 纯函数落 accepted（三态=可使用），service 内不散写 status。
   - **不写 `creativeContents`、不回写 `outputContentIds`**（D06 新采用不双写）；`work.status='accepted'` 保留（Work 是内部执行对象，此为执行态标记非成品事实）；`this.audit('content_package.adopted', ...)` + `this.creationEvent('first_content_accepted')` 沿用（激活漏斗不断）。
   - 幂等双层：seam 层由 `claimModuleCommand` 继承；业务层同 Work 已有采用产物→返回同一 package（十条契约"幂等查询不重复版本"）。
3. **注册与授权**：`foundation-module.ts` 命令 switch 追加 `adopt_into_content_package` case；`uiux.ts:381` 条件加该 action → `content.review`（与 `accept_creative_asset` 同级）。零其它装配变更。
4. **前端采用链切换（BFF 零代码变更）**：
   - `copy-candidate-selector-model.ts` accept 分支改构造 `adopt_into_content_package`（payload 增有序视觉 assetIds），幂等键沿 clickToken 形态；
   - 采用交互升级：商户选定 1 条候选后，展示同 Work 已交付视觉资产清单——默认全选、默认生成顺序、可去选与上/下调序，一次提交成一品；仍是 3 选 1 单选，不出现多候选采用；
   - "已采用"态改源：`:119-142`、`:495-503`、`:2306-2308`、`creative-object-page.tsx:290` 四处判定从 `creativeContents`/`outputContentIds` 切到 `content_packages` 查询（经 `operationsQuery` 新封装）或采用命令返回投影；采用成功后同时 invalidate 新查询与 `creative_workbench`（`onChanged`/`refreshProjection` 链路）；
   - 图文 Work 的媒体结果区撤下逐 Asset"采用为内容"按钮，替换为指向同一组合采用流的入口；~~**独立媒体 Work（无 copy 候选批次）的旧采用按钮暂保留**——该旧路径的收敛归票 17~~。独立媒体 Work 的产物即存资产，结果区显示「已存为资产」且不提供采用按钮；这是后续实现收敛的权威现状，本票不要求恢复旧采用按钮。

   > 治理批注 2026-07-17：用户拍板 supersede，依据 batch-T2 分析。本项同步修订 DoD-5 的后半句；图文 Work 采用收口到 `CopyCandidateSelector` 的前半句继续有效，独立媒体 Work 以“产物即存资产、无采用按钮”为验收口径。
5. **内容库成品最小可见区（`content.tsx`）**：页头下新增「成品」区，读 `content_packages` 查询按 updatedAt 降序渲染最小成品卡——标题 + 正文摘录 + N 张有序图缩略 + 三态标签（标签只调 contracts 的 `contentPackageStatusGroup`，禁止页面自算第二套映射）。工作台采用成功处给「在内容库查看」入口，跳 `/dashboard/content` 并带 packageId 参数锚定该卡（沿 `:38-45,103-111` source-highlight 形态）。主列表读源不动；本区即票 07 主列表切换的种子形态。
6. **测试与留证**：
   - 契约测试（`application-service` 外部行为，照 `:24-46` setup）：采用 1 条候选 + 3 张有序图 → 恰好 1 个 ContentPackage（kind=image_text、首版本 `orderedAssetIds` 顺序与提交一致、`currentVersionId` 正确）；`content_packages` 查询**立即**返回该成品（spec Testing Decisions 第一条：复现并防回"采用了看到 0 条"）；`creativeContents` 零增长（不双写断言）；非完整批次候选拒绝；同 Work 二次采用（含旧路径已采用的 Work）409；同幂等键重放返回同一 package 不产生第二个；跨 workspace / 未交付图拒绝；状态映射=可使用。
   - `postgres-repository.test.ts`：真实事务 + workspace 隔离沿既有形态覆盖采用写入。
   - Playwright（沿现有单 Worker 配置）：生成 3 候选 → 选 1 + 默认多图 → 采用 → 工作台已采用态 → 内容库成品区见该卡且缩略图顺序正确。
   - 证据落 `docs/evidence/contentpackage/ticket-06/`：改造前后对照录屏、命令 correlationId 与查询往返记录。测试是工程护栏，不作为 DoD。

涉及文件：`packages/contracts/src/content-package.ts`（消费+签收，如需扩投影）、`apps/core/src/p1/operations/application-service.ts`、`foundation-module.ts`、`packages/contracts/src/uiux.ts`、`apps/core/src/p1/operations/application-service.test.ts`、`postgres-repository.test.ts`、`mkfast-template-main/src/product/copy-candidate-selector-model.ts`、`copy-candidate-selector.tsx`、`unified-creation-workbench.tsx`、`creative-object-page.tsx`、`mkfast-template-main/src/p1/client.ts`、`mkfast-template-main/src/routes/dashboard/content.tsx`，以及对应 E2E spec。

## DoD（全部必须是用户可见行为）

- **主对照证据（当前 vs 改造后）**：同一真实 `/dashboard` 旅程——生成文案 3 候选 → 3 选 1 采用并带上 ≥2 张有序图 → 打开 `/dashboard/content`。改造前三帧：采用成功提示 → 内容库空态 + 示例画廊（`content.tsx:215-231`）→ 成品无处可寻；改造后三帧：同一采用 → 内容库**立即**出现这条成品卡 → 卡上标题=所选候选、N 张图缩略且顺序与采用时一致。对照录屏落 `docs/evidence/contentpackage/ticket-06/`。
- **一次采用=一个成品**：商户看到的是 1 个图文成品（文案+多图同卡），不是 N+1 条散落内容；工作台"已采用"标记与内容库成品卡指向同一对象（同 ID、同「可使用」状态）；点开可见组成与首版本事实——采用后已进 Package 版本体系，票 12 的编辑/回滚将作用于同一对象。
- **D4 可见行为不变**：仍一次 3 条、3 选 1 单选；采用后其余两条候选不可再采用；对同一 Work 重复采用（含换一条候选重试）得到明确冲突提示而非第二个成品；重复点击采用按钮不重复扣费、成品数量不变。
- **状态用语合规**：成品卡状态只显示「创作中 / 可使用 / 需处理」之一（本票主路径为「可使用」），无英文状态码、无 drafts/published 字样泄漏进成品区。
- **交互分叉收口（DoD-5）**：图文 Work 内不再存在"一张图单独采用成一条内容"的出口；~~独立媒体 Work 的旧行为保持原样且不受本票影响（票 17 收敛）~~。独立媒体 Work 的产物即存资产，结果区显示「已存为资产」且无采用按钮；本票按 supersede 口径验收，不要求恢复采用按钮——本票不宣称旧三套已收敛、不宣称内容库已只读 ContentPackage（票 07）、不宣称北极星 0→1（票 22 留证，D01 硬 Gate）。

> 治理批注 2026-07-17：用户拍板 supersede，依据 batch-T2 分析。DoD-5 前半句“图文 Work 的采用收口到 `CopyCandidateSelector`”仍然有效；后半句“独立媒体 Work 的旧采用按钮保持原样”由后续实现收敛 supersede，以 `unified-creation-workbench.tsx:2005-2053` 的“已存为资产、无采用按钮”为权威现状。
- **关票边界（禁止项）**：仅"采用命令实现""seam 往返/curl 可见""单测/fixture 全绿""后端就绪/组件完成"一律不得关票——必须有真实 `/dashboard` 操作路径上的采用→入库对照证据。MAP 全局规则：票 01 冻结签收完成前，本票不得关闭。

## Blocked-by / Blocks

- **Blocked-by**：票 01（gate）——`adopt_into_content_package` 的 payload schema、十条状态契约、三态映射函数、`p1_content_packages` 表全部是它的冻结产物；本票开工可与票 01 收尾并行（在其分支叠加），但关票必须在票 01 冻结签收之后（MAP guard 强制）。
- **Blocks（直接）**：票 07（内容库只读 ContentPackage——无本票写入则新读源恒空，其 DoD 第一条无法成立）、票 08（视频成片进同一 Package——复用本票落定的采用/落包写入形态）、票 11（三平台 variants——挂在本票产出的成品对象上）、票 16（桌面/手机同一 ContentPackage——同一对象先得存在）。
- **Blocks（汇聚）**：票 22（北极星 0→1）——真实链路"确认 → 内容库"一段由本票交付。本票位于最长串行链 01→06→11→13→15 第二跳。
- 解阻不等于要求回挂：本票以自身 DoD（真实采用→内容库成品区可见）独立关票，不等票 07 的读源切换。

## 风险与回退

- **"已采用"判定漏改**：前端 5 处消费 `creativeContents`/`outputContentIds`（清单见现状入口），漏改任何一处会出现"已采用仍可再采用"或"未采用却锁死"。控制：消费点清单逐项纳入 diff 走查；契约测试断言 `creativeContents` 零增长；E2E 断言采用后按钮态翻转。
- **旧数据 Work 二次采用**：新门禁若只查 `contentPackages`，旧路径已采用的 Work 可再采用出重复成品。控制：门禁同时只读旧事实（不写、不迁移），命中即 409。
- **多图顺序丢失**：前端选序 → payload → 首版本 `orderedAssetIds` → 查询投影，任何一层用 Set/无序集合都会破坏"有序"。控制：契约测试 + E2E 双层顺序断言。
- **双写回潮**：为让旧界面"暂时也能看到"而让新命令兼写 `creativeContents` 是最大诱惑，直接违反 D06。控制：不双写是硬测试断言；旧界面一致性一律由查询侧（新查询封装）解决，不碰写侧。
- **状态机旁路**：采用直写 status 字段绕过 `transitionContentPackage` 会让十条契约失守。控制：service 内状态变更一律过票 01 纯函数，code review 检查点写入票内清单；三态标签只调 contracts 唯一映射（防第二套状态机，D14）。
- **票 01 schema 缺口**：实现中发现 payload 不够用，走票 01 版本化变更记录 + 通知消费票（08/09/11），不静默改；评审两轮熔断（D04）适用。
- **与票 07 的衔接冲突**：内容库成品区与 07 的主列表切换动同一页面。控制：本区设计为 07 主列表的种子形态（同一查询、同一卡片合同），07 升级而非重写；两票 diff 均不触 L3 交接区与页头计数。
- **回退**：前端采用入口切回 `accept_creative_asset` 一个 diff 即恢复旧链；内容库成品区为纯增量可单独摘除；已产生的 ContentPackage、版本、audit 不回滚不删除，继续由新查询可见（spec §9：回滚仅切换后续采用入口，不用旧快照覆盖新事实）。
