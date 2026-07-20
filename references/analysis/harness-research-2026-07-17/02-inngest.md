# 候选组件深度调研：Inngest（事件驱动 durable functions）

> **交叉验证裁定（Codex，2026-07-17）：成立但需修正（waitForEvent 上限 366 天非无限；32MB/1000 为默认限制非绝对硬上限；@inngest/realtime 0.x 已废弃、迁 inngest/realtime）** — 全文见 `xcheck/r02-xcheck.md`；引用本报告断言前先对照裁定。

> 调研日期 2026-07-17 ｜ 调研员：harness-inngest 子 agent
> 结论口径：`【官方核实】` = 有源码/官方文档/URL 佐证；`【推断】` = 基于证据的工程判断，非官方承诺。
> 本地镜像：`references/repos/harness-2026-07-17/inngest/`（Go 服务端）+ `inngest-js/`（TS SDK）

---

## 0. 一句话结论

Inngest 是**为 AI/内容工作流量身定做的 durable functions 平台**，用「step-hash memoization + HTTP/WebSocket 拉取执行」实现断点续跑，语义完备度覆盖五段式 Harness 的绝大部分需求（waitForEvent 挂起数天、realtime 白话进度、step.ai 追踪、并发/幂等键齐全）；**核心风险在两点**：① 服务端许可证是 **SSPL**（MongoDB 同款，强 copyleft，SaaS 自托管须审慎）；② 采用的是**确定性重放**而非 Temporal 式显式版本 API——项目要的「revision fencing」必须自己在 ⑤ 段做应用层条件写，框架不代劳。

---

## 1. 版本 / 许可证 / 发布节奏 / 采用信号

### 1.1 最新版本【官方核实】

| 组件 | 版本 | 佐证 |
|---|---|---|
| 服务端 `inngest/inngest`（Go） | **v1.37.0**（2026-07-14） | 本地 `CHANGELOG.md` 首条 `## [v1.37.0] - 2026-07-14`；go.mod `go 1.26.4` |
| TS SDK `inngest` | **v4.13.0** | 本地 `inngest-js/packages/inngest/package.json` |
| `@inngest/realtime` | **v0.4.7** | 本地 `inngest-js/packages/realtime/package.json`（注意：仍是 0.x，realtime 未定稿） |
| GitHub stars（服务端 repo） | ~5.6k | github.com/inngest/inngest releases 页 |

> 本地服务端仓库最新 commit `bf307f5`（2026-07-17 01:22，`chore: add event lifecycle hooks #4624`）；SDK 最新 commit `6f4b383`（2026-07-15 `Release @latest #1631`）。发布节奏很密：服务端近三版 v1.35→v1.36→v1.37 分别是 07-07 / 07-08 / 07-14，基本**每周一个 minor**，changelog 走 conventional-commits 自动生成（`cliff.toml`）。

### 1.2 许可证结构——本候选最关键疑点，已逐层核实【官方核实】

**服务端 + CLI = SSPL v1.0（Server Side Public License）+ DOSP 延迟转 Apache 2.0。SDK 全部 = Apache 2.0。**

来源：本地 `inngest/LICENSE.md` 全文 + `README.md` License 节原文：

> "The Inngest server and CLI are available under the Server Side Public License and delayed open source publication (DOSP) under Apache 2.0. All Inngest SDKs are all available under the Apache 2.0 license."

两条对 SaaS 落地生死攸关的条款（LICENSE.md 逐字核对）：

- **§13 Offering the Program as a Service**：如果你把「本程序或修改版的功能」作为服务提供给第三方，你必须把**整套 Service Source Code（含管理软件、UI、API、自动化、监控、备份、存储、托管软件）以网络下载方式免费向所有人公开**。这是 SSPL 的"毒丸"。
- **Grant of Future License**：每个版本在**发布满 3 周年后**自动追加 Apache 2.0 授权（DOSP / 延迟开源）。即 v1.37.0（2026-07）大约在 **2029-07** 才无条件转 Apache 2.0。

**这对我们意味着什么【推断，但基于 SSPL 通行解读】**：

1. 我们**自己用 Inngest 服务端来编排「美业内容 Agent」这个 SaaS**——我们卖的是内容营销功能，不是"把 Inngest 的功能转售给第三方"。按 MongoDB/Elastic 对 SSPL 的一贯口径与社区通行解读，**这属于"内部使用/自用编排引擎"，不触发 §13**。§13 的靶子是"你拿它去开一个 Inngest 的托管竞品"（DBaaS 式转售）。
2. 触发 §13 的边界在：**如果我们把"工作流编排能力本身"作为产品特性暴露给终端商家**（例如让商家自定义 workflow、把 Inngest dashboard 直接透出、卖"工作流即服务"），风险显著上升。我们的产品是**前台无槽位、一键代理**（见 D-030），编排层对商家不可见，这条**天然规避了 §13**。
3. **我们不修改、不转售服务端**，只作为二进制部署 → 合规成本≈0。**一旦 fork 改源码**，SSPL §5 要求整体以 SSPL 再授权，且 §13 的服务源码公开义务开始逼近——**红线：不要 fork 改 Inngest 服务端**。
4. SSPL **非 OSI 认证的开源许可**。若未来引入投资人/大厂尽调，SSPL 依赖会被单独标注。但它**不是商业专有**，自托管零 license 费。

