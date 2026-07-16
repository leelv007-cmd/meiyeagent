来源 URL: https://www.prompt-kit.com/docs/introduction (+ https://prompt-kit.com/llms.txt, https://www.prompt-kit.com/docs/installation, https://www.prompt-kit.com/vercel-ai-sdk, https://www.prompt-kit.com/primitives, https://www.prompt-kit.com/docs/mcp)
抓取日期: 2026-07-08

# Introduction (prompt-kit docs)

**prompt-kit** is a set of customizable, high-quality components built for AI applications, making it easy to design chat experiences, AI agents, autonomous assistants, and more, quickly and beautifully.

**prompt-kit** is built on top of shadcn/ui with the same design principles. But instead of helping you build a component library, it helps you build AI interfaces.

This project is a work in progress, and we're continuously improving and expanding the collection. We'd love to hear your feedback or see your contributions as it evolves!

prompt-kit is open source. Check out the code and contribute on [GitHub](https://github.com/ibelick/prompt-kit).

## Installation

### Prerequisites
- Node.js version 18 or later
- React version 19 or later

### Install shadcn/ui
First, install and configure shadcn/ui in your project (see shadcn/ui documentation).

### Install prompt-kit components via shadcn CLI
```
npx shadcn@latest add "https://prompt-kit.com/c/[COMPONENT].json"
```

### Usage
```tsx
import { PromptInput } from "@/components/ui/prompt-input"
```

## Three tiers of building blocks (from prompt-kit.com/vercel-ai-sdk and /ai-sdk pages)

- **Components** — Everything to build your own UI. UI for AI elements. Headless logic. React, shadcn/ui and Tailwind CSS.
- **Blocks** — Ready-to-use UI pieces. Pure frontend. React, shadcn/ui and Tailwind CSS. Composable.
- **Primitives** — Fullstack blocks. UI components + API logic. Built on Vercel AI SDK (v5).

Install command for all tiers: `npx shadcn@latest add "https://prompt-kit.com/c/[COMPONENT].json"`

## Component index (from https://prompt-kit.com/llms.txt, fetched 2026-07-08)

- **prompt-input.tsx** — An input field designed for chat interfaces, allowing users to enter and submit text prompts to an AI model
- **code-block.tsx** — Displaying code snippets with syntax highlighting and customizable styling
- **markdown.tsx** — Rendering Markdown content with support for code blocks, GFM, and custom styling
- **message.tsx** — Displaying chat messages with support for avatars, markdown content, and interactive actions
- **chat-container.tsx** — Chat interfaces with intelligent auto-scrolling behavior
- **scroll-button.tsx** — Floating button that appears when users scroll up, to quickly return to bottom
- **loader.tsx** — Loading indicator with multiple variants and customizable styling
- **response-stream.tsx** — Simulate streaming text on the client side, for fake responses or controlled progressive text display
- **file-upload.tsx** — Drag-and-drop file upload interfaces, single/multiple files, custom triggers, visual drag feedback
- **jsx-preview.tsx** — Render JSX strings as React components, with support for streaming content and automatic tag completion
- **tool.tsx** — Displays tool call details including input, output, status, and errors; for visualizing AI tool usage in chat UIs
- **source.tsx** — Displays website sources used by AI-generated content, showing URL, title, description on hover
- **image.tsx** — Displaying images from base64 or Uint8Array data, accessible and responsive; for AI-generated or user-uploaded images
- **steps.tsx** — Sequence of operations in a collapsible layout; useful for AI steps like reasoning traces, tool calls, or process logs
- **system-message.tsx** — Banner-style component for contextual info/warnings/instructions
- **chain-of-thought.tsx** — Displaying a chain-of-thought process with collapsible steps and triggers
- **text-shimmer.tsx** — Shimmer effect on text, for loading states or highlighting
- **thinking-bar.tsx** — Displays the thinking state of an AI model with optional actions
- **feedback-bar.tsx** — Collect user feedback on AI responses

Docs site sidebar also separately lists (https://www.prompt-kit.com/docs/*): Chain of Thought, Chat Container, Code Block, Feedback Bar (new), File Upload, Image, Loader, Markdown, Message, Prompt Input, Prompt Suggestion, Reasoning, Scroll Button, Source, Steps, System Message, Text Shimmer (new), Thinking Bar (new), Tool.

## Primitives (fullstack, AI SDK v5)

- **Chatbot** — `npx shadcn@latest add "https://prompt-kit.com/c/chatbot.json"` — full chatbot UI + API route using Vercel AI SDK v5
- **Tool calling** — `npx shadcn@latest add "https://prompt-kit.com/c/tool-calling.json"` — chatbot with tool-calling feature, AI SDK v5

Source: https://www.prompt-kit.com/primitives — "Fullstack building blocks for AI applications. Each one includes a UI component and an API route using the Vercel AI SDK (v5). Easy to install with the shadcn registry."

## Vercel AI SDK integration (from https://www.prompt-kit.com/vercel-ai-sdk)

"Vercel AI SDK UI components cover the chat UI layer you need when building on AI SDK v5. That includes a prompt input, message list, and message rendering for markdown, code blocks, and links... Prompt-kit provides React chat UI components that are compatible with the AI SDK response patterns. You can connect the input and message list to the AI SDK stream, render partial tokens safely, and keep layout stable."

## MCP support (from https://www.prompt-kit.com/docs/mcp)

prompt-kit ships a Model Context Protocol server so AI coding tools (e.g. Cursor) can browse/add components directly:
```json
{
  "mcpServers": {
    "prompt-kit": {
      "description": "prompt-kit registry",
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "shadcn@canary", "mcp"],
      "env": { "REGISTRY_URL": "https://www.prompt-kit.com/c/registry.json" }
    }
  }
}
```

## GitHub repo facts (github.com/ibelick/prompt-kit, checked 2026-07-08)

- License: MIT (LICENCE.md)
- Stars: 2.9k, Forks: 157, Contributors: 13, Commits: 90 (main)
- Stack: Next.js 15, Tailwind CSS v4, React 19
- Last commit: Mar 12, 2026 ("feat: add sitemap") — commit cadence was roughly monthly Aug 2025–Mar 2026; no commits found between Mar 2026 and fetch date (2026-07-08), i.e. ~4 months quiet at time of check.
- Author: ibelick (also builds zola.chat, an open-source AI chat app used as a prompt-kit reference implementation)

## Source excerpts confirming "headless / backend-agnostic" design

`components/prompt-kit/message.tsx` (raw.githubusercontent.com/ibelick/prompt-kit/main/components/prompt-kit/message.tsx):
```tsx
export type MessageProps = {
  children: React.ReactNode
  className?: string
} & React.HTMLProps<HTMLDivElement>
```
— Message is a plain container component (children-driven), no coupling to any chat state/store.

`components/prompt-kit/prompt-input.tsx` (raw.githubusercontent.com/ibelick/prompt-kit/main/components/prompt-kit/prompt-input.tsx):
```tsx
export type PromptInputProps = {
  isLoading?: boolean
  value?: string
  onValueChange?: (value: string) => void
  maxHeight?: number | string
  onSubmit?: () => void
  children: React.ReactNode
  className?: string
  disabled?: boolean
} & React.ComponentProps<"div">
```
— Fully controlled component (value/onValueChange/onSubmit/isLoading props), not internally bound to `useChat` or any specific backend/SDK.
