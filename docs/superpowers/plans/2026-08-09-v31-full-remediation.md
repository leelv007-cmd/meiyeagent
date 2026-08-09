# V3.1 Full Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use TDD red-green cycles task-by-task. Each task runs in an isolated git worktree and returns one English Conventional Commit for merge-controller review.

**Goal:** Close every actionable gap in the current-head V3.1 deep review, restore one production truth chain, and make ticket acceptance reproducible through PostgreSQL and real Playwright journeys.

**Architecture:** Consolidate invariants behind five deep modules: workspace-owned confirmation transaction, durable execution truth chain, exact HarnessRelease resolver, canonical semantic projection, and real-trace evaluation. Web journeys consume those interfaces; no UI/API fallback may invent a second truth. V31-26b remains pilot-gated only where the ticket explicitly requires external merchant evidence.

**Tech Stack:** TypeScript, Zod, PostgreSQL, DBOS, TanStack Start/React, Node test runner, Vitest, Playwright, GitHub Actions.

## Global Constraints

- Node 22+, pnpm 10.30.3, strict TypeScript, Biome.
- One agent per isolated worktree; never run locale compile, typecheck, interaction tests, or E2E beside a dev stack in the same worktree.
- Product facts and billing truth live in Core; Web never supplies authoritative rights, pricing, signals, usage, release, or refund facts.
- Credits use the P1 GrantLot/ProductUsageLedger writer and workspace credit transaction; no `plan.allowances.*`, upstream cost, token, or USD exposure.
- No second Agent runtime; DBOS, Task, ContentPackage, AgentThread/Run and HarnessRelease remain the truth chain.
- No anonymous XHS scraping, no Creem live path, no Pro Studio/Canvas resurrection.
- Every slice must show RED before GREEN and verify through the public seam used in production.

---

### Task 1: Workspace-owned atomic confirmation command

**Files:**
- Modify: `apps/core/src/p1/agent-session/execution-confirmation-service.ts`
- Modify: `apps/core/src/p1/agent-session/postgres-execution-confirmation-store.ts`
- Modify: `apps/core/src/server.ts`
- Modify: `mkfast-template-main/src/routes/api/core/p1/confirmation-requests/$requestId/decide.ts`
- Test: `apps/core/src/p1/agent-session/execution-confirmation-service.test.ts`
- Test: `apps/core/src/p1/agent-session/postgres-execution-confirmation.postgres.test.ts`
- Test: `apps/core/src/p1/agent-session/execution-confirmation-http.test.ts`

**Interfaces:**
- Consumes: authenticated `workspaceId`, `requestId`, actor and immutable decision.
- Produces: one `decideForWorkspace()` / `expireForWorkspace()` command whose request status, decision and credit refund recover atomically.

- [ ] Write a foreign-workspace HTTP test: create request in `workspace-b`, call decide/expire through `workspace-a`, expect 404/403 and unchanged request/ledger.
- [ ] Run the focused HTTP test and record RED.
- [ ] Add workspaceId to command inputs and load requests through the workspace-owned store seam.
- [ ] Write crash-point tests after decision append and after status transition; replay must finish refund exactly once and must not report refunded before ledger evidence exists.
- [ ] Run the crash tests and record RED.
- [ ] Move decision, status and refund into one workspace transaction or durable completion protocol with explicit pending effect state.
- [ ] Add expiry ownership (DBOS/sweeper seam) and verify hold timeout refunds exactly once.
- [ ] Run unit + fresh PostgreSQL tests and commit `fix(confirmation): enforce workspace-owned atomic decisions`.

### Task 2: Unified paid confirmation and durable snapshot chain

**Files:**
- Modify: `apps/core/src/p1/harness/task-admission.ts`
- Modify: `apps/core/src/p1/harness/paid-generation-confirmation.ts`
- Modify: `apps/core/src/p1/harness/execution-plan-admission.ts`
- Modify: `apps/core/src/p1/execution-spine/submission-coordinator.ts`
- Modify: `apps/core/src/p1/agent-session/composer-plan-session.ts`
- Modify: `mkfast-template-main/src/product/composer/use-composer-interactions.ts`
- Test: `apps/core/src/p1/harness/confirmation-gate-merge.test.ts`
- Test: `apps/core/src/p1/harness/execution-plan-admission.test.ts`
- Test: `apps/core/src/p1/agent-session/composer-plan-session.test.ts`
- Test: `mkfast-template-main/src/product/composer/use-composer-interactions.interaction.test.tsx`

