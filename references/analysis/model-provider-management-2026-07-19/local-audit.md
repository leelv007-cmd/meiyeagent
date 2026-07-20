# 多渠道模型供应商管理：当前实现只读审计

- 审计日期：2026-07-19
- 审计范围：Core `model-supply`、官方凭据与 BYOK、后台配置、管理端/用户端 UI、相关单元/集成/E2E 测试
- 方法：以当前代码和测试为准的静态只读核对；未使用生产密钥执行 opt-in live tests
- 结论口径：`已交付` 表示生产主链已有真实实现；`半成品` 表示合同或界面存在，但生产闭环不完整；`目录/PoC` 表示只能作为记录、fixture 或技术验证，不能按生产供应能力计算

> 后续范围裁决：本文第 12 节原先以“双 LLM Provider”描述最小技术突破口；用户随后通过 D-068/D-069 明确首轮必须同时交付文本、图片、视频，且文本生成、图片生成、视频生成各有至少两条独立 `live_verified` 渠道。本文代码现状证据仍有效，开发范围以 D-068/D-069 和本研究 bundle 的 README 为准。

## 1. 一句话结论

当前系统已经有一套相当扎实的“模型供应内核”：统一四模态目录、Deployment/RouteSnapshot、激活探针、用量与供应商成本账本、目录版本发布和回滚都已存在。真正缺失的是“平台级多供应商运营控制面”：生产 LLM 仍是单 direct 槽位，媒体供应商和凭据是硬编码/环境变量装配，无法通过后台动态新增或热激活；自动路由只按质量分且最多两个候选，没有生产级熔断、限速、预算和多模态发布门禁。

因此下一轮不应重写目录、账本或 RouteSnapshot，而应围绕现有 Core truth 补齐 `ProviderInstance → Credential → ModelDeployment → Health/Quota/Cost → Release` 的平台级管理闭环。

## 2. 当前系统的真实范围边界

### 2.1 已经属于 Core 的产品真相

