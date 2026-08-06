# Recipe governance: production-switch unavailable window (Spec D #374)

**Status:** active until Spec I (#393–#397) lands  
**Date:** 2026-08-06  
**Owners:** admin backlog Spec D / Spec I

## What changed

Ticket **#374** installs `RecipeEvaluationEvidencePort` and
`RecipeInternalTestEvidencePort` with **default-deny** adapters. Browser
commands `recipe_studio_record_eval` and `recipe_studio_internal_test` accept
only `evidenceReceiptId`. Client-constructed `EvalRun`, `passed`, `runId`, and
`label` are no longer authoritative evidence.

Without a server-issued receipt (Spec I issuer + immutable receipt registry):

- evaluation gate does not advance (`phase` stays `validated` or earlier)
- internal-test gate does not advance
- errors are explicit `evidence-unavailable` domain errors
- admin UI shows the eval / internal-test controls as **disabled** (no
  submittable pass button)

## Production impact (must not be silent)

`switchProduction` still requires `studioRelease.phase === 'internal_tested'`.
Therefore, **while default-deny is in force, governed Recipes cannot complete
the four-gate atomic production switch**.

| Path | Status during this window |
| --- | --- |
| `recipe_studio_compile` → `recipe_studio_validate` (`compiled` → `validated`) | **Available** |
| `recipe_studio_record_eval` / `recipe_studio_internal_test` | **Denied** (`evidence-unavailable`) |
| `recipe_studio_production_switch` (four-gate chain) | **Unreachable** until Spec I |
| D5 publish path: `recipe_publish` + `surface_publish` (fixed revision refs) | **Unaffected** — does not go through `switchProduction` |
| First-ship launch seed bootstrap (`publishLaunchCatalog`) | Uses a **server-only** permitting evidence seam for seed recovery; not the browser command path |

## Expected duration

- **Start:** merge of #374 (this change)
- **End:** Spec I delivery — issues **#393** (receipt registry), **#394**
  (recipe-governance suite), **#395** (server issuer), **#396** (redeem +
  command narrow confirmation), **#397** (admin evidence status)
- Spec D and Spec I are scheduled as a **same-batch** dependency. If they
  ship on different days, treat the gap as a known ops freeze on four-gate
  production switch and keep this note linked from the merge ledger.

## Operator guidance

1. Prefer D5 fixed-revision publish (`recipe_publish` then update Surface refs
   and `surface_publish`) for merchant-visible releases during the window.
2. Do not treat a successful Recipe draft/validate as “quality certified”.
3. Do not re-enable browser `passed: true` shortcuts; Spec I must restore
   gates via server-issued `evidenceReceiptId` only.

## Contract lock

Port / receipt field list is fixed for Spec I implementors:

`receiptId`, `evidenceKind`, `runId`, `recipeId`, `recipeRevision`,
`promptRevisionRef`, `suiteId`, `suiteRevision`, `mode`, `passed`,
`issuerId`, `issuedAt`, `expiresAt`.

Do not change this signature in Spec I without a coordinated break.
