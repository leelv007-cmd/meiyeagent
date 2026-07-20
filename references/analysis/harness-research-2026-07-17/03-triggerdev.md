# 候选深调 03 — Trigger.dev（问题 A 候选 A3）

> **交叉验证裁定（Codex，2026-07-17）：成立但需修正（核心结论未动摇：能力完整但自托管最重、验证期不作主线）** — 全文见 `xcheck/r03-xcheck.md`；引用本报告断言前先对照裁定。

- 日期：2026-07-17
- 调研员：候选组件深度调研员（Trigger.dev 专项）
- 源码镜像：`references/repos/harness-2026-07-17/trigger.dev/`（depth-1，git HEAD `73d966a`，2026-07-17）
- 核实基线：镜像内 `package.json` / `docs/*` / `internal-packages/run-engine/*` / `hosting/docker/*` 为**一手源码**；线上 changelog / 融资 / issue 为**二手佐证**。
- 标注约定：**【官方核实】**=镜像源码或官方文档直证；**【推断】**=基于源码逻辑与架构的推理，未逐字直证。

---

## 0. 一句话结论

Trigger.dev v4.5.4（Apache-2.0）是本轮候选里**功能最完整、但架构最重**的一项：durable execution + Realtime 进度流 + waitpoint 人审 + ffmpeg/视频扩展**全部开箱**，`.wait()` / `wait.forToken()` 的挂起语义和 `useRealtimeRun` 的「白话进度事件」几乎是为我们三进三出合同量身定做。但它**不是库、是平台**——任务代码要打成 Docker 镜像部署到独立实例、在 supervisor 管理的容器里跑，与我们「Workers 壳 + 单 Node 常驻服务 + pg-boss 嵌入」的验证期架构**根本不同**；自托管是 8+ 服务的 Docker/K8s 栈，且**自托管版砍掉了 checkpoint（等待改为阻塞占容器）**。它是「验证期基建最重、但能力最全」的特殊项。

---

## 1. 版本 / 许可证 / 发布节奏 / 生产采用

| 维度 | 事实 | 来源 |
|---|---|---|
| 最新版本 | **v4.5.4**（`@trigger.dev/sdk` / `core` / `cli-v3` / `react-hooks` 同版本号）| 【官方核实】镜像 `packages/*/package.json` |
| v4 GA | **2025-08-18** 正式 GA（Launch Week 2）| 【官方核实】trigger.dev/changelog/trigger-v4-ga |
| 许可证 | **Apache-2.0**（整仓单一 LICENSE，无 BSL/SSPL 例外）| 【官方核实】镜像 `LICENSE`，README badge |
| 发布节奏 | 极高频，**约 1–3 天一个 patch**；v4.5.0 前有 rc.3→rc.7 密集 RC | 【官方核实】GitHub releases |
| 引擎版本 | **Run Engine 2.0**（内部包 `@internal/run-engine`）。v3 的 V1 引擎（MarQS + Graphile worker）**已 EOL 且执行代码已删除**；4.5.0 是最后支持跑 v3 任务的版本，4.5.1+ 直接拒绝 v3 触发/部署 | 【官方核实】`AGENTS.md`、`docs/self-hosting/overview.mdx` |
| 融资 | $3M 种子（2023-08）+ $16M A 轮，累计 ~$16.5M | 【二手】trigger.dev/blog、Crunchbase |
| 采用信号 | 官称 30,000+ 开发者；具名生产客户 GovSignals（AI 政府采购，大批量后台处理 + Realtime AI 提案生成）| 【二手】trigger.dev/customers |
| 定位迁移 | v4 起官方定位从「background jobs framework」明确转向「AI agent / workflow runtime」，README 首屏即「build and deploy fully-managed AI agents and workflows」| 【官方核实】README |

**Runtime 要求**：`.nvmrc` = Node v24.18.0；monorepo = pnpm 10 + Turborepo；webapp = Remix 2.17.4（Express server）；DB = Prisma 6 + PostgreSQL；分析 = ClickHouse；实时 = Electric SQL + s2-lite。

小结：**版本活跃、许可证干净（Apache-2.0 无逃逸风险）、有真金白银的融资与生产客户**。成熟度信号合格，不是玩具项目。

---

## 2. Durable 语义逐项核实（本轮最重）

### 2.1 持久化模型 —— 关键澄清：checkpoint ≠ 持久化原语

这是**最容易被官方 how-it-works 页误导的一点**，务必分清两层：

