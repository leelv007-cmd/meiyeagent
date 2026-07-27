import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  FinalizeStoreIntakeCommand,
  StoreProfile,
} from '@meiye/contracts';

import type { P1Context } from '../foundation/domain.js';
import {
  AssetIntakeService,
  MemoryAssetIntakeRepository,
} from './asset-intake-service.js';
import { MemoryStoreFactLedger } from './store-fact-ledger.js';
import {
  StoreIntakeFinalizationError,
  StoreIntakeFinalizer,
  type StoreIntakeFinalizationRepository,
  type StoreProfileMergePort,
} from './store-intake-finalizer.js';

const now = '2026-07-27T10:00:00.000Z';
const context: P1Context = {
  actor: 'owner',
  correlationId: 'store-intake-finalizer-contract',
  userId: 'owner-a',
  workspaceId: 'workspace-a',
};

class MemoryFinalizationRepository
  implements StoreIntakeFinalizationRepository
{
  readonly statuses = new Map<
    string,
    'pending' | 'completed' | 'rejected' | 'needs_reconciliation'
  >();

  async withLock<T>(_workspaceId: string, _idempotencyKey: string, action: () => Promise<T>) {
    return action();
  }

  async begin(
    workspaceId: string,
    idempotencyKey: string,
    fingerprint: string,
  ) {
    const key = `${workspaceId}:${idempotencyKey}`;
    const status = this.statuses.get(key) ?? 'pending';
    this.statuses.set(key, status);
    return {
      error: null,
      fingerprint,
      result: null,
      status,
    };
  }

  async complete(
    workspaceId: string,
    idempotencyKey: string,
    _fingerprint: string,
    result: { facts: never[]; profileRevision: number },
  ) {
    this.statuses.set(`${workspaceId}:${idempotencyKey}`, 'completed');
    return result;
  }

  async reject(workspaceId: string, idempotencyKey: string) {
    this.statuses.set(`${workspaceId}:${idempotencyKey}`, 'rejected');
  }

  async markNeedsReconciliation(
    workspaceId: string,
    idempotencyKey: string,
  ) {
    this.statuses.set(
      `${workspaceId}:${idempotencyKey}`,
      'needs_reconciliation',
    );
  }
}

function projectBatch(): FinalizeStoreIntakeCommand['batch'] {
  return {
    batchId: 'batch-a',
    taskId: 'task-a',
    source: {
      sourceId: 'source-a',
      kind: 'manual',
      referenceId: 'source-a',
      capabilityStatus: 'verified',
      sourceWorkspaceId: context.workspaceId,
      capturedAt: now,
      example: false,
    },
    summary: 'User confirmed one store project.',
    candidates: [
      {
        candidateId: 'project-service',
        status: 'pending',
        objectKind: 'store_fact',
        fact: {
          kind: 'service',
          key: 'service.project-a.name',
          value: { name: '透亮猫眼' },
          scope: { storeId: context.workspaceId },
          source: {
            kind: 'user_confirmation',
            referenceId: 'source-a',
            capturedAt: now,
          },
          effectiveFrom: now,
          expiresAt: null,
        },
      },
      {
        candidateId: 'project-price',
        status: 'pending',
        objectKind: 'store_fact',
        fact: {
          kind: 'price',
          key: 'service.project-a.price',
          value: { amount: 299, currency: 'CNY' },
          scope: { storeId: context.workspaceId },
          source: {
            kind: 'user_confirmation',
            referenceId: 'source-a',
            capturedAt: now,
          },
          effectiveFrom: now,
          expiresAt: null,
        },
      },
    ],
  };
}

function projectInput(
  batch: FinalizeStoreIntakeCommand['batch'],
  profilePatch: NonNullable<FinalizeStoreIntakeCommand['profilePatch']>,
): FinalizeStoreIntakeCommand {
  return {
    batch,
    confirmations: [
      {
        candidateId: 'project-service',
        factId: 'store-project:project-a:service',
        expectedFactRevision: 0,
      },
      {
        candidateId: 'project-price',
        factId: 'store-project:project-a:price',
        expectedFactRevision: 0,
      },
    ],
    profilePatch,
  };
}

function profilePort(
  merge: StoreProfileMergePort['merge'],
): StoreProfileMergePort {
  return {
    completedRevision: async () => null,
    currentRevision: async () => 1,
    merge,
  };
}

test('rejects a project profile-only write before StoreFact append', async () => {
  const facts = new MemoryStoreFactLedger();
  const intake = new AssetIntakeService(
    new MemoryAssetIntakeRepository(),
    facts,
    () => now,
  );
  const finalizations = new MemoryFinalizationRepository();
  let mergeCalls = 0;
  const finalizer = new StoreIntakeFinalizer(
    intake,
    finalizations,
    profilePort(async () => {
      mergeCalls += 1;
      throw new Error('profile merge must not run');
    }),
  );
  const input = projectInput(projectBatch(), {
    expectedRevision: 1,
    projects: {
      upsert: [
        {
          id: 'project-a',
          name: '透亮猫眼',
          price: 999,
          durationMinutes: 90,
          confirmed: true,
        },
      ],
    },
  });
  input.confirmations = input.confirmations.filter(
    (confirmation) => confirmation.factId.endsWith(':service'),
  );

  await assert.rejects(
    finalizer.finalize(context, input, 'reject-profile-only'),
    (error) =>
      error instanceof StoreIntakeFinalizationError &&
      error.code === 'STORE_FACT_MAPPING_INVALID',
  );
  assert.equal(
    finalizations.statuses.get('workspace-a:reject-profile-only'),
    'rejected',
  );
  assert.equal(mergeCalls, 0);
  assert.deepEqual(
    await facts.history(context.workspaceId, 'store-project:project-a:service'),
    [],
  );
});

test('marks staged facts for reconciliation instead of leaving a pending outbox', async () => {
  const facts = new MemoryStoreFactLedger();
  const intake = new AssetIntakeService(
    new MemoryAssetIntakeRepository(),
    facts,
    () => now,
  );
  const finalizations = new MemoryFinalizationRepository();
  let mergeCalls = 0;
  const finalizer = new StoreIntakeFinalizer(
    intake,
    finalizations,
    profilePort(async (): Promise<StoreProfile> => {
      mergeCalls += 1;
      throw new Error('injected profile projection failure');
    }),
  );
  const input = projectInput(projectBatch(), {
    expectedRevision: 1,
    projects: {
      upsert: [
        {
          id: 'project-a',
          name: '透亮猫眼',
          price: 299,
          durationMinutes: 90,
          confirmed: true,
        },
      ],
    },
  });

  await assert.rejects(
    finalizer.finalize(context, input, 'needs-reconciliation'),
    /injected profile projection failure/,
  );
  assert.equal(
    finalizations.statuses.get('workspace-a:needs-reconciliation'),
    'needs_reconciliation',
  );
  assert.equal(
    (
      await facts.history(
        context.workspaceId,
        'store-project:project-a:service',
      )
    ).length,
    1,
  );
  assert.equal(
    (
      await facts.history(context.workspaceId, 'store-project:project-a:price')
    ).length,
    1,
  );

  await assert.rejects(
    finalizer.finalize(context, input, 'needs-reconciliation'),
    /injected profile projection failure/,
  );
  assert.equal(
    finalizations.statuses.get('workspace-a:needs-reconciliation'),
    'needs_reconciliation',
  );
  assert.equal(mergeCalls, 2);
});
