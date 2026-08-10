# V3.1 Wave-4 residual reds reverify report（2026-08-11）

> Integration worktree: `/Users/bin/Desktop/开发/内容无人区/美业内容2-v31-integration`  
> Branch: `codex/v31-integration`  
> **Browser/unit residual reverify HEAD**: `1955a278e14a543f6ec2d464bf51b2405a1060d2`  
> **Post-reverify tip (this continue lane)**: includes e2e + rights safe-stop commits after residual Chromium matrix.
>
> | SHA | Scope |
> |---|---|
> | `935ba1fa8` | Living Plan `/revise` body drain (`readP1Envelope`) |
> | `271adf397` | Living Plan delivery after `/start` (confirm skip + prepared-attempt revision bind) |
> | `f217c2c92` | B2 / V31-18 revoke vault status = `revoked` |
> | `1955a278e` | Hold-expiry credit refund projects 积分已退回 |
> | `806f4485b` | Artifact/rights e2e: drop re-confirm interrupt after decide→start |
> | `6aad118e2` | Rights post-confirm safe-stop surfaces 授权已撤销 merchant copy |
> | `451f1b2f7`+ | Rights credit assert: available rises by reserved after refund |
>
> Safety: **no push**; **did not kill :3001**; e2e-lock used; isolated ports; short clean DB names.  
> Evidence root: `/tmp/v31-residual-reverify/`

**`wave4_ready_to_stamp = false`**

Reason: the four actionable residual product reds that blocked stamp after resume closeout are **green on this tip**, but stamp still requires broader gates (full `run-v31-browser-acceptance.sh`, V31-28 pending-interrupt / plan-diff surfaces, rights revocation browser, Day-0 / Goal / context-fence, V31-26b external, V31-59 ordinary settlement residual). This report closes the **residual-fix matrix**, not full Wave-4 stamp.

---

## 1. Residual-fix commits under reverify

| Residual | Commit | Root cause (as landed) | Reverify verdict |
|---|---|---|---|
| Living Plan `/revise` hang | `935ba1fa8` | `submitPlanCommand` only checked `response.ok` and never drained body; Playwright `response.text()` waited on EOF | **GREEN** living-plan case 1 |
| Living Plan missing delivery card | `271adf397` | re-suspend paid confirm after decide→start already confirmed; ContentPackage fail-closed on prepared attempt ids | **GREEN** living-plan case 2 |
| B2 revoke still `confirmed` | `f217c2c92` | `listMemoryEntriesPage` ignored preference head `recordState=revoked` after promotion | **GREEN** B2 Chromium (clean stack) |
| Hold-expiry UI stuck 处理中 | `1955a278e` | credit-era `refundedQuantity=0` blocked 处理中→已退回; cancellation could re-persist 处理中 after sweeper refund | **GREEN** interrupt-expiry case |

---

## 2. Gates matrix @ `1955a278e`

| Gate | Result | Evidence |
|---|---|---|
| `@meiye/core` typecheck | **PASS** | `/tmp/v31-residual-reverify/core-typecheck.log` |
| `@meiye/web` typecheck | **PASS** | `/tmp/v31-residual-reverify/web-typecheck.log` |
| `@meiye/contracts` typecheck | **PASS** | `/tmp/v31-residual-reverify/contracts-typecheck.log` |
| Delivery unit (confirm gate + revision port) | **15/15 PASS** | `core-delivery-unit.log` |
| Memory unit (`reuse-memory-service` + foundation) | **18/18 PASS** | `core-memory-unit.log` |
| Contracts reuse-memory | **11/11 PASS** | `contracts-memory-unit.log` |
| Web revise interaction | **9/9 PASS** | `web-revise-interaction.log` |
| Expiry/harness unit (`action-usage` / events / dbos-workflow) | **66/66 PASS** | `core-expiry-unit.log` |
| Focused PG+unit (sweeper / billing-compensation / harness) | **82/82 PASS** | `core-focused-pg.log`；DBs `meiye_rv_0811_031709_41354` / `meiye_rv_d_0811_031709_41354` |
| Chromium Living Plan journey (both cases) | **2/2 PASS** | `pw-living-plan.log`；PORT=3205 CORE=4205；17s + 24s |
| Chromium B2 memory revoke | **1/1 PASS** | `pw2-b2.log`；PORT=3211 CORE=4211；1.5m（see infra note） |
| Chromium interrupt-expiry (`expired hold refunds`) | **1/1 PASS** | `pw2-interrupt-expiry.log` + earlier `pw-interrupt-expiry.log`；21s / 1.0m |
| Chromium Level-1 pure copy | **2/2 PASS** | `pw2-level1.log`；PORT=3211；1.2m |
| Chromium Artifact growth | **1/1 PASS** (clean solo) | `pw-artifact-ar3.log`；PORT=3221 CORE=4221；33s |

### Infra notes (not product reds)