1. **执行快照（Execution Snapshot）= 真正的持久化原语。** Run Engine 2.0 用 `TaskRunExecutionSnapshot`（存 Postgres）记录每个 run 的**逻辑状态机**（当前 executionStatus、阻塞在哪个 waitpoint、已完成哪些边）。状态机为：`RUN_CREATED → QUEUED → PENDING_EXECUTING → EXECUTING →（撞 waitpoint）EXECUTING_WITH_WAITPOINTS →（有 checkpoint 时）SUSPENDED → QUEUED …`。心跳系统（heartbeats）检测 stalled/crash 的 run 并自动恢复。**这套 Postgres 状态机才是「crash 后可恢复」的载体。**【官方核实】`internal-packages/run-engine/README.md`、`src/engine/systems/executionSnapshotSystem.ts`、状态机图。

2. **CRIU Checkpoint（进程内存快照）= 一个「释放资源」的优化，不是持久化原语。** 官方 `how-it-works.mdx` 描述：撞到 `wait.for` / `triggerAndWait` 且等待 > 5 秒时，用 **CRIU（Checkpoint/Restore In Userspace）**给进程做内存/CPU/fd 快照、释放容器、等待结束再 restore。**v4 的 Cloud 仍用 CRIU 这套**（how-it-works 是当前 v4 文档，v3 执行代码已删，此页描述的即现状）。作用是「等待期不占容器、不计费」。【官方核实】`docs/how-it-works.mdx` §Checkpoint-Resume、`docs/snippets/paused-execution-free.mdx`。

> **对「v4 是否仍用进程快照/CRIU」的直接回答**：Cloud 仍用 CRIU 做等待期的资源释放；但 durable 恢复不依赖 CRIU，靠的是 Postgres 执行快照 + 心跳 + 从头重试 + 幂等缓存。

3. **崩溃恢复的真实机制 = 从 attempt 开头重试 + 幂等缓存，不是 Temporal 式确定性 replay。** 官方 `how-it-works.mdx` §Durable execution 写得很直白：一个 attempt 崩了/失败，重试时**从 run 函数开头重新执行**，但已完成的子任务通过 `idempotencyKey` 返回**缓存结果**、不重跑。这是「粗粒度重放 + 幂等 memo」，**颗粒度是子任务（`triggerAndWait` + idempotencyKey），不是每一行代码**。【官方核实】`docs/how-it-works.mdx`、`docs/idempotency.mdx`。

> **对我们的含义**：五段式若想「crash 后不重跑已完成段」，必须把**每段拆成子 task 并挂 idempotencyKey**（如 `②上下文注入`、`④视频生成` 各自是子 task）。若把五段写在一个 run 函数里、段间只用普通 `await`，崩溃重试会从第①段整体重来（仅子 task 级缓存生效）。这是**架构约束**，不是自动获得的。

### 2.2 Waitpoint / `wait.forToken` —— 人审挂起（官方姿势，命中我们④）

**【官方核实】`docs/wait-for-token.mdx`。** 这是 human-in-the-loop 的一等公民 API：

- `wait.createToken({ timeout, idempotencyKey, tags })` → 返回 `{ id (waitpoint_…), url, publicAccessToken, isCached }`。可在 task 内或后端任意处创建。
- `wait.forToken<T>(tokenId)` **必须在 task run 内调用**，会挂起 run 直到 token 完成；返回 `Result { ok, output, error }`，唯一错误是超时；`.unwrap()` 走 happy path。
- `wait.completeToken<T>(tokenId, output)` **可从任意处完成**：后端 SDK、外部服务、`token.url` 的 HTTP POST（server-to-server，无 CORS），或**浏览器直接完成**（`publicAccessToken` 带 CORS，配 `useWaitToken` React hook：`const { complete } = useWaitToken(tokenId, { accessToken })`）。
- `timeout` 默认 `"10m"`，**可设到天级**（文档示例 `"7d"`）。

**最长挂起时长**【官方核实 `docs/wait-for.mdx` / `docs/limits.mdx`】：
- `wait.for` 支持 `seconds/minutes/hours/days/weeks/months/years`，文档示例直到 `{ years: 1 }`。
- 队列 TTL：Cloud 强制 ≤ **14 天**（超过被 clamp）；自托管可用 `RUN_ENGINE_DEFAULT_MAX_TTL` 配置。
- 我们的「用户澄清/审批挂起数小时至数天」**完全在支持范围内**。

**新增更贴合的 Input Streams（SDK 4.4.2+，`docs/tasks/streams.mdx`）**：`streams.input<T>()` 提供比裸 waitpoint 更顺手的双向通道，接收侧四种方法各有取舍——

| 方法 | 是否挂起 | 等待时算力成本 | 适用 |
|---|---|---|---|
| `.wait({ timeout: "7d" })` | **是** | **无（Cloud 释放进程）** | 审批门、HITL、长等待（返回同 `wait.forToken` 的 `ManualWaitpointPromise`）|
| `.once({ timeoutMs })` | 否 | 满（进程存活）| 短等待、并发工作 |
| `.on(handler)` | 否 | 满 | 持续监听（取消信号、live 更新）|
| `.peek()` | 否 | 无 | 非阻塞查最新缓冲值 |

