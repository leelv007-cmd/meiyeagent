# ui-dojo（mastra-ai）深度分析 — 对路径 B 的参考

> 分析日期: 2026-07-13 ｜ 来源: https://github.com/mastra-ai/ui-dojo + https://ui-dojo.mastra.ai/
> 快照: commit `c034657`（2026-07-10 推送）｜ 166 stars ｜ TypeScript ｜ **仓库无 LICENSE 文件**
> 栈: @mastra/core@1.50.0 + @mastra/ai-sdk@1.6.1 + ai@5.0.112 + React 19 + TW 4.1.18 + Radix shadcn + streamdown@1.6.10 + motion@12 ｜ Vite SPA + 独立 Mastra server（:4750）双进程
> 本文行号均以快照 commit 为准；本仓采用时须按现行版本重核。

## 一、这个项目是什么

Mastra 官方的 UI 集成对照场：同一批 agent/workflow 后端，分别用 **AI SDK（useChat）/ Assistant UI / CopilotKit** 三套前端各接一遍，外加 generative UI、自定义事件、suspend/resume（HITL）、agent 网络、后台任务等进阶模式。约 200 个文件；`src/components/ai-elements/` 34 个组件（5192 行）全部是 Vercel AI Elements 的 copy-in 产物。

**定性：对我们不是组件库，是「接线活字典」**——它演示的正是路径 B 里最难的几张票（流式/长任务/工具结果如何接 UI）的标准答案。

## 二、五个直接对口的模式

### 1. `writer.custom()` → 阶段白话卡（票 09 的 UI 合同标准答案）

- 后端：`src/mastra/workflows/branching-workflow.ts`（12 处 `await writer?.custom(...)`）——workflow 步骤内发类型化事件 `{status: "in-progress"|"done", message, stage}`。
- 前端：`src/pages/ai-sdk/workflow-custom-events.tsx:20-71` `ProgressIndicator`——Badge（spinner/勾）+ 阶段名映射 + 一句白话 message，**全程无百分比**。
- 迁移要点：我们后端是 pg-boss 非 Mastra workflow，**抄 payload 形状（类型化事件 `{status, message, stage}`）进 streamRunEvents 设计**，不抄运行时。

### 2. `STATUS_MAP` 状态渲染合同（票 09/16）

`src/pages/ai-sdk/workflow.tsx:26-32`：步骤状态（running/waiting/suspended/success/failed）→ Tool UI 状态机（`ToolUIPart["state"]`），挂 `ToolHeader` 逐步点亮。视频成片五步链（票 16）的步骤 UI 就是这个形态。

### 3. suspend/resume HITL（票 18 · D4 三选一的架构升格参考）

`src/pages/ai-sdk/workflow-suspend-resume.tsx` + `src/mastra/workflows/approval-workflow.ts`：
- workflow 跑到关键步骤 **suspend 并携带 suspendPayload**（前端渲染决策卡，黄色 Awaiting Approval 区 + requestId Badge）；
- 用户决策后带 `{runId, step, resumeData: {approved, approverName}}` 恢复。

映射 D4：**生成 3 候选 → suspend（payload=3 候选）→ 用户单选 → resume({chosenIndex})；换一批 = resume({regenerate})，免费重试 ≤2 在服务端守卫**。把 D4 从"前端攒状态"升格为"工作流一等公民"，重试上限天然落在服务端。

### 4. 工具结果三态渲染（票 08/15/17 的卡片纪律）

`src/pages/ai-sdk/generative-user-interfaces.tsx:59-74`：`part.state` 三分支——`input-available`→Loader、`output-available`→类型化业务卡（`components/weather.tsx`，props 强类型 + lucide 图标映射）、`output-error`→错误文案。结果卡/模型卡/缩略图卡应走这个状态机，而非"job 完了整页刷新"。

### 5. `Response = memo(Streamdown)`（票 08 佐证 + memo 细节）

`src/components/ai-elements/response.tsx` 全文 22 行：Streamdown 包一层 `memo`，**比较函数只比 `children`**——流式高频更新下不做这个会整树重渲。佐证"一行 `<Markdown>` 拿富排版"成立。