- 四种模态和八种操作已统一定义：LLM、图片、视频、音频；文案生成/改写、文本响应、图片生成/编辑、视频生成、语音、音效。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/index.ts:16-28`。
- `CatalogModel` 与 `ModelDeployment` 已能表达厂商、稳定模型名、版本、Provider Profile、Execution Channel、实际 provider model、endpoint revision、API 相对方、凭据所有者、区域、策略、价格、能力和激活证据。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/index.ts:83-134`。
- 不可变 `RouteSnapshot` 已冻结目录版本、候选、实际 Deployment、策略/价格/凭据版本、供应商与渠道事实、fallback rank 和数据分类。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/index.ts:294-356`。
- 未来提交可切换目录版本，已开始的作业继续使用原 RouteSnapshot；发布前会校验 active Deployment 是否在当前进程的 runtime capability 内。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/index.ts:1293-1350`、`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/index.ts:2869-2883`。
- 生产入口真实使用 Postgres ModelSupply Repository、Foundation Ledger、HTTP/Worker 共用的运行时装配和 Durable Media lifecycle，而不是只存在于测试 fixture。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/main.ts:285-342`、`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/main.ts:396-433`、`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/job-worker.ts:223-298`。

这些边界不应交给未来的 LiteLLM/Bifrost 或其他网关接管。网关可以负责协议调用、实例内限流和指标采集；只有能证明请求尚未被上游接受时，才允许发生有上限的实例内重试。目录、跨 Deployment 路由/回退、数据策略、发布、RouteSnapshot、产品额度和最终结算仍应由 Core 持有。

### 2.2 当前“平台级”和“工作区级”发生了混用

这是本轮最需要先定下来的范围决策。

- 运行模式、官方凭据和激活证据使用全局 `__global__`：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/integrations/foundation-module.ts:293-317`、`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/foundation-module.ts:1346-1377`。
- 目录 revision/head、激活探针 run、质量评测、回滚审计全部按 `workspace_id` 持久化：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/postgres-repository.ts:59-87`、`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/postgres-repository.ts:126-160`。
- 探针从当前工作区目录选 Deployment，并把 run 存在当前工作区，完成后却写入全局 activation evidence：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/foundation-module.ts:1179-1218`、`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/foundation-module.ts:1319-1377`。
- 所有目录管理 command 又把 `context.workspaceId` 作为控制面作用域：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/foundation-module.ts:3757-3813`。

这意味着现在没有一个清晰的“全系统供应目录”对象：平台管理员操作的是所处工作区的 catalog/quality history，却影响全局 runtime/credential/evidence。建议本轮明确：

1. 全局层拥有 Provider、Channel、Platform Credential、Model、Deployment、Price、Health、Release。
2. 工作区层只拥有默认模型、个人偏好、BYOK connection，以及未来可选的政策覆盖；不复制平台供应目录。
3. 若确实需要工作区私有 Deployment，应作为显式 overlay，而不是让平台目录天然按 workspace 分裂。

## 3. 能力盘点

| 领域 | 当前状态 | 真实结论 |
|---|---|---|
| Catalog / Provider / Channel / Deployment | 已交付内核，管理半成品 | Schema 完整、默认记录广，但后台只有全量 JSON 编辑，没有结构化 CRUD；运行时不能热装配新 Provider |
| LLM 生产执行 | 半成品 | 同一进程只能装配一个 direct catalog model；不是多供应商池 |
| 图片生产执行 | 部分交付 | 真实装配仅 Ark 与 Tuzi 的有限身份；其余多数为 documented/recorded |
| 视频生产执行 | 部分交付 | 真实装配仅 Ark/Tuzi；Kling/Grok/Veo 等默认只是目录/recorded surface |
| 音频生产执行 | 部分交付 | Volcengine Seed TTS 2 有真实 lifecycle；SFX 只有 fixture；后台模式 UI 还无法配置 `volcengine_tts` |
| 官方平台凭据 | 半成品 | Vault、轮换、撤销、连通性测试存在，但只接通 `model.direct` 与 `ark.media`；Tuzi/TTS 仍靠 env |
| Workspace BYOK | 半成品 | 安全存储、owner-only、受控 endpoint、独立账本已交付；仅 OpenAI-compatible LLM，且停留在设置页独立执行面板 |
| 自动路由与安全 fallback | 部分交付 | Core 语义正确，但只支持 LLM copy/text、按质量排序、最多两个候选；媒体无跨供应商 fallback |
| 熔断/限速 | PoC/缺失 | 只有进程内 30 秒 recorded cooldown 和全局 kill switch；没有分布式 provider health/circuit/rate limit |
| 产品配额与供应成本 | 账本已交付，治理缺失 | 产品额度和 provider cost 可结算；无供应商预算、余额/配额同步、聚合看板、成本告警或 cost-aware route |
| 激活探针 | 已交付 | 真实执行、配置 fingerprint、全 operation 覆盖、媒体下载校验和成本证据均有 |
| 评测 / 发布 / 回滚 | 部分交付 | 版本生命周期与回滚可靠；质量评测仅 beauty copy，且不构成发布门禁 |
| 权限 / 审计 | 部分交付 | 有 admin guard、actor/correlation/reason；权限仍是二元 admin，且部分管理查询未加入 admin guard |
| 管理 UI | 半成品 | 已有模式、探针、目录、模拟、评测、发布/回滚、凭据卡；工程化、分散且缺少统一供应商工作台 |

## 4. Provider、Model 与 Catalog

### 4.1 已交付

- 默认目录记录了 5 个 LLM、5 个图片模型、5 个视频模型、1 个真实 TTS 身份和 2 个音频 fixture。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/catalog.ts:329-538`。
- 默认 Provider Profile 包含 OpenAI、Anthropic、Google、国内/自定义、Volcengine、Tuzi、Kling、xAI 等。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/catalog.ts:541-561`。
- Execution Channel 已描述 direct、managed、fal、Replicate、Bifrost、LiteLLM。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/catalog.ts:564-850`。
- 目录 revision 有 `draft → enabled → published → retired` 的不可变状态机：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/catalog.ts:214-325`。
- 发布使用 expected head 做 CAS，并把新 revision 应用于未来请求；回滚只能回到保留的 published revision，且写独立 rollback audit。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/foundation-module.ts:2199-2236`、`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/foundation-module.ts:2410-2457`。

### 4.2 半成品与目录假象

