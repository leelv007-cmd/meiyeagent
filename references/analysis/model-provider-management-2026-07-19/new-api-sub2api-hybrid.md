# 上游供应商使用 New API / Sub2API 时的渠道尽调边界

> 日期：2026-07-19
> 用户口径：约一半模型向使用 New API / Sub2API 的上游供应商采购，另一半直接使用模型厂商官方 API；“官方”明确指官方 API，不是消费者会员订阅或 Session 转 API。New API / Sub2API 是上游供应商的后台实现，不是本产品准备自建或选用的网关。
> 精确目标：[QuantumNous/new-api](https://github.com/QuantumNous/new-api)、[Wei-Shaw/sub2api](https://github.com/Wei-Shaw/sub2api)

## Question

在官方 API 与第三方上游供应商长期并存、且后者可能使用 New API / Sub2API 时，渠道后台应如何识别和约束这类供应，并避免协议兼容、隐藏重试、成本失真、来源与隐私风险进入产品主链。

## Scope correction

- 本产品的选型对象是“真实上游运营商及其具体 API 渠道”，不是 New API / Sub2API 两套框架。
- 框架调研只用于理解上游可能具备或隐藏的路由、重试、账号池、计费和协议转换行为，并形成接入问卷与实测项。
- 自托管、许可证和框架部署建议只在未来我方另行决定自建网关时适用；不属于当前渠道后台的开发范围。

## Research method and source boundary

- 按用户要求优先使用 Open CLI：先用 `opencli google search` 精确定位两个官方仓库，再用 `opencli web read` 读取 New API 官方仓库页面。
- Open CLI 读取会自动保存网页和图片；本文件只沉淀支持选型的摘要，不把未筛选的网页镜像纳入仓库。
- 随后浅克隆两个精确官方仓库，以当前主分支代码、README、LICENSE、部署与安全文档核对细节。
- 研究快照：
  - New API：`5a6c53d4966b2e34690ab49f3dd19be01c88fdbe`，提交时间 `2026-07-18T15:44:48+08:00`。
  - Sub2API：`d4b9797ff72024960a035cf22fdd8f213e149169`，版本 `0.1.161`，提交时间 `2026-07-18T14:18:28Z`。
- 只使用项目官方仓库、官方文档和仓库内许可证/安全说明；未把赞助商宣传或第三方中转站自述当作能力、来源真实性或 SLA 证据。

## Channel interpretation: do not treat framework names as provider identities

| Channel type | 我方管理口径 | Why | Do not infer |
| --- | --- | --- | --- |
| 官方 API | 能力基线、高信任与受限数据通道；新模型/新协议首个 conformance 基准 | 上游身份、协议、用量、弃用和支持边界最直接 | 所有流量都必须走的唯一通道；仍需多渠道容灾 |
| 使用 New API 的上游 | 登记真实运营商与一个或多个具体 API 渠道；New API 仅作技术指纹 | 框架可能包含多 channel、权重、失败重试、model mapping、协议转换和内部计费 | 真实上游模型、官方授权、SLA、价格和 usage 一定可信 |
| 使用 Sub2API 的上游 | 登记真实运营商与账号池型渠道；额外标记 opaque pool、粘性会话和并发/窗口限制 | 框架可能在我方看不到的账号池内调度，并具有粘性会话与账号级限制 | 我方可追踪具体官方账号，或该渠道适合普通官方 API Key/媒体主链 |

若当前所谓“中转站”是第三方运营的 New API / Sub2API 实例，框架名只表示 channel software；`ProviderProfile` 必须记录真实运营/结算/数据处理交易方。不能从 New API 或 Sub2API 这个软件名推断模型来源、官方授权、账单主体、服务等级或数据政策。

## The most important implementation boundary: only one routing/retry owner

New API 自带优先级、权重随机、跨 channel 重试和自动禁用；Sub2API 自带账号选择、负载均衡、粘性会话、并发与速率控制。我方 Product Core 已经拥有 RoutePolicy、RouteSnapshot、接受态分类、幂等、回退和成本账本。如果两层同时自主路由，会出现：

- 我方只记录“New API deployment”，却不知道实际命中了哪个上游 channel/account；
- Product Core 与网关各重试一次，最多请求数与成本被乘法放大；
- Provider 已接受或接受状态未知时，网关可能换 channel 重提，产生双扣费、双任务或双产物；
- 同一 Work 的连续上下文可能在不同协议/账号/模型之间漂移；
- 网关内部 price/quota 与我方产品额度、实际发票形成多份真相。

推荐约束：

1. Product Core 是跨 Deployment 的唯一长期路由与回退所有者。
2. New API 通过独立 token/group/model mapping 尽量把我方生产流量约束在一个可追踪 channel（或固定小集合）；将其全局失败重试次数设为 `0`，或至少对我方调用路径启用明确的 skip-retry/affinity 合同。若实例配置无法提供这种约束，则整条中转按 `opaque_route` 管理。
3. Sub2API 若必须做账号池，只把“一个受控账号池”登记成一个 opaque Deployment；池内调度属于该 Deployment 内部，不声称我方掌握具体官方账号真相。
4. 任何网关内部重试都必须证明只发生在明确未接受请求的网络前置失败，并把 attempt/route evidence 返回或可查询；无法证明时按 `acceptance_unknown` 处理，禁止 Product Core 再提交。
5. Work/会话/异步任务冻结 execution channel；不能在一个上下文中静默混用不同协议或来源。Sub2API README 自身也明确警告部分 Claude/Antigravity 上下文不可混用。

## Protocol compatibility is not capability equivalence

New API 官方 README 当前明确列出：

- OpenAI compatible 与 Claude Messages 可转换；
- OpenAI compatible 可转 Google Gemini；
- Google Gemini 转 OpenAI compatible 当前仅文本，尚不支持 function calling；
- OpenAI compatible 与 OpenAI Responses 的双向转换仍标为开发中。

因此，`OpenAI-compatible` 只能表示协议入口相似，不能自动声明以下能力等价：structured output、tool/function calling、reasoning/thinking、stream event 顺序、usage/cache token、文件与多模态输入、Realtime、异步图片/视频任务、取消、回调、错误码和模型版本。

推荐分层：

- 普通文本生成可在完成 conformance 后使用兼容协议中转。
- Harness 结构化节点、工具调用、长上下文、原生 reasoning、Realtime、文件上传优先使用原生协议或逐项验证过的 passthrough。
- 图片/视频/音频必须按具体 operation 做 submit/poll/cancel/download/TTL/usage/error conformance；不能因为网关 README 写了 Image/Video/Audio 接口就整类放行。
- Sub2API 当前 README 明确标注 Sora 因上游与媒体链路问题不可用于生产，因此不能作为我方媒体生成通用网关证据。

## Trust and data policy tiers

建议给 Deployment 增加独立于 `region` 的 `trustTier` / `dataPolicyRevision`：

| Tier | Example | Default data classes | Default use |
| --- | --- | --- | --- |
| A | 官方 API，平台持有官方 Project/Key | 按官方 DPA/区域合同允许后，可处理 `public` 及明确批准的数据类 | 基线、受限数据、高价值主链、新能力验证 |
| B | 自托管 New API/Sub2API，内部持有合法官方 API Key，协议不做有损转换 | 以官方合同和我方自托管边界为上限 | 聚合、网络统一、账号/限流隔离 |
| C | 第三方运营中转，来源与数据处理链多一层 | 默认只允许 `public`；`contains_face`、`pii`、`medical` 需单独合同与批准 | 低敏、可替代、成本/容灾候选 |

技术探针只能证明“这个 endpoint 此刻返回了符合合同的结果”，不能证明第三方实际使用了其宣称的官方模型。模型来源、转售授权、数据处理、留存、分包商和账单主体必须有合同/发票/SLA 证据；没有则状态是 `provenance_unverified`，不能显示成“官方”。

跨 Tier fallback 不得默认发生。即使模型名相同，从官方 API 切到第三方中转也改变了数据处理方、成本和故障域，必须由已发布 RoutePolicy 明确授权。

## Cost, quota and billing truth

- 官方通道：以官方 usage、项目账单和价格修订为主要供应成本证据。
- New API / Sub2API：内部倍率、余额、token 计费可用于 channel 运营，但不能直接替代我方 ProviderCost ledger 或最终发票。
- 某些协议转换或缺失 usage 时，网关会估算 token；估算值必须标记 `estimated`，不可用于精确结算或模型间质量/成本自动调权。
- 每个 Deployment 保存自己的币种、计费单位、price revision、税费/汇率来源和账期；同一 CatalogModel 的官方价格不能套到第三方中转。
- 同时监控三层限制：Product entitlement、我方 CredentialAccount/RoutePolicy 限额、网关/官方上游实际限流。上游返回“余额不足”和用户产品额度不足必须是不同错误。

## Secrets and observability

- 官方直连的官方 key 存入我方 CredentialAccount/Secret Manager。
- 自托管网关：官方 key 只进入网关自己的 secret store；我方只持有该网关的下游 token，二者独立轮换。
- 第三方中转：只保存第三方 token；不得索取或上传我方官方 key，除非有明确代管合同且另行安全评审。
- 网关会看到完整 prompt、工具参数、参考素材或生成资产。生产必须禁用原文日志/错误回显，脱敏 Authorization、query、素材 URL 和用户内容，并限制日志保留与访问权限。
- 每次调用至少关联我方 correlation ID、网关 request ID、上游 request ID（若可得）、固定 Deployment、credential version、网关版本和实际/估算 usage；无法回传内部 channel/account 时明确标记 `opaque_route`。

## Upstream due-diligence signals: deployment, HA and security

以下内容用于向上游运营商询证和评估故障/合规风险，不表示我方需要部署这些框架，也不把上游框架许可证义务转嫁为我方产品代码义务。

### New API

- 许可证为 AGPLv3；官方 README 还要求修改版 UI 保留作者归属和原项目可见链接。上游运营商应自行证明其部署与修改的合规性；我方不把框架代码复制进产品。
- SQLite 仅适合轻量单机；若上游声称高可用，应能说明外部数据库、Redis/缓存、会话密钥一致性、备份与恢复目标。
- 上游应固定可识别版本并提供升级通知；每次版本或关键配置变化都视为渠道配置 revision 变化，先跑 conformance canary。
- 默认全局 RetryTimes 在代码中为 0，但可由运营设置修改；渠道验收必须让运营商声明实际重试配置，并用故障注入核验我方路径不会出现乘法重试。

### Sub2API

- 官方部署栈要求 PostgreSQL 15+、Redis 7+；若上游声称高可用，应说明数据库/Redis 冗余、备份、代理保护与恢复目标。
- 许可证文件为 LGPLv3-or-later，但 README 同时写“无商业授权”。歧义主要属于上游运营商的商用合规风险；我方渠道准入应要求其承诺合法运营，必要时由专业人员复核合同风险，不自行作法律结论。
- 上游生产实例应能证明 URL/host allowlist、仅 HTTPS、私网/回环/云元数据阻断、响应头过滤、可信代理和出站白名单。README 明确警告关闭 URL 校验时 Docker 友好默认可能允许 HTTP，会暴露密钥与数据。
- Nginx 默认丢弃含下划线 header；若上游依赖 `session_id` 粘性会话，需按官方说明保留该 header，并将它纳入我方代理链 conformance。
- `RUN_MODE=simple` 可隐藏 SaaS/支付层，但不会自动消除上游的账号池、路由、数据和安全运维责任。

## Recommended channel policy for this project

1. **官方 API 保留为独立 Deployment 和能力基线。** 对受限数据、新模型和关键质量任务优先官方直连。
2. **每个第三方上游按真实运营商和具体 API 入口单独建档。** New API / Sub2API 只记录为可变技术指纹；一个运营商切换框架或升级版本时触发重新验证，不改变其交易方身份。
3. **对使用 New API 的上游重点核验内部 channel mapping、隐藏重试、协议转换、usage 与账单；对使用 Sub2API 的上游再增加账号池、粘性会话、账号封禁与窗口配额核验。** 这些是采购门禁，不是我方框架选型。
4. **平台注册用户只消费我方 entitlement、allowance、concurrency 与 route policy。** 不下发上游 token、账号或余额；上游供给状态只影响可选 Deployment 与服务承诺。
5. **同一模型尽量保留一条官方 canary。** 每次上游配置/模型别名变化后，对 structured output、tools、stream、usage、错误、取消和媒体生命周期做差分验证；未通过的 operation 不发布。

## Go / no-go gate for every relay Deployment

- 能证明真实 operator、结算方、upstream 声明、数据处理方和部署区域。
- 固定网关版本、channel mapping、credential version 与模型别名；升级可回滚。
- Product Core 是唯一跨 Deployment 路由者；内部重试上限与接受态语义可证明。
- 目标 operation 的原生/兼容协议 conformance 全通过，不只测 `/models` 或一次 200。
- 错误码可归一化为 auth / quota / rate_limit / policy / rejected_before_accept / accepted / acceptance_unknown。
- usage 与价格明确标记 observed/estimated，能和网关账单或官方账单对账。
- restricted data policy、日志脱敏、留存、出站 allowlist、TLS 和 secret rotation 已验证。
- health probe 同时覆盖 gateway、实际 upstream capability 和余额/限流，不把 gateway 进程存活当模型可用。
- 失败时能关闭该 Deployment，而不需要改代码或泄漏/重发运行中任务。

## Open risks

- 各上游供应商的真实运营方、合同主体、框架版本、内部 channel/账号池透明度和数据处理边界尚待逐一登记。
- 当前各实例是否开启内部重试、权重调度、自动禁用和协议转换尚未实测。
- 第三方实例能否返回实际 channel/upstream request ID、真实 usage 与可核对账单尚未知。
- Sub2API 的 LGPLv3 文件与 README“无商业授权”表述需专业许可证审查。
- 当前项目媒体链以 Ark/tu-zi/Volcengine 专用 adapter 为主；不能在未跑真实生命周期测试前迁到通用中转。

## Follow-up tickets

1. **MP-RELAY-01 — Relay instance inventory**：登记每个 New API/Sub2API 实例的 operator、self-hosted/third-party、version、region、upstream ownership、billing、SLA、data policy、retry/routing 设置和 credential binding。
2. **MP-RELAY-02 — Gateway conformance suite**：按 operation 测 native/compatible protocol、structured output、tool、stream、usage、error、acceptance、cancel、asset TTL 与 correlation。
3. **MP-RELAY-03 — Single retry owner gate**：自动检查 New API retry、Sub2API pool behavior 与 Product Core attempt 上限；禁止乘法重试。
4. **MP-RELAY-04 — Official-vs-relay canary**：同模型官方 API 与中转做固定用例差分，输出能力兼容而非模型“真伪”结论。
5. **MP-RELAY-05 — Trust/data policy enforcement**：把 official/self-hosted/third-party tier 与 `public/contains_face/pii/medical` 路由硬过滤接入 RoutePolicy。
6. **MP-RELAY-06 — Upstream compliance and resilience questionnaire**：要求运营商说明框架商用合规承诺、版本固定、备份、HA、升级通知与回滚；我方不承担其框架部署工作。

## Official sources

- [QuantumNous/new-api](https://github.com/QuantumNous/new-api)
- [New API official documentation](https://docs.newapi.pro/en/docs)
- [New API license](https://github.com/QuantumNous/new-api/blob/main/LICENSE)
- [Wei-Shaw/sub2api](https://github.com/Wei-Shaw/sub2api)
- [Sub2API deployment guide](https://github.com/Wei-Shaw/sub2api/blob/main/deploy/README.md)
- [Sub2API license](https://github.com/Wei-Shaw/sub2api/blob/main/LICENSE)
- [Sub2API administrator compliance notice](https://github.com/Wei-Shaw/sub2api/blob/main/docs/legal/admin-compliance.zh.md)