`.wait()` 是我们④「等待用户澄清/审批」的推荐姿势；`.on()` + `AbortController` 可实现「用户点停 → 中止 LLM 流生成」。

### 2.3 重试 / 幂等 / 并发队列

- **重试**【官方核实 `docs/errors-retrying.mdx` 引用、`how-it-works`】：task 级 `retry: { maxAttempts, minTimeoutInMs, maxTimeoutInMs, factor }`；未捕获错误自动重试，重试锁定原始代码版本。
- **幂等**【官方核实 `docs/idempotency.mdx`】：task 级 `idempotencyKey`（`idempotencyKeys.create()` 可自动 scope 到 run + 跨重试）；相同 key 二次触发返回原 run handle 不新建。**这是崩溃恢复缓存与「避免重复扣费/重复发布」的核心。**
- **并发队列**【官方核实 `docs/queue-concurrency.mdx`】：可定义命名 queue + `concurrencyLimit`；支持按租户 key 隔离并发（对多商家 SaaS 有用）。`batchTrigger` 批量触发。

### 2.4 部署新版本时 in-flight run 的行为（原子版本 / revision fencing）

**【官方核实 `docs/versioning.mdx` / `docs/deployment/atomic-deployment.mdx`】——这里要分清两种「fencing」：**

- **代码版本 fencing（Trigger.dev 原生解决）**：run 一旦启动即**锁定当时最新代码版本**，此后部署新版本**不影响它**（它跑完在锁定版本上）。`triggerAndWait` 的子 run 版本锁定到父 run 版本。延迟 run 锁定到「开始执行时」的版本。这正是「部署新版本不打断 in-flight run」，**开箱即得**。原子部署（`deploy --skip-promotion` + `TRIGGER_VERSION` env + `promote`）让 app 与 task 版本同步切换。

- **数据版本 fencing（team lead 说的「防旧结果覆盖新版本」——Trigger.dev 不替我们解决）**：我们的场景是「一个 run 挂起等审批数天，期间 ContentPackage 被编辑到新 revision，旧 run 恢复后带着陈旧结果不应覆盖新 revision」。**这是应用层的乐观并发问题，Trigger.dev 只给载体不给策略**：⑤回装段必须自己在写 ContentPackage 时做 revision 的 compare-and-swap（把 run 启动时的 baseRevision 带进 payload/metadata，写入时校验 DB 当前 revision 未变，否则走冲突分支）。**结论：revision fencing 可实现，但要我们在 step⑤ 自己写。**【推断】

---

## 3. 栈契合

### 3.1 Realtime API 详查（差异化卖点，命中「白话进度事件」）

**【官方核实 `docs/realtime/*`、`packages/react-hooks`】** Realtime 分两条正交通道，共用 `@trigger.dev/react-hooks` 与同一鉴权：

| | Run updates（状态/元数据/tag）| Streaming（连续数据）|
|---|---|---|
| 给你什么 | run 状态 + metadata + tags 变更 | 你定义的连续数据（AI token、进度、文件块）|
| 触发时机 | 状态变化时 | task 运行中数据产出时 |
| React hook | `useRealtimeRun` / `useRealtimeRunsWithTag` / `useRealtimeBatch` | `useRealtimeStream` |
| task 侧要设置吗 | 不用，自动 | 要，`streams.define()` |
| 底层 | **Electric SQL**（HTTP 化 Postgres 同步，非轮询非 WebSocket）| Streams transport（s2-lite / s2.dev）|

**「白话进度事件」的推荐落法 = Run metadata + `useRealtimeRun`**【官方核实 `docs/runs/metadata.mdx`、`docs/realtime/react-hooks/subscribe.mdx`】：
- task 内 `metadata.set("status", { stage: "intent", label: "正在理解你的需求…" })`、`metadata.set("progress", { percentage: 40 })`——**同步调用、后台批量 flush、不阻塞 run**（最多 256KB）。
- 前端 `const { run } = useRealtimeRun(runId, { accessToken, baseURL })`，metadata/status/tags 变更即 re-render。官方直接给了进度条、多阶段部署监视器、状态+日志三个现成组件范例——**五段式的阶段推进 UI 几乎照抄**。
- token 级流式（对话层）走 `streams.define<UIMessageChunk>()` + `aiStream.pipe(streamText(...).toUIMessageStream())` + `useRealtimeStream`，**与 AI SDK 无缝**（文档示例就是 `@ai-sdk/openai` + `ai` 的 `streamText`）。

