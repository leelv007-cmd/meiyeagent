# DBOS Transact (TypeScript SDK) 深度调研

> **交叉验证裁定（Codex，2026-07-17）：动摇（核心能力多数属实，但「可直接替代 pg-boss、迁移成本极窄」被推翻；须 PoC 后再定案）** — 全文见 `xcheck/r01-xcheck.md`；引用本报告断言前先对照裁定。

> 候选组件：`@dbos-inc/dbos-sdk`（仓库 `dbos-inc/dbos-transact-ts`）——Postgres 原生的 durable execution 库
> 调研日期：2026-07-17 ｜ 目标：为「美业内容营销 Agent」的五段式 Harness 编排层选型
> 依据：本地 depth-1 镜像 `references/repos/harness-2026-07-17/dbos-transact-ts/`（HEAD = commit `1d02f23` "Optimize Streams and Events #1309"）+ npm registry + GitHub API + 官方文档
> 标注约定：**【核实】**= 源码/官方数据直接读到；**【推断】**= 基于源码行为推理，未经运行验证

---

## 结论摘要（TL;DR）

1. **成熟度足够、方向高度契合**：MIT、1280 stars、今日仍在推送、open issues 仅 7、发布节奏近乎每周一个 minor（当前 npm latest = **4.23.6**）。它就是一个 npm 库，`DBOS.setConfig() + DBOS.launch()` 两行嵌入我们的「单 Node 常驻服务」，**唯一外部依赖就是 Postgres**——无 broker、无独立编排服务、无必需 SaaS。这对「平移便宜」是最强的一档。
2. **durable 语义完备**：workflow / step 的 checkpoint 落在 PG 系统表；崩溃后 `DBOS.launch()` 自动触发恢复；`recv` / `setEvent` / `getEvent` / `sleep` 都是持久化的，能实现「挂起数天等审批」跨崩溃续等；`cancel` / `resume` / `forkWorkflow(id, startStep)` 齐全。
3. **版本 fencing 是内建的**：每个 workflow 打上 `application_version`（= 所有 workflow 源码的 MD5 哈希，可用 `DBOS__APPVERSION` 覆盖），**恢复只会捡起匹配当前版本的实例**——升级代码后旧实例不会被新代码乱跑。但注意这是「执行层」fencing，**「旧结果覆盖新内容 revision」这种业务层 fencing 仍需我们在第⑤段用条件写/OCC 自己做**（DBOS 给足了工具，但不自动替你判断业务 revision）。
4. **队列可直接替代 pg-boss**：`WorkflowQueue` 支持全局并发 / 单进程并发 / 限流 / 优先级 / 去重 / 分区，且与 durable workflow 一体。对我们的场景（视频分钟级长任务限流、按客户去重）够用且更强。
5. **进度事件有一等公民**：`DBOS.writeStream()` / `DBOS.readStream(wfId, key)`（AsyncGenerator，LISTEN/NOTIFY + 1s 轮询兜底），**外部进程可通过 `DBOSClient` 读流**——正好把白话进度推给前端 SSE，无需自己读系统表。
6. **栈契合度高**：官方出 `@dbos-inc/drizzle-datasource`，**可直接复用我们现有的 `pg.Pool`**（传入现成 Pool 则不接管、不关闭），基于 `drizzle-orm/node-postgres`。系统表默认独立 schema `dbos`，不侵入业务表。
7. **主要缺口/风险**：① 公司小、社区中等（1.3k stars，Discord 规模有限），赌的是团队持续维护；② 高频 minor 发布=API 仍在演进（近一年 v2→v3→v4 有破坏性变更）；③ 单库靠 PG 撑并发，视频这类分钟级任务占用「in-flight 内存 async 帧」而非线程，量级不大时无压力，但强依赖 PG 承载；④ 无 Temporal 那种强制确定性/replay 校验——DBOS 的模型是「step 级 checkpoint 重放」而非「事件历史重放」，更简单但对「workflow 主体代码里放非确定性逻辑」的保护弱一些，需靠规范约束。

---

## 1. 版本 / 许可证 / 采用信号 / 管理面

### 基础事实【核实】

| 项 | 值 | 来源 |
|---|---|---|
| npm 包名 | `@dbos-inc/dbos-sdk` | package.json |
| npm latest 版本 | **4.23.6** | registry.npmjs.org（2026-07-17 查询） |
| 开发分支版本 | 4.24-preview | version.json（NerdBank GitVersioning） |
| 许可证 | **MIT**（Copyright 2023 DBOS, Inc.） | LICENSE |
| Node 要求 | `>=20` | package.json engines |
| GitHub stars | **1280** | api.github.com（2026-07-17） |
| forks | 83 ｜ open issues | **7** ｜ subscribers 6 | 同上 |
| 创建 / 最近推送 | 2023-07-12 / **2026-07-17**（今天） | 同上 |
| 生产依赖 | `pg`、`superjson`、`ws`、`yaml`、`commander`、`serialize-error` | package.json |

