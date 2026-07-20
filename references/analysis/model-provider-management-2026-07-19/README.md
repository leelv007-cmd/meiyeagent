# 多渠道模型供应管理研究总览

> 日期：2026-07-19
> 状态：研究包入口与开发切片基线
> 设计裁决：D-058～D-069 已确认；D-067 已被 D-068 修订。首轮必须同时完成文本、图片、视频三模态端到端闭环，文本生成、图片生成、视频生成各至少双渠道，音频暂不纳入本轮。

## 1. 结论

本项目的长期供给形态是“模型厂商官方 API + 第三方上游供应商 API”并存。平台要管理的对象是真实供应商、合同、账户、API 入口、模型部署及其证据，不是供应商后台所使用的软件名称。

**New API / Sub2API 只是一条上游渠道的可变技术指纹。** 它们不能替代真实运营方、合同/结算主体、底层模型来源、数据处理方、SLA、价格、余额或模型能力证据；也不是本轮准备自建、嵌入或接管产品真相的网关。第三方渠道即使暴露官方模型名或内部使用官方 Key，仍属于 `upstream_reseller`，不能显示为 `official_direct`。

现有代码已经具备可复用的供应内核：`CatalogModel`、Deployment/RouteSnapshot、激活探针、版本发布/回滚、ProviderAttempt 接受态和产品用量/供应成本账本。首轮不重写这些合同，而是补齐动态供应控制面并让文本、图片、视频共同走通：

```text
真实供应商与合同
  → CredentialAccount / ExecutionChannel
  → CatalogModel 映射 / Deployment / conformance
  → SupplyPool / RoutePolicy 发布
  → EntitlementPolicy / AccountAllocation
  → 文本、图片、视频真实任务
  → RouteSnapshot / ProductUsageLedger / ProviderCostLedger / 审计
```

## 2. 本研究包怎么使用

| 文件 | 解决的问题 | 实施时优先复用 |
| --- | --- | --- |
| [`local-audit.md`](./local-audit.md) | 当前代码到底已交付什么、哪些只是目录/PoC、生产断点在哪里 | 迁移边界、现有类型与代码证据、测试盲区 |
| [`official-provider-contracts.md`](./official-provider-contracts.md) | 官方直连在模型发现、凭据、限额、账单、异步任务、数据和退役上的真实差异 | Provider Contract Registry、原生 adapter、未知项清单 |
| [`gateway-components.md`](./gateway-components.md) | Bifrost/LiteLLM/Portkey/Helicone 的采用边界，以及 New API/Sub2API 指纹风险 | Core 与网关所有权、重试/接受态门禁、组件 PoC 边界 |
| [`new-api-sub2api-hybrid.md`](./new-api-sub2api-hybrid.md) | 官方 API 与使用 New API/Sub2API 的上游并存时如何尽调和准入 | 渠道问卷、信任等级、协议/成本/HA/合规门禁 |
| [`channel-control-and-user-allocation.md`](./channel-control-and-user-allocation.md) | 上游供给如何进入后台，又如何给平台注册账号分配 | 后台信息架构、能力池、套餐与账号覆盖、请求链路 |

设计与范围以 [`beauty-marketing-agent-product-design-2026-07-17.md`](../../../docs/design/beauty-marketing-agent-product-design-2026-07-17.md) 中 D-058～D-069 为权威；研究文件提供证据和实现约束，不另建一套决策真相。

## 3. 当前基线与真正缺口

### 可直接保留的底座

- 统一模型目录、Deployment 与不可变 RouteSnapshot 已存在。
- Provider attempt 已区分 `rejected_before_accept`、`accepted`、`acceptance_unknown`，并有禁止盲目重提的正确基础语义。
- 文本有真实 direct 执行；Ark/Tuzi 已有部分图片、视频 lifecycle；激活探针覆盖媒体提交、轮询、下载和部分取消。
- Catalog revision、CAS 发布/回滚、产品用量与供应成本分账已有生产基础。
- 平台凭据已有 Vault、轮换/撤销/测试的局部实现，Strict BYOK 已与平台凭据隔离。