> **建议**：把 Inngest 服务端当作**"部署的二进制黑盒 + Apache SDK 集成"**使用，不 fork、不转售编排能力、不透出 dashboard。在此边界内 SSPL 不构成实质障碍。若法务要求零 SSPL 暴露，则退路是 §7 对比里的 Apache/MIT 候选（Temporal/DBOS）。

### 1.3 self-host 版 vs 云版功能差异清单——核心疑点，已用源码坐实【官方核实】

**这是本次调研最重要的一手证据**：直接 grep OSS 服务端 Go 源码，确认以下高级能力**都在开源二进制里**，不是云独占：

| 能力 | OSS 服务端是否自带 | 源码佐证（本地 `inngest/pkg/…`） |
|---|---|---|
| Connect（WebSocket 常驻 worker） | ✅ 在 | `pkg/connect/`、`pkg/config/connect/`、`pkg/execution/driver/connectdriver/` |
| Realtime（进度流） | ✅ 在 | `pkg/execution/realtime/`（含 `docs/` broadcaster 架构） |
| AI Gateway（step.ai.infer 代理） | ✅ 在 | `pkg/util/aigateway/aigateway.go`、`request.go` |
| Signals（waitForSignal/sendSignal） | ✅ 在 | `pkg/enums/opcode*.go` 含 WaitForSignal opcode |
| Flow control（并发/节流/去抖/限流/批处理） | ✅ 在 | README「Queue — multi-tenant aware, multi-tier」+ 队列相关 changelog |
| GraphQL + REST API、Dashboard UI | ✅ 在 | `--no-ui` flag 存在即证明默认自带 |

**真正的自托管 vs 云差异不在"功能有无"，而在"运维与规模"**【官方核实，来自 docs/self-hosting + 社区】：

- **用量上限**：云版的 Free/Basic/Pro 计划上限（见 §2.4）是**计费分层**，自托管**不受这些计划墙限制**，改由你的 Redis/PG 容量与配置决定。
- **数据保留**：自托管服务端**不自动删除旧行**（events/runs/traces），表无限增长会拖慢 run 检索——**必须自建保留策略**（cron 清理）。
- **官方支持**："Inngest's support team does not guarantee direct support for self-hosted instances"，企业支持要联系 sales。
- **规模化**：默认内嵌 Redis + SQLite 只单节点；多节点须外接 PG + Redis（见 §3）。
- **App sync 轮询**：自托管默认关闭，须 `--poll-interval` 显式开。

> 结论：**自托管在"编排语义"上与云几乎零落差**（同一 Go 二进制），落差集中在"上限解锁靠你自己的基建"和"没有官方 SLA"。对验证期而言这是**加分项**——花钱买不到的高级原语免费自托管。

### 1.4 生产采用信号【官方核实 + 推断】

- 官方博客 `Announcing Inngest self-hosting`（2024 底 1.0）+ Postgres 后端（CLI v1.4.0+，2025-01）+ 官方 Helm chart（`inngest/inngest-helm`，带 PG/Redis/KEDA 自动扩缩）。
- Railway / Zeabur 均有一键生产模板。
- **缺口**：没有搜到公开署名的"某公司在生产自托管 Inngest"案例。多数生产用户跑**云版**；自托管生态偏早期（realtime 包 0.x、Postgres 后端才一年多）。【推断】自托管生产成熟度 = **可用但需要你自己扛运维**，不是"开箱即企业级 HA"。

---

## 2. Durable 语义逐项核实

### 2.1 step.run 的 checkpoint / 重放机制【官方核实：源码 + docs】

**模型 = event-replay memoization（步骤级记忆化），非进程快照。** 来自 `inngest-js/packages/inngest/CLAUDE.md`「Step Memoization Process」与源码 `src/components/execution/{v1,v2}.ts`：

1. 函数每次被服务端调用都从头重跑代码（"dry run"），SDK 逐个声明遇到的 step。
2. 对每个 step，SDK 把 **step 的字符串 ID + 一个计数器** 做 hash，去函数已存 state 里查。
3. **命中 → 直接返回 memoized 结果，不重新执行 step 体**；未命中 → 执行该 step，把结果写回 state，然后**（默认）该次 HTTP 响应就结束、服务端把下一步重新排队**。
4. 因此"crash 后断点续跑"= 已完成 step 的输出都在 state 里，重跑时被记忆化跳过，只有未完成的 step 真正执行。

关键约束【官方核实，usage-limits】：
- **单函数最多 1000 个 step**（硬上限）。
- **单个 step 返回数据 ≤ 4MB**（硬上限）。
- **整个 run 的 state ≤ 32MB**（硬上限）——**对我们最需警惕**：ContextBundle + Brief + 多模型候选如果都塞进 step 返回值，容易撞 32MB。**大产物（图/视频/长文）必须存 TOS/对象存储，state 里只放 URL/引用**。
- step 体本身执行时长上限 ~2 小时（依托管环境）。

`step.run` 幂等前提：step 体应可安全重跑（memoization 只保证"成功后不再跑"，但**失败重试会整体重跑 step 体**）。副作用要幂等。