**发布节奏【核实/推断】**：GitHub releases 显示 v4.12 → v4.22 在数月内密集迭代，配合 npm latest 4.23.6 与 open issues 仅 7，可判定为**高频、活跃、维护良好**——但也意味着 API 仍在快速演进，锁版本 + 关注 changelog 是必须的。

**采用信号**：官网列了付费客户案例（PDG、TileDB 等），但公开可核实的第三方大规模生产背书有限。这是一家 A 轮量级创业公司（创始人含 Michael Stonebraker、Matei Zaharia 等数据库/Spark 学术背景——此为公开背景知识，**【推断】** 不影响技术判断）。**对我们的意义**：技术底子硬、但要按「可能某天停更」做预案（好在是纯 PG 库，最坏情况系统表 schema 公开、可自行接管，见 §5）。

### v2 / v3 / v4 重大 API 变化【推断，需 changelog 复核】

从源码痕迹与 README 现状看，当前主线（v4）的 API 形态是 **`DBOS.registerWorkflow(fn)` 函数式注册 + `DBOS.runStep()`**，而早期版本（v1/v2）是 **装饰器式**（`@Workflow()` / `@Transaction()` / `@Step()`，源码 `decorators.ts` 仍保留兼容）。也就是说：
- 早期强绑定「class + 装饰器 + `experimentalDecorators`」；
- 现在主推「普通 async 函数 + 显式注册」，装饰器降级为可选。

> **行动项**：正式选型前用 `WebFetch` 拉 v2.0/v3.0/v4.0 的 release notes 逐条核对破坏性变更清单（本次因 GitHub releases 分页未能一次抓全）。对我们影响不大（我们是新项目，直接用 v4 函数式 API），但决定了「网上旧教程/示例不能照抄」。

### Conductor 是否必需

**【核实】纯可选。** `src/conductor/conductor.ts` 是一个 **WebSocket 客户端**，仅在 `DBOS.launch({ conductorKey, conductorURL })` 显式传入 key、或运行于 DBOS Cloud 环境时才启动（`dbos.ts:456/496`）。它连的是 DBOS 托管的观测/管理面（远程 dashboard、批量暂停/恢复、查看 workflow 列表）。**不配置 = 完全不影响 durability**，所有持久化能力都在本地库 + 你自己的 PG 里。我们可以**不用 Conductor**，用 `DBOSClient.listWorkflows()` / 自建 admin server（`adminserver.ts`，可配 `runAdminServer`）自管。

---

## 2. Durable 语义逐项核实

### 2.1 系统表结构【核实，源码 `schemas/system_db_schema.ts` + `src/sysdb_migrations/internal/migrations.ts`】

DBOS 在**独立的系统数据库/schema**（默认 schema 名 `dbos`，默认库名 `<appname>_dbos_sys`）里维护这些表：

| 表 | 作用 | 关键列 |
|---|---|---|
| `workflow_status` | **每个 workflow 实例一行**，主 checkpoint | `workflow_uuid`(PK), `status`(ENQUEUED/PENDING/SUCCESS/ERROR/CANCELLED/...), `name`, `inputs`, `output`, `error`, `recovery_attempts`, **`application_version`**, `executor_id`, `queue_name`, `workflow_timeout_ms`, `workflow_deadline_epoch_ms`, `deduplication_id`, `priority`, `queue_partition_key`, `forked_from`, `parent_workflow_id`, `owner_xid`, `attributes`(JSONB) |
| `operation_outputs` | **每个 step 一行**，step 级 checkpoint | `(workflow_uuid, function_id)`(PK), `output`, `error`, `function_name`, `child_workflow_id`, `started_at_epoch_ms`, `completed_at_epoch_ms` |
| `notifications` | `send`/`recv` 的消息 | `destination_uuid`, `topic`, `message`, `consumed`, `message_uuid`(PK) |
| `workflow_events` | `setEvent`/`getEvent` 的键值 | `(workflow_uuid, key)`(PK), `value` |
| `streams` | **`writeStream`/`readStream` 的进度流** | `(workflow_uuid, key, offset)`(PK), `value`, `function_id` |
| `workflow_queue` / `queues` | 队列成员 + 队列配置 | 见 §3 |
| `workflow_schedules` / `scheduler_state` | cron 调度 | `crontab`, `last_fired_at` |
| `application_versions` | 已注册的应用版本 | `version_id`, `version_name` |
| `dbos_migrations` | 系统表自身的迁移版本 | `version` |

