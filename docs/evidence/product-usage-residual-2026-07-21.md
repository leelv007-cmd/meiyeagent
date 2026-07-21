# #92 ProductUsage residual disposition (2026-07-21)

## Verdict: **split — core delivered / bridge residual open**

Do **not** treat #92 as "never implemented". Do **not** full-close without residual note.

### Core delivered (may claim)

- Contracts `product-quote` / `ProductUsageRecord` fractional units
- `DurableProductBillingService` + PG tables quote/usage/provider_cost
- HTTP + Worker inject durable `billingLifecycle`
- GrantLot remains a separate chain (not merged)

### Residual partial (honest block for "bridge complete")

| Item | Evidence |
|---|---|
| `FoundationModelSupplyLedger` bilateral `productUsage` **not** injected in production | `main.ts` / `job-worker.ts` only pass `billingLifecycle` + `supplyFreezes` |
| `SupplySideProductUsageBridge` freeze map is process-local | `supply-ledger-fields.ts` |
| Audit text still says "Memory only" in places | F-H-03 / ticket audit — stale relative to durable wiring |

### Relation to #128 / #106

- #128 whole-package complete is blocked by **union**: G-LIVE-* + G-E2E-PLAYWRIGHT-D048 + this residual honesty note
- Clearing this residual alone does **not** close #128 if live/e2e remain open
- Recommended owner for residual: **#127 Z2-WIRING** (or micro follow-up), not reopening #92 as zero delivery

### Minimal residual close recipe

1. Inject durable usage lookup into bilateral `productUsage` (async-safe bridge if needed)
2. Assembly test: freeze attaches when usage reserved
3. Update F-H-03 / audit wording: durable wired; residual = bridge inject