错误控制【官方核实，CLAUDE.md 示例】：`throw new NonRetriableError(...)` 停止重试；`throw new RetryAfterError("msg","30s")` 延迟重试；默认异常走自动重试（默认 4 次，可 `retries` 配置）。

### 2.2 step.waitForEvent —— 挂起等外部事件【官方核实：源码 InngestStepTools.ts:653】

```ts
await step.waitForEvent("wait-approval", {
  event: "content/approved",
  match: "data.taskId",          // 或 if: "event.data.taskId == async.data.taskId"（CEL 表达式）
  timeout: "7d",                  // ms 字符串 / number / Date / Temporal
});
// 命中 → 返回该事件；超时 → 返回 null
```

- **匹配语义**：`match: "data.taskId"` 被编译成 CEL `event.data.taskId == async.data.taskId`（源码 line 703），保证只接住"属于本 run"的审批事件；也可用 `if` 写任意 CEL。
- **超时返回 null**（源码类型 `WaitForEventResult`），不抛错——恰好对应"审批超时走默认/提醒"分支。
- **最长等待时长**：源码层不设硬上限（timeout 只是个时间串）；**实际上限 = 该 run 的"函数运行总时长"上限**：云版计划分层 Free 30 天 / Basic 90 天 / Pro 366 天（§2.4）；**自托管则由你的 state 保留策略决定**——只要 Redis/PG 里的 run state 没被清，就能一直挂起。项目要求"挂数小时至数天"完全覆盖，**自托管下挂几周也可行**（前提：保留策略别把它清了）。

### 2.3 step.waitForSignal —— 新增，更接近 Temporal signal【官方核实：源码 line 521，标 EXPERIMENTAL】

```ts
const res = await step.waitForSignal("await-clarify", {
  signal: `clarify.${taskId}`,   // 具名信号，全局唯一键
  timeout: "3d",
  onConflict: "replace",          // 同名信号冲突策略
});
// 另一处：await step.sendSignal("id", { signal: `clarify.${taskId}`, data });
```

- 与 waitForEvent 的区别：**信号是点对点具名唤醒**（不走事件匹配表达式），语义更贴近"用户澄清/审批"这种定向恢复。
- ⚠️ **EXPERIMENTAL**：源码注释明写 "API is not yet stable and may change without a major version bump"。**验证期可用于澄清挂起，但别把它当稳定契约写死。**

### 2.4 step.sleep / sleepUntil【官方核实：源码 line 811/843 + usage-limits】

```ts
await step.sleep("cooldown", "30m");                 // 相对
await step.sleepUntil("run-at", new Date(...));       // 绝对；支持 Temporal.Instant
```

- **sleep 上限**：付费云"up to a year"（1 年）；Free 计划 7 天。**自托管不受计划墙**，实际由 state 保留决定。分钟级视频轮询的 sleep（几十秒~几分钟）远在上限内。
- sleep 期间**不占用执行槽**（服务端定时重新入队），成本仅是队列项。

### 2.5 cancelOn / 并发键 / 幂等去重 / 批处理【官方核实：README + docs】

- **cancelOn**：函数配置里声明 `cancelOn: [{ event: "task/cancelled", match: "data.taskId" }]`，匹配事件到达即取消在飞 run（README「Cancels running functions with matching cancelOn expressions」）。对应"商家中途撤销 Task"。
- **并发键**：`concurrency: { key: "event.data.merchantId", limit: N }`（README 示例 line 34-37）——**天然多租户隔离**，可给每个美业商家限并发，防单商家刷爆。
- **幂等/去重**：Flow control 提供 debounce、rate limit、throttle、singleton；事件可带 `id` 做去重（同 id 事件只触发一次）。
- **批处理** `batchEvents`：把多个事件攒成一批喂给一次函数运行。

### 2.6 函数代码升级时 in-flight 实例的行为 —— revision fencing 可实现性【官方核实：docs/learn/versioning】

**Inngest 无显式函数版本 API**（对比 Temporal 的 `patched()`/`GetVersion`，这是**明确的能力差异**）。它靠 step-hash 确定性重放处理代码变更：

| 变更类型 | in-flight run 行为 |
|---|---|
| 加新 step（同一函数） | **新 step 会被在飞 run 执行**（"New steps are executed when discovered"）→ 可安全加日志/分析 |
| 改某 step 逻辑但**保持同 ID** | 已完成该 step 的 run **用 memoized 旧结果**，不重跑新逻辑；只有新 run 走新逻辑 |
| 删 step | memoized 数据留在 state 但被忽略，在飞 run 正常跑完 |
| 重排 step 顺序 | 优雅处理——memoized 按 ID hash 返回，与代码位置无关 |
| **改 step ID** | ⚠️ 视为新 step，**在飞 run 会重跑** → 破坏幂等，禁止随意改 ID |

破坏性重写的官方模式：**"两个函数订阅同一事件 + `if` 按 timestamp 路由"**——老 run 用老函数跑完，新事件走新函数。

**对项目"revision fencing"要求的直接回答【推断，结论明确】**：

项目的 fencing 语义是**应用层**的——"恢复时防旧结果覆盖 ContentPackage 新版本"。Inngest **不提供**这种"run 与业务资源版本"的自动围栏。但它**可以且应该在 ⑤ 段自己实现**，而且 Inngest 的模型**帮了忙**：