**机制要点【核实】**：
- **checkpoint = 显式 INSERT，不是隐式**。每个 step 完成时把结果写进 `operation_outputs(workflow_uuid, function_id, output)`；workflow 主体每次跨 step/等待都推进一个单调递增的 `function_id`（`functionIDGetIncrement()`）。重放时按 `function_id` 查表：若该 step 已有输出则**跳过执行、直接返回缓存结果**；否则真正执行并写入。这就是「断点续跑」的底层。
- **通知走 PG `LISTEN/NOTIFY`**：`notifications` / `workflow_events` / `streams` 的写入曾用 per-row 触发器 `pg_notify` 到 `dbos_notifications_channel` / `dbos_workflow_events_channel` / `dbos_streams_channel`；HEAD commit（#1309）刚把这些**逐行触发器移除、改为写入路径外合并通知**（`notificationCoalesceMs` 配置）——一次针对高频写场景的性能优化，说明团队在打磨吞吐。
- 可关 LISTEN/NOTIFY：`use_listen_notify: false` 时退化为纯轮询（给 CockroachDB / 不支持 NOTIFY 的托管 PG 用），代价是延迟更高、PG 负载更大。

### 2.2 崩溃恢复由谁触发、怎么触发【核实，`dbos-executor.ts:411 / 1219`】

- **进程启动即恢复**：`DBOS.launch()` → executor 初始化末尾调用 `recoverPendingWorkflows([this.executorID])`。
- 恢复查询：`getPendingWorkflows(executorID, appVersion)` = `WHERE status='PENDING' AND executor_id=$2 AND application_version=$3`。即**只恢复「属于本 executor 且版本匹配」的 PENDING 工作流**。
- 队列中的（ENQUEUED/PENDING）则 `reenqueuePendingQueuedWorkflows(execID, appVersion)` 重新入队。
- 对每个待恢复 workflow：若属于队列则清除队列占用后重新分发；否则 `executeWorkflowId(id, {isRecoveryDispatch:true})`——从 `workflow_status.inputs` 反序列化入参，重跑 workflow 主体（step 命中缓存则跳过，只补跑未完成的部分）。

> **单 Node 部署的运维细节【推断，重要】**：默认 `executor_id = 'local'`（非云环境）。同一个「单 Node 常驻服务」重启后，`executor_id` 仍是 `local`、若代码没变则 `application_version` 也不变 → **自动恢复上次崩溃时 in-flight 的所有任务**。这正是我们要的。但**如果重启时同时改了 workflow 代码**（app_version 变了），旧版本的 in-flight 实例**不会被新版本进程自动恢复**（版本不匹配），会滞留 PENDING，需要：要么临时 `DBOS__APPVERSION` 钉住旧版本放一个 worker 收尾，要么显式 `forkWorkflow` 迁移。**结论：热更新代码 + 平滑收尾 in-flight 需要发布流程配合，不是「换个进程就自动接管」。**

### 2.3 挂起数天等用户输入【核实 + 推断】

三种「持久等待」原语，都跨崩溃续存：

- **`DBOS.recv<T>(topic, timeoutSeconds)`**（`dbos.ts:1448`）：workflow 内阻塞收消息。**默认超时 60s，但可设任意长**（文档明说「可等数天/数周，穿越中断与重启」）。等待期间不占线程、不长期占连接（靠 `notifications` 表 + LISTEN/NOTIFY + 轮询）；进程活着就是一个内存里的挂起 async 帧，进程崩了恢复后重进 `recv` 继续等（消息已持久在表里，`consumed` 标志防重复消费）。
- **`DBOS.send(destWfId, msg, topic)`** / **`DBOSClient.send()`**：从**任何地方**（另一个 workflow、HTTP handler、甚至独立进程）给某 workflow 投递消息，唤醒它的 `recv`。→ **审批就是：用户点「通过」时，API 层 `DBOSClient.send(taskWfId, {approved:true}, 'approval')`**。
- **`DBOS.setEvent(key, value)` / `DBOS.getEvent(wfId, key, timeout)`**：workflow 对外发布可查询状态（如「当前进行到哪步」「产物预览 URL」）；外部/其他 workflow 拉取。适合「广播型」状态，`recv` 适合「点对点」审批。
- **`DBOS.sleep(ms)`**：持久化睡眠，唤醒时间存 PG，穿越重启。用于「视频轮询间隔」「N 天后自动提醒」。

