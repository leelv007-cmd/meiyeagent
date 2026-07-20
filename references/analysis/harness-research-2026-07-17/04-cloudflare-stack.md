# Cloudflare 编排全家桶深调 — Workflows / Agents SDK / AI Gateway / Queues / DO

> **交叉验证裁定（Codex，2026-07-17）：动摇（V2 日期与能力归属有误；部署版本语义无官方证据须实测；AI Gateway 实有 Custom Provider、「中国模型不可接」结论被推翻；「迁中国云须整体换框架」为过度扩大）** — 全文见 `xcheck/r04-xcheck.md`；引用本报告断言前先对照裁定。

> 调研员视角报告 · 2026-07-17 · 面向「美业本地商家内容营销 Agent SaaS」五段式 Harness
> 技术栈已锁：TS 全栈 + Next.js/Vercel AI SDK（对话层 token 流式）+ PostgreSQL + pg-boss。
> 部署验证期在 Cloudflare（Workers 壳 + 单 Node 常驻服务 + Hyperdrive→托管 PG），未来可能整体迁往中国云。
> **lock-in 面 = 本次调研核心判断轴。**
>
> 标注约定：`【官方核实】`=Cloudflare 一手文档/changelog 现场核实；`【二手】`=第三方技术资料（书/媒体）；`【推断】`=我方基于原理的推理。
> 说明：本机 `reach_read` MCP 因 python 依赖损坏不可用；`developers.cloudflare.com` 被本机网络策略挡（WebFetch 403）。
> 采集通道 = curl `raw.githubusercontent.com/cloudflare/cloudflare-docs`（mdx 源码）+ `developers.cloudflare.com/*/llms-full.txt`（curl 可达）+ WebSearch + 本地镜像源码。

---

## 0. 一页结论（TL;DR）

| 组件 | 验证期定位 | GA/成熟度 | lock-in / 中国化冲突 |
|---|---|---|---|
| **Workflows** | **主编排引擎候选**——断点续跑 + 挂起数天 + waitForEvent 天然适配五段式 | GA 2025-04-07，V2 2026-05 | **高**：闭源服务端引擎，**无 self-host**，迁出=换 DBOS/Temporal/Restate/Inngest（语义可平移，机械改动中等） |
| **Agents SDK (`agents`)** | **范式参考，不采用**（D-032 已锁 AI SDK） | 活跃（本地镜像 v0.17.4） | 高（绑死 DO），但我们只抄设计，不引入 |
| **AI Gateway** | 可选薄路由 + 审计复用件 | GA，能力持续加 | **中**（URL 前缀代理，退出成本低）；**但首class provider 不含火山/豆包，仅 DeepSeek**→中国模型场景基本失效 |
| **Queues** | 与 pg-boss 职责重叠，验证期不引入 | GA | 中 |
| **Durable Objects + Alarms** | Agents SDK 底座；直接用与否取决于是否走 CF 对话层 | GA | 高 |

**一句话**：Workflows 是这套栈里唯一"值得为它写代码"的编排件，但它也是 lock-in 最深的一环——它没有任何 self-host / workerd 兼容实现，迁出只能整体换 durable-execution 框架。**DBOS 是最省力的逃逸目标**（Postgres 为真相源，我们本来就有 PG），语义与 Workflows 一一对应。AI Gateway 因不支持火山/豆包，在"未来迁往中国云 + 用中国模型"的主线里复用价值很低。

---

## 1. Cloudflare Workflows

### 1.1 GA 时间线与状态 【官方核实】

- **2025-04-07 正式 GA**：博客《Cloudflare Workflows is now GA: production-ready durable execution》+ changelog `/changelog/2025-04-07-workflows-ga/`。此前经历 open beta（2024 下半年逐步放开步数上限 256→512→1024）。
- **2026-05 Workflows V2**（InfoQ 报道 2026-05）：引入"deterministic / replay-safe step"执行模型，并大幅抬限额——**并发 4,500 → 50,000**、创建速率 100/s → 300/s（每账号）、排队上限扩到 2,000,000。
- **2026-03-03 changelog**：单实例步数上限 10,000 → **可配置到 25,000**。
- 底座：直接建在 Workers 之上（durable execution engine on Workers），Python Workflows 也支持（`wrangler deploy`）。