- 目录里“有 Provider/Channel/Model”不等于生产可执行。active Deployment 必须与进程启动时冻结的 runtime capability 在 model/channel/provider model/endpoint/credential revision 等字段上精确匹配，否则发布拒绝或强制 inactive。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/index.ts:1210-1239`、`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/index.ts:1312-1322`。
- `MODEL_DIRECT_*` 只能选择一个 LLM catalog model、一个 base URL、一个 provider model、一个 key 和一套成本；OpenAI/Anthropic/Gemini/custom 只是同一单槽位的协议模板。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/runtime-config.ts:613-660`。
- 媒体生产装配只识别 `ark`、`tuzi`、`volcengine_tts`；dispatch 还依赖 `model.id === seed-tts-2` 和 `executionChannelId.includes('tuzi')`。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/runtime-config.ts:563-581`、`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/adapters.ts:1964-2018`。
- 管理端“安全编辑”只能更改既有模型对应 Deployment 的 lifecycle、activation evidence 和 data class；完整新增 Provider/Channel/Deployment/Price 必须提交全量 catalog payload。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/foundation-module.ts:2135-2185`。

### 4.3 明确的 PoC / 死语义

- Gateway mode 被代码明确标记为 recorded PoC，activation 仍是 `recorded_only`；不是生产依赖。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/adapters.ts:2119-2186`。
- Bifrost/LiteLLM comparison 明确返回 `productTruthOwner: product_core`、`productionDependency: false`。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/adapters.ts:2206-2257`。
- fal/Replicate adapter 是 recorded media adapter；Gateway runtime 只装入 fal，Replicate 没进入运行时路由。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/adapters.ts:1579-1628`、`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/adapters.ts:2053-2064`。
- Nano Banana、Kling、Grok、Veo 等当前可在目录/fixture 中展示或录制合同，但没有对应 live runtime capability 时不能按生产供应商交付计算。

## 5. 官方凭据与 BYOK

### 5.1 官方平台凭据已交付的部分

- 平台凭据使用独立全局连接，只有 admin 可以保存、轮换、撤销、测试；不把 secret 放入 admin config。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/integrations/foundation-module.ts:285-389`、`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/admin-config/foundation-module.ts:515-540`。
- Secret Store 支持本地 AES-256-GCM 文件（AAD 绑定 workspace/credential/version/provider，0600 原子写）和 AWS Secrets Manager。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/integrations/secret-store.ts:83-213`、`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/integrations/secret-store.ts:219-235`。
- 轮换后的 vault credential 会覆盖环境变量中的 key/version，并清除旧 activation env evidence，要求重新探针。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/integrations/provider-credential-runtime.ts:30-106`。
- 连通性测试会保存 testedAt/status/errorCode 并写 integration audit。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/integrations/application-service.ts:600-665`。

### 5.2 官方凭据缺口

- Vault 运行时只定义 `modelDirect` 和 `arkMedia` 两个来源；Tuzi、Volcengine TTS 没有统一 slot。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/integrations/provider-credential-runtime.ts:4-13`、`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/integrations/provider-credential-runtime.ts:30-68`。
- 后台凭据 UI 也只展示 `model.direct`、`ark.media`、`douyin.platform`，没有任意 Provider Instance/credential schema。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/p1/admin-provider-credential-control.tsx:43-70`。
- 连通性 probe 对模型供应商统一执行 `GET {endpoint}/models`，只能证明基本鉴权/网络；真正的 operation 兼容性仍必须依靠 activation probe。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/integrations/provider-connectivity.ts:28-70`。
- 凭据变更和非 kill-switch 配置都要求进程重启后才进入实际 runtime；UI 已明确提示 restart effective。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/p1/admin-provider-credential-control.tsx:216-239`。

### 5.3 Workspace BYOK

已交付：

- BYOK connection 有 workspace/credential/version 绑定、secret store、轮换/撤销和 integration audit。
- Strict BYOK 强制 owner、受控 Endpoint Profile、模型 allowlist、单次固定 route、`fallbackConsent: false`，并继续消费产品文案额度；供应商费用标记为 workspace 外部结算。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/integrations/contracts.ts:150-260`、`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/integrations/application-service.ts:1197-1327`。
- Live adapter 关闭 SDK retry、设置超时，并区分 401/403。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/integrations/byok.ts:35-81`。

半成品：

- Live BYOK 仅支持 OpenAI-compatible `generateText`，provider model binding 仍来自 `BYOK_MODEL_BINDINGS` 环境变量；不支持 Anthropic/Gemini 原生协议、图片、视频或音频。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/integrations/runtime-from-env.ts:20-38`、`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/integrations/runtime-from-env.ts:129-152`。
- Core 只注册一个 OpenAI-compatible Endpoint Profile；endpoint 由平台 env 决定，不是工作区任意输入。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/main.ts:574-607`。
- BYOK 执行目前是模型设置页中的独立 prompt playground，不是普通创作、Harness、图片/视频工作流的可选 Credential Route。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/p1/entitlement-byok-panels.tsx:84-181`、`/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/p1/integration-settings.tsx:2059-2063`。