- run 启动时把当时的 `contentPackageRevision` 冻结进不可变 ContextBundle（step ②）；这个值被 memoize，**跨数天挂起后恢复时依然是启动时的旧值**。
- ⑤ 段落库用**条件写**：`UPDATE ... WHERE revision = :capturedRevision`（乐观锁 / CAS）。若期间用户产生了更新版本 → 影响 0 行 → `throw new NonRetriableError("stale revision, superseded")`，DecisionTrace 里留痕"因版本过期被丢弃"。

→ **fencing 可实现，但是我们写，不是 Inngest 送。** 若想要框架级"版本感知恢复"，那是 Temporal `GetVersion` 的地盘（§7）。

---

## 3. 栈契合

### 3.1 生产自托管怎么跑（单二进制 + 附属）【官方核实：cmd/start/cmd.go + Dockerfile + docs】

**单个 Go 二进制**，两种模式：

- `inngest dev` —— 开发模式（热重载，内嵌一切，`npx inngest-cli@latest dev`，dashboard :8288）。
- **`inngest start` —— 生产模式，"Run the Inngest server with external persistence"**（源码 `cmd/start/cmd.go` usage 原文）。关键 flag（逐字来自源码）：

| flag | 作用 | 默认 |
|---|---|---|
| `--redis-uri` | 队列 + run state 的 Redis | 缺省=**内嵌 in-memory Redis + 周期快照备份** |
| `--postgres-uri` | 配置 + 历史持久化的 PostgreSQL | 缺省=SQLite |
| `--sqlite-dir` | SQLite 目录 | `./.inngest/main.db` |
| `--signing-key` | 服务端↔app 签名密钥（hex） | 必配 |
| `--event-key` | app 发事件用的 key | 必配 |
| `--sdk-url` | 要同步的 app serve URL | — |
| `--connect-gateway-port` | Connect WebSocket 网关端口 | 默认（社区文档：8289） |
| `--queue-workers` | executor worker 数 | 默认 100 |
| `--poll-interval` | app 同步轮询秒数 | 0（关） |
| `--no-ui` | 关 Web UI + GraphQL | — |

**生产附属依赖清单**【官方核实】：
- **PostgreSQL**（配置/历史/事件/traces；CLI v1.4.0+ 起支持，2025-01）——多节点必需。
- **Redis**（队列 + run state）——多节点必需外接**带持久化与故障转移的 HA Redis**。官方原话："state store, queueing systems, and messaging systems must be highly available… recommends hosted, HA Redis, SQS/SNS, or Google Pub/Sub."
- 单节点验证期可只跑二进制（内嵌 Redis+SQLite），但**内嵌 Redis 只做周期快照，crash 有丢窗口**——**验证期就该外接托管 Redis + 托管 PG**，与项目「Hyperdrive→托管 PG」现状一致。
- Docker 镜像基于 `alpine:3.24`，仅 ca-certificates + tzdata，**镜像极小、无额外系统依赖**（Dockerfile 已核对）。
- K8s 走官方 `inngest/inngest-helm`（bundled PG/Redis + 可选 KEDA autoscaling）。

### 3.2 与 Next.js / Node 服务的 serve 集成【官方核实：SDK adapters】

SDK 提供 15+ 框架 adapter，每个导出 `serve()`：

```ts
// app/api/inngest/route.ts（Next.js App Router）
import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { taskHarness } from "@/inngest/functions";
export const { GET, POST, PUT } = serve({ client: inngest, functions: [taskHarness] });
```

- 有 `inngest/next`、`inngest/express`、`inngest/fastify`、`inngest/hono`、`inngest/node`（常驻 Node）、`inngest/cloudflare` 等。
- 常驻 Node 服务：既可用 HTTP `serve()`（服务端反向 HTTP 调你的 `/api/inngest`），也可用 **Connect**（见 3.4，推荐给常驻进程）。

### 3.3 事件能否从 Cloudflare Workers 壳发出【官方核实 + 推断】

**能。** 发事件只是一个 HTTP POST 到 Event API（`inngest.send({...})`），SDK 有 `inngest/cloudflare` adapter，`inngest.send()` 在 Workers 运行时可用（fetch-based，无 Node 依赖）。

→ **架构落位**：CF Workers 壳负责鉴权 + `inngest.send({ name: "task/created", data: {...} })` 把 Task 丢进 Inngest；**真正的五段式函数跑在常驻 Node 服务上**（视频 ffmpeg 薄壳、长任务都需要 Node 运行时，不能跑在 Workers 里）。这与项目「Workers 壳 + 单 Node 常驻服务」现状**严丝合缝**。

### 3.4 对非 serverless 常驻 Node 的支持 —— Connect【官方核实：CONNECT_SDK_SPEC.md】

**Connect = 常驻 worker 的一等公民方案**，正是为"长驻 Node 进程"设计：

