# 票 10 · 中转站 TuziMediaAdapter 手动适配
> 建设面: E3 媒体 ｜ 决策: DEC-REAL-ASSETS-MEDIA ｜ Blocked-by: 09

<!-- decision-ticket-map:start -->
```json
{
  "ticketId": "10",
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
    "09"
  ],
  "closureEvidence": [],
  "resolution": null,
  "status": "open"
}
```
<!-- decision-ticket-map:end -->

## 差距锚点

- **媒体生成没有任何可激活的真实通道，北极星媒体段 = 0**：唯一原生媒体 adapter 是 Ark（火山），但 Ark 凭据不在手上——`.env.example:43-59` 的 `ARK_MEDIA_API_KEY` 等全为空占位，激活证据 env 也为空，`seedream-5-pro-direct` / `seedance-2-direct` 两个部署（`apps/core/src/p1/model-supply/catalog.ts:366-367`）在无证据时恒为 inactive。手上唯一真实凭据是 tu-zi 中转站（`docs/_private/tuzi.env:4-5`，gitignore + secret-scan 范围外），当前只接了 LLM direct 模式，媒体侧零使用。
- **tu-zi 媒体格式与 Ark 原生不兼容，现有 adapter 发不出中转站请求**：tu-zi 图片 `/v1/images/edits` 用 messages 格式、视频 `/v1/videos` 用 content array + `reference_image`/`reference_video` 角色，与 Ark 的 `/images/generations`（纯 prompt JSON）、`/contents/generations/tasks`（`content: [{type:'text'}]`）请求形状不同（`docs/reviews/stage-diagnosis-2026-07-14/07-decision-log.md:91,99` 已探明并拍板"中转站在原生模板之上手动适配"）。今天全仓没有任何代码能构造 tu-zi 媒体请求。
- **真实素材进不了画面（C+ 缺口的 provider 侧断点）**：`ark-media-adapter.ts:449-455` 对 `image.edit` 直接抛 `reference_asset_resolution_required`（"Ark image editing requires provider-readable reference asset URLs"）；`:458-469` 的 `image.generate` 请求体只有 model/prompt/size；`:501-514` 的 `submitVideo` content 数组只有 text 一项。ADR-0011 所引 `ark-media-adapter.ts:449-465` 实核为 449-455（edit 拒收）+ 458-469（generate 纯 prompt），行号已按真实位置修正、结论未漂移。商户上传的门店照片至今只是授权/事实门禁，不是画面输入。
- **传参通道断**：创作台已经在往提交里塞素材 ID——`model-supply-creation-adapter.ts:316-322`（grounding 素材→`referenceAssetIds`）、`model-supply-image-adapter.ts:39-41`（`inputAssetId`→`referenceAssetIds`），但 `ModelSupplySubmission.input`（`model-supply/index.ts:99-104`）只有资产 ID 字段，没有 provider-readable URL 的承载位——即使票 09 把素材解析成了 URL，今天也没有字段、没有适配器可消费。
- **并存位缺失**：运行时媒体模式只认 `disabled|ark`（`runtime-config.ts:367-373`），装配选项只有 `arkMedia`（`adapters.ts:1341`），composite 只按 `model.id` 二分到 Ark 或 fallback（`adapters.ts:1365-1370`）——第二个媒体适配器没有可插的路由位。
- **票界**：本票落 TuziMediaAdapter（同一 ProviderExecutionPort 后）+ 与 Ark 并存路由 + 参考图/视频 URL 传参 + recorded 合同测试与 live 冒烟。`referenceAssetIds → provider-readable URL` 的解析、解析失败进"需处理"的状态语义归票 09；成品落 ContentPackage 的归宿归票 06/08；媒体模式可视化切换归票 18/20，本票只用 env 装配。不重开 D4（文案 3 选 1 单选与本票无涉），不新增 seam。

## 现状代码入口（实核 file:line）

