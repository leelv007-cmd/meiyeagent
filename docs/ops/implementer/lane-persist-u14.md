# lane-persist-u14

Branch: `agent/persist-u14`
Worktree: `/Users/bin/Desktop/开发/内容无人区/agent-worktrees/meiye-persist-u14`
SHA: `02b1462c24718b751c9909ad1781a5a9ffb36e04`

## Result

Assigned postgres files: **27 pass / 0 fail / 0 skip**.

| File | Count |
| --- | --- |
| `apps/core/src/p1/harness/delivery.postgres.test.ts` | 5 pass |
| `apps/core/src/p1/pending-actions-invariant.postgres.test.ts` | 2 pass |
| `apps/core/src/p1/harness/production-media-assembly.postgres.test.ts` | 2 pass |
| `apps/core/src/p1/harness/dbos-registration.smoke.test.ts` | 18 pass |

Command (from `apps/core`):

```bash
export TEST_DATABASE_URL=postgres://meiye:meiye@127.0.0.1:54329/meiye_lane_persist_u14
export TEST_DBOS_SYSTEM_DATABASE_URL=postgres://meiye:meiye@127.0.0.1:54329/meiye_lane_persist_u14_dbos
node --import tsx --test --test-concurrency=1 \
  src/p1/harness/delivery.postgres.test.ts \
  src/p1/pending-actions-invariant.postgres.test.ts \
  src/p1/harness/production-media-assembly.postgres.test.ts \
  src/p1/harness/dbos-registration.smoke.test.ts
```

Production U14 remains fail-closed: `LEGACY_DURABLE_REPLAY_ARCHIVE_SEALED === true`, `refuseUnarchivedLegacyDurableReplay` unchanged.

## How the snapshot is built

Happy-path fixtures use `apps/core/src/p1/harness/execution-plan-snapshot.testing.ts`:

1. `freezePolicyExemptPlan` fills frozen content (`schemaVersion` applied at build): `planId`, `planRevision`, `intentDeclaration`, `contextBundleRef`, `executionPlan` (canonical `copy|media|note` recipe), `deliverables`, `promptRevisionRefs`, `skillManifestRefs`, `routeRequirements`, `quoteRef`, `rightsRevisionRefs`, `factRevisionRefs`, `boundedExecution`, `harnessReleaseId`, `approvalBasis: 'policy_exempt_copy'`.
2. `freezeExecutionPlanContent` computes `snapshotHash` over hash-coverage fields.
3. `buildExecutionPlanSnapshot` parses `execution-plan-snapshot/v1`.

Not a stub `{ snapshotHash }`. Paid-media tests keep `policy_exempt_copy` so the media carrier confirmation gate still runs (`merchant_confirmed` would skip it).

Snapshot-less tests whose point is the archive keep `legacyTimeoutRequest` and assert `LEGACY_REPLAY_CLOSED_MESSAGE` (`/archived fail-closed \(U14\)/`).

## Residual risk

- Hold-layout child records a no-op `execution-plan-snapshot-verification` step 0 so parent `registerHarnessDbosWorkflow` recovery stays deterministic. Hash re-verify is replayed, not re-executed, on that fixture.
- Production-media assertions now match snapshot-consume (no intent/brief LLM child audits; title `按已确认方案生成门店活动图片`).
- Recommendation delivery test deletes leftover `p1_due_delivery_*` rows on the dedicated lane DB so `runOnce` is not inflated by prior runs.
- D-176 timeout path still uses system-default then renderer-unavailable, not in-place retry.
- Cluster B (`normalizeRequest` on incomplete snapshots) is out of this lane.
