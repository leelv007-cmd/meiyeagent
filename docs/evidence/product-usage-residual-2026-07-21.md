# #92 ProductUsage residual disposition (2026-07-21)

## Verdict: **core + bridge residual delivered**

Do **not** treat #92 as "never implemented". The bilateral bridge residual in
this note is closed by the 2026-07-21 implementation and tests below.

### Core delivered (may claim)

- Contracts `product-quote` / `ProductUsageRecord` fractional units
- `DurableProductBillingService` + PG tables quote/usage/provider_cost
- HTTP + Worker inject durable `billingLifecycle`
- GrantLot remains a separate chain (not merged)

### Bridge residual closed (2026-07-21)

| Item | Evidence |
|---|---|
| Production bilateral `productUsage` | `main.ts` and `job-worker.ts` inject the shared `DurableProductBillingService` as both `billingLifecycle` and async `productUsage` lookup |
| Cross-process freeze association | `SupplySideProductUsageBridge` owns no process-local map; `PostgresSupplyFreezeStore` persists and reads by `(workspaceId, productUsageTaskId)` |
| Reserved usage before supplier attempt | `foundation-ledger.test.ts` covers reserved attach, settlement fallback persistence, legacy replay, and the get-miss/settlement race |
| Real durable restart proof | `postgres-repository.postgres.test.ts` reserves Postgres ProductUsage, freezes through the production-equivalent ledger, then reads and replays from new billing/ledger instances |

### Deployment constraint (not dual-version gray safe)

Deploy HTTP and Worker as one coordinated release: drain or stop old processes,
deploy both entrypoints, then resume work. New code can replay an old immutable
freeze whose `productUsageTaskId` used `jobId`, provided every other immutable
fact matches. The reverse is intentionally **not** claimed: an old process can
propose `jobId` after a new process has persisted `billingTaskId`, which the
immutable store correctly rejects. Therefore this field transition must not use
mixed-version gray traffic without an explicit compatibility flag or alias
schema.

Unbilled submissions continue to persist H2/ProviderCost freeze facts but do
not fabricate a ProductUsage link.

### Relation to #128 / #106

- This ProductUsage bridge residual no longer blocks #128.
- G-E2E-PLAYWRIGHT-D048 is closed / verified (four-service Playwright 3/3).
- #128 whole-package completion is now blocked only by its remaining G-LIVE-*
  evidence; this note does not close those live gates.
- Delivery belongs to #127 Z2-WIRING history; it does not reopen #92 as zero
  delivery.

### Verification

1. `foundation-ledger.test.ts`: bridge/runtime behavior, fallback persistence,
   old-row replay, and TOCTOU convergence.
2. `runtime-assembly.test.ts`: both production entrypoints inject the durable
   ProductUsage lookup.
3. `postgres-repository.postgres.test.ts`: real PostgreSQL reserve → freeze →
   new-instance read/replay.