1. **B2 first attempt** (`pw-b2.log`, PORT=3205 after living-plan under same stack): `CORE_UNAVAILABLE` / Web `Network connection lost` — stack degradation after prior SIGTERM of the batch wrapper. **Not** revoke/`confirmed` product signature. Clean re-run on PORT=3211 **1/1 PASS**.
2. **Artifact mid-batch** (`pw2-artifact.log`, shared e2e2 DB after B2+expiry+level1): 180s timeout on `agent-pending-interrupt` filter `是否按当前方案开始生成`. Clean solo retry **1/1 PASS** in 33s (`pw-artifact-ar3.log`). Classify as **serial-batch cascade / env**, not residual product red on tip.
3. Host `:3001` left alone; DBOS admin log line `Unable to start DBOS admin server on port 3001` is expected when host already owns 3001.
4. Orphan historic `scripts/e2e/run-service.mjs` workers (PPID 1) remain on the machine; reverify used isolated ports and did not mass-kill them.
5. **Concurrent tip drift during reverify**: after residual Chromium finished on `1955a278e`, other lanes landed `806f4485b` (living-plan e2e drop re-confirm), `6aad118e2` / `451f1b2f7` (rights safe-stop). Post-drift `pnpm --filter @meiye/web exec tsc --noEmit` fails on `v31-rights-revocation-journey.spec.ts:219` (`reservedCredits` possibly undefined). **Out of residual-fix matrix**; core typecheck still PASS on post-drift tip.

---

## 3. Short Chromium batch inventory

| Spec | Port set | DB | Result |
|---|---|---|---|
| `v31-living-plan-journey.spec.ts` | 3205/4205/3305 | `meiye_e2_rv_0811_031811_41631` | 2/2 PASS |
| `v31-memory-injection-b2-journey.spec.ts` | 3211/4211/3311 | `meiye_e2r2_0811_032407_42954` | 1/1 PASS |
| `v31-interrupt-resume-journey.spec.ts` `-g "expired hold refunds"` | 3211/4211/3311 | same | 1/1 PASS |
| `v31-level1-copy-journey.spec.ts` | 3211/4211/3311 | same | 2/2 PASS |
| `v31-artifact-growth-journey.spec.ts` | 3221/4221/3321 (solo) | `meiye_ar3_0811_034017_46677` | 1/1 PASS |

Lock: main-checkout `.scratch/orca-run-2026-07-25/e2e-lock.sh`.  
Meta: `e2e-meta.txt`, `e2e2-meta.txt`, `e2e-ar3-meta.txt`.

**Not re-run this lane** (out of residual-fix scope): full 23-spec browser acceptance; interrupt resume-by-id / owner cases; rights revocation; context-fence; day0; goal-proactive.

---

## 4. Ticket evidence updates (this reverify)

| Ticket | Action | Check AC? |
|---|---|---|
| V31-56 | Status→fixed with root-cause + both Chromium cases green @ tip | **Yes** (all four ACs now met by evidence) |
| V31-57 | Reverify note: Chromium expiry still 1/1 @ tip; already fixed | No change to already-checked ACs |
| V31-18 | AC3 Playwright → **1/1 PASS** @ tip; check AC3 only | **AC3 yes**; AC4 remains open |
| V31-15 | AC1 Playwright reverify 1/1 @ tip | **No** (unit/eval still `—`) |
| V31-08 | AC2/AC3 Playwright reverify 2/2 @ tip | **No** (unit/PG still `—`) |
| V31-59 | Untouched (ordinary settlement residual still open) | — |

Rule: no unit-green-as-browser-green; no checkbox when any required result cell is `—`.

---

## 5. Stamp readiness

```text
wave4_ready_to_stamp = false
```

### Residual-fix gate (this report)

```text
residual_targeted_reds_cleared = true
```

Targeted residuals from resume closeout §4 items 1–4 are green on `1955a278e`.

### Still blocking full stamp (non-exhaustive)

1. Full `run-v31-browser-acceptance.sh` not re-run on tip (last full gate had many reds + cascade).
2. **V31-28** Composer plan-diff / pending-interrupt surfaces not re-proven as a suite.
3. **Rights revocation** browser: fail-closed + 授权已撤销 + refund legs green after `6aad118e2`; recovery re-seed (leg 3 可换素材) still red once on tip — hardened navigation/`fixtureIndex` pending re-proof.
4. Day-0 / Goal / context-fence product reds from prior full gate not re-opened here.
5. **V31-26b** external pilot-blocked.
6. **V31-59** ordinary settlement billing identity residual (documented, not fixed).
7. W4-E deep review not executed.

### Suggested next master step

1. Short-batch full browser acceptance under e2e-lock on this tip (or tip+docs).  
2. If only cascade noise remains, re-evaluate stamp; keep V31-26b external and V31-59 open as explicit exceptions only if policy allows.

---

## 6. Paths

- Evidence: `/tmp/v31-residual-reverify/`  
- Resume closeout (pre-residual fixes): `docs/handoff/v31-wave4-resume-closeout-report-2026-08-11.md`  
- Expiry UI fix note: `docs/handoff/v31-w4-expiry-refund-terminal-ui-2026-08-11.md`  
- Tickets: `docs/tickets/v3.1/V31-56-*.md`, `V31-57-*.md`, `V31-18-*.md`, `V31-15-*.md`, `V31-08-*.md`
