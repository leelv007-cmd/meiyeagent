# 多模型供应商管理：官方合同面研究

> 研究日期：2026-07-19（Asia/Shanghai）
>
> 研究目标：为“多渠道模型供应商管理”后台定义可实现的供应商合同与数据边界，不做供应商选型或优劣推荐。
>
> 证据范围：OpenAI、Anthropic、Google Gemini Developer API / Vertex AI、火山引擎方舟（豆包）、阿里云百炼（DashScope），并补充当前仓库目录中已出现的 Kling、fal、Replicate、xAI、火山 TTS 与 Tuzi 中转渠道。
>
> 检索方法：优先用 OpenCLI Google 适配器定位官方页面，并用 `opencli web read` 读取正文；只采用供应商官方文档、官方帮助中心、官方条款或官方 API 页面。OpenAI 一条已迁移的 Usage/Costs 页面先由 Web Search 定位新地址，随后仍由 OpenCLI 读取官方正文；其他证据未使用 Web Search。
>
> 时效说明：限额、模型、价格、地域、保留期和退役状态都可能变化；本文记录的是研究日可见合同，不应被编译成永久常量。

## 1. 结论先行

本系统会同时使用两类采购来源：一部分直接采购模型厂商官方 API，另一部分采购第三方上游供应商 API。第三方供应商后台可能运行 New API/Sub2API，但它们是上游的内部实现；我方不自建、不运维，也不应依赖其管理数据库或管理员接口。

因此“供应商管理”不能实现成一个统一 API Key 表格，也不能把 OpenAI-compatible 当作完整供应商合同。五家核心供应商在以下方面没有共同控制面：

- 模型目录可能是完整 API、基础 ID 列表、控制面版本列表，或仅有文档/控制台目录。
- 推理凭据与组织管理凭据通常不是同一把 Key；部分管理面只接受高权限 Admin Key 或云厂商 AK/SK。
- 限流可能按组织、项目、Workspace、主账号、模型、Endpoint、地域或资源包聚合，不等于“每把 API Key 的额度”。
- 请求响应里的 token/usage 是运行观测，不是账单、余额或合同价格真相。
- 异步任务有轮询、Webhook、EventBridge 等不同合同；回调的签名、重试和结果保存期也完全不同。
- 数据驻留、零数据保留、训练用途、滥用日志及安全策略通常包含资格、地域、功能和合同例外，不能抽象成一个布尔开关。
- 模型退役信息多数不在 Models API 中，需要独立的生命周期采集与人工确认流程。

因此后台应维护内部 **Provider Contract Registry**，每条字段都带来源与新鲜度；执行适配器只消费已经发布的、可追溯的合同快照。

## 2. 核心供应商能力边界总表

| 供应商 | 模型/能力发现 | 账户、地域与凭据 | 限额 | Usage / Billing | 异步任务 | 生命周期与数据边界 |
|---|---|---|---|---|---|---|
| OpenAI | `/v1/models` 只有基础身份；能力、价格、退役需目录/文档补充 | Organization → Project；推理 Key/Service Account/WIF 与 Admin Key 分离；地域资格受合同约束 | 可读项目/模型限额及响应头；429 仍需区分瞬时限流与预算/余额 | Admin Usage 与 Costs 可查，但余额、发票、付款、合同价格仍在 Dashboard/合同 | Batch、Background 可轮询；Webhook 在 Dashboard 配置 | 模型退役另采集；默认滥用日志、ZDR/MAM、区域处理均有功能/资格边界 |
| Anthropic | Models API 提供较结构化 capabilities，但不含完整价格/退役 | Organization → Workspace；数据 Key/WIF 与 Admin Key/OAuth 分离；Workspace 存储地域与请求推理地域不同 | 组织限额 + Workspace 覆盖；响应头；402/429/529 语义不同 | Usage/Cost API 非个人账户通用，也不是余额/发票/合同价格真相 | Message Batch 官方合同为轮询，无完成 Webhook | 退役另采集；ZDR 不覆盖 Batch、Files 等全部功能 |
| Gemini Developer API | `models.list/get` 可读版本、token 上限、支持方法 | Key 绑定 Google Cloud Project；标准 Key 与 service-account-bound Auth Key 需区分 | RPM/TPM/RPD 等按 Project 而非 Key；精确当前值主要看 AI Studio/方案 | 请求 usage 与 Cloud Billing 是两套事实；账单走 Google Cloud Billing | Batch 可 create/get/list/cancel/delete，支持轮询及 Batch Webhook | 安全阈值按请求但核心危害不可关闭；滥用保留/ZDR 有功能例外 |
| Vertex AI | 模型目录、Model Garden、Publisher Model 与项目/地域可用性需组合验证 | Google Cloud Project + location；通常 OAuth/Service Account；全局、区域、多区域合同不同 | Dynamic Shared Quota、项目/地域/模型配额、Provisioned Throughput 需分开 | Cloud Monitoring 是运行观测；实际成本以 Cloud Billing detailed export/合同为准 | Gemini Batch 以云任务轮询为基本合同 | `modelVersion` 可回传；alias 会更新；数据位置只在受支持服务与配置范围内成立 |
| 火山方舟/豆包 | 控制面可列 Foundation Model、Version、激活状态；执行仍依赖 Endpoint | 数据面 API Key/AK 与控制面 AK/SK 分离；当前主要为北京域名与中国大陆合同 | RPM/TPM/QPS/Endpoint 等多维；429 细分错误码 | 推理用量 API/UI 与费用中心账单分离 | 图片/视频任务以轮询为主；视频任务仅近 7 天可查，输出 URL 24 小时 | Version 有 `Retiring`；合同含合规过滤、排障和可选日志例外 |
| 阿里百炼/DashScope | 通用完整模型目录 API 未确认；官方模型页/控制台是主要目录，且按地域变化 | Region + 业务空间；专属 Endpoint；Key 全值只在创建时可见，重置立即失效 | 按主账号聚合 RAM、Workspace 和所有 Key，按模型独立 | 模型观测、调用日志与费用中心账单分离 | 异步任务可轮询；EventBridge 提供成功/失败通知 | 退役公告有通知窗口但未发现 API；地域决定 Endpoint、Key、模型列表和数据位置 |

