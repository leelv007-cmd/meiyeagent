# Issue 246 Six-Grid Evidence

Status: working evidence for local committed `issue/246@e2836679`, rebased on
`main@c62fa6aa`. This document is deliberately not a closeout claim. A cell is
`OPEN` when the current runtime evidence does not prove it.

## Verification runs

| Scope | Result |
| --- | --- |
| Changed non-PostgreSQL Core behavior tests | 255 pass, 0 fail, 0 skip |
| Post-ruling NotePlan warn consumer and workflow trace tests | 56 pass, 0 fail, 0 skip |
| Current Skill service/tool behavior tests | 27 pass, 0 fail, 0 skip |
| Current prompt fallback/replay/production-loop focused behavior tests | 87 pass, 0 fail, 0 skip |
| Skill schema registry focused tests | 4 pass, 0 fail, 0 skip |
| Changed PostgreSQL Harness, Model Supply, and Skill suites | 27 pass, 0 fail, 0 skip |
| Current isolated PostgreSQL Skill/fallback/frozen-restart/outbox-ops gates | 9 pass, 0 fail, 0 skip |
| #266 upstream locale synchronization assertions after rebase | 10 pass, 0 fail, 0 skip |
| DBOS five-stage frozen-lineage smoke after `8a512b4a` | 1 pass, 0 fail, 0 skip |
| Core typecheck | exit 0 |
| Contracts typecheck | exit 0 |
| `git diff --check` | exit 0 |
| Historical pre-rebase Core full suite with business and DBOS PostgreSQL | 2393 pass, 22 fail, 10 skip, exit 1 |
| Detached `cd3895db` full Core suite with fresh empty business and separate DBOS PostgreSQL | 2390 pass, 21 fail, 10 skip, exit 1 |
| Detached pure `main@194a742a` affected PostgreSQL specs | 9 pass, 21 fail, 0 skip, exit 1 |

The historical 22-failure full run is not reported as green. One #246-owned
failure was the DBOS prompt-lineage assertion and is fixed by `8a512b4a`. The
remaining 21 reproduced on pure
`main@194a742a`: 9 lacked Better Auth `session`/`user` bootstrap and 12
store-intake price fixtures omitted required validity. Those failures were
consolidated in #244; newer main contains the #244 validity fixes, so the old
counts are retained only as historical evidence and are not a current
full-suite result. A fresh final full run remains required before closeout.

## Six-grid matrix

Legend: `PASS` is backed by a behavior or persistence assertion. `PARTIAL`
means the named layer exists but the next layer is not proved. `OPEN` is a
closeout blocker.

