# Issue #248：信号 × 目的地矩阵

> 状态：M1／M1.5／M2 主体已进入本地 `main@d807de17`；标成「lane
> candidate」的项目仍只在 `issue/248` 未提交差异中。本文不把候选或已合入
> 切片声明为 #248 整票完成。
> 权威依据：Issue #248、D-169②、`_digest-B.md` 切片 05。  
> 当前实现核对：`packages/contracts/src/observability-event.ts`、
> `apps/core/src/p1/creation-experience/observability-events.ts`、
> `apps/core/src/p1/harness/postgres-store.ts`、`langfuse-sender.ts`、
> `outbox-worker.ts`、`observability-reconciliation.ts`，
> `apps/core/src/p1/model-supply/postgres-repository.ts`，
> `mkfast-template-main/src/p1/observability-event-client.ts`。

## 状态词

- `authoritative`：该目的地保存可审计、可重放的事实；其他目的地不得反向覆盖它。
- `derived`：从权威事实投影、聚合或展示；可重建，不参与业务放行。
- `not routed`：信号有定义，但当前或裁定目标不投递到该目的地。
- `unsupported`：该目的地不应承载此类信号，不能用别的信号类型伪装成支持。

## 矩阵

| 信号 | 目的地 | #248 裁定 | 当前生产状态 | 数据源 | 采样／投递语义 | 消费者 |
|---|---|---|---|---|---|---|
| traces | Langfuse | `derived` | canonical 事件已从 PG audit/outbox 投影为 trace + span，并输出 `skillRevision` / `promptVersion` / `catalogRevision` / `scene` 四个扁平键；primitive lifecycle 只投 execution child，不覆盖 root。Task root write-once 与 bounded/note 生产 emitter 仍等待 #262 的合法单值／absent 快照载体 | PostgreSQL `audit_events` + `decision_traces` | PG 事务提交后由 durable outbox 至少一次投递；稳定 ID 去重；业务执行 trace 不做应用层采样；不得由 stage 后写覆盖 root | 运营按任一扁平轴过滤、回放与归因；真实可过滤性仍需 live Langfuse 证明 |
| traces | Postgres | `authoritative` | canonical event、`decision_traces`、`audit_events` 已落库，audit 与 Langfuse outbox 同事务；primitive lifecycle 已有并发幂等／冲突终态。Task root 四轴尚无 #262 提供的 admission write-once carrier | 执行入口上下文、canonical 事件与五段 stage trace | 不采样；业务写失败硬停；新 Task root 只允许从 server-owned admission 快照写一次，子 span 显式携带天然单值；禁止导出时回查补齐 | 业务审计、重放、对账任务、Langfuse outbox |
| traces | 前台 | `not routed` | 未见 trace 合同直达前台 | 无 | 不投递原始 trace；如需客服锚点，另投影无敏感信息的 support reference，不把它当 trace 真相源 | 无；商家不消费内部 trace |
| logs | Langfuse | `derived` | audit event 当前被降维映射为 span output/metadata，并非 Langfuse 原生日志流 | PostgreSQL `audit_events` | 跟随 trace outbox 至少一次投递；不得以“映射成 span”宣称已具备独立 logs 能力 | 运营在 trace 上查看阶段事件上下文 |
| logs | Postgres | `authoritative` | `audit_events` 已是审计先写的权威日志；dead-letter 与 drop 原子落入独立健康通道 | 业务事件、门禁、阶段结果、投递健康事件 | 不采样；幂等 append；审计失败硬停。观测 drop event 不进入被丢信号所用的 Langfuse outbox，operator discard 不重复计数 | 审计、恢复、故障排查、定期业务事件↔trace 对账 |
| logs | 前台 | `unsupported` | 前台仅有业务状态/安全文案；浏览器 telemetry 只分发给可选分析 SDK，不是后端审计日志 | 经过脱敏和商家语言转换的业务状态 | 禁止路由原始日志、错误栈、prompt 或内部 ID；只允许显式前台状态合同 | 商家只消费可操作状态，不消费日志 |
| metrics | Langfuse | `derived` | 结构化节点率与产品指标当前被写成 Langfuse score/dataset；不是原生 metrics | PG trace/audit 中的计数事实与产品指标事实 | 从权威事实异步投影；不作为预算门；投递失败可重放，最终失败产生异通道 drop event | 运营趋势、版本对比、评测数据集 |
| metrics | Postgres | `authoritative` | `main@d807de17` 已有 drop 汇总、`last-success`、`queue-age` 与 closed-window 对账存储；lane candidate 将 health/drop 接入定时消费者、覆盖全部 canonical 类型，并以 PG authority、一个 interval 的 close grace、完成后 checkpoint 补窗；健康 `last-success` 同样进入结构化生产日志 | 执行返回 usage、账本事件、队列/outbox 状态、质量事件 | 原始事实不采样、幂等落库；rollup 可重算；对账使用显式 cutover，不猜回填历史 NULL；晚到 drop 以自己的 `occurred_at` 窗口进入 detect；completed window 不允许并发实例重算覆盖 | 预算与账本服务只读权威 usage；运营累计视图、投递健康告警、对账任务 |
| metrics | 前台 | `derived` | Core 已从最终 `ProductUsageRecord` 结算投影 `workflow.state.data.actionUsage`，SSE 原链路可读；`rejected` 强制 `settledUnits: 0`。商家可见 UI 属 #261 | 本次：最终执行状态中的 settlement；累计：Postgres usage ledger/projection | 本次值随终态响应同步返回；累计值异步刷新。两者独立取数，禁止用 reservation、ProviderCost、token 或累计观测反推本次消耗 | 商家本次消耗反馈、账户累计用量页 |
| scores | Langfuse | `derived` | 已将候选择优分、结构化节点率和产品指标投影成 Langfuse scores | PG `decision_traces` / audit payload / eval result | 异步至少一次投递，稳定 score ID 去重；只可用于分析，不反写执行决策 | 运营评测、候选择优解释、版本对比 |
| scores | Postgres | `authoritative` | 候选 score 在 decision trace；质量评测 run/case 有独立 PG 表 | scorer 输出及 scorer revision、被评分 trace/span 引用 | 不采样；与执行/评测记录原子或幂等保存；必须区分“被评分 trace/span”和“评分动作 trace” | 执行择优、评测审计、Langfuse score 投影 |
| scores | 前台 | `unsupported` | 未见内部 score 直达商家前台 | 无 | 不展示内部候选分、阈值或 scorer 调试数据；仅投影商家可理解的结果/门禁原因 | 无；商家评价属于 feedback，不属于 score |
| feedback | Langfuse | `derived` | canonical `delivery_rating.recorded` / `delivery_rating.withdrawn` 已走 PG outbox，但当前只投影为带四轴的 trace + span metadata，不是 Langfuse 原生 feedback/score observation；不得前台直写 Langfuse | PostgreSQL 权威 feedback event | PG 成功后异步投影为 trace/span；失败产生异通道 drop event；真实筛选仍需 live Langfuse 证明，不以 signal 分类冒充原生 observation | 运营在 trace/span 上按四轴比较反馈 |
| feedback | Postgres | `authoritative` | canonical rating 已复用认证的 `event_append` 入口；lane candidate 把 public allowlist 收窄为两种 rating。usage/bounded/note/primitive 均为 server-owned，只能走内部 audit port；ActionUsage emitter 仍等 #262 合法轴载体 | 商家评价动作与最终 action usage | 同步、不可采样；PG 成功才确认已记录；append-only 撤回为反向事件、不物理删除；rating 四轴必须在 #262 carrier 后由 Core hydrate/校验，不能长期信任浏览器 | 质量面板、detect 档聚合、Langfuse 投影、D-126 推荐燃料 |
| feedback | 前台 | `derived` | lane candidate 已把 web client 类型收窄为 rating union；评价按钮、服务端归因校验、回执可见性与交互验收仍属 #261/#262 接缝 | 商家点击 + PG 持久化回执 | 浏览器只提交评价事实与服务端结果引用；只有 Core 绑定权威四轴并持久化成功才显示已记录；前台不是权威存储 | 商家查看自己的提交状态并继续后续动作 |