> 这一条是 Trigger.dev 相对 DBOS/Inngest 的**真差异化**：进度事件与 token 流是产品内建、前端 hook 开箱，不用我们自己搭 SSE/WebSocket 通道。`baseURL` 参数支持指向自托管实例——**Realtime 在自托管可用**（见 §4）。

### 3.2 与 Next.js 集成 & 触发方式

**【官方核实 `docs/how-it-works.mdx`、`docs/triggering.mdx`】**
- 触发：后端 `tasks.trigger<typeof myTask>("task-id", payload, { metadata, tags, idempotencyKey, machine })`，**type-only import** 任务类型拿到 payload/output 类型安全；返回 handle 立即响应。也有 `batchTrigger` / `triggerAndWait` / scheduled / `useRealtimeTaskTrigger`（前端触发+订阅二合一）。
- **但注意**：Next.js app 只是**触发方 + 订阅方**。task 代码本身**不跑在 Next.js/Vercel 进程里**，而是被 CLI 打包成独立 Docker 镜像、部署到 Trigger.dev 实例、在其容器里执行（见 §3.3）。这与 pg-boss（嵌你进程）、DBOS（嵌你进程的库）截然不同。

### 3.3 关键架构不匹配（务必让 team lead 看到）

**Trigger.dev 是平台不是库。**【官方核实 `AGENTS.md` 架构、`docs/how-it-works.mdx` §build system、`docs/self-hosting/*`】

请求流：`你的 App → Trigger.dev webapp(Remix) → Services → RunEngine → Redis Queue → Supervisor → 容器执行(你的 task 镜像) → 结果回 RunEngine → ClickHouse + PostgreSQL`。

- task 代码经 `npx trigger.dev deploy`（esbuild 打包 → Docker 镜像 → 推到镜像仓库）部署，**在 supervisor 拉起的隔离容器里跑**，不在你的常驻 Node 服务里。
- 这意味着我们的五段式 Harness 代码会**从「单 Node 服务里的一段」变成「一个独立的 Trigger.dev task 项目」**，有独立的构建/部署链（见 §5、§7 风险）。
- 对比：pg-boss / DBOS = 你 `import` 进你自己的进程；Inngest = 函数由你的 app 通过 HTTP 暴露（serve handler）；**Trigger.dev = 独立平台 + 独立容器执行 + Docker 镜像部署链**。这是四个候选里**耦合度最重、与「单体 Node 服务」范式最远**的一个。

---

## 4. Self-host 生产运维面（最重疑点）

### 4.1 组件清单（自托管 webapp 栈 = 8 服务，实测 compose 直证）

**【官方核实 `hosting/docker/webapp/docker-compose.yml`、`docs/self-hosting/docker.mdx`】** 自托管分两个可独立扩展的 compose：

**Webapp 栈（`hosting/docker/webapp/docker-compose.yml`，实测 8 个 service）：**
1. `webapp`（ghcr.io/triggerdotdev/trigger.dev，Remix/Node）
2. `postgres:14`（`wal_level=logical`，供 Electric 逻辑复制）
3. `redis:7`（队列 + redis-worker）
4. `electric`（electricsql/electric:1.2.4，Realtime run 订阅）
5. `clickhouse`（run replication + task events 分析；生产建议 `EVENT_REPOSITORY_DEFAULT_STORE=clickhouse_v2`，否则 Postgres `TaskEvent` 表无限增长）
6. `registry:2`（内建镜像仓库，存部署镜像）
7. `minio`（对象存储，大 payload/output，`packets` bucket）
8. `s2`（+ `s2-init`）（s2-lite，Realtime streams v2，AI token 流；可回退 Redis 的 v1）

**Worker 栈（独立 compose）：** supervisor + Docker Socket Proxy（不给直接 socket）+ 拉起的 runner 容器。

### 4.2 资源脚印【官方核实 `docs/self-hosting/docker.mdx`】

- Webapp 机：3+ vCPU / 6+ GB RAM（含 PG/Redis/CH/Electric/MinIO/s2/registry）。
- Worker 机：4+ vCPU / 8+ GB RAM（supervisor + runner 容器）。
- 并发线性吃资源：`100 并发 × small-1x(0.5vCPU/0.5GB) = 50 vCPU + 50 GB RAM`。可横向加 worker（v4 新增多 worker 支持）。
- 部署镜像仓库 + 对象存储自带，无需第三方——但见 §7 风险（社区反馈「built-in registry 对生产其实不够」）。

### 4.3 云版 vs 自托管功能差异【官方核实 `docs/self-hosting/overview.mdx` 特性对照表】

