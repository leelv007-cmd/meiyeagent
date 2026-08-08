# V31-28 Composer Plan Surface Integration Implementation Plan

> **For agentic workers:** Execute inline in this worktree. Do not commit or push; V31-28 explicitly reserves those actions for the merge controller.

**Goal:** Connect Composer submissions to authoritative Agent Thread/Run planning, authenticated replay/SSE delivery, browser Thread binding, and cross-Thread projection isolation.

**Architecture:** A small Core submission-planning coordinator owns the idempotent Thread/Run boundary and calls the already assembled Session Harness PlanCompiler. The existing semantic projector remains the sole semantic-event writer; a workspace-authenticated HTTP replay route and SSE route expose its durable stream, while the existing AgentWorkbenchHost consumes those transports and applies events through `applyLiveSemanticEvent`.

**Tech Stack:** TypeScript, Node HTTP/SSE, PostgreSQL, TanStack Start/React, Zod, Vitest/Node test runner, Playwright.

## Global Constraints

- Preserve Living Plan components and the plan reducer projection logic.
- Never synthesize `plan.created` or `plan.revised` in Web.
- Authenticate semantic replay by active Web session and Core workspace identity; a guessed Thread id must not cross workspace boundaries.
- Merchant responses and UI must not expose upstream token, balance, USD, or provider-cost facts (D-061).
- Use only `TEST_DATABASE_URL=postgres://meiye:meiye@127.0.0.1:54329/meiye_lane28i` for writes.
- Run E2E only for the three V31-28 acceptance specs, with `PORT=3063` and `PLAYWRIGHT_CORE_PORT=4163`.
- Do not run Web/Core typecheck or tests concurrently with the dev stack.
- Keep `composer-home.tsx` edits local to Thread binding and production transport injection.

---

### Task 1: Composer Thread/Run and Plan Producer

**Files:**
- Create: `apps/core/src/p1/agent-session/composer-plan-session.ts`
- Test: `apps/core/src/p1/agent-session/composer-plan-session.test.ts`
- Modify: `apps/core/src/p1/execution-spine/creation-execution-snapshot.ts`
- Modify: `apps/core/src/p1/execution-spine/submission-coordinator.ts`
- Modify: `apps/core/src/assembly/api-runtime.ts`

**Interfaces:**
- Consumes: `AgentSessionStore`, `AgentSessionHarnessService.compilePlan/adjustPlan`, `CreationSubmissionRecord`.
- Produces: `ComposerAgentBinding { threadId: string; runId: string }` and response fields `threadId` / `runId`.

- [ ] Add a failing unit test proving first submission creates one Thread/Run and one `plan.created`, idempotent retry reuses both, and a later submission carrying that Thread appends `plan.revised`.
- [ ] Extend the browser request with an optional Thread continuation coordinate; strip it before frozen execution-snapshot parsing.
- [ ] Implement deterministic Thread/Run ids, workspace-scoped Thread validation, terminal run completion, and proposal mapping from the frozen submission.
- [ ] Invoke the coordinator at the Composer submission boundary and return its authoritative ids.
- [ ] Register the coordinator with the production PostgreSQL session store and Session Harness/PlanCompiler assembly.
- [ ] Run the focused Core unit test and PostgreSQL seam test.

### Task 2: Authenticated Replay and Live SSE

**Files:**
- Create: `apps/core/src/p1/agent-semantic-events/semantic-live-hub.ts`
- Test: `apps/core/src/p1/agent-semantic-events/semantic-live-hub.test.ts`
- Modify: `apps/core/src/p1/agent-semantic-events/semantic-event-projector.ts`
- Modify: `apps/core/src/p1/agent-semantic-events/snapshot-replay.ts`
- Modify: `apps/core/src/p1/agent-semantic-events/index.ts`
- Modify: `apps/core/src/server.ts`
- Modify: `apps/core/src/route-table.ts`
- Modify: `apps/core/src/route-table.test.ts`
- Modify: `apps/core/src/assembly/api-runtime.ts`

