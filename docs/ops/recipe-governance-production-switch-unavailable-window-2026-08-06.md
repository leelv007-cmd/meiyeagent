# Recipe governance: production-switch unavailable window (Spec D #374 → Spec I #396)

**Status:** **CLOSED** by Spec I ticket **#396** (registry-backed redeem)  
**Opened:** 2026-08-06 with #374 (default-deny ports)  
**Closed:** 2026-08-07 with #396 (redeem + command narrow confirmation)  
**Owners:** admin backlog Spec D / Spec I

## Window lifecycle

| Milestone | Effect |
| --- | --- |
| **#374** open | Default-deny evidence ports; four-gate production switch unreachable for governed Recipes |
| **#393** | Immutable receipt registry |
| **#394** | `recipe-governance` suite |
| **#395** | Server issuer (suite runner + `eval:import` + internal-test runner) |
| **#396** **CLOSE** | Registry-backed redeem adapters; gates accept only `evidenceReceiptId` and re-validate against registries |

This document remains as historical ops record. The freeze is **no longer in force** once #396 is merged and assembled.

## What #374 installed (historical)

Ticket **#374** installed `RecipeEvaluationEvidencePort` and
`RecipeInternalTestEvidencePort` with **default-deny** adapters. Browser
commands `recipe_studio_record_eval` and `recipe_studio_internal_test` accept
only `evidenceReceiptId`. Client-constructed `EvalRun`, `passed`, `runId`, and
`label` are never authoritative evidence.

Without a server-issued receipt:

- evaluation gate did not advance (`phase` stayed `validated` or earlier)
- internal-test gate did not advance
- errors were explicit `evidence-unavailable` domain errors
- admin UI showed the eval / internal-test controls as **disabled**

## What #396 closes with

Production assembly wires **registry-backed redeem** adapters
(`createRegistryBackedRecipeEvidencePorts`) into the creation-experience
foundation module via shared `EvalRun` + receipt registries.

Redeem order (fixed; does not trust receipt conclusions):

1. Load receipt by `receiptId`
2. `evidenceKind` matches the gate
3. Not expired
4. `recipeId` / `recipeRevision` equals current head
5. `promptRevisionRef` equals compile freeze
6. Re-load EvalRun from registry and re-parse as eval-run/v1
7. `passed` is true on the re-parsed run
8. Every case `promptRevision` matches the frozen Prompt
9. `issuerId` is on the allowlist

Each step fails with a distinct operator-facing domain error token
(`receipt-not-found`, `receipt-expired`, `evidence-kind-mismatch`, …).

`studioRelease.evaluation` / `.internalTest` `runId` / `suiteId` /
`suiteRevision` are taken from the **registry EvalRun**, never from browser
input. Langfuse remains observability only: push failure is recorded and does
not block issuance or redeem.

| Path | Status after #396 |
| --- | --- |
| `recipe_studio_compile` → `recipe_studio_validate` | Available |
| `recipe_studio_record_eval` / `recipe_studio_internal_test` | **Available** with server-issued `evidenceReceiptId` |
| `recipe_studio_production_switch` (four-gate chain) | **Available** when both receipts redeem |
| Default-deny fallback | Only when registries are not wired (fail-closed) |
| First-ship launch seed bootstrap | Still uses server-only permitting seam for seed recovery |

## Operator guidance (post-close)

1. Obtain evidence via server suite runner, internal-test runner, or
   `pnpm eval:import … --recipe --revision --kind` (issues a receipt).
2. Submit only `evidenceReceiptId` plus CAS/audit fields at the two gates.
3. Do not re-enable browser `passed: true` shortcuts.
4. D5 fixed-revision publish remains available as an alternate path and does
   not go through `switchProduction`.

## Contract lock (still in force)

Port / receipt field list remains fixed:

`receiptId`, `evidenceKind`, `runId`, `recipeId`, `recipeRevision`,
`promptRevisionRef`, `suiteId`, `suiteRevision`, `mode`, `passed`,
`issuerId`, `issuedAt`, `expiresAt`.

Do not change this signature without a coordinated break.
