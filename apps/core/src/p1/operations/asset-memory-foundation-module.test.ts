import assert from 'node:assert/strict';
import test from 'node:test';
import { requiredP1Capability } from '@meiye/contracts';

import type { P1Context } from '../foundation/domain.js';
import { AssetMemoryFoundationModule } from './asset-memory-foundation-module.js';
import {
  AssetIntakeService,
  MemoryAssetIntakeRepository,
} from './asset-intake-service.js';
import { MemoryStoreFactLedger } from './store-fact-ledger.js';

const now = '2026-07-18T06:00:00.000Z';
const context: P1Context = {
  actor: 'owner',
  correlationId: 'correlation-a',
  userId: 'owner-a',
  workspaceId: 'workspace-a',
};

test('asset-memory keeps direct fact confirmation as a trusted kernel seam', async () => {
  const intake = new AssetIntakeService(
    new MemoryAssetIntakeRepository(),
    new MemoryStoreFactLedger(),
    () => now,
  );
  await intake.recordBatch({
    batchId: 'batch-a',
    workspaceId: context.workspaceId,
    taskId: 'task-a',
    source: {
      sourceId: 'source-a',
      kind: 'manual',
      referenceId: 'upload-a',
      capabilityStatus: 'assisted',
      sourceWorkspaceId: context.workspaceId,
      capturedAt: now,
      example: false,
    },
    summary: '识别到一个待确认项目价格。',
    candidates: [
      {
        candidateId: 'candidate-price',
        objectKind: 'store_fact',
        status: 'pending',
        fact: {
          kind: 'price',
          key: 'offer.price',
          value: { amount: 299, currency: 'CNY' },
          scope: { storeId: 'store-a' },
          source: {
            kind: 'user_confirmation',
            referenceId: 'upload-a',
            capturedAt: now,
          },
          effectiveFrom: now,
          expiresAt: null,
        },
      },
    ],
    createdAt: now,
  });

  const module = new AssetMemoryFoundationModule(intake);
  const fact = await module.execute({
    context,
    idempotencyKey: 'confirm-price',
    input: {
      action: 'confirm_asset_intake_fact',
      payload: {
        batchId: 'batch-a',
        candidateId: 'candidate-price',
        factId: 'fact-price',
        expectedFactRevision: 0,
      },
    },
  });

  assert.deepEqual((fact as { value: unknown }).value, {
    amount: 299,
    currency: 'CNY',
  });
});

test('asset-memory denies and rejects all 21 retired public seams', async () => {
  const module = new AssetMemoryFoundationModule(
    new AssetIntakeService(
      new MemoryAssetIntakeRepository(),
      new MemoryStoreFactLedger(),
      () => now,
    ),
  );

  const commands = [
    'parse_asset_batch',
    'promote_asset_draft',
    'record_asset_intake_batch',
    'correct_asset_intake_fact',
    'reject_asset_intake_candidate',
    'propose_reusable_asset',
    'confirm_reusable_asset',
    'deactivate_series',
    'create_reuse_task',
    'record_preference_signal',
    'propose_preference',
    'confirm_preference',
    'revoke_preference',
  ] as const;
  const queries = [
    'parse_task_view',
    'asset_draft_view',
    'asset_intake_view',
    'asset_intake_missing_fact_keys',
    'reusable_asset_view',
    'reuse_task_seed',
    'series_suggestions',
    'preference_view',
  ] as const;

  for (const action of commands) {
    assert.equal(requiredP1Capability('command', 'asset-memory', action), null);
    await assert.rejects(
      module.execute({
        context,
        idempotencyKey: `retired-${action}`,
        input: { action, payload: {} },
      }),
      new RegExp(`Unknown asset-memory command ${action}`, 'u'),
    );
  }
  for (const action of queries) {
    assert.equal(requiredP1Capability('query', 'asset-memory', action), null);
    await assert.rejects(
      module.query({ context, input: { action, payload: {} } }),
      new RegExp(`Unknown asset-memory query ${action}`, 'u'),
    );
  }
});
