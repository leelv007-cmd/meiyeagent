# Agent Runtime: AI SDK First, Mastra Deferred

Status: accepted (2026-07-07, supersedes the "P0 adopts Mastra" decision in 合集 04 §5 / 08 §2 and 03-agent-runtime-source-review)

2026-07-08 update: ADR-0008 adds finished video generation to P0. The AI SDK + thin step-runner decision still stands; the video pipeline becomes the first heavy workflow through the Runtime Port and the first real test of the Mastra re-entry trigger.

The plan itself stated the principle "do not bind to a complex agent framework from day one" (01 §7) and then bound one (04 §5). Auditing P0's actual AI workload after ADR-0008: deterministic content pipelines, one genuine tool-calling workbench surface, the video pipeline (storyboard → first frame → clips → eval pick-best → compose), an eval loop, and fully custom audit/ledger/compliance logic. Durability was already assigned to Postgres durable_jobs, so the framework was never carrying the hard part. Peer evidence: CreatOK ships with zero agent-framework traces (custom REST wizard state machines + polling).

**Decision**

- **Vercel AI SDK** powers all P0 AI surfaces: copilot chat (`streamText` + zod tools; may run in the Workers shell, eliminating the SSE pass-through risk) and pipeline LLM steps (`generateObject` for structured content cards). Provider registry handles mixed foreign/domestic routing (ADR-0005), optionally through CF AI Gateway.
- **Pipelines** = durable_jobs + a thin self-built step-runner (~300-500 lines to start: ordered steps, per-step schema, retry/resume state in the jobs table). The P0 video pipeline additionally borrows the `ad_video_gen` patterns recorded in ADR-0008: session-state blackboard, human-language progress hook, and N→1 candidate eval.
- **Evals** = promptfoo wired into CI over the beauty-vertical sample sets.
- **Runtime Port rule is law**: business code depends only on the `ContentWorkflowRunner` interface; the AI SDK appears only inside the runner implementation and tool wrappers (which also write tool_calls audit + usage reserve/commit/refund).
- **Mastra is deferred, not rejected**: re-entry trigger = real pipeline complexity (multi-branch flows, sub-workflows, human-in-the-loop matrices). Swapping means reimplementing the runner behind the Port — days, not weeks. The 08-chapter Mastra analysis is retained as the implementation baseline for that day.

**Consequences**

We own ~400 lines of step-runner and assemble three small tools (AI SDK + promptfoo + Langfuse-or-similar) instead of adopting one framework's upgrade cadence; we lose Mastra Studio (compensated by Langfuse playground or an internal page). The old v5-stable/v6-beta wording records the decision-time snapshot only; implementation version pinning follows the repository lockfile (currently `ai` 7.x) without changing the Runtime Port decision.
