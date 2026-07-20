# 多渠道模型供应管理开源选型比选

> 日期：2026-07-19
> 范围：D-058～D-071 已确认的多渠道供应控制面，首轮同时覆盖文本、图片、视频；推荐组合已于 2026-07-20 被接受为 D-071。

## Accepted selection

正式采用 **自有 Product Core 控制面 + 分层局部复用**，不整体引入一套外部 AI Gateway、New API/Sub2API 分支或低代码后台作为产品中枢。

- Product Core 继续唯一持有 CatalogModel、真实供应商、渠道、Deployment、RoutePolicy、CredentialAccount 元数据、RouteSnapshot、接受态、媒体生命周期、用户权益、产品用量与供应成本账本。
- 执行层以官方/第三方原生 adapter 为生产基线；Bifrost 只保留固定 Deployment、零自动 retry/fallback 的隔离 PoC，LiteLLM 作为 Provider 适配与价格目录的对照参考。
- “模型供应与网关控制中心”是统一后台可视化的核心能力模块，不是独立技术后台；管理界面继续使用现有 TanStack Start/Router/Query/Table + shadcn/Radix + Recharts，不再引入第二套应用壳。外部 Console 与低代码平台只供交互参考或技术下钻，Directus 等不得绕过 Core 直接修改业务表。
- 首轮保留现有 ProductUsageLedger、ProviderCostLedger、套餐权益与 SecretStore/AWS Secrets Manager；计量、授权和 Secret 平台只有满足明确触发条件后再引入。
- 观测采用 OpenTelemetry 语义和外部 Grafana/Cloudflare 技术下钻，但遥测系统不成为供应商成本、路由或业务状态真相。

这不是“全部自研”。自研只集中在本产品特有、且外部组件无法安全替代的控制面语义；协议适配、表格/图表、Secret 存储和遥测尽量复用成熟组件。

## Selection constraints

候选必须接受以下已确认边界；不能接受时只能降级为 Reference 或 Reject：

1. 首轮不是文本 PoC，必须同时打通文本生成、图片生成、视频生成，三项核心 operation 各有两条独立 `live_verified` Deployment。
2. 图片/视频必须覆盖 submit、provider task ID、acceptance、recover/query、poll/callback、cancel、download、自有资产持久化、URL TTL、排空、晚到终态、幂等和成本结算。
3. Product Core 是跨 Deployment 路由与重试的唯一所有者；上游只有明确 `rejected_before_accept` 才能切换，`accepted` 或 `acceptance_unknown` 不盲目重投。
4. 用户选择内部 CatalogModel，不感知实际官方或第三方渠道；套餐默认与有期限账号覆盖决定 entitlement，不能把网关 virtual key 当产品账号真相。
5. 官方直连和真实第三方供应商由同一控制面管理；New API/Sub2API 只是上游技术指纹，不是我方拟部署的一等 Provider。
6. HTTP 与 Worker 读取同一已发布 revision；新增、隔离、排空、轮换与停用不得依赖进程重启。

## Architecture-level comparison

| 方案 | 领域匹配 | 三模态与媒体生命周期 | 与现有代码/Cloudflare 匹配 | 主要代价 | 结论 |
| --- | --- | --- | --- | --- | --- |
| **A. 自有 Core + 分层复用** | 高；保留现有领域对象与证据链 | 高；原生 adapter 和 DBOS workflow 可实现完整合同 | 高；复用现有 TypeScript/Postgres/TanStack/Worker 边界 | 需要自行完成动态注册、热装配和供应商 conformance | **Recommend** |
| **B. Bifrost/LiteLLM 为中心** | 中；Provider 适配丰富，但会复制路由、预算、Key 和组织模型 | 中低；端点覆盖不等于统一异步媒体接受态/恢复合同 | 中；新增常驻网关及其数据库/缓存/升级面 | 双重真相、双重重试、版本与 Enterprise 边界 | **只做隔离数据面 PoC/参考** |
| **C. New API/Sub2API 二次开发** | 低；产品目标偏中转售卖、Token/账号池与内部计费 | 低到中；上游实现不能替代我方媒体任务和证据合同 | 低；我方并不计划自建这两套框架 | 错误的交易方模型、重复用户/额度/路由、许可证与升级分叉 | **不采用；只登记指纹并借鉴交互** |
| **D. APISIX/Higress/Envoy/Kong AI Gateway** | 低到中；擅长入口、协议、限流和网络路由，不是产品控制面 | 低；普遍缺少完整视频任务、接受态、资产与双账本 | 低；多为容器/Kubernetes/Redis/Postgres，与 Workers-native 部署不一致 | 新增集群和第二运维面，部分关键 AI 能力在商业版 | **当前排除为中枢；仅参考/条件 PoC** |
| **E. Low-code/admin platform 为中心** | 低；能快速 CRUD，难表达 candidate→eval→approve→publish→rollback | 不负责运行时与媒体副作用 | 中低；另起认证、路由、权限与设计系统 | 绕过 Core、审计/CAS 断裂、双应用体验 | **不作为产品后台** |