| 特性 | Cloud | 自托管 | 说明 |
|---|---|---|---|
| **Warm starts** | ✅ | ❌ | 连续 run 快启动 |
| **Auto-scaling** | ✅ | ❌ | 需手动加 worker |
| **Checkpoints** | ✅ | ❌ | **非阻塞等待、更省资源** |
| Realtime（run 订阅 + streams）| ✅ | ✅ | Electric + s2-lite 都在自托管 compose 里 |
| ARM | ✅ | ✅ | |

**自托管无 checkpoint 的实测含义（本报告最重发现，源码直证）**：
- `docs/self-hosting/docker.mdx` §What's new 明写：「**No checkpoint support.** 这在自托管一直是实验性、不推荐，会引发一堆问题，我们决定聚焦核心。」
- 源码 `src/engine/systems/waitpointSystem.ts:875` 证实：run 进入 `SUSPENDED` 前提是**有 checkpointId**，否则抛错「run is suspended, but has no checkpoint」。
- **推论【推断，源码逻辑支撑】**：自托管下 run 撞到 `wait`/`waitpoint` **不会进 SUSPENDED、不释放容器**，而是停在 `EXECUTING_WITH_WAITPOINTS`——**容器保持存活、阻塞占用一个机器槽位，直到等待结束**。对我们「审批挂起数小时至数天」的场景，这意味着**每个等待中的 run 全程占一个 worker 容器槽位**（长 HITL 等待 = 长时间占算力）。等待期若容器/机器崩溃，心跳检测 stall → run 从 attempt 头重试（幂等缓存兜已完成子 task）。**durable 正确性仍在，但资源效率与云版差一个量级。**
- **Realtime 在自托管可用**（Electric + s2-lite 都在 compose），这点没被砍——差异化卖点自托管保留。

---

## 5. 平移成本（硬评审维度）

### 5.1 验证期 CF 架构下怎么接（结论：接不进「单 Node 服务」，需另起执行面）

我们验证期 = CF Workers 壳 + 单 Node 常驻服务 + Hyperdrive→托管 PG。**Trigger.dev 的执行层无法跑在 CF Workers 上**：supervisor 要用 Docker/K8s 拉起容器执行 task，CF Workers 不能 spawn 容器。因此只有两条路【推断，基于架构约束】：

- **(A) 用 Trigger.dev Cloud（SaaS）**：CF Workers/Node 服务只做触发方 + 订阅方（调 SDK）。最省运维，但 = 引入一个**美国 SaaS 外部依赖**（数据出境 + 未来中国化时该层整体换），与「验证期最快栈」有张力，与「平移便宜」硬维度冲突。
- **(B) 自托管 Trigger.dev 全栈**：在一台 VM 或 K8s 上跑上述 8+ 服务 + worker。验证期就要维护一个独立平台，**基建重量远超「单 Node 服务」**，与验证期精简目标冲突。

无论哪条，**Trigger.dev 都会在我们的架构里多出一整个执行面**，不是「往现有 Node 服务里加个库」。这是它与 A1(DBOS)/A2(Inngest 自托管)/A4(CF Workflows) 相比在验证期的**结构性劣势**。

### 5.2 迁中国云评估（相对乐观）

- **代码/许可证无逃逸**：Apache-2.0，全栈可自托管，无专有 runtime 锁定（对比 A4 CF Workflows 的先天硬伤）。
- **组件全部可在中国云自托管**：Postgres（逻辑复制）、Redis、ClickHouse、MinIO→可换阿里 OSS/腾讯 COS、Electric（开源）、s2-lite（开源）、镜像仓库→可换 ACR/TCR。task 镜像本地构建后推私有 registry，**在中国网络内闭环，无需访问境外**。
- **迁移面 = 把整套 compose/helm 搬到中国云 + 换对象存储/镜像仓库 endpoint**，属「重但可平移」；不像专有 runtime 要重写。
- 顾虑：这套栈的**运维复杂度**在中国云一样存在（见 §7），且团队要养一个平台的运维能力。

---

## 6. 五段式映射 — Trigger.dev v4 API 代码骨架

> 说明：以下为**架构骨架**（英文代码），演示如何用 v4 原语实现①-⑤，重点是④分钟级视频轮询 + waitpoint 审批、进度 metadata、revision fencing。为拿「crash 不重跑已完成段」，②/④拆为带 `idempotencyKey` 的子 task。

```ts
// trigger/streams.ts —— 白话进度 + token 流的共享定义
import { streams, InferStreamType } from "@trigger.dev/sdk";
import type { UIMessageChunk } from "ai";

export const briefStream = streams.define<UIMessageChunk>({ id: "brief-tokens" });
export const revision = streams.input<{ action: "approve" | "reject" | "revise"; note?: string }>({
  id: "revision-decision",
});
export type BriefPart = InferStreamType<typeof briefStream>;
```