| Capability | Defined | Registered | Bound | Exposed/reachable | Invoked | Persisted/traced | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Versioned Skill input/output schemas | `skill-schema-registry.ts` exports strict schemas and versioned refs | `SKILL_SCHEMA_REFS` is the closed snapshot | `validateManifest()` resolves both refs | `SkillFoundationModule.skill_define` reaches manifest admission | Real Foundation command behavior rejects an unknown ref | Accepted revision persistence is covered by the Skill PostgreSQL suite | PASS |
| Whole Skill input validation | `SkillInvocationRequest.input` is independent from child calls and the output descriptor | Manifest input ref resolves through the registry | `parseSkillSchema()` runs before receipt replay lookup, child executor, and generator | Durable Skill runtime exposes `createInvocationTool()`; no non-test production consumer creates it | Negative tests prove invalid input, zero executor/generator calls, and zero receipt reads | PostgreSQL negative behavior is covered through the real runtime tool factory | PARTIAL: contract and exposed adapter pass; production consumer remains OPEN |
| Skill output validation | `RegistrySkillOutputValidator` parses the frozen output ref; caller-supplied `output.value` no longer exists | Default validator is registry-backed | Only `SkillInvocationExecutor.generate()` produces the actual value; validation runs after generation and before `publishOnce()`/receipt | Tool adapter returns a stable `SKILL_OUTPUT_INVALID` object; no non-test production consumer creates it | Negative service/tool tests execute child effect + generator, reject the actual invalid value, and publish zero business results | PostgreSQL proves provider audit=1, business publisher=0, invocation receipt=0; retry test proves `publishOnce` canonical output and receipt do not fork | PARTIAL: actual-output order and persistence boundary pass; production consumer remains OPEN |
| `planner_selected` retirement | Active enum excludes the legacy value | Read-side `AuditedSkillBinding` retains the legacy discriminator | memory and PostgreSQL repositories retire matching active rows | Production `resolveStageSkills()` reads only active non-legacy bindings | Behavior test constructs the legacy binding and resolves the real stage | PostgreSQL test proves `superseded`, timestamp present, original mode retained | PASS |
| `check` block/warn/detect primitive | `CHECK_STRATEGIES` and typed result states | Exported through the Harness module source | `checkHarnessRedlines()` hard-binds seven gates to `block`; NotePlan binds five-dimensional consistency to `warn` | `UnifiedHarnessStagePorts.executeNoteAndSelect()` reaches the production NotePlan consumer; detect is explicitly assigned to #248 M2 | A conflict records `warned`, awaits rewrite/regeneration through `onViolation`, reevaluates, and allows an honest partial result when still incomplete | The resulting `note_consistency_evaluated` signal enters the workflow execution-selection trace | PASS for the #246-owned block/warn contract; detect consumer is assigned to #248 M2 by ruling |
| Transformation audit | Existing NotePlan rewrite emits `note_page_regenerated` in selection audit signals | #248 owns the required `trigger: user_selection \| check_violation` contract, which is not present on current main | Selection trace currently carries the canonical signal | Production NotePlan rewrite is reachable | Real rewrite behavior is covered | Selection trace contains the signal, but the owner contract cannot yet be referenced | BLOCKED: wait for #248 to land the `trigger` contract; #246 must not define a second event schema |
| Fourteen Langfuse prompt positions | `HARNESS_LANGFUSE_PROMPT_NAMES` has the closed 14-key inventory | Local push dry-run has 14 entries; remote Langfuse registration is unproved | request admission freezes all prompt values and revision refs | API and worker construct the resolver before startup | Fixture/provider behavior executes all consumers, but most Harness stages lack per-call Langfuse trace evidence | Request snapshots and frozen comparisons persist all refs; only existing stage traces/direct route references cover subsets | PARTIAL: defined/bound and fixture consumption pass; remote registration, per-call trace, and live invocation remain OPEN |
| Strict/pilot prompt policy | `LANGFUSE_PROMPT_POLICY` accepts only `strict` or `pilot` | Default is strict; no `APP_ENV` expansion | API and worker startup call the same resolver | Both production entry points are covered | Missing strict configuration fails startup; explicit pilot falls back | Pilot fallback is an explicit frozen fact and warning | PASS |
| Prompt replay freeze | Request snapshot stores prompt revision refs | All 14 refs are normalized and compared | workflow replay rejects version/hash drift | DBOS workflow reads frozen refs | Workflow and DBOS smoke execute replay | Decision trace and DBOS step output retain prompt lineage | PASS |
| Langfuse fallback audit | `langfuse_prompt_fallback` reuses the existing Harness audit event shape | Admission/direct/Canvas/mapper share a content-free prompt-reference port | API, legacy runtime, worker, and mapper inject `PostgresHarnessStore`; API owns one unconditional non-overlapping outbox loop | Real admission, direct Model Supply, Canvas preparation, and destination mapping reach the port before provider work | Behavior tests execute each fallback path; a local HTTP 503 drives all 14 pilot fallbacks through the real resolver and admission path before workflow start | Isolated PostgreSQL proves 14 audit/outbox rows are committed before start and content-free; this is local outage evidence, not remote/live Langfuse proof | PASS for local fallback persistence; remote delivery and live tracing remain OPEN |
| Langfuse outbox recovery operations | Existing replay/discard methods enforce `dead_letter` as the only source state | The production CLI dispatches only `replay` or `discard` to those methods | Runtime-scoped audit IDs preserve workspace isolation | `pnpm langfuse:outbox:ops` reaches the production store methods | Isolated PostgreSQL executes dead-letter replay, discard, invalid-state rejection, and logical-ID rejection | Replay resets attempts/error/timing to a claimable queued row; discard is terminal; a second workspace remains untouched | PASS |
| Prompt-bound Model Supply execution | Prompt binding/reference contracts contain name, version, hash, label, source, and fallback fact | Fixed operation-to-prompt mapping rejects unknown/drifted bindings | `prepareSubmission()` freezes before provider work; Canvas prepares before enqueue | Foundation, direct Model Supply, Canvas, note exact-text, and mapper paths are production wired | Behavior tests execute each path; resolver failure stops provider I/O and provider retry reuses one binding | RouteSnapshot/Canvas outbox retain the prompt reference; mapper fallback is audited, but non-fallback mapper lineage and most stage call traces are not persisted | PARTIAL: frozen provider execution passes; complete per-invocation tracing remains OPEN |
| Production-wiring negative library | Five named failure modes are a closed test inventory | Test suite snapshots the exact five names | Each negative uses the real registry/service/module seam | Foundation entry is used for the positive command behavior | All five negative behaviors execute | Persistence is asserted where the scenario owns persistence | PASS |
| Failure-semantics inventory | Review document lists current and target semantics | Delivery artifact is committed under `docs/reviews` | N/A: inventory only | Review artifact is readable | Current code paths were inspected | N/A: remediation is explicitly outside #246 | PASS as inventory |
| Six-primitive vocabulary map | Review document maps existing enums to six primitives | Delivery artifact is committed under `docs/reviews` | N/A: mapping only | Review artifact is readable | Current enums were inspected | N/A: spec update is a downstream action | PASS as mapping |