这张表中的“可查”不代表当前产品已经持有对应高权限凭据，也不代表应默认申请这些权限。

## 3. 官方直采与第三方上游并存时的边界

### 3.1 两类采购来源不能伪装成同一种连接

| 来源类型 | 我方实际持有 | 权威合同 | 可自动化范围 |
|---|---|---|---|
| `official_direct` | 厂商官方 Project/Workspace/云账号、官方数据面 Key，必要时另有管理面凭据 | 本文各厂商官方 API、控制台、账单与双方合同 | 按官方能力接模型发现、限额、Usage/Cost、Key 元数据、异步任务和生命周期；缺失项仍人工 |
| `upstream_reseller` | 上游发放的 Base URL、渠道 Token、可选供应商管理 API/余额查询 API | 与上游签署的模型清单、价格、额度、SLA、数据处理、退款及对账合同 | 只调用上游公开给我方的接口；不能假设可访问其 New API/Sub2API 管理面，也不能继承官方厂商的账户权限与数据承诺 |

`upstream_reseller` 即使使用 OpenAI-compatible 请求格式，也不能标记为 `official_openai`。建议至少保存：

- `sourceKind`：`official_direct` 或 `upstream_reseller`。
- `legalSupplier`：合同、开票和收款主体；与底层模型厂商分开。
- `declaredUpstreamProvider`：上游声明的底层厂商，允许 `unknown` 或多厂商池。
- `gatewayProduct`：上游声明为 New API/Sub2API/自研时只作参考元数据，不形成我方运维对象。
- `supplierBaseUrl`、Token Vault 引用、套餐/账号 ID、币种、余额单位、结算周期、联系人与 SLA。
- 上游模型别名到内部 canonical model/capability 的映射、验证探针和最后验证时间。
- 数据经由地点、日志/保留、子处理者、内容政策、故障转移范围与合同证据。

官方 API 合同在这里扮演**基准**：用于判断上游声称的模型、错误、计量和政策语义是否完整，而不是把官方合同自动套给上游。例如，上游返回 `gpt-*` 名称并不证明请求直达 OpenAI，也不证明享有 OpenAI Direct API 的 ZDR、Project 限额、退役通知或账单明细。

### 3.2 采购合同必须覆盖的最小字段

每个直采账号或上游账号都应有版本化 `SupplyContract`：

| 合同维度 | 必须记录的事实 |
|---|---|
| 商品 | 可售模型/版本/模态/操作、地区、是否官方直连或多级中转、别名映射 |
| 价格 | 计费单位、输入/输出/缓存/图片/视频/音频单价、币种、税、汇率规则、阶梯/折扣、价格生效时间 |
| 资金 | 预付/后付、余额定义、充值与退款、最低余额、授信、账期、欠费后的请求语义 |
| 容量 | RPM/TPM/QPS/并发、共享或专享、作用域、峰值限制、保障容量、扩容流程 |
| 服务 | SLA、维护通知、故障响应、赔付、结果保存期、Webhook/轮询合同 |
| 数据 | 处理路径、地域、子处理者、训练用途、日志与保留、内容安全责任、数据泄露通知 |
| 变更 | 模型上下线、价格变更、Endpoint/Token 迁移、最短通知期与替代方案 |
| 对账 | request/task ID、用量明细 API/导出、余额流水、账单/发票、时区、延迟、争议期 |

上游未提供某项时保持 `unknown` 并进入采购风险清单，不能以底层官方厂商公开文档代填。

### 3.3 用户/工作区分配边界

我方平台分配给用户的不是供应商 Key，而是内部 `RouteEntitlement`：

- 作用域为 Workspace/商家、套餐和功能；包含允许的内部模型能力、预算、用量、并发、优先级、有效期与允许的 fallback。
- 官方 Key 或上游 Token 只存在于平台 Vault，不下发给终端用户，也不在用户日志、Webhook 或错误体中泄露。
- 多个 Workspace 可共享一个供应来源，但供应商的组织级/主账号级限额由平台统一调度；不能把共享供应商余额简单平均成每个用户“真实余额”。
- 需要专属账号/Key/地域的客户建立 Dedicated Pool，并把该隔离事实写入 RouteSnapshot；不通过动态提示词或请求 Header 临时实现。
- 用户看到的是平台套餐额度和任务状态；供应商采购价、余额、上游主体和凭据只在平台内部管理后台按权限展示。
- 内容安全是叠加关系：平台政策、上游政策、底层模型厂商政策任一层拒绝都可能终止任务，不能通过自动换渠道绕过明确安全拦截。

### 3.4 三层对账链

每次调用必须形成可追溯链：

`Workspace usage → RouteSnapshot → SourceConnection → Supplier request/task ID → Supplier statement`

对账至少分三本账：

1. **用户账**：按我方套餐与计费规则扣减，是用户可见真相。
2. **供应成本账**：按调用时固定的供应合同价格版本估算，支持直采厂商和第三方上游。
3. **供应商结算账**：上游余额流水/明细、官方 Costs/Cloud Billing/费用中心账单与发票，是采购侧最终核对来源。

三者金额可能不同，必须记录币种、价格版本、时区、供应商数据 `asOf`、对账状态、差异原因和人工调整审计。上游只有余额变化而没有 request 明细时，不能把差额强行分摊给某个 Workspace；应标记为不可归因差异并推动供应合同补齐。

## 4. 后台必须建立的统一对象

### 4.1 `ProviderConnection`