```ts
// trigger/harness.ts —— 五段式 Harness 主 task
import { task, metadata, wait, idempotencyKeys, tasks } from "@trigger.dev/sdk";
import { openai } from "@ai-sdk/openai";
import { generateObject, streamText } from "ai";
import { briefStream, revision } from "./streams";
import { assembleContextBundle, runRedlineGate, writeContentPackageRevision } from "../harness-core";

type HarnessInput = {
  customerId: string;
  rawRequest: string;
  contentPackageId: string;
  baseRevision: number; // captured at trigger time — for revision fencing in stage ⑤
};

// 白话进度事件 helper：五段共用
const stage = (key: string, label: string, percentage: number) =>
  metadata.set("status", { stage: key, label, percentage }); // sync, background-flushed

export const harnessTask = task({
  id: "harness-five-stage",
  retry: { maxAttempts: 3, minTimeoutInMs: 1_000, factor: 2 },
  machine: "small-2x",
  run: async (payload: HarnessInput, { ctx }) => {
    const idem = await idempotencyKeys.create(ctx.run.id); // scope caches to this run across retries

    // ① 意图正名 —— LLM 结构化输出
    stage("intent", "正在理解你的需求…", 10);
    const { object: intent } = await generateObject({
      model: openai("gpt-4o"),
      schema: IntentSchema,
      prompt: payload.rawRequest,
    });

    // ② 上下文注入 —— 确定性组装（拆子 task + 幂等 → crash 后走缓存）
    stage("context", "正在调取你的门店与行业资料…", 25);
    const { output: contextBundle } = await assembleContextTask
      .triggerAndWait({ customerId: payload.customerId, intent }, { idempotencyKey: idem })
      .unwrap();

    // ③ Brief 编译 —— LLM + token 流回前端（对话层）
    stage("brief", "正在起草创作简报…", 45);
    const briefResult = streamText({
      model: openai("gpt-4o"),
      prompt: compileBriefPrompt(intent, contextBundle),
    });
    const { waitUntilComplete } = briefStream.pipe(briefResult.toUIMessageStream());
    await waitUntilComplete();
    const brief = await briefResult.text;

    // ④ 执行与择优 —— N 选 1 + 分钟级视频轮询 + 红线门禁 + 人审 waitpoint
    stage("execute", "正在生成内容（视频约需 1-2 分钟）…", 60);
    const { output: video } = await generateVideoTask
      .triggerAndWait({ brief }, { idempotencyKey: idem, machine: "large-1x" })
      .unwrap();

    const gate = runRedlineGate(video); // deterministic hard-rule gate
    if (!gate.ok) {
      stage("blocked", `未通过红线校验：${gate.reason}`, 60);
      return { status: "blocked", reason: gate.reason };
    }

    // 人审挂起（可挂数小时至数天；Cloud 释放进程，自托管阻塞占容器）
    stage("await-approval", "已生成，等待你确认…", 80);
    const decision = await revision.wait({ timeout: "3d", idempotencyKey: idem });
    if (!decision.ok || decision.output.action !== "approve") {
      return { status: decision.ok ? decision.output.action : "timed_out" };
    }

    // ⑤ 回装与交付 —— 写 ContentPackage revision + 数据层 fencing（应用逻辑，非 Trigger 内建）
    stage("deliver", "正在交付…", 95);
    const written = await writeContentPackageRevision({
      contentPackageId: payload.contentPackageId,
      expectedBaseRevision: payload.baseRevision, // compare-and-swap: reject if DB moved on
      video,
      brief,
      decisionTrace: { intent, contextBundle, route: video.route, gate }, // audit
    });
    if (written.conflict) {
      return { status: "revision_conflict", currentRevision: written.currentRevision };
    }

    stage("done", "完成", 100);
    return { status: "delivered", revision: written.newRevision };
  },
});
```

```ts
// ④ 子 task：分钟级视频生成——用 waitpoint webhook 做「非轮询」等待（推荐）
export const generateVideoTask = task({
  id: "generate-video",
  machine: "large-1x", // ffmpeg 薄壳吃内存
  run: async (payload: { brief: string }) => {
    const route = pickBestRoute(payload.brief); // N→1 择优（AI SDK provider registry 薄封装）

    // 方案 A（推荐）：外部服务支持 webhook 回调 → waitpoint token，零轮询
    const token = await wait.createToken({ timeout: "15m" });
    await seedanceSubmit({ prompt: payload.brief, callbackUrl: token.url }); // 供应商回调 token.url
    const gen = await wait.forToken<{ videoUrl: string }>(token).unwrap();

    // ffmpeg 薄壳：标识烧录（ffmpeg build extension，见 trigger.config.ts）
    const finalUrl = await burnWatermarkWithFfmpeg(gen.videoUrl);
    return { route, videoUrl: finalUrl };
  },
});
```

