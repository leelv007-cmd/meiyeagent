# Z1 Cutover Unfreeze Record — 2026-07-20

> Ticket: **#105** (`ticket/105-cutover`) · Role: sole integration owner  
> Authority: D-098 C1 + S1 freeze list (`docs/handoff/contract-spine-freeze-2026-07-20.md`)

## Why unfreeze

C/D/E pure models + routes (#95–#104) landed on main as dual-read. Z1 is the only ticket authorized to:

1. Physically retire T6 scene chips / named-preset contracts / `selectedPreset.internalIntent`
2. Unhook the legacy `?workId=` result bridge on dashboard home
3. Mount Composer as the primary creation entry
4. Thin-wire independent FoundationModules into `apps/core/src/main.ts`
5. Converge entry deep links to `/dashboard/results/$workId`

## Files unfrozen (and why)

| Path | Freeze origin | Unfreeze reason |
|---|---|---|
| `apps/core/src/main.ts` | S1 shared freeze | Thin registration of `creation-experience` / `product-billing` / `result-delivery` FoundationModules (no new methods on `OperationsApplicationService`) |
| `mkfast-template-main/src/product/unified-creation-workbench.tsx` | S1 container freeze | Deleted after import-graph audit proved zero production callers; Composer + Result Center replace its creation/result branches |
| `mkfast-template-main/src/product/mobile-action-book.tsx` | S1 container freeze | Deleted after import-graph audit proved zero production callers; responsive Composer replaces its mobile entry |
| `mkfast-template-main/src/routes/dashboard/index.tsx` | WT-C owner (Z integrates) | Mount `ComposerHome`; unhook `?workId=` → redirect `/dashboard/results/$workId` |
| `mkfast-template-main/src/p1/operations-view-model.ts` | T6 named-preset surface | Delete `NAMED_PRESET_CONTRACTS` injection into template views |
| `mkfast-template-main/src/p1/content-package-detail.tsx` | WT-D duplicate actions | Retire quick-edit rewrite/export primary actions; hand off to Result Center |
| `mkfast-template-main/src/product/device-relay.ts` | Cross-entry deep link | Work relay lands on Result Center path (not `?workId=`) |
| `mkfast-template-main/src/product/async-task-center-model.ts` | Entry matrix | Video workflow work href → `/dashboard/results/$workId` |
| `mkfast-template-main/src/product/canonical-history-model.ts` | Entry matrix | Recent/works continue href → Result Center |
| `mkfast-template-main/src/product/creation-shelf.tsx` | Entry matrix | Same |
| `mkfast-template-main/src/product/creative-object-page.tsx` | Entry matrix | Same |

## Intentionally not unfrozen (deferred Z2-WIRING / AP/MP)

| Path | Reason |
|---|---|
| `operations/application-service.ts` (+ ops five-piece) | No new methods; modules stay independent |
| `packages/contracts/src/index.ts` / `uiux.ts` | AP/MP S2a capability-permission migration owns these |
| `mkfast-template-main/src/lib/routes.ts` | Composer catalog path stays in `composer-nav.ts` |
| Sidebar / inlang message packs | Cross-pack freeze; no new nav labels required for cutover |
| `routeTree.gen.ts` | Generate-only; catalog + results routes already present on main |

## Wiring notes

- **creation-experience**: memory catalog + `publishLaunchCatalog` at boot (first-ship Surface/Recipe seeds). Durable repo = future ticket.
- **product-billing**: in-process `ProductQuoteService` (memory usage ledger). Durable ledger integration with GrantLot = AP/MP / Z2-WIRING.
- **result-delivery**: memory `VisualAdoptionService` / `MemoryFirstAdoptPort`. Production first-adopt port adapter to operations = Z2-WIRING.

## Retirement greps (acceptance)

```bash
rg -n 'SceneVisualButton|sceneChipGroups|NAMED_PRESET_CONTRACTS|internalIntent' \
  mkfast-template-main/src apps --glob '!**/docs/**' --glob '!**/migration-matrix.md'
# expect: zero runtime hits (tests use split tokens)
```

## V1 / C6 gate

- Day-0 Playwright hard gate `tests/e2e/specs/uiux-day0-contract.spec.ts` uses Composer lens and Recipe-card selectors; old scene/mode/Harness selectors are statically rejected.
- Fixture journey: `src/product/composer/z1-three-modal-journey.test.ts` (copy / image_text / video + C6 budget 2/2/3).
- Static retirement: `src/product/composer/z1-cutover-retirement.static.test.ts`.