### 1.2 限额全表 【官方核实 · `/workflows/reference/limits/`】

| 项 | Workers Free | Workers Paid |
|---|---|---|
| **每 step CPU 计算时间** [注3] | 10 ms | 30 秒（默认）/ 可配到 **5 分钟** active CPU |
| **每 step 墙钟时长** [注3] | 无限 | 无限（等待网络 I/O / DB 查询不计） |
| **单 step 非流式返回值上限** | 1 MiB (2²⁰) | 1 MiB (2²⁰) |
| **event/payload 上限** | 1 MiB | 1 MiB |
| **单实例可持久化状态总量** | 100 MB | **1 GB** |
| **`step.sleep` 上限** | **365 天** | **365 天** |
| **每 Workflow 最大步数** [注5] | 1,024 | 10,000（默认）/ **可配到 25,000** |
| **Workflow 执行次数** | 100,000/天（与 Workers 日限共享） | 无限 |
| **并发实例（running）/账号** [注7] | 100 | **50,000** |
| **实例创建速率** [注8] | 100/s | **300/s 每账号，100/s 每 workflow** |
| **排队实例上限** | 100,000 | **2,000,000** |
| **完成实例状态保留** | 3 天 | **30 天**（可 per-instance 配 `retention`） |
| **单实例子请求数** | 50/请求 | 10,000/请求（默认）/ 可配到 **1000 万** |
| **每 step 最大重试次数** | 10,000 | 10,000 |
| **workflow 名 / 实例 ID 长度** | 64 / 100 字符 | 64 / 100 字符 |
| **脚本大小 / 账号脚本数** | 3MB / 100 | 10MB / 500 |

- 注3：实例可"永远运行"，只要单 step 不超 CPU 限、不超总步数。**墙钟无限 = 分钟级视频生成轮询完全 OK。**
- 注5：`step.sleep` / `sleepUntil` **不计入步数上限**。
- 注7：**只有 `running` 态计入并发**。`waiting` 态（sleep / 等重试 / waitForEvent）**不计入**——可同时挂数百万实例。若 running 已满 50,000，从 waiting 恢复的实例会转 `queued`。
- 大二进制输出：JS Workflows 支持 `ReadableStream<Uint8Array>` 作为 step 返回类型突破 1 MiB（仍计入实例存储上限）；更大/长期产物应存 R2 只回引用。

**对我们的意义**：单个客户 Task 走一遍五段式，步数 << 1024（免费档都够），sleep/waitForEvent 挂数天 = 一等公民且不占并发预算，1GB 状态 + 每步 1MiB 对文案/Brief/DecisionTrace 绰绰有余（视频成片二进制走 R2）。**限额层面完全适配 Harness。**

### 1.3 `step.waitForEvent` 状态与上限 【官方核实】

- API：`step.waitForEvent<T>(name, { type, timeout? })`。**已 GA**，是 Workflows 的核心原语之一。
- `type`：≤100 字符，**仅允许字母/数字/`-`/`_`，含 `.` 会报 `workflow.invalid_event_type`**。
- `timeout`：**默认 24 小时**，可设 **1 秒 ~ 365 天**。
- 超时行为：**默认抛错使实例 fail**；要"超时也继续"必须 `try...catch` 包住。
- 事件可**提前发送并被缓冲**：实例创建后、还没走到 `waitForEvent` 就 `sendEvent`，事件会 buffer，等实例到达匹配 `type` 的 step 时投递。
- 可多次 `waitForEvent` + `Promise.race` 等多事件竞速。

