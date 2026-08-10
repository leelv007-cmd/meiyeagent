# Wave-4 pause §7 progress on tip `c96c0902f` (2026-08-11)

Tip at write: `c96c0902f` (`docs(handoff): audit V31-57…`). Branch `codex/v31-integration`. **No push.**

## Stamp

```text
wave4_ready_to_stamp = false
```

Reason: full serial browser gate still ends red when the long Playwright stack
collapses mid-suite (Web `ECONNRESET` → subsequent `ECONNREFUSED`). Solo
re-verification of cascade victims is green. External V31-26b remains blocked.
Ordinary-settlement `billingTaskId` residual (V31-59 candidate) remains open.

## §7 checklist

| Step | Status | Notes |
| --- | --- | --- |
| 1 Read AGENTS/CONTEXT/handoff | done | integration worktree |
| 2 Review/merge `fcd042758` start drain | **ancestor of tip** | already landed earlier |
| 3 Expiry WIP; never merge `1d62a2c70` | **done** | `a1c76afc4` is ancestor; audit handoff committed |
| 4 Level-1 + Artifact real UI specs | **on tip + green** | catalog already lists both files |
| 5 Full typecheck/PG/browser gates | **partial** | focused re-verify green; full serial red by env cascade |
| 6 Evidence / W4-E / push | **not stamp** | this handoff only |

## Expiry audit (step 3)

See `docs/handoff/v31-w4-expiry-audit-2026-08-11.md`:

- Rejected `1d62a2c70` **not** on tip
- Landed `a1c76afc4` **is** ancestor
- Old `codex/v31-w4-expiry` WIP is superseded archive only

## Level-1 / Artifact (step 4) — tip re-verify

e2e-lock PORT=3353 CORE=4353, DB `meiye_l1a_0811_063700`:

| Spec | Result |
| --- | --- |
| `v31-artifact-growth-journey` stable Artifact | **PASS** ~31.7s |
| interrupt-expiry refunds case | **PASS** ~15.9s |
| Level-1 policy-exempt + freeze + replay | **PASS** ~25.4s |
| Level-1 insufficient balance dual exit | **PASS** ~9.1s |

**4/4 PASS** (~2.1m). Log: implementer `pw-l1art-exp.log`.

## Full browser acceptance (step 5 attempt)

Command: `bash scripts/ci/run-v31-browser-acceptance.sh` under e2e-lock  
PORT=3360 CORE=4360, `meiye_full_0811_063929`, RELEASE_COMMIT_SHA=tip pre-audit commit.

| Phase | Result |
| --- | --- |
| Missing-spec catalog | **PASS** (all required files present) |
| production-network-boundary | C-12 contract valid (local; production evidence not checked) |
| Playwright serial | **12 passed**, then Web `ECONNRESET`, then mass `ECONNREFUSED ::1:3360` |

**Green before cascade:** Artifact, context-fence, Day-0, Goal×3, interrupt-resume×3, Level-1×2, Living Plan half (检索→调整).

**First timed out case after stack damage:** Living Plan commit-strip start failed inside `seedComposerInlineAuthorize` toast wait — concurrent Web ECONNRESET. Not a product assertion failure on a healthy stack.

**Cascade (0–1.5s fails):** B2, mid-run steering, ops-console, partial-resume, publish-handoff×3, rights, thread-root×5, video — all connection refused.

Log: implementer `full-browser/pw-full.log`.

## Solo re-proof of cascade victims

e2e-lock PORT=3370, `meiye_solo_0811_064607`:

| Spec | Result |
| --- | --- |
| Living Plan ×2 (incl. commit-strip start) | **2/2 PASS** |
| partial-resume assisted | **1/1 PASS** |
| rights-revocation | **1/1 PASS** |

**4/4 PASS** (~2.7m). Log: `pw-solo-residual.log`.

## Product work landed this session (prior commits)

| SHA | Topic |
| --- | --- |
| `c2cb26400` | context-fence plan.revised + material-head reconfirm |
| `7643dd109` | partial-resume sticky fence ack + PG interrupt reopen + settlement assert |
| `c96c0902f` | expiry audit handoff |

## Still open for stamp

1. Full serial `run-v31-browser-acceptance.sh` green on one healthy stack (or documented infra fix for long-suite Web crash).
2. B2 / mid-run steering / ops-console / publish-handoff / video / thread-root — re-verify if full serial still red after infra harden (solo not all re-run this leg).
3. V31-59 candidate: ordinary settlement without `sourceTaskId`.
4. V31-26b external pilot.
5. No push; master only.

## Hard rules

No push; no kill :3001; e2e-lock + isolated ports/DBs; real UI; no secrets in argv.
