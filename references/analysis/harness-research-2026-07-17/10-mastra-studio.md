# Mastra 及其 Studio 深度调研

> **交叉验证裁定（Codex，2026-07-17）：成立但需修正（Editor/版本化/Studio 生产部署/①③局部采用均实锤；稳定版 1.51 非 1.52；「底层=AI SDK v5」应为「兼容 v5/v6/v7 生态」；Editor 的 model 限制仅指 OSS code-defined agent；StaticRBAC 免费用于生产未确认；**「DurableAgent 仅单进程 in-memory」的 2026-07-05 校准已不再准确**；7.5/10 打分不可复现；建议四项 spike gate 后条件批准 Port）** — 全文见 `xcheck/r10-xcheck.md`；引用本报告断言前先对照裁定。

> 调研日期：2026-07-17　|　调研员：harness 候选组件深调（Mastra Studio 专项）
> 一手来源：本地镜像 `references/repos/harness-2026-07-17/mastra/`（git HEAD `ae585fa`，提交时间 `2026-07-17 16:50 +0200`，与今日同步）
> 版本快照：`@mastra/core@1.52.0-alpha.4`、`mastra`(CLI)`@1.19.1-alpha.4`、`@mastra/playground-ui@42.0.0-alpha.4`、`@mastra/editor@0.13.8-alpha.0`
> 标注约定：【官方核实】= 镜像源码 / 官方文档直证；【推断】= 我基于证据的推理，未见明文。

---

## 0. 一句话结论（先给拍板依据）

Mastra 已经不是 2026-07-05 校准时的样子了。它 2026-01 发过 1.0，如今 1.52，并**长出了一整套针对本项目诉求的功能**：`@mastra/editor`（CMS 式的非代码提示词/工具编辑 + 版本化 + 回滚 + 版本定向）、可部署到生产并带 RBAC 登录的 Studio、workflow suspend/resume + PG snapshot 持久化、Langfuse/OTel 一等 exporter，而且**底层就是 Vercel AI SDK v5**（与我们对话层同源）。

但三个"要害"仍需清醒：(1) **Editor 只能改 instructions 和 tools，改不了 model、改不了择优参数、改不了 workflow 编排顺序**——用户"常变的模型/择优参数/④段内部顺序"这三项里，只有提示词一项被 Editor 完整覆盖；(2) Studio 是**观测 + 测试 + agent 调优**的台，它可视化的是 Mastra 原生 agent/workflow，用 Studio 就等于把编排层改跑 Mastra workflow；(3) 生产级 durable 的历史校准**今天仍成立**——原生引擎的崩溃恢复是"重启时从最后活跃步骤重跑"（步骤须幂等），真正的托管级 durable 仍是外挂 Inngest。

三选一我的定位：**部分采用（Editor + Studio 作为"运营调优 + 观测面"，运行时编排仍走独立 durable 载体）**，Port 建议**打开但限定在 Editor/Studio 这一层**，不轻易把整个五段式编排改跑 Mastra workflow。详见 §8。

---

## 1. 版本 / 许可 / 公司健康度 / 与 Vercel AI SDK 的关系

### 1.1 版本与发布节奏【官方核实】

- **1.0 已发布**：2026-01-21 稳定版（来源：官方博客 mastrav1）。当前镜像 `@mastra/core` 已到 **1.52.0-alpha.4**——半年 52 个 minor，`.changeset/` 目录有 100+ 待发条目，属**周级甚至更快的高频迭代**。
- 这也意味着**API 变动快**：本报告所有 API 以镜像 1.52 为准，落地时须钉版本。
- monorepo 关键包版本互不对齐（各包独立 semver）：CLI/playground 在 1.19、playground-ui 已到 42、editor 还在 0.13（0.x，最年轻）。

### 1.2 许可证【官方核实 — 重要】

`LICENSE.md` + `ee/LICENSE` 明确双许可：

| 范围 | 许可 | 商用自托管 |
| - | - | - |
| 绝大部分代码（core / workflows / editor 核心 / server / storage 等） | **Apache 2.0**（Copyright 2025 Kepler Software, Inc.） | 自由，含生产 |
| `packages/core/src/auth/ee/`（RBAC/FGA/ACL/roles）、`packages/server/src/server/auth/ee/`、`@mastra/editor/ee`（Agent Builder） | **Mastra EE 专有许可** | **禁止生产使用，除非与 Kepler 签书面协议**；仅允许本地开发/测试 |

EE 许可原文要点：`"may only be used in production if you ... have entered into ... a written agreement with Kepler"`，违规 30 天内不修复则授权自动终止。