**对我们的意义**：④执行择优阶段等分钟级视频回调、或人工审核红线放行，用 `waitForEvent`（外部服务 POST 回调 → `sendEvent`）比 sleep 轮询更省。revision fencing 可编进 `type`/payload 里做幂等匹配。

### 1.4 实例管理 API（binding 方法）【官方核实 · `/workflows/build/workers-api/`】

`Workflow` binding（`env.MY_WORKFLOW`）+ `WorkflowInstance` 全套：

```ts
// 创建 / 查询
env.MY_WORKFLOW.create({ id?, params?, retention? })  // id 可自带（≤100 字符，映射业务 Task ID）
env.MY_WORKFLOW.createBatch([...])                     // 一次 ≤100，且幂等（同 ID 在保留期内跳过）
env.MY_WORKFLOW.get(id)                                 // 不存在抛异常

// 实例控制（WorkflowInstance 上）
instance.status()      // → InstanceStatus
instance.pause()       // 暂停
instance.resume()      // 恢复（已在跑会抛错）
instance.terminate({ rollback? })   // 终止；rollback:true 先跑补偿
instance.restart({ from?: { name, count?, type? } })  // 从头 / 从指定 step 重跑（早于该 step 的结果复用）
instance.sendEvent({ type, payload })                 // 对应 waitForEvent
```

- **状态机**（`InstanceStatus.status`）：`queued | running | paused | errored | terminated | complete | waiting | waitingForPause | unknown`。
- **补偿 / Saga**（V2 新）：`step.do(name, cb, { rollback, rollbackConfig })` 注册补偿逻辑，实例失败或 `terminate({rollback:true})` 时按 step 启动的逆序执行；`InstanceStatus.rollback` 报告补偿结果。
- **REST/HTTP API** 平行提供：`POST /accounts/{id}/workflows/{name}/instances/{id}/events/{eventName}`（发事件），及 instances/status 等子资源——**不进 Worker 也能管实例**（外部系统直接打）。
- 全套方法 = `wrangler workflows` CLI 亦有对应命令（list / describe / trigger / instances ...）。

**对我们的意义**：`create({ id: taskId })` 让 Task ID = 实例 ID，DecisionTrace/日志/状态天然对齐单个 Task。`restart({ from })` 对"改了 Brief 想从④重跑"是现成的 revision 重放能力。`pause/resume/terminate` 覆盖人工干预（WOZ 阶段的 intervention）。

### 1.5 重试策略 【官方核实 · `/workflows/build/sleeping-and-retrying/`】

```ts
// 默认（不配时）
{ retries: { limit: 5, delay: 10000 /*10s*/, backoff: "exponential" }, timeout: "10 minutes" }
```

- `limit` ≤ 10,000；`backoff` ∈ `constant | linear | exponential`；`delay` 支持固定值**或动态函数** `({ ctx, error }) => string|number|Promise`（可按 attempt 数 / 错误类型算下一次延迟，专治限流/下游恢复）。
- `timeout`：**惯用法 ≤30 分钟**（超过用 `waitForEvent`）。
- `NonRetryableError`（`import { NonRetryableError } from "cloudflare:workflows"`）：从 step 内抛出立即停止重试并冒泡——**红线门禁硬停的正解**。

### 1.6 wrangler 本地开发与可观测性 【官方核实】

- 本地：`wrangler dev` 跑**"emulated version"** 的 Workflows（本地模拟，非全球引擎）。`wrangler workflows ... --local` 需 **Wrangler ≥4.79.0**；**Local Explorer**（本地可视化触发/发事件）需 **Wrangler ≥4.82.1** 或 Vite 插件 ≥1.32.0。本地镜像 workflows-starter 用的是 wrangler `^4.38`——要用新调试能力得升级。
- 可观测性：wrangler 配 `observability.enabled=true` + `head_sampling_rate`；Dashboard 有实例状态/日志/指标；metrics-analytics 有 event-types（含 `WORKFLOW_QUEUED` 等）。
- compatibility_date **须 ≥ `2024-10-22`** 才能从 Worker 绑 Workflows。

---

