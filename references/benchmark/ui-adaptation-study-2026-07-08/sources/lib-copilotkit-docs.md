来源 URL: https://docs.copilotkit.ai/ (首页) + https://docs.copilotkit.ai/prebuilt-components/chat (CopilotChat 组件页)
抓取日期: 2026-07-08

---

# PAGE 1: https://docs.copilotkit.ai/

Title: CopilotKit: the frontend stack for agents

URL Source: https://docs.copilotkit.ai/

Markdown Content:
Free Generative UI course Build Interactive Agents with Generative UI with DeepLearning.AI

[Start free course](https://www.deeplearning.ai/short-courses/build-interactive-agents-with-generative-ui/)

[CopilotKit Docs](https://docs.copilotkit.ai/)
*   [Docs](https://docs.copilotkit.ai/)
*   [Reference](https://docs.copilotkit.ai/reference)
*   [Cookbook](https://docs.copilotkit.ai/cookbook)

[Get Enterprise Intelligence free](https://dashboard.operations.copilotkit.ai/?utm_source=docs&utm_medium=cta&utm_campaign=intelligence&utm_content=navbar)Talk to an engineer

[CopilotKit Docs](https://docs.copilotkit.ai/)[Docs](https://docs.copilotkit.ai/)[Reference](https://docs.copilotkit.ai/reference)[Cookbook](https://docs.copilotkit.ai/cookbook)

Frontend React Agent backend CopilotKit

Getting Started

[Introduction](https://docs.copilotkit.ai/)[Quickstart](https://docs.copilotkit.ai/quickstart)[CopilotKit CLI](https://docs.copilotkit.ai/cli)[Build with agents](https://docs.copilotkit.ai/build-with-agents)
Concepts

[Architecture](https://docs.copilotkit.ai/concepts/architecture)[Generative UI](https://docs.copilotkit.ai/concepts/generative-ui-overview)[Which Hook for Which Job](https://docs.copilotkit.ai/concepts/which-hook)[OSS vs Enterprise Intelligence Platform](https://docs.copilotkit.ai/concepts/oss-vs-enterprise)

[Agentic Protocols](https://docs.copilotkit.ai/agentic-protocols)

Basics

[Prebuilt Components](https://docs.copilotkit.ai/prebuilt-components)[Threads](https://docs.copilotkit.ai/threads)

Custom Look and Feel

[Programmatic Control](https://docs.copilotkit.ai/programmatic-control)[Inspector](https://docs.copilotkit.ai/inspector)
Generative UI

Your Components

[Tool Rendering](https://docs.copilotkit.ai/generative-ui/tool-rendering)[MCP Apps](https://docs.copilotkit.ai/generative-ui/mcp-apps)[A2UI](https://docs.copilotkit.ai/generative-ui/a2ui)
App Control

[Frontend Tools](https://docs.copilotkit.ai/frontend-tools)[Shared State](https://docs.copilotkit.ai/shared-state)[Agent Context](https://docs.copilotkit.ai/agent-app-context)
Built-in Agent

[Server Tools](https://docs.copilotkit.ai/server-tools)[MCP Servers](https://docs.copilotkit.ai/mcp-servers)[Model Selection](https://docs.copilotkit.ai/model-selection)[Advanced Configuration](https://docs.copilotkit.ai/advanced-configuration)[Anonymous Telemetry](https://docs.copilotkit.ai/telemetry)
Runtime

[Copilot Runtime](https://docs.copilotkit.ai/backend/copilot-runtime)[Runtime HTTP endpoints](https://docs.copilotkit.ai/backend/runtime-endpoints)[Use any model router](https://docs.copilotkit.ai/backend/custom-agent)[AgentRunner and persistence](https://docs.copilotkit.ai/backend/agent-runner)[Self-managed agents](https://docs.copilotkit.ai/backend/self-managed-agents)[Connect AG-UI agents](https://docs.copilotkit.ai/backend/ag-ui)[Deploy to any runtime](https://docs.copilotkit.ai/runtime-server-adapter)[Authentication](https://docs.copilotkit.ai/auth)
Intelligence Platform

[Enterprise Intelligence Platform](https://docs.copilotkit.ai/premium/overview)[Cloud-Hosted Enterprise Intelligence](https://docs.copilotkit.ai/premium/managed-intelligence-platform)[Self-Hosting Enterprise Intelligence](https://docs.copilotkit.ai/premium/self-hosting)[Enterprise Intelligence Architecture](https://docs.copilotkit.ai/premium/intelligence-platform)[Threads & Persistence Architecture](https://docs.copilotkit.ai/premium/threads-explained)
Deploy

[AWS AgentCore](https://docs.copilotkit.ai/deploy/agentcore)
Other

Troubleshooting

What's New

Migrate

Talk to an engineer

[](https://github.com/copilotkit/copilotkit)[](https://discord.gg/6dffbvGU3D)

# CopilotKit

The frontend stack for agentic user experience.

Build production chat, generative UI, shared state, and human-in-the-loop workflows on any AG-UI compatible backend.

Quickstart

Start using agents

## Build your agent's user experience

Pick the UI primitive that matches the product surface you are building.

[Chat components Drop in a chat surface where your users already work.](https://docs.copilotkit.ai/prebuilt-components/chat)[Headless UI Own every pixel and still use the agent runtime.](https://docs.copilotkit.ai/custom-look-and-feel/headless-ui)[Generative UI Let agents render real React components.](https://docs.copilotkit.ai/reference/hooks/useComponent)[Any agent Connect any backend that speaks AG-UI.](https://docs.copilotkit.ai/agentic-protocols/ag-ui)

Preview

Chat components Headless UI Any agent Generative UI

### Drop in a chat surface where your users already work.

Use CopilotChat, CopilotSidebar, or CopilotPopup when you want a complete agent UI out of the box.

example.tsx tsx

```
import { CopilotChat } from "@copilotkit/react-core/v2";

export function SupportAssistant() {
  return (
    <CopilotChat
      labels={{
        modalHeaderTitle: "Product assistant",
        welcomeMessageText: "What should we work on?",
      }}
    />
  );
}
```

[View chat components](https://docs.copilotkit.ai/prebuilt-components/chat)

## Build with any agent backend

Start with CopilotKit's default agent or open the docs for a partner framework.

[CopilotKit's Built-in Agent Use CopilotKit's in-process agent to get started fast.](https://docs.copilotkit.ai/quickstart)[Deep Agents LangChain Deep Agents connected to CopilotKit product UI.](https://docs.copilotkit.ai/deepagents)[LangGraph (Python)Python LangGraph agents with the broadest feature coverage.](https://docs.copilotkit.ai/langgraph-python)[LangGraph (FastAPI)Python LangGraph agents exposed through FastAPI.](https://docs.copilotkit.ai/langgraph-fastapi)[LangGraph (TypeScript)TypeScript LangGraph agents over the AG-UI adapter.](https://docs.copilotkit.ai/langgraph-typescript)[Google ADK Gemini-powered Google ADK agents connected through AG-UI.](https://docs.copilotkit.ai/google-adk)[AWS Strands (Python)AWS Strands agents with CopilotKit frontend primitives.](https://docs.copilotkit.ai/strands)[AWS Strands (TypeScript)TypeScript AWS Strands agents over the AG-UI adapter.](https://docs.copilotkit.ai/strands-typescript)[Mastra TypeScript-native agents, tools, memory, and workflows.](https://docs.copilotkit.ai/mastra)[PydanticAI Typed Python agents with PydanticAI and CopilotKit UI.](https://docs.copilotkit.ai/pydantic-ai)[MS Agent Framework (Python)Microsoft Agent Framework agents in Python.](https://docs.copilotkit.ai/ms-agent-python)[MS Agent Framework (.NET)Microsoft Agent Framework agents in .NET.](https://docs.copilotkit.ai/ms-agent-dotnet)[MS Agent Harness (.NET)Microsoft Agent Harness on .NET via AG-UI.](https://docs.copilotkit.ai/ms-agent-harness-dotnet)[AG2 AG2 agents with CopilotKit chat, tools, and HITL flows.](https://docs.copilotkit.ai/ag2)[Agno Agno agents with tools, state, and generative UI examples.](https://docs.copilotkit.ai/agno)[LlamaIndex LlamaIndex workflows connected to CopilotKit experiences.](https://docs.copilotkit.ai/llamaindex)[CrewAI (Crews)CrewAI crews wired into CopilotKit product interfaces.](https://docs.copilotkit.ai/crewai-crews)

---

# PAGE 2: https://docs.copilotkit.ai/prebuilt-components/chat

Title: CopilotChat

URL Source: https://docs.copilotkit.ai/prebuilt-components/chat

Markdown Content:
[CopilotKit's Built-in Agent](https://docs.copilotkit.ai/)[Prebuilt Components](https://docs.copilotkit.ai/prebuilt-components)CopilotChat
Inline chat component you can place anywhere and size as needed.

* * *

## What is this?

`<CopilotChat>` is the base prebuilt chat surface. Drop it in wherever you want the chat to render and size it to fit your layout. `<CopilotSidebar>` and `<CopilotPopup>` are both thin wrappers over the same primitives; if you need a dedicated chat page or an inline pane alongside other content, this is the component you want.

## When should I use this?

Use `<CopilotChat>` when you want:

*   A full-bleed chat that fills its container
*   An inline chat pane as part of a larger page
*   A dedicated `/chat` route
*   Maximum layout freedom (no docked chrome or launcher)

For a collapsible docked chat, use [CopilotSidebar](https://docs.copilotkit.ai/prebuilt-components/sidebar). For a floating bubble that overlays content, use [CopilotPopup](https://docs.copilotkit.ai/prebuilt-components/popup). For saved conversations and switching between prior conversations, see [Threads](https://docs.copilotkit.ai/threads).

## Basic setup

Wrap your app in `<CopilotKit>` once (the provider wires the runtime, session, and agent registry) and render `<CopilotChat>` inside the layout of your choosing:

```
<CopilotKitProvider runtimeUrl="/api/copilotkit" useSingleEndpoint>
      <Demo />
    </CopilotKitProvider>
```

## Code example

A self-contained component that renders the chat and wires in starter suggestions:

```
export function Chat() {
  useConfigureSuggestions({
    suggestions: [
      { title: "Write a sonnet", message: "Write a short sonnet about AI." },
    ],
    available: "always",
  });

  return <CopilotChat className="h-full rounded-2xl" />;
}
```

## Common props

`<CopilotChat>` is the root primitive. `<CopilotSidebar>` and `<CopilotPopup>` accept the same slots and labels, plus a few wrapper-specific props.

| Prop | Description |
| --- | --- |
| `agentId` | Agent slug the chat should talk to (must match an agent configured on the runtime). |
| `labels` | User-facing copy — header title, placeholder, welcome, disclaimer. |
| `messageView` | Slot for the message list — see [slots](https://docs.copilotkit.ai/custom-look-and-feel/slots). |
| `input` | Slot for the composer area (text area, send button, disclaimer). |
| `scrollView` | Slot for the scroll container (e.g. custom feather/gradient). |
| `suggestionView` | Slot for the suggestion pills shown below messages. |
| `welcomeScreen` | Slot for the empty-state. Pass `false` to disable. |

## Styling

`<CopilotChat>` is fully themable:

*   **CSS variables / class overrides** — see [CSS customization](https://docs.copilotkit.ai/custom-look-and-feel/css)
*   **Slots (subcomponents)** — see [slots](https://docs.copilotkit.ai/custom-look-and-feel/slots)
*   **Fully headless** — see [headless UI](https://docs.copilotkit.ai/custom-look-and-feel/headless-ui)
