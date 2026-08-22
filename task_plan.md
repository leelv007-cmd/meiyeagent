# Agent Workflow Full Remediation Plan

## Goal

Complete every repair task in `docs/reviews/agent-workflow-full-project-review-remediation-2026-08-19.md`, preserving its Hard-gate DAG and proving completion requirement-by-requirement.

## Current Phase

Wave 0 dispatch preparation — in progress.

## Global Hard Gates

1. Evidence/runtime barrier: DEV-01/02 and CI-01A/CI-02 before new browser/database completion claims.
2. Trust barrier: FE-01, DEL-01, FREE-01, PLAN-01A, BILL-01 before downstream architecture or release work.
3. Destructive retirement gate: no Wave 4 deletion without same-SHA PG/DBOS/browser plus production data/in-flight/audit/rollback proof.
4. Release gate: no staging/production work until the current journey catalog is green and no P0 release blocker remains.

## Phases

### Phase 0 — Recovery and dispatch

- [x] Read repository instructions and active goal.
- [x] Load planning/TDD/codebase-design skills.
- [x] Read dispatch runbook, CONTEXT, relevant ADRs, and Web instructions.
- [ ] Create isolated Wave 0/1 worktrees.
- [ ] Dispatch independent Agent lanes with test seams and red-first acceptance.

### Phase 1 — Wave 0 evidence/runtime

- [x] WF-00 authority correction/erratum integrated and verified on main.
- [x] DEV-01/02 implementation and reviewer follow-ups assembled in the isolated Wave 0 integration branch; final reviewer verdict and same-SHA calibration pending.
- [x] CI-01A/CI-02 code integrated and contract-tested; argv security fix + real advisory calibration pending.
- [ ] Main-agent cross-review and integrate Wave 0.
- [ ] Combine approved DEV + CI follow-ups in `agent/wave0-integration`, resolve overlap, and run real advisory calibration.

### Phase 2 — Wave 1 trust boundaries

- [x] FE-01 implemented and reviewer-approved; pending Wave 1 integration/browser verification.
- [x] DEL-01 implemented and reviewer-approved; pending Wave 1 integration/PG/browser verification.
- [x] FREE-01 implemented and reviewer-approved; pending Wave 1 integration/browser verification.
- [x] PLAN-01A implemented and reviewer-approved; pending Wave 1 integration.
- [x] BILL-01 implemented and reviewer-approved; pending Wave 1 integration/PG/browser/live-pay boundary.
- [x] ADM-01 implemented and reviewer-approved; pending Wave 1 integration.
- [x] Approved FE/PLAN/ADM/FREE/BILL/DEL commits pre-assembled without conflicts in isolated `agent/wave1-integration`; focused 384 Core/contracts + 111 Web node + 54 interaction tests and independent typechecks pass.
- [x] Close and independently approve Wave 1 combination blockers: explicit Thread/handoff identity, free Session + authority stale fence, frozen settlement authority + forward migrations, one-shot consume/cache, Admin retired allowance/unknown evidence, and cataloged Playwright contracts.
- [ ] Main-agent cross-review, focused PG/browser verification, and integrate after the Wave 0 evidence gate.

### Phase 3 — Wave 2 merchant journeys

- [ ] SUBMIT-01A/B, TIMEOUT-01.
- [ ] STORE-01, MEM-01/02.
- [ ] WORK-01, LINK-01, ART-01.
- [ ] UX sub-tickets and CREDIT-01A/B.
- [ ] JOURNEY-01 current product-contract browser matrix.

### Phase 4 — Wave 3 architecture

- [ ] ARCH-01 typed P1 operation registry.
- [ ] ARCH-02 one client projection.
- [ ] ARCH-03/03B deep repositories and narrow Model Supply ports.
- [ ] ARCH-04/05/06 assembly, background, and write ownership.
- [ ] ARCH-SESSION-01 and HREL-01.
- [ ] ARCH-07 locality sub-tickets.

### Phase 5 — Wave 4 retirement

- [ ] Prove destructive retirement hard gates.
- [ ] RET-01/02 Pro Studio model_canvas runtime candidates.
- [ ] RET-03 billing legacy shrink.
- [ ] RET-04 dead entry/facade sub-tickets.
- [ ] RET-05 archive automatic publisher.
- [ ] RET-06 only after U14 gates.

### Phase 6 — Wave 5 release evidence

- [ ] CI-01B promote calibrated persistence gate.
- [ ] CI-03 merge/advisory split.
- [ ] REL-01 immutable artifacts and staging deploy.
- [ ] PROVIDER-01, PAY-01A/B, NET-01.
- [ ] REL-03 release-required and exact artifact promotion.

### Phase 7 — Completion audit

- [ ] Trace every R-P0/R-P1 finding to integrated code and current evidence.
- [ ] Run complete current-SHA static/unit/interaction/PG/DBOS/browser gates.
- [ ] Verify provider/payment/deployment claims at their required tier.
- [ ] Confirm no required ticket, invariant, or deliverable remains.
- [ ] Mark active goal complete only after the audit proves all requirements.

## Test Seams Confirmed by the User-Approved Report

- Dev runtime seam: `pnpm dev` lifecycle + Web/Core health.
- Thread seam: AgentEventStore public dispatch/state/subscribe plus real auth/thread browser transitions.
- Handoff seam: Workstream prepare token through canonical handoff route/receipt.
- Free grounding seam: Harness workflow with `creationMode=free + ExecutionPlanSnapshot`.
- Plan seam: compiled plan admitted/executed through the public executor contract.
- Commerce seam: published plan → readiness → provider call/webhook → credit projection.
- CI seam: fresh isolated business/DBOS pair with per-file pass/fail/skip evidence.