**对本项目的实操含义**（这是关键去伪存真）：
- **Editor 核心开源可商用**：非代码人员改提示词/工具、版本化、draft/publish、回滚、db/code 双源——全在 Apache 2.0 内。源码核实：`@mastra/editor` 的 `exports` 为 `.`/`./composio`/`./arcade`/`./storage`/`./ee`，其中只有 **`./ee` 子路径（= Agent Builder，AI 辅助自然语言造 agent）** 在运行时校验 `MASTRA_EE_LICENSE`（`packages/editor/src/index.ts:403`：`"Agent Builder requires a Mastra Enterprise License for production use"`）。
- **Studio Auth 分层收费**【官方核实，`docs/studio/auth.mdx:159`】：本地开发 + Simple Auth（API key + `StaticRBACProvider`）**免费**；**生产环境接第三方 SSO 提供商（WorkOS/Clerk 等）+ 完整 RBAC/FGA 需要有效 EE license**。
- 结论：我们要的"非代码人员调提示词 + 版本化"**不触 EE**；但如果要生产级"运营团队各自 SSO 登录、细粒度权限"，那道门是 EE 付费。折中：自建薄登录层套在 Studio 前（见 §2.4）。

### 1.3 公司健康度【官方核实 / 网络核实】

- 主体 **Kepler Software, Inc.**（旧金山），三位创始人 Sam Bhagwat / Abhi Aiyer / Shane Thomas 是前 **Gatsby** 团队（2010s 广用的 React 静态站生成器）。
- 融资：**种子 $13M**（2025-10，YC + Gradient Ventures，120+ 天使含 Paul Graham/Guillermo Rauch/Amjad Masad/Balaji/Shay Banon）+ **Series A $22M**（2026-04，Spark Capital 领投），累计 **$35M**。
- 采用度：GitHub 23,000+ stars、npm 月下载 ~180 万，被称为近十八个月增速最快的 JS 框架之一。
- 判断：**健康度良好、资金充足、团队有大型 OSS 交付史**。风险不在"公司会不会黄"，而在"迭代太快、API 不稳、0.x 新模块（editor）还在成型"。

### 1.4 与 Vercel AI SDK 的关系【官方核实 — 对本项目最关键的亲和度判据】

镜像 `pnpm-workspace.yaml` catalog 显示 Mastra 全线依赖 AI SDK v5 生态：
```
@ai-sdk/provider@4.0.0
@ai-sdk/provider-utils@5.0.0
@ai-sdk/gateway@4.0.0
@ai-sdk/openai@4.0.0
@ai-sdk/anthropic@4.0.0
@ai-sdk/google@4.0.0
```
- **Mastra 建构在 Vercel AI SDK 之上，不是竞品栈**。模型 provider 就是 `@ai-sdk/*` 那套；agent 的 `model` 字段吃的是 AI SDK 的 provider/model；agent stream 输出与 AI SDK 流原语兼容（workflow 步骤里可以直接 `agent.stream().textStream.pipeTo(writer)`）。
- **亲和度极高**：我们对话层已定 Vercel AI SDK（D-032），引入 Mastra 不需要换 provider 生态、不需要换流式协议、可以共用模型字符串与 gateway 配置。这是 Mastra 相对其它 durable 载体（DBOS/Trigger/CF Workflows 都与 AI SDK 无天然绑定）的**独有加分项**。

---

## 2. Studio 功能面精查（用户点名的核心题）

### 2.1 Studio 是什么【官方核实，`docs/studio/overview.mdx`】

Studio（= 旧 dev playground 的正式化改名）是一个 **React 单页应用（SPA）**，连接一个正在运行的 Mastra server。它提供的面板：

| 面板 | 能力 |
| - | - |
| **Agents** | 与 agent 对话；动态切换 model；调 temperature/top-p；逐步查看推理 + 工具调用输出 + trace/日志；挂 scorer 比较质量；流式中可追问 |
| **Workflows** | 把 workflow 画成**图**；用 `inputSchema` 自动生成输入表单；逐步跑、实时高亮当前步；看每步 trace/JSON/错误；**Time travel**（跑完后重放/重试单步） |
| **Editor（子标签）** | 见 §3——非代码人员改 instructions/tools + 版本化 |
| **Prompts** | 管理可复用 prompt block（模板变量 + 显示条件） |
| **Processors / Guardrails** | 只读查看每个 agent 挂的输入/输出处理器、护栏、token 限制器 |
| **MCP servers / Tools** | 列出 MCP server 及工具；单独跑工具调试 |
| **Workspaces / Skills** | 内置文件浏览器看 agent workspace；Skills 标签列已发现技能 |
| **Scorers / Datasets / Experiments** | 评估：跑数据集、对比两次实验的评分、CSV/JSON 导入 |
| **Observability** | trace/metric/log（见 §6） |
| **Settings** | 配 Mastra 实例 URL、API prefix、自定义 header、主题 |

### 2.2 dev-only 还是可部署到生产？【官方核实，`docs/studio/deployment.mdx` — 直接命中用户问题】

**可部署到生产，且有三条正式路径：**
1. **`mastra studio` 独立进程**：serve 一份静态 SPA，连一个"已在别处跑的 Mastra server"。用 Node 内置 `http` + `serve-handler`，可 PM2/Docker/云跑，支持子路径部署（`MASTRA_STUDIO_BASE_PATH`）。
2. **与 API 同进程**：`mastra build --studio` 产出 `.mastra/output/studio`，设 `MASTRA_STUDIO_PATH` 让 Mastra server 一并 serve。一个服务搞定。
3. **Mastra 平台托管**：`mastra deploy` / `mastra studio deploy`（官方云沙箱，push-to-deploy，队列→上传→启动→运行，实例 URL 稳定）。