## 2. Workflows 惯用法核实（三个必答点）

### 2.1 step 内轮询分钟级视频生成 API 【官方核实 + 推断】

两种写法，**优选事件回调**：

```ts
// 【推荐】外部回调 + waitForEvent（视频服务生成完 POST 回你的 Worker → instance.sendEvent）
await step.do("submit video job", async () => {
  return await seedanceClient.submit({ ... });   // 幂等：先查是否已提交
});
const done = await step.waitForEvent<VideoResult>("video-ready", {
  type: "video_ready", timeout: "30 minutes",     // 挂起时不占并发预算
});

// 【备选】step 内轮询（墙钟无限，但每次 poll 是一次 step.do；配退避）
const result = await step.do("poll video", { retries: { limit: 20, delay: "15 seconds", backoff: "constant" }},
  async () => {
    const s = await seedanceClient.status(jobId);
    if (s.state !== "succeeded") throw new Error("still running"); // 靠重试当轮询
    return s;
  });
```

- 轮询法可行（墙钟无限 + 重试即轮询），但**回调法更省**：等待期实例 hibernate、不计并发、不烧 CPU。视频服务若支持 webhook 就用 `waitForEvent`；只有轮询接口才退化到"重试当轮询"。

### 2.2 step 内经 Hyperdrive 访问 PG 【官方核实 · Rules of Workflows 明确成文】

> **原文警示**："If you use Hyperdrive in a Workflow, **create a new connection inside each `step.do()` and run your queries in that same step. Do not reuse a Hyperdrive-backed connection across steps.**"

- 原因：Workflows 会 hibernate/restart 丢内存态，跨 step 复用连接对象是非法的（连接不可序列化）。**每个 step 内新建连接 + 同 step 内查完**。
- 连接数：Hyperdrive 本身做连接池化/复用，缓解了"每 step 新连接"对 PG 直连数的压力；但仍受 Workers 子请求上限约束（Paid 默认 10,000/请求）。
- **结论：顺畅，但有强约束**——写 DB 的 step 必须自包含（建连→查询→[可选]关连，都在一个 `step.do` 里），这与"步骤幂等/自包含"的最佳实践一致。

### 2.3 代码新版本部署时 in-flight 实例的行为 ⚠️ 【二手细节核实，纠正常见误解】

**结论：Cloudflare Workflows 不做版本粘滞（no version pinning）。**

- 机制（replay 模型，与 V2 "replay-safe step" 一致）：实例每次恢复都从 `run()` 顶部重跑，**已完成的 step 按名字命中缓存直接返回旧结果、不重跑；未缓存的后续 step 执行"当前部署的代码"**。
- 因此 **in-flight 实例的后续步骤会跑新代码**——不是锁死在创建时的版本。
- 关键保护：**`waiting`/`sleeping` 态实例不执行代码，部署时不受扰**；只有**正在跑某 step**的实例可能在部署瞬间失败并重试（到新代码）。
- 硬约束（来自 architectingoncloudflare 第7章 + Rules of Workflows 的确定性要求）：
  1. **step 名 = cache key，且必须确定性命名**（禁 `Date.now()`/随机）。改动/重排/重命名"已被 in-flight 实例走过的 step"会导致缓存错位、行为未定义。
  2. **只做加法式变更**（append 新 step 到尾部安全；插入/删除中间 step 危险）。
  3. 被 Workflow 调用的 **service binding 必须向后兼容到最长实例存活期**——sleep 30 天的实例，30 天后仍会用旧调用约定打你的下游。
  4. 要改已跑过的逻辑，用 `instance.restart({ from })` 显式重放，别指望自动。

> 【来源冲突提示】某搜索摘要曾称"running 实例 pinned 到原始版本"，与 architectingoncloudflare 第7章原文直接矛盾。以**章节原文 + replay 模型 + V2 官方"replay-safe"措辞**为准：**无版本粘滞，未缓存 step 跑当前代码**。这是与 Temporal/DBOS 一致的 durable-execution 通例。**上线前务必用真实部署实测确认**（本条是全报告唯一"须实测复核"的行为点）。

