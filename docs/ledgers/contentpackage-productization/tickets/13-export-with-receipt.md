# 票 13 · 导出 + 回执
> 建设面: E4 三平台 ｜ 决策: DEC-THREE-VARIANTS ｜ Blocked-by: 11

> 基线说明（2026-07-15）：本票中的“零命中/未实现”类描述仅指当时快照；当前代码已有 ContentPackage contracts 与 wiring，开放票仍表示治理/验收未闭环，不代表实现为空。

<!-- decision-ticket-map:start -->
```json
{
  "ticketId": "13",
  "decisionIds": [
    "DEC-THREE-VARIANTS"
  ],
  "guardrailDecisionIds": [],
  "gapIds": [],
  "contractIds": [
    "X-THREE-VARIANTS-EDITABLE"
  ],
  "blockedBy": [
    "11"
  ],
  "closureEvidence": [],
  "resolution": null,
  "status": "open"
}
```
<!-- decision-ticket-map:end -->

## 差距锚点

- **ContentPackage 导出通道整体空白（2026-07-15 复核）**：`grep -rn "export_content_package\|ContentPackage"` 在 `apps/`、`packages/`、`mkfast-template-main/src` 源码命中 0 条——票 01 的冻结合同尚未落地，spec 用户故事 14「导出成品并拿到导出回执」（`docs/specs/contentpackage-productization-spec.md:70`）与 §6「导出（返回回执）」命令（`:161`）今天没有任何实现。提示锚点复核：ADR-0011 聚合形态含 `export receipts`（`docs/adr/0011-contentpackage-sole-content-aggregate.md:40`）、十条状态契约含 `export_failed`（`:42`）均未漂移。
- **唯一现存"导出"是 Canvas Work 导出，且三处断裂（商户可见）**：
  - **生产装配是 Recorded 假导出**：`apps/core/src/main.ts:468` 与 `job-worker.ts:283` 都注入 `RecordedCanvasExportAdapter`（`apps/core/src/p1/operations/adapters.ts:304-319`），artifact 的 `objectKey` 是 `recorded/exports/${sha256}.png` 伪路径（`:314`）——不带 workspace 前缀，走 `/v1/assets/` 下载通道必被 `server.ts:649-652` 的前缀检查判 403。回执指向一个永远取不回的文件，"可复查"不成立。
  - **商户真正拿到的文件是浏览器 dataUrl，刷新即焚**：`mkfast-template-main/src/product/canvas-work-page.tsx:375` `setExportUrl(result.dataUrl)`，下载链接 `href={exportUrl}`（`:405-413`）是客户端内存数据，与服务端回执零关联；回执列表只展示时间/格式/字节数（`:414-422`），无版本指向、无校验对照、无下载入口。
  - **回执挂在 Work 上而非成品上**：`ExportReceipt`（`apps/core/src/p1/operations/types.ts:892-909`）键是 `workId/workRevisionId`，落在全局 `state.exportReceipts`（`:1118`、`p1_export_receipts` 表映射 `postgres-repository.ts:26`）——ADR-0011 要求 export receipts 是 ContentPackage 聚合一等字段，商户从成品出发查不到"这份成品导出过什么"。
- **export_failed 态无处安放**：全仓 `export_failed` 源码 0 命中；十条状态契约的"export_failed 不回退已成功版本与回执"没有域实现、没有合同测试。
- **撤权阻止导出无从谈起**：spec `:137`「撤权作用于 ContentPackage，阻止新导出」与故事 29（`:100`）当前无导出命令可阻；票 01 DoD 已写明"『撤权阻止新导出』的 seam 可见行为随票 13 的导出命令上线"——欠条落在本票。
- **内容库零导出动作**：`mkfast-template-main/src/routes/dashboard/content.tsx` 全文无任何 导出/下载 动作（grep 0 命中），商户在成品所在处无法把成品带出产品。
- **票界**：本票=导出命令 + 回执落进聚合 + export_failed 合同 + 商户可见"导出成功且有回执、可复查"。水印/AIGC **烧录进输出文件**与撤权完整旅程归票 15（但 rights=revoked → conflict 守卫是票 01 冻结合同条款，本票必须实现）；L3 发布包/发布快照是发布阶段对象，不归本票；D4 不重开（导出不触采用规则）；状态用语只用「创作中 / 可使用 / 需处理」（D14）。

## 现状代码入口（实核 file:line）

