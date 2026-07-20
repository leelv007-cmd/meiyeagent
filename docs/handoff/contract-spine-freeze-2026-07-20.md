# S1 Contract Spine Freeze Matrix (#87)

> Delivered on branch `lane/contract-spine-87`. Zero runtime behavior change.
> Parent handoff: `docs/handoff/ui-journey-rebuild-handoff-2026-07-20.md`.

## Ownership matrix

| Module | Owner lane | Path | Notes |
|---|---|---|---|
| creation-experience | **WT-A exclusive** | `packages/contracts/src/creation-experience.ts` | Lens `copy \| image_text \| video` (D-081); Recipe/Surface revision ids; RecipePatchPreview; event kinds |
| product-quote | **WT-B exclusive** | `packages/contracts/src/product-quote.ts` | `per_request \| per_output_second`; ProductQuoteSnapshot skeleton; **no second quote object** |
| result-center | **WT-D1 owner** | `packages/contracts/src/result-center.ts` | `ResultCenterNavigation { workId, returnToDraftKey?, focusKey? }`; ResultShellPhase; freezes for C/E |
| video-workflow (public) | **WT-E exclusive** | `packages/contracts/src/video-workflow.ts` | Cross-lane projection (ids/status/shot summary only) |
| video-workflow-contract (durable) | **WT-E** (post-S1) | `apps/core/src/p1/model-supply/video-workflow-contract.ts` | Pure type extract from `model-supply/index.ts`; re-exported for back-compat |
| contracts barrel | Integration owner | `packages/contracts/src/index.ts` | Re-exports the four modules |

## Shared freeze list (parallel period)

Only the integration owner (S1 / Z-series / cross-pack wiring) may edit:

### operations 五件套
- `apps/core/src/p1/operations/application-service.ts`
- `apps/core/src/p1/operations/foundation-module.ts`
- `apps/core/src/p1/operations/types.ts`
- `apps/core/src/p1/operations/repository.ts`
- `apps/core/src/p1/operations/postgres-repository.ts`

### core entry / contracts surface
- `apps/core/src/main.ts`
- `packages/contracts/src/index.ts`
- `packages/contracts/src/uiux.ts`

### frozen UI containers
- `unified-creation-workbench.tsx` (path under web product workbench)
- `mobile-action-book.tsx`

### generate-only
- `routeTree.gen.ts` — never hand-edit

### Cross-pack freeze addendum (document; feature lanes do not rewrite)
- `mkfast-template-main/src/lib/routes.ts`
- sidebar configs / layouts (`config/sidebar-config.ts`, `components/layout/sidebar-main.tsx`, `dashboard-sidebar.tsx`, `sidebar-user.tsx`)
- `project.inlang/messages/{zh,en}.json`

## Wiring discipline

- **A/B**: create independent `FoundationModule`s; **do not** add methods to `OperationsApplicationService`.
- **Cross-lane interfaces**: go through `@meiye/contracts` types + HTTP contract tests.
- **Video durable model**: full types live in core `video-workflow-contract.ts` until E1 (#102); public consumers use `packages/contracts/src/video-workflow.ts` projections.

## Extract strategy (video)

1. Cut pure interfaces / type aliases / error classes into `video-workflow-contract.ts`.
2. Foundation deps (`DataClass`, `RouteSnapshot`, `ProviderAttempt`, `OwnedAsset`, `ProviderCost`, `VideoQualityAssessment`) stay in `index.ts`; contract file uses `import type` only (no runtime cycle).
3. `index.ts` re-exports types + error classes; keeps `InMemoryDurableVideoWorkflowStore`, `ContentWorkflowRunner`, and all behavioral code.