---

## 3. Agents SDK（npm `agents`）— 范式参考，不采用

> 本地镜像 `references/repos/harness-2026-07-17/agents/`（monorepo，`packages/agents` v0.17.4）。
> **D-032 已锁 AI SDK，本节只提炼设计范式，不引入依赖。**

### 3.1 能力面 【本地源码 + README 核实】

- **Agent = Durable Object**：每 user/session/game-room/Task 一个实例，**idle 时 hibernate、零成本**，状态跨 restart 持久。
- **状态同步**：`this.setState()` → 自动同步到所有连接的客户端；React `useAgent<State>({ onStateUpdate })` hook 订阅。
- **HTTP + WebSocket + `@callable` RPC**：客户端像调本地函数一样调 Agent 方法。
- **Sub-agents（facets）**、**内建 SQL**（DO SQLite）、**scheduling**（`schedule.ts`：LLM 把自然语言解析成 `scheduled | delayed | cron | no-schedule`）、**MCP**（`mcp/` 全套 client+server+oauth+event-store）、**Fibers**（durable 协程：`StartFiberOptions`/`FiberStatus`/`FiberRecoveryResult`）。

### 3.2 有人拿它做 durable 编排吗？——`agents/workflows` 是金矿 【本地源码 `workflows.ts` 核实】

**有，且模式恰好是我们 Harness 需要的**。SDK 内建 `AgentWorkflow`（继承 `WorkflowEntrypoint`），把 **DO Agent（对话/会话壳）⇄ Cloudflare Workflow（durable 执行核）** 双向打通：

```ts
export class ProcessingWorkflow extends AgentWorkflow<MyAgent, TaskParams> {
  async run(event, step) {
    await this.agent.updateTaskStatus(event.payload.taskId, 'processing'); // 对 DO 的 typed RPC
    const r = await step.do('process', async () => { ... });
    await this.reportProgress({ step: 'process', status: 'complete', percent: 0.5 }); // 进度回 DO
    await this.broadcastToClients({ type: 'progress', data: r });                     // DO 经 WS 广播前端
    return r;
  }
}
```

源码里 `extendStep()` 把这些"副作用回传"**自动包成 step**（`__agent_reportComplete_*` / `__agent_sendEvent_*` / `__agent_updateState_*` / `mergeAgentState` / `resetAgentState`），即**进度上报/状态更新本身也是可重放的持久 step**，不会因 replay 重复广播。

### 3.3 对我们对话层/编排层的范式要点 【推断】

1. **双层分体正是我们要的形状**：对话壳（token 流式 + 白话进度广播）与 durable 执行核（五段式）解耦——壳持连接/推流，核跑 step、把进度**作为 step** 回推给壳广播。这直接满足"白话进度事件流回前端"+"crash 断点续跑"。
2. **进度即 step**：把 `reportProgress`/`broadcast` 也纳入 durable step，避免重放重复推送——我们自研 Harness（哪怕不用 Workflows）也应照抄这个"副作用检查点化"。
3. **状态同步协议**（set/merge/reset + `onStateUpdate`）可作为 ContextBundle/ContentPackage revision 前端同步的参考协议。
4. **Fibers** 是"轻量 durable 协程"，若哪天要在单进程内做多任务持久编排（不上 Workflows），是可借鉴的抽象。

> 采纳边界：**抄"DO 壳 ⇄ durable 核 + 进度即 step"的架构范式**；**不抄** DO/CF 绑定、不引 `agents` 包（与 AI SDK 冲突、且加深 lock-in）。

---

## 4. AI Gateway

### 4.1 能力面 【官方核实 · `/ai-gateway/`】