## Layered candidate comparison

| 层 | 首选 | 可局部验证/未来候选 | 仅参考或排除 |
| --- | --- | --- | --- |
| 产品供应控制面 | **现有 Product Core + Postgres/DBOS** | 无整套替代；按领域缺口增量开发 | New API、Sub2API 只作上游指纹与 UX 参考 |
| Provider 数据面 | **官方/第三方原生 adapter** | **Bifrost 隔离 PoC**；LiteLLM 作为适配对照；Higress 仅在接受新增 K8s 运行面后做三模态条件 PoC | Portkey 暂缓；Helicone 不作战略网关；通用/K8s AI Gateway 不作中枢 |
| 管理 UI | **现有 TanStack + shadcn/Radix + TanStack Table + Recharts** | ECharts 只在高密度数据证明需要时；React Flow 只做延后只读拓扑 | Refine/react-admin 借交互；Appsmith/ToolJet 最多做可丢弃的隔离只读原型；Directus 不部署、不直写业务库；Backstage 排除 |
| 计量与权益 | **现有双账本 + 套餐/账号 entitlement** | OpenMeter 只在外部事件计量/商业化复杂度触发后做投影 PoC | Lago/Kill Bill 留到收费运营专项；Unkey 不替代产品权益或供应凭据 |
| 权限与数据策略 | **Core 内类型化、版本化、deny-by-default policy** | OpenFGA 仅在跨工作区共享/委派关系复杂化后；OPA/Cedar 做表达能力 spike | Casbin 只在简单 RBAC 显著膨胀时评估，不为首轮新增真相源 |
| Secret 管理 | **现有 SecretStore + AWS Secrets Manager；Worker Secret 只放 Worker 自身密钥** | OpenBao 在云中立/自托管成为硬要求后 spike | Infisical 参考轮换 UI；首轮不新增第二套 Secret 平台 |
| 可观测性 | **OTel 语义 + Core 业务投影 + 外部 Grafana/Cloudflare 下钻** | Bifrost/LiteLLM 指标仅作 transport telemetry | 不让网关/Grafana/Cloudflare 反向成为路由、成本或审计真相 |

## Why no full platform qualifies

通用网关把“模型调用”看作一次 HTTP/LLM 请求；本产品把它看作一个受套餐、数据等级、供应合同、冻结 revision 和可恢复副作用约束的任务。二者最明显的断层在视频：创建任务成功不等于结果成功，必须能证明是否受理、恢复长任务、处理凭据排空和晚到终态，并把结果转存为自有资产后再结算。

因此外部网关可以减少某个固定 Deployment 的协议适配成本，但不得：

- 在 Core 不知情时换模型、换交易方、换 Key 或重提任务；
- 用 virtual key/budget 取代平台注册用户、套餐、账号覆盖和账本；
- 用自己的 provider price map 取代合同价格 revision 与最终对账；
- 用网关日志推断接受态或覆盖不可变 RouteSnapshot；
- 保存用户原始人脸/健康/敏感内容而绕过 D-064 数据策略。

## Recommended first-release stack

1. **Control plane:** 继续扩展 Product Core 的 ProviderProfile、SupplyContract、CredentialAccount、ExecutionChannel、Deployment、SupplyPool、RoutePolicy 和发布 revision。
2. **Execution:** 每个核心 operation 先以原生 adapter 达到双渠道；Bifrost 只选择一个低敏、固定 Deployment 做 conformance PoC，默认 `max_retries=0`、无 fallback、无内容日志。
3. **Media:** 图片/视频统一走现有 MediaProviderLifecyclePort/DBOS durable workflow，不经通用网关伪装成同步请求。
4. **Admin:** 把“模型供应与网关控制中心”作为现有 `/admin` 的核心模块，新增供应商、账号/凭据、Deployment、RoutePolicy、健康/容量/成本、三模态任务和审计下钻；复用现有表格、表单、图表、CAS、影响预览和回滚合同。
5. **Security:** Core 管 CredentialAccount 状态机和绑定；SecretStore 只保存不可回显值及版本。生产继续 AWS Secrets Manager，本地继续现有加密存储。
6. **Metering:** ProductUsageLedger 与 ProviderCostLedger 继续双轨；上游余额/倍率/账单只作为对账输入，不和用户额度混成一个余额。
7. **Observability:** 统一 correlation ID、脱敏 OTel traces/logs 和业务状态投影；技术人员再下钻 Grafana/Cloudflare/供应商控制台。

