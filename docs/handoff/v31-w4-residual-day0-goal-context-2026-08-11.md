# Wave-4 residual: Day-0 / Goal / context-fence progress (2026-08-11)

Tip at write: post-`3a99f1347` (this handoff commit). Branch `codex/v31-integration`. **No push.**

## Stamp

```text
wave4_ready_to_stamp = false
```

## Landed this leg

### 1. Goal + Proactive Idle — **3/3 Chromium PASS**

| Case | Result |
| --- | --- |
| propose→confirm, Idle projection, accept zero paid side effect | PASS ~10s |
| kill switch closes suggestions | PASS ~7s |
| dashboard Idle host mounts surface | PASS ~8s |

**Root cause of prior red:** e2e injected `config` into `get_idle_projection` / listSuggestions payload. Production hard-rejects client config (`listSuggestionsSchema` strict; BFF admin-config for allowlist/kill).

**Fix:**
- Admin actor applies `proactive_opportunity_v1` / `disable_proactive_agent` via `admin-config` commands.
- Owned-data `goal_stalled` via `now` advanced +15d (no client fake signals — accept reprojects from `OwnedDataProactiveSignalSource`).
- Spec: `v31-goal-proactive-idle.spec.ts`.

Evidence: e2e-lock PORT=3319 CORE=4319, `meiye_g3_*`, 3/3 PASS ~1.1m.

### 2. V31-51 Day-0 store absence encoding — **product fixed; full journey still red**

**Contract choice:** `store: null` = looked, no confirmed store (not key omission).

**Code:**
- `packages/contracts/src/product.ts` — `store?: StoreProfile | null` + comment
- `apps/core/src/product/product-service.ts` — `initialState` / `normalizeState` always project `store: null` when absent
- `apps/core/src/product/relational-product-state.ts` — rebuild emits `store: store ?? null`
- day0 spec asserts `workspaceId` + `Object.hasOwn(..., 'store')` + `toBeNull()`

**Precondition green** on tip after fix (no longer fails at line 109).

**Remaining day0 red (out of V31-51):** after free-mode fill, `composer-submit` enabled but waitForResponse on `POST .../composer/submissions` times out 120s. UI snapshot shows 「确认本次创作」+「确认并开始」+「正在提交」— free path may now require a confirm step or hang mid-submit. **Not** store encoding.

Solo re-run PORT=3321 still 1 failed at submissions wait (2.2m).

### 3. Context-fence / partial-resume — **still red** (product)

Prior batch (PORT=3311):

| Spec | Failure |
| --- | --- |
| `v31-context-fence-journey` | `agent-plan-diff` not visible 180s after price drift + interrupt accept |
| `v31-partial-resume-assisted-journey` | pending interrupt filter `/价格|事实|变化/` not found |

Infra noise in same batch: `PostgresError: too many clients already` (env; 336 leftover `meiye_*` DBs on host).

Not fixed this leg. V31-28 plan-diff surface remains open.

## Prior this session (already on tip)

| Item | SHA / note |
| --- | --- |
| Interrupt resume-by-id decision write | `cfe01b8b4` + handoff `3a99f1347` |
| Full interrupt-resume suite | 3/3 PASS |

## Suggested next

1. Free-mode Day-0 submit path: map 「确认并开始」 to real `composer/submissions` (or drain hung submit).
2. Context-fence: after price drift + accept, ensure Living Plan history gets rN+1 so `agent-plan-diff` renders; re-run partial-resume.
3. Full `run-v31-browser-acceptance.sh` only after Day-0 + context-fence green (or document exceptions).
4. V31-26b remains external-blocked.

## Hard rules

No push; no kill :3001; e2e-lock + isolated ports/DBs; real UI.