- `apps/core/src/p1/model-supply/index.ts:524-530`：`ProviderExecutionPort` 注释明示"the only execution seam used by ModelSupplyApplicationService"——TuziMediaAdapter 必须站在这同一个 Port 后，不得开旁路。`:546-575` 是 `MediaProviderLifecyclePort`（submit/recover/poll/download/cancel），durable 媒体生命周期消费它。
- `apps/core/src/p1/model-supply/index.ts:103`：`input.referenceAssetIds?: string[]` 是唯一素材传参字段；`:763-771` `mediaSubmissionFingerprint` 对整个 submission（除 frozenRouteSnapshot）做 canonical hash——新增 URL 字段若含时效签名，会打破同 key 幂等重放，契约设计必须避开。
- `apps/core/src/p1/model-supply/ark-media-adapter.ts:148-229`：Ark adapter 同时实现两个 Port；同步图片 API 折成加密任务回执（scope 绑定 workspace+effectKey+model+credentialVersion，`:652-663`）、`recover` 不盲重投（`:275-289`）、`download` 归一 png/mp4 且临时 URL 有 TTL（`:341-406`）、key 脱敏（`:878-880`）——本票新 adapter 全套对齐这些语义。
- `apps/core/src/p1/model-supply/adapters.ts:1330-1342`：`ModelExecutionRuntimeOptions` 只有 `arkMedia?` 一个媒体选项；`:1359-1371` `ArkMediaCompositeExecutionPort` 按 `model.id === 'seedream-5-pro' | 'seedance-2'` 二分；`:1373-1389` `withArkMedia` 把 `runtime.media` 设成单个 Ark 实例；`:1462-1512` `createModelExecutionRuntime` 五种模式全部经 `withArkMedia` 收尾——并存改造的确切位置。
- `apps/core/src/p1/model-supply/runtime-config.ts:34,367-373`：`parseMediaMode` 只认 `disabled|ark`；`:452-489` `arkMediaOptions(env)` 读 ARK_* env；`:285-333` + `:63-123` 激活证据（`ARK_SEEDREAM/ARK_SEEDANCE` 前缀 + 配置指纹匹配）控制部署 active——TUZI_* 走同构机制。
- `apps/core/src/p1/model-supply/catalog.ts:225-226`：catalog models `seedream-5-pro`（image.generate/image.edit）与 `seedance-2`（video.generate）；`:366-367` 现只有 Volcengine direct 两个部署，无中转站部署。
- `apps/core/src/main.ts:139,296-304`：生产装配从 `modelRuntimeAssemblyFromEnv` 取 runtime，`modelRuntime.media` 存在时挂 `DurableMediaGenerationApplicationService`（单 provider 注入）——composite 必须同时实现 lifecycle Port 才能不动 main.ts 结构。
- `apps/core/src/p1/model-supply/media-generation-workflow.ts:205-211,232-235,296-307`：durable 效果器调 provider.submit/poll/download，成功后 `persistProviderAsset` 落自有存储；`:664-670` submission 经 job payload structuredClone round-trip——新增 input 字段可原样穿透。
- `apps/core/src/p1/model-supply/ark-media-adapter.test.ts:51-118`：现成的合同测试形态（fetch mock 断言请求体/鉴权头/回执 scope/下载归一/cancel 语义）——TuziMediaAdapter 合同测试仿此结构，fixtures 换成真实响应录制。
- `apps/core/src/p1/model-supply/live-llm-provider.integration.test.ts:22-31`：live 测试门控惯例（`RUN_LIVE_MODEL_PROVIDER_TEST=1` + 缺 env 显式 skip 原因）——媒体 live 冒烟沿用。
- `references/benchmark/ai-native-journey-study-2026-07-08/sources/agentkit-samples/.../video_generate_http.py:287-294`：官方 content array 形状实证（`{type:'image_url', image_url:{url}, role:'reference_image'}`）——tu-zi `/v1/videos` 角色字段的参考基线，最终以真实响应录制为准。

## 改造方案（步骤级）

