# VideoWorkflow derivation (#102 / WT-E E1)

## Goal

Migrate write authority off the first-class `DurableVideoWorkflow` store
(`model_video_workflows` + OCC + full lifecycle) onto **canonical Task / Job /
Asset-shaped records**. `VideoWorkflow` becomes a **derived read-only
projection** for runners, Composer, and Result Center.

## Architecture after E1

| Layer | Module | Role |
| --- | --- | --- |
| **Canonical truth** | existing `p1_content_tasks` / `p1_creative_jobs` / `p1_creative_assets` | Storyboard plan, lifecycle/OCC/lease, and one row per owned candidate/composed asset |
| **Commands** | `VideoWorkflowCanonicalCommandPort` / `VideoWorkflowCanonicalCommands` | create / confirm / select / claim / checkpoint / cancel — only intended write path |
| **Durable projection** | `projectDurableVideoWorkflow` | Flatten canonical → `DurableVideoWorkflow` (compat shape for `ContentWorkflowRunner`) |
| **Public projection** | `projectVideoWorkflowPublic` + `packages/contracts/src/video-workflow.ts` | Cross-lane ids/status/shot summary; **no** Provider / Credential / route / asset blobs |
| **Read-only facade** | `VideoWorkflowProjectionReadFacade` | get/list/findLatest only; writes throw `VIDEO_WORKFLOW_PROJECTION_READONLY` |
| **Deprecated adapter** | `InMemoryDurableVideoWorkflowStore` | Delegates save/claim/cancel to canonical commands then projects — **not** independent authority |

```
Commands ──put/claim/cancel/edit──▶ generic Task / Job / Asset records
                                      │
                    projectDurable / projectPublic
                                      ▼
                         DurableVideoWorkflow / PublicProjection
```

**Invariant:** there must not be two competing write authorities. Postgres
`model_video_workflows` and `model_canonical_video_runs` are read-only
compatibility inputs during startup backfill; all create/confirm/run/cancel/
checkpoint/edit mutations write the existing generic records.

## Field mapping (legacy table → canonical)

Legacy row: `model_video_workflows.workflow` JSONB + `revision` + `run_lease_token`.

| Legacy `DurableVideoWorkflow` | Canonical |
| --- | --- |
| `id` | `runId` |
| `workspaceId` / `actorId` / `workId` | same |
| `storyboardVersion`, `storyboardRevision`, `catalogModelId`, `dataClass`, authoring settings and ordered shot plans | `p1_content_tasks.payload` |
| `status`, `confirmed`, `revision`, candidate execution facts, `failureCode`, timestamps | `p1_creative_jobs.payload` |
| each candidate/clip/composed owned asset | one `p1_creative_assets` row |
| `run_lease_token` | generic Job `payload.runLeaseToken` |

Helpers:

- `liftDurableToCanonical(workflow)` — dual-read / migration seed
- `projectDurableVideoWorkflow(run)` — reverse flatten for runners
- `InMemoryDurableVideoWorkflowStore.restore` / `VideoWorkflowCanonicalCommands.restoreFromLegacy` — import one legacy row

## Postgres cutover and compatibility

1. Operations migrates the existing generic Task/Job/Asset tables first;
   `PostgresCanonicalVideoWorkflowSchema` refuses to manufacture a video table.
2. Startup migration imports missing rows from both historical
   `model_video_workflows` and the superseded `model_canonical_video_runs`.
3. After import, reads and every mutation target generic records only. Legacy
   rows remain unchanged as rollback evidence, never as runtime fallback.
4. Runtime entrypoints instantiate `PostgresCanonicalVideoRunStore`; the old
   writable `PostgresDurableVideoWorkflowStore` has been removed.
5. **Idempotent recovery:** claim + checkpoint + provider `idempotencyKey`
   (`${runId}:shot:${shotId}:candidate:${index}`) unchanged — double recover
   must not re-charge (`productUsageQuantity` only on first shot/candidate) or
   re-deliver ContentPackage reconcile for a terminal run.

## Deprecation plan

| API | Status |
| --- | --- |
| `InMemoryDurableVideoWorkflowStore.save/claimRun/requestCancel` | Deprecated adapter → canonical |
| `DurableVideoWorkflowStore` interface | Compat port; new code should depend on command port + projection facade |
| Direct mutation of projection without command | Forbidden (`VideoWorkflowProjectionReadFacade`) |
| `model_video_workflows` | Read-only backfill source; no production command may write it |
| Legacy table drop | Separate operational cleanup after retention and rollback windows expire |

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

## Residual risks

- `ContentWorkflowRunner` still builds an in-memory `DurableVideoWorkflow`
  working copy, but its production store boundary lifts each checkpoint into a
  canonical command and never exposes `save(DurableVideoWorkflow)` to the
  Postgres authority.
- Frontend `video-workflow-model` remains a UI pure model; public status aligns
  with contracts, not with core durable fields.
