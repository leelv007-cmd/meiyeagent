import assert from 'node:assert/strict';
import test from 'node:test';

import type { ReuseTaskSeed } from '@meiye/contracts';

import { P1DomainError } from '../foundation/domain.js';
import { ReuseTaskHarnessAdapter } from './reuse-task-harness-adapter.js';

const seed: ReuseTaskSeed = {
  assetId: 'series-a',
  assetRevision: 2,
  sourcePackageId: 'package-source',
  sourceVersionId: 'version-source',
  sourcePackageRevision: 4,
  assetRevisionId: 'series-a:2',
  fixedItemKeys: ['structure.opening', 'cta.booking'],
  variableSlotKeys: ['offer.price'],
};

test('reuse adapter submits a new Harness Task with current rights and no prior deliverable content', async () => {
  const requests: unknown[] = [];
  const adapter = new ReuseTaskHarnessAdapter(() => ({
    async submit(input) {
      requests.push(input);
      return { workflowId: input.taskId };
    },
  }));

  const result = await adapter.submit({
    context: {
      actor: 'owner',
      correlationId: 'correlation-a',
      userId: 'owner-a',
      workspaceId: 'workspace-a',
    },
    taskId: 'task-reuse',
    packageId: 'reuse-task-reuse',
    rawInput: '按当前价格续写。',
    workflowRevision: 3,
    assetIds: ['asset-current'],
    factScope: { storeId: 'store-a', serviceId: 'scalp-clean' },
    seed,
  });

  assert.deepEqual(result, { workflowId: 'task-reuse' });
  assert.deepEqual(requests, [
    {
      taskId: 'task-reuse',
      actorId: 'owner-a',
      workspaceId: 'workspace-a',
      packageId: 'reuse-task-reuse',
      expectedRevision: 0,
      workflowRevision: 3,
      rawInput: '按当前价格续写。',
      factScope: { storeId: 'store-a', serviceId: 'scalp-clean' },
      reuseSeed: seed,
      intent: {
        context: {
          workId: 'task-reuse',
          intent: '按当前价格续写。',
          sourceSummaries: [
            'Reusable AssetRevision: series-a:2',
            'Reusable structure keys: structure.opening, cta.booking',
            'Current variable slots: offer.price',
          ],
        },
        assetReferences: ['asset-current'],
      },
    },
  ]);
  const serialized = JSON.stringify(requests);
  for (const oldContent of [
    'old title',
    'old body',
    'old topic',
    'asset-source-old',
  ]) {
    assert.equal(serialized.includes(oldContent), false);
  }
});

test('reuse adapter fails closed when production Harness is unavailable', () => {
  const adapter = new ReuseTaskHarnessAdapter(() => undefined);
  assert.throws(
    () =>
      adapter.submit({
        context: {
          actor: 'owner',
          correlationId: 'correlation-a',
          userId: 'owner-a',
          workspaceId: 'workspace-a',
        },
        taskId: 'task-reuse',
        packageId: 'reuse-task-reuse',
        rawInput: '按当前价格续写。',
        workflowRevision: 3,
        assetIds: [],
        factScope: { storeId: 'store-a' },
        seed,
      }),
    (error: unknown) =>
      error instanceof P1DomainError && error.code === 'INVALID_STATE',
  );
});
