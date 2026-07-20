# 计量、权益、限流与三账分离组件比选

- 日期：2026-07-19
- 研究快照：2026-07-19（Asia/Shanghai）
- 范围：只评估多渠道模型供应后台首轮所需的套餐默认、账号级覆盖、产品用量额度、并发/速率和供应成本分账；不把发票、税务、催收等运营计费提前扩入 P0。
- 候选：OpenMeter、Lago、Kill Bill、Unkey、Flexprice，以及“保持现有 Core 真相、仅选择性复用设计”的基线方案。
- 方法：按 research skill 使用官方文档、官方仓库、许可证、源码和发布记录；网页资料优先通过 OpenCLI 读取。活跃度仅表示研究日快照，不等于稳定性或生产适用性。

## 结论先行

**P0 不引入任何一个候选作为运行时授权、余额或供应成本的事实源。** 保留现有 Core/Postgres 中的三套独立真相：

1. `EntitlementPolicy + AccountAllocation`：回答“这个工作区现在被允许使用什么”；
2. `ProductUsageLedger`：回答“产品额度 reserve/commit/refund/expire/adjust/compensate 发生了什么”；
3. `ProviderCostLedger`：回答“某次 ProviderAttempt 实际让谁承担了多少供应成本、证据是什么”。

并发、速率、队列优先级属于由 EffectiveEntitlement 派生的**实时控制状态**，不是第四本财务账。支付、订单、发票仍是商业事实，不能反向替代产品权益或供应成本。

首轮最适合的复用方式是：

- 采用 OpenMeter 的 CloudEvents 事件包络、`source + id` 去重和 metered/static/boolean entitlement 分类作为设计参考；P1 可做单向 shadow metering POC，但不进入 P0 授权热路径。
- 采用 Lago 的 `transaction_id`、套餐 entitlement + subscription override、账单事件对账模式作为设计参考；只有后续确定需要复杂发票/税务时，才评估它作为账单 sidecar。
- 采用 Unkey 的 key verify 返回合同和分布式限流取舍作为未来“对外开发者 API Key”参考；当前产品账号/工作区不接入 Unkey。
- Kill Bill 不进入候选短名单；Flexprice 保留观察，不进入 P0。

这不是“什么都不复用”。原因是仓库已经实现了与生成任务强绑定的 reserve/terminal 语义、Provider acceptance、BYOK payer、异步媒体失败退款和工作区队列策略；把这些真相搬到通用计费产品，会先形成双写和双裁决，再花一轮项目消除它。

## 已有实现与不可丢失的合同

当前 Core 已经不是空白计量层：