- worker 用 WebSocket **主动反连** gateway（`POST /v0/connect/start` 拿 endpoint → WS 子协议 `v0.connect.inngest.com` → 三段握手 `GATEWAY_HELLO`/`WORKER_CONNECT`/`GATEWAY_CONNECTION_READY`）。
- **服务端不需要公网可达你的 worker**——是 worker 连出去。对"不可公网寻址的常驻 Node 服务"是决定性优势（HTTP serve 模式则要求服务端能反向 HTTP 打到你的 endpoint）。
- 心跳（默认 10s）+ 租约续期（默认 5s）+ 优雅 draining（WORKER_PAUSE），支持滚动发布不丢在飞请求。
- **延迟**：Connect 保持长连接，省掉每步新建 HTTP 的开销，是官方标称"最低延迟"的执行路径。

```ts
import { connect } from "inngest/connect";
const conn = await connect({ apps: [{ client: inngest, functions: [taskHarness] }] });
// 常驻进程；SIGTERM 时 conn.close() 触发 draining
```

> ⚠️ Connect gateway 端口（8289）**须对 worker 可达**；自托管时这是你内网/VPC 内的连通，不必公网暴露。

---

## 4. 进度事件：run 状态查询 / realtime / 前端白话进度流

### 4.1 Realtime（推荐给"白话进度流"）【官方核实：@inngest/realtime v0.4.7 源码 + docs】

五个原语：**Channel（作用域，如 runId/商家/会话）· Topic（数据类别，如 status/tokens/artifact）· Token（前端订阅授权）**。

**函数内发布**（两种）：
- `step.realtime.publish("id", topicRef, data)` —— **durable，memoized，重试不重发**（源码 line 557），用于重要状态跃迁（"意图已确认"/"Brief 已生成"/"视频渲染中"）。
- `publish()` / `inngest.realtime.publish()` —— 非 durable，高频轻量（如 token 流），可接受重放。

**前端订阅**【官方核实：源码 `packages/realtime/src/hooks.ts:47`】：React hook 名 = **`useInngestSubscription`**（WebFetch 一度写成 `useRealtime`，以本地源码为准）。先由 server action 用 `getSubscriptionToken()` 铸时限 token，再：

```tsx
const { data, state } = useInngestSubscription({ token });
// data 按 topic 分组的强类型消息；含 connectionStatus / runStatus
```

- Realtime **在 OSS 服务端自带**（`pkg/execution/realtime/`），自托管可用。
- ⚠️ 包仍 **0.4.x**，API 未定稿（channel/topic schema、hook 签名可能变）。**白话进度这条链路能落地，但要接受升级期签名变动。**

### 4.2 REST run 状态查询【官方核实：docs REST API + changelog】

- 有 REST/GraphQL API 查 run 状态、step 详情、traces（v1.37.0 还加了 v2 score endpoint 给 run/step 打named 分数）。
- 前端"白话进度"**首选 Realtime 推**（低延迟、事件驱动），REST 作为"页面刷新时拉当前快照"的兜底。
- DecisionTrace：每个 step 自动进 trace（tracing V4，源码 `pkg/tracing/`），可 REST 拉全链路——**天然满足"全程 DecisionTrace 可审计"**，我们额外把五段式的语义元数据挂上去即可。

---

## 5. 平移成本：自托管生产成熟度 + 迁中国云

### 5.1 自托管生产成熟度证据【官方核实】

- **正面**：单二进制 + 标准 PG/Redis + 官方 Helm（KEDA autoscaling）+ Railway/Zeabur 模板；Connect/Checkpointing 已把 HTTP 延迟打到"近零步间延迟、整体工作流时长 -50%"（2025-12 developer preview）。
- **负面/需自扛**：
  - 无官方自托管 SLA/直接支持。
  - **不自动清旧数据**——events/runs/traces 表无限增长会拖慢，必须自建 cron 保留策略。
  - PG 若配置不足，高负载下会慢。
  - realtime（0.4.x）+ signals（experimental）+ defer（experimental）多个我们要用的原语仍在早期。
  - 无公开署名的"生产自托管"大案例。

【推断】成熟度评级：**"验证期/早期生产可用，中大规模自托管需要一名懂 Go 服务 + Redis/PG 运维的人扛"**。对当前验证期（CF + 托管 PG）**足够**。

### 5.2 迁中国云评估【官方核实 + 推断】

**利好信号（一手）**：本地 `go.mod:5` 有 `replace github.com/tencentcloud/tencentcloud-sdk-go … => v1.0.191`——**服务端代码路径里已引入腾讯云 SDK**（大概率为对象存储/COS 或相关集成的可选后端）。说明官方对中国云生态**并非零适配**。

**迁移友好点【推断，但依据充分】**：
- 依赖面**极干净**：一个 Go 二进制 + PostgreSQL + Redis。这三样中国云全有一等托管（腾讯云 TencentDB for PostgreSQL + 云数据库 Redis；阿里云 RDS PG + Tair/Redis）。**没有任何"只有 AWS/GCP 才有"的硬依赖**。
- 二进制自带、无需外部消息队列（内建队列在 Redis 上）——**比 Temporal（需独立 Temporal Server 集群 + Cassandra/PG）平移更轻**。
- Docker 镜像 alpine 极小，**上任意中国云容器服务（TKE/ACK/SAE）零改造**。
- state ≤ 32MB、产物走对象存储的设计，正好把大文件放腾讯云 TOS/COS，与项目「火山 TOS」现状一致。