- 边缘代理，**一行代码接入**（改 base URL 加前缀）。提供：请求**重试**（gateway 级自动重试 2026-04 上线）、**模型 fallback**、**缓存**、限流、用量/成本**计量**、**日志**（每请求：prompt/响应/provider/时延/token/成本/状态）、guardrails。
- **BYOK**：Cloudflare **Secrets Store** 集成（2025-08），provider key 存 CF，运行时注入，不用每请求带 key。
- **统一 API**（OpenAI 兼容）：`/ai/v1/chat/completions`（新，REST）/ 旧 `/compat/chat/completions`（deprecated 但保留），一个 URL 按 `provider/model` slug 路由多家。

### 4.2 能当"能力层薄路由 + 模型调用审计复用件"吗？ 【推断】

能。它天然是"模型调用审计 + 重试/fallback/缓存"的现成中间层，与我们④执行择优（N 选 1 调文/图/视频模型）+ DecisionTrace 审计需求对齐。**但**它是纯代理、不做编排（无 step/断点续跑），只能是能力层的一段路由，不替代 Harness。

### 4.3 能接火山/豆包等中国 provider 吗？ ⚠️ 【官方核实 — 关键否定】

**基本不能（当前）。** 统一端点支持的 provider 是**封闭枚举列表**：
`Anthropic / OpenAI / Groq / Mistral / Cohere / Perplexity / Workers AI / Google-AI-Studio / Google Vertex / xAI / DeepSeek / Cerebras / Baseten / Parallel`（doc 更新日 2026-06-12）。

- **中国方向仅 DeepSeek 一等公民**；**火山方舟/豆包(Volcengine Ark)、通义/百炼(Qwen)、文心(百度)均不在列**。
- GLM(智谱)、Kimi(Moonshot) 只作为 **Cloudflare 托管的 Workers AI 模型**出现，**不是**对外部中国 provider 的代理。
- AI Gateway **没有"任意 OpenAI 兼容 base URL"通用 provider**——即便火山 Ark 暴露 OpenAI 兼容协议，也无法像 LiteLLM 那样指向任意自定义 endpoint。

**结论**：一旦模型迁到火山/豆包，AI Gateway 失去主要用武之地。验证期若用 OpenAI/Anthropic/DeepSeek，它是不错的审计/fallback 复用件；作为跨中国化的长期能力层**不可依赖**。

### 4.4 lock-in 面 【推断】

**低**。它是 URL 前缀代理，退出 = 去掉前缀、直连 provider，或换 LiteLLM/自研网关。日志/成本数据在 CF，但调用路径本身几乎零耦合。与 Workflows 的深 lock-in 完全两个量级。

---

## 5. Queues / Durable Objects(+Alarms) 与 pg-boss 职责重叠 【官方核实 + 推断】

- **Cloudflare Queues**（GA）：push/pull 消息队列。限额：消息 128KB、批 ≤100 条或 256KB、批等待 ≤60s、吞吐 5,000 msg/s/queue、消费者并发 ≤250（push）、消费者墙钟 15 分钟 / CPU 可配 5 分钟、重试 ≤100、backlog ≤25GB、显式 ack。**职责 = 异步解耦/削峰/扇出**，与 pg-boss 的"任务队列"直接重叠——但**无 durable 编排（无多 step/sleep/断点续跑）**。验证期已有 pg-boss，**不引入 Queues**（重复且加 lock-in）。
- **Durable Objects + Alarms**（GA）：单点强一致状态 + 定时唤醒（Alarm）。是 Agents SDK 的底座。**Alarm ≈ pg-boss 的 scheduled job**，DO 单例串行 ≈ pg-boss 的单队列顺序消费——但 DO 强在"每实体一个有状态协调者 + WebSocket"，pg-boss 强在"复用现有 PG、SQL 可查、无新基建"。
- **一句话对照**：我们已锁 pg-boss + PG，Queues/DO 的队列与调度能力**在验证期是重复投资**；DO 唯一不可替代的是"有状态实时协调 + WS 推流"，但那属于"是否走 CF 对话层"的另一个决策，不属编排层。

---

## 6. 逃逸路径核实（lock-in 硬评审）⚠️

