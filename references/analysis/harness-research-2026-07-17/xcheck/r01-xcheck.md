哥，# DBOS Transact 技术调研对抗性交叉验证报告

验证对象：[01-dbos-transact.md](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/analysis/harness-research-2026-07-17/01-dbos-transact.md)

验证基准：本地镜像 HEAD `1d02f23a47bfa008e6d0e0c17e607d6b27e5e307`，线上数据查询于 2026-07-17。共判定 20 条：**12 条属实、3 条有误、4 条不完整、1 条线上未核实。**

## 判定汇总表

| # | 可证伪断言 | 判定 | 核验结论 |
|---:|---|:---:|---|
| 1 | 候选包 npm latest=`4.23.6`、Node `>=20` | ✅ | 对 scoped 包 `@dbos-inc/dbos-sdk` 属实 |
| 2 | 许可证为 MIT | ✅ | LICENSE 与 npm 元数据一致 |
| 3 | GitHub 约 1280 stars、83 forks、近期仍推送 | ✅ | 2026-07-17 API 数值吻合 |
| 4 | open issues≈7 | ❌ | API 的 7 是 **4 个 issue + 3 个 PR**；真正 open issues 为 4 |
| 5 | checkpoint 落 PostgreSQL，默认独立 schema `dbos` | ✅ | workflow、operation、event、stream、queue 等均在系统 schema |
| 6 | `DBOS.launch()` 自动恢复中断 workflow | ✅ | 属实，但只恢复 executor ID 与 application version 均匹配的 `PENDING` |
| 7 | `recv/getEvent/sleep` 可长时间等待并跨崩溃续等 | ✅ | deadline、消息和结果均持久化；`setEvent` 是持久发布而不是等待 |
| 8 | `cancelWorkflow/resumeWorkflow/forkWorkflow(id, step)` 存在 | ✅ | API 存在；fork 的 `step` 是 `functionID`，不是业务阶段序号 |
| 9 | `application_version` 等于 workflow 源码 MD5 | ⚠️ | 还混入 DBOS SDK 版本；可由配置或 `DBOS__APPVERSION` 覆盖 |
| 10 | 自动恢复/出队按 application version 隔离 | ✅ | 恢复严格匹配；最新版进程还可领取 version=NULL 的外部入队任务 |
| 11 | 队列具备全局/进程并发、限流、优先级、去重、分区、去抖 | ✅ | 各能力确实存在，但去重是 enqueue 选项，去抖是独立 `Debouncer` API |
| 12 | 上述队列能力可自由组合 | ⚠️ | 分区与去重互斥；去抖不能与优先级或分区组合；分区后 flow control 按分区生效 |
| 13 | Streams 基于 LISTEN/NOTIFY，写入不会重复 | ⚠️ | executor reader 是 NOTIFY+轮询；`DBOSClient` 只轮询；step 内写流会按重试次数重复 |
| 14 | `DBOSClient` 可从外部进程 enqueue、send、读流、fork | ✅ | API 与官方文档均确认 |
| 15 | Drizzle datasource 可复用现有 `pg.Pool` 且不关闭 | ✅ | 属实，但接收的是 `pg.Pool`，不是任意现成 Drizzle DB handle |
| 16 | DBOS system database 可无副作用地共用应用 `pg.Pool` | ⚠️ | 能传池，但 `DBOS.shutdown()` 会调用该池的 `end()`，存在所有权问题 |
| 17 | Conductor 纯可选，自托管 durability 不依赖它 | ✅ | 只有显式传 key 或 Cloud 环境才连接 |
| 18 | workflow/普通 step 保证副作用 exactly-once、不重复 | ❌ | 普通 step 明确是 **at-least-once**；事务 datasource 才能原子保证数据库写 |
| 19 | DBOS Queues 是 pg-boss 超集，可直接替代 | ❌ | 两者能力重叠但语义/API/运维能力不等价；DBOS 还明确不支持手动 fetch |
| 20 | 国内主流托管 PG 普遍无需额外验证即可迁入 | ❓ | 未指定具体产品、内核、权限及 pooler 模式，无法泛化确认 |