**Interfaces:**
- Consumes: finalized plan, durable compile freeze, exact quote/rights/release facts.
- Produces: reserve → pending request → immutable decision → snapshot admission → Make, with one requestId and no paid fallback.

- [ ] Add a production-shaped paid test that begins without an executionPlanSnapshot and expects a pending request before merchant approval; confirm existing code is RED.
- [ ] Define one deterministic confirmation requestId helper shared by interaction and domain flow.
- [ ] Persist `ExecutionPlanCompileFreeze` with the submission and restore it in `recoverPendingStarts`.
- [ ] Assemble merchant-confirmed snapshot only after the immutable decisionRef exists, then admit once and start Make.
- [ ] Remove Web interaction-only resume when domain decide fails; surface a retryable error and leave execution suspended.
- [ ] Add second-paid-Work Campaign coverage carrying `campaignPlanRef/workOrdinal/approvalScope`.
- [ ] Add crash recovery test from persisted freeze and duplicate decision/submit tests.
- [ ] Run focused Core/Web tests and commit `fix(harness): unify paid confirmation snapshot admission`.

### Task 3: Real live-facts fence and typed interrupt product loop

**Files:**
- Modify: `apps/core/src/assembly/api-runtime.ts`
- Modify: `apps/core/src/p1/harness/context-fence.ts`
- Modify: `apps/core/src/p1/harness/production-stage-ports.ts`
- Modify: `apps/core/src/p1/harness/dbos-workflow.ts`
- Modify: `apps/core/src/p1/harness/interrupt-protocol.ts`
- Modify/Create: Web typed interrupt client and workbench surface under `mkfast-template-main/src/product/agent-workbench/`
- Test: `apps/core/src/p1/harness/production-context-port.test.ts`
- Test: `apps/core/src/p1/harness/interrupt-protocol.test.ts`
- Test: `mkfast-template-main/tests/e2e/specs/v31-context-fence-journey.spec.ts`
- Test: `mkfast-template-main/tests/e2e/specs/v31-interrupt-resume-journey.spec.ts`

**Interfaces:**
- Consumes: real fact/rights heads and typed interrupt resource routes.
- Produces: resumable pause for material drift, safe stop for revoked rights, and refresh-safe Web resume by interruptId+revision.

- [ ] Write adapter tests where rights head reports revoked and where referenced price/date revision changes; expect safe_stop/pause_prompt.
- [ ] Replace frozen-as-current/revoked:false with authoritative repository adapters and fail closed when heads cannot be resolved.
- [ ] Replace terminal pause error with DBOS `awaitDecision` typed interrupt and exact resume bridge.
- [ ] Project `interrupt.requested/resolved` into the real AgentThread semantic stream.
- [ ] Add Web list/resume client and render pending interrupts on dashboard/mobile.
- [ ] Rewrite E/H journeys to inject real drift, assert the same interruptId/revision before and after refresh, resume unconditionally, and reject duplicate/expired/schema-mismatched resume.
- [ ] Run Core tests + focused Playwright and commit `fix(interrupts): close live-facts resume loop`.

### Task 4: Concurrency-safe memory and revision-exact outcome evidence

**Files:**
- Modify: `apps/core/src/p1/agent-session/context-retrieval.ts`
- Modify: `apps/core/src/p1/agent-session/turn-runner.ts`
- Modify: `apps/core/src/p1/operations/agent-memory-platform.ts`
- Modify: `apps/core/src/p1/operations/content-package-delivery.ts`
- Modify: `packages/contracts/src/content-package.ts`
- Test: memory and outcome tests in the same modules
- Test/Create: `mkfast-template-main/tests/e2e/specs/v31-memory-injection-journey.spec.ts`

**Interfaces:**
- Consumes: per-turn explicit memory binding and package expectedRevision.
- Produces: request-local receipts and signals permanently bound to exact package revision.

- [ ] Write two interleaved workspace turn tests; each receipt must retain its own task/run/release.
- [ ] Remove module-global current binding; use explicit context propagation or AsyncLocalStorage isolated per turn.
- [ ] Write concurrent same-expectedRevision outcome test; exactly one writer succeeds.
- [ ] Recheck revision inside workspace lock and store `contentPackageRevision` on every signal/correction/withdraw row.
- [ ] Build a versioned retrieval dataset with relevance labels, baseline and threshold instead of the one-line arithmetic sample.
- [ ] Add B2 Playwright: visible source → revoke → next task no longer injects it.
- [ ] Run focused tests and commit `fix(memory): isolate turns and bind outcome revisions`.

### Task 5: Canonical Artifact semantic stream