### 首轮必须补齐的断点

- 生产文本仍是单一 direct 环境变量槽位，图片/视频也依赖固定 provider mode 与分散凭据；后台新增渠道不能无重启进入 HTTP 与 Worker。
- Provider/Channel/Deployment 主要靠目录和原始 JSON 表达，缺少真实运营方、合同、账户、余额/限额、动态凭据及结构化发布闭环。
- 自动路由主要覆盖文本且按质量分排序；图片/视频缺少同一供应控制面的安全候选、持久健康状态和可验证 fallback。
- New API/Sub2API 型上游的真实 operator、内部重试/换账号、模型映射、usage、账单和数据处理链尚未逐实例登记与实测。
- 用户目前获得的是局部模型偏好/额度，尚未通过版本化 SupplyPool、EntitlementPolicy 与 AccountAllocation 形成可解释的三模态有效权益。
- 图片/视频的质量门禁、渠道差分、账单对账、长任务排空与真实故障注入仍不完整。

## 4. 已确认的架构

### 4.1 规范对象与真相所有权

| 对象 | 一等真相 | 关键边界 |
| --- | --- | --- |
| `CatalogModel` | 制造商模型身份、稳定版本、模态与能力 | 不复制成“官方版/中转版”多个模型 |
| `ProviderProfile` | 真实签约、运营、支持、结算与数据责任方 | New API/Sub2API 项目方不自动成为 Provider |
| `SupplyContract` | 商品、价格、容量、SLA、数据、变更与对账合同 | 缺失字段保持 `unknown`，不得用底层官方文档代填第三方承诺 |
| `CredentialAccount` | 我方在供应商处的账号/项目/token、余额与限额作用域 | Secret 只写 Secret Manager/KMS；平台凭据与 BYOK 严格隔离 |
| `ExecutionChannel` | 具体 API 入口、协议、区域、账户绑定与 endpoint revision | `gatewayFingerprint` 只是可变元数据；官方与第三方必须分型 |
| `Deployment` | CatalogModel 在具体渠道上的可执行绑定 | 固定 provider alias、能力、价格、政策、凭据、健康与激活证据 |
| `SupplyPool` / `RoutePolicy` | 可兑现某能力的获准候选、硬约束、排序、成本与 fallback | Product Core 是跨 Deployment 的唯一选择/回退所有者 |
| `EntitlementPolicy` / `AccountAllocation` | 套餐默认权益与有期限的账号/工作区例外 | 普通用户选择模型/质量档，不选择供应商、渠道或上游 token |
| `RouteSnapshot` / 双账本 | 单次任务实际渠道、全部 revision、产品用量与供应成本 | 用户账、供应成本估算、供应商最终结算不得混为一套 |

平台供应目录是系统级控制面；工作区保存套餐生效结果、模型偏好、账号覆盖与 BYOK 等产品侧状态。若未来需要工作区私有 Deployment，应建显式 overlay，不让平台目录天然按工作区分裂。

### 4.2 路由、重试与数据边界

- 长期路由由已发布 RoutePolicy revision 决定；短期健康只叠加有原因、有期限、可审计的 overlay，不自动永久改权重。
- 候选先通过 operation/capability、模型来源、激活证据、数据政策、凭据、生命周期、套餐与容量硬门禁；质量和可靠性过门后，才用可对账成本、延迟与集中度优化。
- 网关/上游内部 retry、fallback、账号池或模型映射必须关闭、固定或透明化。无法证明实际子路由时标记 `opaque_route`；无法证明请求未被接受时标记 `acceptance_unknown`。
- 只有明确 `rejected_before_accept` 且下一候选继续满足全部硬约束时，Core 才能切换 Deployment。已接受、接受态未知或内容安全拒绝均不能换渠道盲目重提。
- 官方直连、第三方中转、自托管内部网关使用不同信任等级。`contains_face`、`pii`、`medical/health` 等受限数据默认不能进入未经合同和技术证据批准的第三方渠道；跨信任等级 fallback 必须由政策显式授权。