| 字段 | 含义与约束 |
|---|---|
| `provider` / `channel` | 供应商与渠道分开；例如 `google/vertex`、`google/gemini-developer`、`volcengine/ark`、`volcengine/tts` |
| `sourceKind` | `official_direct` 或 `upstream_reseller`；同模型不同采购来源必须是不同连接 |
| `legalSupplier` | 实际合同、结算与开票主体；第三方上游不得伪装成底层模型厂商 |
| `accountScope` | Organization、Project、Workspace、主账号、云项目等真实作用域；禁止都叫 `tenant` 后丢失供应商语义 |
| `region` / `deploymentScope` | API 地域、存储地域、推理地域、服务部署范围分别保存，不能只留一个 `region` |
| `apiBase` | 精确域名与协议；同一供应商的控制面、数据面、WebSocket、业务空间 Endpoint 可能不同 |
| `authMode` | `api_key`、`admin_key`、`service_account`、`ak_sk`、`wif`、`oauth` 等；推理权限与管理权限单独连接 |
| `secretRef` / `secretVersion` | 只保存 Vault 引用、版本、指纹/后四位、创建/轮换时间，不保存或回显明文 |
| `status` | `unverified`、`verified`、`degraded`、`revoked`、`expired`；验证必须记录探针与时间 |
| `provenance` | `provider_api`、`response_header`、`docs_snapshot`、`console_manual`、`contract` |

任何供应商在只提供数据面 Key 时都不应显示“账单已接通”“限额已同步”或“生命周期已托管”。这些是独立能力。

### 4.2 `ProviderModelSnapshot`

至少保存：供应商 model ID、不可变版本/快照、alias、展示名、输入/输出模态、支持操作、上下文/输出上限、地域与 Endpoint 可用性、安全特性、价格版本、生命周期状态、退役日、替代模型、发现来源、发现时间、验证状态。

关键规则：

1. `models.list` 返回什么就存什么，不用猜测补全缺失能力。
2. 文档解析、控制台人工录入与真实调用探针必须是不同来源。
3. `latest`、无日期别名和 Publisher alias 只能作为输入选择；发布的运行快照要记录实际返回的版本（供应商提供时）或探针时间。
4. 模型“存在”“账户有权使用”“地域可用”“Endpoint 已部署”“当前未退役”是五个不同状态。

### 4.3 `ProviderQuotaSnapshot`

统一字段建议：`scopeType`、`scopeId`、`modelId`、`endpointId`、`limitKind`（RPM/TPM/RPD/IPM/QPS/concurrency/batch-token/spend）、`amount`、`remaining`、`resetAt`、`source`、`observedAt`。

- API 不可读的精确限额保持 `unknown`，允许控制台人工快照，不用默认数字代替。
- 运行时响应头和管理 API 快照并存；前者更实时，后者更完整。
- 硬消费额度、瞬时速率、共享容量拥塞、购买的专属容量必须分类，不能都映射为 `rate_limited`。

### 4.4 `ProviderUsageObservation` 与 `ProviderBillingRecord`

需要三层事实：

1. **请求观测**：输入/输出 token、图像/视频数量或时长、供应商 request ID、内部估算成本。
2. **供应商 Usage/Cost API**：有延迟、聚合维度和覆盖范围限制，用于运营核对。
3. **账单/发票/合同**：最终财务真相，可能含折扣、预留容量、税费、补偿和人工调整。

产品不能把第一层估算叫“供应商账单”，也不能因 Usage API 缺失就阻塞运行；必须有对账状态与差异字段。

### 4.5 `ProviderJob`

至少保存供应商任务 ID、内部请求 ID/幂等键、提交时间、当前原始/规范化状态、最后轮询时间、回调事件 ID、重试次数、供应商 request ID、结果 URL 与到期时间、结果持久化状态、计费状态。

统一状态可采用：

`accepted → queued → running → succeeded | failed | cancelled | expired | unknown`

但必须同时保存供应商原始状态。网络超时发生在提交阶段时，不能盲目重试，因为供应商可能已经接受任务；应先用幂等键、外部 task ID 或查询接口确认。

Webhook 只应作为状态变化提示：验证签名（供应商提供时）、去重、允许乱序、单调推进状态，并保留轮询兜底。结果 URL 必须在供应商保留期内复制到自有对象存储。

### 4.6 `ProviderPolicyProfile` 与 `ProviderLifecycleNotice`

`ProviderPolicyProfile` 应分别记录：可调安全阈值、不可关闭限制、默认数据用途、滥用监控保留、ZDR/MAM 资格、存储/推理地域、功能例外、合同附件版本。不要用一个 `zeroRetention: true` 表达全部内容。

`ProviderLifecycleNotice` 应记录：模型/版本/alias、公告日、停止新开通日、退役日、替代模型、来源 URL、最后确认时间、受影响路由。没有生命周期 API 的供应商必须支持人工录入和双人确认。

## 5. OpenAI 官方合同

### 5.1 模型、Project 与凭据