**Files:**
- Modify: `packages/contracts/src/agent-domain.ts`
- Modify: `apps/core/src/p1/harness/artifact-progress-emitter.ts`
- Modify: `apps/core/src/p1/harness/workflow-core.ts`
- Modify: `mkfast-template-main/src/product/agent-workbench/agent-event-reducer.ts`
- Test: artifact emitter/SSE/reducer tests
- Create: `mkfast-template-main/tests/e2e/specs/v31-artifact-growth-journey.spec.ts`

**Interfaces:**
- Consumes: branded threadId/runId/taskId and artifact stage output.
- Produces: snapshot/delta/ready/derived events on the real Thread with recoverable revisions.

- [ ] Write a production-shaped test with distinct threadId and planId; assert event threadId equals AgentThread.
- [ ] Carry branded Thread identity through snapshot/executor input; never derive it from planId.
- [ ] Add canonical snapshot producer used for cold start and skipped-revision resync.
- [ ] Emit terminal ready and derived artifact revisions without overwriting completed content.
- [ ] Fix replay hydration so malformed patch preserves `needsSnapshotResync` and does not force connection live.
- [ ] Add Composer→SSE→Workbench E2E proving skeleton→copy→image/video growth, refresh resync and version history.
- [ ] Commit `fix(artifacts): project canonical thread snapshots`.

### Task 6: Exact selective HarnessRelease and real rollout selection

**Files:**
- Modify: `apps/core/src/p1/harness/prompt-packs.ts`
- Modify: `apps/core/src/p1/harness/harness-release.ts`
- Modify: `apps/core/src/p1/harness/task-admission.ts`
- Modify: `apps/core/src/p1/ops-console/state-stores.ts`
- Modify: `apps/core/src/p1/ops-console/ops-console-service.ts`
- Modify: `apps/core/src/assembly/core-assembly.ts`
- Test: prompt/release/ops/PostgreSQL tests

**Interfaces:**
- Consumes: task carrier, immutable manifest, workspace candidate/canary configuration.
- Produces: exact release selection and exact task-specific prompt pins; missing pin/release fails closed.

- [ ] Add empty-pack production publish rejection and pure-copy selective resolution tests; record RED.
- [ ] Replace empty automatic production bootstrap with explicit complete seed manifest/migration.
- [ ] Resolve only prompt keys required by the task packs and frozen release.
- [ ] Remove unknown frozen release fallback to current production.
- [ ] Add candidate trial exact lookup by workspace and consume it before canary/production selection.
- [ ] Make lifecycle promote/rollback atomic in PostgreSQL with a lock.
- [ ] Add tests for candidate workspace, non-candidate production, canary allowlist, rollback new run and frozen in-flight run.
- [ ] Commit `fix(release): enforce exact selective rollout pins`.

### Task 7: Real Session Intent, Plan authority and executable commit strip

**Files:**
- Modify: `apps/core/src/p1/agent-session/service.ts`
- Modify: `apps/core/src/p1/agent-session/ambiguity-policy.ts`
- Modify: `apps/core/src/p1/agent-session/policy-middleware.ts`
- Modify: `apps/core/src/p1/agent-session/progressive-level.ts`
- Modify: `apps/core/src/p1/agent-session/plan-compiler-production-ports.ts`
- Modify: `apps/core/src/p1/agent-session/plan-compiler.ts`
- Modify: Composer plan/session/Web plan action files
- Test: Session/Intent/Progressive/Plan tests and Day-0/Living Plan E2E

**Interfaces:**
- Consumes: server-owned lens, paid units, known fields, risk/rights/quote/recipe/skill authorities.
- Produces: Intent → at most one question → adjustable Plan → explicit start Make.

- [ ] Write a Composer seam test proving `runTurn` is invoked before PlanCompiler/Make.
- [ ] Bind middleware by policyId+revision+kind and fail closed on absent/mismatched binding.
- [ ] Supply knownFields/high-risk authorities from real projection; classify levels from structured lens/paid units, not regex default.
- [ ] Replace synthetic quote/fact/rights/recipe/skill values with existing authority adapters; unauthorized rights makes readiness blocked.
- [ ] Make Plan revision and semantic event atomic through outbox/repair seam.
- [ ] Bind commit-strip revise/start actions; do not complete AgentRun or start Make before explicit start/valid exemption.
- [ ] Rewrite Day-0/Living Plan tests around the real sequence and remove optional assertions.
- [ ] Commit `fix(agent): connect intent plan and make authority`.

### Task 8: Server-owned steering, publish recovery, proactive and partial settlement