- `packages/contracts/src/content-package.ts`（票 01 交付，暂不存在）：冻结的 `export_content_package` 命令 schema（含 rights.state=revoked → conflict 显式条款）、`exportReceipts[]` 字段（platform/status/artifactAssetId/failureCategory，成品引用 owned Asset、禁临时 URL）、`export_failed` 状态与 D14 分组（需处理）。本票只消费不重定义；实现中发现字段缺口走票 01 冻结变更记录，不静默改。
- `apps/core/src/p1/foundation/application-service.ts:282-303`：`executeModule` seam 幂等（replay / in_progress / 同 key 异 payload `IDEMPOTENCY_CONFLICT`）——导出命令免费继承，禁自造第二套幂等。
- `apps/core/src/p1/operations/foundation-module.ts:603-608,779-784`：`export_work` 命令 case 与 `export_receipts` 查询 case——新命令/查询注册的现成形态。
- `apps/core/src/p1/operations/application-service.ts:3315-3394`：`exportWork` 全体——authorize → 版本核验（`:3322-3340`）→ port 执行（`:3351`）→ `mutate` 落回执 + `this.audit`（`:3368-3393`）的完整形态参照；`:3396-3401` `listExportReceipts`；`:415` `exportReceipts: []` 状态初始化。本票**不改 exportWork**（Work 导出归旧路径，D06 只读边界之外的既有能力维持原样）。
- `apps/core/src/p1/operations/types.ts:865-871,892-916`：`ExportArtifact`（objectKey/sha256/bytes/contentType）、`ExportReceipt`、`CanvasExportPort`——artifact 证据形态可借鉴，对象归属要换成 ContentPackage。
- `apps/core/src/p1/operations/adapters.ts:304-319`：`RecordedCanvasExportAdapter`——recorded 伪 objectKey 的反面教材，新导出的 recorded/fake adapter 只准进测试装配。
- `apps/core/src/p1/model-supply/index.ts:265-280,295-304`：`OwnedAsset`（contentType 联合当前仅 `'image/png' | 'video/mp4'`，`:270`）与 `ModelAssetStoragePort.persistGeneratedAsset`（workspace 前缀 objectKey + sha256 回执，Memory 实现的扩展名分支在 `:321-323`）——导出 artifact 持久化的既有通道；`main.ts:146` 生产装配 `fileSystemAssetStorageFromEnv`（真实落盘），`main.ts:545` `assetReader: assetStorage`。
- `apps/core/src/server.ts:629-665`：`GET /v1/assets/{objectKey}` 带 workspace 前缀门禁的下载通道——已存在，导出 artifact 复用，零新路由。
- `mkfast-template-main/src/lib/core-client.ts:238` + `src/routes/api/core/p1/assets.ts`：BFF 资产透传（immutable cache + content-type 保真）——下载链路前端段已通。
- `apps/core/src/p1/model-supply/index.ts:2585-2592`：`DurableVideoWorkflow.composedAsset`（`:2592`，票 01 prose 所引 `:2591` 漂移一行）已是 `OwnedAsset`——video 类成品的导出 artifact 无需二次持久化。
- `packages/contracts/src/uiux.ts:373-384`：`requiredP1Capability`——operations 新命令默认 `content.create`、查询默认 `workspace.read`，`export_content_package` 走默认映射零改动。
- `mkfast-template-main/src/routes/dashboard/content.tsx:100,136-143`：内容库当前读 `state.contents` 旧投影；票 07 切到 ContentPackage 后，本票的导出动作与回执面板挂在其成品详情上。

## 改造方案（步骤级）

垂直切片：合同核对（contracts）→ 域状态机 export 事件（core domain）→ Application Service 导出命令/回执查询 → 导出执行 Port/Adapter 与 artifact 持久化 → BFF/UI 导出动作与回执面板 → 合同测试与留证。

1. **合同核对（`packages/contracts/src/content-package.ts`，票 01 冻结版）**：逐字段核对 `export_content_package` payload（packageId + platform + idempotency key）与 `exportReceipts[]`。"可复查"所需字段——回执必须能对上**导出的是哪个平台哪个版本**：`variantVersionId`、`sha256`、`sizeBytes`、`contentType`、`createdAt`、`correlationId`；若冻结版缺失，走冻结变更记录 + 通知票 01/07/15 负责人，不得静默扩。回执 `status: succeeded | failed`，failed 带规范化 `failureCategory`（不暴露原始 provider/文件系统错误，沿"生成失败说明"口径）。
2. **域状态机 export 事件（`apps/core/src/p1/operations/content-package.ts`，票 01 落的转换表内追加守卫与转换）**：
   - 受理守卫：`rights.state=revoked` → `RIGHTS_REVOKED` conflict（冻结条款）；`needs_replacement` 阻止新导出意图；仅「可使用」组状态受理导出（accepted 必可导，review_ready 是否可导以票 01 冻结评审结论为准，默认不可导）。
   - 失败转换：port 执行失败 → 包状态 `export_failed`（分组「需处理」），追加 status=failed 回执；**必须行为=成品不回退**——已有版本、variants、既有成功回执、既有 artifact 全保留，转换表断言不清除。
   - 恢复转换：商户显式重试导出（新幂等键的新命令）成功 → 回「可使用」（accepted），成功回执追加，失败回执保留为历史事实。