## 6. 路由、Fallback、熔断与限速

### 6.1 已交付的安全语义

- Candidate planner 共用 active/operation/fixed/custom/data-class/unavailable 硬过滤，并为每个候选计算目录价或 recorded estimate。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/index.ts:821-950`。
- 自动执行只取前两个候选；只有 `copy.generate` 与 `text.respond` 接受 auto。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/index.ts:2037-2073`。
- 只有“供应商接单前拒绝 + auto + fallback consent”才会安全重提；accepted、acceptance unknown 或 provider exception 都不会盲目重提。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/index.ts:2079-2135`、`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/index.ts:2213-2370`。
- 后台 Route Simulator 能展示硬过滤、候选排名、fallback 结果和最大估算成本。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/index.ts:1396-1520`。

### 6.2 关键缺口

- `RequestedSelection.profile` 声明了 `quality | balanced`，API 也接受两者，但 planner 完全不读取 profile，只按 `qualityRank` 降序。`balanced` 是死语义。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/index.ts:150-155`、`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/foundation-module.ts:3030-3041`、`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/index.ts:945-949`。
- 成本、最近延迟、错误率、限流状态、供应商余额、区域可用性都不参与排序；`retryable` 错误标记也没有进入主路由决策。
- 图片、视频和音频是 fixed durable execution，没有跨供应商自动 fallback；fixed 模式即使同一 CatalogModel 有多个 Deployment，也不会尝试第二个渠道。
- Simulator 比真实执行更窄：Simulator 禁止 `text.respond` auto，而执行主链允许。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/index.ts:1396-1405`、`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/index.ts:2042-2049`。
- `RecordedGatewayPocPort` 的 cooldown 是进程内 `Map`、固定 30 秒、随进程丢失，仅用于 recorded Bifrost/LiteLLM 对比，不能算生产熔断。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/index.ts:1114-1181`。
- 全局 kill switch 会每 5 秒读 DB head，但读库异常时 fail-open；这是止血阀，不是 Provider/Deployment 级熔断。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/admin-config/mode-gate.ts:28-58`、`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/admin-config/mode-gate.ts:74-157`。

## 7. 配额、成本与价格

### 7.1 已交付

- 产品计划按 copy/image/video/audio 管理 allowance，并已有并发与队列优先级配置。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/admin-config/foundation-module.ts:184-203`、`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/admin-config/foundation-module.ts:302-313`。
- 每个 provider attempt 会结算供应商成本，区分 estimated/observed、平台支付与 workspace BYOK；失败退款、外层合成失败补偿、迟到 Provider 终态也有处理。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/foundation-ledger.ts:246-357`。
- Postgres 已有 `p1_provider_cost_events`，记录 amount/currency/unit/evidence/payer/billing status。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/foundation/postgres-repository.ts:166-185`。

### 7.2 缺失

- 当前价格来源主要是代码中的 recorded 默认价或启动环境变量，没有 Provider Price Sync、合同有效期、阶梯价、币种汇率、折扣和价格漂移告警。默认价证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/catalog.ts:864-895`。
- Provider cost 读取接口只支持 `workspace + attemptId`，没有按时间、Provider、Channel、Model、Operation 聚合。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/foundation/postgres-repository.ts:756-782`。
- 没有供应商账户余额/配额同步、RPM/TPM/并发限制、日/月预算、Deployment cost cap、预算告警或预算触发的 route/circuit。
- 管理 UI 只能在 Route Simulator 和单次 Activation Probe 中看估算/观测成本，没有系统级成本趋势、单位产出成本、失败成本、BYOK/平台成本拆分与账单对账。

## 8. 激活、评测、发布与回滚

### 8.1 激活探针已交付

- 探针要求已配置 runtime Deployment 和 configuration revision；语言走真实 ModelSupply probe，媒体走真实 lifecycle。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/foundation-module.ts:1179-1260`。
- Run 会记录 actor、correlation、model/deployment/config revision、latency、结果摘要和 Provider cost；失败也保留 failure category/cost。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/foundation-module.ts:1261-1325`。
- 一个 Deployment 声明的所有 operation 都通过后才写 `live_verified`；配置漂移使证据失效。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/foundation-module.ts:1328-1377`、`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/runtime-config.ts:440-465`。
- 媒体探针覆盖 image generate/edit、video、speech、SFX，包含 submit/poll/download、非空和 MIME 校验；视频另有 cancellation canary。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/activation-probe-executor.ts:58-228`、`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/activation-probe-executor.ts:230-280`。
- Draft 中的 live evidence 必须能回查到当前配置、同 Deployment、全 operation 通过的 probe runs。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/foundation-module.ts:2057-2115`。