**Files:**
- Modify: steering foundation/service/Web panel files
- Modify: publish handoff hook/Core query files
- Modify: proactive foundation/service/store files
- Modify: ProductUsageLedger settlement adapters
- Test: steering/publish/proactive tests and G/K Playwright

**Interfaces:**
- Consumes: server-projected task units/signals/candidate/evidence and latest package revision.
- Produces: authoritative impact/billing, real replan→requote→confirmation, recoverable next-day handoff and one accepted proactive turn.

- [ ] Reject client-supplied authoritative steering units/signals and return Core impact/billing projection.
- [ ] Connect derived_revision and plan_change to real revision/requote/confirmation consumers.
- [ ] Connect partial delivery settlement to the sole credit ledger writer.
- [ ] Persist publish completedAt, load it after refresh, and submit self-report against server-returned latest revision.
- [ ] Reproject proactive candidates on accept, enforce kill switch, and atomically create exactly one turn+decision.
- [ ] Rewrite G/K Playwright through real UI and final product/ledger state.
- [ ] Commit `fix(agent): make steering and followup authoritative`.

### Task 9: Six-primitive executor, shadow stop and safe legacy archive gate

**Files:**
- Modify: `apps/core/src/p1/harness/compiled-carrier-executor.ts`
- Modify: `apps/core/src/p1/harness/workflow-core.ts`
- Modify: carrier recipes/primitive handlers/equivalence tests
- Modify: shadow reconciliation modules
- Modify: legacy replay inventory/archive gate modules
- Test: runner/shadow/legacy PostgreSQL tests

**Interfaces:**
- Consumes: `CompiledExecutionPlan.units` and real legacy inventory.
- Produces: one primitive executor with durable idempotency, independent shadow comparison, and fail-closed archive readiness.

- [ ] Write a test that mutates a plan unit and observes changed execution; current direct old-program call must fail it.
- [ ] Execute `read_context/ask_merchant/generate/check/revise/record` typed units through one executor.
- [ ] Generate pre-convergence baselines from a real fixed commit using a checked-in script and verify negative mutation.
- [ ] Test kill/restart with durable effect store, not key-array equality.
- [ ] Give shadow old/new independent inputs, stop sampling once closed, and fix mismatch-window exclusivity.
- [ ] Filter/count legacy in SQL without LIMIT masking; null observation must fail closed unless explicit audited no-history proof exists.
- [ ] Keep 26b externally blocked until real pilot evidence; do not fabricate it.
- [ ] Commit `fix(harness): execute primitives and harden retirement gates`.

### Task 10: Required CI, truthful Playwright and completion evidence

**Files:**
- Modify: `.github/workflows/core-quality.yml`
- Modify/Create: `scripts/ci/run-v31-browser-acceptance.sh`
- Modify: `scripts/ci/run-root-required-quality.sh`
- Modify: V31 Playwright specs and `TEST-CATALOG.md`
- Modify: `docs/tickets/v3.1/*.md`
- Create: final V3.1 remediation evidence report

**Interfaces:**
- Consumes: merged production capabilities from Tasks 1-9.
- Produces: required CI gates and ticket evidence tied to one SHA.

- [ ] Add Web Biome `pnpm --filter @meiye/web check` to required quality and make current errors green without unrelated reformatting.
- [ ] Add dedicated `v31-browser-acceptance` required job with isolated Postgres/DBOS and explicit A-K specs; always upload artifacts.
- [ ] Remove release-manifest dependency propagation from ordinary browser gate; keep release-candidate full E2E separate.
- [ ] Rewrite every weak/conditional/API-only assertion to produce and observe the real product state.
- [ ] Capture V31-05 baseline numbers and A16 Idle/Active/Delivered screenshots.
- [ ] Run contracts/core/web/PG/typecheck/Biome/full V31 Playwright sequentially.
- [ ] Update each ticket checkbox only when its evidence row contains writer, consumer, failure/recovery test, PG result, Playwright result and CI job.
- [ ] Commit `test(v31): require truthful full-batch acceptance`.

## Merge and final verification

- [ ] Cherry-pick in dependency order: 1 → 2 → 3; 4/5; 6 → 7; 8; 9; 10.
- [ ] Resolve conflicts by preserving the later task's interface and rerunning both owners' tests.
- [ ] Run `pnpm typecheck`, contracts/core full tests with fresh business+DBOS databases, Web static/interaction tests, Web Biome, and full V31 Playwright sequentially.
- [ ] Re-run the deep review against the merged HEAD; no report item may remain actionable except explicitly external V31-26b pilot evidence.