### 4.3 注册用户分配

- 普通用户可选择 `CatalogModel`，也可在适用任务选择 Auto/质量档；具体 ProviderProfile、ExecutionChannel、技术指纹、余额、价格与 fallback 顺序隐藏。
- 默认由套餐的 `EntitlementPolicy` 批量分配模型池、文本/图片/视频额度、并发和优先级；客服补偿、企业合同、灰度与风控通过有原因、有期限、可撤销的 `AccountAllocation` 表达。
- 上游账户默认由多个注册账号共享，通过产品侧额度、并发和公平队列隔离；企业区域、专属账单、容量或数据要求使用显式 DedicatedSupplyPool，且默认不与共享池互相 fallback。
- 用户额度、供应商余额、供应成本和支付金额分别建模。上游余额不足不能伪装成用户产品额度不足，也不能把 New API/Sub2API 的倍率或内部 cost 直接记为最终 ProviderCost。

## 5. 决策索引

| 决策 | 已确认结论 |
| --- | --- |
| D-058 | `CatalogModel → ProviderProfile → ExecutionChannel → Deployment` 分层，路由冻结 Deployment |
| D-059 | 版本化 RoutePolicy + 短期健康 overlay；只在明确接单前拒绝时安全回退 |
| D-060 | 独立 CredentialAccount 与写入式密钥版本；平台/BYOK 严格隔离 |
| D-061 | 按真实供应商和具体 API 入口管理；New API/Sub2API 仅作技术指纹 |
| D-062 | 用户可选模型，实际供应渠道隐藏 |
| D-063 | 套餐默认 + 有期限的账号/工作区覆盖 |
| D-064 | 官方与第三方是否互切由数据等级和已发布政策显式授权 |
| D-065 | 质量/可靠性先过门，再优化可对账成本 |
| D-066 | 共享供应池为默认，专属池为显式合同例外 |
| D-067 | 已被 D-068 supersede；仅保留端到端闭环、热装配与真实渠道等未冲突部分 |
| D-068 | 首轮同时交付文本、图片、视频三模态闭环；音频暂不纳入 |
| D-069 | 文本生成、图片生成、视频生成三项核心 operation 各至少两条独立 live 渠道；次级 operation 至少一条 |

## 6. P0：三模态端到端切片

### 范围硬约束

- 首轮 operation 至少包含文本生成/改写、图片生成/编辑、视频生成；音频不在本轮。
- 首轮整体至少接入一条 `official_direct` 与一条 `upstream_reseller`，证明两类来源可经过同一控制面采购、验证、发布、分配和审计；不要求为凑数量而让每个模态接入不合格渠道。
- 文本生成、图片生成、视频生成各至少有一个平台主推 CatalogModel 具备两条独立、获准、`live_verified` 的 Deployment，并通过真实故障注入；同一供应商账户的两个 token 或不可辨识的网关别名不能充数。文本改写/适配、图片编辑等次级 operation 至少一条真实渠道，单通道必须明确显示“无 fallback”。
- 图片与视频必须完成原生异步副作用合同：`submit → provider task ID/acceptance → recover/query → poll 或已验证 callback → cancel → download → 自有资产持久化`，并覆盖 URL TTL、幂等、排空、晚到终态和成本结算。
- 渠道发布、隔离、排空和停用后，HTTP 与 Worker 读取同一 effective revision，不依赖进程重启；运行中任务继续使用冻结快照恢复或对账。

### 统一开发票据

以下 `MP-*` 是本研究包唯一的实施票据命名；各子报告中的 `MP-GW-*`、`MP-RELAY-*` 与无编号建议均并入此表，不再另建平行 backlog。