**迁移风险点**：
- SSPL 在中国法域同样有效（版权法通用），但**自用不转售**的判断不因法域改变——风险不放大。
- 若届时用云版 Inngest（而非自托管）则**无法迁中国**（数据出境 + 服务在境外）——**所以要迁中国就必须走自托管这条路，从第一天起就别绑云版独有的东西**（目前看核心原语都在 OSS，绑定风险低）。

**平移成本评级【推断】：低**。是本批候选里对"整体迁中国云"最友好的形态之一（单二进制 + 通用 PG/Redis + 已有腾讯云 SDK 痕迹）。

---

## 6. 五段式 Harness 用 Inngest 落地骨架（英文代码）

> 设计要点：一个客户 Task = 一个 Inngest function，`task/created` 触发；五段各自是 step（自动 memoize + trace）；分钟级视频用「kick-off step + sleep 轮询 step」；人审用 `waitForEvent` 挂起数天；每段用 `step.realtime.publish` 推白话进度；⑤ 段做 revision fencing 条件写。大产物只落 URL，不进 state。

```ts
// inngest/client.ts
import { Inngest } from "inngest";
import { realtimeMiddleware } from "@inngest/realtime";

export const inngest = new Inngest({
  id: "beauty-content-agent",
  middleware: [realtimeMiddleware()],
  // self-host: baseUrl points at our inngest start server (Hyperdrive/PG + HA Redis)
});

// inngest/channels.ts — typed progress channel, one per Task run
import { channel, topic } from "@inngest/realtime";
import { z } from "zod";

export const taskChannel = channel((taskId: string) => `task:${taskId}`)
  .addTopic(topic("progress").schema(z.object({           // 白话进度
    stage: z.enum(["intent", "context", "brief", "generate", "deliver"]),
    humanMessage: z.string(),                              // "正在为你构思三版文案…"
    pct: z.number(),
  })))
  .addTopic(topic("tokens").type<string>());               // 可选：文案 token 流
```

```ts
// inngest/harness.ts — the five-stage Task Harness
import { NonRetriableError } from "inngest";
import { inngest } from "./client";
import { taskChannel } from "./channels";

export const taskHarness = inngest.createFunction(
  {
    id: "task-harness",
    concurrency: { key: "event.data.merchantId", limit: 5 },  // 多租户隔离
    cancelOn: [{ event: "task/cancelled", match: "data.taskId" }],
    retries: 3,
  },
  { event: "task/created" },
  async ({ event, step, publish }) => {
    const { taskId, merchantId } = event.data;
    const ch = taskChannel(taskId);
    const say = (stage: any, humanMessage: string, pct: number) =>
      step.realtime.publish(`say-${stage}`, ch.progress, { stage, humanMessage, pct });

    // ── ① 意图正名（LLM 结构化输出，可重试）──────────────────────────
    const intent = await step.run("normalize-intent", async () => {
      return await llmStructured(event.data.rawInput);   // -> { goal, channel, tone, constraints }
    });
    await say("intent", "已读懂你的需求，正在准备素材", 15);

    // ── ② 上下文注入（确定性组装 immutable ContextBundle）────────────
    //    关键：在此冻结 contentPackageRevision，供 ⑤ 段做 fencing
    const ctx = await step.run("build-context", async () => {
      const pkg = await loadContentPackage(taskId);       // 当前版本
      return Object.freeze({
        merchantProfile: await loadMerchantProfile(merchantId),
        brandKit: await loadBrandKit(merchantId),
        redlines: await loadRedlines(intent.channel),     // 医美红线等
        capturedRevision: pkg.revision,                   // ← fencing 锚点
      });
    });

    // ── ③ Brief 编译（LLM）──────────────────────────────────────────
    const brief = await step.run("compile-brief", () => compileBrief(intent, ctx));
    await say("brief", "创作大纲已生成", 35);

    // ── ④ 执行与择优（N 选 1 + 红线门禁）──────────────────────────────
    // 4a. 文案：并发生成 N 版 + 确定性择优
    const candidates = await Promise.all(
      [0, 1, 2].map((i) =>
        step.run(`draft-copy-${i}`, () => genCopy(brief, ctx, i))  // 每版独立可重试
      )
    );
    const bestCopy = await step.run("select-best-copy", () => rankAndPick(candidates, ctx));

    // 4b. 确定性红线门禁（硬停，不可重试绕过）
    await step.run("redline-gate", () => {
      const v = checkRedlines(bestCopy, ctx.redlines);
      if (!v.pass) throw new NonRetriableError(`redline blocked: ${v.reason}`);
    });

    // 4c. 视频成片：分钟级长任务 → kick-off + sleep 轮询
    await say("generate", "正在生成视频，约需几分钟", 55);
    const videoJobId = await step.run("kickoff-video", () =>
      submitVideoJob(bestCopy, ctx));                     // Seedance/即梦，返回 jobId
    let videoUrl: string | null = null;
    for (let attempt = 0; attempt < 40; attempt++) {      // 上限兜底
      const status = await step.run(`poll-video-${attempt}`, () =>
        pollVideoJob(videoJobId));                        // 只返回 {state,url}，不返回二进制
      if (status.state === "done") { videoUrl = status.url; break; }
      if (status.state === "failed")
        throw new Error(`video job failed: ${videoJobId}`);
      await step.sleep(`wait-video-${attempt}`, "20s");   // sleep 不占执行槽
    }
    if (!videoUrl) throw new Error("video timed out");
    // ffmpeg 标识烧录后落对象存储；state 只留 URL
    const finalVideoUrl = await step.run("burn-and-store", () =>
      burnWatermarkAndUpload(videoUrl, ctx));

    // ── 人审挂起（可挂数小时~数天；超时走默认）─────────────────────────
    await say("generate", "内容已就绪，等待你确认发布", 80);
    await step.run("request-approval", () => notifyMerchantForApproval(taskId));
    const approval = await step.waitForEvent("await-approval", {
      event: "content/approval",
      match: "data.taskId",
      timeout: "3d",                                       // 自托管下可更长
    });
    if (!approval) {
      await step.run("mark-expired", () => markTaskExpired(taskId));
      return { status: "approval_timeout" };
    }
    if (approval.data.decision === "reject") {
      return { status: "rejected", reason: approval.data.reason };
    }

    // ── ⑤ 回装与交付（revision fencing 条件写）───────────────────────
    const result = await step.run("deliver", async () => {
      // 乐观锁：只有 Task 起点冻结的 revision 仍是最新，才落库
      const affected = await db.contentPackage.updateWhere(
        { taskId, revision: ctx.capturedRevision },        // CAS
        { revision: ctx.capturedRevision + 1, copy: bestCopy, videoUrl: finalVideoUrl },
      );
      if (affected === 0)
        throw new NonRetriableError("stale revision: superseded by newer edit"); // ← 防旧覆盖新
      return { revision: ctx.capturedRevision + 1 };
    });
    await say("deliver", "已发布，去看看效果吧", 100);
    return { status: "delivered", ...result };
  },
);
```

