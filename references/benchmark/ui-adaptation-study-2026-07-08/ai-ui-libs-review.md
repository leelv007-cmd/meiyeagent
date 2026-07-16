# AI 原生 UI 组件库横评（2026-07-08）— 面向美业内容副驾

- 调研：ui-libs agent（opencli 适配器 + Jina 一手来源）；编者注（主 agent 合成时补）：
  - 报告提出的两条硬前提已由本地盘点（`mkfast-ui-baseline.md`）确认满足：**mkfast-template = React 19 + Tailwind ^4.1.18** ✓
  - 本地盘点另一事实：mkfast 的 primitive 层是 **Base UI 版 shadcn 4.0（非经典 Radix）**。~~落地验证项~~ → **已实测**，见文末【补充核查】：不会双装 Radix，真实成本 = `asChild`→`render` 改写量（prompt-kit 仅 5 处、价值中心组件为 0；assistant-ui 核心 npm 包焊死 9 个 Radix 依赖 → 从备选降为不推荐）。

## TL;DR 结论

- **首选（组合）：prompt-kit（做主力）+ Vercel AI Elements（做副驾对话/工具展示）**。两者都是 shadcn registry **copy-in 源码**、可任改话术/字号。prompt-kit 的组件是**后端无关的纯展示层**（PromptInput / ResponseStream / Markdown / Steps / ChainOfThought / Tool 可脱离聊天单独复用），天然契合"表单主入口 + 流式/结构化展示 + 可复用输入组件"；AI Elements 补齐 Tool/Reasoning/Sources/Task 等 AI 语义组件、原生吃 AI SDK v5 的 `message.parts`，用于第二入口的副驾对话。
- **备选：assistant-ui**。最成熟、维护最猛（4 天前发版、~11k star、YC 背书）、**唯一原生支持 AI SDK v6**、copy-in + headless 两层、有 React Native 包。但核心设定是"对话即主界面"（Thread/多会话/branching 状态机），对"对话是第二入口"偏重——只有当副驾对话要做成完整多轮 copilot 才值得上。**⚠️ 补充核查后降级为"不推荐"**：其核心 npm 包硬依赖 9 个 Radix 包（无法规避），在 Base UI 底座下等于两套 primitive 永久并存——见文末【补充核查】。
- **明确不选：CopilotKit、LlamaIndex chat-ui、Langui、shadcn.io（付费镜像）**。核心是"过重/黑盒/生态强绑定/停更"。

一句话取舍：**要的是"流式呈现 + 任务状态 + 可复用输入组件"这些零件，不是一整套 chat 框架**，所以 copy-in 零件库（prompt-kit / AI Elements）> 重型对话框架（assistant-ui / CopilotKit）。

---

## 两条跨库关键约束

1. **技术栈是 TanStack Start，不是 Next.js**。AI Elements、prompt-kit 的官方 CLI 脚手架和"全栈范例"都假设 Next.js，但**组件本体都是纯 React 组件，copy 进 TanStack Start 完全可用**——Next.js 只是 API route 范例和 CLI init 的假设，不是组件运行前提。真正被 Next.js 假设卡住的是 CopilotKit 的 Runtime 后端。来源：https://ai-sdk.dev/elements/overview 、https://www.prompt-kit.com/docs/installation
2. **React 19 + Tailwind v4 硬要求**（AI Elements 明确 targeting React 19 不用 forwardRef + Tailwind CSS Variables 模式；prompt-kit 要求 React ≥19 + Tailwind v4）。**已确认 mkfast 满足**。来源：https://elements.ai-sdk.dev/docs 、https://prompt-kit.com/docs/introduction

---

## 逐库速览表

| 库 | 分发模式 | AI SDK 兼容 | License | 活跃度 | 场景契合 |
|---|---|---|---|---|---|
| **prompt-kit** | ✅ copy-in 源码(shadcn) | SDK 无关(Primitives 用 v5) | MIT | 🟡 2.9k★，近 4 个月无提交 | ✅✅ 高 |
| **AI Elements** | ✅ copy-in 源码(shadcn) | 原生 v5 parts，向 v6 演进 | Apache-2.0 | ✅ 2.2k★，Vercel 官方，密集发版 | ✅ 高(副驾) |
| **assistant-ui** | ✅ copy-in(styled)+headless npm | ✅ 原生 v6(ai@^6) 与 v5(0.x legacy) | MIT | ✅✅ ~11k★，4 天前发版 | 🟡 偏重(对话主界面) |
| **CopilotKit** | ❌ npm 黑盒 | 不用 useChat，走自研 AG-UI 协议 | MIT | ✅✅ 35k★，$27M A 轮 | ❌ 过重(绑 runtime/协议) |
| **LlamaIndex chat-ui** | ❌ 伪 copy-in(实为 npm dist 黑盒) | 仅 v5，无 v6 | MIT | 🟡 587★，包 10 月未发版 | ❌ 生态强绑定 |
| **Langui** | copy HTML/JSX | 无 | MIT | ❌ 停更近 2 年 | ❌ 不选 |
| **shadcn 官方 chat** | copy-in(极早期) | ❌ 无 AI SDK 绑定 | 未声明 | 🆕 2026-06 起步 | ⏳ 观察 |