## 三、战略级发现：ADR-0007「Port 预留」通路实证

`src/mastra/index.ts`：`chatRoute()/workflowRoute()`（`@mastra/ai-sdk`）输出**标准 AI SDK UI message stream**，前端 `useChat + DefaultChatTransport` 对后端是否 Mastra 无感知。

> **结论：按票 06/07 用纯 AI SDK 写前端（useChat/parts 渲染），未来若迁 Mastra，后端换 workflowRoute，前端一行不改。**"AI SDK 起步 + Mastra 推迟 + Port 预留"的迁移成本假设被该仓库实证。

另：
- `workflowRoute({ includeTextStreamParts: true })` 证明**长任务步骤内 agent token 可透传流式**——ADR-0010"副驾 token 流式 + 长任务 Job 观测"两口径的结合点。
- Mastra 已有 `backgroundTasks: { enabled: true }` 一等支持，但源码注释明确 suspend/resume 快照与后台任务**仍依赖共享 storage**——不改变 pg-boss 决策，Port 对端能力在长齐。

## 四、反面参考（不抄清单）

| 不抄什么 | 理由 |
|---|---|
| CopilotKit 整条线（`src/components/ck/` + 5 个包 + AG-UI/A2UI 协议栈） | 框架锁定；三线对比里 AI SDK 线代码最薄、依赖最少，反证 copy-in 轻栈决策正确 |
| Vite SPA + 独立 Mastra server（:4750、CORS `*`、OpenAI 直连、无鉴权） | demo 架构；本仓是 TanStack Start + Workers BFF，SSE 必须过 BFF（票 07 已定） |
| 逐字复制仓库代码 | **无 LICENSE**——`ck/` 卡片等只当模式参考重写；`ai-elements/` 走 Vercel AI Elements 官方 CLI 拉取（许可干净），不从此仓拷贝 |
| `zodv3: npm:zod@^3` 双版本 alias | Mastra 生态 zod v4 迁移期的坑存证；Port 预留时的预警项 |

**版本警示**：它用 `ai@5`，本仓 `ai@^7`——parts 协议（text/tool/data 三类 part + 状态机）延续，但 API 细节票 06 spike 时按 v7 文档核对，不可照抄行号。

## 五、票据映射表（已批注进各票「改造方案」）

| 本仓票 | ui-dojo 参考文件 | 取什么 |
|---|---|---|
| 06 后端流式 | `src/mastra/index.ts`（chatRoute/workflowRoute） | UI message stream 协议形状；includeTextStreamParts |
| 07 前端消费 | `src/pages/ai-sdk/index.tsx` | useChat + DefaultChatTransport + parts 渲染全套 |
| 08 富渲染 | `src/components/ai-elements/response.tsx` | memo(Streamdown) + children 比较函数 |
| 09 阶段叙事 | `workflow-custom-events.tsx` + `branching-workflow.ts` | `{status,message,stage}` 事件形状 + 无百分比阶段卡 |
| 10 任务浮标 | `src/components/ck/background-task-card.tsx` | 7 态→4 tone 映射 + elapsed 显示（模式参考，重写实现） |
| 16 视频接线 | `src/pages/ai-sdk/workflow.tsx` | STATUS_MAP + DisplayStep 逐步点亮 |
| 18 D4 择优 | `workflow-suspend-resume.tsx` + `approval-workflow.ts` | suspend(payload=候选)→resume(决策) 合同 |
| 22 Composer | `src/components/ai-elements/prompt-input.tsx`（1406 行） | attachments 一等公民完整参考（走官方 CLI 拉取） |

## 六、值得留意的小件

- `use-stick-to-bottom`：AI Elements Conversation 的自动吸底滚动依赖——流式聊天体验的隐性关键件（票 07/08）。
- `tokenlens`：上下文用量可视化，暂无对应票，记档不采。
- 三框架对比页本身（`/ai-sdk` vs `/assistant-ui` vs `/copilot-kit`）可作为团队内"为什么选 AI SDK 线"的演示材料。