- [`GET /v1/models`](https://developers.openai.com/api/reference/resources/models/methods/list)只返回基础模型身份信息，不含完整上下文、工具、多模态、价格和退役信息；能力需从[模型目录](https://developers.openai.com/api/docs/models)和模型详情补充。
- 项目允许使用的模型可由 Admin API 的 [`model_permissions`](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/projects/subresources/model_permissions/methods/retrieve)读取，但“有权限”仍不等于运行探针成功。
- 真实隔离层级是 Organization → Project。普通 Project API Key、Service Account/WIF 用于数据面；[Admin API Key](https://developers.openai.com/api/reference/administration/overview)用于组织管理且不能调用普通推理。
- Service Account Secret 仅应在[创建响应](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/projects/subresources/service_accounts/subresources/api_keys/methods/create)中接收一次并立即写入 Vault；普通 Key 管理接口不会重新返回完整值。
- Project 的 `geography` 仅在组织已取得相应数据驻留资格时有效，不能只凭字段存在承诺地域。[Project 创建接口](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/projects/methods/create)

实现约束：至少建两个连接角色 `runtime` 与 `organization_admin`，高权限 Admin Key 不进入推理 Worker；Project Geography 与 API Base URL 都属于已验证配置。

### 5.2 限流、错误、Usage 与账单

- [限流](https://developers.openai.com/api/docs/guides/rate-limits)包括 RPM、TPM、RPD、TPD、图片/音频等维度，并按组织、Project、模型族和使用等级生效；响应头可提供 limit、remaining、reset。
- Admin API 可[列出 Project 下的模型级限额](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/projects/subresources/rate_limits/methods/list_rate_limits)。同为 429，可能是瞬时速率限制，也可能是额度/月度预算耗尽；503 也可能是服务过载或流量突然加速。
- 应保存 `x-request-id` 与规范化错误体。[错误文档](https://platform.openai.com/docs/guides/error-codes/api-errors)没有覆盖全部场景的长期稳定机器错误码表，因此不能依赖错误消息字符串。
- Organization [Usage API](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/completions)可按 Project、Key、模型、Batch、Service Tier 等分组，[Costs API](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/costs)按日返回成本；二者不等于余额、发票或合同价格。
- 预付余额、自动充值与付款方式仍属于 [Dashboard](https://help.openai.com/en/articles/8264778-what-is-prepaid-billing)；详细导出也有 [Dashboard 边界](https://help.openai.com/en/articles/20001072-how-do-i-export-monthly-usage-details-from-the-api-usage-dashboard)。

实现约束：把 429 至少分成 `transient_rate_limit` 与 `billing_or_budget_exhausted`；只对明确可重试类别指数退避。Costs/Usage 同步使用 Admin 连接，发票状态保持外部/人工对账。

### 5.3 异步、内容策略、生命周期与数据

- [Batch](https://developers.openai.com/api/docs/guides/batch)使用独立限流池，最长窗口为 24 小时，结果顺序不保证，必须按 `custom_id` 关联。
- [Background Responses](https://developers.openai.com/api/docs/guides/background)支持轮询、取消和恢复流式读取。
- [Webhooks](https://developers.openai.com/api/docs/guides/webhooks)覆盖 Batch、后台 Response、Fine-tuning 等事件，但订阅 Endpoint 在 Dashboard 配置；签名 Secret 仅显示一次，投递可能重复并持续重试，必须按 `webhook-id` 幂等。
- API 数据[默认不用于训练](https://developers.openai.com/api/docs/guides/your-data)，除非客户明确加入；默认滥用监控可能保留 Prompt/Response，通常最长 30 天。ZDR、Modified Abuse Monitoring、非美国数据驻留与保留期修订均有资格或合同边界，Batch、Files、Background 等功能兼容性也不同。
- [退役页](https://developers.openai.com/api/docs/deprecations)是独立生命周期来源；Models API 不返回完整退役字段。固定行为应使用快照并持续 eval，API 版本稳定不代表模型行为永久不变。
- [Usage Policies](https://openai.com/policies/usage-policies/)与[内容审核能力](https://developers.openai.com/api/docs/guides/moderation)是独立于模型能力目录的策略来源。内容拒绝、政策拦截与请求参数错误要分开；政策拦截不进入自动跨供应商“逃逸式重试”。

已确认未知：完整模型能力和价格没有单一机器接口；完整稳定错误码表未找到；ZDR/地域资格、Enterprise 价格、Scale Tier、专属容量、DPA/BAA 与初始 Webhook 配置属于合同或 Dashboard。

## 6. Anthropic 官方合同

### 6.1 模型、Workspace 与凭据

- [`GET /v1/models`](https://platform.claude.com/docs/en/api/models/list)可返回上下文/输出上限及 Batch、引用、代码执行、图片、PDF、Thinking、Effort 等结构化能力；[`retrieve`](https://platform.claude.com/docs/en/api/models/retrieve)可解析模型或别名。
- [模型 ID 与版本规则](https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions)表明无日期 ID 不一定是自动升级 alias，不能按名称外观猜版本语义。
- 真实隔离层级是 Organization → Workspace。数据面使用 `x-api-key` 或 WIF Bearer Token，并要求 `anthropic-version`；管理面使用 Admin Key 或 `org:admin` OAuth。[Admin API](https://platform.claude.com/docs/en/manage-claude/admin-api)
- Admin Key 在 Console 创建且 Secret [只显示一次](https://platform.claude.com/docs/en/manage-claude/admin-api-keys)。API Key 管理接口可 List/Get/Update，但没有静态 Key 创建接口，创建仍属 Console 操作。[API Keys](https://platform.claude.com/docs/en/api/admin/api_keys)
- Workspace 创建时可设置存储地域，且部分地域/CMEK 标识写入后不可变。[创建 Workspace](https://platform.claude.com/docs/en/api/admin/workspaces/create)

实现约束：Workspace 是连接的最小组织作用域；`storage_region` 与请求级 `inference_geo` 分开；不可变字段变更必须走“新 Workspace 迁移”，而不是 UI 原地编辑。

### 6.2 限流、错误、Usage 与账单

- [限流](https://docs.anthropic.com/en/api/rate-limits)同时包括消费额度、RPM、Input TPM、Output TPM；组织限额可被 Workspace 进一步降低。
- [`/v1/organizations/rate_limits`](https://platform.claude.com/docs/en/manage-claude/rate-limits-api)可读取组织模型组限额；Workspace 仅返回覆盖值，缺失表示继承组织值。该 API 只读，修改仍在 Console。
- 响应头提供请求/输入 token/输出 token 的 limit、remaining、reset 与 `retry-after`。[错误类型](https://docs.anthropic.com/en/api/errors)区分 402 Billing、429 Rate Limit、529 Overloaded；SSE 还可能在 HTTP 200 后产生错误事件。
- [Usage and Cost API](https://platform.claude.com/docs/en/manage-claude/usage-cost-api)需要组织管理权限，可按 Key、Workspace、模型、Service Tier、上下文、推理地域等分组；个人账户和部分云平台形态不可用。
- Priority Tier 等合同费用不一定完整进入 Cost API；余额、自动充值、付款和[发票](https://support.claude.com/en/articles/10366473-where-can-i-find-full-receipts-and-invoices-for-my-claude-api-and-console-payments)仍属于 Console/合同。

实现约束：流式适配器必须处理 SSE 内错误；Workspace 限额 UI 必须展示“继承”而不是写入虚假数值；402 不重试，529 与 429 使用不同熔断/退避统计。

### 6.3 Batch、内容策略、生命周期与数据

- [Message Batch](https://platform.claude.com/docs/en/build-with-claude/batch-processing)支持最多 100,000 请求或 256 MB、最长运行 24 小时、结果最多保存 29 天，以 JSONL 和 `custom_id` 关联。
- 当前官方 Batch 合同只有查询、取消和结果下载，未提供完成 Webhook；后台必须轮询，不能假设 Anthropic 所有产品都没有 Webhook。
- 商业 API 数据[默认不用于训练](https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training)，但主动反馈或明确加入除外；标准商业数据通常按[保留政策](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data)删除，安全标记、法律要求及长存储功能存在例外。
- [ZDR](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention)是组织合同能力，不覆盖 Batch、Files、Code Execution、Managed Agents 等全部功能。
- [数据驻留](https://platform.claude.com/docs/en/manage-claude/data-residency)区分 Workspace 存储地域和请求级推理地域，支持范围受模型版本影响，价格也可能不同。
- [模型退役](https://platform.claude.com/docs/en/about-claude/model-deprecations)通常另行通知；Bedrock、Vertex 等合作云渠道有各自合同和时间表。Beta Header 也可能改变价格、限流、地域与结构，必须作为实验能力单独发布。[Beta Header](https://platform.claude.com/docs/en/api/beta-headers)
- [Acceptable Use Policy](https://www.anthropic.com/legal/aup)是独立版本化政策来源；供应商拒绝/安全终止需要保留原始语义，不能当作 5xx 或通过 fallback 自动绕过。

已确认未知：Models API 不含完整价格/退役/合同资格；Message Batch 没有官方完成回调；ZDR、HIPAA/BAA、CMEK、Priority Tier、SLA 与自定义限额属于合同/Console 真相。

## 7. Google Gemini Developer API 与 Vertex AI 官方合同

两条渠道虽然都提供 Gemini 模型，但账户、鉴权、地域、配额、账单和数据合同不同，后台不能合并成一个 `google` 连接。

### 7.1 Gemini Developer API

- [Models API](https://ai.google.dev/api/models)支持 `models.list/get`、分页，并返回 `name`、`baseModelId`、`version`、输入/输出 token 上限和 `supportedGenerationMethods`，可作为自动发现源。
- [API Key](https://ai.google.dev/gemini-api/docs/api-key)绑定 Google Cloud Project；限额[按 Project 而非 Key](https://ai.google.dev/gemini-api/docs/rate-limits)聚合。标准 Key 与绑定 Service Account 的 Auth Key 要分开记录。文档还包含 2026 年标准 Key 迁移节点，属于必须持续采集的时效通知，不应硬编码为永久规则。
- 限流包含 RPM、TPM、RPD，部分模型还有 IPM/TPD 等维度；RPD 按太平洋时间午夜重置。Preview 限制更严，精确当前配额和 tier 主要在 AI Studio/方案页确认；429 `RESOURCE_EXHAUSTED` 还可能表示项目消费层级限制，不能只按单 Key 退避。
- [Batch API](https://ai.google.dev/gemini-api/docs/batch-api)支持 create/get/list/cancel/delete；状态包括 PENDING、RUNNING、SUCCEEDED、FAILED、CANCELLED、EXPIRED，待处理/运行超过 48 小时会过期；官方已提供 Batch 成功/失败 Webhook 事件。
- [安全设置](https://ai.google.dev/gemini-api/docs/safety-settings)允许逐请求调节部分危害类别阈值，但核心危害不可关闭；Prompt 的 `blockReason` 与 Candidate 的 `finishReason=SAFETY` 都必须保留，拦截内容不会返回。
- 官方[滥用监控政策](https://ai.google.dev/gemini-api/docs/usage-policies)包含保留 Prompt、上下文和响应用于安全监控的期限；[ZDR 文档](https://ai.google.dev/gemini-api/docs/zdr)进一步说明 File API、显式缓存和隐式缓存的不同保留合同。不能因“付费”自动标记 ZDR。
- 运行 usage 与 Cloud Billing 是不同层级；余额、发票和实际费用需接 Google Cloud Billing/Console，不从生成响应反推。

实现约束：`project_id` 是限额主作用域；Key 只是授权工具。安全阈值作为 Policy Profile 版本化；文件、缓存、Batch 等功能在启用前检查数据保留兼容矩阵。

### 7.2 Vertex AI

- 请求合同包含 Google Cloud Project 和 `location`；[Location](https://cloud.google.com/vertex-ai/generative-ai/docs/learn/locations)可为区域、多区域或 global。global 有可用性优势，但不能据此承诺单一区域处理或驻留。
- Vertex 的模型发现需要 Publisher Model/Model Garden 官方目录、项目/地域可用性、allowlist/激活状态和真实调用探针组合；未确认一个可覆盖所有 Publisher、地区及权限状态的完整通用目录接口。
- [推理响应](https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference)可返回 `modelVersion`；不带版本的模型名可能是自动更新 alias。发布快照应记录返回版本，并为显式版本与 alias 分开建生命周期记录。
- [API 错误](https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/api-errors)中的 429 `RESOURCE_EXHAUSTED` 既可能是配额，也可能是共享容量拥塞或其他项目限制；500/503/504 的重试边界也不同。官方退避建议不能替代内部幂等与提交状态确认。
- Vertex 还存在 Dynamic Shared Quota、项目/地域/模型配额和 Provisioned Throughput 等不同容量合同，不能把所有 429 映射成“提高 RPM”。
- [Gemini Batch](https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/batch-prediction-gemini)是异步云任务：队列等待、运行上限、批量大小与共享容量有独立规则，基本监控合同是任务查询/取消；不要复用 Gemini Developer API Webhook 假设。
- Cloud Monitoring 提供运行指标；实际账务以 [Cloud Billing detailed usage export](https://docs.cloud.google.com/billing/docs/how-to/export-data-bigquery-tables/detailed-usage)和合同为准。
- 数据位置只在[服务条款](https://cloud.google.com/terms/service-terms)与[受支持的数据驻留服务/位置](https://cloud.google.com/terms/data-residency)组合范围内成立；Grounding、缓存、Batch、日志等特性可能有额外处理或保留合同。

实现约束：连接唯一键至少包含 `project + location + publisher/channel`；Vertex 默认使用云身份/OAuth，而不是复用 Gemini API Key。Quota、Monitoring、Billing Export 分别接入，不能用一个“usage sync”适配器混为一谈。

已确认未知：Vertex 全量模型及项目可用性没有确认到单一完整 API；精确可用配额、Provisioned Throughput、ZDR/驻留、日志保留和合同折扣需 Cloud Console/合同确认。

## 8. 火山引擎方舟（豆包）官方合同

### 8.1 控制面、数据面与模型发现

- 方舟[数据面](https://www.volcengine.com/docs/82379/1298459)默认使用 `https://ark.cn-beijing.volces.com/api/v3`，支持 API Key 或 Access Key；使用 Access Key 时，部分调用的 `model` 必须是 Endpoint ID。
- 控制面使用 AK/SK HMAC，service 为 `ark`、region 为 `cn-beijing`、host 为 `open.volcengineapi.com`。因此需要 `runtime_data_plane` 与 `ark_control_plane` 两个连接角色。
- 控制面提供 [`ListFoundationModels`](https://www.volcengine.com/docs/82379/1262849)、[`ListFoundationModelVersions`](https://www.volcengine.com/docs/82379/1262847)及模型激活/Endpoint 管理。版本状态包含 Unpublished、Published、Retiring，可作为动态目录与生命周期来源。
- “模型版本已发布”“账号已激活”“Endpoint 已部署”“数据面可调用”仍是四个独立状态。

### 8.2 限额、用量、任务与错误

- 方舟存在 RPM、TPM、QPS、Endpoint 等多维限制；精确当前值、保障包与专属容量以[配额文档/控制台](https://www.volcengine.com/docs/82379/1848593)为准。
- 429 的供应商错误码可区分账户/Endpoint 的 RPM、TPM 等原因；应保留原始错误码，不能只保存 HTTP 状态。[错误码文档](https://www.volcengine.com/docs/82379/1299023)
- 控制面有 [`GetInferenceUsage`](https://www.volcengine.com/docs/82379/2116766)及导出任务，UI 还可按日/小时、Endpoint、模型查看 token；实际费用仍需费用中心账单/导出，不等于调用 usage。
- [视频生成任务](https://www.volcengine.com/docs/82379/1521309)通过 `/api/v3/contents/generations/tasks/{id}` 轮询，只能查询最近 7 天，结果 URL 有效 24 小时；取消及清理也有状态限制。未确认 Ark 视频的统一官方 Webhook。
- 内容安全/护栏有独立[安全策略](https://docs.volcengine.com/docs/82379/1981525)和错误合同；合规拦截不应被自动跨供应商重试绕过。

实现约束：任务成功后立即持久化结果；提交超时先查询再重试；限流器至少区分账户、模型与 Endpoint；推理用量与费用中心单独同步。

### 8.3 生命周期与数据边界

- Foundation Model Version 的 `Retiring` 可机器读取，但完整退役日期、自动替换及迁移要求仍需[下线/升级公告](https://www.volcengine.com/docs/82379/1350667)补充；未确认统一提前通知 SLA。
- [平台服务条款](https://www.volcengine.com/docs/82379/1104498)说明服务许可和数据处理以中国大陆合同为主；无另行同意时不把客户数据用于训练/优化，但合规过滤、支持排障、异常告警以及用户启用的缓存/日志/监控存在合理处理或保留例外。
- 仅凭北京 API 域名不能推断所有子功能的精确存储位置、保留期和第三方模型处理合同；需按功能与合同确认。
- 中国生成式内容还涉及可见/隐式标识及用户自己的留档义务，策略后台应记录模型/渠道要求，不能只由前端临时处理。

当前仓库还使用火山 TTS。它与 Ark 生成模型共享供应商品牌，但 WebSocket/HTTP 协议、App/Cluster/Voice 授权和限额合同不同，必须作为独立 `channel` 和 Operation Adapter 管理，不能仅复用 Ark Base URL。

已确认未知：精确实时配额/保障容量、视频统一 Webhook、全功能数据驻留/保留、退役通知 SLA 与合同价格不能从单一公开 API 获得。

## 9. 阿里云百炼（DashScope）官方合同

### 9.1 Region、业务空间、Key 与模型目录

- [地域文档](https://help.aliyun.com/zh/model-studio/regions/)明确：Region 决定 Endpoint、数据位置、API Key 与可用模型列表，不同 Region 不能混用。
- 生产推荐使用业务空间专属 Endpoint：`{WorkspaceId}.{region}.maas.aliyuncs.com`；共享 DashScope Endpoint 与专属 Endpoint 的超时/SLA 合同不同。
- 服务部署范围与数据位置要分开保存：中国大陆、新加坡、美国、欧洲、日本及 global 的处理范围不同；global 可能跨区域，客户需自行确认合规。
- [API Key](https://help.aliyun.com/zh/model-studio/get-api-key)归属业务空间，可限制 IP/模型。新 Key 全值只在创建时显示一次；重置后旧值立即失效；停用、删除、重置在不同地域可能有差异。
- 百炼提供 Key 生命周期 OpenAPI，但高权限云身份与推理 Key 仍应分开。主账号可见范围与 RAM 子账号/Workspace 成员不同。
- 未确认面向全部生成模型、全部地域的通用完整 Model Catalog API；[官方模型页](https://help.aliyun.com/zh/model-studio/models)和控制台是主要目录来源，且必须按 Region 快照。某些产品的 `ListNluModels` 不能误用为百炼全量模型发现。

实现约束：连接唯一键包含 `account + region + workspace + endpointType`；Region 变更按新连接迁移；模型快照必须携带 Region，不能发布跨地域的同名模型假设。

### 9.2 限额、观测与账单

- [限流](https://help.aliyun.com/zh/model-studio/rate-limit)按主账号聚合所有 RAM 子账号、Workspace 和 API Key，再按模型独立；因此增加 Key 不会增加主账号配额。
- 限制包含 RPM、TPM 和瞬时 burst；即使一分钟总量未超，RPS/TPS 峰值仍可能触发。监控有小时级/高峰延迟，不能作为实时令牌桶唯一来源。
- [模型观测](https://help.aliyun.com/zh/model-studio/model-telemetry)可按 Workspace、模型、Key 查看调用量、失败、延迟、429、安全失败及 RPM/TPM；高级推理日志需主动开启、不能回填且可能记录输入/输出，只支持部分模型。
- [账单与成本](https://help.aliyun.com/zh/model-studio/bill-query-and-cost-management)有分钟或小时级延迟，可按 Key ID、Workspace、模型、输入输出等拆分；最终成本由费用中心账单/OpenAPI/导出确认，不等于实时估算。

实现约束：本地限流器作用域默认是主账号+模型，并支持 Endpoint/业务空间附加维度；高级日志默认关闭，启用前做数据分类与审批；账单延迟要在 UI 显示 `asOf`。

### 9.3 异步、错误、生命周期与数据

- [异步任务管理](https://help.aliyun.com/zh/model-studio/manage-asynchronous-tasks)状态包括 PENDING、RUNNING、SUCCEEDED、FAILED、CANCELED、UNKNOWN；查询有账号级 QPS 和时间范围/清理限制。
- [EventBridge 回调](https://help.aliyun.com/zh/model-studio/async-task-api)可把成功/失败通知推送到 HTTP/RocketMQ；事件包含 task、status、region、request 与 Key ID。回调只是通知，结果仍需查询一次，且会引入 EventBridge 权限、费用与交付合同。
- 错误需保留供应商 code，例如 RPM/TPM/burst、余额/权限、`DataInspectionFailed` 等；安全审核失败不属于可自动重试的供应商故障。
- [模型下线政策](https://help.aliyun.com/zh/model-studio/model-depreciation)为快照/主线模型提供不同公告窗口，退役后推理停止且文档/控制台入口可能移除；未发现机器 Webhook/API，应独立采集官方公告与邮件。
- 地域文档说明请求数据按选定 Region 处理/存储，部署范围影响推理位置；global 可能跨区域。隐私 FAQ 表明客户数据不用于训练，但详细保留、日志和特定模型处理仍以功能配置与合同为准。[隐私 FAQ](https://help.aliyun.com/zh/model-studio/faq-about-alibaba-cloud-model-studio)

已确认未知：完整模型目录 API、退役通知 API/Webhook、EventBridge HTTP 回调签名/重试的统一供应商合同、精确实时主账号配额及所有功能的数据保留期未确认。

## 10. 当前仓库其他渠道的合同补充

当前代码目录 `apps/core/src/p1/model-supply/catalog.ts` 还记录了 Kling、fal、Replicate、xAI、Tuzi relay、火山 TTS 等渠道。目录中的 `recorded`、managed 或条件渠道不代表已具备生产级凭据、控制面和账单接入；后台应把“目录存在”和“运行激活”分开。

| 渠道 | 官方合同面事实 | 对本项目的实现约束 |
|---|---|---|
| Kling | [并发](https://klingai.com/document-api/api/get-started/concurrency-rules)按账号 + 模型版本 + 资源包类型聚合所有 API Key，任务从提交到终态占并发，查询不占；异步任务支持 [callback](https://klingai.com/document-api/api/get-started/callbacks)与轮询 | 不按 Key 建并发池；callback 页面未确认统一签名与重试 SLA，按提示处理并保留轮询兜底；模型/资源包能力用官方能力页/控制台快照 |
| fal | [Queue API](https://fal.ai/docs/documentation/model-apis/inference/queue)返回 request/status/response/cancel URL，状态为 IN_QUEUE、IN_PROGRESS、COMPLETED；[Webhook](https://fal.ai/docs/documentation/model-apis/inference/webhooks)有 ED25519 验签、时间戳、重复投递与重试合同 | Job Adapter 要验证签名、幂等、允许重复；Queue runner 自身可能重试，内部重试不能叠加制造重复任务；[价格](https://fal.ai/docs/documentation/model-apis/pricing)按模型单位读取但仍需账务对账 |
| Replicate | Prediction 默认异步，可[轮询或 Webhook](https://replicate.com/docs/topics/predictions/create-a-prediction)；Webhook [可能重复/乱序](https://replicate.com/docs/topics/webhooks/receive-webhook/)，可验签；API Prediction 的输入、输出、文件和日志通常[约 1 小时后删除](https://replicate.com/docs/topics/predictions/data-retention/) | 终态单调推进，成功后立即复制输出；官方模型、社区模型、版本和 Deployment 分开；[创建/查询限流](https://replicate.com/docs/topics/predictions/rate-limits/)分别建桶 |
| xAI | [视频生成](https://docs.x.ai/developers/model-capabilities/video/generation)返回 request ID 并轮询 pending/done/failed/expired，结果 URL 临时；模型目录与[成本跟踪](https://docs.x.ai/developers/cost-tracking)是不同接口 | 以轮询为基本合同，立即复制结果；request-level cost 仅作观测，不替代账单；退役仍采集官方迁移公告 |
| 火山 TTS | 与 Ark 共品牌，但鉴权字段、WebSocket/HTTP、Voice/Cluster、错误和限额独立 | 独立 channel、secret schema、probe 与 quota adapter；不能通过 OpenAI-compatible 网关替代 |
| Tuzi relay | 当前仓库把它作为中转/自定义媒体渠道；本次未找到可作为厂商控制面合同的官方公开管理 API | 按 `custom_relay` 管理：显式填写 Base URL、鉴权头、上游声明、模型映射、数据去向、SLA、账单与责任人；未知项不得继承 OpenAI/火山合同 |

Kling、fal、Replicate、xAI 的数据驻留、完整账单、政策版本和模型退役仍需逐渠道合同/控制台确认。这里仅记录直接影响当前异步媒体任务实现的官方合同，不表示推荐接入。

## 11. 统一错误与重试语义

建议内部错误分类至少包含：

| 内部类别 | 典型来源 | 默认处理 |
|---|---|---|
| `invalid_request` | 400、参数/模型不支持 | 不重试；返回可操作错误 |
| `authentication_failed` | 401、签名/Key 无效 | 熔断该凭据并告警；不切换未经授权的账号 |
| `permission_or_entitlement` | 403、模型未激活、地域不允许 | 不盲重试；检查项目/Workspace/Endpoint/allowlist |
| `billing_exhausted` | OpenAI 429 budget、Anthropic 402、余额不足 | 不重试；切换需符合明确商业策略 |
| `transient_rate_limit` | RPM/TPM/QPS/concurrency | 按 scope 与 reset/retry-after 退避 |
| `shared_capacity_overload` | Vertex shared capacity、Anthropic 529、供应商 503 | 短退避、熔断；可执行已批准 fallback |
| `content_policy_block` | safety finish reason、DataInspectionFailed、护栏拒绝 | 不自动跨供应商绕过；给用户合规改写入口 |
| `model_retired_or_not_found` | 404、退役、版本下线 | 停止路由并触发生命周期迁移，不把它当临时故障 |
| `transport_unknown_acceptance` | 提交后超时/断连 | 先以幂等键/外部 ID 查询，不能直接重复创建 |
| `provider_internal` | 500/未知终态 | 有界重试，保存 request ID，超过阈值转人工 |

同一个 HTTP 状态在不同供应商甚至同一供应商内部都可能代表不同原因。规范化时必须保存 `httpStatus`、`providerCode`、`providerType`、`requestId`、`retryAfter` 和脱敏原始体。

## 12. 适配器边界与最小实现约束

建议每个渠道按能力拆成小适配器，而不是要求所有供应商实现一个巨型接口：

1. `ExecutionAdapter`：同步、流式、图片/视频/语音调用。
2. `JobAdapter`：创建、查询、取消、结果持久化、Webhook/EventBridge 接收。
3. `DiscoveryAdapter`：模型、版本、能力、地域/Endpoint 可用性。
4. `AdminAdapter`：Project/Workspace、Key 元数据、模型权限、激活、Endpoint。
5. `QuotaAdapter`：管理 API 快照 + 运行响应头。
6. `UsageAdapter`：供应商调用量与运行指标。
7. `BillingAdapter`：Costs/Cloud Billing/费用中心导出与对账。
8. `LifecycleAdapter`：退役 API、公告、邮件/人工录入。
9. `PolicyAdapter`：安全选项、数据处理资格与合同证据。

一个连接可以只实现其中部分能力。后台逐项显示 `native`、`manual`、`not_supported`、`not_authorized`、`unknown`，而不是用总状态“已接入”掩盖缺口。

最小安全边界：

- 推理 Worker 只能读数据面 Secret；管理/账单连接放在独立服务与权限域。
- Secret 创建后只显示一次，数据库只留 Vault 引用与可轮换元数据。
- 所有探针、Key 轮换、限额修改、模型发布/退役和 fallback 变更写审计事件。
- 发布 RouteSnapshot 时固定：供应商、渠道、模型/版本、Endpoint、凭据版本、价格版本、Policy Profile、fallback 顺序和验证证据。
- OpenAI-compatible 只是一种执行协议；模型发现、Key 生命周期、用量账单、异步媒体、内容政策、地域和退役仍走原生适配器。
- 账单、限额、模型与政策快照都显示 `source`、`observedAt/asOf`、`expiresAt` 或 `stale`。

## 13. 需要继续验证或通过合同补齐的未知项

以下信息不应由工程团队猜测：

1. 每个生产账户当前获批的模型、地域、精确限额、专属容量与折扣。
2. 各供应商 ZDR/MAM、数据驻留、训练用途、日志保留、DPA/BAA/CMEK 的实际资格及功能例外。
3. 完整余额、发票、税费、预留/保障包与人工调整的机器接口。
4. 没有公开生命周期 API 的供应商，其公告抓取、邮件责任人和人工确认 SLA。
5. 阿里百炼通用全量模型目录 API，以及 EventBridge HTTP 回调的统一验签/重试合同。
6. Vertex 全量 Publisher Model 对具体 Project/Region/allowlist 的单一发现接口。
7. Ark 视频统一 Webhook、全功能精确驻留/保留期与退役提前通知 SLA。
8. Kling callback 的签名/重试保证及完整数据处理合同。
9. Tuzi relay 的真实上游、数据流、保留、计费、限流、退役和责任主体。

接入生产连接时，应把这些项目转成逐供应商验收清单，并上传合同/控制台截图或 API 探针证据；未确认项保持 `unknown`，不能默认为“支持”。

## 14. 资料复用说明

本文链接均指向研究时采用的官方来源。后续实现阶段建议不要再次从零搜索：先以本文的 Provider Contract Registry、对象字段和未知项为索引，只针对发生变化的供应商页面做增量刷新；每次刷新保留日期、来源 URL、差异与审核人。
