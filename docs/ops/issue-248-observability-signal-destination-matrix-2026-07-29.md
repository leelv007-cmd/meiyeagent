# Issue #248：信号 × 目的地矩阵

> 状态：#248 零 rebase 面预备；本文只裁定合同，不声明实现已完成。  
> 权威依据：Issue #248、D-169②、`_digest-B.md` 切片 05。  
> 当前实现核对：`apps/core/src/p1/harness/postgres-store.ts`、
> `langfuse-sender.ts`、`outbox-worker.ts`，
> `apps/core/src/p1/model-supply/postgres-repository.ts`，
> `mkfast-template-main/src/lib/product-telemetry.ts`。

## 状态词

- `authoritative`：该目的地保存可审计、可重放的事实；其他目的地不得反向覆盖它。
- `derived`：从权威事实投影、聚合或展示；可重建，不参与业务放行。
- `not routed`：信号有定义，但当前或裁定目标不投递到该目的地。
- `unsupported`：该目的地不应承载此类信号，不能用别的信号类型伪装成支持。

## 矩阵

| 信号 | 目的地 | #248 裁定 | 当前生产状态 | 数据源 | 采样／投递语义 | 消费者 |
|---|---|---|---|---|---|---|
| traces | Langfuse | `derived` | 已由 PG audit/outbox 投影为 trace + span；三轴仍不合约：现有为 `skillRevisionRefs`、嵌套 `prompt`，且缺 `catalogRevision` | PostgreSQL `audit_events` + `decision_traces` | PG 事务提交后由 durable outbox 至少一次投递；稳定 ID 去重；业务执行 trace 不做应用层采样 | 运营按 `skillRevision` / `promptVersion` / `catalogRevision` 任一顶层键过滤、回放与归因 |
| traces | Postgres | `authoritative` | `decision_traces` 与 `audit_events` 已落库，且 audit 与 Langfuse outbox 同事务 | 执行入口上下文与五段 stage trace | 不采样；业务写失败硬停；入口写三轴一次，子 span/trace 显式携带，禁止导出时回查补齐 | 业务审计、重放、对账任务、Langfuse outbox |
| traces | 前台 | `not routed` | 未见 trace 合同直达前台 | 无 | 不投递原始 trace；如需客服锚点，另投影无敏感信息的 support reference，不把它当 trace 真相源 | 无；商家不消费内部 trace |
| logs | Langfuse | `derived` | audit event 当前被降维映射为 span output/metadata，并非 Langfuse 原生日志流 | PostgreSQL `audit_events` | 跟随 trace outbox 至少一次投递；不得以“映射成 span”宣称已具备独立 logs 能力 | 运营在 trace 上查看阶段事件上下文 |
| logs | Postgres | `authoritative` | `audit_events` 已是审计先写的权威日志 | 业务事件、门禁、阶段结果、投递健康事件 | 不采样；幂等 append；审计失败硬停。观测 drop event 直写独立投递健康通道，不进入被丢信号所用的 Langfuse outbox | 审计、恢复、故障排查、定期业务事件↔trace 对账 |
| logs | 前台 | `unsupported` | 前台仅有业务状态/安全文案；浏览器 telemetry 只分发给可选分析 SDK，不是后端审计日志 | 经过脱敏和商家语言转换的业务状态 | 禁止路由原始日志、错误栈、prompt 或内部 ID；只允许显式前台状态合同 | 商家只消费可操作状态，不消费日志 |
| metrics | Langfuse | `derived` | 结构化节点率与产品指标当前被写成 Langfuse score/dataset；不是原生 metrics | PG trace/audit 中的计数事实与产品指标事实 | 从权威事实异步投影；不作为预算门；投递失败可重放，最终失败产生异通道 drop event | 运营趋势、版本对比、评测数据集 |
| metrics | Postgres | `authoritative` | 原始计数/usage/quality 事实分散在 trace、audit、ledger、quality event；聚合视图为派生 | 执行返回 usage、账本事件、队列/outbox 状态、质量事件 | 原始事实不采样、幂等落库；rollup 可重算。维护 `last-success`、`queue-age` 与业务事件↔trace 对账率 | 预算与账本服务只读权威 usage；运营累计视图、投递健康告警、对账任务 |
| metrics | 前台 | `derived` | 已有账户累计 usage 投影；“本次动作实际消耗（含被拒）”尚未路由 | 本次：执行返回值；累计：Postgres usage ledger/projection | 本次值随动作响应同步返回并立即展示；累计值可异步刷新。两者独立取数、用 action/usage event ID 对账，禁止用累计观测反推本次消耗 | 商家本次消耗反馈、账户累计用量页 |
| scores | Langfuse | `derived` | 已将候选择优分、结构化节点率和产品指标投影成 Langfuse scores | PG `decision_traces` / audit payload / eval result | 异步至少一次投递，稳定 score ID 去重；只可用于分析，不反写执行决策 | 运营评测、候选择优解释、版本对比 |
| scores | Postgres | `authoritative` | 候选 score 在 decision trace；质量评测 run/case 有独立 PG 表 | scorer 输出及 scorer revision、被评分 trace/span 引用 | 不采样；与执行/评测记录原子或幂等保存；必须区分“被评分 trace/span”和“评分动作 trace” | 执行择优、评测审计、Langfuse score 投影 |
| scores | 前台 | `unsupported` | 未见内部 score 直达商家前台 | 无 | 不展示内部候选分、阈值或 scorer 调试数据；仅投影商家可理解的结果/门禁原因 | 无；商家评价属于 feedback，不属于 score |
| feedback | Langfuse | `derived` | 当前质量事件未接 Langfuse；#261 新评价事件尚未实现 | PostgreSQL 权威 feedback event | PG 成功后由独立 outbox 投影为 Langfuse score/feedback；不得前台直写 Langfuse；失败产生异通道 drop event | 运营按三轴、场景与 Skill 比较反馈 |
| feedback | Postgres | `authoritative` | 已有间接采用/重做/放弃等 `model_quality_events`；缺 #261 评价按钮的五字段事件 | 商家评价动作；字段至少含 `skillId`、`skillRevision`、场景、`promptName@promptVersion`、`catalogRevision` | 同步、幂等、不可采样；PG 成功才向前台确认“已记录”；与 Langfuse 投递状态解耦 | 质量面板、学习/记忆候选管道、Langfuse 投影、D-126 推荐燃料 |
| feedback | 前台 | `derived` | 评价按钮尚未实现 | 商家点击 + PG 持久化回执 | 点击同步提交；只有持久化成功才显示已记录，失败可重试且不得假成功；前台不是权威存储 | 商家查看自己的提交状态并继续后续动作 |

