/**
 * RET-06 / U14: snapshot-less durable replay is archived fail-closed.
 *
 * NODE-only. Does not DROP tables, delete `legacy*` history islands, or
 * require production 30d/audit/rollback proofs. Empty fixture inventory is
 * the allow-archive path and must not throw.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildContentPackage } from '../operations/content-package.js';
import { MemoryModelSupplyControlPlaneRepository } from '../model-supply/foundation-module.js';
import type { ModelSupplyResult } from '../model-supply/ledger-contracts.js';
import {
  evaluateLegacyReplayCodeArchiveGate,
  MemoryLegacyReplayInventory,
  U14_REMAINING_OPS_PROOFS,
} from '../ops-console/legacy-replay-archive-gate.js';
import {
  LEGACY_DURABLE_REPLAY_ARCHIVE_SEALED,
  LEGACY_REPLAY_CLOSED_MESSAGE,
  isUnarchivedLegacyDurableReplay,
  refuseUnarchivedLegacyDurableReplay,
} from './legacy-replay-admission-seal.js';
import { HarnessTaskAdmissionService } from './task-admission.js';
import type { HarnessTaskRequestRegistry } from './task-admission.js';

test('U14 code archive is sealed and remaining ops proofs are named', () => {
  assert.equal(LEGACY_DURABLE_REPLAY_ARCHIVE_SEALED, true);
  assert.equal(U14_REMAINING_OPS_PROOFS.length, 3);
  assert.ok(
    U14_REMAINING_OPS_PROOFS.some((proof) => proof.includes('30d')),
  );
});

test('U14 code gate allows archive on empty inventory and does not throw', () => {
  const empty = {
    activePendingCount: 0,
    oldestActiveCreatedAt: null,
    sampleTaskIds: [] as string[],
    lastLegacyTerminalAt: null,
  };
  const result = evaluateLegacyReplayCodeArchiveGate(empty);
  assert.equal(result.archiveAllowed, true);
  assert.deepEqual(result.blockingReasons, []);
  assert.doesNotThrow(() => evaluateLegacyReplayCodeArchiveGate(empty));
});

test('U14 code gate fails closed when inventory is non-zero', () => {
  const result = evaluateLegacyReplayCodeArchiveGate({
    activePendingCount: 2,
  });
  assert.equal(result.archiveAllowed, false);
  assert.ok(result.blockingReasons[0]?.includes('2'));
});

test('U14 code gate fails closed on non-finite inventory without throwing', () => {
  for (const count of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
    const result = evaluateLegacyReplayCodeArchiveGate({
      activePendingCount: count,
    });
    assert.equal(result.archiveAllowed, false);
  }
});

test('MemoryLegacyReplayInventory empty snapshot does not throw for the code gate', async () => {
  const inventory = new MemoryLegacyReplayInventory({
    activePendingCount: 0,
    oldestActiveCreatedAt: null,
    sampleTaskIds: [],
    lastLegacyTerminalAt: null,
  });
  const snapshot = await inventory.snapshot();
  assert.equal(
    evaluateLegacyReplayCodeArchiveGate(snapshot).archiveAllowed,
    true,
  );
});

test('attempting a new snapshot-less durable replay after U14 archive fails closed', () => {
  assert.equal(isUnarchivedLegacyDurableReplay({}), true);
  assert.throws(
    () => refuseUnarchivedLegacyDurableReplay({}),
    (error: unknown) =>
      error instanceof Error && error.message === LEGACY_REPLAY_CLOSED_MESSAGE,
  );
});

test('attempting an old snapshot-less durable replay after U14 archive fails closed', () => {
  const storedLegacyRequest = {
    actorId: 'owner-1',
    workspaceId: 'workspace-1',
    packageId: 'package-historical',
    expectedRevision: 1,
    workflowRevision: 1,
    creationMode: 'customized' as const,
    rawInput: '历史任务',
    intent: {
      context: {
        workId: 'work-historical',
        intent: '历史任务',
        sourceSummaries: [],
      },
      assetReferences: [],
    },
  };
  assert.throws(
    () => refuseUnarchivedLegacyDurableReplay(storedLegacyRequest),
    (error: unknown) =>
      error instanceof Error && error.message === LEGACY_REPLAY_CLOSED_MESSAGE,
  );
});

test('admitted snapshot and pending confirmation requests are not the archived branch', () => {
  refuseUnarchivedLegacyDurableReplay({
    executionPlanSnapshot: { snapshotHash: 'admitted-hash' },
  });
  refuseUnarchivedLegacyDurableReplay({
    pendingExecutionPlanSnapshot: { snapshotHash: 'pending-hash' },
  });
  assert.equal(
    isUnarchivedLegacyDurableReplay({
      executionPlanSnapshot: { snapshotHash: 'admitted-hash' },
    }),
    false,
  );
});

test('sealed admission registry refuses new and replayed snapshot-less claims', async () => {
  const tasks = new Map<
    string,
    { fingerprint: string; request: Record<string, unknown> }
  >();
  const registry: HarnessTaskRequestRegistry = {
    async lookup(input) {
      const existing = tasks.get(input.taskId);
      if (!existing) return null;
      refuseUnarchivedLegacyDurableReplay(existing.request);
      return existing.fingerprint === input.fingerprint
        ? {
            kind: 'existing' as const,
            workflowId: input.taskId,
            request: existing.request as never,
          }
        : { kind: 'conflict' as const };
    },
    async claim(input) {
      refuseUnarchivedLegacyDurableReplay(input.request);
      tasks.set(input.taskId, {
        fingerprint: input.fingerprint,
        request: structuredClone(input.request) as unknown as Record<
          string,
          unknown
        >,
      });
      return { kind: 'created' as const };
    },
  };
  const service = new HarnessTaskAdmissionService(registry, {
    async start(input) {
      return { workflowId: input.workflowId };
    },
  });
  const submission = {
    taskId: 'task-u14-legacy',
    actorId: 'owner-1',
    workspaceId: 'workspace-1',
    packageId: 'package-1',
    expectedRevision: 2,
    workflowRevision: 4,
    creationMode: 'customized' as const,
    rawInput: '把新团购做一套能发的',
    intent: {
      context: {
        workId: 'work-1',
        intent: '把新团购做一套能发的',
        sourceSummaries: [],
      },
      assetReferences: [],
    },
  };

  await assert.rejects(
    service.submit(submission),
    (error: unknown) =>
      error instanceof Error && error.message === LEGACY_REPLAY_CLOSED_MESSAGE,
  );
  assert.equal(tasks.size, 0);
});

test('historical ContentPackage read still works after U14 archive seal', () => {
  refuseUnarchivedLegacyDurableReplay({
    executionPlanSnapshot: { snapshotHash: 'history-island' },
  });
  const historical = buildContentPackage({
    id: 'pkg-u14-history',
    kind: 'image_text',
    source: {
      assetIds: ['asset-historical'],
      workflowId: 'legacy-durable-workflow-1',
    },
    timestamp: '2026-06-01T00:00:00.000Z',
    workspaceId: 'workspace-1',
  });
  const island = new Map([[historical.id, historical]]);
  const read = island.get('pkg-u14-history');
  assert.ok(read);
  assert.equal(read.kind, 'image_text');
  assert.equal(read.source.workflowId, 'legacy-durable-workflow-1');
  assert.equal(read.workspaceId, 'workspace-1');
});

test('jobs/history reader still lists historical packages after U14 archive seal', async () => {
  const repository = new MemoryModelSupplyControlPlaneRepository();
  const historical: ModelSupplyResult = {
    jobId: 'job-u14-history',
    operation: 'copy.generate',
    status: 'completed',
    snapshot: {
      id: 'snapshot:job-u14-history',
      catalogRevisionId: 'catalog:r1',
      requestedSelection: { mode: 'fixed' },
      candidateCatalogModelIds: ['model-copy'],
      actualCatalogModelId: 'model-copy',
      deploymentId: 'deployment-copy-a',
      policyRevision: 'policy:r1',
      priceRevision: 'price:r1',
      credentialMode: 'platform',
      credentialVersion: 'credential:r1',
      fallbackConsent: false,
      reason: 'fixed_selection',
      dataClass: [],
      createdAt: '2026-06-01T00:00:00.000Z',
    },
    attempt: {
      id: 'attempt:job-u14-history',
      jobId: 'job-u14-history',
      catalogModelId: 'model-copy',
      deploymentId: 'deployment-copy-a',
      acceptance: 'accepted',
      status: 'completed',
      createdAt: '2026-06-01T00:00:00.000Z',
    },
    attempts: [
      {
        id: 'attempt:job-u14-history',
        jobId: 'job-u14-history',
        catalogModelId: 'model-copy',
        deploymentId: 'deployment-copy-a',
        acceptance: 'accepted',
        status: 'completed',
        createdAt: '2026-06-01T00:00:00.000Z',
      },
    ],
    usage: {
      id: 'usage:job-u14-history',
      status: 'committed',
      quantity: 1,
    },
    providerCost: {
      id: 'cost:job-u14-history',
      status: 'observed',
      amount: 0.01,
      currency: 'CNY',
      usage: {},
    },
    providerCosts: [],
  };
  await repository.saveResult('workspace-1', historical);
  const page = await repository.listJobs('workspace-1', {
    page: 1,
    pageSize: 10,
    sort: 'startedAt',
    dir: 'desc',
  });
  assert.equal(page.total, 1);
  assert.equal(page.items[0]?.jobId, 'job-u14-history');
});
