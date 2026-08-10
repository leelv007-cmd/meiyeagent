# V31-57 expiry billing identity audit (2026-08-11, tip re-check)

## Verdict

| Item | Status |
| --- | --- |
| Rejected `1d62a2c70` | **Not on** `codex/v31-integration` tip (`7643dd109`) |
| Landed fix `a1c76afc4` | **Is ancestor** of tip (via merge `243002708`) |
| Old worktree WIP on `codex/v31-w4-expiry` | **Superseded** — do not cherry-pick; 11-file WIP remains local archive only |
| Living Plan start drain `fcd042758` | **Is ancestor** of tip |

## Pause handoff §4 three blockers vs landed fix

| Blocker in rejected `1d62a2c70` | Landed `a1c76afc4` response |
| --- | --- |
| Settlement used wrong ID → root axes miss after refund | Explicit `billingTaskId` for ProductUsage/credits; workflow `taskId` for axes |
| Stale reclaim silent lease via INNER JOIN discard | Authority bind first; orphan dead-letter |
| Unbound `sourceTaskId` could refund another task | Claim binds request/source/reservation/quote |

Evidence already on tip: `docs/handoff/v31-w4-expiry-billing-id-evidence-2026-08-11.md`.

## Residual (not closed by this audit)

- **V31-59 candidate**: ordinary settlement only sets `billingTaskId` when
  `request.sourceTaskId` is present (`dbos-workflow.ts` harnessBillingSettlementInput).
  Paths without `sourceTaskId` remain a residual risk — do not claim fixed.
- Old WIP patch backup path in prior evidence may no longer exist; treat as historical.

## Specs already on tip (pause §5)

| Spec | On tip | Prior residual-reds Chromium |
| --- | --- | --- |
| `v31-level1-copy-journey.spec.ts` | yes | 2/2 PASS |
| `v31-artifact-growth-journey.spec.ts` | yes | 1/1 PASS (solo) |
| interrupt-expiry case | in `v31-interrupt-resume-journey` | 1/1 PASS after refund UI fix |

This audit does **not** invent new product code. Next action is tip re-verification
(L1 + Artifact + expiry case) then full `run-v31-browser-acceptance.sh` under e2e-lock.