## Core admin module and quick actions

该模块面向平台运营与受信管理员，统一展示并操作所有官方直连、第三方中转和可选网关渠道。首轮至少包含：

- 三模态 readiness 与核心 CatalogModel 双渠道覆盖总览；
- Provider → Contract → CredentialAccount → Channel → Deployment → CatalogModel 的关系与反向影响查询；
- SupplyPool/RoutePolicy candidate、模拟、评估、生效 revision、数据等级和账号权益影响；
- 健康、容量、余额、限额、供应成本、任务接受态、图片/视频异步生命周期和自有资产状态；
- 连通/conformance 探针、发布/回滚、隔离/恢复、停止新任务、排空、凭据轮换/撤销前检查和证据刷新等快捷动作。

快捷操作不是直接调用外部网关 Admin API。UI 必须调用 Product Core 的类型化命令，并统一执行权限、影响预览、原因、CAS/幂等、可逆或排空语义和不可变审计。外部 Higress/Bifrost/Cloudflare/供应商控制台只作为带上下文的技术深链；它们不拥有产品状态，也不能绕过 D-053 的 Cloudflare 只读边界。

## Adoption gates

### Bifrost isolated PoC

只有同时满足以下门槛，才能从 Reference 升级为某个 Deployment 的生产数据面：

- 固定 model/endpoint/credential version，跨 Deployment retry/fallback 全部关闭；
- HTTP/Worker 与 direct adapter 的协议、流式、错误分类、usage 和 correlation conformance 通过；
- 关闭 prompt/response 内容日志，验证滚动升级、超时、断连、过载和回滚；
- 能返回足够的 upstream request evidence，不遮蔽 `rejected_before_accept/accepted/acceptance_unknown`；
- direct adapter 始终保留为对照与可删除回退路径。

### Future component triggers

- **OpenMeter:** 当计量事件来源明显超出模型生成，且现有 ledger 无法支持可审计聚合/外部 billing export 时再评估；只读投影先于迁移真相。
- **OpenFGA:** 当出现多管理员角色、跨工作区共享、委派支持或对象级授权，现有 role check 难以可靠表达时再评估。
- **OpenBao:** 当云中立、自托管或动态基础设施凭据成为合同硬要求，且团队能承担 HA、seal、备份与审计运维时再评估。
- **ECharts/React Flow:** 分别只由已记录的 Recharts 性能失败或表格无法回答的真实拓扑诊断任务触发。

## Accepted decision

2026-07-20 已确认为 D-071：**多渠道模型供应管理采用“自有 Product Core 控制面 + 分层局部复用”，不整体采用通用 AI Gateway、New API/Sub2API 分支或低代码后台；外部组件必须服从固定 Deployment、单一真相和可删除边界。**

本结论锁定组件采用边界，不表示外部 PoC 已通过或首轮功能已开发完成。

## Research files

- [`../model-provider-management-2026-07-19/gateway-components.md`](../model-provider-management-2026-07-19/gateway-components.md) — Bifrost、LiteLLM、Portkey、Helicone、New API 与 Sub2API 深度事实。
- [`../admin-platform-research-2026-07-19/README.md`](../admin-platform-research-2026-07-19/README.md) — 管理 UI、表格、图表、拓扑与观测组件。
- [`secret-management.md`](./secret-management.md) — AWS Secrets Manager、OpenBao、Infisical 与 Worker Secret 边界。
- [`ai-control-plane.md`](./ai-control-plane.md) — APISIX、Higress、Envoy AI Gateway、Kong 与 Inference Extension 对比。
- [`metering-entitlements.md`](./metering-entitlements.md) — OpenMeter、Lago、Kill Bill、Unkey 与 Flexprice 对比。
- [`policy-rbac.md`](./policy-rbac.md) — OpenFGA、Casbin、OPA 与 Cedar 对比。
- [`admin-ui.md`](./admin-ui.md) — Appsmith、Directus、ToolJet 与现有原生后台对比。
