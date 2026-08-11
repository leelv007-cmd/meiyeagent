# VideoWorkflow derivation (#102 / WT-E E1)

## Goal

Production video workflow authority lives in the existing canonical Task / Job /
Asset records. `DurableVideoWorkflow` and the public workflow payload are derived
read models; neither is an independent writable authority.

## Current architecture

| Layer | Module | Role |
| --- | --- | --- |
| **Canonical truth** | `p1_content_tasks` / `p1_creative_jobs` / `p1_creative_assets` | Storyboard plan, lifecycle/OCC/lease, and owned candidate/composed assets |
| **Production store** | `PostgresCanonicalVideoRunStore` | Async get/list/latest/put/claim/cancel/edit/runnable operations against canonical records |
| **Durable projection** | `projectDurableVideoWorkflow` | Flatten canonical facts into the retained internal compatibility shape |
| **Public projection** | `projectVideoWorkflowPublic` + `packages/contracts/src/video-workflow.ts` | Cross-lane ids/status/shot summary with no provider, credential, route, or asset blobs |
| **Pure edits** | `applyCanonicalVideoEdit` | OCC-checked selection and shot ordering used by the production store |

```text
PostgresCanonicalVideoRunStore ──put/claim/cancel/edit──▶ generic Task / Job / Asset records
                                                        │
                                      projectDurable / projectPublic
                                                        ▼
                                   DurableVideoWorkflow / PublicProjection
```

**Invariant:** there is one production write authority. The historical
`model_video_workflows` and `model_canonical_video_runs` tables are read-only
compatibility inputs during startup backfill; production commands never fall
back to them.

## Field mapping (legacy input to canonical)

| Legacy `DurableVideoWorkflow` | Canonical |
| --- | --- |
| `id` | `runId` |
| `workspaceId` / `actorId` / `workId` | same |
| storyboard, catalog, data class, authoring settings, and ordered shots | `p1_content_tasks.payload` |
| status, confirmation, revision, execution facts, failure, timestamps | `p1_creative_jobs.payload` |
| each candidate/clip/composed owned asset | one `p1_creative_assets` row |
| `run_lease_token` | generic Job `payload.runLeaseToken` |

Migration and projection helpers:

- `liftDurableToCanonical(workflow)` imports a retained legacy row.
- `projectDurableVideoWorkflow(run)` builds the internal compatibility view.
- `projectVideoWorkflowPublic(run)` builds the cross-lane public view.

## PostgreSQL cutover and compatibility

1. Operations migrates the existing generic Task/Job/Asset tables first;
   `PostgresCanonicalVideoWorkflowSchema` refuses to manufacture a video table.
2. Startup migration imports missing rows from both historical tables.
3. After import, reads and every mutation target generic records only. Legacy
   rows remain unchanged as rollback evidence, never as runtime fallback.
4. Runtime entrypoints instantiate `PostgresCanonicalVideoRunStore` directly.
5. Dropping either legacy table remains a separate operational cleanup after
   retention and rollback windows expire.

## Recovery and public projection

- `claimRun` takes a lease and `assertRunnable` fences stale workers.
- Terminal and quality-review statuses release the lease.
- `requestCancel` is idempotent and persists cancellation before restart.
- `assertPublicProjectionIsSanitized` rejects public payloads containing
  provider, credential, route, attempt, or asset tokens.

Frontend `video-workflow-model` remains a pure UI model; public status aligns
with contracts rather than exposing Core persistence fields.