文档明确警告：`"Once Studio is connected to your Mastra server, it has full access to your agents, workflows, and tools. Be sure to secure it properly in production (e.g. behind authentication, VPN, etc.)"`——即**默认无鉴权、全权限**，生产必须自己加护栏。

### 2.3 非代码人员能否在 UI 改提示词/参数并持久化？有无版本/回滚？

**能——但要靠 Editor（§3），且能改的范围有边界。** 详见 §3。这里先给结论：
- 改**提示词（instructions / prompt block）**：能，改动落存储（db 源）或落 Git（code 源），每次保存生成版本快照，可 draft/publish/archive、可回滚、可版本定向。✅ 完整命中。
- 改 **model / temperature / top-p**：Studio 的 Agents 对话面板可以**临时**切模型/调参**做测试**，但**对"代码定义的 agent"，model 和 variables 是只读的、不能通过 Editor 持久化**（`docs/editor/overview.mdx:172`：`"Fields like the agent's id, name, and model come from your code and can't be changed through the editor ... The variables are also read-only"`）。❌ 用户要的"后台持久改模型/择优参数"不被覆盖。
- 改 **workflow 步骤顺序 / ④段内部策略**：Studio 只**可视化和逐步跑** workflow，**不能在 UI 里重排步骤或改分支逻辑**——那是代码。❌ 不覆盖。

### 2.4 多用户 / 权限 / 鉴权【官方核实，`docs/studio/auth.mdx` + `file-based-agents/studio.mdx`】

- 配置 `server.auth`（或文件约定 `src/mastra/studio.ts` 导出 `StudioConfig`）后，**Studio 自动出登录屏 + 全 API 强制鉴权**。一处配置同时护住 UI 和 API 路由。
- 登录方式随 provider 自适应：SSO-only（如 "Sign in with WorkOS" 按钮）/ 凭据-only（邮箱密码）/ 两者兼有。可按 provider 开关注册。
- **RBAC**：`server.rbac` + `StaticRBACProvider`，四个内置角色 `owner`（`*`）/`admin`（读写执行）/`member`（读+执行）/`viewer`（只读）。权限格式 `{resource}:{action}`，支持资源级 scope（如 `agents:read:my-id`）。RBAC 激活后 **Studio 自动隐藏无权限的操作按钮**（viewer 看不到删除键）。可把外部 IdP 角色（Clerk org / WorkOS group）映射到 Mastra 权限。
- **令牌透传**：外部应用可用 `?auth_header=Bearer%20token` 打开已鉴权的 Studio 会话（token 只留内存、用后从地址栏抹除、不写 localStorage）——这为"我们自己的运营后台内嵌 Studio"提供了干净的接入点。
- **收费边界**（重复强调，重要）：本地 + Simple Auth 免费；生产接第三方 SSO + 完整 RBAC/FGA = **EE 付费**。

### 2.5 Studio 采用即绑定？【官方核实 + 推断】

【官方核实】Studio 只能观测/操作**注册到该 Mastra 实例上的原生 agent / workflow**——它通过 Mastra server 的 REST API（`/api/agents/*`、`/api/workflows/*`、`/stored/*`）驱动。它不是通用可视化器，不能观测我们自己手写的、脱离 Mastra 的编排代码。

【推断】因此结论很直接：**要吃到 Studio 的 workflow 图可视化 / 逐步跑 / time travel，五段式就必须以 Mastra `createWorkflow`/`createStep` 表达；要吃到 Editor 的提示词版本化，五段里的 LLM 调用就必须以 Mastra `Agent` 表达。** 只吃"Agents 对话调试 + Editor 提示词管理"这一层，则不必把编排搬进 workflow（agent 可独立注册）；但"workflow 图可视化"这项价值与"编排跑在 Mastra"是强绑定的。

---

## 3. Editor —— 非代码调优的核心答案【官方核实，`docs/editor/overview.mdx` + `prompts.mdx`】

这是本次调研相对 2026-07-05 印象**最大的增量**，也是用户诉求命中度最高的组件。

### 3.1 它是什么

`@mastra/editor` 是一个 **CMS 式系统，把 agent 配置从代码里分离出来**。让"领域专家、提示词工程师、产品团队"直接迭代 agent，开发者保持代码库稳定。管理两类资源：**Prompts**（可复用、版本化的指令模板，带模板变量 `{{var}}` 和显示条件）和 **Tools**（从 Composio/Arcade/MCP 加工具、运行时覆盖工具描述）。

接入极简：
```typescript
import { Mastra } from '@mastra/core'
import { MastraEditor } from '@mastra/editor'

export const mastra = new Mastra({
  agents: { /* existing agents */ },
  editor: new MastraEditor(),  // source: 'db' (default) | 'code'
})
```