## 跨格硬约束

1. 每个执行事件与 trace 使用四个**扁平顶层键**：
   `skillRevision`、`promptVersion`、`catalogRevision`、`scene`。禁止嵌套
   `version` 对象，禁止导出阶段回查补齐。root 取 Task admission 快照的
   单一绑定并 write-once；零绑定为显式 absent，多绑定不得挑第一项、
   join、hash 或拿 recipe 冒充 Skill。child span 只携带实际执行单元的
   天然单值。
2. `ObservabilityDropEvent` 最小形状为
   `{ signal, reason: 'permanent-config' | 'transient', count, source }`。
   它写入 PostgreSQL 的独立投递健康通道，**绝不进入造成原信号丢弃的
   Langfuse sender/outbox**。它只证明已知丢弃；完整性还需
   `last-success`、`queue-age` 和业务事件↔trace 定期对账。
3. “本次消耗”以最终 `ProductUsageRecord` settlement 为唯一即时数据源；
   `rejected` 必须显式为 `settledUnits: 0`。拒绝前已经发生的规划／模型成本
   只进内部 ProviderCost，不进入商户 ActionUsage，也不得向公共边界暴露
   token、provider、model、currency 或 cost。累计观测以 PostgreSQL
   ledger/projection 为数据源；预算门不得依赖 Langfuse 或累计指标可用性。
4. Langfuse 是可重建的观测投影，不是业务、账本、反馈或审计真相源。
   Langfuse 失败不得回滚已提交业务事实，但必须进入重试、dead-letter 与
   异通道 drop event；PostgreSQL 权威写失败则 fail closed。
5. 当前生产发送器直接调用 Langfuse HTTP ingestion，没有使用带
   `serializationOptions` 的 Mastra/Langfuse SDK，不能虚构一个不存在的
   SDK 配置项。必须先核对真实发送链；若未来引入含字符串 1024、深度 6、
   数组 50、键 50 默认限制的序列化层，则显式提高或取消限制。“全量入
   Langfuse”最终只能由 >1024 中文实投与 Langfuse API 回读全文/hash 证明。

## 证据边界

- fixture/单测只可证明 schema、扁平键、稳定 ID、路由选择、重试和前台回执
  分支；不得证明真实 PostgreSQL 事务、Langfuse 可过滤性或长中文未截断。
- 本地真实 PostgreSQL + 自托管 Langfuse 可证明事务/outbox、断 Langfuse
  后异通道 drop event、恢复后的 `last-success`、四轴过滤和 >1024 中文。
- live/生产证据还必须给出真实部署配置、无敏感信息的 Langfuse 查询截图或
  API 回读、PostgreSQL 对账结果与时间窗口。fixture 通过不能替代 live 证据，
  live 证据也不得复用 fixture 数据冒充真实商家调用。