3. **Application Service 命令/查询（`application-service.ts` 追加，不碰既有方法）**：`exportContentPackage(context, { packageId, platform })`——沿 `exportWork` 形态：authorize → 读包 → 解析目标平台 variant 的 `currentVersionId`（无该平台 variant → 明确 409，不静默导主体）→ 第 2 步域守卫 → port 组装 artifact → 持久化为 owned Asset → `mutate` 把回执写进**该包聚合的 `exportReceipts[]`**（不是全局 `state.exportReceipts`）+ `this.audit('content_package.exported', ...)` + `creationEvent`。查询侧 `content_package` 详情投影带回执列表，零新查询名。`foundation-module.ts` 命令 switch 加 1 case。幂等：经 `executeModule` 同 key replay 返回同一回执、不重复产文件；重试=用户显式动作产生新 key。
4. **导出执行 Port/Adapter（spec §2 明示"导出"位于 Ports/Adapters 外围可换 fake/recorded/live）**：新 `ContentPackageExportPort`，live adapter 按 kind 组装：
   - `image_text`：目标 variant 当前版本的 copy（title/body 文本文件）+ 有序视觉资产字节，用 `fflate`（零依赖成熟库，不自写 zip 格式）打成单一 zip，经 `ModelAssetStoragePort.persistGeneratedAsset` 持久化——`OwnedAsset.contentType` 联合与 objectKey 扩展名分支需加 `'application/zip'`（`model-supply/index.ts:270,321-323`，纯加法 union widening，grep 全部 contentType switch 逐处核对）。
   - `video`：成片已是 owned `composedAsset`（供应商 URL 过期用 owned archive 的既有语义），回执 `artifactAssetId` 直接引用之，不重复持久化；水印/AIGC 重编码归票 15。
   - 禁临时 URL：回执只准引用 workspace 前缀 objectKey 的 owned Asset；recorded adapter 只进测试装配，`main.ts` 生产装配必须接真实 adapter（防 `RecordedCanvasExportAdapter` 陷阱重演）。
5. **BFF/前端（票 07 的 ContentPackage 详情面上加载）**：BFF p1 commands 通用代理零改动；下载复用 `/api/core/p1/assets` 透传。UI 在成品详情加「导出」动作（选平台 variant，无 variant 的平台置灰并说明）与「导出记录」面板：每行=时间/平台/版本/大小/校验值/状态，成功行带指向 owned artifact 的下载链接（对照 `canvas-work-page.tsx:414-422` 只有时间+格式+字节且无下载的现状）；失败行显示「需处理」徽章 + failureCategory 中文说明 + 「重试导出」动作；撤权包的导出动作禁用并显示「权利已撤回」。状态徽章文案唯一来自票 01 的 `contentPackageStatusGroup` 纯函数，不自算第二套映射。
6. **合同测试与留证（打 Application Service 外部行为，照 `application-service.test.ts` setup）**：
   - 导出成功：accepted 包 + 平台 variant → 详情查询含 succeeded 回执（platform/variantVersionId/artifactAssetId/sha256），artifact 经 assetReader 以本 workspace 身份可读回且 sha256 一致，包状态不变。
   - **export_failed 合同测试（本票核心交付）**：fake port 注入失败 → 包转 `export_failed` 且 statusGroup=需处理；既有版本、variants、先前成功回执与 artifact 逐项断言未损（成品不回退）；失败回执带 failureCategory；显式重试成功 → 回「可使用」，两条回执并存。
   - 撤权阻断：`revoke_content_package_rights` 后导出 → `RIGHTS_REVOKED` conflict，零新回执、零新 artifact。
   - 幂等：同 key replay 回执数量不变；同 key 异 payload → `IDEMPOTENCY_CONFLICT`。
   - workspace 隔离：B 工作区导不了 A 的包，读不了 A 的 artifact（`server.ts:649-652` 前缀门禁断言）。
   - `postgres-repository.test.ts` 扩展：回执随包聚合真实事务持久化。测试是工程护栏，不是关票理由；证据落 `docs/evidence/contentpackage/ticket-13/`。

## DoD（全部必须是用户可见行为）