**映射要点复盘**：

- **断点续跑**：每段是独立 step，crash 后 memoized 段跳过，只续未完成段。视频轮询 40 次是 40 个独立 step（注意逼近 1000 step 上限时要收敛轮询次数或改用 webhook `waitForEvent`）。
- **等待即挂起**：`waitForEvent("3d")` 期间 run 不占资源，服务端定时检查；数天恢复无压力。
- **分钟级视频**：两种写法——① 上面的 `sleep + poll`（简单，适合无 webhook 的模型）；② 若视频服务能回调，改成 `await step.waitForEvent("video-done", { match:"data.jobId", timeout:"30m" })`，更省 step 数、更实时。**推荐能回调就用 waitForEvent。**
- **revision fencing**：靠 ② 段冻结 + ⑤ 段 CAS 条件写，`NonRetriableError` 让旧 run 优雅认输并留痕。
- **白话进度**：每段 `step.realtime.publish`（durable），前端 `useInngestSubscription` 收。
- **红线门禁**：确定性 step + `NonRetriableError` = 硬停，不会被重试绕过。
- **DecisionTrace**：所有 step 自动进 tracing V4，REST 可拉全链。

---

## 7. 对照 Temporal 范式的完备度简评

| Temporal 原语 | Inngest 对应 | 完备度评价 |
|---|---|---|
| Workflow（确定性重放 VM） | function + step-hash memoization | ✅ 达成"断点续跑"，但**模型不同**：Temporal 是严格确定性重放（workflow 内禁 I/O），Inngest 是"每次从头重跑 + step 记忆化"，**更宽松更好写**，代价是 step 边界外的非确定性分支要自己当心 |
| Activity（副作用单元） | `step.run` | ✅ 对等，自动重试 + 超时 |
| Signal（异步注入） | `step.waitForEvent`（CEL 匹配）+ `step.waitForSignal`（具名，experimental） | ✅ 覆盖，waitForEvent 更强（表达式匹配）；具名 signal 尚 experimental |
| Query（同步读在飞状态） | ❌ **无直接对等** | ⚠️ **能力缺口**：Inngest 不能同步查询运行中 workflow 的内部变量；只能用 Realtime 推或 REST 拉 run 快照。对我们影响小（我们要的是"推进度"不是"查内部变量"） |
| Timer | `step.sleep` / `sleepUntil` | ✅ 对等，上限 1 年 |
| Child Workflow | `step.invoke`（等结果）/ `defer`（fire-and-forget 具名，experimental）/ `sendEvent`（广播） | ✅ 覆盖，粒度更丰富 |
| Cancellation | `cancelOn` 事件 + REST cancel | ✅ 对等 |
| **Versioning（`patched`/`GetVersion`）** | ❌ **无显式版本 API** | ⚠️ **最实质的缺口**：Temporal 用 `GetVersion` 让在飞 run 走"启动时的代码分支"（真·版本围栏）；Inngest 只有"step-ID 稳定 + timestamp 双函数路由"这种约定式变通。**项目要的 revision fencing 因此得自己在应用层做（§2.6/§6 已给方案）** |
| Continue-As-New（长历史截断） | 无直接对等（靠 32MB state 上限约束） | ⚠️ 超长/超大 run 需自行拆分 |
| 并发/限流/去抖/批处理 | Flow control 内建 | ✅ **比 Temporal 更开箱**（Temporal 要自己在 worker 侧配 rate limiter） |