### 3.2 两种存储源（对我们审计/合规有意义）

| source | override 存哪 | Studio 动作 | 版本机制 |
| - | - | - | - |
| `db`（默认） | 配置的 storage 后端（PG 等） | 存草稿 + 发布 | draft/published/archived 快照 |
| `code` | 磁盘上 per-agent JSON（`./mastra/editor/agents/<id>.json`，进 Git） | 下载/写盘 | **用 Git 历史当版本历史**，每个改文件的 commit 在 Studio 里显示为只读版本 |

`db` 源适合"非开发者在 Studio 迭代 + 要版本/草稿/运行时版本定向"；`code` 源适合"override 进仓库、走 PR 评审、随应用部署"。**对我们**：db 源天然满足"运营在后台改、留痕、回滚"；code 源天然满足"改动进 Git、可审计、可评审"——两者甚至能按阶段切换。

### 3.3 版本化 / 回滚 / 版本定向【完整命中用户"版本/回滚"诉求】

- **每次保存生成版本快照**，三态生命周期：Draft（最新工作副本，每次保存新建）→ Published（生产激活版，同时只能有一个）→ Archived（旧版，可随时恢复）。
- **回滚 = 一次 API 调用**（恢复任意 archived 版本）。
- **版本定向**：因为每个版本有唯一 ID，可按 **请求 / 用户 / 环境** 路由不同版本 → 支持 A/B、金丝雀、per-user pin、staging 用 draft/prod 用 published。调用时传 `versionId` 或 `status`：
```typescript
mastra.getAgentById('support-agent')                         // published (default)
mastra.getAgentById('support-agent', { status: 'draft' })    // latest draft
mastra.getAgentById('support-agent', { versionId: 'abc-123' })
```
- **子 agent 版本覆盖**：supervisor 委派子 agent 时可指定用哪个存储版本，三级优先级（per-invocation > request body > Mastra 实例默认 > 代码默认），失败自动回落代码定义 agent。

### 3.4 能改什么、改不了什么【官方核实 — 用户选型标准的关键边界】

对"代码定义的 agent"，Editor 只允许改：

| 字段 | 可改 |
| - | - |
| Instructions | ✅ 替换/扩展系统提示词（用 prompt block） |
| Tools | ✅ 加工具、改工具描述（代码工具仍在） |
| id / name / **model** | ❌ 代码所有，只读 |
| **variables** | ❌ 对代码定义 agent 只读 |

且可用 agent 上的 `editor` 字段精确控制哪些可改：
```typescript
new Agent({
  id: 'support-agent',
  model: '...',
  editor: { instructions: true, tools: { description: true } },  // 只让改提示词 + 工具描述
})
// editor: false → 完全锁死；省略 → 提示词+工具可改
```

**对照用户"常变的三项"：**
| 用户想让运营常改的 | Editor 是否覆盖 |
| - | - |
| 提示词 | ✅ 完整覆盖（instructions + prompt block + 模板变量 + 显示条件） |
| 模型 / 择优参数 | ❌ model 只读；temperature 等只能对话面板临时试，不能持久化到代码 agent |
| ④段内部策略顺序 | ❌ 属 workflow 编排，Editor 不管 |

**破解思路【推断】**：把"模型选择 / 择优参数 / ④段策略开关"设计成 agent 的 **request context / variables 驱动的 prompt block 显示条件 + 工具集**，或建**数据库定义的 agent（非代码 agent，其 variables 可编辑）**，则这些参数能进 Editor 管理面。但这要求我们把编排设计成"配置驱动"，是额外工程，不是开箱即得。

### 3.5 程序化控制 + REST + 自动化实验

- `mastra.getEditor()` 暴露 `editor.agent.*` / `editor.prompt.*`（create/update/getById/list/listResolved/delete），每次 update 自动新建 draft 版本。
- 全套 REST：`/stored/agents`、`/stored/prompt-blocks`、`/stored/agents/:id/versions` 等——**非 TS 客户端或独立运营后台也能驱动**。
- 支持"自动化调优闭环"：跑数据集→评分→另一个 agent 读失败案例→`editor.agent.update()` 造 draft→重跑对比→分数变好则 promote。

### 3.6 成熟度警示【官方核实】

`@mastra/editor@0.13.8-alpha.0`——**0.x，全套里最年轻的模块**。功能面已经很完整（文档详尽），但 0.x 意味着 API 与存储 schema 仍可能 breaking。Agent Builder（`./ee`）另需 EE license。落地前须钉版本 + 小范围验证 db 源的迁移/回滚在 PG 上的真实行为。

---

## 4. Workflows 现状 —— durable 载体能力评估（牵动载体选型 A）

### 4.1 API 与基本模型【官方核实，`docs/workflows/overview.mdx`】

