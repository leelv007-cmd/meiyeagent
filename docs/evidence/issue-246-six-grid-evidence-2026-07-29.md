# Issue 246 Six-Grid Evidence

Status: working evidence for local `issue/246@3d4a6529`, based on
`main@194a742a`. This document is deliberately not a closeout claim. A cell is
`OPEN` when the current runtime evidence does not prove it.

## Verification runs

| Scope | Result |
| --- | --- |
| Changed non-PostgreSQL Core behavior tests | 255 pass, 0 fail, 0 skip |
| Post-ruling NotePlan warn consumer and workflow trace tests | 56 pass, 0 fail, 0 skip |
| Skill schema registry focused tests | 4 pass, 0 fail, 0 skip |
| Changed PostgreSQL Harness, Model Supply, and Skill suites | 27 pass, 0 fail, 0 skip |
| DBOS five-stage frozen-lineage smoke after `3d4a6529` | 1 pass, 0 fail, 0 skip |
| Core typecheck | exit 0 |
| Contracts typecheck | exit 0 |
| `git diff --check` | exit 0 |
| Core full suite with business and DBOS PostgreSQL | 2393 pass, 22 fail, 10 skip, exit 1 |
| Detached `cd3895db` full Core suite with fresh empty business and separate DBOS PostgreSQL | 2390 pass, 21 fail, 10 skip, exit 1 |
| Detached pure `main@194a742a` affected PostgreSQL specs | 9 pass, 21 fail, 0 skip, exit 1 |

The 22-failure full run is not reported as green. One #246-owned failure was
the DBOS prompt-lineage assertion and is fixed by `3d4a6529`. The remaining
21 failures reproduce on pure `main@194a742a` against a fresh empty database:
9 failures lack the Better Auth `session`/`user` bootstrap and 12 existing
store-intake price fixtures omit the required validity. The representative
spec and first-error list is consolidated in #244. Those failures remain
outside this ticket and still block a full-green claim.

## Six-grid matrix

Legend: `PASS` is backed by a behavior or persistence assertion. `PARTIAL`
means the named layer exists but the next layer is not proved. `OPEN` is a
closeout blocker.

| Capability | Defined | Registered | Bound | Exposed/reachable | Invoked | Persisted/traced | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Versioned Skill input/output schemas | `skill-schema-registry.ts` exports strict schemas and versioned refs | `SKILL_SCHEMA_REFS` is the closed snapshot | `validateManifest()` resolves both refs | `SkillFoundationModule.skill_define` reaches manifest admission | Real Foundation command behavior rejects an unknown ref | Accepted revision persistence is covered by the Skill PostgreSQL suite | PASS |
| Whole Skill input validation | `SkillService.invoke.input` is independent from child calls | Manifest input ref resolves through the registry | `parseSkillSchema()` runs before the first `executor.execute()` | Service API exists; no production caller outside tests was found | Negative test proves invalid input and zero executor calls | PostgreSQL negative test proves zero child effects and receipts | PARTIAL: production reachability is unproved |
| Skill output validation | `RegistrySkillOutputValidator` parses the frozen output ref | Default validator is registry-backed | `SkillService.invoke()` validates `output.value` before receipt persistence | Service API exists; no production caller outside tests was found | Negative service test rejects invalid output | PostgreSQL query proves zero child effects and receipts | PARTIAL: production reachability and generation-order proof are under review |
| `planner_selected` retirement | Active enum excludes the legacy value | Read-side `AuditedSkillBinding` retains the legacy discriminator | memory and PostgreSQL repositories retire matching active rows | Production `resolveStageSkills()` reads only active non-legacy bindings | Behavior test constructs the legacy binding and resolves the real stage | PostgreSQL test proves `superseded`, timestamp present, original mode retained | PASS |
| `check` block/warn/detect primitive | `CHECK_STRATEGIES` and typed result states | Exported through the Harness module source | `checkHarnessRedlines()` hard-binds seven gates to `block`; NotePlan binds five-dimensional consistency to `warn` | `UnifiedHarnessStagePorts.executeNoteAndSelect()` reaches the production NotePlan consumer; detect is explicitly assigned to #248 M2 | A conflict records `warned`, awaits rewrite/regeneration through `onViolation`, reevaluates, and allows an honest partial result when still incomplete | The resulting `note_consistency_evaluated` signal enters the workflow execution-selection trace | PASS for the #246-owned block/warn contract; detect consumer is assigned to #248 M2 by ruling |
| Transformation audit | Existing NotePlan rewrite emits `note_page_regenerated` in selection audit signals | #248 owns the required `trigger: user_selection \| check_violation` contract, which is not present on current main | Selection trace currently carries the canonical signal | Production NotePlan rewrite is reachable | Real rewrite behavior is covered | Selection trace contains the signal, but the owner contract cannot yet be referenced | BLOCKED: wait for #248 to land the `trigger` contract; #246 must not define a second event schema |
| Fourteen Langfuse prompt positions | `HARNESS_LANGFUSE_PROMPT_NAMES` has the closed 14-key inventory | Startup resolver requires a complete pin map | request admission freezes all prompt values and revision refs | API and worker construct the resolver before startup | Changed consumer tests execute mapper, structured nodes, NotePlan, Model Supply, and Canvas paths | Harness snapshots, stage traces, Model Supply route prompt references, and fallback audits persist lineage | PASS locally; live Langfuse call remains OPEN |
| Strict/pilot prompt policy | `LANGFUSE_PROMPT_POLICY` accepts only `strict` or `pilot` | Default is strict; no `APP_ENV` expansion | API and worker startup call the same resolver | Both production entry points are covered | Missing strict configuration fails startup; explicit pilot falls back | Pilot fallback is an explicit frozen fact and warning | PASS |
| Prompt replay freeze | Request snapshot stores prompt revision refs | All 14 refs are normalized and compared | workflow replay rejects version/hash drift | DBOS workflow reads frozen refs | Workflow and DBOS smoke execute replay | Decision trace and DBOS step output retain prompt lineage | PASS |
| Langfuse fallback audit | `langfuse_prompt_fallback` uses the existing Harness audit event shape | Admission owns the fallback audit port | `PostgresHarnessStore` is injected in production | Real task admission path invokes it | Fixture fallback admission is executed | PostgreSQL `audit_events` and outbox rows are asserted without prompt content | PASS |
| Prompt-bound Model Supply execution | Prompt binding/reference contracts contain name, version, hash, label, source, and fallback fact | Fixed operation-to-prompt mapping rejects unknown/drifted bindings | `prepareSubmission()` freezes before provider work; Canvas prepares before enqueue | Foundation, direct Model Supply, Canvas, note exact-text, and mapper paths are production wired | Behavior tests execute each path and resolver failure stops provider I/O | RouteSnapshot/read model retains the prompt reference, not prompt content | PASS |
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
4. The current Core full-suite baseline is not green on `main@194a742a`; the
   exact counts above remain part of the closeout boundary.