### 2.4 取消 / 恢复 / fork【核实，`dbos.ts:1034/1054/1114`】

- `DBOS.cancelWorkflow(id)`：置为 CANCELLED（用于用户取消 / 超时废弃）。
- `DBOS.resumeWorkflow(id)`：恢复被取消/暂停的实例。
- **`DBOS.forkWorkflow(id, startStep)`**：从指定 step 分叉出**新 workflow 实例**（新 UUID，`forked_from` 记录来源），从第 N 步重放。→ 这是「改了某个 prompt/模型后，让任务从第③段重跑，而不是从头」的官方手段。
- `DBOS.listWorkflows(filter)` / `listWorkflowSteps(id)`：程序化查询，可按 status / 时间 / 版本 / attributes 过滤——自建运维面板/批量补偿的基础。

### 2.5 workflow versioning 与 revision fencing【核实 + 关键辨析】

**执行层版本 fencing（DBOS 内建）**：
- `computeAppVersion()`（`dbos-executor.ts:1474`）= 对「所有已注册 workflow 函数的源码字符串排序后」求 MD5，再混入 DBOS 库版本。**任何 workflow 代码改动 → 版本变**。可用 `DBOS__APPVERSION` 手动钉。
- 入队时 workflow 打上当时的 `application_version`；**恢复/出队只匹配版本**（§2.2）。队列出队有个体贴设计（`system_database.ts:3124`）：当前进程是「最新注册版本」时，会同时领取 `application_version = 当前 OR IS NULL`（后者是外部 client enqueue、未绑版本的）；否则只领精确匹配版本——**滚动发布时新老进程各管各的版本，不会互相抢跑**。
- 另有 `owner_xid`（每次 enqueue 生成的 UUID）【推断】用作出队所有权 fence，防止多 worker 重复执行同一实例。

**业务层 revision fencing（需我们自己做，DBOS 不替你判断）**：
> 你的顾虑「恢复时旧结果覆盖新版本 ContentPackage revision」属于**业务不变量**，不在 DBOS 的执行层职责内。DBOS 保证的是「这个 workflow 实例 exactly-once、按版本恢复、step 不重复副作用」；但「一个挂了很久才恢复完的旧任务，其产出还该不该写进如今已被用户推进到 rev5 的内容包」——这个判断得由**第⑤段的写入 step 用条件写实现**：
> - 在 `ContextBundle` 里冻结 `baseRevision`；
> - 第⑤段落库时用 `UPDATE ... WHERE content_package_id=? AND head_revision=:baseRevision`（OCC / 乐观锁），影响行数为 0 → 抛「已被更新版本取代」，workflow 以 SUPERSEDED 收尾而**不覆盖**。
> - 这个条件写可以用 `@dbos-inc/drizzle-datasource` 的 `runTransaction` 包成一个 durable step，天然拿到 exactly-once + 事务原子性。
>
> **一句话**：DBOS 给足了 fencing 工具（版本匹配、workflow ID 幂等、cancel、条件事务 step），但「revision 谁新谁旧」的业务裁决要我们写。这是它与 Temporal 一致的边界，不是缺陷。

---

## 3. 栈契合

### 3.1 作为库嵌入「单 Node 常驻服务」【核实】

```ts
import { DBOS } from '@dbos-inc/dbos-sdk';

DBOS.setConfig({
  name: 'meiye-content',
  systemDatabaseUrl: process.env.DBOS_SYSTEM_DATABASE_URL, // 指向托管 PG
  systemDatabasePool: existingPgPool,   // 可选：复用现有 pg.Pool（见下）
  systemDatabaseSchemaName: 'dbos',      // 系统表独立 schema，不碰业务表
  // 不传 conductorKey => 不连任何 SaaS
});
await DBOS.launch();                      // 启动即恢复上次 in-flight 任务
// ... 进程存活期间处理任务；退出前 await DBOS.shutdown();
```

纯编程式配置，**不需要 `dbos-config.yaml`**（yaml 只是 CLI 便利，我们全走代码）。`DBOS.launch()` 会自动跑系统表 migration。

### 3.2 与现有 node-postgres / Drizzle 池共存【核实，`config.ts:201` + `drizzle-datasource/index.ts`】