## Commands

Focused non-PostgreSQL changed tests:

```bash
pnpm --filter @meiye/contracts exec tsx --test \
  src/skill-schema-registry.test.ts

task_tests=( ${(f)"$(git diff --name-only 194a742a..HEAD |
  rg '^apps/core/src/.*\.test\.ts$' |
  rg -v '(\.postgres\.test|dbos-registration\.smoke\.test)' |
  sed 's#^apps/core/##')"} )
pnpm --filter @meiye/core exec tsx --test $task_tests
```

PostgreSQL changed suites, with `TEST_DATABASE_URL` supplied from the local
isolated test database without printing credentials:

```bash
pnpm --filter @meiye/core exec tsx --test \
  src/p1/harness/postgres-store.postgres.test.ts \
  src/p1/model-supply/postgres-repository.test.ts \
  src/p1/skills/postgres-repository.postgres.test.ts

pnpm --filter @meiye/core exec tsx --test --test-concurrency=1 \
  --test-name-pattern='prompt fallback audit reaches PostgreSQL|detached prompt audit reaches PostgreSQL|local Langfuse HTTP 503 persists pilot fallbacks before Harness workflow start' \
  src/p1/harness/postgres-store.postgres.test.ts

pnpm --filter @meiye/core exec tsx --test --test-concurrency=1 \
  src/p1/harness/langfuse-outbox-ops.postgres.test.ts
```

Static compilation:

```bash
pnpm --filter @meiye/core typecheck
pnpm --filter @meiye/contracts typecheck
git diff --check
```

## External and upstream gates

1. The main branch contains #248 M1's strict four observability axes, and the
   latest controller ruling freezes provenance and occurrence semantics.
   However, #248 has not yet landed its owner-only
   `note_page_regenerated.trigger` contract, so #246 cannot finish the
   transformation discriminator without inventing a second schema.
2. The production `warn` consumer is now the NotePlan five-dimensional
   consistency path. The latest ruling assigns the first `detect` consumer to
   #248 M2, so #246 does not duplicate it.
3. Independent live Langfuse acceptance cannot run without the base URL,
   public key, secret key, and all prompt version pins. Offline/fixture evidence
   is not live provider evidence.
4. The production Skill runtime exposes an invocation-tool factory, but current
   `main.ts`, `server.ts`, and `job-worker.ts` do not create it and the
   repository has no established production executor/business-result port to
   bind safely. Tests do not substitute for this missing production consumer.
5. The previous full-suite run was not green on `main@194a742a`. Current main
   contains the #244 fixes for one reproduced class, so those historical counts
   are not reused as a current verdict; a fresh final full run remains part of
   the closeout boundary.