## 跨格硬约束

1. 每个执行事件与 trace 使用三个**扁平顶层键**：
   `skillRevision`、`promptVersion`、`catalogRevision`。禁止嵌套 `version`
   对象，禁止导出阶段回查补齐；子 span 必须显式继承同一快照。
2. `ObservabilityDropEvent` 最小形状为
   `{ signal, reason: 'permanent-config' | 'transient', count, source }`。
   它写入 PostgreSQL 的独立投递健康通道，**绝不进入造成原信号丢弃的
   Langfuse sender/outbox**。它只证明已知丢弃；完整性还需
   `last-success`、`queue-age` 和业务事件↔trace 定期对账。
3. “本次消耗”以执行返回值为唯一即时数据源，包括被门禁拒绝但已经发生的
   规划/模型消耗；累计观测以 PostgreSQL ledger/projection 为数据源。
   前者同步反馈，后者异步聚合；预算门不得依赖 Langfuse 或累计指标可用性。
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
  后异通道 drop event、恢复后的 `last-success`、三轴过滤和 >1024 中文。
- live/生产证据还必须给出真实部署配置、无敏感信息的 Langfuse 查询截图或
  API 回读、PostgreSQL 对账结果与时间窗口。fixture 通过不能替代 live 证据，
  live 证据也不得复用 fixture 数据冒充真实商家调用。