- `createStep({ id, inputSchema, outputSchema, resumeSchema, suspendSchema, stateSchema, execute })`，schema 支持 Zod/Valibot/ArkType（Standard JSON Schema）。
- `createWorkflow(...).then(step).commit()`，支持分支、并行、循环、嵌套 workflow、`cloneWorkflow`、workflow-as-step。
- 运行：`run.start()`（等全部完成）/ `run.stream()`（发事件流）。结果是判别联合 `success|failed|suspended|tripwire|paused`。
- **执行引擎二选一**：`"run using the built-in execution engine by default, or can be deployed to workflow runners like Inngest for managed infrastructure"`。

### 4.2 suspend/resume + 持久化【官方核实，`docs/workflows/suspend-and-resume.mdx` + `snapshots.mdx` — 直接命中"挂起数天等用户输入"】

- `await suspend(payload)` 在步骤内暂停，状态存为 **snapshot**；`resume({ step, resumeData })` 从暂停点恢复。
- **Snapshot 持久化到配置的 storage**，存 `workflow_snapshots` 表，按 `runId` 索引。文档明确：`"Snapshots are stored in your configured storage provider and persist across deployments and application restarts."`
- Snapshot 内含：每步状态、已完成步骤输出、执行路径、suspended 步骤及元数据、剩余重试次数、`serializedStepGraph`。
- **PG 生产可用**【官方核实】：storage adapter 支持 **PostgreSQL**、libSQL、Upstash、MongoDB、Cloudflare D1、DynamoDB。`resume()` 可从任意地方触发（HTTP 端点、事件、定时器）→ **挂起数小时至数天等用户输入完全支持**。
- `.sleep(ms)` / `.sleepUntil(date)`：workflow 级暂停（状态 `waiting`），区别于 `suspend()`（步骤级，状态 `suspended`）。
- **恢复读取**：`getWorkflowRunById(runId)` + `createWorkflowStateReader()` 暴露 suspended 步骤、resume label、payload、输出，无需碰原始 snapshot 结构。→ 支撑我们的 **revision fencing**（恢复时读回状态、按 label 精确 resume）。

### 4.3 崩溃恢复语义【官方核实 + 推断 — 载体选型的分水岭】

【官方核实，`overview.mdx:497-536`】原生引擎有崩溃恢复，但语义是"**从最后活跃步骤重启**"：
- `restart()` / `restartAllActiveWorkflowRuns()` 从最后活跃步骤恢复。
- 明文：`"When running the local mastra server, all active workflow runs will be restarted automatically when the server starts."`
- active run 的 `status` 为 `running` 或 `waiting`，可 `listActiveWorkflowRuns()` 枚举。

【推断，这是关键区别】：
- 已完成步骤的输出在 snapshot 里被 memoize，但**进行中的步骤在恢复时会重跑**（非 mid-step 精确续跑）→ **步骤必须幂等**，尤其是④段的付费图/视频生成调用与⑤段的写库。
- "server 启动自动重启" 是**本地/长驻进程**语义。**Vercel 无服务器函数没有长驻进程**，函数结束即无人 restart——原生引擎在 serverless 上拿不到自动崩溃恢复。这正是 Inngest 存在的理由，也和历史校准一致。
- 崩溃粒度：原生 snapshot **主要在 suspend/step 边界**落盘；它不是 Temporal/DBOS 那种"每次 IO/事件都写 WAL"的确定性重放引擎。对"分钟级视频轮询 + 数天挂起"，suspend/sleep 边界够用；对"函数中途 OOM/超时的自动补偿"，原生较弱。

### 4.4 代码版本升级时 in-flight 实例行为【推断 — 未见明文】

- 未在文档中找到原生引擎对"in-flight run 遇到代码/step 图变更"的显式契约。
- 【推断】snapshot 存 `serializedStepGraph` 且 resume 按 **step ID** 定位：若升级只改步骤内部实现、不改 step ID 与 schema，恢复应正常；若增删步骤、改 ID、改 `resumeSchema`，则旧 run 恢复有 mismatch 风险。
- 对比：**Inngest 有 `appVersion`（提交 SHA/镜像 tag）显式管理滚动部署**（`inngest.mdx:481`）——这是原生缺、Inngest 补的确定性版本治理。落地"数天挂起 + 频繁发版"务必重视此点。

### 4.5 并发控制【官方核实】

- **原生引擎**：文档未见内置的 per-key 并发/限流/节流原语（只有 workflow 组合与 state 共享）。
- **Inngest 模式补齐**：`concurrency`（按 key 限并发）、`rateLimit`、`throttle`、`debounce`、`priority`、`cron`（`inngest.mdx:529-802`）。这些是我们"④段视频生成按商户限并发、控成本"会用到的，**原生没有、Inngest 有**。

### 4.6 DurableAgent / Signals / SignalProvider —— 历史校准逐条重核【官方核实】

> 结论：**三条 2026-07-05 校准今天（1.52）全部仍成立**，且更清晰。