---

## 逐库详情

### 1. prompt-kit（首选主力）
- **组件**：19 个 shadcn 风格组件。命中需求的：`Message`/`ChatContainer`、`PromptInput`(受控)、`Tool`(input/output/status/errors)、`ChainOfThought`/`Steps`/`Loader`/`ThinkingBar`/`TextShimmer`(进度/reasoning)、`Source`(引用)、`ResponseStream`(流式文本，也支持任意受控渐进展示)、`Markdown`/`CodeBlock`、`JsxPreview`(流式 JSX)、`FileUpload`。来源：https://prompt-kit.com/llms.txt
- **AI SDK**：核心组件**纯 props 驱动、后端无关**（源码验证 `PromptInput` 是 `value/onValueChange/onSubmit/isLoading` 受控组件，**不内置 useChat**）。官方另有 `Primitives`（全栈范例，基于 **AI SDK v5**）供参考但不强耦合。来源：https://www.prompt-kit.com/primitives
- **分发**：`npx shadcn@latest add "https://prompt-kit.com/c/[COMPONENT].json"` 落地到 `components/ui/`，源码可改。另有 MCP server。
- **风险**：★2.9k、MIT；**最后 commit 2026-03-12，近 4 个月放缓**。作者 ibelick（参考实现 zola.chat）。→ 建议**锁定当前组件源码自维护**（copy-in 模式天然支持）。组件无硬编码文案，中文/i18n 无框架阻力，移动端响应式需自测。来源：https://github.com/ibelick/prompt-kit
- **为何首选**：PromptInput 可当通用表单输入复用；ResponseStream/Steps/ChainOfThought 可独立拼装做"表单提交后的结构化结果流式呈现"，不必引入完整对话 UI——**精确匹配"主入口是表单、对话是第二入口"的架构**。

### 2. Vercel AI Elements（首选·副驾对话/工具展示）
- **组件**：8 大族 ~50 组件。`Conversation`/`Message`/`MessageResponse`(Markdown)/`MessageBranch`；`PromptInput`系列(类型 `{text,files}`)；`Tool`/`ToolHeader/Input/Output`(7 态徽章含 awaiting-approval)；`Reasoning`(isStreaming/duration)/`Task`/`Loader`/`Shimmer`；`Sources`/`Inline Citation`；`Artifact`/`Canvas`/`Web Preview`/`Code Block`/`Actions`/`Suggestion`/`Model Selector`。来源：https://ai-sdk.dev/elements/overview
- **AI SDK**：**紧耦合 `useChat`(@ai-sdk/react) + `DefaultChatTransport`**，走 `message.parts` 数组、工具类型 `tool-{name}`——**AI SDK v5 的 UIMessage/parts 形态**；生态向 v6 演进。来源：https://ai-sdk.dev/elements/components/tool
- **分发**：copy-in，`npx ai-elements@latest` 或 `npx shadcn add https://elements.ai-sdk.dev/api/registry/all.json` → `@/components/ai-elements/`，可改。**Apache-2.0**（商用最友好）。Vercel 官方，2.2k★，发版密集。来源：https://github.com/vercel/ai-elements
- **风险**：React 19 + Tailwind 4 强绑定（已满足）；demo 文案英文需替换；移动端需自测。

### 3. assistant-ui（备选）
- **架构**：三层 = shadcn 前端组件 + Runtime 状态层 + 可选 Assistant Cloud。headless primitives + styled 两层。组件：`Thread`/`ThreadList`/`Message`/`BranchPicker`/`AssistantModal`(悬浮)、`Composer`(@/斜杠/历史)、`makeAssistantToolUI`/`ToolFallback`/`ToolGroup`、`ChainOfThought`/`Reasoning`/`MessageTiming`/`ContextDisplay`(token 环)、`Sources`/`Quote`、Generative UI(Tool UI + JSON spec 白名单渲染)、Attachments/Voice/Mermaid/LaTeX。来源：https://www.assistant-ui.com/docs/architecture
- **AI SDK**：`@assistant-ui/react-ai-sdk` 的 `useChatRuntime` 开箱连 useChat。**版本矩阵：ai@^6 → latest 主线；ai@^5 → 0.x legacy；ai@^4 → react-data-stream**。也支持 LangGraph/AG-UI/Mastra/自定义 runtime。→ **唯一把 v6 列为主线的库**。来源：https://www.assistant-ui.com/docs/runtimes/ai-sdk
- **分发**：copy-in（`npx shadcn add https://r.assistant-ui.com/thread.json`）+ headless npm。MIT，~11k★，4 天前发版(0.14.26)、425 版本，YC 背书，LangChain/Mastra 生产采用。有 `@assistant-ui/react-native`。
- **为何仅备选**：核心假设"对话是主界面"，复杂度在 threading/多会话/持久化。只要"局部流式 + 一句话提醒"则偏重；若副驾升级成完整多轮 copilot，它是最佳。