### 8.2 发布门禁仍不完整

- 质量评测只获取 `copy.generate` 目录并运行 beauty copy evaluation fixtures；没有图片、视频、音频 benchmark。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/foundation-module.ts:2476-2567`。
- Publish 只做 revision stage、runtime compatibility 和 CAS；不要求“目标 Deployment 最近 live probe 通过”“最近质量评测通过”“成本/错误率未越阈值”。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/catalog.ts:244-265`、`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/foundation-module.ts:2199-2222`。
- 没有 canary traffic percentage、按 Deployment 灰度、自动观察窗口、SLO 回归触发自动回滚。
- 新 Provider/Deployment 即使 probe 通过，也因 runtime capability 在启动时冻结而不能热发布；必须先让 HTTP/Worker 重新装配。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/index.ts:1218-1239`、`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/index.ts:1312-1322`。

## 9. 权限与审计

### 9.1 已交付

- Web admin route/API 要求 `role === admin`。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/middlewares/admin-middleware.ts:24-70`。
- Core 对探针、目录写操作、回滚、评测和 route simulation 等有 trusted admin guard。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/foundation-module.ts:2993-3012`、`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/foundation-module.ts:3550-3579`。
- Catalog revision 保存 actor/correlation/reason；rollback 有独立审计表；Admin Config history 保存 actor/reason/correlation；Integration credential/connectivity/BYOK 也写 audit。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/catalog.ts:284-323`、`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/postgres-repository.ts:854-905`、`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/admin-config/foundation-module.ts:705-725`。

### 9.2 缺口与待决策

- 权限是二元 admin，没有把“看成本/健康”“运行探针”“轮换密钥”“发布/回滚”拆成独立职责；高风险操作不支持双人审批。
- `quality_dashboard`、`quality_evaluations`、`prompt_revisions`、`catalog_revisions`、`revision_rollback_audits` 的 query 分支不在 `adminQueries` 集合内。它们仍受 workspace 隔离，但是否允许普通成员查看属于未明确的产品/安全决策。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/foundation-module.ts:3007-3012`、`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/foundation-module.ts:3887-3905`。
- 审计分散在 Catalog revision、rollback audit、Admin Config history、Integration audit 和 Provider cost events 中；后台没有按 Provider/Deployment/correlation 串起来的统一时间线。
- Admin Model UI 底部的“本次活动”只存在 React local state，页面刷新即丢；虽然 durable catalog revisions 可另行查询，但这张表容易被误认为持久审计。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/p1/admin-model-control.tsx:571-574`、`/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/p1/admin-model-control.tsx:2040-2076`。

## 10. 现有 UI 的真实完成度

### 10.1 已有页面

- `/admin/models` 集成运行模式、平台默认模型、Activation Probe、目录证据、Route Simulator、质量评测、revision lifecycle、发布/回滚。入口证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/routes/admin/models.tsx:14-34`。
- `/admin/integrations` 集成官方 Provider Credential 卡片。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/routes/admin/integrations.tsx:29-44`。
- `/settings/models` 有模型偏好和 Workspace BYOK。

