# 票 09 · 真实素材进媒体生成
> 建设面: E3/C+ 媒体 ｜ 决策: DEC-REAL-ASSETS-MEDIA ｜ Blocked-by: 01

<!-- decision-ticket-map:start -->
```json
{
  "ticketId": "09",
  "decisionIds": [
    "DEC-REAL-ASSETS-MEDIA"
  ],
  "guardrailDecisionIds": [],
  "gapIds": [
    "G-ASSET-NOT-INPUT"
  ],
  "contractIds": [
    "X-REAL-ASSET-IN-MEDIA"
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

- **真照片被拒（confirmed）**：商户在工作台勾选已授权门店照片后提交图片编辑，Ark 适配器在 `image.edit` 分支直接抛 `reference_asset_resolution_required` 拒绝执行（`apps/core/src/p1/model-supply/ark-media-adapter.ts:449-455`，brief 锚点 449-453 未漂移，实际右界到 455）。商户视角：任务必然失败，"用我的店照片改图"根本不存在。
- **真照片被静默丢弃（confirmed）**：`image.generate` 请求体只组装 model/prompt/size 等字段（`ark-media-adapter.ts:458-472`，prompt 在 :464、size 在 :465，brief 锚点未漂移），`referenceAssetIds` 全程不进请求；`submitVideo` 的 content 数组同样只有 text（`:501-511`）。商户视角：选了店照片，出的图与自己的店毫无关系，且没有任何提示说照片没被使用——这是比失败更危险的形态。
- **解析层全仓空白（confirmed）**：`referenceAssetIds` 已经从操作层流转到 adapter 层（`apps/core/src/p1/operations/model-supply-creation-adapter.ts:318`（submit）与 `:386`（startCopyStream），brief 锚点精确未漂移），但全仓没有任何代码把 assetId 解析成 objectKey → bytes/provider-readable URL。商户照片的字节存在 BFF R2（`mkfast-template-main/src/api/product-assets.ts:80-83`，`isPublic: false`），唯一读取路由是会话鉴权的 `/api/storage/file`（`mkfast-template-main/src/routes/api/storage/file.ts:26-62`）——供应商在公网根本取不到；core 自有存储只认 `generated|composed` 命名空间（`apps/core/src/p1/model-supply/filesystem-asset-storage.ts:278-286`），也读不了商户上传。
- **fixture 假绿掩盖断裂（confirmed）**：recorded 媒体适配器对 `referenceAssetIds` 只做存在性与上限校验即放行（`apps/core/src/p1/model-supply/adapters.ts:684-711`），录制模式下"参考图能力"看似就绪。这正是 ADR-0011 病灶原文"真实素材当前只是授权/事实门禁，不是画面输入"与 spec Problem Statement"真照片 + AI 文案 = 图文成品这条核心价值被掐断"的代码实体。
- **票界**：本票交付"解析端口 + Ark 图片通道接受参考图 + 解析失败进需处理"这条纵切；中转站 TuziMediaAdapter（图片 `/v1/images/edits` multipart 与视频 `reference_image/reference_video` 角色）由票 10 复用本票解析产物落地；成品入 ContentPackage 内容库归票 06/07；真实链路端到端留证汇聚在票 22。本票不碰文案候选（D4 三选一单选不涉及、不重开）。

## 现状代码入口（实核 file:line）

- `apps/core/src/p1/model-supply/ark-media-adapter.ts:449-455`：`submitImage` 的 `image.edit` 分支硬抛 `ArkAdapterError('reference_asset_resolution_required', …)`；`:458-472` generate 请求体无任何图输入字段；`:501-511` `submitVideo` content 纯文本。三处均已实核，brief 锚点无实质漂移。
- `apps/core/src/p1/operations/model-supply-creation-adapter.ts:316-322,384-390`：`groundingSnapshot.assets` 映射为 `input.referenceAssetIds`（仅 id 数组），brief 锚点 :318/:386 精确未漂移。
- `apps/core/src/p1/model-supply/index.ts:99-104`：`ModelSupplySubmission.input.referenceAssetIds?: string[]` 是当前唯一承载；`:1516-1540` `mediaProviderRequest` 将 submission structuredClone 原样透传给 adapter，无解析步骤。
- `apps/core/src/p1/model-supply/media-generation-workflow.ts:609-617`：`providerRequest` 组装 `MediaProviderEffectRequest`，是执行期注入解析产物的挂点；`:601-607` 恢复路径明示"persisted attempt 只 reconcile 不重投"。
- `apps/core/src/product/p1-model-policy.ts:112-123`：grounding 解析器构建 snapshot 时刻意只保留 id 与权利事实、丢弃 objectKey（`apps/core/src/p1/operations/types.ts:627-638` snapshot.assets 无 objectKey 字段）；`:50-58` 已复核 `sourceType==='real' && authorizationStatus==='authorized' && rightsEvidence` 的授权门禁——门禁健在，画面输入缺席。
- `packages/contracts/src/product.ts:65-82`：Product Asset 合同持有 `objectKey` 与 `authorizationStatus`（含 `withdrawn`）；`apps/core/src/product/product-service.ts:1828-1842` `add_asset` 校验 objectKey 必须 workspace 前缀。解析所需事实齐备，只是没人去读。
- `apps/core/src/job-worker.ts:284`：job-worker 生产装配已持有 ProductRepository（供 `ProductCreativeGroundingResolver`），解析 adapter 的 objectKey 查询无需新依赖注入通道。
- `mkfast-template-main/src/lib/core-client.ts:95,161,227`：BFF→core 以 `x-service-token`（`CORE_SERVICE_TOKEN`）建立服务信任；反向 core→BFF 取文件通道目前不存在。`apps/core/src/p1/model-supply/filesystem-asset-storage.ts:39-40`：core 环境已有 `APP_BASE_URL` 指向 BFF，反向通道的地址配置现成。
- `mkfast-template-main/src/product/unified-creation-workbench.tsx:829-832`：工作台已让商户勾选素材生成 `sourceReferences`（kind: 'asset'），但界面没有任何"这些照片将作为参考图进入画面"的语义提示。
- `apps/core/src/p1/operations/types.ts:699`：`CreativeJob.failureCode?: string` 已存在，是"需处理"原因映射到前台的现成载体。

## 改造方案（步骤级）

1. **先锁解析契约（契约层）**：在 `apps/core/src/p1/model-supply/` 定义 `ReferenceAssetResolverPort`：`resolve(workspaceId, assetIds)` 返回逐素材 `{ assetId, contentType, bytes, sha256 }` 或逐素材失败 `{ assetId, reason: 'not_found' | 'authorization_withdrawn' | 'unreadable' | 'oversized' }`。产物形状必须同时满足两类 provider 合同——URL 型（base64 data URL / https URL，Ark 用）与字节型（multipart，票 10 tu-zi 用）——避免票 10 返工。该端口位于 Ports/Adapters 外围，**不新增 seam**。
2. **提交期 fail-fast（Application Service 行为）**：`model-supply-creation-adapter.ts` 组装 `referenceAssetIds` 后、`controlPlane.submitGeneration` 之前，对媒体操作调用解析端口 dry-run（只验存在性 + `authorizationStatus==='authorized'` + objectKey 可读，不取 bytes）；失败抛 `OperationsError 409 REFERENCE_ASSET_UNRESOLVED`——**不创建付费 Job、不预留额度**，落实十条状态契约"不创建付费任务补齐缺项"。
3. **执行期最终解析（job-worker 层）**：`media-generation-workflow.ts` 在 provider effect 之前经端口取 bytes 注入 `MediaProviderEffectRequest`（解析产物是执行事实，不回写 submission 持久层、**不进 canonical payload hash**，幂等重放与恢复用原 key 只查询）；提交后撤权/删除的竞态在此兜底：解析失败 → Job `failed` + `failureCode='reference_asset_resolution_required'`（非重试）→ usage 走既有 refunded 路径 → ContentPackage 映射 needs_input/「需处理」（状态语义来自票 01 冻结的十条状态契约）。
4. **解析 adapter 实现（bytes 来源）**：objectKey 查 ProductRepository（job-worker 既有依赖）；bytes 经 BFF 内部只读文件通道获取——在 mkfast 新增（或扩展 `file.ts`）一条校验 `x-service-token === CORE_SERVICE_TOKEN` + workspace 前缀匹配的内部 GET，core 侧用 `APP_BASE_URL` 反向 fetch。**不把 R2 凭据复制进 core、不生成公网可猜 URL**。带尺寸守卫：超限归 `oversized` 进需处理（实现期可选 sharp 降采样，但不得静默改变"照片是否被使用"的语义）。
5. **Ark adapter 接受参考图（provider 层）**：`ark-media-adapter.ts` 删除 `image.edit` 硬拒分支；`image.edit` 与携带参考图的 `image.generate` 均按 Ark 官方 images API 图输入合同传参（URL 或 base64 data URL，确切字段名以官方文档为准并用 live smoke 校验，本 brief 不冒充已核实的 API 形状）；上游未注入解析产物的 `image.edit` 保留原错误码作编程错误保护。视频参考喂入不在本票（归票 10 中转站 reference 角色），解析端口形状已为其预留。
6. **前端可见语义（BFF/界面层）**：工作台图片生成表单在勾选素材后明示"将使用你选中的门店照片作为参考图"并展示所选缩略图（`unified-creation-workbench.tsx` 素材勾选区就地增强，不新增页面）；`reference_asset_resolution_required` / `REFERENCE_ASSET_UNRESOLVED` 在任务视图映射为「需处理」+ 缺失素材清单 + 修复动作（去素材页补授权或重传）；移动端共享同一状态机与用语，只改布局。补齐对应 i18n key。
7. **测试（打 Application Service 外部行为）**：合同测试用 fake resolver + fake provider port 断言四条外部行为——带已授权照片提交后 provider 收到含参考图的请求且 Job 完成、产物入自有存储；未授权/不存在素材提交 → 409 且无 Job 无额度扣减；执行期解析失败 → Job 失败进需处理、usage refunded、无 provider effect、原幂等键重放只查询不重投；撤权后再提交 → fail-fast。Ark adapter 单测断言 edit/generate 请求体含参考图字段。live smoke 显式、隔离、默认不进普通 CI。测试是工程护栏，不作关票依据。

涉及文件：`apps/core/src/p1/model-supply/index.ts`、`ark-media-adapter.ts`、`media-generation-workflow.ts`、新增解析 adapter 文件、`apps/core/src/p1/operations/model-supply-creation-adapter.ts`（含 .test.ts）、`apps/core/src/job-worker.ts`、`apps/core/src/main.ts`（装配）、`mkfast-template-main/src/routes/api/storage/file.ts`（或新增内部路由）、`mkfast-template-main/src/product/unified-creation-workbench.tsx`、i18n 资源文件。

## DoD（全部必须是用户可见行为）

- 商户在工作台勾选一张已授权的真实门店照片提交图片生成/编辑后，得到一张画面明显来自这张店照的成品图并进入后续流程。**对照证据（当前 vs 改造后）**：改造前同一操作 `image.edit` 必失败（`ark-media-adapter.ts:449-455` 硬拒）、`image.generate` 出图与店照无关（`:458-472` 丢弃参考图）——留存改造前失败/无关图截图，与改造后"勾选店照 → 含参考图的生成 → 店照可辨识的成品图"三帧并排。
- 商户在生成表单能看到"将使用你选中的门店照片作为参考图"与所选照片缩略图，提交前就知道照片会不会进画面；对标即梦/KickArt 的参考图上传交互留一组并排截图（范式参考，非订阅套壳）。
- 商户选中的照片若已撤权、被删除或无法读取，提交时立即看到「需处理」提示与具体原因（哪张照片、缺什么、怎么补），**额度不减、不产生付费任务**；生成过程中素材失效则任务进入「需处理」且额度退回——两种路径都不允许静默丢照片出一张无关图。
- 真实链路留证：用真实媒体凭据把"真门店照片 → 含参考图的真实生成 → 成品图入自有存储"跑通一次并留证（`docs/_private/tuzi.env` 已备中转站凭据；若 Ark 直连凭据未备，本票后端交付先解阻票 10，由票 10 中转站通道或票 22 端到端旅程回挂真实证据后方可关票——recorded/fixture 全绿不满足 D01，不得关票）。
- 既有可见行为不回退：未勾选素材的纯 prompt 生成不受影响；媒体模型仍显式选择、无跨品牌 Auto；文案 3 选 1 采用行为无任何变化。

## Blocked-by / Blocks

- **Blocked-by**：票 01（ContentPackage 聚合合同 + 十条状态契约冻结）——「需处理」/needs_input 的状态语义与"不创建付费任务补齐缺项"必须行为以票 01 冻结的合同为准；且 MAP 全局规则：票 01 关闭前任何票不得关闭。
- **Blocks**：票 10（TuziMediaAdapter 直接消费本票解析产物的 multipart/URL 双形态，reference_image 角色解 C+ 缺口）→ 票 22（真实链路端到端 0→1 以"真实素材进媒体"为必经环节）。解阻不等于关票；本票须等真实素材生成的用户可见证据回挂后关闭。

## 风险与回退

- **Ark 图输入合同不确定**：base64 上限、字段名、URL 可达性要求均以官方文档 + live smoke 为准，不在代码里臆造。若 Ark 直连的图片编辑合同与预期不符或凭据不备，真实素材首选通路切到票 10 中转站（`/v1/images/edits` multipart），本票解析层与状态机不变——这正是解析产物做成双形态的原因。
- **最危险的回退形态是静默降级**：任何实现或回退都禁止"解析失败就丢掉参考图退化为纯 prompt 生成"——那会复活"商户以为用了自己照片"的欺骗态。回退只允许 revert 到"明确拒绝 + 需处理"，不允许中间灰态。
- **BFF 内部文件通道安全**：通道必须校验服务 token + workspace 前缀 + 只读 GET；不签发公网长效 URL、不把商户照片挂到可猜测地址；照片 bytes 只在单次生成请求生命周期内使用，不落第二份持久缓存。
- **撤权竞态与账务**：提交期 dry-run 与执行期最终解析双检；执行期失败走既有 usage refunded 路径且原幂等键只查询（沿用 `media-generation-workflow.ts:601-607` 只 reconcile 不重投语义），不重复扣费、不重复解析重投。
- **大图与性能**：门店实拍常见数 MB，尺寸守卫先行（超限进需处理并提示压缩重传）；降采样是可选优化，出现时必须保持"照片确实进入画面"的可见语义，不得以性能为由悄悄换成纯 prompt。
- **recorded 假绿回潮**：recorded adapter 的参考图校验保留为工程护栏，但本票所有关票判断只认真实通路证据；北极星口径下 recorded 完备性不计进度（D03）。
