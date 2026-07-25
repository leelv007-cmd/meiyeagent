# Pi SDK 官方能力边界实读（2026-07-26）

## 结论先行

Pi SDK 适合被采用为**应用内的 agent 执行内核 / harness**，尤其能直接覆盖：

- 单 agent 的模型调用循环、thinking level、tool calling 和消息状态；
- 自定义工具注册、工具调用拦截、结果改写和事件订阅；
- 流式输出、工具执行进度、重试/压缩等生命周期事件；
- 多模型、多 provider、运行时切换模型与自定义 provider；
- 会话 JSONL 持久化、继续、分支、克隆、导入和上下文压缩；
- skills、系统提示词、AGENTS.md、prompt templates 和 extensions 的加载；
- 同进程 Node.js SDK、子进程 RPC、一次性 print、完整终端 UI 等接入形态。

它**不是**一个开箱即用的 SaaS agent 平台或 durable workflow engine。Pi 官方没有把以下能力作为 SDK 内建承诺：多租户/RBAC、业务数据库、可靠任务队列、定时调度、逐步骤断点恢复、审批中心、用量账本、业务审计、内容版本域模型、生产可观测平台、托管部署和内建安全沙箱。这些应由宿主产品负责。

最重要的安全边界是：Pi 默认以启动进程的用户权限运行；tool allowlist、extension 拦截和 project trust 都不是操作系统级安全边界。无人值守或不可信任务必须放到容器、VM、micro-VM 或策略沙箱中。

## 资料范围与快照

