# V31-14 / §37.4-E context-fence plan-diff + reconfirm closeout (2026-08-11)

## Status

| Item | Result |
| --- | --- |
| Root cause | **Fixed** (two product gaps) |
| `v31-context-fence-journey` | **1/1 PASS** Chromium ~36.8s (e2e-lock) |
| Tip (pre-commit) | post-`148932765` WIP on `codex/v31-integration` |
| `wave4_ready_to_stamp` | still **false** (broader gates remain) |

## Failures (pre-fix)

### A. `agent-plan-diff` never appeared after price drift + first accept

Live fence refresh (`PlanCompiler.refreshLiveBindings`) appended a durable plan
revision but did **not** project `plan.revised`. Living Plan history stayed at
one revision, so `agent-plan-diff` stayed empty even though the reconfirm
interrupt advanced.

### B. Fresh reconfirm accept left `/是否按当前方案开始生成/` at count 1

After (A) was fixed, the journey reached leg 4: reload preserved interrupt id/
revision, accept clicked, interrupt never retired for 180s.

Screenshot residual: Composer still showed the reconfirm card
「方案已变化：factRevisionRefs, contextDrifted」plus typed interrupt strip.

## Root causes

1. **plan.revised missing on live refresh**  
   `refreshLiveBindings` wrote the successor revision without
   `semanticEvents.project(plan.revised)`. UI had no from/to revision pair.

2. **material-head baselining not re-resolvable**  
   First admit after price drift rewrites live fact heads to synthetic ids:
   - `brief:<id>@<rev>:material-head:<16-hex>`
   - `identity:<id>@<rev>:identity-head:<version>`  
   Reconfirm freezes those live ids into the refreshed snapshot.  
   Second admit ran the original brief/identity regexes, which **mis-parsed**
   the suffix (revision group swallowed `:material-head:…`), dropped the head,
   and permanently set `contextDrifted` → infinite reconfirm loop (new interrupt
   with the same text, count stays 1).

## Fix

### plan.revised on live refresh

- `RefreshPlanLiveBindingsInput.workspaceId` optional tenant resource.
- `PlanCompiler.emitLiveRefreshPlanSemanticEvent` projects `plan.revised`
  (readiness `stale`, merchant summary 重新确认) after append and on
  idempotent re-entry / race match.
- `paid-generation-confirmation` passes `workspaceId: request.workspaceId`.

### material-head / identity-head re-resolve

- `execution-plan-live-facts` identity/brief regexes accept optional baselined
  suffixes and re-check live material/version against the baselined head.
- Matching head → no drift (reconfirm can admit).
- New head → another reconfirm (not same-head infinite loop).
- Unit coverage for baselined stay-current, re-drift, and identity-head.

## Evidence

| Gate | Ports / DBs | Result |
| --- | --- | --- |
| Unit: `plan-compiler.test.ts` (incl. plan.revised emit) | n/a | **PASS** (with suite) |
| Unit: `execution-plan-live-facts.test.ts` (+3 baselined cases) | n/a | **21/21 + suite 36/36 PASS** |
| E2E `v31-context-fence-journey.spec.ts` | PORT=3337 CORE=4337, `meiye_cf_0811_060744` | **1/1 PASS ~36.8s / 1.4m wall** |

Logs: `/tmp/meiye-cf-fix-0811/pw.log`, `cf-meta.txt`.

## Partial-resume (not closed this leg)

`v31-partial-resume-assisted-journey` still red at mid-flight interrupt filter
`/价格|事实|变化/` (line ~151). Same batch also hit host
`PostgresError: too many clients already` (env; orphan `meiye_*` DBs). Treat as
**infra-contaminated residual**, not proof the mid-flight fence path is fixed.
Re-run only on a drained PG host after CF product is on tip.

## Not closed by this leg

- Full `run-v31-browser-acceptance.sh`
- partial-resume mid-flight interrupt surface
- V31-26b external
- Stamp remains blocked until broader residual matrix is green

## Hard rules observed

- No push
- No kill of host :3001 (DBOS admin bind warning only)
- Isolated ports/DBs under e2e-lock
- Real UI journey (not mock-only)