```ts
// trigger.config.ts —— ffmpeg 构建扩展（把 ffmpeg 装进 task 镜像）
import { defineConfig } from "@trigger.dev/sdk";
import { ffmpeg } from "@trigger.dev/build/extensions/core";

export default defineConfig({
  project: "proj_xxx",
  build: { extensions: [ffmpeg()] }, // 也有 pythonExtension / playwright / puppeteer / aptGet
});
```

**要点标注：**
- 分钟级视频**优先用 waitpoint webhook（`token.url` 回调）而非轮询**——供应商回调即恢复，等待期不烧 CPU【官方核实 `docs/wait-for-token.mdx` Replicate 示例同款】。若供应商不支持 webhook，退化为 `while + wait.for({ seconds: 15 })` 轮询（Cloud 每次 checkpoint 释放，自托管阻塞）。
- `ffmpeg()` 构建扩展**官方内建**，`docs/config/extensions/ffmpeg.mdx` 直证——我们「ffmpeg 薄壳 + 标识烧录」不用自己搞镜像。
- revision fencing（`expectedBaseRevision` compare-and-swap）是**我们写的应用逻辑**，Trigger 只提供 payload 携带与 run 隔离。

---

## 7. 对照 Temporal 范式（完备度简评）

| 维度 | Temporal | Trigger.dev v4 | 评 |
|---|---|---|---|
| 持久化模型 | 确定性 **replay**（event history 重放 workflow，要求代码确定性）| **执行快照(PG 状态机) + 从头重试 + 幂等缓存 + CRIU(Cloud 释放资源)** | Trigger 无「代码必须确定性」的心智负担；但恢复颗粒度粗到子 task，不是每行 |
| 等待/信号 | `Workflow.await` / Signals（原生、无限期）| `wait.forToken` / `streams.input().wait()`（天级 timeout）| 语义对齐，Trigger 的 API 更轻、更前端友好 |
| 人审 HITL | Signal + query 自己搭 | waitpoint + `publicAccessToken` + `useWaitToken` **前端直连开箱** | **Trigger 明显更省事** |
| 版本治理 | Worker Versioning / patching（成熟但复杂）| 原子版本锁定（run 锁代码版本）| Trigger 更简单，但没有 Temporal 那种 in-flight patch 能力 |
| 进度可视 | 无内建前端流 | **Realtime + React hooks 内建**（差异化）| Trigger 胜 |
| 运维重量 | 集群极重（history service/matching/frontend + Cassandra/PG + ES）| 重（8+ 服务）但比 Temporal 轻，且 SaaS 可选 | 都不轻 |
| 心智完备度 | 金标准、最严谨 | 「够用的 durable」+ 强产品化 | 我们不需要 Temporal 的严谨度；Trigger 的产品化更贴我们 |

**结论**：读 Temporal 是为校准完备度；Trigger.dev 用「粗粒度重放 + 幂等」换掉了「确定性 replay」的心智税，代价是恢复颗粒度粗（要主动拆子 task + idempotencyKey）。对我们五段式，Trigger 的 HITL + Realtime 产品化比 Temporal 的严谨度更值钱。

---

## 8. 风险清单

| # | 风险 | 严重度 | 依据 | 缓解 |
|---|---|---|---|---|
| R1 | **架构范式不匹配**：Trigger 是平台不是库，task 跑独立容器、需 Docker 镜像部署链，与「单 Node 服务 + pg-boss 嵌入」根本不同；CF Workers 跑不了它的执行层 | **高** | §3.3 / §5.1【官方核实】 | 验证期只能选 Cloud(SaaS 外部依赖) 或自托管全栈(重)；须 team lead 决策是否接受多一个执行面 |
| R2 | **自托管无 checkpoint → 长等待阻塞占容器** | **高** | §4.3 `docs/self-hosting/docker.mdx` + `waitpointSystem.ts:875`【官方核实+推断】 | 长 HITL 等待每个占一个 worker 槽位；要么用 Cloud，要么为等待中的 run 预留容量、控并发 |
| R3 | **自托管生产就绪度**：官方明写「本指南不足以得到生产级部署」；env 变量错配是「#1 设置痛点」；容器内部署报 Connection error；K8s runner env 注入 bug | **高** | §4 + issues #2186/#2649/#2792/#2584【二手】 | 需专人养运维；起步用 Cloud 验证、稳定后再评自托管 |
| R4 | **构建/部署链侵入**：task 代码必须经 `trigger.dev deploy` 打 Docker 镜像、每台部署机 `docker login` registry；与我们 CI/CD 割裂 | 中 | §3.3 `docs/self-hosting/docker.mdx`【官方核实】 | 接受 task 项目独立部署流水线；或用 GitHub Actions 集成 |
| R5 | **恢复颗粒度粗**：一个 run 函数内的段间普通 `await`，崩溃重试从头来，仅子 task 级幂等缓存 | 中 | §2.1【官方核实】 | 五段各拆子 task + idempotencyKey（已在 §6 骨架体现），增加代码结构成本 |
| R6 | **长等待时 stream 被 GC**：空 stream 约 1 小时被回收，run 恢复用 stream 报 `S2Error` 并从头重试 | 中 | `docs/tasks/streams.mdx:877`【官方核实】 | 等待前关流、恢复后重开；或每 20-30 分钟写心跳记录 |
| R7 | **组件面广、依赖多**：PG(逻辑复制)/Redis/ClickHouse/Electric/s2-lite/MinIO/registry 七类中间件，任一出问题影响面大 | 中 | §4.1【官方核实】 | 迁中国云时逐一替换 endpoint；运维监控成本高 |
| R8 | **Realtime 并发订阅限额**（Cloud 按 plan 限）| 低 | `docs/realtime/how-it-works.mdx`【官方核实】 | 自托管可配；Cloud 需看 plan |

