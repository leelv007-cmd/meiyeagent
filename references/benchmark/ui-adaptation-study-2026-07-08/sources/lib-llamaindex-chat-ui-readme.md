来源 URL: https://github.com/run-llama/chat-ui (原始 README, 经 r.jina.ai 转 Markdown)
抓取日期: 2026-07-08

# @llamaindex/chat-ui

Chat UI components for LLM apps

## Overview

@llamaindex/chat-ui is a React component library that provides ready-to-use UI elements for building chat interfaces in LLM (Large Language Model) applications. This package is designed to streamline the development of chat-based user interfaces for AI-powered applications.

## Quick Start

You can quickly add a chatbot to your project by using Shadcn CLI command:

```sh
npx shadcn@latest add https://ui.llamaindex.ai/r/chat.json
```

## Manual Installation

To install the package, run the following command in your project directory:

```sh
npm install @llamaindex/chat-ui
```

## Features

- Pre-built chat components (e.g., message bubbles, input fields)
- Minimal styling, fully customizable with Tailwind CSS
- Custom widgets to extend components (e.g., for rendering generated or retrieved documents)
- TypeScript support for type safety
- Easy integration with LLM backends like Vercel Ai
- Code and Latex styling with highlight.js and katex

## Usage

1. Install the package

```sh
npm install @llamaindex/chat-ui
```

2. Configure Tailwind CSS to include the chat-ui components

For Tailwind CSS version 4.x, update `globals.css` to include the chat-ui components (update the relative path to node_modules if necessary):

```css
@source '../node_modules/@llamaindex/chat-ui/**/*.{ts,tsx}';
```

For Tailwind CSS version 3.x, you need to add the following to your `tailwind.config.ts` file:

```ts
module.exports = {
  content: [
    'app/**/*.{ts,tsx}',
    'node_modules/@llamaindex/chat-ui/**/*.{ts,tsx}',
  ],
  // ...
}
```

3. Import the components and use them