## Decisions

- Every Agent lane uses an isolated git worktree; no GitHub writes.
- Agents may commit locally on their lane branch; main agent cross-reviews and integrates.
- Red tests must observe public behavior, not source strings.
- The untracked review report is preserved as user-owned scope authority.
- No task is considered complete from fixture/static evidence when the report requires PG/DBOS/browser/live proof.

## Errors Encountered

| Error | Attempt | Resolution |
|---|---:|---|
| Admin worktree install command ran in main checkout because `workdir` remained main after `git worktree add` | 1 | Main ignored `node_modules` was refreshed to the frozen lock; no secrets were printed. Re-run install with the explicit admin worktree as tool `workdir`, then verify tracked status. |
| Direct Web TSX test could not resolve generated `@/locale` modules | 1 | Support behavior test still produced the intended red. Run `pnpm locale:compile` in the admin worktree before rerunning the panel test. |
| ADM-01 Web typecheck found a removed shared type still used by the trial panel, an unused chart type, and missing generated content collections | 1 | Replace the trial query with its minimal inline shape, remove the unused chart type, then run Web build before typecheck as required by `run-root-typecheck.sh`. |
| ADM-01 targeted Biome check found one multiline Recharts import formatting difference | 1 | Apply the exact local import formatting only; locale check and diff check already pass. |
| ADM-01 Web typecheck found a legacy `AccountUsageProjection` test fixture after the public projection changed | 1 | Preserve the still-authoritative active plan tier, remove only retired `usage`, update the fixture, and add a paid-tier no-usage behavior test. |
| ADM support transaction UI imported credit labels from the Frame module and failed before the red assertion | 1 | Move the labels to the Paraglide import, apply the local Biome shape, then rerun the same behavior test. |
| CI persistence instrument still passed PostgreSQL admin/business/DBOS URLs through process argv | 1 | Stop before calibration; make both provision layers consume URLs from env, add argv-safety behavior tests, then rerun review. |
| Wave 0 integration HEAD changed after a real 96-suite persistence calibration had started | 1 | Interrupt at 49/96 because its receipt was no longer same-SHA evidence; clean only the two uniquely named temporary databases, keep the run invalid, and restart from the final reviewed immutable HEAD. |
| First exact temporary-database cleanup wrapper had an over-escaped inline JavaScript regex | 1 | No cleanup process started and no database changed; remove the unnecessary regex-based stderr rewrite, keep the env-only PostgreSQL transport, and rerun against the same two validated names. |
| Second cleanup wrapper used a JSON double-quoted value where PostgreSQL required a SQL string literal | 1 | The first statement failed closed with exit 3 before DROP; names are regex-validated, so use single-quoted SQL literals for the datname predicate and rerun both idempotent DROP operations. |
| DEV directory-lock follow-up passed 30-contender pressure but left a crashed `.takeover` fence able to spin forever and could not migrate legacy file locks | 1 | Keep Wave 0 blocked; add takeover ownership/deadline backoff and a fenced legacy-file migration behavior test without restoring pathname read-then-rm. |
| Persistence activity diagnostic imported the removed async PostgreSQL helper after DEV intentionally replaced it with the production sync seam | 1 | Diagnostic failed before connecting and changed no state; inspect the current exported sync API, then query pg_stat_activity through that production seam without exposing the URL. |
| Final same-SHA persistence calibration hung indefinitely at file 50/96 in `production-media-assembly.postgres.test.ts` | 1 | After >8 minutes, captured PENDING DBOS + bounded-question/no bounded-decision evidence and idle event-loop sample, interrupted the exact process tree, preserved the 49-file failed-run evidence/DB pair for diagnosis, and opened a TDD lane for a real workflow fix plus per-file timeout fail-red behavior. |
| Combined FE/FREE conflict check invoked a Vitest interaction file through Node `tsx --test` | 1 | The plain Node selector tests passed, but Vitest correctly rejected the wrong runner; rerun the interaction file with `pnpm exec vitest run` and keep the conflict resolution unchanged unless the real interaction fails. |
| Bounded second persistence calibration executed all 96 files but evidence rejected 3 Issue-255 skips and one Admin role PG failure | 1 | Preserve the exact fresh pair for diagnosis; do not allowlist skips. Split fixes: run the destructive Issue-255 suite on its own locked fixed-name disposable pair, and repair Admin test cleanup without weakening immutable audit/FK or last-admin rules. |
| Wave 0 integration control gate rejected V31-67 Evidence SHA after cherry-picking Issue-255 commits | 1 | Source-branch 3/3 evidence SHA is not an ancestor of the integration branch. Re-run the special suite on the actual integrated code SHA, then append a documentation-only commit that references that now-ancestor evidence; do not rewrite the ticket gate or substitute a patch-id. |
| Root typecheck session closed after the final journey command before terminal polling returned an exit code | 1 | Build/core/Web stages emitted no error, but do not infer success from a closed session; rerun the final journeys/Web TypeScript checks directly and record their explicit exit status. |
| First attempt to read the in-app browser skill used an extra `sites/` path component | 1 | No browser action occurred; resolve the published r3 path directly and read the complete control-in-app-browser skill before opening or operating the in-app session. |