| 校准项 | 2026-07-05 说法 | 2026-07-17 重核结果 |
| - | - | - |
| **Signals** | 1.39 beta | ✅ 仍是 `@mastra/core@1.39.0`，仍标 beta（`"Breaking changes may occur without a major version bump until the API is stable"`）。1.52 未毕业。 |
| **DurableAgent** | 仅单进程 in-memory | ✅ 成立且细化：`createDurableAgent()`/`createEventedAgent()` **默认 in-memory cache、仅单进程内可恢复流**；生产要 Redis cache + PubSub 持久化；**真正生产级 durable 官方推荐 `createInngestAgent()`（跑 Inngest 平台，靠 Inngest 做 step memoize/retry/dashboard）**。DurableAgent 本身 `@mastra/core@1.45.0`、**beta**。 |
| **SignalProvider** | poll/webhook 非常驻调度器 | ✅ 成立：base 注册表 `"in-memory and per-process"`，重启不存活须自己持久化并在 `start()` 里 rehydrate；`poll()` 按 `pollInterval` 轮询 / `handleWebhook()` 手动挂到自己的路由，**没有常驻 cron 守护进程**。 |

补注：DurableAgent 是"把 agent 循环包进 workflow 让**单次长 agent 回合**可断线重连"的东西，**不等于**通用五段编排的 durable 载体；后者靠 §4.2 的 workflow suspend/resume。

### 4.7 Inngest 补什么（原生↔托管的差值）【官方核实，`guides/deployment/inngest.mdx`】

Mastra ↔ Inngest 是**一等公民集成**：`init(inngest)` 产出 Mastra 兼容的 `createWorkflow/createStep`，每个 workflow → 一个 Inngest function，每个 step → 一个 Inngest step。`serve()`（Hono/Express/Fastify/Koa/Next.js/Lambda/CF Workers 适配器）或 `connect()`（长驻 outbound worker，用于 K8s/Docker/ECS/Fly/Render，**不支持 Vercel/Lambda serverless**）注册。

Inngest 相对原生引擎增加：**step 结果 memoize（重试/恢复跳过已完成步）、flow control（并发/限流/节流/防抖/优先级）、cron、滚动部署版本（`appVersion`）、监控 dashboard、serverless 上的真 durable**。代价：多一个平台依赖 + `/inngest/api` 路由约定 + Inngest Cloud 计费。

---

## 5. 提示词管理【官方核实】

- **Mastra 自带提示词管理 = Editor 的 Prompt Blocks**（§3）：可复用、版本化、模板变量 `{{var}}`/`{{var || 'default'}}`/`{{nested.path}}`、显示条件（AND/OR 规则组，`equals/contains/greater_than/in/exists` 等算子）。非代码人员在 Studio **Prompts** 标签直接建/改/发布，一个 block 被多 agent 引用、改一处全联动。**不是"提示词全在代码里"**——这是相对旧印象的又一增量。
- **与 Langfuse Prompt Management 可组合**【官方核实，`langfuse.mdx:209`】：`withLangfusePrompt({ name, version })` + `buildTracingOptions` 把 LLM generation 链接到 Langfuse 里存的 prompt，做版本追踪与指标。即"提示词存 Langfuse、Mastra 引用并归因"这条路也通。
- 【推断】两套择一即可：若走 Mastra Editor 做提示词版本化，就不必再上 Langfuse prompt management（避免双写双源）；Langfuse 侧只做观测/评估更干净。

---

## 6. 观测 / 评估【官方核实】

- **导出器齐全**：`docs/observability/integrations/exporters/` 下有 **langfuse / otel / langsmith / braintrust / arize / datadog / sentry / posthog / laminar / arthur / mastra-platform / mastra-storage**。底座是 **OTel**。
- **Langfuse exporter**（`@mastra/langfuse`）：零配置（读环境变量）即用；realtime（开发，逐事件 flush）/ batch（生产）两模式；`flushAt`/`flushInterval` 调高频流；`excludeSpanTypes`（如 `MODEL_CHUNK`）抑制高频 span；自动把 trace scope 到发起的 agent/workflow（`langfuse.trace.metadata.agentId/workflowId`）便于按 agent 过滤 evaluator；自定义 top-level metadata 可过滤分组。
- **内置 evals/scorers 与 Studio 联动**（§2.1）：Scorers/Datasets/Experiments 三面板 + `mastra.metadata` 归因。
- 对本项目：**全程 DecisionTrace 审计 + 白话进度**可落在 Mastra 的 tracing + workflow `writer` 流事件上，并原样导出 Langfuse。这与并行调研的 harness-langfuse 结论应能拼合。

---

## 7. 五段式 Harness 映射（若用 Mastra workflow 跑）【推断为主，API 官方核实】

下面骨架把五段式表达为一个 Mastra workflow；④段的视频分钟级轮询用 `sleep` 循环，审批挂起用 `suspend`。**这是"若采用运行时"的样子**，用于对比"纯 AI SDK + 独立 durable 载体"多/少什么。