- **系统库连接**：`translateDbosConfig` 支持 `systemDatabasePool`（直接传入你的 `pg.Pool`）、`sysDbPoolSize`、`systemDatabasePollingConcurrency`。可以让 DBOS 系统表与业务库**共用一个 PG 实例的不同 schema**，甚至共用连接池。
- **业务事务 step**：`@dbos-inc/drizzle-datasource` 的 `DrizzleTransactionHandler` 构造函数**接受 `PoolConfig` 或现成的 `Pool` 实例**——传现成 Pool 时 `#userProvidedPool=true`，DBOS **不会关闭它**（`end()` 成空操作）。底层就是 `drizzle-orm/node-postgres`，与我们的 Drizzle 完全同源。→ **可以把现有 Drizzle 数据库句柄接给 DBOS 做 durable transaction step，零重复池。**
- **代价**：drizzle-datasource 需要一张 `<schema>.transaction_completion` 表（存事务级 exactly-once 的 OCC 记录），首次 init 自动建，或加进你的 migration。这与 DBOS 系统库表是两套东西（一个管 workflow/step，一个管「业务事务的幂等」）。

### 3.3 是否接管 migration / 独立 schema【核实】

- 系统表：DBOS 自己管，跑在独立 schema `dbos`（可改名），**不侵入业务表**。
- 业务表：完全归你（Drizzle 管）。DBOS 只额外要一张 `transaction_completion`。
- 结论：**不接管你的业务 migration**，只自管它自己的系统 schema。

### 3.4 DBOS Queues 能否替代 pg-boss【核实，`wfqueue.ts`】

`new WorkflowQueue(name, params)` 的 `QueueParameters`：

| 能力 | 字段 | 说明 |
|---|---|---|
| 全局并发上限 | `concurrency` | 整个 app 同时运行的该队列 workflow 数 |
| 单进程并发上限 | `workerConcurrency` | 每个 DBOS 进程的上限（多进程时用） |
| 限流 | `rateLimit: {limitPerPeriod, periodSec}` | 每 N 秒最多启动 M 个 |
| 优先级 | `priorityEnabled` | 入队时给 `priority` |
| 去重 | 入队 `enqueueOptions.deduplicationId` | 同 dedup id 已在队列则拒绝重复 |
| 分区 | `partitionQueue` + `queuePartitionKey` | 按客户/租户分区隔离 |
| 去抖 | `debouncer.ts` + `enqueueDebounced` | 短时间多次触发只跑最后一次 |
| 滚动发布冲突策略 | `onConflict: update_if_latest_version / always_update / never_update` | 多版本共存时队列配置谁说了算 |

**对比 pg-boss**：pg-boss 是「PG 上的通用 job 队列」（cron、重试、优先级、节流）。DBOS 队列的差异是**队列成员就是 durable workflow**——入队即 checkpoint，保证「即使崩溃，任务必完成、调用方必拿到结果、不重复」。我们「视频分钟级长任务 + 按客户限流 + 去重」的诉求，DBOS 队列是 pg-boss 的**超集**（多了 workflow 一体性与 exactly-once）。

> **判断【推断】**：可以用 DBOS 队列**替代 pg-boss** 承接 Task 编排。若仍有「与 workflow 无关的纯轻量后台 job」（发短信、清理临时文件），保留 pg-boss 也无妨；但为了减依赖，建议统一到 DBOS，除非遇到 DBOS 队列不便表达的场景。**注意**：DBOS 队列是 push 型（进程轮询系统库出队），不支持「手动 fetch job」；吞吐上限受单 PG 制约（见 §8）。

---

## 4. 进度事件如何流回前端【核实】

**一等公民 = Streams**（`streams` 表 + `dbos.ts:1557/1622`、`client.ts:679`）：

- workflow/step 内：`await DBOS.writeStream('progress', { stage:'brief', pct:40, note:'正在编排文案脚本…' })`，按 `offset` 单调追加；`DBOS.closeStream('progress')` 写结束哨兵。**writeStream 本身是 checkpoint 化的**（重放不会重复写同一 offset）。
- 读取（可在**任意进程**）：`for await (const ev of DBOS.readStream(wfId, 'progress')) { ... }`——AsyncGenerator，按序 yield，LISTEN/NOTIFY 唤醒 + 1s 轮询兜底，直到流关闭或 workflow 终止。
- **关键**：`DBOSClient.readStream(wfId, key)`（`client.ts:679`）让**不运行 executor 的进程**（如 Next.js API route / 一个专门的 SSE 网关）也能订阅进度。→ 前端 SSE handler 里 `for await (const ev of client.readStream(taskId,'progress')) res.write(...)` 即可。
- 另有 `setEvent/getEvent` 适合「单值最新状态」（如当前 stage、产物预览 URL）；Streams 适合「有序增量事件流」（白话进度条）。两者组合正好覆盖需求。

> **契合度极高**：我们要的「白话进度事件流」几乎是 Streams 的样板用例，无需自己读系统表、无需另接 Redis pub/sub。

---

## 5. 部署与平移