- **导出成功且有回执（主对照证据，当前 vs 改造后）**：商户在真实 dev 环境（真实 Postgres + 真实文件存储，非 fixture）的内容库打开一个「可使用」成品 → 选平台点「导出」→ 浏览器下载到真实文件（zip 可解开：文案 + 按序图片；video 为 mp4），同屏出现一条回执（时间/平台/版本/大小/校验/成功）。对照当前：内容库无任何导出动作、Canvas 导出的下载是刷新即焚的 dataUrl、回执无版本无校验无下载。改造前后录屏/截图各一份落 evidence。
- **回执可复查（跨会话）**：商户退出登录/换浏览器再进同一成品详情，回执仍在且下载链接仍可取回**同一文件**——校验值与重新下载文件的 sha256 一致。这是对 `recorded/exports/` 伪路径（当下回执指向永远取不回的文件）的直接对照。
- **导出失败可见且不伤成品**：注入失败演示下，成品在内容库显示「需处理」，详情给出失败原因中文说明与「重试导出」动作；此前的版本、平台 variant 与历史成功回执全部仍可见可下载；重试成功后回「可使用」，失败回执保留为历史行。
- **撤权即刻阻断**：对演示包执行撤权后，导出动作禁用并提示「权利已撤回」，强行经命令通道提交得到明确 conflict 而非新回执——票 01 欠条（撤权阻止新导出的 seam 可见行为）在本票兑现。
- **重复动作不产生重复文件**：同一幂等键重放导出命令，回执列表数量与存储文件数不变。
- **关票边界（禁止项）**：不得以"导出端点存在""adapter 单测绿""fixture 回执落库"关票——必须真实运行服务上的下载文件 + 回执复查演示 + 票 07 详情面上的真实 UI 操作证据三者齐备。本票关闭 ≠ 真实链路完成：北极星"真实跑通链路数"仍由票 22（D01 硬 Gate）计数；对外口径受 ADR-0011 约束，迁移与真实验收完成前不得宣称已上线。

## Blocked-by / Blocks

- **Blocked-by**：票 01（硬前置：`export_content_package` schema、`exportReceipts[]`、`export_failed` 契约全部以其冻结版为准；全局 gate=合同未冻结集内任何票不得关闭）；票 06（有采用成包的成品可导）；票 11（三平台 variant 存在，回执 platform/variantVersionId 才有真实指向）。票 12（variant 编辑/版本/回滚）相邻非前置——导出只读 `currentVersionId`。
- **Blocks**：票 15（水印/AIGC 烧录作用于本票建立的导出通路，撤权完整旅程在其上收口）。与 11/12/14 共同构成 E4 建设面——按 ADR-0009 单发布闸，任一缺席不发布；导出回执同时是票 22 真实链路留证链的证据环节之一。

## 风险与回退

- **`OwnedAsset.contentType` 联合扩展波及面**：`+ 'application/zip'` 是纯加法，但需 grep 全部按 contentType 分支的代码（存储扩展名、资产预览、下载 content-type）逐处核对；测试锁死既有 png/mp4 行为零回归。回退：union 收回 + 导出 adapter 下线，既有资产事实零损。
- **假导出陷阱重演**：`RecordedCanvasExportAdapter` 进了生产装配是本票最大的前车之鉴。控制：DoD 硬性要求真实文件下载且 sha256 对账；recorded/fake adapter 仅测试装配可注入；生产 `main.ts` 装配评审为冻结检查项。
- **回执被造成第二事实源**：回执是聚合内事实、artifact 才是 Asset（CONTEXT.md Asset 定义明示 avoid「导出 receipt」冒充 Asset；Canonical 对象搜索明示 receipts 不升格为可搜索业务对象）。控制：回执只在包详情投影，不进资产库、不进全局搜索；旧 Work `exportReceipts` 不迁移不双写（归票 17 的评估范围之外，维持只读）。
- **export_failed 语义争议**：失败是否覆盖包状态（若包正处 generating 等中间态时导出被拒，应是命令 conflict 而非状态转换）——只有「可使用」态受理导出这一守卫消解该歧义；恢复路径（重试成功回 accepted）写进合同测试；与票 01 冻结文本冲突时走冻结变更记录，不各自解释。
- **幂等与重复扣文件**：同 key replay 返回既有回执由 seam 机制保证；重试必须显式新 key，防止自动重投产出重复 artifact。
- **zip 依赖**：`fflate` 零依赖、体积小、Node 环境成熟；不自写 zip 格式，不引入 archiver 级重依赖。若依赖评审不过，降级方案=image_text 导出 artifact 先落单文件清单 + 逐资产既有下载通道（回执仍单 artifactAssetId 指向清单），但该降级须回票 01 走冻结变更确认。
- **回退**：导出命令注册、port/adapter、UI 动作全部纯增量，revert 即回改造前；已产生的 artifact 与回执保留为历史事实，不删除不改写。