### 6.1 Workflows 有 self-host / workerd 兼容实现吗？——**没有** 【官方核实 + 推断】

- **workerd 开源**（有 Vorker / OpenWorkers / Rivet 等自托管 Workers 兼容运行时），但 **Workflows 的 durable 协调引擎不是 workerd 的一部分**。`WorkflowEntrypoint` 类绑定在 `cloudflare:workers` 里，但**持久化/重放/调度/waitForEvent 分发是 Cloudflare 服务端闭源组件**。文档明说本地 `wrangler dev` 跑的是 **"emulated version"**（仅开发用模拟，非可生产的引擎）。
- **∴ Workflows 无法在自有 workerd / 中国云自托管。这是全栈里最硬的 lock-in 点。**

### 6.2 迁出语义差多少、迁移面多大？ 【推断，映射如下】

Workflows 的原语与主流 durable-execution 框架**一一对应**，语义差小、机械改动中等（每个 workflow 文件都要动，但结构可平移）：

| Workflows 原语 | DBOS（**首选逃逸**） | Temporal | Restate | Inngest |
|---|---|---|---|---|
| `class extends WorkflowEntrypoint` | `@Workflow` 注解函数 | Workflow func | handler | `inngest.createFunction` |
| `step.do(name, cb)` | `@Step` / `runStep` | Activity | `ctx.run` | `step.run` |
| `step.sleep / sleepUntil` | `DBOS.sleep` | `workflow.sleep` | durable sleep | `step.sleep` |
| `step.waitForEvent` + `sendEvent` | `recv` / `setEvent` | Signal | Awakeable | `step.waitForEvent` |
| `create({id, params})` | `startWorkflow` | `client.start` | invoke | `send` event |
| `NonRetryableError` | 非重试异常 | `ApplicationFailure(nonRetryable)` | terminal error | `NonRetriableError` |
| 补偿/rollback | 手写补偿 | Saga | sagas | 手写 |

- **DBOS = 最省力**：Postgres 为真相源（**我们本来就有 PG + pg-boss**），把普通 TS 函数加注解即得 durable execution，可自托管到任意云（含中国云），**无独立集群**。迁移主要动作 = ①WorkflowEntrypoint 类→DBOS 注解函数；②`env.KV/R2/Hyperdrive` binding→普通 client；③实例管理 API（create/get/sendEvent/terminate/restart）→DBOS 等价调用。**概念零损失，机械改动 = 每个编排文件重写外壳**。
- Temporal 最重（要自运维集群），Restate 轻量单引擎，Inngest 语义最接近（step/sleep/waitForEvent 同名）但也是托管优先。

> **战略含义**：若把编排逻辑写成"薄 Workflows 外壳 + 纯函数化的五段 step 内核"（step 内核不碰 CF 专有 binding、只依赖注入的 client），迁 DBOS 就只换外壳。**这应作为架构硬约束**：五段 step 内核保持 provider/runtime 无关。

---

## 7. 三栏总结

### ✅ 验证期可复用（在 CF 上直接用）
- **Workflows** 作主编排引擎：waitForEvent/sleep 挂起数天不占并发、replay 断点续跑、restart 重放、rollback 补偿、NonRetryableError 红线硬停、REST+binding 双通道实例管理——**限额与语义完全适配五段式 Harness**。
- **Hyperdrive→PG in step**：可用，强约束=每 step 内建连+查完，不跨 step 复用（正好符合 step 自包含最佳实践）。
- **AI Gateway**（有条件）：验证期若用 OpenAI/Anthropic/DeepSeek，可当模型调用的审计+重试+fallback+缓存薄路由；退出成本低。

### 📐 范式参考不采用
- **Agents SDK `agents/workflows`**：抄"**DO 对话壳 ⇄ Workflow durable 核 + 进度/状态更新皆检查点化为 step**"的双层架构与副作用检查点化模式；不引包（D-032 锁 AI SDK）。
- **Agents scheduling / Fibers / 状态同步协议**：作为自研 Harness 的设计借鉴。
- **Queues / DO+Alarms**：与 pg-boss/PG 职责重叠，验证期不引入；理解其模型即可。