The easiest way to get started is to connect the whole `ChatSection` component with `useChat` hook from [vercel/ai](https://github.com/vercel/ai):

```tsx
import { ChatSection } from '@llamaindex/chat-ui'
import { useChat } from '@ai-sdk/react'

const ChatExample = () => {
  const handler = useChat()
  return <ChatSection handler={handler} />
}
```

## Component Composition

Components are designed to be composable. You can use them as is, or extend them with your own children components:

```tsx
import { ChatSection, ChatMessages, ChatInput } from '@llamaindex/chat-ui'
import LlamaCloudSelector from './components/LlamaCloudSelector' // your custom component
import { useChat } from '@ai-sdk/react'

const ChatExample = () => {
  const handler = useChat()
  return (
    <ChatSection handler={handler}>
      <ChatMessages />
      <ChatInput>
        <ChatInput.Form className="bg-lime-500">
          <ChatInput.Field type="textarea" />
          <ChatInput.Upload />
          <LlamaCloudSelector /> {/* custom component */}
          <ChatInput.Submit />
        </ChatInput.Form>
      </ChatInput>
    </ChatSection>
  )
}
```

Your custom component can use the `useChatUI` hook to send additional data to the chat API endpoint:

```tsx
import { useChatInput } from '@llamaindex/chat-ui'

const LlamaCloudSelector = () => {
  const { requestData, setRequestData } = useChatUI()
  return (
    <div>
      <select
        value={requestData?.model}
        onChange={e => setRequestData({ model: e.target.value })}
      >
        <option value="llama-3.1-70b-instruct">Pipeline 1</option>
        <option value="llama-3.1-8b-instruct">Pipeline 2</option>
      </select>
    </div>
  )
}
```

## Styling

### Components

`chat-ui` components are based on [shadcn](https://ui.shadcn.com/) components using Tailwind CSS.

You can override the default styles by changing CSS variables in the `globals.css` file of your Tailwind CSS configuration, or by setting custom `className` props on each component.

### Code and Latex styling

Inside the markdown component, we use [highlight.js](https://highlightjs.org/) for code blocks, [katex](https://katex.org/) for latex, and [pdf-viewer](https://github.com/run-llama/pdf-viewer) for pdf files. If your app is using code, latex or pdf files, you'll need to import their CSS files:

```tsx
import '@llamaindex/chat-ui/styles/markdown.css' // code, latex and custom markdown styling
import '@llamaindex/chat-ui/styles/pdf.css' // pdf styling
import '@llamaindex/chat-ui/styles/editor.css' // document editor styling
```

## Language renderer support (e.g. mermaid)

For any language that the LLM generates, you can specify a custom renderer to render the output (example: mermaid → SVG).

## Example

See the [example app](https://github.com/run-llama/chat-ui/blob/main/apps/web/README.md) for a complete example. To generate a full-featured project to get started with, use [create-llama](https://github.com/run-llama/create-llama).

## License

@llamaindex/chat-ui is released under the MIT License.

## Support

If you encounter any issues or have questions, please file an issue on the [GitHub repository](https://github.com/run-llama/chat-ui/issues).

---

## 附录 A：完整导出符号清单（来源: unpkg.com/@llamaindex/chat-ui@0.6.1/dist/chat/index.d.ts, 抓取日期 2026-07-08）

```
export {
  Artifact, ArtifactPartType, ArtifactPartUI,
  ChatCanvas, ChatInput, ChatMessage (= PrimiviteChatMessage), ChatMessages,
  ChatPartProvider, ChatSection,
  CodeArtifact, DocumentArtifact,
  EventPartType, EventPartUI,
  FilePartType, FilePartUI,
  MarkdownPartUI,
  SourcesPartType, SourcesPartUI,
  SuggestionPartType, SuggestionPartUI,
  TextPartType,
  WorkflowEventType,
  chatPartContext,
  createTask, extractArtifactsFromAllMessages, extractArtifactsFromMessage,
  fetchTaskEvents, getExistingTask, getParts, isEqualArtifact,
  sendEventToTask, transformEventToMessageParts,
  useChatCanvas, useChatInput, useChatMessage, useChatMessages, useChatUI,
  useChatWorkflow, useFile, usePart, useWorkflow
}

export type {
  AgentStreamEvent, AnyPart, ArtifactPart, ChatContext, ChatEvent, ChatHandler,
  ChatPartContext, ChatRequestOptions, ChatWorkflowHookHandler, ChatWorkflowHookParams,
  ChatWorkflowResume, CodeArtifactError, DataPart, EventPart, EventPartProps,
  FilePart, JSONValue, Message, MessagePart, RawEvent, RawNodeWithScore,
  RunStatus, SourceNodesEvent, SourcesPart, StreamingEventCallback, SuggestionPart,
  TextPart, ToolCallEvent, ToolCallResultEvent, UIEvent,
  WorkflowEvent, WorkflowHookHandler, WorkflowHookParams, WorkflowTask
}
```

子组件（namespace 成员）：
- `ChatInput.Form / .Field / .Upload / .Submit / .Preview`
- `ChatMessages.List / .Empty / .Loading`
- `ChatMessage.Avatar / .Content / .Actions`
- `ChatCanvas.Actions (ChatCanvasActions) / ArtifactVersionHistory / ArtifactContentCopy / ArtifactDownloadButton / CanvasCloseButton / CodeArtifactViewer / DocumentArtifactViewer / ArtifactCard`

## 附录 B：widgets 子包导出清单（来源: unpkg.com/@llamaindex/chat-ui@0.6.1/dist/widgets/index.d.ts, 抓取日期 2026-07-08）

```
export {
  ChatEvent, ChatFile, ChatSources, Citation, CodeBlock, CodeEditor,
  DocumentEditor, DocumentInfo, FileUploader, ImagePreview, Markdown,
  PdfDialog, StarterQuestions, SuggestedQuestions,
  fileExtensionToEditorLang, generateRandomString, preprocessSourceNodes, programmingLanguages
}
```

## 附录 C：shadcn registry (chat.json) 内容分析（来源: https://ui.llamaindex.ai/r/chat.json, 抓取日期 2026-07-08）

- `type`: `registry:block`
- `dependencies`: `["@llamaindex/chat-ui"]`（即仍然依赖 npm 包，不是把组件源码内联进项目）
- `registryDependencies`: `[]`
- `files`: 仅 1 个文件 `registry/chat/chat.tsx`，内容是一段示例用法（import 编译后的 npm 包组件 + mock messages + `useChat` hook 接线），**不是**组件本体源码。

结论：shadcn CLI 命令本质是脚手架/示例注入，真正的组件实现仍以编译后的 npm 包（`dist/`）分发，用户无法通过 shadcn add 拿到可编辑的组件源文件（虽然仓库本身 MIT 开源，可 fork `packages/chat-ui/src` 自行改造）。

## 附录 D：apps/web 示例项目依赖版本（来源: raw.githubusercontent.com/run-llama/chat-ui/main/apps/web/package.json, 抓取日期 2026-07-08）

```json
"@ai-sdk/react": "^2.0.4",
"ai": "^5.0.4",
"llamaindex": "0.9.3",
"next": "15.1.11",
"react": "^18.3.1"
```

`packages/server/package.json`（LlamaIndexServer, @llamaindex/server@0.4.1）同样依赖 `ai ^5.0.4` / `@ai-sdk/react ^2.0.4` / `llamaindex ~0.11.0`。截至抓取时刻，仓库 main 分支未见 Vercel AI SDK v6 相关依赖或迁移痕迹。

## 附录 E：npm registry 元数据（来源: registry.npmjs.org/@llamaindex/chat-ui, 抓取日期 2026-07-08）

- `dist-tags.latest`: 0.6.1
- `license`: MIT
- 最近版本时间线：0.5.13 (2025-07-02) → 0.5.17 (2025-07-21) → 0.6.0 (2025-08-13) → 0.6.1 (2025-08-28)，共 50 个历史版本
- npm 下载量：last-month (2026-06-06~2026-07-05) = 10,041；last-week = 2,306（来源: api.npmjs.org/downloads/point）

## 附录 F：GitHub 仓库活跃度（来源: r.jina.ai 渲染的 github.com/run-llama/chat-ui/commits/main 与 /releases，及 img.shields.io，抓取日期 2026-07-08）

- Star 数：587（shields.io badge）
- 最新 commit：`a514498` "Merge pull request #200 from run-llama/vercel/react-server-components-cve-vu-grfhrf"，作者 logan-markewich（LlamaIndex 核心维护者），提交于 2025-12-16 —— 说明仓库在最后一次 npm 发版（0.6.1, 2025-08-28）之后仍有安全修复类提交，但截至抓取时未见对应的新 npm 版本发布。
- 关键历史提交：`1ceb4ba` "feat: support Vercel AI SDK 5 (#189)" authored by thucpn, 2025-08-13 —— 确认 AI SDK v5 支持是在此提交引入。
- Releases 列表最新几项（均为 monorepo 内不同子包）：`@llamaindex/server@0.4.1`、`@llamaindex/dynamic-ui@1.0.1`、`@llamaindex/chat-ui@0.6.1`，三者均标注 "released 28 Aug 02:20"（github-actions 自动发布，changesets 流程）。