## 逐条展开

### 1. npm latest 与 Node 要求：✅

实际候选包是 `@dbos-inc/dbos-sdk`。其 [package.json](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/dbos-transact-ts/package.json:2) 声明 Node `>=20`，scoped [npm latest 元数据](https://registry.npmjs.org/@dbos-inc%2Fdbos-sdk/latest) 返回：

- version：`4.23.6`
- engines.node：`>=20`
- license：`MIT`

但要求中给出的未 scoped URL [registry.npmjs.org/dbos/latest](https://registry.npmjs.org/dbos/latest) 指向另一个无关包 `dbos@1.0.0`，许可证 ISC、无 engines。该 URL不能用于验证本候选包。

### 2. MIT：✅

本地 [LICENSE](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/dbos-transact-ts/LICENSE:1) 为标准 MIT，Copyright 2023 DBOS, Inc.，与 npm、GitHub 元数据一致。

### 3. stars、forks、活跃度：✅

[GitHub repo API](https://api.github.com/repos/dbos-inc/dbos-transact-ts) 返回：

- stars：1280
- forks：83
- subscribers：6
- pushed_at：`2026-07-17T00:02:03Z`

本地 HEAD 的提交时间为 2026-07-16 美国西部时间，提交标题 `Optimize Streams and Events (#1309)`，与报告吻合。npm 4.12–4.23 的发布时间也支持“近期高频发布”。

不过【推断】“活跃”成立；“维护良好”不能由发布频率和少量 issue 单独证明。

### 4. open issues=7：❌

GitHub 仓库字段 `open_issues_count=7` 会把 PR 也计算进去。逐项读取 [open issues API](https://api.github.com/repos/dbos-inc/dbos-transact-ts/issues?state=open&per_page=100) 后实际是：

- 普通 issue：4
- open PR：3
- 合计：7

因此报告多次使用的“open issues 仅 7”不准确，正确表述应为“open issue/PR 合计 7，其中 issue 4”。也不应把这个数字直接当作维护质量证据。

### 5. PostgreSQL checkpoint 与 `dbos` schema：✅

默认 schema 确为 `dbos`，[配置转换](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/dbos-transact-ts/src/config.ts:177) 设置 `systemDatabaseSchemaName ?? 'dbos'`。

系统迁移创建 `workflow_status`、`operation_outputs`、`notifications`、`workflow_events`、`streams`、队列表等，见 [migrations.ts](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/dbos-transact-ts/src/sysdb_migrations/internal/migrations.ts:12)。

默认不传 URL 时数据库名为 `<appname>_dbos_sys`；如果显式把 URL 指向业务数据库，则仍是同库不同 schema。因此“独立 schema”成立，“一定是独立数据库”则不成立，报告对此基本区分正确。

### 6. `launch()` 自动恢复：✅，但有严格条件

`executor.init()` 在初始化末尾调用恢复，见 [dbos-executor.ts](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/dbos-transact-ts/src/dbos-executor.ts:390)。

恢复查询严格要求：

```sql
WHERE status='PENDING'
  AND executor_id=?
  AND application_version=?
```

证据见 [system_database.ts](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/dbos-transact-ts/src/system_database.ts:1123)。

所以“启动自动恢复”属实，但不是任意新进程接管任意旧 workflow。自托管多进程部署还必须确保 executor ID 策略正确；旧应用版本也需要保留 worker 排空。

### 7. 长时间等待与跨崩溃续等：✅

`DBOS.sleep` 将绝对唤醒时间记录为 operation result；恢复后读取原 deadline，不重新起算，见 [system_database.ts](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/dbos-transact-ts/src/system_database.ts:4443)。

`recv` 同样持久化超时 deadline，消息存入 `notifications` 并事务性标记 consumed。官方 README 明确称可等待数天或数周并穿越重启，见 [README.md](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/dbos-transact-ts/README.md:206)。

边界：

- `recv`：workflow 内持久等待消息。
- `getEvent`：workflow 内调用时，其等待结果与 timeout checkpoint 化；外部调用只是普通轮询等待。
- `setEvent`：持久发布/更新值，本身不是“挂起”原语。
- 等待期间不长期占有 PG 连接，但活进程里仍有 async frame，并周期轮询数据库。

### 8. cancel/resume/fork：✅

三个 API 均存在，见 [dbos.ts](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/dbos-transact-ts/src/dbos.ts:1027)。

重要修正：

- cancel 不会强杀正在运行的任意 JS/外部 API 调用，而是在后续 DBOS 边界检查中中断。
- `startStep` 必须是 `listWorkflowSteps()` 返回的 `functionID`。
- `writeStream`、`sleep`、`recv` 等也消耗 function ID，不能把业务“第③段”简单等同于数字 `3`。

因此报告骨架里的 `forkWorkflow(taskId, 3)` 只有在实际步骤历史确认 ID=3 时才正确。

### 9. application version 算法：⚠️

源码确实：

1. 取所有注册 workflow 的 `origFunction.toString()`；
2. 排序；
3. 加入当前 DBOS SDK 版本；
4. 计算 MD5。

见 [computeAppVersion](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/dbos-transact-ts/src/dbos-executor.ts:1467)。

所以“workflow 源码 MD5”是简写，不是完整等式。即使应用 workflow 源码未变，升级 DBOS SDK 也会改变 hash。还可通过配置 `applicationVersion` 或环境变量 `DBOS__APPVERSION` 覆盖。

### 10. 版本匹配恢复：✅

普通恢复、重新入队均要求精确匹配当前 application version。队列出队还有例外：被登记为“最新版”的进程可以领取 `application_version IS NULL` 的外部 client 任务，见 [system_database.ts](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/dbos-transact-ts/src/system_database.ts:3121)。

官方升级指南明确建议蓝绿发布并保留旧版本进程排空旧任务，[Upgrading Workflow Code](https://docs.dbos.dev/typescript/tutorials/upgrading-workflows)。

报告提出“版本变化会让旧任务滞留，需要旧 worker、钉版本或 fork”的推断链合理。

### 11. 队列能力存在：✅

[QueueParameters](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/dbos-transact-ts/src/wfqueue.ts:41) 直接支持：

- `concurrency`
- `workerConcurrency`
- `rateLimit`
- `priorityEnabled`
- `partitionQueue`

去重通过 enqueue 的 `deduplicationID`；去抖通过独立 `Debouncer`/`DebouncerClient`。因此能力清单本身基本属实。

但报告代码仍使用 `new WorkflowQueue(...)`。当前[官方队列参考](https://docs.dbos.dev/typescript/reference/queues)已将其列为 deprecated legacy API，推荐在 `DBOS.launch()` 后使用 `DBOS.registerQueue()`。

### 12. 队列能力组合：⚠️

报告把功能并排列出，容易让读者认为可在一条队列上自由叠加。源码存在明确限制：

- 分区队列不能使用 deduplication ID，见 [dbos.ts](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/dbos-transact-ts/src/dbos.ts:1814)。
- Debouncer 不能再配 priority、partition key 或额外 dedup ID，见 [debouncer.ts](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/dbos-transact-ts/src/debouncer.ts:53)。
- 分区队列的 concurrency/rate flow control 按每个 partition 生效；若同时需要全局 provider 限流与每客户串行，官方建议两层队列，[Queues & Concurrency](https://docs.dbos.dev/typescript/tutorials/queue-tutorial#partitioning-queues)。

这直接影响“全局视频供应商限流 + 按客户隔离/去重”的设计，不能用报告中的单队列功能表直接得出“够用且更强”。

### 13. Streams：⚠️

成立部分：

- 流数据持久化在 `streams` 表。
- executor 内的 `DBOS.readStream` 使用 LISTEN/NOTIFY 唤醒并以 1 秒轮询兜底。
- workflow 主体中的 `writeStream` checkpoint 化。

错误或遗漏部分：

- `DBOSClient` 构造时明确禁用 notification listener；其 `readStream` **始终靠轮询**，见 [client.ts](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/dbos-transact-ts/src/client.ts:679)。
- step 内调用 `writeStream` 不具备相同的去重保证。官方测试明确验证 step 重试四次会写出四条流记录，见 [streaming.test.ts](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/dbos-transact-ts/tests/streaming.test.ts:500)。
- HEAD #1309 移除了 stream/event 的逐行 trigger，改为进程内合并 NOTIFY；但 `notifications` 消息 trigger 被保留。报告“这些触发器都移除”写得过宽。

### 14. 外部 `DBOSClient`：✅

[DBOSClient](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/dbos-transact-ts/src/client.ts:217) 可在不运行 executor 的进程中：

- enqueue workflow
- send 消息
- getEvent/readStream
- cancel/resume/fork
- 查询 workflow/step
- 管理队列

官方 [DBOS Client 文档](https://docs.dbos.dev/typescript/reference/client)确认这些接口。

边界是 client 不加载应用 workflow 注册信息，因此 enqueue 参数不做真实 workflow 类型/名称验证；外部 send 若要求 exactly-once，官方建议传 `idempotencyKey`。

### 15. Drizzle datasource 复用 `pg.Pool`：✅

`DrizzleDataSource` 构造函数接受 `PoolConfig | Pool`，见 [drizzle-datasource/index.ts](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/dbos-transact-ts/packages/drizzle-datasource/index.ts:289)。

若传入现成 `Pool`：

- 用该池构建 Drizzle client；
- datasource destroy 时不调用 `pool.end()`；
- 测试验证 DBOS shutdown 后该池仍可用。

因此用户重点断言成立。但准确说法是“复用底层 `pg.Pool`”，不是把一个既有 `NodePgDatabase`/Drizzle handle 直接传入。

### 16. system database 共用连接池：⚠️

`DBOSConfig.systemDatabasePool` 的确接受现成 `pg.Pool`，但 [SystemDatabase.destroy()](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/dbos-transact-ts/src/system_database.ts:778) 无论池是否用户提供，都会执行：

```ts
await this.pool.end();
```

所以它与 Drizzle datasource 的“不接管用户池”语义不同。报告所说“系统表与业务库甚至共用连接池、零重复池”技术上能运行，但必须接受 DBOS 拥有并关闭该池，或另做生命周期隔离。把应用全局池直接传入存在 shutdown 后其他数据库访问失效的风险。

### 17. Conductor 可选：✅

`DBOS.launch()` 只有两种情况会创建 Conductor：

- DBOS Cloud 环境且相关环境变量齐全；
- 自托管显式传入 `conductorKey`。

见 [dbos.ts](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/dbos-transact-ts/src/dbos.ts:417)。

不配置 Conductor 不影响本地 PostgreSQL durability、恢复、队列和流功能。报告这一结论成立。

### 18. 普通 step exactly-once：❌，关键事实翻转

报告称 DBOS 保证“workflow 实例 exactly-once、step 不重复副作用”。这对普通 `runStep` 过强。

源码注释明确写的是：

> checkpoint 在 step 完成后写入，保证 step **at least once**。

见 [dbos.ts](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/dbos-transact-ts/src/dbos.ts:1988)。

如果进程在“外部 API/数据库副作用已成功”与“operation output 已写入系统库”之间崩溃，恢复后 step 会再次执行。官方 [Steps 文档](https://docs.dbos.dev/typescript/tutorials/step-tutorial)也要求 step 不应包含不可持久化、非幂等副作用。

只有以下路径能补足：

- 外部 API 使用 workflow/step 派生的 idempotency key；
- 自己实现幂等/OCC；
- 数据库写放进 datasource transaction，使业务写与 `transaction_completion` 同事务提交。

这对 LLM、视频供应商提交、发消息等调用非常关键，不能只写成“包进 `runStep` 就 exactly-once”。

### 19. “pg-boss 超集、可直接替代”：❌，关键结论不成立

DBOS 队列确实可能替代项目中的部分 pg-boss 用途，但“超集”“直接替代”没有事实支撑：

- DBOS 是 push 型，不支持手动 fetch；其 README 自己承认这一缺口，见 [README.md](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/dbos-transact-ts/README.md:277)。
- pg-boss 官方列出的能力还包括 dead-letter queue/redrive、job retention/storage policies、automatic retry/backoff、pub/sub、manual worker/fetch、事务内建 job、serverless worker 等，[pg-boss 官方仓库](https://github.com/timgit/pg-boss)。
- 两者数据库 schema、job 状态、重试/超时/取消语义和 worker API 均不兼容。
- 报告没有盘点当前项目实际使用的 pg-boss API，也没有迁移既有 queued/active/dead-letter jobs 的方案。

正确结论应是：**DBOS 具备替代资格，但只能在完成现有 pg-boss 使用面映射和迁移 PoC 后，按本项目场景判定替代；不是 drop-in replacement，更不是严格超集。**

### 20. 国内托管 PG 普遍兼容：❓线上未核实

源码要求至少涉及：

- `CREATE SCHEMA`
- `CREATE EXTENSION "uuid-ossp"`
- PL/pgSQL 存储过程
- `gen_random_uuid()`
- LISTEN/NOTIFY，或明确关闭后接受轮询
- 足够的建表、建索引、建函数权限
- 若启用 LISTEN/NOTIFY，不能经过破坏 session affinity 的 transaction-mode pooler

报告没有指定阿里云 RDS、PolarDB、腾讯云的具体产品形态、PG 大版本、内核小版本、账号类型或 pooler 模式。腾讯云官方也明确提示扩展支持随大版本变化，应逐实例检查，[插件创建说明](https://cloud.tencent.com/document/product/409/121744)。

因此“国内 RDS PG 普遍支持”不能作为已经核实的迁移保证。正确验收方式是针对最终 SKU 运行 DBOS migration、LISTEN self-test 和恢复/队列 smoke test。

## 总裁定：动摇

“DBOS 与五段式 Harness 高度契合”作为**候选方向**仍有充分事实基础：PostgreSQL checkpoint、自动恢复、持久等待、版本隔离、队列、进度流、外部 client、Drizzle datasource、可选 Conductor 都真实存在。

但报告的总选型结论被三项关键事实实质性削弱：

1. **普通 step 不是 exactly-once，而是 at-least-once。** 视频提交、LLM 调用、通知等副作用仍需业务幂等设计。
2. **DBOS Queues 不是 pg-boss 超集，也不能据现有证据直接替换。** 功能组合还有限制，现有 job/API/状态迁移完全未分析。
3. **“迁移成本极窄”只对基础设施数量成立。** 应用层还涉及 workflow 重构、幂等、版本排空、旧 job 迁移、池所有权、schema/extension 权限、pooler、bundler 限制。官方还明确要求 DBOS 及 workflow 不得被常规 bundler 打包，并必须在 launch 前完成 workflow 注册，[集成文档](https://docs.dbos.dev/typescript/integrating-dbos)。

因此最终应裁定为：**报告中的核心能力调研多数成立，但“可直接替代 pg-boss、迁移成本极窄”的选型结论动摇。DBOS 可以进入 PoC，而不能凭本报告直接定案。**

本次核验全程只读，未修改待验报告或源码镜像。