# VideoWorkflow derivation (#102 / WT-E E1)

## Goal

Migrate write authority off the first-class `DurableVideoWorkflow` store
(`model_video_workflows` + OCC + full lifecycle) onto **canonical Task / Job /
Asset-shaped records**. `VideoWorkflow` becomes a **derived read-only
projection** for runners, Composer, and Result Center.

## Architecture after E1

| Layer | Module | Role |
| --- | --- | --- |
| **Canonical truth** | `video-workflow-projection.ts` types + `video-workflow-canonical.ts` store | `CanonicalVideoRun` = Task + Job + Assets; `InMemoryCanonicalVideoRunStore` is sole memory write authority |
| **Commands** | `VideoWorkflowCanonicalCommandPort` / `VideoWorkflowCanonicalCommands` | create / confirm / select / claim / checkpoint / cancel — only intended write path |
| **Durable projection** | `projectDurableVideoWorkflow` | Flatten canonical → `DurableVideoWorkflow` (compat shape for `ContentWorkflowRunner`) |
| **Public projection** | `projectVideoWorkflowPublic` + `packages/contracts/src/video-workflow.ts` | Cross-lane ids/status/shot summary; **no** Provider / Credential / route / asset blobs |
| **Read-only facade** | `VideoWorkflowProjectionReadFacade` | get/list/findLatest only; writes throw `VIDEO_WORKFLOW_PROJECTION_READONLY` |
| **Deprecated adapter** | `InMemoryDurableVideoWorkflowStore` | Delegates save/claim/cancel to canonical commands then projects — **not** independent authority |

```
Commands ──put/claim/cancel──▶ CanonicalVideoRunStore
                                      │
                    projectDurable / projectPublic
                                      ▼
                         DurableVideoWorkflow / PublicProjection
```

**Invariant:** there must not be two competing write authorities. Postgres
`model_video_workflows` remains a dual-read physical table during migration
(see below); logical authority is the canonical shape.

## Field mapping (legacy table → canonical)

Legacy row: `model_video_workflows.workflow` JSONB + `revision` + `run_lease_token`.

| Legacy `DurableVideoWorkflow` | Canonical |
| --- | --- |
| `id` | `runId` |
| `workspaceId` / `actorId` / `workId` | same |
| `storyboardVersion`, `storyboardRevision`, `catalogModelId`, `dataClass`, `aigcLabelEnabled`, `brandWatermarkText`, `referenceAssetIds`, `executionContract`, `approvalReceiptId`, `shots` | `task.*` (`derivedFromWorkflowId` → `task.derivedFromRunId`) |
| `status`, `confirmed`, `revision`, `failureCode`, `cancelRequestedAt`, `createdAt`, `updatedAt` | `job.*` |
| `attempts`, `clipAssets`, `composedAsset`, `routeSnapshot` | `assets.*` |
| `run_lease_token` (column) | store-side lease map (`InMemoryCanonicalVideoRunStore`) / future Job lease |

Helpers:

- `liftDurableToCanonical(workflow)` — dual-read / migration seed
- `projectDurableVideoWorkflow(run)` — reverse flatten for runners
- `InMemoryDurableVideoWorkflowStore.restore` / `VideoWorkflowCanonicalCommands.restoreFromLegacy` — import one legacy row

## Dual-read window (Postgres)

1. **Write path (logical):** all new command semantics go through
   `VideoWorkflowCanonicalCommandPort` (memory proven in E1 tests).
2. **Physical persistence (current):** `PostgresDurableVideoWorkflowStore` still
   stores the durable projection JSONB. It is a **serialization of the
   projection**, not a second domain model. E2/E3 may introduce a
   `model_canonical_video_runs` (or JobPort payload) table; until then the
   projection column is the on-disk encoding of canonical truth via
   lift/project round-trip.
3. **Read path:** `get` → lift optional for canonical consumers; project for
   public/API consumers.
4. **Idempotent recovery:** claim + checkpoint + provider `idempotencyKey`
   (`${runId}:shot:${shotId}:candidate:${index}`) unchanged — double recover
   must not re-charge (`productUsageQuantity` only on first shot/candidate) or
   re-deliver ContentPackage reconcile for a terminal run.

## Deprecation plan

| API | Status |
| --- | --- |
| `InMemoryDurableVideoWorkflowStore.save/claimRun/requestCancel` | Deprecated adapter → canonical |
| `DurableVideoWorkflowStore` interface | Compat port; new code should depend on command port + projection facade |
| Direct mutation of projection without command | Forbidden (`VideoWorkflowProjectionReadFacade`) |
| `model_video_workflows` drop | **Not** in E1 — requires dual-write/backfill ticket after Job/Asset ports absorb run state |

## Crash-recovery semantics (preserved)

- `claimRun` takes a lease; checkpoints require `runLeaseToken`.
- Terminal statuses release the lease.
- `runDurableVideoWorkflow` replays only unfinished candidates (`unknown` /
  missing) using the same generation key — no double provider charge.
- Cancel mid-run: `requestCancel` drops lease; completion of cancel requires
  `completeCancellation: true`.

## Public projection sanitization

`assertPublicProjectionIsSanitized` rejects serialized public payloads that
include provider/credential/route/asset tokens. Contracts consumers must only
see `VideoWorkflowPublicProjection`.

## Residual risks (E2 / E3)

- Postgres store still writes projection JSONB without an explicit canonical
  column; a true table cutover is E2+.
- `ContentWorkflowRunner` still builds working copies as `DurableVideoWorkflow`
  and checkpoints via the adapter — behavioral equivalence is proven, but the
  runner is not yet command-port-only.
- Frontend `video-workflow-model` remains a UI pure model; public status aligns
  with contracts, not with core durable fields.