### ⚠️ 与中国化迁移冲突点
1. **Workflows 无 self-host / 无 workerd 兼容 = 全栈最深 lock-in**。迁中国云必须整体换 durable-execution 框架（**DBOS 最省力，Postgres 原生可自托管**）。→ 硬约束：五段 step 内核写成 runtime/provider 无关的纯函数。
2. **AI Gateway 不支持火山/豆包/通义/文心**（仅 DeepSeek 一等公民、无任意 base URL 通用 provider）。用中国模型时它基本失效，**不可作长期能力层**。
3. **代码部署无版本粘滞**（未缓存 step 跑当前代码）→ 上线纪律：step 确定性命名、只加法式变更、service binding 长期向后兼容；此约束在换到 DBOS/Temporal 后同样成立（durable-execution 通例），但迁移期需重新验证 step 缓存语义。

---

## 附：来源 URL（全部现场核实）

**Workflows**
- 限额：https://developers.cloudflare.com/workflows/reference/limits/ （经 raw.githubusercontent cloudflare-docs `workflows/reference/limits.mdx` 核实全表）
- Workers API（实例管理/step/rollback/status）：https://developers.cloudflare.com/workflows/build/workers-api/
- Rules of Workflows（Hyperdrive/幂等/确定性/timeout≤30min/1MiB）：https://developers.cloudflare.com/workflows/build/rules-of-workflows/
- Events & parameters（waitForEvent/sendEvent/REST）：https://developers.cloudflare.com/workflows/build/events-and-parameters/
- Sleeping & retrying（重试默认值/动态 delay/NonRetryableError）：https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/
- GA 公告：https://blog.cloudflare.com/workflows-ga-production-ready-durable-execution/ ; https://developers.cloudflare.com/changelog/2025-04-07-workflows-ga/
- V2（50K 并发/replay-safe，2026-05）：https://www.infoq.com/news/2026/05/cloudflare-workflows-v2-release/
- 25k 步数 changelog：https://developers.cloudflare.com/changelog/post/2026-03-03-step-limits-to-25k/
- 版本/部署行为（无 pinning，replay）：https://architectingoncloudflare.com/chapter-07/ 【二手】
- llms-full：https://developers.cloudflare.com/workflows/llms-full.txt

**Agents SDK**：本地镜像 `references/repos/harness-2026-07-17/agents/packages/agents/`（v0.17.4；`src/workflows.ts` / `schedule.ts` / `mcp/` / `README.md`）；上游 https://github.com/cloudflare/agents ; https://developers.cloudflare.com/agents/

**AI Gateway**
- 总览：https://developers.cloudflare.com/ai-gateway/ ; 产品页 https://www.cloudflare.com/products/ai-gateway/
- 统一 API + provider 枚举列表：https://developers.cloudflare.com/ai-gateway/usage/chat-completion/ （doc 更新 2026-06-12）
- BYOK/Secrets Store：https://developers.cloudflare.com/changelog/2025-08-25-secrets-store-ai-gateway
- llms-full：https://developers.cloudflare.com/ai-gateway/llms-full.txt

**Queues / DO**
- Queues 限额：https://developers.cloudflare.com/queues/platform/limits ; 消费者并发 https://developers.cloudflare.com/queues/configuration/consumer-concurrency/ ; 批/重试 https://developers.cloudflare.com/queues/configuration/batching-retries/
- DO 最佳实践：https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/

**逃逸路径**
- workerd 自托管生态：https://github.com/VaalaCat/vorker ; OpenWorkers ; Rivet
- durable-execution 框架对照：https://www.dbos.dev/blog/durable-execution-coding-comparison ; https://www.tiarebalbi.com/en/blog/dbos-vs-temporal-postgres-durable-execution ; https://temporal.io/blog/what-is-durable-execution