---

## 9. 对 team lead 的落点建议（不替你拍板）

- **能力匹配度：五个候选里最高。** durable + Realtime 进度流 + waitpoint 人审 + ffmpeg/视频扩展全开箱，五段式几乎照抄官方范例，token 流与 AI SDK 无缝。
- **架构代价：五个候选里最重。** 它是平台不是库，验证期 CF「单 Node 服务」范式里塞不进它的执行层——要么吃 Cloud SaaS 外部依赖，要么自托管一整套 8+ 服务栈。这与 D-032「栈不换只调优先级」有正面张力。
- **平移面：相对乐观但不轻。** Apache-2.0 全栈自托管、无专有 runtime 锁定，迁中国云是「重但可平移」；但运维复杂度全程存在。
- **对比定位**：若最看重「进度事件/token 流产品化 + HITL 开箱」→ Trigger 领先；若最看重「不新增执行面、贴合单 Node 服务、栈最省」→ DBOS(A1) 更贴，Trigger 明显偏重。**建议把 Trigger 定位为「能力天花板参照 + 若未来要重前端实时体验时的强候选」，验证期主线仍以更轻的 A1/A2 优先**（此为倾向，最终看 10 号对比简报）。

---

## 10. 来源 URL

**一手（本地镜像，`references/repos/harness-2026-07-17/trigger.dev/`）：**
- `LICENSE`（Apache-2.0）、`README.md`、`AGENTS.md`、`package.json`、`.nvmrc`
- `docs/how-it-works.mdx`（Checkpoint-Resume / CRIU / durable execution / build system）
- `docs/wait-for-token.mdx`、`docs/wait.mdx`、`docs/wait-for.mdx`、`docs/idempotency.mdx`、`docs/limits.mdx`
- `docs/versioning.mdx`、`docs/deployment/atomic-deployment.mdx`
- `docs/realtime/overview.mdx`、`docs/realtime/how-it-works.mdx`、`docs/realtime/react-hooks/subscribe.mdx`、`docs/realtime/react-hooks/use-wait-token.mdx`、`docs/runs/metadata.mdx`
- `docs/tasks/streams.mdx`（streams v2 + Input Streams）
- `docs/self-hosting/overview.mdx`、`docs/self-hosting/docker.mdx`
- `docs/config/extensions/ffmpeg.mdx`、`docs/machines.mdx`
- `internal-packages/run-engine/README.md`、`src/engine/systems/{executionSnapshotSystem,checkpointSystem,waitpointSystem}.ts`
- `hosting/docker/webapp/docker-compose.yml`

**二手（线上）：**
- https://trigger.dev/changelog/trigger-v4-ga （v4 GA 2025-08-18）
- https://trigger.dev/changelog/v4-5-0
- https://github.com/triggerdotdev/trigger.dev/releases （发布节奏）
- https://trigger.dev/docs/self-hosting/docker
- https://trigger.dev/blog/self-hosting-trigger-dev-v4-docker 、 https://trigger.dev/blog/self-hosting-trigger-dev-v4-kubernetes
- https://trigger.dev/blog/how-we-built-realtime （Realtime 20k updates/s）
- https://trigger.dev/customers/govsignals-customer-story
- https://trigger.dev/blog/3m-dollar-seed-round 、 https://www.crunchbase.com/organization/trigger-dev （融资）
- Issues：#2186（自托管教程 bug）、#2649（容器内部署 Connection error）、#2792（K8s runner env 未注入）、#2584（Coolify 支持）
- 官方文档站：https://trigger.dev/docs

---
*调研完成 2026-07-17。全文区分【官方核实】与【推断】；核心发现均有镜像源码直证。*