### 10.2 管理体验缺口

- 完整 Catalog 编辑是一个最小高度 32rem 的原始 JSON textarea；没有 Provider → Channel → Credential → Deployment → Capability → Price 的结构化向导、字段级 diff 和引用完整性可视化。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/p1/admin-model-control.tsx:1884-1958`。
- Lifecycle 操作要求管理员手工复制 Revision ID；enable 没有 impact/reason dialog，publish/retire 才有。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/p1/admin-model-control.tsx:973-1028`、`/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/p1/admin-model-control.tsx:1962-2027`。
- Admin Model 主视图只查询 copy.generate、image.generate、image.edit、video.generate；缺少 copy.adapt、text.respond、audio.speech、audio.sfx 的目录与路由视图。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/p1/admin-model-control.tsx:250-258`。
- 用户模型偏好页只有 LLM/图片/视频三个 section，没有音频；用户选择的是 CatalogModel，不是 Provider/Deployment/Channel。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/p1/model-settings.tsx:82-112`。
- 当前模型选择放在 browser `sessionStorage`，只接受 fixed；会主动删除历史 auto selection。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/p1/model-current-selection.ts:11-19`、`/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/p1/model-current-selection.ts:58-80`。
- Core runtime parser 已支持 `volcengine_tts` 及组合模式，但 Admin Config schema、前端 schema 和选项只允许 disabled/ark/tuzi/ark,tuzi，导致真实 TTS 无法从后台开启。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/runtime-config.ts:563-581`、`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/admin-config/foundation-module.ts:296-301`、`/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/p1/admin-config-view-model.ts:26-40`、`/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/src/p1/admin-runtime-config-control.tsx:208-232`。

## 11. 测试现状与盲区

### 11.1 已有覆盖值得保留

- Core 已有较丰富的 unit/integration 覆盖：目录状态机、runtime assembly、配置漂移、探针、Ark/Tuzi/TTS adapter、Durable Media、RouteSnapshot/fallback、Foundation ledger/recovery、Postgres CAS、质量评测和视频组合。
- 前端有 Admin Model、Activation Probe、Runtime Config、Provider Credential、Model Selection 和 BYOK schema 的组件/视图测试。
- Playwright 覆盖 admin route 权限、响应式/桌面可达性、发布 impact dialog、Activation Probe evidence surface，以及 recorded Strict BYOK journey。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/tests/e2e/specs/uiux-mobile-secondary.spec.ts:209-303`、`/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/tests/e2e/specs/p1-integrations-journey.spec.ts:17-38`。

### 11.2 当前不能证明的事情

- Live LLM test 只验证当前单一 fixed direct provider，不验证两家真实 Provider 的 failover、限流与熔断；且只有显式 `RUN_LIVE_MODEL_PROVIDER_TEST=1` 才运行。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/live-llm-provider.integration.test.ts:9-37`。
- Ark live test 只验证 Seedance 视频；Tuzi live test验证 image.generate + video.generate，不覆盖 image.edit；Volcengine live 只验证 audio.speech。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/live-ark-media.integration.test.ts:11-44`、`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/live-tuzi-media.integration.test.ts:91-110`、`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/live-volcengine-tts.integration.test.ts:8-28`。
- Bifrost、LiteLLM、fal、Replicate、Kling、Grok、Veo、Nano Banana 没有生产 live adapter + live test 闭环。
- Postgres repository/ledger tests在缺少 `TEST_DATABASE_URL` 时 skip。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/postgres-repository.test.ts:30-34`、`/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/foundation-ledger.postgres.test.ts:23-29`。
- Admin Activation E2E 只断言按钮/证据列可见，没有实际运行 probe；断言列表也不含 audio。证据：`/Users/bin/Desktop/开发/内容无人区/美业内容2/mkfast-template-main/tests/e2e/specs/uiux-mobile-secondary.spec.ts:265-299`。
- 没有以下关键验收：真实多 LLM Provider failover；媒体跨 Provider fallback；分布式 circuit/rate/budget；Provider credential 热轮换后的 HTTP+Worker 一致性；probe 后无重启热激活；质量门禁阻止发布；灰度失败自动回滚；系统级 catalog 与 workspace overlay 隔离；Tuzi/TTS 凭据后台闭环。