### 4. CopilotKit（不选）
- `CopilotChat`/`Sidebar`/`Popup`、`useFrontendTool`、`useRenderTool`(generative UI)、`CopilotTextarea`(Slate.js 补全)。无内置 reasoning/citations/进度组件。
- **否决点**：① 绑自研 **AG-UI 协议 + 必经 CopilotRuntime 后端中枢**（直连 agent 官方标注 "not recommended for production"）；② **npm 黑盒非 copy-in**；③ 不用 useChat。→ 与"不用重型 agent 框架 + 主入口是表单"直接冲突。MIT，35k★，$27M A 轮——库本身强，**定位错配**（服务"agent 是产品主体"）。来源：https://docs.copilotkit.ai/agentic-protocols/ag-ui
- 备考：TechCrunch 报道其 2026-05 A 轮 $27M。

### 5. LlamaIndex chat-ui（不选）
- 组件全（`ChatSection`/`ChatMessages`/`ChatInput`、`EventPartUI`、`ChatCanvas`+Artifact 版本历史、`Citation` widgets）。
- **否决点**：① **仅 AI SDK v5 无 v6**；② **伪 copy-in**——shadcn add 只复制接线示例，真实组件在 npm dist 黑盒；③ 高阶能力与 LlamaIndex workflow 事件协议强耦合；④ 文案英文硬编码无 i18n；⑤ 587★、包 10 月未发版。来源：https://github.com/run-llama/chat-ui

### 6. 补充发现
- **shadcn 官方 chat 组件（2026-06 新起步）**：conversation layer 一期（`MessageScroller`/`Message`/`Bubble`/`Attachment`/`Marker` + `@shadcn/react` headless），官方明确"不替代 AI Elements、不含 AI SDK 绑定"。→ **短期不构成方案，未来观察**。来源：https://ui.shadcn.com/docs/changelog/2026-06-chat-components
- **shadcn.io/ai**：**非官方付费镜像**（$49/月起，个人版非商用），把 AI Elements 打包进付费墙。→ 不作依赖来源。
- **Langui**：纯 Tailwind copy，停更近 2 年（2024-07）。仅视觉灵感。
- **Vercel Streamdown**：AI Elements 与 assistant-ui 共同的流式 Markdown 渲染件，可**独立轻量引入**满足"流式文本"最小需求。

---

## 落地建议

1. ~~先确认底座 React 19 + Tailwind v4~~ → **已确认满足**（mkfast-ui-baseline.md）。
2. **分层用法**：主入口场景技能卡/表单 → 自建 shadcn 表单 + prompt-kit `ResponseStream`/`Steps`/`Markdown` 做结果流式/结构化呈现；异步任务状态 → prompt-kit `Loader`/`ThinkingBar` 或 AI Elements `Task`；拟人化一句话提醒 → 自建轻组件；第二入口副驾对话 → AI Elements `Conversation`+`Tool`+`Reasoning`（useChat v5 parts）。
3. **版本策略**：AI SDK 锁 v5 stable；未来切 v6 时 assistant-ui 已 v6-ready 可作对冲。
4. **copy-in 自维护**：prompt-kit 放缓，锁定源码自维护，不阻塞。

## 留档清单（sources/，均含来源 URL + 抓取日期 2026-07-08）
lib-ai-elements-overview.md / lib-assistant-ui-docs.md / lib-copilotkit-docs.md / lib-llamaindex-chat-ui-readme.md / lib-prompt-kit-docs.md

---

# 【补充核查】Base UI shadcn 4.0 兼容性实测 + 第一眼价值视角（2026-07-08 二轮）

方法：opencli（npm 包元数据）+ curl 直取三家 shadcn registry JSON 实测依赖，未用浏览器渲染。

## 一、Base UI 兼容性 —— 冲突点不是"双装 primitive"，是 `asChild` vs `render` 的 API 差异

机制：AI Elements / prompt-kit 都遵循 shadcn 惯例，**不自带 Radix 原语**，用 `registryDependencies` 引用、从 `@/components/ui/*` 导入——在 Base UI 4.0 底座下解析到 Base UI 版本，**不会双装 Radix**。真实成本：组件源码里 Radix 的 `asChild` 组合 API 需逐处改写成 Base UI 的 `render={}`/`nativeButton`。实测改造面：

