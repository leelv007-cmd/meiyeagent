# Tool UI
> 原文链接: https://www.assistant-ui.com/docs/tools/tool-ui

---

Create custom UI components for AI tool calls, providing visual feedback and interactive experiences when tools are executed.

# How can I help you today?

Scroll to bottom

What's the weatherin San Francisco?

Explain React hookslike useState and useEffect

Show a live dashboardwith the present tool

## [Overview](#overview)

Tool UIs in assistant-ui allow you to create custom interfaces that appear when AI tools are called. These generative UI components enhance the user experience by:

-   **Visualizing tool execution** with loading states and progress indicators
-   **Displaying results** in rich, formatted layouts
-   **Enabling user interaction** through forms and controls
-   **Providing error feedback** with helpful recovery options

This guide demonstrates building tool UIs with the **Vercel AI SDK**.

For composing UI from a JSON spec and component allowlist (display-only layouts), see the [Generative UI primitive guide](https://www.assistant-ui.com/docs/tools/generative-ui).

## [Creating Tool UIs](#creating-tool-uis)

Tool UI is registered on toolkit entries. The same entry can define a browser-executed frontend tool, a human tool that completes through `addResult`, or a render-only backend tool whose schema and execution live on the server.

### [1\. Client-Defined Tools](#1-client-defined-tools)

If you're creating tools on the client side, register them in a toolkit with `Tools({ toolkit })`.

app/toolkit.tsx

```
"use generative";

import { defineToolkit } from "@assistant-ui/react";
import { z } from "zod";

export default defineToolkit({
  getWeather: {
    description: "Get current weather for a location",
    parameters: z.object({
      location: z.string(),
      unit: z.enum(["celsius", "fahrenheit"]),
    }),
    execute: async ({ location, unit }) => {
      "use client";
      return fetchWeatherAPI(location, unit);
    },
    render: ({ args, result, status }) => {
      if (status.type === "running") {
        return <div>Checking weather in {args.location}...</div>;
      }

      return (
        <div className="weather-card">
          <h3>{args.location}</h3>
          <p>
            {result.temperature}°{args.unit === "celsius" ? "C" : "F"}
          </p>
          <p>{result.description}</p>
        </div>
      );
    },
  },
});
```

app/MyRuntimeProvider.tsx

```
import { AssistantRuntimeProvider, Tools, useAui } from "@assistant-ui/react";
import { useChatRuntime } from "@assistant-ui/react-ai-sdk";
import toolkit from "./toolkit";

function MyRuntimeProvider({ children }: { children: React.ReactNode }) {
  const runtime = useChatRuntime();
  const aui = useAui({ tools: Tools({ toolkit }) });
  return (
    <AssistantRuntimeProvider aui={aui} runtime={runtime}>
      {children}
    </AssistantRuntimeProvider>
  );
}
```

`useChatRuntime()` targets `/api/chat` by default. To point at a different endpoint or customize requests, see [Custom transport](https://www.assistant-ui.com/docs/runtimes/ai-sdk/v7#custom-transport).

Frontend toolkit entries can be passed to your backend using the `frontendTools` utility.

Learn more about creating tools in the [Tools Guide](https://www.assistant-ui.com/docs/tools/defining-tools).

### [2\. UI-Only for Existing Tools](#2-ui-only-for-existing-tools)

If your tool is defined elsewhere (e.g., in your backend API, MCP server, or LangGraph), register a backend toolkit entry with just `render`:

```
const toolkit = defineToolkit({
  getWeather: {
    type: "backend",
    render: ({ args, result, status }) => {
      // UI rendering logic only
    },
  },
});
```

## [Quick Start Example](#quick-start-example)

This example shows how to implement the UI-only approach with a backend toolkit entry:

### [Create a Tool UI Renderer](#create-a-tool-ui-renderer)

```
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { z } from "zod";

type WeatherArgs = {
  location: string;
  unit: "celsius" | "fahrenheit";
};

type WeatherResult = {
  temperature: number;
  description: string;
  humidity: number;
  windSpeed: number;
};

const WeatherToolUI: ToolCallMessagePartComponent<
  WeatherArgs,
  WeatherResult
> = ({ args, status, result }) => {
  if (status.type === "running") {
    return (
      <div className="flex items-center gap-2">
        <Spinner />
        <span>Checking weather in {args.location}...</span>
      </div>
    );
  }

  if (status.type === "incomplete" && status.reason === "error") {
    return (
      <div className="text-red-500">
        Failed to get weather for {args.location}
      </div>
    );
  }

  return (
    <div className="weather-card rounded-lg bg-blue-50 p-4">
      <h3 className="text-lg font-bold">{args.location}</h3>
      <div className="mt-2 grid grid-cols-2 gap-4">
        <div>
          <p className="text-2xl">
            {result.temperature}°{args.unit === "celsius" ? "C" : "F"}
          </p>
          <p className="text-gray-600">{result.description}</p>
        </div>
        <div className="text-sm">
          <p>Humidity: {result.humidity}%</p>
          <p>Wind: {result.windSpeed} km/h</p>
        </div>
      </div>
    </div>
  );
};
```

### [Register the Tool UI](#register-the-tool-ui)

Put the renderer on the matching backend toolkit entry:

```
const toolkit = defineToolkit({
  getWeather: {
    type: "backend",
    render: WeatherToolUI,
  },
});

function App({ runtime }: { runtime: AssistantRuntime }) {
  const aui = useAui({ tools: Tools({ toolkit }) });

  return (
    <AssistantRuntimeProvider aui={aui} runtime={runtime}>
      <Thread />
    </AssistantRuntimeProvider>
  );
}
```

### [Define the Backend Tool (Vercel AI SDK)](#define-the-backend-tool-vercel-ai-sdk)

When using the Vercel AI SDK, define the corresponding tool in your API route:

/app/api/chat/route.ts

```
import { streamText, tool, zodSchema } from "ai";
import { z } from "zod";

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    model: openai("gpt-5.4-nano"),
    messages: await convertToModelMessages(messages),
    tools: {
      getWeather: tool({
        description: "Get current weather for a location",
        inputSchema: zodSchema(
          z.object({
            location: z.string(),
            unit: z.enum(["celsius", "fahrenheit"]),
          }),
        ),
        execute: async ({ location, unit }) => {
          const weather = await fetchWeatherAPI(location);
          return {
            temperature: weather.temp,
            description: weather.condition,
            humidity: weather.humidity,
            windSpeed: weather.wind,
          };
        },
      }),
    },
  });

  return result.toUIMessageStreamResponse();
}
```

## [Tool UI Patterns](#tool-ui-patterns)

### [Component Pattern](#component-pattern)

Create standalone tool UI components:

```
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";

export const WebSearchToolUI: ToolCallMessagePartComponent<
  { query: string },
  { results: SearchResult[] }
> = ({ args, status, result }) => {
  return (
    <div className="search-container">
      <div className="mb-3 flex items-center gap-2">
        <SearchIcon />
        <span>Search results for: "{args.query}"</span>
      </div>

      {status.type === "running" && <LoadingSpinner />}

      {result && (
        <div className="space-y-2">
          {result.results.map((item, index) => (
            <div key={index} className="rounded border p-3">
              <a href={item.url} className="font-medium text-blue-600">
                {item.title}
              </a>
              <p className="text-sm text-gray-600">{item.snippet}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
```

Register it on the toolkit:

```
const toolkit = defineToolkit({
  webSearch: {
    type: "backend",
    render: WebSearchToolUI,
  },
});
```

### [Dynamic Toolkit Pattern](#dynamic-toolkit-pattern)

Use a toolkit hook in its own file when the renderer needs component state:

analyze-data-toolkit.tsx

```
"use client";

import { defineToolkit, useInlineRender } from "@assistant-ui/react";
import { useMemo } from "react";

export function useAnalyzeDataToolkit(theme: "light" | "dark") {
  const renderAnalyzeData = useInlineRender(({ result, status }) => {
    return (
      <DataVisualization
        data={result}
        theme={theme}
        loading={status.type === "running"}
      />
    );
  });

  return useMemo(
    () =>
      defineToolkit({
        analyzeData: {
          type: "backend",
          render: renderAnalyzeData,
        },
      }),
    [renderAnalyzeData],
  );
}
```

DynamicToolUI.tsx

```
import { AuiProvider, Tools, useAui } from "@assistant-ui/react";
import { useState } from "react";
import { useAnalyzeDataToolkit } from "./analyze-data-toolkit";

function DynamicToolUI({ children }: { children: React.ReactNode }) {
  const [theme] = useState<"light" | "dark">("light");
  const toolkit = useAnalyzeDataToolkit(theme);

  const aui = useAui({
    tools: Tools({ toolkit }),
  });

  return <AuiProvider value={aui}>{children}</AuiProvider>;
}
```

### [Inline Pattern](#inline-pattern)

For tools that need access to parent component props:

**Why `useInlineRender`?** By default, a tool UI's `render` function is static. Use `useInlineRender` when your UI needs access to dynamic component props (for example, to pass in an `id` or other contextual data).

inventory-toolkit.tsx

```
"use client";

import { defineToolkit, useInlineRender } from "@assistant-ui/react";
import { useMemo } from "react";

export function useInventoryToolkit(productId: string, productName: string) {
  const renderInventory = useInlineRender(({ result }) => {
    return (
      <div className="inventory-status">
        <h4>{productName} Inventory</h4>
        <p>
          Stock for {productId}: {result.quantity} units
        </p>
        <p>Location: {result.warehouse}</p>
      </div>
    );
  });

  return useMemo(
    () =>
      defineToolkit({
        checkInventory: {
          type: "backend",
          render: renderInventory,
        },
      }),
    [renderInventory],
  );
}
```

ProductPage.tsx

```
import { AuiProvider, Tools, useAui } from "@assistant-ui/react";
import { useInventoryToolkit } from "./inventory-toolkit";

function ProductPage({ productId, productName }) {
  const toolkit = useInventoryToolkit(productId, productName);

  const aui = useAui({
    tools: Tools({ toolkit }),
  });

  return (
    <AuiProvider value={aui}>
      <div>Product details...</div>
    </AuiProvider>
  );
}
```

## [Interactive Tool UIs](#interactive-tool-uis)

### [User Input Collection](#user-input-collection)

Create tools that collect user input during execution:

**Pro tip:** Call `addResult(...)` exactly once to complete the tool call. After it's invoked, the assistant will resume the conversation with your provided data.

```
const toolkit = defineToolkit({
  selectDate: {
    type: "human",
    description: "Ask the user to select a date.",
    parameters: z.object({ prompt: z.string() }),
    render: ({ args, result, addResult }) => {
      if (result) {
        return (
          <div className="rounded bg-green-50 p-3">
            ✅ Selected date: {new Date(result.date).toLocaleDateString()}
          </div>
        );
      }

      return (
        <div className="rounded border p-4">
          <p className="mb-3">{args.prompt}</p>
          <DatePicker
            onChange={(date) => {
              addResult({ date: date.toISOString() });
            }}
          />
        </div>
      );
    },
  },
});
```

### [Multi-Step Interactions](#multi-step-interactions)

Build complex workflows with human-in-the-loop patterns for multi-step user interactions:

app/approval-toolkit.tsx

```
"use generative";

import { defineToolkit } from "@assistant-ui/react";
import { z } from "zod";

export default defineToolkit({
  requestApproval: {
    description: "Request user approval for an action",
    parameters: z.object({
      action: z.string(),
      details: z.any(),
    }),
    execute: async ({ action, details }, { human }) => {
      "use client";
      // Request approval from user
      const response = await human({ action, details });

      return {
        approved: response.approved,
        reason: response.reason,
      };
    },
    render: ({ args, result, interrupt, resume }) => {
      const [reason, setReason] = useState("");

      // Show result after approval/rejection
      if (result) {
        return (
          <div className={result.approved ? "text-green-600" : "text-red-600"}>
            {result.approved ? "✅ Approved" : `❌ Rejected: ${result.reason}`}
          </div>
        );
      }

      // Show approval UI when waiting for user input
      if (interrupt) {
        return (
          <div className="rounded border-2 border-yellow-400 p-4">
            <h4 className="font-bold">Approval Required</h4>
            <p className="my-2">{interrupt.payload.action}</p>
            <pre className="rounded bg-gray-100 p-2 text-sm">
              {JSON.stringify(interrupt.payload.details, null, 2)}
            </pre>

            <div className="mt-4 flex gap-2">
              <button
                onClick={() => resume({ approved: true })}
                className="rounded bg-green-500 px-4 py-2 text-white"
              >
                Approve
              </button>
              <button
                onClick={() => resume({ approved: false, reason })}
                className="rounded bg-red-500 px-4 py-2 text-white"
              >
                Reject
              </button>
              <input
                type="text"
                placeholder="Rejection reason..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="flex-1 rounded border px-2"
              />
            </div>
          </div>
        );
      }

      return <div>Processing...</div>;
    },
  },
});
```

Use tool human input (`human()` / `resume()`) for workflows that need to pause tool execution and wait for user input. Use `addResult()` for "human tools" where the AI requests a tool call but the entire execution happens through user interaction.

### [Server-side approval gates](#server-side-approval-gates)

Some runtimes (notably AI SDK v7's `toolApproval`\-gated tools) pause on the server and emit an approval request that the client must acknowledge before the tool runs. assistant-ui surfaces this on the tool part as `approval` and exposes `respondToApproval({ approved, reason? })` on the renderer:

```
const toolkit = defineToolkit({
  deploy: {
    type: "backend",
    render: ({ args, approval, respondToApproval, result }) => {
      if (approval?.approved === undefined) {
        return (
          <div>
            <p>Approve deploy to {args.target}?</p>
            <button onClick={() => respondToApproval({ approved: true })}>
              Approve
            </button>
            <button
              onClick={() =>
                respondToApproval({ approved: false, reason: "user denied" })
              }
            >
              Deny
            </button>
          </div>
        );
      }

      if (approval?.approved === false) {
        return <p>Denied{approval.reason ? `: ${approval.reason}` : ""}</p>;
      }

      if (result === undefined) return <p>Approved, running…</p>;
      return <p>Deployed</p>;
    },
  },
});
```

`approval.approved` is a three-state signal:

-   `undefined`: gate is open, the renderer should ask the user. This is the only state in which `respondToApproval` is legal.
-   `true`: decision recorded as allow. The server is producing the result (or has produced one, available on `result`).
-   `false`: decision recorded as deny. The runtime records an error result (`isError`) and exposes `approval.reason`.

`approval.isAutomatic` is `true` when the runtime granted the decision from a server-side policy rather than the user; render a "auto-approved" badge instead of buttons in that case.

Approval gates require a runtime that implements them: the AI SDK v7 runtime emits them for `toolApproval`\-gated tools, and `LocalRuntime` supports gates emitted by your `ChatModelAdapter`; see [LocalRuntime approval gates](https://www.assistant-ui.com/docs/runtimes/custom/local-runtime#approval-gates). For tools where the user supplies the result itself, use `unstable_humanToolNames` with `addResult` instead; see [human-in-the-loop tools](https://www.assistant-ui.com/docs/runtimes/custom/local-runtime#human-in-the-loop-tools).

For the wire-side setup (`needsApproval`, `sendAutomaticallyWhen`), see [AI SDK v7 server-side tool approval](https://www.assistant-ui.com/docs/runtimes/ai-sdk/v7#server-side-tool-approval).

### [Approval options](#approval-options)

Beyond the plain allow / deny pair, the host can attach a list of decision options to an approval, for example "allow once", "allow for this session", and "always allow". Each option carries a machine-readable `kind` (`"allow-once"`, `"allow-always"`, `"reject-once"`, `"reject-always"`); scope semantics like session versus global belong to the option's `id` and `label`, which only the host interprets:

```
const approval = {
  id: "a1",
  options: [
    { id: "once", kind: "allow-once" },
    { id: "session", kind: "allow-always", label: "Allow for this session" },
    {
      id: "always",
      kind: "allow-always",
      label: "Always allow",
      grants: ["git *"],
      confirm: true,
    },
    { id: "deny", kind: "reject-once" },
  ],
};
```

Renderers respond with the chosen option instead of a boolean; the option's kind resolves the decision:

```
respondToApproval({ optionId: "session" });
```

The runtime receives `{ approvalId, approved, optionId, reason? }`, so a host that persists "always allow" decisions can key its store off `optionId`. Persistence is entirely host-owned: assistant-ui never stores a decision and never auto-answers future approvals. `grants` lists the patterns an option would persist (shown to the user before they commit), and `confirm` opts the option into a confirmation step. Options with custom `_`\-prefixed kinds are skipped by the default `ToolFallback` bar and must be answered with an explicit `approved` value, optionally alongside the `optionId` so the chosen option is still recorded.

Approvals that end without a decision (a cancelled run or an expired request) are recorded by the host as `approval.resolution: "cancelled" | "expired"`, which closes the gate without recording a deny.

The default `ToolFallback` component renders supplied options automatically, including the confirmation step.

## [Advanced Features](#advanced-features)

### [Tool Status Handling](#tool-status-handling)

The `status` prop provides detailed execution state:

```
render: ({ status, args }) => {
  switch (status.type) {
    case "running":
      return <LoadingState />;

    case "requires-action":
      return <UserInputRequired reason={status.reason} />;

    case "incomplete":
      if (status.reason === "cancelled") {
        return <div>Operation cancelled</div>;
      }
      if (status.reason === "error") {
        return <ErrorDisplay error={status.error} />;
      }
      return <div>Failed: {status.reason}</div>;

    case "complete":
      return <SuccessDisplay />;
  }
};
```

### [Deferred Rendering](#deferred-rendering)

This section applies when the model **drives** the component through a tool call (args arrive incrementally and you want to wait for the final shape). If your backend or orchestrator pushes the component instead, prefer [Data-Part Generative UI](#data-part-generative-ui) with `makeAssistantDataUI`. Data parts arrive as terminal events, so the renderer only fires once with the final data, no deferred rendering needed.

Sometimes you want to capture a tool call's streaming arguments but only render the final UI once the call completes. This is useful when partial args would render misleading or jarring intermediate states (a chart that flashes through half-populated data), when the component is expensive to mount (heavy visualizations, embedded iframes, third-party widgets), or when the model controls _whether_ the component appears at all.

#### [Inline at the end of streaming](#inline-at-the-end-of-streaming)

Return `null` from the tool UI's `render` until `status.type === "complete"`. The streaming args still arrive in `args` as the model emits them, you just ignore them until the call is done:

```
const toolkit = defineToolkit({
  renderChart: {
    type: "backend",
    render: ({ args, status }) => {
      if (status.type !== "complete") return null;
      return <Chart title={args.title} data={args.series} />;
    },
  },
});
```

The chart mounts once, with the final args, after streaming finishes. No re-renders during the stream.

The same `render` shape works inside the [`Tools()`](https://www.assistant-ui.com/docs/tools/defining-tools) toolkit's `render` field and with `MessagePrimitive.Parts`'s inline `tools.by_name` overrides.

#### [Below the message body](#below-the-message-body)

If the component should sit _outside_ the message parts (for example, a card attached under the avatar block rather than inline with text), gate at the message level with [`AuiIf`](https://www.assistant-ui.com/docs/api-reference/primitives/assistant-if) and read `s.message.status`:

```
import { MessagePrimitive, AuiIf, useAuiState } from "@assistant-ui/react";

function PostMessageCard() {
  const parts = useAuiState((s) => s.message.parts);
  const chartCall = parts.find(
    (p) => p.type === "tool-call" && p.toolName === "renderChart",
  );
  if (!chartCall) return null;
  return <Chart {...chartCall.args} />;
}

<MessagePrimitive.Root>
  <MessagePrimitive.Parts />

  <AuiIf
    condition={(s) =>
      s.message.role === "assistant" &&
      s.message.status?.type === "complete"
    }
  >
    <PostMessageCard />
  </AuiIf>
</MessagePrimitive.Root>;
```

The `AuiIf` predicate fires whenever the assistant state changes; children mount only when both checks pass. `PostMessageCard` then reads the captured tool-call part from `s.message.parts` and renders from its args.

For the opposite pattern (showing partial data as it streams in), see [Field-Level Streaming State](#field-level-streaming-state) and [Partial Results & Streaming](#partial-results--streaming) below.

### [Field-Level Streaming State](#field-level-streaming-state)

Use `useToolArgsStatus` to react to per-field streaming state. The hook returns a `propStatus` map where each top-level key in the args object resolves from `"streaming"` to `"complete"` as the partial JSON arrives. Call it inside a tool-call message part context:

```
import { useToolArgsStatus } from "@assistant-ui/react";

const toolkit = defineToolkit({
  submitForm: {
    type: "backend",
    render: ({ args }) => {
      const { propStatus } = useToolArgsStatus<{
        email: string;
        phone: string;
      }>();

      return (
        <form className="space-y-4">
          <div>
            <input
              type="email"
              value={args.email ?? ""}
              className={propStatus.email === "streaming" ? "loading" : ""}
              disabled
            />
          </div>

          <div>
            <input
              type="tel"
              value={args.phone ?? ""}
              className={propStatus.phone === "streaming" ? "loading" : ""}
              disabled
            />
          </div>
        </form>
      );
    },
  },
});
```

### [Partial Results & Streaming](#partial-results--streaming)

Display results as they stream in:

```
const toolkit = defineToolkit({
  analyzeData: {
    type: "backend",
    render: ({ result, status }) => {
      const progress = result?.progress || 0;
      const insights = result?.insights || [];

      return (
        <div className="analysis-container">
          {status.type === "running" && (
            <div className="mb-4">
              <div className="mb-1 flex justify-between">
                <span>Analyzing...</span>
                <span>{progress}%</span>
              </div>
              <div className="w-full rounded bg-gray-200">
                <div
                  className="h-2 rounded bg-blue-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          <div className="space-y-2">
            {insights.map((insight, i) => (
              <div key={i} className="rounded bg-gray-50 p-2">
                {insight}
              </div>
            ))}
          </div>
        </div>
      );
    },
  },
});
```

### [Custom Tool Fallback](#custom-tool-fallback)

For tools that have no dedicated UI, add the `ToolFallback` shadcn component to your project. See the [ToolFallback install guide](https://www.assistant-ui.com/docs/ui/tool-fallback) for setup instructions and the [ToolGroup guide](https://www.assistant-ui.com/docs/ui/tool-group) for grouping consecutive tool calls into a collapsible container.

## [Execution Context](#execution-context)

Generative UI components have access to execution context through props:

```
type ToolCallMessagePartProps<TArgs, TResult> = {
  // Tool arguments
  args: TArgs;
  argsText: string; // JSON stringified args

  // Execution status
  status: ToolCallMessagePartStatus;
  isError?: boolean;

  // Tool result (may be partial during streaming)
  result?: TResult;

  // Tool metadata
  toolName: string;
  toolCallId: string;

  // Interactive callbacks
  addResult: (result: TResult | ToolResponse<TResult>) => void;
  resume: (payload: unknown) => void;

  // Interrupt state
  interrupt?: { type: "human"; payload: unknown }; // Payload from context.human()

  // Optional artifact data
  artifact?: unknown;
};
```

### [Human Input Handling](#human-input-handling)

When a tool calls `human()` during execution, the payload becomes available in the render function as `interrupt.payload`:

```
const toolkit = defineToolkit({
  confirmAction: {
    type: "backend",
    render: ({ args, result, interrupt, resume }) => {
      // Tool is waiting for user input
      if (interrupt) {
        return (
          <div className="confirmation-dialog">
            <p>Confirm: {interrupt.payload.message}</p>
            <button onClick={() => resume(true)}>Yes</button>
            <button onClick={() => resume(false)}>No</button>
          </div>
        );
      }

      // Tool completed
      if (result) {
        return <div>Action {result.confirmed ? "confirmed" : "cancelled"}</div>;
      }

      return <div>Processing...</div>;
    },
  },
});
```

Learn more about tool human input in the [Tools Guide](https://www.assistant-ui.com/docs/tools/defining-tools#human-tools).

## [Best Practices](#best-practices)

### [1\. Handle All Status States](#1-handle-all-status-states)

Always handle loading, error, and success states:

```
render: ({ status, result, args }) => {
  if (status.type === "running") return <Skeleton />;
  if (status.type === "incomplete") return <ErrorState />;
  if (!result) return null;
  return <ResultDisplay result={result} />;
};
```

### [2\. Provide Visual Feedback](#2-provide-visual-feedback)

Use animations and transitions for better UX:

```
<div
  className={cn(
    "transition-all duration-300",
    status.type === "running" && "opacity-50",
    status.type === "complete" && "opacity-100",
  )}
>
  {/* Tool UI content */}
</div>
```

### [3\. Make UIs Accessible](#3-make-uis-accessible)

Ensure keyboard navigation and screen reader support:

```
<button
  onClick={() => addResult(value)}
  aria-label="Confirm selection"
  className="focus:outline-none focus:ring-2"
>
  Confirm
</button>
```

### [4\. Optimize Performance](#4-optimize-performance)

Use `useInlineRender` to prevent unnecessary re-renders:

heavy-computation-toolkit.tsx

```
"use client";

import { defineToolkit, useInlineRender } from "@assistant-ui/react";
import { useMemo } from "react";

export function useHeavyComputationToolkit() {
  const renderHeavyComputation = useInlineRender(({ result }) => {
    return <ComplexVisualization data={result} />;
  });

  return useMemo(
    () =>
      defineToolkit({
        heavyComputation: {
          type: "backend",
          render: renderHeavyComputation,
        },
      }),
    [renderHeavyComputation],
  );
}
```

HeavyComputationToolProvider.tsx

```
import { AuiProvider, Tools, useAui } from "@assistant-ui/react";
import type { ReactNode } from "react";
import { useHeavyComputationToolkit } from "./heavy-computation-toolkit";

function HeavyComputationToolProvider({ children }: { children: ReactNode }) {
  const toolkit = useHeavyComputationToolkit();
  const aui = useAui({ tools: Tools({ toolkit }) });

  return <AuiProvider value={aui}>{children}</AuiProvider>;
}
```

Generative UI components are only displayed in the chat interface. The actual tool execution happens on the backend. This separation allows you to create rich, interactive experiences while keeping sensitive logic secure on the server.

## [Data-Part Generative UI](#data-part-generative-ui)

Alongside tool-call rendering, assistant-ui supports a second generative UI mechanism based on `DataMessagePart`. Instead of attaching UI to a tool invocation, the backend (or the LangGraph graph) emits named data events that are appended as `{ type: "data", name, data }` parts on the parent assistant message.

**When to choose which:**

-   **Tool UI**: the **model** decides what to render by calling a tool whose args become the component's data. Register the renderer via the [`Tools()`](https://www.assistant-ui.com/docs/tools/defining-tools) toolkit's `render` field. Args stream incrementally, so you observe partial state via `status` / `useToolArgsStatus` and may need [Deferred Rendering](#deferred-rendering) for components that should only mount with final data.
-   **Data UI** (`makeAssistantDataUI`): the **backend or orchestrator** decides what to render and pushes a named data event onto the assistant message. Data parts arrive as terminal events with no streaming partials, so the renderer naturally fires once with the final data.

If you want a component to appear only after the message is complete and you control the backend, Data UI is usually the more direct fit; reach for Tool UI's deferred pattern when the model itself must drive the choice.

Use `makeAssistantDataUI` to register a renderer for a named data part:

```
import { makeAssistantDataUI } from "@assistant-ui/react";

type ChartProps = { series: number[]; title: string };

export const ChartUI = makeAssistantDataUI<ChartProps>({
  name: "chart",
  render: ({ data }) => (
    <div>
      <h3>{data.title}</h3>
      <Chart series={data.series} />
    </div>
  ),
});
```

Mount `<ChartUI />` once inside the `AssistantRuntimeProvider` tree; it renders nothing itself and only registers the renderer.

For LangGraph-specific patterns (emitting UI from a Python/TypeScript graph node via `push_ui_message` / `typedUi`, dynamic loading with `LoadExternalComponent`, and the `useLangGraphUIMessages` escape hatch), see [LangGraph Generative UI](https://www.assistant-ui.com/docs/runtimes/langgraph/generative-ui).

A fallback renderer for unmatched data parts is available internally but `setFallbackDataUI` is not yet a public API.

## [Related Guides](#related-guides)

-   [Tools Guide](https://www.assistant-ui.com/docs/tools/defining-tools) - Learn how to create and use tools with AI models
-   [Multi-Agent](https://www.assistant-ui.com/docs/tools/multi-agent) - Render sub-agent conversations inside tool call UIs
-   [Tool Fallback](https://www.assistant-ui.com/docs/ui/tool-fallback) - Default UI for tools without custom components
-   [API Reference](https://www.assistant-ui.com/docs/api-reference/primitives/message-part) - Detailed type definitions and component APIs
-   [Message Primitive](https://www.assistant-ui.com/docs/api-reference/primitives/message) - Complete Message component documentation