## 12. 最小开发缺口与建议顺序

### P0：先形成“平台级可管理、可执行”的供应商控制面

1. **统一作用域**：建立全局 Provider Supply Catalog；工作区只保存默认/偏好/BYOK/政策 overlay。迁移现有 workspace catalog 时保留兼容读路径。
2. **动态实体，而不是固定 env 槽位**：新增可持久化的 `ProviderInstance`、`CredentialRef`、`ModelDeployment`、`Capability`、`PriceRevision`；Provider adapter 类型可枚举，实例可增删停用。
3. **统一官方凭据**：让 Direct、Ark、Tuzi、Volcengine TTS 都走同一 Vault/rotate/revoke/test/version contract；secret 永不进入 catalog/admin config。
4. **HTTP/Worker 一致装配**：配置发布后通过 versioned runtime registry/refresh event 热装配，HTTP 与 worker 报告相同 effective revision；不再要求重启才能使 Provider 生效。
5. **补齐后台表达能力**：用结构化 Provider 工作台替换“全量 JSON 为主”的路径；JSON 仅作为高级导入/导出与灾备入口。

原始审计识别的最小技术验收是：后台新增第二个真实 LLM Provider → 保存/测试凭据 → 为模型建立 Deployment → 跑全 operation activation probe → 发布 → HTTP 与 worker 无重启看到同一 revision → 正常请求可命中两个不同 Provider。D-068/D-069 已将正式首轮验收扩大为文本、图片、视频三模态闭环与三项核心 operation 各双渠道；不能再以这条 LLM-only 样本声明首轮完成。

### P1：把路由从“有候选”升级为“可运营”

1. 实现真实 `quality` / `balanced` / 可选 `lowest_cost` 策略；排序输入至少包括质量、观测成本、p95 latency、错误率、circuit、provider quota headroom、数据区域。
2. 新增持久化 Deployment health/circuit，支持 open/half-open/closed、错误分类窗口、手工隔离和自动恢复；Core 继续掌握 fallback safety。
3. 接入 Provider RPM/TPM/并发与账户配额，加入日/月预算、Provider/Model cost cap 和告警；预算越界可禁止新提交或降级路由。
4. 将安全 fallback 扩展到有真实 lifecycle/recovery 语义的图片、视频、音频；任何 accepted/unknown 仍禁止盲目重提。
5. 建立 provider cost 聚合 API 和后台看板：调用量、成功率、失败成本、单位交付成本、估算/实付差、平台/BYOK、Provider/Model/Operation 维度。

### P2：发布治理、评测与审计闭环

1. 为图片/视频/语音建立版本化 benchmark；评测证据绑定 provider model、deployment、credential/config revision。
2. 发布策略要求当前 probe + benchmark + price + policy 全部有效；支持小流量 canary、观察窗、SLO 阈值与自动回滚。
3. 拆分 RBAC：Supply Viewer、Operator、Credential Admin、Release Manager；密钥轮换、生产发布和回滚至少可配置审批。
4. 用 correlationId 串联 Config、Credential、Probe、Catalog Revision、Route、Job、Provider Cost、Rollback，形成统一 Provider 时间线。

## 13. 明确不建议本轮重做的部分

- 不重写 `CatalogModel` / `ModelDeployment` / `RouteSnapshot` 的核心证据结构。
- 不把产品目录、工作区政策、产品额度或最终 provider cost ledger 迁入模型网关。
- 不降低 `accepted / acceptance_unknown` 禁止盲目 fallback 的安全边界。
- 不用“目录里已记录”替代生产 adapter、真实激活证据和 live test。
- 不先做大而全的供应商页面，再继续依赖固定 env 单槽位；P0 必须同时打通动态运行时装配。

## 14. 推荐作为下一轮决策记录的五个 ADR

1. Provider Supply 的全局目录与 workspace overlay 边界。
2. Core 与模型网关的真相所有权及失败语义边界。
3. Provider/Credential/Deployment 的动态注册与热装配协议。
4. Health、Circuit、Rate、Budget 与 route policy 的状态模型。
5. Probe、Benchmark、Canary、Publish、Rollback 的强制门禁与 RBAC。