### 5.1 纯 self-host 无外部依赖【核实】

**成立。** DBOS 库运行期只需要一个 Postgres。Conductor / DBOS Cloud 都是可选 SaaS（§1）。验证期架构：Cloudflare Workers 壳（enqueue/读流用 `DBOSClient` 走 Hyperdrive→PG，或转发给 Node 服务）+ **单 Node 常驻服务跑 DBOS executor**（长驻进程是 durable execution 的硬需求，Workers 无法承载 executor 本体）+ 托管 PG。这与项目既有架构分工天然吻合。

### 5.2 迁中国云成本【推断】

- **迁移面极窄**：把 `systemDatabaseUrl` 指向国内托管 PG（阿里云 RDS PG / PolarDB / 腾讯云 PG）即可，**无其他基建要搬**。这是 DBOS 相对 Temporal（要搬整套 Temporal Server 集群）的最大平移优势。
- **兼容性检查项**：系统表用到 `uuid-ossp` 扩展、`gen_random_uuid()`（PG13+ 内建）、`pg_notify` / `LISTEN`、plpgsql 存储过程（`enqueue_workflow` / `send_message`）。国内 RDS PG 普遍支持这些；若目标是**不支持 LISTEN/NOTIFY 的 serverless PG**，设 `use_listen_notify:false` 降级为轮询仍可跑（延迟/负载上升）。
- **停更预案**：万一上游停维护，系统表 schema 与迁移全公开在源码，MIT 许可，最坏可 fork 自维护——比闭源编排服务安全。

---

## 6. 五段式 Harness 的 DBOS 代码骨架

> 演示重点：**④分钟级视频轮询 + 挂起等审批**、进度流、版本 fencing。代码为示意（英文），API 名以本地源码为准。

```ts
import { DBOS, WorkflowQueue, DBOSClient } from '@dbos-inc/dbos-sdk';

// --- Queues: video generation is minutes-long, rate-limit provider calls ---
const videoQueue = new WorkflowQueue('video_gen', {
  concurrency: 20,                       // global cap across the app
  rateLimit: { limitPerPeriod: 5, periodSec: 60 }, // don't hammer Seedance/即梦
  priorityEnabled: true,
});

// ---------- Deterministic steps wrap all non-determinism ----------
async function normalizeIntent(raw: RawRequest) { /* LLM structured output */ return intent; }
async function assembleContext(intent: Intent): Promise<ContextBundle> {
  // deterministic assembly -> IMMUTABLE bundle; freeze baseRevision here
  return { ...bundle, baseRevision };
}
async function compileBrief(ctx: ContextBundle) { /* LLM */ return brief; }
async function submitVideoJob(brief: Brief) { /* returns providerJobId */ return jobId; }
async function pollVideoJob(jobId: string) { /* one status check */ return { done, url, failed }; }
async function redlineGate(candidate: Candidate) { /* deterministic compliance check */ return ok; }
async function commitRevision(pkgId: string, baseRev: number, payload: Payload) {
  // OCC fence: only write if head revision still matches the frozen base
  // (wrap in drizzle-datasource runTransaction for a durable, exactly-once tx step)
  const affected = await occUpdate(pkgId, baseRev, payload);
  if (affected === 0) throw new SupersededError(pkgId, baseRev);
  return payload.revision;
}

// ---------- The five-stage Harness as one durable workflow ----------
async function harnessTask(raw: RawRequest) {
  const taskId = DBOS.workflowID!;

  // ① Intent
  await DBOS.writeStream('progress', { stage: 'intent', note: '正在理解你的需求…' });
  const intent = await DBOS.runStep(() => normalizeIntent(raw), { name: 'normalizeIntent' });

  // ② Context (deterministic, immutable) — baseRevision frozen inside
  const ctx = await DBOS.runStep(() => assembleContext(intent), { name: 'assembleContext' });

  // ③ Brief compile
  await DBOS.writeStream('progress', { stage: 'brief', note: '正在编排脚本…' });
  const brief = await DBOS.runStep(() => compileBrief(ctx), { name: 'compileBrief' });

  // ④ Execute & select — minutes-long video job with durable polling
  await DBOS.writeStream('progress', { stage: 'render', pct: 0, note: '正在生成视频，约 2-3 分钟…' });
  const jobId = await DBOS.runStep(() => submitVideoJob(brief), { name: 'submitVideoJob' });

  let result;
  for (let i = 0; i < 60; i++) {
    await DBOS.sleep(10_000);            // durable sleep, survives crashes
    result = await DBOS.runStep(() => pollVideoJob(jobId), { name: `poll_${i}` });
    await DBOS.writeStream('progress', { stage: 'render', pct: Math.min(95, i * 5) });
    if (result.done || result.failed) break;
  }
  if (!result?.done) throw new Error('video timeout');

  const ok = await DBOS.runStep(() => redlineGate(result), { name: 'redlineGate' });
  if (!ok) { await DBOS.writeStream('progress', { stage: 'blocked', note: '触发合规红线，已停' }); return; }

  // --- Suspend for human approval: may wait hours to days, across restarts ---
  await DBOS.setEvent('preview', { url: result.url });   // expose preview to UI
  await DBOS.writeStream('progress', { stage: 'review', note: '请审核成片' });
  const decision = await DBOS.recv<{ approved: boolean }>('approval', 3 * 24 * 3600); // 3-day timeout
  if (!decision?.approved) { await DBOS.writeStream('progress', { stage: 'declined' }); return; }

  // ⑤ Package & deliver — OCC revision fence prevents stale overwrite
  const rev = await DBOS.runStep(
    () => commitRevision(ctx.pkgId, ctx.baseRevision, { url: result.url }),
    { name: 'commitRevision' },
  );
  await DBOS.writeStream('progress', { stage: 'done', revision: rev });
  await DBOS.closeStream('progress');
  return rev;
}
const HarnessTask = DBOS.registerWorkflow(harnessTask, { name: 'HarnessTask' });

// ---------- API / Workers layer (no executor) via DBOSClient ----------
const client = await DBOSClient.create({ systemDatabaseUrl: process.env.DBOS_SYSTEM_DATABASE_URL! });
// enqueue a task (idempotent by taskId)
await client.enqueue({ workflowName: 'HarnessTask', queueName: 'video_gen', workflowID: taskId }, raw);
// stream progress to frontend SSE
for await (const ev of client.readStream(taskId, 'progress')) { sse.send(ev); }
// user clicks Approve
await client.send(taskId, { approved: true }, 'approval');
// after a prompt change, restart from stage ③
await client.forkWorkflow(taskId, /* startStep */ 3);
```