- 官方 SDK 文档：[SDK](https://pi.dev/docs/latest/sdk)
- 官方安全文档：[Security](https://pi.dev/docs/latest/security)
- 官方隔离部署文档：[Containerization](https://pi.dev/docs/latest/containerization)
- 官方会话文档：[Sessions](https://pi.dev/docs/latest/sessions) / [Session File Format](https://pi.dev/docs/latest/session-format)
- 官方扩展文档：[Extensions](https://pi.dev/docs/latest/extensions)
- 官方模型与 provider 文档：[Providers](https://pi.dev/docs/latest/providers) / [Custom Providers](https://pi.dev/docs/latest/custom-provider)
- 官方接入协议：[RPC Mode](https://pi.dev/docs/latest/rpc) / [JSON Event Stream Mode](https://pi.dev/docs/latest/json)
- 官方仓库：[earendil-works/pi](https://github.com/earendil-works/pi)
- 官方 SDK examples：[packages/coding-agent/examples/sdk](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/sdk)
- 读取时 `main`：[`5bc1c2c0a6f07e00e8c240304182f213ab8d311f`](https://github.com/earendil-works/pi/tree/5bc1c2c0a6f07e00e8c240304182f213ab8d311f)
- 该快照的 `@earendil-works/pi-coding-agent` 版本为 `0.82.1`，ESM，Node.js `>=22.19.0`，MIT License：[package.json](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/packages/coding-agent/package.json) / [LICENSE](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/LICENSE)

说明：`pi.dev/docs/latest/*` 是滚动文档；本文以以上日期和仓库 SHA 为阅读快照。以下只使用 Pi 官方文档和官方仓库，不使用二手资料。

## 一、核心原语

| 原语 | 官方明确支持 | 边界 |
|---|---|---|
| `createAgentSession()` | 创建单个 `AgentSession`；可注入 model、tools、custom tools、session/settings manager、resource loader | 是 session factory，不是租户、任务或 workflow factory |
| `AgentSession` | prompt、steer、follow-up、订阅事件、模型切换、thinking level、消息访问、tree navigation、compaction、abort、dispose | 管理单会话生命周期；new/resume/fork/import 等“替换活动会话”的能力不在这里 |
| `Agent` / `AgentState` | 核心 LLM 交互；暴露 messages、model、thinking level、system prompt、tools、streaming/error state | 可直接替换消息和工具，业务侧必须自己保护状态修改边界 |
| `AgentSessionRuntime` | new、switch、fork、clone、JSONL import；活动 cwd/session 更换时重建 cwd-bound services | session 替换后 `runtime.session` 会变化，原事件订阅失效，extensions 需要重新绑定 |
| `ModelRuntime` | 模型目录、认证解析、available models、运行时 API key override | 运行时 override 不持久化；生产凭证治理仍属于宿主 |
| `ResourceLoader` | extensions、skills、prompt templates、themes、context files、system prompt 的发现与覆盖 | 使用自定义 loader 后，默认目录发现规则不再替宿主工作 |
| `SessionManager` | 内存/文件会话、open/continue/list、tree、branch、labels、append entries | 是会话日志，不是业务数据库或可靠作业状态库 |
| `SettingsManager` | 全局+项目设置合并、in-memory overrides、异步写盘与 `flush()` durability boundary | 写入错误不自动打印，宿主需 `drainErrors()` 并处理 |

来源：[SDK Core Concepts、Options、Session Management、Settings Management](https://pi.dev/docs/latest/sdk)。

## 二、运行时与消息循环

### 2.1 Prompt 和排队

SDK 支持文本与 base64 图片输入。`prompt()` 在非 streaming 时直接运行；streaming 期间必须明确选择：

- `steer`：当前 assistant turn 的 tool calls 结束后插入新指令，再进行下一次模型调用；
- `followUp`：agent 完全停止后再执行后续消息。

`preflightResult(true)` 只表示请求已被接受、排队或立即处理，不代表最终成功；接受后的失败走常规事件/消息流。文件 prompt template 可展开；extension command 立即执行，不能作为 steer/follow-up 排队。

来源：[SDK - Prompting and Message Queueing](https://pi.dev/docs/latest/sdk)。

### 2.2 Agent loop 与控制

`AgentSession` 支持：

- 在运行中读取 `messages`、`isStreaming`、`model`、`thinkingLevel`；
- `setModel()`、`cycleModel()`、`setThinkingLevel()`；
- `compact()` / `abortCompaction()`；
- `abort()` 当前操作；
- `dispose()` 清理 session；
- 通过 `session.agent.waitForIdle()` 等待 agent 空闲。

这能够作为聊天式创作副驾和工具调用 agent 的内核，但官方 SDK 页面没有定义跨多个业务 step 的 durable workflow DAG、状态转移约束、补偿事务或 job lease。

来源：[SDK - AgentSession、Agent and AgentState](https://pi.dev/docs/latest/sdk)。

## 三、Tools 和 Extensions

### 3.1 内建与自定义工具

内建工具名为：

- `read`
- `bash`
- `edit`
- `write`
- `grep`
- `find`
- `ls`

默认启用 `read`、`bash`、`edit`、`write`。SDK 可用 `tools` 做 allowlist，用 `excludeTools` 排除指定内建/extension/custom tool，用 `noTools` 关闭全部或只关闭 built-ins。可以用 TypeBox schema + `defineTool()` 注册 inline custom tool，或由 extension 使用 `pi.registerTool()` 注册。

`edit` 的结果同时提供用于 Pi TUI 的 diff details 和标准 unified patch，便于宿主 UI 展示。

来源：[SDK - Tools、Custom Tools](https://pi.dev/docs/latest/sdk)。

### 3.2 Extension 能力

Extension 是与 Pi 进程同权限运行的 TypeScript 模块，可：

- 注册 LLM 可调用的自定义工具；
- 订阅 lifecycle/session/agent/model/tool 事件；
- 在执行前拦截、修改或阻止 tool call；
- 修改 tool result；
- 增加 slash command；
- 通过 `ctx.ui` 发起 select/confirm/input/editor/notify 等交互；
- 自定义 TUI component 和 tool/message renderer；
- 通过 `pi.appendEntry()` 把 extension state 写入 session；
- 通过 shared event bus 在 extensions 与宿主之间通信；
- 自定义 compaction、provider 和认证流程。

`tool_call` 在工具执行前触发；handler 可原地修改参数，或返回 `{ block: true, reason }`。官方同时说明默认 parallel tool execution 下，同一 assistant message 的 sibling tool calls 会先顺序 preflight，再并发执行；一个调用不能假定已经看到 sibling 的执行结果。会修改文件的自定义工具应加入 Pi 的 per-file mutation queue，避免 last-write-wins。

来源：[Extensions - capabilities、tool_call、custom tools](https://pi.dev/docs/latest/extensions)。

### 3.3 Extension 持久化边界

`pi.appendEntry(customType, data)` 可以保存重启后恢复的 extension state；`custom` entry 默认**不进入 LLM context**。需要进入上下文的是另一类 custom message entry。

这可保存 agent 插件的轻量 checkpoint、UI 元数据或工具状态，但不能自然等同于：

- 业务对象的 canonical store；
- 幂等键/唯一约束；
- 跨任务事务；
- 高并发队列 lease；
- 审计不可变性；
- disaster recovery。

来源：[Extensions - `pi.appendEntry()`](https://pi.dev/docs/latest/extensions)、[Session File Format](https://pi.dev/docs/latest/session-format)。

### 3.4 “Extension 能做”不等于“核心内建”

官方 coding-agent README 明确列出核心刻意不内建：

- MCP；
- sub-agents；
- permission popups；
- plan mode；
- built-in todos；
- background bash。

这些可以用 extension、外部进程、tmux 或第三方 Pi package 补充。尤其需要避免把 SDK 首页的“custom tools that spawn sub-agents”理解成 Pi 自带多 agent 编排器；它表示宿主可以在 custom tool 里自行创建/调度其他 agent。

来源：[官方 README - Philosophy](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/packages/coding-agent/README.md#philosophy)、[SDK - use cases](https://pi.dev/docs/latest/sdk)。

## 四、模型与 Provider

### 4.1 模型选择

SDK 支持：

- 按 provider/model 查找内建模型；
- 从 `models.json` 加载自定义模型；
- 只列出已配置有效认证的模型；
- 为 session 指定 model 与 thinking level；
- 配置 scoped models 并在运行时 cycle；
- 继续 session 时先恢复原模型，失败时再按 settings/default available model fallback。

thinking level 在当前 SDK 文档中包含 `off`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max`；实际可用档位仍取决于目标模型/provider。

来源：[SDK - Model](https://pi.dev/docs/latest/sdk)。

### 4.2 Provider 与认证

官方 provider 层支持 OAuth subscription providers、API key providers、多个 cloud providers、本地 `llama.cpp`，以及使用 OpenAI Completions、OpenAI Responses、Anthropic Messages、Google Generative AI 兼容协议的自定义 provider。

Extension 还能：

- 覆盖现有 provider 的 base URL / headers；
- 注册新 provider 及 model catalog；
- 启动时异步发现模型；
- 注册 OAuth/SSO；
- 提供完全自定义的 streaming API implementation。

`ModelRuntime` 的 SDK 认证解析顺序为 runtime override、`auth.json`、环境变量、custom provider fallback。runtime override 明确不落盘。官方 CLI provider 文档说明本地 `auth.json` 以 `0600` 创建，但这仍不替代服务端 secret manager、租户级凭证隔离和轮换审计。

来源：[SDK - API Keys and OAuth](https://pi.dev/docs/latest/sdk)、[Providers](https://pi.dev/docs/latest/providers)、[Custom Providers](https://pi.dev/docs/latest/custom-provider)。

## 五、会话持久化、恢复与上下文

### 5.1 明确支持

Pi 会话是 JSONL 文件，每条记录带 `type`，通过 `id`/`parentId` 组成 tree。默认目录按 cwd 分组位于 `~/.pi/agent/sessions/`。SDK 提供：

- `SessionManager.inMemory()`：不持久化；
- `SessionManager.create(cwd)`：新建持久化会话；
- `continueRecent(cwd)`：继续最近会话；
- `open(path)`：打开指定 JSONL；
- `list()` / `listAll()`；
- tree traversal、labels、branch、branch summary；
- runtime `newSession()`、`switchSession()`、`fork()`、clone、`importFromJsonl()`。

会话记录可包含 user/assistant/tool messages、model/thinking changes、compaction、branch summary、extension entries、labels 和 session info。旧版 session 会在加载时自动迁移到当前格式。

来源：[SDK - Session Management](https://pi.dev/docs/latest/sdk)、[Sessions](https://pi.dev/docs/latest/sessions)、[Session File Format](https://pi.dev/docs/latest/session-format)。

### 5.2 Compaction

Pi 能在 context threshold 溢出前自动压缩，也能手动 `compact()`。机制是调用 LLM 把较旧消息转成结构化 summary，保留近期 tail，写入 `CompactionEntry`，然后用 summary + retained messages 重建上下文。也支持 tree branch summary。

因此它可以缓解长会话 context window 限制，但 compaction 是**有损的 LLM 摘要**，不能替代产品事实、内容版本、合规结果或审计原文。

来源：[Compaction & Branch Summarization](https://pi.dev/docs/latest/compaction)。

### 5.3 明确限制

官方的“resume”是从 JSONL 会话重新构建对话/模型上下文，不是通用 durable execution：

- 没有官方声明的 workflow step graph；
- 没有 step 级 exactly-once；
- 没有队列 worker claim/lease；
- 没有 crash 后从外部副作用中点自动续跑；
- 没有跨节点共享 session store adapter 的官方合同；
- 没有业务级 OCC、事务或幂等收据。

这些不是说不能用 custom tool/extension 自行实现，而是不能把“可扩展”写成“Pi SDK 已内建覆盖”。

## 六、事件流与 UI 接入

### 6.1 `AgentSessionEvent`

`session.subscribe()` 可接收：

- assistant text/thinking delta；
- message start/update/end；
- tool execution start/update/end；
- agent start/end；
- turn start/end；
- queue update；
- compaction start/end；
- automatic retry start/end；
- summarization retry lifecycle；
- extension errors等。

这足以驱动聊天 streaming、工具步骤状态、取消/重试反馈和本地调试时间线。注意 session replacement 后，订阅仍绑在旧 `AgentSession`，宿主必须 unsubscribe、取得新的 `runtime.session` 并重新 subscribe；extensions 也要重新 bind。

来源：[SDK - Events、AgentSessionRuntime](https://pi.dev/docs/latest/sdk)、[JSON Event Stream Mode](https://pi.dev/docs/latest/json)。

### 6.2 三种程序化接入

| 形态 | 官方定位 | 适用边界 |
|---|---|---|
| SDK | 同一 Node.js 进程、类型安全、直接访问 agent state、程序化定制 tools/extensions | Node 服务或桌面应用内嵌 |
| RPC mode | JSON lines 子进程协议，可从其他语言接入，提供进程隔离 | Python/Go/其他语言宿主，或希望隔离 Pi 进程 |
| JSON event stream | CLI 单向输出全部 session events | 流式展示/流水线消费；不是完整双向控制协议 |

SDK 还导出完整 `InteractiveMode`、一次性 `runPrintMode` 和 `runRpcMode`。RPC mode 可把 extension 的 blocking UI dialog 转成 request/response 子协议，由客户端显示并回传选择。

来源：[SDK - Run Modes、RPC Mode Alternative](https://pi.dev/docs/latest/sdk)、[RPC Mode](https://pi.dev/docs/latest/rpc)、[JSON Event Stream Mode](https://pi.dev/docs/latest/json)。

## 七、权限、安全与沙箱

### 7.1 能做的应用内控制

- 用 `tools`/`excludeTools`/`noTools` 限定 agent 看见哪些工具；
- 只启用 `read`、`grep`、`find`、`ls` 形成 SDK 层“只读工具集合”；
- 用 `tool_call` extension 针对路径、命令或参数 block / confirm；
- 用 project trust 阻止未授权项目在启动时静默加载本地 settings、extensions、skills、prompts、themes 等资源。

这些适合做产品策略与 UX guard。

### 7.2 不能误认的安全边界

官方明确说明：

- Pi 没有 built-in sandbox；
- built-in tools 以 Pi 进程权限读写文件、编辑、运行 shell；
- extensions 是同权限 TypeScript 模块；
- project trust 只是“启动时加载哪些项目资源”的 guard，不限制模型启动后要求 tools 做什么；
- prompt injection 是本地 agent 的预期风险，Pi 不承诺可靠消除；
- 仓库可写文件被视为同一 local trust boundary。

因此 tool allowlist 和 extension gate 不能替代：

- OS/container filesystem ACL；
- network egress policy；
- secret broker；
- process isolation；
- 租户隔离；
- 服务端 authorization；
- 对不可逆业务动作的后端 policy enforcement。

来源：[Security](https://pi.dev/docs/latest/security)、[官方仓库 Permissions & Containerization](https://github.com/earendil-works/pi#permissions--containerization)。

## 八、部署与隔离

### 8.1 运行条件

- npm package：`@earendil-works/pi-coding-agent`；
- 当前官方仓库 package 为 ESM；
- Node.js `>=22.19.0`；
- MIT License；
- SDK 同进程接入；其他语言可用 RPC 子进程；
- 官方还提供从 release source 构建 standalone binary 的路径，但这与 SDK 作为 Node dependency 是两种交付方式。

来源：[SDK - Installation、RPC Mode Alternative](https://pi.dev/docs/latest/sdk)、[官方 package.json](https://github.com/earendil-works/pi/blob/5bc1c2c0a6f07e00e8c240304182f213ab8d311f/packages/coding-agent/package.json)、[官方仓库](https://github.com/earendil-works/pi)。

### 8.2 官方隔离模式

官方列出三种模式：

1. **Gondolin extension**：Pi 与 provider auth 留在 host，把 built-in tools 和 `!` command 路由到本地 Linux micro-VM；
2. **Plain Docker**：整个 Pi 进程进入容器；
3. **OpenShell**：整个 Pi 进程进入带 filesystem/process/network/credential/inference policy 的 sandbox。

限制：

- host Pi + tool-routing extension 时，其他 custom extension tools 仍在 host 运行，除非它们也主动 delegate；
- bind-mount 的 workspace 仍可从容器/VM 写回 host；
- 挂载 host `~/.pi/agent` 会暴露 host 的 sessions、settings、credentials；
- plain Docker 中 provider key 会进入容器；
- stronger isolation 需要只挂最小路径、最小凭证，并由宿主限制 network。

来源：[Containerization](https://pi.dev/docs/latest/containerization)、[Security - Running Untrusted or Unmonitored Work](https://pi.dev/docs/latest/security#running-untrusted-or-unmonitored-work)。

## 九、能力判定表

| 能力 | 判定 | 依据 / 缺口 |
|---|---|---|
| 单 agent LLM + tool loop | **明确支持** | `Agent`、`AgentSession` |
| 流式聊天与工具进度 | **明确支持** | `AgentSessionEvent`、JSON event stream |
| 文本+图片 prompt | **明确支持** | `PromptOptions.images` |
| 运行中 steer / follow-up | **明确支持** | 两类消息队列 |
| 模型/provider 切换 | **明确支持** | `ModelRuntime`、custom providers |
| 自定义工具和业务 API 接入 | **明确支持** | `defineTool()`、`pi.registerTool()` |
| 工具调用前审批/拦截 | **可由 extension 实现** | `tool_call` block + `ctx.ui.confirm`；不是强制的系统权限层 |
| skills / context / prompt 扩展 | **明确支持** | `ResourceLoader` |
| 会话持久化、继续与分支 | **明确支持** | JSONL `SessionManager` |
| 长上下文压缩 | **明确支持** | compaction / branch summary；有损摘要 |
| 自定义 UI | **明确支持一部分** | SDK events 供任意 UI 消费；官方自带的是 TUI，Web/移动 UI 由宿主实现 |
| 非 Node 语言接入 | **明确支持替代路径** | RPC 子进程，不是原生多语言 SDK |
| 多 agent / sub-agent | **可通过 custom tool 组合** | SDK 页将“custom tools that spawn sub-agents”列为 use case；未提供 durable multi-agent scheduler 合同 |
| MCP | **核心明确不内建** | 可由 extension 或第三方 package 接入 |
| Plan mode / todos / background bash | **核心明确不内建** | 官方 README 明列为 extension/外部工具职责 |
| Durable workflow / step resume | **未内建** | session resume 不等于业务 step 恢复 |
| 任务队列、cron、后台 worker | **未内建** | 需宿主系统 |
| 产品业务状态与数据库 | **未内建** | session JSONL 不能当 canonical business store |
| 多租户、RBAC、配额、账单 | **未内建** | 需宿主系统 |
| 内容合规/发布审批 | **未内建** | 可接成 tools/extensions，但规则与事实源由宿主负责 |
| 内建 sandbox | **明确不支持** | 官方 Security 明示无 built-in sandbox |
| 托管 control plane / SaaS 部署 | **未承诺** | 官方提供库、CLI、RPC、binary 和隔离模式，不提供托管产品合同 |

## 十、面向产品规划评估时应采用的口径

后续把 Pi 对照产品功能时，应把结论分成三层：

1. **Pi 可直接承担的 runtime primitive**：prompt、agent loop、tool calls、事件、session、model/provider、extensions；
2. **利用 Pi extension/custom tool 可接入，但仍由我们拥有的能力**：商家事实读取、内容生成工具、合规 gate、审批、发布、资产、外部搜索/解析、sub-agent 调度；
3. **Pi 不应成为事实源的能力**：ContentPackage/内容版本、StoreFact、用量与计费、任务状态机、幂等、租户权限、审计、凭证与 sandbox policy。

简化说：**Pi 能覆盖 agent 的“脑、手、对话记忆和事件总线”，不能覆盖产品的“业务账本、可靠执行底座和安全边界”。**
