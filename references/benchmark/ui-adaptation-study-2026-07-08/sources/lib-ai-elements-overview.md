来源 URL：https://elements.ai-sdk.dev/docs （Introduction 页）+ https://ai-sdk.dev/elements/overview （Overview/组件总览页，含完整 demo 源码）
抓取日期：2026-07-08（经 r.jina.ai 转 Markdown）

---

# Introduction (elements.ai-sdk.dev/docs)

What is AI Elements and why you should use it.

[AI Elements](https://www.npmjs.com/package/ai-elements) is a component library and custom registry built on top of [shadcn/ui](https://ui.shadcn.com/) to help you build AI-native applications faster. It provides pre-built components like conversations, messages and more.

Installing AI Elements is straightforward and can be done in a couple of ways. You can use the dedicated CLI command for the fastest setup, or integrate via the standard shadcn/ui CLI if you've already adopted shadcn's workflow.

Here are some basic examples of what you can achieve using components from AI Elements.

Before installing AI Elements, make sure your environment meets the following requirements:

*   [Node.js](https://nodejs.org/en/download/), version 18 or later
*   A [Next.js](https://nextjs.org/) project with the [AI SDK](https://ai-sdk.dev/) installed.
*   [shadcn/ui](https://ui.shadcn.com/) installed in your project. If you don't have it installed, running any install command will automatically install it for you.
*   We also highly recommend using the [AI Gateway](https://vercel.com/docs/ai-gateway) and adding `AI_GATEWAY_API_KEY` to your `env.local` so you don't have to use an API key from every provider. AI Gateway also gives $5 in usage per month so you can experiment with models. You can obtain an API key [here](https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%2Fapi-keys&title=Get%20your%20AI%20Gateway%20key).

AI Elements is built targeting React 19 (no `forwardRef` usage) and Tailwind CSS 4.

You can install AI Elements components using either the AI Elements CLI or the shadcn/ui CLI. Both achieve the same result: adding the selected component's code and any needed dependencies to your project.

The CLI will download the component's code and integrate it into your project's directory (usually under your components folder). By default, AI Elements components are added to the `@/components/ai-elements/` directory (or whatever folder you've configured in your shadcn components settings).

After running the command, you should see a confirmation in your terminal that the files were added. You can then proceed to use the component in your code.

Installation commands (from GitHub README, confirmed 2026-07-08):

```bash
# Recommended — install all components
npx ai-elements@latest

# Via shadcn CLI — install all components
npx shadcn@latest add https://elements.ai-sdk.dev/api/registry/all.json

# Install a single component
npx ai-elements@latest add <component-name>
```

---

# Overview 页 Demo 摘录 (ai-sdk.dev/elements/overview)

页面描述："A full-featured chat interface with streaming, markdown and file attachments."

Demo 源码中出现的组件导入（节选，展示真实模块路径与用法）：

```tsx
"use client";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@repo/elements/conversation";
import {
  Message,
  MessageBranch,
  MessageBranchContent,
  MessageBranchNext,
  MessageBranchPage,
  MessageBranchPrevious,
  MessageBranchSelector,
  MessageContent,
  MessageResponse,
} from "@repo/elements/message";
import type { PromptInputMessage } from "@repo/elements/prompt-input";
import {
  PromptInput,
  PromptInputButton,
  PromptInputFooter,
  PromptInputTextarea,
  PromptInputTools,
} from "@repo/elements/prompt-input";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@repo/elements/reasoning";
import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from "@repo/elements/sources";
import { Suggestion, Suggestions } from "@repo/elements/suggestion";
import type { ToolUIPart } from "ai";
```

Demo 中的消息数据结构 `MessageType`（说明 parts/tool/reasoning/source 如何与组件对接）：

```ts
interface MessageType {
  key: string;
  from: "user" | "assistant";
  sources?: { href: string; title: string }[];
  versions: { id: string; content: string }[];
  reasoning?: { content: string; duration: number };
  tools?: {
    name: string;
    description: string;
    status: ToolUIPart["state"];
    parameters: Record<string, unknown>;
    result: string | undefined;
    error: string | undefined;
  }[];
  isReasoningComplete?: boolean;
  isContentComplete?: boolean;
  isReasoningStreaming?: boolean;
}
```

（完整 demo 含模拟流式输出 streamReasoning、多版本消息分支 MessageBranch、建议点击 Suggestion 等交互逻辑，因篇幅原因未全文收录，核心结构已保留于上方。）

---

# 补充：Tool 组件文档摘录 (ai-sdk.dev/elements/components/tool)

- `Tool` — "A collapsible component for displaying tool invocation details in AI chatbot interfaces."
- `ToolHeader` — 显示工具类型（如 `tool-fetch_weather_data`）与执行状态标识
- `ToolContent` — 可折叠内容容器
- `ToolInput` — 展示工具调用参数（JSON 语法高亮）
- `ToolOutput` — 展示工具执行结果或错误（`errorText`）
- 类型：`type ToolPart = ToolUIPart | DynamicToolUIPart;`
- 状态徽章（`getStatusBadge`）覆盖 7 种状态：`input-streaming`（Pending）、`input-available`（Running）、`approval-requested`（Awaiting Approval）、`approval-responded`（Responded）、`output-available`（Completed）、`output-error`（Error）、`output-denied`（Denied）
- 集成方式：`message.parts` 数组，`type` 命名为 `tool-{工具名}`；后端 `UIMessage[]` → `convertToModelMessages()` → `streamText` → `result.toUIMessageStreamResponse()`；前端 `useChat` + `DefaultChatTransport`
- 默认行为："Auto-opens completed tools by default for better UX"