```typescript
// src/mastra/workflows/content-harness.ts
import { createWorkflow, createStep } from '@mastra/core/workflows'
import { z } from 'zod'

// ① 意图正名 — LLM 结构化（用注册的 agent，可被 Editor 调优）
const intentStep = createStep({
  id: 'intent-normalize',
  inputSchema: z.object({ rawRequest: z.string(), merchantId: z.string() }),
  outputSchema: z.object({ intent: z.object({ /* structured */ }) }),
  execute: async ({ inputData, mastra }) => {
    const agent = mastra!.getAgent('intentAgent')       // Editor-managed instructions
    const { object } = await agent!.generate(inputData.rawRequest, {
      output: z.object({ /* intent schema */ }),
    })
    return { intent: object }
  },
})

// ② 上下文注入 — 确定性组装 immutable ContextBundle（纯代码步骤，不可被 Editor 改）
const contextStep = createStep({
  id: 'context-inject',
  inputSchema: z.object({ intent: z.object({}) }),
  outputSchema: z.object({ contextBundle: z.object({}) }),
  execute: async ({ inputData }) => {
    const contextBundle = Object.freeze({ /* deterministic assembly */ })
    return { contextBundle }
  },
})

// ③ Brief 编译 — LLM（agent，可被 Editor 调优）
const briefStep = createStep({
  id: 'brief-compile',
  inputSchema: z.object({ contextBundle: z.object({}) }),
  outputSchema: z.object({ brief: z.object({}) }),
  execute: async ({ inputData, mastra }) => {
    const agent = mastra!.getAgent('briefAgent')
    const { object } = await agent!.generate(JSON.stringify(inputData.contextBundle), {
      output: z.object({ /* brief schema */ }),
    })
    return { brief: object }
  },
})

// ④ 执行与择优 — N 选 1 + 确定性红线门禁 + 视频分钟级轮询（幂等！）
const executeStep = createStep({
  id: 'execute-and-select',
  inputSchema: z.object({ brief: z.object({}) }),
  resumeSchema: z.object({ approved: z.boolean() }),   // 人审挂起
  suspendSchema: z.object({ candidates: z.array(z.any()) }),
  outputSchema: z.object({ chosen: z.object({}) }),
  execute: async ({ inputData, resumeData, suspend, writer, mastra }) => {
    // N 候选生成（文本/图/视频模型），须幂等：以 brief hash 做去重键
    // 视频分钟级轮询：在步骤内 while + 外层 workflow.sleep 拉长间隔
    await writer!.write({ type: 'progress', text: '正在生成候选…' })  // 白话进度流
    // 确定性红线门禁（纯代码，不可绕过）
    // 若需人审：
    if (!resumeData?.approved) return await suspend({ candidates: [] })
    return { chosen: { /* selected + gated */ } }
  },
})

// ⑤ 回装交付 — 写 ContentPackage revision（幂等 upsert by revisionId）
const deliverStep = createStep({
  id: 'repackage-deliver',
  inputSchema: z.object({ chosen: z.object({}) }),
  outputSchema: z.object({ revisionId: z.string() }),
  execute: async ({ inputData }) => ({ revisionId: 'rev_...' }),
})

export const contentHarness = createWorkflow({
  id: 'content-harness',
  inputSchema: z.object({ rawRequest: z.string(), merchantId: z.string() }),
  outputSchema: z.object({ revisionId: z.string() }),
})
  .then(intentStep).then(contextStep).then(briefStep)
  .then(executeStep).then(deliverStep)
  .commit()
```

**用 Mastra workflow 相比"纯 AI SDK + 独立 durable 载体（DBOS/Inngest 类）"：**

| 维度 | 多了什么 | 少了什么 / 锁进什么 |
| - | - | - |
| 观测 | Studio workflow 图 + 逐步跑 + time travel，开箱 | — |
| 调优 | Editor 让运营改①③的提示词 + 版本化 | — |
| 生态 | 与 AI SDK v5 同源，agent stream/provider 复用 | — |
| durable | suspend/resume + PG snapshot + `.sleep` 数天 | **serverless 上无自动崩溃恢复**（须 Inngest）；无内置 per-key 并发/限流（须 Inngest） |
| 版本治理 | — | in-flight run 遇发版的行为无明文（Inngest 有 `appVersion`） |
| 锁进 | — | ①③④以 Mastra Agent/Step 表达才吃得到 Studio/Editor；换栈成本上升；editor 存储 schema 0.x 可能 breaking |
| 确定性 | step 化、schema 校验 | 崩溃恢复是"重跑最后活跃步"，非确定性重放，**步骤须幂等**（红线门禁/写库/付费生成都要防重） |

---

## 8. 结论

### 8.1 Studio 对"非代码人员调提示词/参数 + 可视化"的满足度打分

**7.5 / 10。** 依据：
- 提示词：**10/10**——Editor + Prompt Blocks 完整命中（改、版本、回滚、定向、可复用、模板变量、显示条件），且开源可商用。
- 可视化编排查看：**8/10**——Studio workflow 图 + 逐步跑 + time travel 很强，但**只读可视化**，运营不能在图上重排步骤。
- 参数（模型/择优/④段顺序）：**3/10**——代码 agent 的 model/variables 只读、workflow 顺序是代码；需把参数设计成"配置驱动 + 数据库 agent + 显示条件"才能间接进后台，是额外工程。
- 生产多用户后台：**6/10**——能部署、有 RBAC，但生产 SSO/RBAC 是 **EE 付费**；免费档只有 Simple Auth（API key），够小团队不够精细运营权限。