1. **先冻结契约（schema 层，与票 09 共享）**：在 `model-supply/index.ts` 的 `ModelSupplySubmission.input` 增加已解析参考素材字段（形如 `resolvedReferenceAssets?: Array<{ assetId; url; kind: 'image' | 'video' }>`），`referenceAssetIds` 保留为审计/门禁锚。约束两条：URL 必须是 provider-readable（票 09 产出）；canonical 幂等指纹以 assetId + 内容摘要为准、把易变签名 URL 排除出 `mediaSubmissionFingerprint` 的敏感部分（或要求解析确定性），防同 key 不同 payload 冲突。谁先落地谁定形状，另一方只消费不重定义。
2. **手写 TuziMediaExecutionPort（adapter 层，新文件 `tuzi-media-adapter.ts`）**：实现 `ProviderExecutionPort + MediaProviderLifecyclePort`，与 Ark 同构——图片（`image.generate`/`image.edit`）走 `/v1/images/edits` messages 格式，有参考图时把 resolvedReferenceAssets 的 URL 作为 image 内容项传入，无参考时纯文本 prompt；视频（`video.generate`）走 `/v1/videos` content array，text 项 + `role:'reference_image'` / `role:'reference_video'` 的 URL 项，异步任务 id 轮询取 `video_url`。复用 Ark 的全套安全语义：加密任务回执 + scope 绑定、recover 不盲重投（中转站同样无按客户端请求号查询）、错误分类（429→rate_limit、5xx→transient、内容安全→content_policy）、key 脱敏、下载归一 png/mp4、成功产物必须落自有存储才算交付（临时 URL 不算完成）。带参考的请求若缺 resolvedReferenceAssets，抛与 Ark 同码的 `reference_asset_resolution_required`，沿现有失败分类链呈现"需处理"，不静默去参考生成。媒体中转无官方 `@ai-sdk/*` provider，手写 fetch 是 spec §8 点名的"手动适配"，与 Ark 同构、不算裸写重复。
3. **并存装配与路由（组装层）**：`catalog.ts` 为同两个 catalog model 增加中转站部署（如 `seedream-5-pro-tuzi-relay` / `seedance-2-tuzi-relay`，channel 'direct'、apiCounterparty 'tu-zi'、独立 executionChannelId）；`adapters.ts` 把 `ArkMediaCompositeExecutionPort` 泛化为按 `request.deployment.executionChannelId` 分发的媒体路由（无 channelId 时回退 model.id 保持向后兼容），composite 同时实现 lifecycle Port，`ModelExecutionRuntimeOptions` 增 `tuziMedia?`；`runtime-config.ts` 把 `MODEL_MEDIA_EXECUTION_MODE` 扩为 `disabled|ark|tuzi|ark,tuzi`（逗号并存），新增 `tuziMediaOptions(env)`（TUZI_MEDIA_BASE_URL/API_KEY/CREDENTIAL_VERSION/ENDPOINT_REVISION + 图/视频 provider model 与计价 + TTL）与 TUZI_* 激活证据（配置指纹机制与 ARK_* 同构）；`.env.example` 补 TUZI_* 块与诚实注释。main.ts 不动结构。
4. **Application Service 外部行为收口（不新增 seam）**：路由候选评估对"带 resolvedReferenceAssets 的提交"排除不支持参考角色的部署（新增 exclusionReason 或复用现有机制），保证并存时参考请求不误投 Ark；失败不自动跨通道重投（媒体 fallback 需 consent 的既有语义不改）；Provider Cost 与 Product Usage 双账沿用配置单价 × 真实用量。所有断言打 Application Service 外部行为，不测 adapter 内部调用序。
5. **商户可见接线确认（前端零新组件）**：创作台提交链已通（`model-supply-creation-adapter.ts:310-353` 提交→durable 媒体 job→Asset 交付投影），tu-zi 部署激活后商户提交即真实执行；状态映射沿用"创作中/可使用/需处理"，不新增用户状态词。核对交付视图对真实 mp4/png 的预览与下载无 recorded 假定即可。
6. **测试（recorded 合同 + AS 行为 + live 冒烟）**：先用真实凭据各做一次探测调用抓真实响应形状，录成 fixtures，再写 `tuzi-media-adapter.test.ts`（messages 格式、reference 角色、回执 scope、脱敏、错误分类、下载归一、cancel）；`adapters.test.ts` 增 composite 按部署分发、ark 与 tuzi 并存互不误投；`runtime-config.test.ts` 增模式组合解析、TUZI_* 必填、证据指纹不匹配报错、部署激活边界；AS 外部行为测试覆盖带参考提交路由到 tuzi 部署、缺解析 URL 进"需处理"、同幂等键不重复计费；新增 `live-tuzi-media.integration.test.ts`（显式门控，默认不进 CI）。测试只是工程护栏，不作 DoD。
7. **激活证据与留证（D01 口径）**：真实探针 smoke 跑通图/视频各一次 → 产物存档为 evidence ref → 写 TUZI_* 证据 env → 部署转 active → 商户在工作台真实跑一次并留证。证据是真实产物文件引用，不是环境变量哈希伪装（呼应 spec §10；票 20 后续把该链搬进配置中心）。

涉及文件：`apps/core/src/p1/model-supply/tuzi-media-adapter.ts`（新）、`tuzi-media-adapter.test.ts`（新）、`live-tuzi-media.integration.test.ts`（新）、`index.ts`、`adapters.ts`、`adapters.test.ts`、`runtime-config.ts`、`runtime-config.test.ts`、`catalog.ts`、`catalog.test.ts`、`.env.example`、`docs/_private/tuzi.env`（补媒体条目，不进 git）。

## DoD（全部必须是用户可见行为）