| 库 | asChild 总数 | 引用的 shadcn 原语 | npm 层是否夹带 Radix | Base UI 兼容判定 |
|---|---|---|---|---|
| **prompt-kit** | **仅 5**（tool/prompt-input/source/message/chain-of-thought 各 1） | collapsible/button/textarea/tooltip/hover-card/avatar（底座均已有） | ❌ 无（只 lucide-react） | ✅ **最佳**：流式/进度类组件零 asChild |
| **AI Elements** | 22（散在 50 组件） | 18 个含 dialog/select/dropdown/command/carousel（部分底座缺） | ❌ 无（只 use-controllable-state 工具 hook） | 🟡 **中**：我们要用的子集 asChild 很少 |
| **assistant-ui** | 16（thread.tsx）+ **核心 npm 包 `@assistant-ui/react` 硬依赖 9 个 Radix 包** | button | ✅ **有，且无法规避** | ❌ **最差**：Radix 焊进核心运行时 = Radix+Base UI 永久并存 |

关键结论：
- **prompt-kit 的"价值中心"组件（ResponseStream / Loader / Steps / ChainOfThought / Reasoning）asChild = 0、几乎纯 Tailwind**——落进 Base UI 4.0 几乎零改造；5 处 asChild 集中在交互件，每处一次 `render` 改写。
- **AI Elements** 需要的子集（Reasoning/Tool/Sources/Task/Loader）只引用 collapsible（底座已有）；但**整包移植**会牵出 carousel/button-group/input-group + motion/shiki/@xyflow/react 等重依赖 → **按需 copy 单个组件，不要跑整包 `npx ai-elements`**。
- **assistant-ui 是唯一真·双 primitive 库**（Radix 在 npm 核心包里，非 copy-in 壳）→ **从"备选"降为"不推荐，除非副驾要做成完整多轮 copilot"**。

**采用路径**：不跑候选库的 `npx shadcn add` 整包命令；手动 copy 需要的 `.tsx`，import 指向底座 `@/components/ui/*`，逐处 `asChild` → `render={<.../>}`＋按钮加 `nativeButton`。prompt-kit 全套 ≈ 5 处改写；AI Elements 取 Reasoning/Tool/Sources/Task ≈ 个位数改写。

## 二、第一眼价值分层（体验对外 / 架构对内）

**对"第一眼档次感 + 差异化感知"贡献最大的，恰是最轻、最 Base-UI-安全的组件；重型对话框架的重量几乎全在用户看不见的"架构对内"层。**

直接决定第一眼价值（体验对外，差异化锚点）：
- **流式文本逐字浮现**（prompt-kit `ResponseStream` / Vercel `Streamdown`）——"转圈→整块弹出"变"AI 正在为我写"，是非技术用户感知"这东西聪明"的第一信号；且 ResponseStream 后端无关，**直接吃现有 Workers AI/fal.ai server function 的流，不必先上 useChat**。
- **拟人化"正在思考/第几步"可视化**（`ChainOfThought`/`Steps`/`ThinkingBar` / AI Elements `Reasoning`/`Task`）——把长任务黑箱等待翻译成"有人在替我干活"；几乎零 primitive 耦合。
- **成品排版质感**（`Message`/`Markdown`/`CodeBlock`）——内容产品的"交付物"观感。
- **拟人化一句话提醒**——差异化"人格"触点，但组件极轻：底座已有 **sonner** 直接做，价值在文案与时机，不在组件库。

架构对内（第一眼无感的工程效率件）：对话滚动管理、多会话/branch 状态机、tool-call 管道、runtime/transport——assistant-ui 与 CopilotKit 的重量全在这层，对第一眼价值零增量。

**推论**：要买的正是"第一眼价值"那批轻组件，其最兼容供应方 = prompt-kit（最高价值组件＝最安全组件），AI Elements 按需补 AI 语义展示。重型框架买的是不需要且看不见的重量——与"架构对内、体验对外"定调错配。

## 三、结合底座现状的实施次序

底座已有请求-响应式 AI、零 streaming → 近期先上 prompt-kit `ResponseStream`+`Loader`+`Steps`/`ChainOfThought`（后端无关，直接接现有 server function 流），把"请求-等待-弹结果"升级为"流式+分步进度"；副驾对话（第二入口）真正要做时，再按需引 AI Elements `Conversation`/`Tool`/`Reasoning`/`Sources`（那时才需要 useChat + AI SDK v5 parts）。

## 四、最终排序（补充核查后）

**prompt-kit 首选**（价值中心组件 Base UI 下几乎零改造、直接贡献第一眼差异化）→ **AI Elements 按需取用**（选择性 copy，勿整包）→ **assistant-ui 仅当副驾升级为完整多轮 copilot 才考虑**（Radix 焊进核心）→ **CopilotKit / LlamaIndex / Langui 维持不选**。
