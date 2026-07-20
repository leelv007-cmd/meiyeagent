来源 URL: https://www.assistant-ui.com/docs/installation (+ https://www.assistant-ui.com/docs, https://www.assistant-ui.com/docs/architecture)
抓取日期: 2026-07-08

# Installation (assistant-ui docs)

For AI agents: a documentation index is available at llms.txt. Use .md for canonical markdown pages; .mdx is kept as a backwards-compatible alias on supported URL paths.

## Quick Start

The fastest way to get started with assistant-ui.

### Initialize assistant-ui

Create a new project:

```
npx assistant-ui@latest create
```

Or choose a template:

```
# Minimal starter
npx assistant-ui@latest create -t minimal
# Assistant Cloud - with persistence and thread management
npx assistant-ui@latest create -t cloud
# Assistant Cloud + Clerk authentication
npx assistant-ui@latest create -t cloud-clerk
# LangGraph starter (react-langchain adapter)
npx assistant-ui@latest create -t langchain
# MCP starter template
npx assistant-ui@latest create -t mcp
# Eve agent starter template
npx assistant-ui@latest create -t eve
```

### Add API key

Create a `.env` file with your API key:

```
OPENAI_API_KEY="sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

Developing locally with a ChatGPT Plus or Pro plan? You can skip the API key and run on your subscription instead; see ChatGPT Subscription.

### Start the app

```
npm run dev
```

## Manual Setup

If you prefer not to use the CLI, you can install components manually.

### Add assistant-ui (shadcn registry copy-in model)

```
npx shadcn@latest add https://r.assistant-ui.com/thread.json https://r.assistant-ui.com/thread-list.json
```

(This is the shadcn CLI registry mechanism — components are copied as source files into the consuming project, not installed as an opaque npm black box.)

### Setup Backend Endpoint

Install provider SDK:

```
npm install ai @assistant-ui/react-ai-sdk @ai-sdk/openai
```

Add an API endpoint:

```ts
// /app/api/chat/route.ts
import { openai } from "@ai-sdk/openai";
import { frontendTools } from "@assistant-ui/react-ai-sdk";
import { convertToModelMessages, streamText } from "ai";
export const maxDuration = 30;
export async function POST(req: Request) {
  const { messages, system, tools } = await req.json();
  const result = streamText({
    model: openai("gpt-5.4-nano"),
    system,
    messages: await convertToModelMessages(messages),
    tools: frontendTools(tools),
  });
  return result.toUIMessageStreamResponse();
}
```

If you aren't using Next.js, you can also deploy this endpoint to Cloudflare Workers, or any other serverless platform.

### Use it in your app

```tsx
// /app/page.tsx
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useChatRuntime, AssistantChatTransport } from "@assistant-ui/react-ai-sdk";
import { ThreadList } from "@/components/assistant-ui/thread-list";
import { Thread } from "@/components/assistant-ui/thread";
export default function MyApp() {
  const runtime = useChatRuntime({
    transport: new AssistantChatTransport({
      api: "/api/chat",
    }),
  });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div>
        <ThreadList />
        <Thread />
      </div>
    </AssistantRuntimeProvider>
  );
}
```

---

# Architecture (https://www.assistant-ui.com/docs/architecture)

assistant-ui is built on three main pillars:

1. **Frontend components** — Shadcn UI chat components with built-in state management.
2. **Runtime** — State management layer connecting UI to LLMs and backend services.
3. **Assistant Cloud** — Hosted service for thread persistence, history, and user management (optional, paid add-on).

### UI layer
Primitives and prebuilt components render the assistant experience: thread, messages, composer, message parts, actions, attachments, suggestions. They read and write through the runtime context, not directly against the backend or model.

### Runtime layer
The state and behavior boundary between UI and backend. The runtime owns or adapts conversation state: messages, thread state, composer state, run lifecycle, branching, editing, regeneration. `LocalRuntime` keeps state internal; `ExternalStoreRuntime` delegates to your own store (redux/zustand/etc).

### Backend / agent layer
Produces assistant output and app-specific behavior — text, message parts, tool calls, metadata, agent state, attachments.

### Integration / protocol layer
Runtime adapters bridge assistant-ui to different backend shapes: AI SDK, LangGraph, LangChain, ADK, A2A, AG-UI, OpenCode, or custom. DataStream and AssistantTransport protocols let a generic backend talk to assistant-ui without a custom adapter per app.

### Persistence layer
Thread/message history stored via Assistant Cloud or your own DB via thread/history adapters.

---

# Documentation overview (https://www.assistant-ui.com/docs)

assistant-ui helps you create beautiful, enterprise-grade AI chat interfaces in minutes. Whether building a ChatGPT clone, customer support chatbot, AI assistant, or complex multi-agent application, assistant-ui provides frontend primitive components and state management layers.

- Instant Chat UI — pre-built, customizable chat interfaces out of the box.
- Chat State Management — optimized for streaming responses and efficient rendering.
- High Performance — minimal bundle size.
- Framework Agnostic — Vercel AI SDK, direct LLM connections, or custom solutions; works with any React-based framework.