| 票据 | P0 交付 | 验收重点 | 吸收的研究建议 |
| --- | --- | --- | --- |
| `MP-01` | 系统级供应注册表与迁移：ProviderProfile、SupplyContract、CredentialAccount、ExecutionChannel、Deployment、SupplyPool；保留历史 revision 前向读取 | 能登记真实官方/第三方运营方、合同、指纹、模型映射与来源；不把 recorded 条目算生产能力 | MP-GW-01、MP-GW-04、MP-RELAY-01、MP-RELAY-06 |
| `MP-02` | 通用凭据、Secret Broker 与版本生命周期，替换固定槽位 | 写入/测试/ready/active/draining/revoke 全审计；运行任务冻结凭据版本；Secret 不回显 | 本地审计 P0-3、D-060 |
| `MP-03` | HTTP/Worker 共用的版本化动态 runtime registry | 新增、隔离、排空、停用渠道无需重启；缓存失效、滚动兼容与回滚可验证 | 本地审计 P0-4、D-067/068/069 |
| `MP-04T` | 文本官方/第三方 adapter 与 operation conformance | 文本生成核心 CatalogModel 至少双渠道；生成/改写、原生/兼容协议、structured output、tool、stream、usage、错误和接受态逐项有证据 | MP-GW-02/05、MP-RELAY-02/03/04、D-069 |
| `MP-04I` | 图片生成/编辑 lifecycle adapter 与 conformance | 图片生成核心 CatalogModel 至少双渠道；submit/query/cancel/download/TTL/幂等/晚到终态/成本闭环；含人脸数据政策可执行 | MP-GW-02/05、MP-RELAY-02/03/04、D-069 |
| `MP-04V` | 视频生成 lifecycle adapter 与 conformance | 视频生成核心 CatalogModel 至少双渠道；长任务恢复、轮询/回调、取消、资产持久化、排空、重复提交和失败收费边界可验证 | MP-GW-02/05、MP-RELAY-02/03/04、D-069 |
| `MP-05` | SupplyPool、RoutePolicy、数据门禁、健康 overlay 与发布/回滚 | 三模态都经过硬过滤与版本发布；单一 retry owner；跨来源/数据等级切换有显式授权 | MP-RELAY-05、D-059/064/065 |
| `MP-06` | EntitlementPolicy、AccountAllocation 与注册账号详情 | 测试账号获得文本/图片/视频权益；模型可选、渠道隐藏；套餐/覆盖来源和有效期可解释 | D-062/063/066 |
| `MP-07` | RouteSnapshot、ProductUsageLedger、ProviderCostLedger、供应商结算差异与统一审计下钻 | 每个真实任务可追到渠道、凭据/价格/政策 revision、supplier request/task ID、实际/估算 usage 和最终资产 | MP-GW-06/07、D-061/066 |
| `MP-08` | 三模态端到端、真实凭据、Postgres/Worker 与故障注入验收 | 官方 + 第三方共同入池；三项核心操作分别双渠道成功；接单前拒绝可安全切换，accepted/unknown 不重复提交；停用后新任务行为正确 | D-068/D-069 与全部 Go/No-Go 门禁 |

### 完成定义

首轮只有在同一测试账号完成以下整条证据链后才能宣称完成：

1. 后台登记真实官方渠道与真实第三方供应商渠道，保存凭据并通过目标 operation conformance。
2. 将文本、图片、视频的 Deployment 分别审批发布到获准 SupplyPool；三项核心 operation 各至少两条独立渠道，HTTP 与 Worker 无重启读取同一 revision。
3. 通过套餐或 AccountAllocation 给测试账号生效三模态权益，用户仍只选择模型/质量档。
4. 分别完成真实文本、图片和视频任务；图片/视频资产在上游 TTL 前进入自有存储。
5. 每个任务可从账号与供应商后台下钻到 RouteSnapshot、接受态、凭据/价格/政策 revision、supplier task/request ID、产品用量、供应成本与审计事件。
6. 执行渠道隔离、接单前拒绝、提交后断连、轮询恢复、取消/晚到终态、余额/限流和 Worker 重启等故障注入；不制造双任务、双扣费或无证据 fallback。