- 商户在创作台提交一次视频生成后，拿到可播放、可下载的真实成片（mp4，画面与 prompt 对应），不再是 recorded 假产物。**对照证据（当前 vs 改造后）**：同一提交在改造前（fixture/recorded 模式的假回执假产物，或 direct 模式下 seedance 部署 inactive 不可提交）与改造后（tu-zi 通道真实成片帧）各留三帧截图/录屏并排。
- 商户把已授权的真实门店照片作为参考提交图片编辑或视频生成，产出画面可辨识参考来源（`reference_image` 角色真实生效），"真照片 + AI 加工"第一次在本产品成立；同一 prompt 无参考 vs 带参考两次真实产物并排留证。此条与票 09 的解析链**联合验收**——票 09 接通商户上传素材的旅程后回挂证据，本票不得凭 adapter 合同测试绿单独关此条。
- 商户生成失败或参考素材不可读时，工作台显示"需处理"与明确原因，不静默丢弃参考出一张与素材无关的图冒充成功；重试沿用原幂等键，不产生重复扣费或重复产物。
- 管理员可核激活真伪：seedream/seedance 经 tu-zi 通道的部署由"未激活"变为 live_verified，激活证据指向真实探针产物存档；Ark 部署在无凭据时保持 inactive 且任何界面/文档不得出现"只差一个 Key"式表述（D10 诚实标注口径）。
- 商户生成后用量与费用双账真实呈现：Product Usage 计 1 次、Provider Cost 为配置单价 × 真实用量；取消/失败不重复计费。
- 状态用语全程只出现"创作中 / 可使用 / 需处理"（D14），设备与页面不因新通道出现第四种状态词。
- 禁止以"adapter 写完 / 合同测试绿 / 端点能 curl 通"关票；关票判断以上述商户与管理员可见行为 + 真实产物留证为准（D01 硬 Gate）。

## Blocked-by / Blocks

- **Blocked-by**：无硬实施前置——spec §11"三原生模板落地后手动补齐"的前置已满足（三原生 LLM 模板 2026-07-14 已落地全绿，`07-decision-log.md:80-91`）；凭据已备（`docs/_private/tuzi.env`）。软约束两条：① 与票 09 共享第 1 步的 resolvedReferenceAssets 契约（先落地方定形状）；② 本票限定在 Ports/Adapters 外围与装配层，不触碰 ContentPackage 聚合合同，不构成票 01（E1 冻结）前的"大规模页面/后端扩建"。
- **Blocks**：票 09（真实素材进媒体——reference 角色的唯一 live 执行载体在本票）；票 22（一条真实链路端到端留证——真图/真片段当前只能经本通道，Ark 无 key）；票 18/20（媒体执行模式可视化切换与 adapter 装配点选，需要 ark/tuzi 两个真实选项先存在）。解阻不等于关票：本票第二条 DoD 待票 09 回挂。

## 风险与回退

- **tu-zi 真实 API 形状与决策日志描述有出入**：`/v1/images/edits` 的 messages 字段名、`/v1/videos` 的轮询路径与响应字段未经我方留档实测，中转站文档可能与官方 Ark 语义混排。控制：第 6 步强制"先真实探测、以真实响应录 fixtures、再写合同测试"，不硬编码猜测形状；若角色字段与 `reference_image`/`reference_video` 命名不符，以真实响应为准并在票内注记修正。
- **中转站稳定性/限流/计价不透明**：错误分类沿用 classify 语义（429 可重试、5xx transient、内容安全不可重试）；单价走 env 配置，拿不到真实用量时保持 unknown 不补造事实；`acceptance_unknown` 不盲重投（与 Ark recover 同语义），防首次接受后重复花费。
- **参考 URL 可读性与时效**：provider 拉不到 URL（私网/过期/防盗链）必须归为可见失败进"需处理"，绝不静默降级为无参考生成——那是"看起来成功、实际与素材无关"的假成功，比失败更伤信任；成功产物必须落自有存储（沿用 P1 Attempt 语义，临时 URL 不算完成）。
- **幂等指纹被易变 URL 打破**：签名 URL 进 canonical hash 会让同 key 重放变 conflict。控制：第 1 步契约把易变部分排除出指纹（以 assetId + 内容摘要为 canonical），合同测试断言同 key 重放只查询不重投。
- **双通道误投/重复计费**：composite 按部署 executionChannelId 分发 + 并存合同测试互不误投断言；路由候选排除不支持参考角色的部署；失败不自动跨通道重投。
- **凭据泄漏**：tu-zi key 与 Ark 同样全链路脱敏（错误消息 redact、任务回执 AES-GCM 加密且 scope 绑定）；`docs/_private/tuzi.env` 已在 gitignore 与 secret-scan 范围外，票内文档只引路径不引值。
- **C+ 半途险**：adapter 落了但票 09 未接，商户仍看不到"真照片进画面"。控制：DoD 第二条钉死联合验收，防"后端就绪"式关票（ADR-0011 尾注铁律）。
- **回退**：`MODEL_MEDIA_EXECUTION_MODE` 去掉 `tuzi` 即整通道下线，Ark 原生 adapter、recorded/fixture 模式与既有 LLM 三模板零受影响；本票不迁移任何事实、不删任何旧代码，回退无数据动作。