### 8.2 为了 Studio 值不值得把编排层改跑 Mastra workflow

**不值得为"整套编排"改跑；值得为"①③的 LLM 调用 + Editor 调优"局部采用。** 理由：五段式的确定性主干（②上下文组装、④红线门禁、⑤写库 fencing）本就该是我们强控的代码，交给 Mastra workflow 只换来"图可视化"这一项软收益，却锁进 editor 0.x schema + 换栈成本 + serverless durable 缺口。而"运营改提示词 + 版本化 + Langfuse 观测"这三项硬收益，**只需把①③做成注册的 Mastra Agent + 挂 MastraEditor 即可拿到，不必把整个编排搬进 workflow**。

### 8.3 三选一定位

**部分采用（仅"运营调优 + 观测面"层）。** 具体：
- **采用**：`@mastra/editor`（提示词/工具版本化，db 源）+ Studio（Agents 对话调试 + Editor + Observability 面板）+ `@mastra/langfuse`。把①意图正名、③Brief 编译做成 Mastra `Agent`，让运营在 Studio Editor 里调提示词、版本化、A/B。
- **不采用（至少验证期不采用）**：Mastra workflow 作为五段编排的 durable 载体。durable 载体仍在 DBOS/Inngest/Trigger/CF Workflows 里另选（见并行调研）。若最终载体选 **Inngest**，则 Mastra workflow ↔ Inngest 是一等集成，未来把编排也收进 Mastra 的边际成本会显著降低——**这是把 Port 留大的理由**。
- **范式参考**：Editor 的 draft/published/archived + 版本定向、prompt block + 显示条件、`editor: {}` 字段级可编辑控制——即便不直接用，也应作为我们自研"运营后台调优面"的范式蓝本。

### 8.4 决策 B 的"Mastra Port"该不该打开

**打开，但限定口径。** 建议改写为：
> Mastra Port 打开至 **"Editor + Studio + Langfuse 观测"** 这一层——①③LLM 调用用 Mastra Agent 表达并挂 MastraEditor，运营通过（自建薄鉴权层包裹的）Studio 调提示词与版本化；**编排 durable 载体与②④⑤确定性主干暂不进 Mastra**，随 A 题载体结论（尤其若选 Inngest）再评估是否把 workflow 也收进来。EE 收费面（生产 SSO/RBAC、Agent Builder）默认不启用。

风险提示（须进决策票）：(1) `@mastra/editor` 0.x，钉版本 + 验证 PG 上 db 源迁移/回滚；(2) 高频发版（周级 minor）需锁定升级窗口；(3) 生产精细权限触 EE 付费，预算或自建登录层二选一；(4) Editor 改不了 model/择优参数/编排顺序，这三类"常变项"要么设计成配置驱动进 Editor，要么承认它们仍是"改代码 + 发版"。

---

## 来源清单

### 一手（本地镜像，git HEAD `ae585fa` @ 2026-07-17）
- `references/repos/harness-2026-07-17/mastra/LICENSE.md`、`ee/LICENSE`
- `packages/{core,cli,playground,playground-ui,editor}/package.json`（版本）
- `packages/core/src/auth/ee/`（RBAC/FGA/ACL/roles 目录）、`packages/editor/src/index.ts`（EE gating 校验）
- `pnpm-workspace.yaml`（AI SDK v5 catalog）
- `docs/src/content/en/docs/studio/{overview,deployment,auth,observability}.mdx`
- `docs/src/content/en/docs/mastra-platform/studio.mdx`、`docs/src/content/en/reference/file-based-agents/studio.mdx`
- `docs/src/content/en/docs/editor/{overview,prompts,tools}.mdx`、`docs/src/content/en/reference/editor/mastra-editor.mdx`
- `docs/src/content/en/docs/workflows/{overview,suspend-and-resume,snapshots,error-handling,scheduled-workflows,time-travel}.mdx`
- `docs/src/content/en/docs/long-running-agents/{durable-agents,signal-providers,signals}.mdx`
- `docs/src/content/en/guides/deployment/inngest.mdx`
- `docs/src/content/en/docs/observability/integrations/exporters/langfuse.mdx`

### 官方文档站 / 网络
- https://mastra.ai/docs
- https://mastra.ai/blog/mastrav1 （v1 beta / 1.0 公告）
- https://mastra.ai/blog/category/announcements
- https://www.crunchbase.com/organization/mastra-44ba （公司/融资）
- https://faq.com.tw/en/developer-tools/2026-04-10-mastra-22m-series-a-typescript-agents-en/ （Series A $22M）
- https://www.inngest.com/docs （Inngest 平台）
- https://langfuse.com/docs/prompt-management （Langfuse Prompt Management）