**要点回顾**：`sleep` 让分钟级轮询崩溃安全；`recv(topic, 3天)` 实现挂起等审批且跨重启；`writeStream/readStream` 是白话进度；`commitRevision` 内的 OCC 是业务层 revision fencing；`DBOSClient` 让 Workers/Next.js 层无需 executor 就能 enqueue/读流/审批/fork。

---

## 7. 对照 Temporal 范式

| 维度 | Temporal | DBOS Transact |
|---|---|---|
| 部署形态 | 独立 Temporal Server 集群（+ 自己的持久层） + Worker 进程 + Client | **一个 npm 库 + 一个 Postgres**，无独立服务 |
| durable 机制 | **事件历史重放（event sourcing）**：workflow 代码重放整段历史，activity 结果从历史取 | **step 级 checkpoint**：`operation_outputs` 表记每个 step 输出，重放时命中即跳过 |
| 确定性约束 | **强制**：workflow 主体必须完全确定，非确定改动触发 non-determinism error；有 replay 校验 | **弱约束**：非确定性要求你「包进 step」，但没有 Temporal 那种强制 replay 校验来兜底违规；靠规范 + code review |
| signals / queries | Signals / Queries / Updates | `send/recv`（≈signal）、`setEvent/getEvent`（≈query）、`writeStream/readStream`（Temporal 无对应的一等流） |
| 定时/长等待 | Durable Timer | `DBOS.sleep`（持久）、`recv` 超时（可数天） |
| 版本管理 | `patched()` / Worker Versioning（较复杂） | `application_version` 哈希 + 版本匹配恢复（较简单，但粒度是「整个 app 的 workflow 源码」） |
| 取消/重试/补偿 | 完整（含 child workflow、saga 模式支持成熟） | `cancel/resume/forkWorkflow`、child workflow（`startWorkflow` 内嵌）；saga 需自己用 step 组织 |
| 生态/成熟度 | 大厂广泛生产采用、多语言、社区大 | 创业公司、1.3k stars、TS/Python 两语言、社区中等 |
| 运维成本 | 高（要养集群） | 低（只养 PG） |

**完备度评价**：对我们的用例（单租户量级的内容任务编排、长等待、进度流、PG 已在栈里），DBOS **功能完备度足够**，且**运维/平移成本显著低于 Temporal**。

**相对缺口**：
1. **无强制确定性校验**——Temporal 会在重放时抓出「你在 workflow 主体里调了非确定 API」；DBOS 不会，写错了（把 LLM 调用直接写在 workflow 主体而非 step 里）可能导致重放行为异常。**需靠工程规范 + lint/review 约束**：一切副作用/非确定必须在 `runStep` 内。
2. **saga/补偿无专门 DSL**——要自己用 step 编排回滚。我们场景补偿需求不重，可接受。
3. **生态与生产背书**远不及 Temporal——这是「用轻量换成熟度」的取舍。