**一句话**：Inngest 覆盖了 Temporal **约 80% 的 durable 原语**，且在**并发/限流/事件匹配/AI step/realtime** 上更开箱、运维重量小一个数量级；**缺的 20%** 集中在 **显式版本 API、同步 Query、Continue-As-New** ——其中**只有"显式版本 API"对本项目有实际影响**（revision fencing 要自己写）。对"内容营销 Agent"这类**事件驱动、人审挂起、AI 择优**的负载，Inngest 的范式契合度**高于** Temporal 的重型确定性范式。

---

## 8. 风险清单

| # | 风险 | 严重度 | 说明与缓解 |
|---|---|---|---|
| R1 | **SSPL 许可证** | 高（需法务确认）| §13 SaaS 转售毒丸。缓解：**不 fork、不转售编排能力、不透出 dashboard**，作为自用二进制黑盒 → 通行解读下不触发。若法务零容忍 → 退 Temporal/DBOS（Apache/MIT） |
| R2 | **无显式版本 API / revision fencing 靠自己** | 中 | in-flight 会碰新部署的代码；破坏性改动要"双函数 timestamp 路由"。fencing 须应用层 CAS（§2.6/§6）。**教育团队：step ID 一旦上线不可改** |
| R3 | **state 硬上限 32MB / step 输出 4MB / 1000 step** | 中 | 大产物（图/视频/长文）**必须走对象存储**，state 只放 URL；视频轮询 step 数要收敛（优先 webhook waitForEvent 而非 40 次 poll） |
| R4 | **HTTP 拉取模型的时延** | 中→低 | 默认每 step 一次 HTTP 往返有延迟；**已被 Connect（WebSocket 长连）+ Checkpointing（2025-12 preview，近零步间延迟、工作流时长 -50%）缓解**。常驻 Node 用 Connect |
| R5 | **多个要用的原语仍早期** | 中 | realtime 0.4.x、waitForSignal/defer experimental。缓解：进度用 realtime 但接受签名变动；澄清挂起优先用**稳定的 waitForEvent** 而非 experimental signal |
| R6 | **自托管运维自扛** | 中 | 无官方 SLA；**不自动清数据**（须 cron 保留策略）；PG 配小会慢；HA Redis 要自己保证。缺公开生产自托管大案例 |
| R7 | **内嵌 Redis 只快照** | 低（有解）| 验证期就外接托管 Redis + 托管 PG（与项目现状一致），别用内嵌生产 |
| R8 | **realtime 依赖前端订阅链路** | 低 | token 铸造 + WebSocket 订阅有一定接线成本；REST run 快照做兜底 |
| R9 | **社区高频 issue** | 未定 | 未取到公开 issue 频率统计（缺口）；建议落地前扫 `inngest/inngest` + `inngest-helm` issues 与 Discord。发布节奏每周一 minor = 活跃但也意味 API 面在动 |

**未能完全核实（诚实标注）**：waitForEvent 的绝对最大 timeout（docs 未列硬数，源码无上限，实测受 run 总时长/保留策略约束）；生产自托管的具名大客户案例；社区 issue 高频主题的量化。这三项建议落地前用真实账号/实测补齐。

---

## 附：全部来源 URL

**本地一手源码（最高可信）**
- `references/repos/harness-2026-07-17/inngest/`：`LICENSE.md`、`README.md`、`CHANGELOG.md`、`go.mod`、`Dockerfile`、`cmd/start/cmd.go`、`pkg/connect/`、`pkg/execution/realtime/`、`pkg/util/aigateway/`、`pkg/enums/opcode*.go`、`CLAUDE.md`
- `references/repos/harness-2026-07-17/inngest-js/`：`packages/inngest/package.json`、`packages/realtime/package.json`、`packages/inngest/src/components/InngestStepTools.ts`、`packages/inngest/src/components/connect/CONNECT_SDK_SPEC.md`、`packages/inngest/src/components/execution/defer.md`、`packages/inngest/CLAUDE.md`、`packages/realtime/src/hooks.ts`

**官方文档 / 站点**
- https://www.inngest.com/docs/self-hosting
- https://www.inngest.com/docs/learn/versioning
- https://www.inngest.com/docs/features/realtime
- https://www.inngest.com/docs/usage-limits/inngest
- https://www.inngest.com/docs/features/inngest-functions/steps-workflows/sleeps
- https://www.inngest.com/docs/features/inngest-functions/steps-workflows/wait-for-event
- https://www.inngest.com/docs/reference/typescript/functions/step-wait-for-event
- https://www.inngest.com/docs/setup/connect
- https://www.inngest.com/docs/improve-performance
- https://github.com/inngest/inngest（README：SSPL + Apache SDK；~5.6k stars）
- https://github.com/inngest/inngest/releases（v1.37.0 / v1.36.0 / v1.35.0）
- https://github.com/inngest/inngest-helm（Helm：PG + Redis + KEDA）
- https://www.inngest.com/blog/inngest-1-0-announcing-self-hosting-support
- https://railway.com/deploy/inngest-production-template
- https://zeabur.com/templates/LIJ1O7

**第三方 / 社区**
- https://hookdeck.com/webhooks/platforms/inngest-alternatives（Inngest vs Temporal/Trigger.dev/Restate）
- https://news.ycombinator.com/item?id=40812427（HN：与 Temporal/Inngest 对比讨论）
- https://joelclaw.com/self-hosting-inngest-background-tasks（自托管实践）