## 7. P0 之外的后续项

- 余额、账单、限额、模型生命周期与政策的全供应商自动同步；P0 只为验收渠道实现必要 adapter，未知项允许人工证据并显示新鲜度。
- 自动充值、发票自动入账、全量供应商控制面、在线自学习调权和自动毛利优化。
- 大规模 cohort/百分比 canary、跨角色审批、周期财务对账和专属池容量复用。
- Bifrost 继续作为固定路由、零 retry/fallback、低敏文本的隔离 PoC；LiteLLM 仅对照，Portkey 待稳定，Helicone 不作为战略网关。
- New API/Sub2API 的自建、升级与运维不属于本轮；若未来目标改变，需另立 ADR 与安全/许可证评审。
- 音频供应链与产品能力作为后续独立切片，不得反向阻塞本轮三模态，但也不能因目录已有 TTS 就宣称完成。

## 8. 开放风险与实施前输入

1. **真实渠道清单未齐。** 需逐家登记 operator、合同/结算主体、官方或第三方来源、Base URL、地区、框架版本、模型映射、内部 retry/账号池、SLA、数据处理方和退出条款。
2. **三模态验收渠道与预算未定。** 需确认每个 operation 的真实凭据、最小付费探针预算、图片编辑、视频取消和可接受测试素材；不能用 README 或 `/models` 代替 live evidence。
3. **第三方来源透明度不足。** 热门模型名、一次 200 或供应商口头声明不能证明真实底层模型、转售授权、usage、request ID 与账单；缺失项保持 `provenance_unverified` 或 `opaque_route`。
4. **隐藏重试可能制造副作用。** New API 的 channel 路由、Sub2API 的账号池/fallback 及各实例实际配置尚未故障注入；无法关闭或返回子 attempt 时，媒体不得进入自动容灾主链。
5. **数据分类与合同尚待批准。** 美业素材中的人脸、个人信息和皮肤/健康信息如何分类，以及哪些第三方渠道可处理，需在 D-064 门禁下逐家确认。
6. **成本和容量单位不统一。** 官方 usage、网关估算、供应商余额/倍率、账单、税费/汇率和图片/视频单位不可直接比较；只有可追溯且有 `asOf` 的事实才能进入路由优化。
7. **动态热装配有一致性风险。** 系统级目录与现有 workspace catalog、HTTP/Worker 缓存失效、滚动发布、凭据双版本及长任务排空需要明确迁移和恢复合同。
8. **官方控制面权限差异大。** 模型发现、限额、Usage、Billing、生命周期和数据资格往往需要不同高权限凭据；P0 不应因只有数据面 Key 就显示“已同步/已托管”。
9. **供应商运营与许可证连续性。** New API 的 AGPL/署名要求、Sub2API 的 LGPL 文件与 README“无商业授权”表述属于上游运营风险，需供应商承诺合法持续运营；必要时交专业人员复核，不由工程文档作法律结论。
10. **故障注入环境未确认。** 真实 Postgres、Worker、Secret、对象存储、渠道余额/限流与 supplier task 查询能力必须在开工前列入测试资源，缺失时不得把 mock 通过写成生产闭环完成。

## 9. 不再讨论的误读

- 不把“官方 API”写成消费者订阅、会员或 Session 转 API。
- 不把 New API/Sub2API 当我方供应商、战略网关或用户可选产品。
- 不把 OpenAI-compatible、模型别名、网关余额或框架内部倍率当能力、来源或成本真相。
- 不让外部网关接管 Product Core 的 Catalog、RoutePolicy、接受态、权益、RouteSnapshot、双账本与审计。
- 不以“首轮先做文本”为由把图片/视频渠道控制面推到下一轮；D-068 已明确取代 D-067 的该范围。