---

## 8. 风险清单

| # | 风险 | 严重度 | 说明 / 缓解 |
|---|---|---|---|
| R1 | **公司/社区规模小**（1.3k stars、创业公司） | 中 | 赌团队持续维护；缓解=纯 PG 库 + MIT + schema 公开，最坏可 fork 自维护；不用 Conductor 避免 SaaS 锁定 |
| R2 | **API 高频演进**（近乎每周 minor，v2→v3→v4 有破坏性变更） | 中 | 锁 minor 版本、CI 里钉 `@dbos-inc/dbos-sdk@4.23.x`、升级前读 changelog；用 v4 函数式 API 别抄旧装饰器教程 |
| R3 | **性能/吞吐受单 PG 制约** | 中 | 每个 step 一次 INSERT、通知走 LISTEN/NOTIFY + 轮询；高并发时 PG 是瓶颈。#1309 刚做过通知合并优化。视频任务量级不大时无忧；需压测确认托管 PG 规格（连接数、IOPS） |
| R4 | **热更新代码与 in-flight 恢复的版本错配**（§2.2） | 中 | 改 workflow 代码=换 app_version，旧 in-flight 不被新进程自动恢复。需发布流程：钉 `DBOS__APPVERSION` 放收尾 worker，或 `forkWorkflow` 迁移；文档化「有 in-flight 长任务时的发布 SOP」 |
| R5 | **确定性靠人守**（§7 缺口1） | 中 | 无强制 replay 校验，副作用漏出 step 会导致重放异常。建立硬规范：workflow 主体只做编排，一切 IO/LLM/随机进 `runStep` |
| R6 | **业务 revision fencing 需自研**（§2.5） | 低 | DBOS 只做执行层 fencing；第⑤段用 OCC 条件写自己守，已有清晰方案 |
| R7 | **长等待占内存 async 帧** | 低 | 挂起数天的任务=进程内一个挂起 promise（不占线程/连接），量大时占内存。进程崩溃后靠恢复重建。数千级并发挂起需评估内存 |
| R8 | **Node >=20、需长驻进程** | 低 | 与既有「单 Node 常驻服务」架构一致；Workers 层只能当 client（DBOSClient），不能跑 executor |

> **近期高频 issue**：本次 open issues 仅 7 条，无法从数量判断热点；HEAD commit 是 Streams/Events 性能优化（#1309），侧面反映团队近期在打磨「高频写场景吞吐」——与我们进度流 + 频繁 checkpoint 的用法相关，值得关注其后续优化。

---

## 附：本次调研信息盲点（供后续补齐）

- v2.0/v3.0/v4.0 逐条破坏性变更清单未一次抓全（GitHub releases 分页），影响低（新项目直接 v4）。
- 具体生产客户案例、SLA、性能基准（TPS/延迟）未做实测——需真实压测托管 PG 才有数。
- `reach_*` 联网 MCP 因本机 python<3.10 未就绪（已知问题），本次改用 WebFetch/WebSearch + 本地源码，未受影响。

---

## 来源 URL

- 本地源码镜像（权威，HEAD `1d02f23`）：`references/repos/harness-2026-07-17/dbos-transact-ts/`
  - `README.md`、`package.json`、`LICENSE`、`version.json`
  - `schemas/system_db_schema.ts`、`src/sysdb_migrations/internal/migrations.ts`
  - `src/dbos.ts`、`src/dbos-executor.ts`、`src/system_database.ts`、`src/config.ts`、`src/wfqueue.ts`、`src/client.ts`、`src/conductor/conductor.ts`
  - `packages/drizzle-datasource/index.ts`
- npm registry：https://registry.npmjs.org/@dbos-inc/dbos-sdk/latest （latest = 4.23.6，MIT，node>=20，查询于 2026-07-17）
- GitHub API：https://api.github.com/repos/dbos-inc/dbos-transact-ts （stars 1280 / forks 83 / open issues 7 / pushed 2026-07-17）
- GitHub 仓库/releases：https://github.com/dbos-inc/dbos-transact-ts ｜ https://github.com/dbos-inc/dbos-transact-ts/releases
- 官方文档：https://docs.dbos.dev/ （quickstart / workflow / queue / scheduled-workflows / client / transaction 教程）
- DBOS vs Temporal 官方博客：https://www.dbos.dev/blog/durable-execution-coding-comparison