- `UsageEvent` 明确支持 `reserve | commit | refund | expire | adjust | compensate`，投影区分 reserved、committed、released、available；生成任务持有稳定 `usageReservationId`。[domain.ts](../../../apps/core/src/p1/foundation/domain.ts#L66-L94)
- `ProviderCostEvent` 与产品用量分表，记录 estimated/observed/reconciled/adjusted、payer、billing status、证据、attempt 与 correlation。[domain.ts](../../../apps/core/src/p1/foundation/domain.ts#L162-L176)
- 套餐策略已有四模态 allowance、并发、队列优先级、加量包和自动加量，并通过 workspace-scoped port 注入任务调度。[entitlement-policy.ts](../../../apps/core/src/p1/foundation/entitlement-policy.ts#L4-L25) · [entitlement-job-port.ts](../../../apps/core/src/p1/job-runtime/entitlement-job-port.ts#L16-L64)
- Postgres 已有 append-only entitlement events、Provider cost events，以及支付事件和注册赠送的唯一性约束。[postgres-repository.ts](../../../apps/core/src/p1/foundation/postgres-repository.ts#L166-L210)
- D-063 已确定“版本化套餐默认 + 有期限账号覆盖 + 硬限制优先 + workspace 明确作用域”；D-066 又明确 ProductUsage/ProviderCost 分账与共享供应池边界。[主设计 D-063](../../../docs/design/beauty-marketing-agent-product-design-2026-07-17.md#d-063-注册账号分配套餐默认--有期限的账号级覆盖) · [主设计 D-066](../../../docs/design/beauty-marketing-agent-product-design-2026-07-17.md#d-066-上游供应账户隔离共享池为默认专属池为显式例外)

因此组件必须证明自己能保留这些语义；仅有“usage-based billing”“credits”或“entitlements”同名功能不构成替换理由。

## 比选矩阵

| 方案 | 许可证 / 活跃度快照 | 实时权益与额度 | 幂等事件 | 发票/账单 | 部署与多租户 | 与本项目重叠 / 迁移成本 | P0 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **现有 Core + 选择性借鉴** | 项目自有；已随生成链路测试 | 已有套餐额度、reserve/terminal、并发和队列；待补 D-063 的模型池、速率与账号覆盖 | Core command 与 usage terminal 已有稳定幂等约束 | 维持现有 payment fact；本轮不扩发票 | 复用现有 Postgres、DBOS/任务运行时、Cloudflare Web | 无真相迁移；只需补齐控制面与读模型 | **采用** |
| **OpenMeter** | Apache-2.0；未归档；主分支 2026-07-18 有提交；最新发布仍为 `v1.0.0-beta.231` | metered/static/boolean；官方声明 current value 实时，可返回 access/balance/usage/overage | CloudEvents `source + id` 去重；文档给出 32 天窗口，但当前架构说明部署可关闭去重或只用内存，生产必须显式配置 | 有计划、订阅、定价与发票生命周期 | Postgres + ClickHouse + Kafka，Redis/Svix 可选；K8s/Helm；namespace/customer 隔离 | 能覆盖多数 Entitlement/Usage，恰好也会制造最大双真相；替换 reserve/commit/refund 与媒体任务结算成本高 | **P0 不采用；P1 shadow POC 首选** |
| **Lago** | AGPL-3.0；未归档；主分支 2026-07-16 有提交；`v1.50.0` | 有 feature privilege、plan entitlement、subscription override；未见适合任务接单热路径的原子 reserve/commit/refund；wallet ongoing balance 每分钟刷新且为 Premium | `transaction_id` 跨 REST/Kafka/S3 去重；文档说明不同事件存储后端的更正规则不同 | 强项：usage rating、invoice、payment、wallet | Postgres + Redis/Sidekiq + API/worker/clock/front/PDF；高吞吐再加 Kafka/ClickHouse；organization/customer | D-063 的结构形似，但缺硬限制优先、有期限 grant/restrict、任务 reservation；引入会同时复制 entitlement、usage、subscription | **P0 不采用；未来发票 sidecar 再评估** |
| **Kill Bill** | Apache-2.0；2012 年起维护；主分支 2026-07-16 有提交；`0.24.19` | 其 entitlement 主要是订阅生命周期，不是产品 feature entitlement；usage 是按订阅记录后周期计费 | 官方 usage 示例未提供事件幂等键；需要调用方自行证明去重 | 很强：订阅、目录、usage-in-arrear、发票、支付、催收、插件 | Java/Tomcat + MySQL（亦可配置其他 DB）+ Kaui；原生多租户、RBAC、persistent event bus | 与本轮目标错位；需要把轻量产品授权翻译成复杂 billing catalog/subscription/plugin | **不适合** |
| **Unkey** | 主体 AGPL-3.0，`packages/` 各自许可证；未归档；主分支 2026-07-18 有提交 | API key verify 可同时查权限、扣 credits、查 rate limits；不是套餐/媒体任务权益账本 | verify 请求没有业务 idempotency key；重试扣 credits 不能替代任务 reservation | 无完整订阅发票引擎 | 官方产品当前以其托管多区域服务为主；仓库可自托管但公开文档未给出与 Cloudflare 等价的轻量生产拓扑 | 若绑定现有登录账号，会新增 key 生命周期并把额度绑到 key；与 workspace entitlement 冲突 | **当前不采用；未来公开 API Key 可单独 POC** |
| **Flexprice** | AGPL-3.0 open core，`ee/internal/ee` 商业许可；2024 年创建；主分支 2026-07-18 有提交；`v2.1.21` | 宣称 boolean/metered/config entitlement、credits 与 usage limit；源码设计文档仍把 grants/rollover列为后续，相关边界需逐功能核实 OSS/EE | `event_id` 被定义为事件幂等键 | 有定价、订阅、credits、发票 | Postgres + Kafka + ClickHouse + Temporal + API/consumer/worker；tenant-scoped | 功能面最接近，也与三套真相重叠最完整；双写、回填、运行时外调和 AGPL/open-core 审核成本最高 | **观察，不进 P0** |

## 候选详评

### 1. OpenMeter：最值得借鉴，但不该在 P0 取代 Core

OpenMeter 官方把平台定义为实时 metering + billing engine：使用 CloudEvents 接入事件，支持 metered/static/boolean entitlement，能查询 `hasAccess`、balance、usage、overage，并提供计划、订阅和发票。[Entitlement 概览](https://openmeter.io/docs/billing/entitlements/overview) · [Entitlement API 语义](https://openmeter.io/docs/billing/entitlements/entitlement) · [Billing 概览](https://openmeter.io/docs/billing/overview)

它在事件可靠性上很适合借鉴：事件的 `source + id` 唯一，事件接入文档给出 32 天去重窗口，快速开始也要求事件 `id` 唯一。但同一快照的架构文档说明去重可被关闭，未配置 Redis 时还可能只使用进程内存；所以“32 天”必须作为生产配置与故障演练的验收项，不能只看 API 字段。[事件接入源码文档](https://github.com/openmeterio/openmeter/blob/3885445fd4bff65910c56fceea45e352c8ba341d/docs/event-ingestion.md) · [Quick Start](https://openmeter.io/docs/get-started/quick-start) · [架构](https://github.com/openmeterio/openmeter/blob/3885445fd4bff65910c56fceea45e352c8ba341d/docs/architecture.md)

但它的生产拓扑不是一个可嵌入 Cloudflare Worker 的轻量库。官方架构把高吞吐 usage 放在 Kafka + ClickHouse，交易态放在 Postgres，另有 balance/billing/sink/notification workers，Redis/Svix 可选；Helm 也明确列出这些依赖。[架构](https://github.com/openmeterio/openmeter/blob/3885445fd4bff65910c56fceea45e352c8ba341d/docs/architecture.md) · [Helm 部署](https://github.com/openmeterio/openmeter/blob/3885445fd4bff65910c56fceea45e352c8ba341d/deploy/charts/openmeter/README.md) · [Apache-2.0](https://github.com/openmeterio/openmeter/blob/3885445fd4bff65910c56fceea45e352c8ba341d/LICENSE)

迁移它作为权威系统至少需要：

1. 把现有 workspace、套餐 revision、账号覆盖、加量包迁成 customer/feature/entitlement/grant；
2. 把 `reserve → commit/refund/expire/compensate` 改造成 OpenMeter 可等价证明的事务协议；
3. 让同步文本和异步图片/视频都在外部 access check、任务提交、终态结算之间保持一致；
4. 回填历史 usage，并持续对账旧/新 projection；
5. 决定 ProviderCost 是否也进入其 LLM cost tracking——本项目答案应为否，因为供应账还绑定 attempt、payer、官方账单证据与 acceptance。

所以 P0 只借它的事件合同。若 P1 要验证高量计量，将 Core outbox 的已提交产品用量**单向**镜像到 OpenMeter；OpenMeter 只产分析投影，不参与接单授权。连续对账稳定后，才另立 ADR 讨论是否迁移某个非关键读模型。

### 2. Lago：适合作为未来账单 sidecar，不适合作为任务授权器

Lago 的核心强项是把 usage event 变成订阅账单。事件使用 `transaction_id` 去重，可经 REST、Kafka/Redpanda、Kinesis、S3 接入；其文档明确要求将该 ID 设计成可追踪的稳定合同。[使用量接入](https://getlago.com/docs/guide/events/ingesting-usage)

它已经支持 feature privilege、套餐 entitlement 和 subscription-specific override，表面上与 D-063 很接近。[Entitlements](https://getlago.com/docs/guide/entitlements) 但差异决定它不能直接接管 P0：

- D-063 需要 platform hard limit > plan > approved grant/restrict > temporary grant 的确定优先级、起止时间、审批和回退；Lago 当前合同主要是 plan 值与 subscription override。
- 生成任务需要接单前 reserve、异步完成后 commit、失败 refund、晚到终态 reconcile；Lago 的 usage event 面向账单聚合，不是该状态机。
- Lago wallet 的 real-time ongoing balance 每分钟刷新，而且官方标为 Premium；不能把它当严格的任务前置额度判断。[Wallet](https://getlago.com/docs/guide/wallet-and-prepaid-credits/overview)

自托管至少运行 API、worker、clock、Postgres、Redis、前端和 PDF 服务；高吞吐事件路径再引入 Kafka/ClickHouse。其许可证是 AGPL-3.0，部分能力为 Premium，正式采用前要做功能级许可清单。[Self-host Docker](https://getlago.com/docs/guide/lago-self-hosted/docker) · [LICENSE](https://github.com/getlago/lago/blob/f91a4ca52f1482d46062080f38b221731e1e6cae/LICENSE) · [版本/付费边界](https://getlago.com/docs/faq/pricing)

因此本轮只借鉴 `transaction_id`、plan entitlement + override 的 API 展示和账单对账；等产品真的要做复杂 usage invoice、税费或财务系统同步时，再让 Lago 消费 Core 的 committed usage。它不能反向成为 ProductEntitlement 或 ProviderCost 真相。

### 3. Kill Bill：成熟，但解决的是另一类问题

Kill Bill 的优势是真正成熟的订阅计费平台：catalog、trial/phase、usage-in-arrear、invoice/payment、RBAC、多租户、persistent event bus 和插件都很完整。[平台指南](https://docs.killbill.io/latest/userguide_platform) · [订阅指南](https://docs.killbill.io/latest/userguide_subscription) · [Apache-2.0](https://github.com/killbill/killbill/blob/0a46fd0c9f8f020c930bf62143bcc9edc4f0a712/LICENSE)

但 Kill Bill 的 `entitlement` 指订阅创建、变更、取消等生命周期，不等于本项目的模型/模态/数据政策/SupplyPool 权限。官方 usage 教程也是按 subscription 记录日期与数量，周期末开票；高量场景甚至建议先由外部 metering 聚合。[Usage Billing](https://docs.killbill.io/latest/consumable_in_arrear.html)

为了用它完成 D-063，需要创建 billing catalog、subscription、custom field/tag/plugin，再另外保留 Core 的任务 reservation、账号临时 restrict、ProviderCost 与路由约束。最终不是减少代码，而是多维护 JVM/Tomcat、数据库、Kaui 和映射层。因此不进入短名单。

### 4. Unkey：API Key 控制面，不是产品套餐内核

Unkey 能在一次 key verification 中完成 key 状态、permissions/roles、credits 和多个 rate limit 检查，适合按 key 销售公开 API。[Verify API key](https://www.unkey.com/docs/api-reference/keys/verify-api-key) 官方也明确说明分布式限流优先低延迟和可用性，多区域突发可能短暂越过限制，再异步收敛。[限流一致性设计](https://github.com/unkeyed/unkey/blob/d9f8f47c2693fe8354721c2637dbb3c9e36f44fa/docs/engineering/architecture/ratelimiting/overview.mdx)

当前产品用户通过登录身份进入 workspace，并不持有对外 API key。若强行接入，需要为每个 workspace/key 同步套餐、覆盖、credit refill、撤销和轮换；同时 verify 的 credits 消耗没有业务 `reservationId` 或幂等键，无法表达图片/视频的 submit/poll/失败退款。Unkey 也没有完整 invoice engine。

许可证主体为 AGPL-3.0，`packages/` 另按各包许可证；仓库 README 说可 self-host，但当前产品文档把多区域运行描述为其托管服务，未提供可直接映射到现有 Cloudflare + Postgres 的轻量生产拓扑。[LICENSE](https://github.com/unkeyed/unkey/blob/d9f8f47c2693fe8354721c2637dbb3c9e36f44fa/LICENSE) · [README](https://github.com/unkeyed/unkey/blob/d9f8f47c2693fe8354721c2637dbb3c9e36f44fa/README.md) · [产品概览](https://www.unkey.com/docs/introduction)

结论：如果未来提供面向开发者的 API 产品，Unkey 可在一个独立 POC 中管理**客户 API key 和边缘防滥用**；即使届时采用，key credits 也只是执行门禁缓存，不是套餐、ProductUsage 或供应成本总账。

### 5. Flexprice：功能最全、重叠也最大，先观察

Flexprice 官方将 metering、credits、pricing、billing、feature limits 和 invoices 放在同一开源平台，支持 `event_id` 作为事件幂等键，表面覆盖面最完整。[README](https://github.com/flexprice/flexprice/blob/67df3d841e8d9ae0d33c6ab91e42523277adf7ca/README.md) · [event_id 合同](https://github.com/flexprice/flexprice/blob/67df3d841e8d9ae0d33c6ab91e42523277adf7ca/internal/api/dto/events.go#L26-L32)

但它 2024 年才创建，采用 AGPL open-core，仓库明确 `ee` 与 `internal/ee` 由商业许可覆盖；其 entitlement 设计材料还把 grants、rollover列为后续阶段，不能仅凭 README 宣称全部满足 D-063。[LICENSE](https://github.com/flexprice/flexprice/blob/67df3d841e8d9ae0d33c6ab91e42523277adf7ca/LICENSE) · [Entitlement 设计](https://github.com/flexprice/flexprice/blob/67df3d841e8d9ae0d33c6ab91e42523277adf7ca/docs/prds/entitlements-design.md)

本地 compose 同时包含 Postgres、Kafka、ClickHouse、Temporal、API、consumer 和 worker。[docker-compose.yml](https://github.com/flexprice/flexprice/blob/67df3d841e8d9ae0d33c6ab91e42523277adf7ca/docker-compose.yml) 这会把现有 Postgres/DBOS 任务内核旁边再放一套事件与工作流平台。除非未来决定整体迁移商业化内核，否则 P0 没有合理的局部切入点。

## P0 目标边界

```text
Admin publishes EntitlementPolicy / AccountAllocation revisions
                         |
                         v
Core resolves EffectiveEntitlement --------> queue concurrency / rate gate
                         |
                         v
ProductUsageLedger reserve -> commit/refund/expire/compensate
                         |
             outbox committed events only
                         |
                         +----> optional shadow meter / future invoice sidecar

ProviderAttempt -> ProviderCostLedger estimated/observed/reconciled
                         |
                         +----> supplier reconciliation only
```

硬边界：

- 外部 meter/biller 可以消费 committed usage，但不得决定一次真实生成是否可接单。
- 外部 key/rate service 可以做边缘防滥用，但 Core 必须重新计算 workspace EffectiveEntitlement。
- ProviderCost 只从 RouteSnapshot、attempt、provider usage/账单和价格 revision 形成，不把 OpenMeter/Lago/Flexprice 的产品报价或 wallet 当供应成本。
- `reserve` 不外发为 billable usage；只有终态 `commit` 或清晰的补偿/调整事件进入商业投影，避免异步图片/视频失败被开票。
- Cloudflare 只承载边缘接入、缓存/防滥用和到 Core 的可信身份；以上候选都应作为独立 origin service，不能假设能部署成 Worker 内库。

## P0 开发建议

| 工作项 | 复用来源 | 实施方式 | 完成判据 |
| --- | --- | --- | --- |
| EntitlementPolicy v2 | OpenMeter entitlement 类型 + Lago plan/override 展示 | 在现有 Core 增加 CatalogModel、质量档、SupplyPool、速率、有效期与 revision | 能解释套餐默认、账号 grant/restrict、硬限制和到期回退 |
| AccountAllocation | Lago subscription override 仅作 UX 参考 | 自有 append-only revision/event；不复制可变余额 | 所有覆盖有来源、原因、起止、审批、撤销与影响预览 |
| 用量事件合同 | OpenMeter CloudEvents + Lago deterministic transaction ID | `source=core`，ID 从 workspace/job/reservation/action 派生；通过 outbox 发布 | 重放不重复扣额，commit/refund 互斥，三模态均覆盖 |
| 并发与速率 | Unkey 的限流取舍仅作参考 | 并发继续由 durable job port 按 entitlement 注入；速率在 Core/边缘分层，Core 为最终门禁 | 多实例不越 workspace 硬限制；边缘短暂误差不改变产品账 |
| 外部计量 POC | OpenMeter | P1 单向 shadow，不阻塞用户请求，不回写授权 | 连续窗口与 Core committed usage 对账，删除 POC 不影响产品 |
| 发票/财务 | Lago/OpenMeter/Flexprice | 本轮不做；由后续商业需求触发独立 ADR | 未引入额外 billing 运行栈 |

## 最终排序

1. **现有 Core + 选择性复用设计：P0 唯一推荐。**
2. **OpenMeter：P1 shadow metering 首选。** 许可证友好、事件与 entitlement 设计契合，但版本仍 beta、生产拓扑重，不能先替换真相。
3. **Lago：未来发票 sidecar 首选。** 只在复杂商业计费成为明确需求后评估。
4. **Unkey：未来公开 API Key 专项候选。** 不用于当前账号权益。
5. **Flexprice：观察。** 功能面诱人，但年轻、重栈、AGPL open-core 和真相重叠过大。
6. **Kill Bill：排除。** 成熟但问题域、部署重量与当前 P0 不匹配。

## 采用外部组件前的硬门禁

任何后续 POC 想从“参考”升级为“依赖”，必须同时证明：

1. 逐项列出 OSS/商业功能与许可证义务，法务确认通过；
2. 支持确定性 event ID、重放、乱序、晚到事件和至少 30 天去重窗口；
3. 不破坏 reserve/commit/refund/compensate 与图片/视频接受态；
4. 故障时 Core 可以 fail closed 或继续使用本地权威投影，不把外部网络抖动变成全站不可生成；
5. 提供双写、回填、差异对账、回滚和删除组件的完整迁移演练；
6. 明确 workspace/customer/tenant 映射与数据删除边界；
7. 不读取外部 wallet、credits、invoice 或 gateway 倍率作为 ProviderCost；
8. 证明独立运行栈的监控、备份、恢复、升级和 Cloudflare origin 安全成本可接受。

## 官方来源与快照

- OpenMeter： [仓库](https://github.com/openmeterio/openmeter) · [快照提交 3885445](https://github.com/openmeterio/openmeter/commit/3885445fd4bff65910c56fceea45e352c8ba341d) · [v1.0.0-beta.231](https://github.com/openmeterio/openmeter/releases/tag/v1.0.0-beta.231)
- Lago： [仓库](https://github.com/getlago/lago) · [快照提交 f91a4ca](https://github.com/getlago/lago/commit/f91a4ca52f1482d46062080f38b221731e1e6cae) · [v1.50.0](https://github.com/getlago/lago/releases/tag/v1.50.0)
- Kill Bill： [仓库](https://github.com/killbill/killbill) · [快照提交 0a46fd0](https://github.com/killbill/killbill/commit/0a46fd0c9f8f020c930bf62143bcc9edc4f0a712) · [0.24.19](https://github.com/killbill/killbill/releases/tag/killbill-0.24.19)
- Unkey： [仓库](https://github.com/unkeyed/unkey) · [快照提交 d9f8f47](https://github.com/unkeyed/unkey/commit/d9f8f47c2693fe8354721c2637dbb3c9e36f44fa)
- Flexprice： [仓库](https://github.com/flexprice/flexprice) · [快照提交 67df3d8](https://github.com/flexprice/flexprice/commit/67df3d841e8d9ae0d33c6ab91e42523277adf7ca) · [v2.1.21](https://github.com/flexprice/flexprice/releases/tag/v2.1.21)