**Interfaces:**
- Consumes: `AgentSemanticEventProjector.loadReplay/streamReplay`, `AgentSessionStore`, workspace identity.
- Produces: `GET .../p1/agent-threads/:threadId/replay` JSON and `GET .../events` SSE (`agent.semantic`, `agent.ephemeral`, `agent.state`).

- [ ] Add failing tests for backlog-plus-live delivery, cursor continuation, duplicate safety, and abort cleanup.
- [ ] Implement an in-process live fan-out hub and make projector `streamReplay` subscribe before backlog read to close the query/subscribe race.
- [ ] Make cold replay return reconstructable durable events, not cursor-only metadata.
- [ ] Add Core replay/SSE routes that resolve the Thread through the request workspace before returning any payload.
- [ ] Register both route auth classes and the production projector/hub/session-store consumers.
- [ ] Add route-level tests proving valid workspace access and cross-workspace Thread denial.

### Task 3: Browser Transport, Host Subscription, and Thread Binding

**Files:**
- Create: `mkfast-template-main/src/product/agent-workbench/agent-event-transport.ts`
- Test: `mkfast-template-main/src/product/agent-workbench/agent-event-transport.test.ts`
- Create: `mkfast-template-main/src/routes/api/core/p1/agent-threads/$threadId/replay.ts`
- Create: `mkfast-template-main/src/routes/api/core/p1/agent-threads/$threadId/events.ts`
- Modify: `mkfast-template-main/src/lib/core-request.ts`
- Modify: `mkfast-template-main/src/lib/core-client.ts`
- Modify: `mkfast-template-main/src/product/agent-workbench/agent-workbench.tsx`
- Modify: `mkfast-template-main/src/product/composer/composer-submission-client.ts`
- Modify: `mkfast-template-main/src/product/composer/use-composer-run.ts`
- Modify: `mkfast-template-main/src/product/composer/composer-home.tsx`

**Interfaces:**
- Consumes: authoritative submission ids and authenticated same-origin replay/SSE endpoints.
- Produces: `AgentReplayLoader`, `AgentLiveSubscriber`, and same-Thread continuation on subsequent Composer submissions.

- [ ] Add failing transport tests for replay parsing, SSE frame parsing, lastEventId/lastStreamOffset propagation, and abort.
- [ ] Add authenticated BFF routes that forward only through the existing workspace Core proxy.
- [ ] Implement replay fetch and streaming fetch subscriber; only `agent.semantic` enters `applyLiveSemanticEvent`.
- [ ] Start/cancel the live subscription with Host session changes and reconnect from the replay snapshot cursors.
- [ ] On submission success, store returned Thread/Run locally, pass the Thread into Host, and send it with the next submission.
- [ ] Keep `composer-home.tsx` changes limited to local binding state, callback, and transport props.

### Task 4: Cross-Thread Reducer Isolation

**Files:**
- Modify: `mkfast-template-main/src/product/agent-workbench/agent-event-reducer.ts`
- Modify: `mkfast-template-main/src/product/agent-workbench/agent-event-reducer.test.ts`

**Interfaces:**
- Consumes: `set_session` actions.
- Produces: atomic clearing of `plans`, `activePlanId`, and `pendingInterrupts` when the Thread changes or the host returns to Idle.

- [ ] Add failing tests for Thread A to Thread B and Thread to Idle transitions.
- [ ] Implement the minimal conditional reset while preserving same-Thread session refresh behavior.
- [ ] Run focused reducer and Host tests.

### Task 5: Acceptance Verification

**Files:**
- Modify only as required by the real journey: the three V31-28 Playwright specs.

- [ ] Remove remaining V31-28 `fixme` markers and remove temporary diagnosis logging; restore cleanup unless a demonstrated acceptance-path requirement says otherwise.
- [ ] Run focused Core/Web tests with the implementation PostgreSQL database.
- [ ] Run Core and Web `tsc --noEmit` separately from the dev stack; require zero errors.
- [ ] Start the fixed-port dev stack, then run only the three named Playwright files and record exact results.
- [ ] Inspect the final diff for unrelated changes, generated-route edits, secrets, D-061 leakage, and missing production consumers.
