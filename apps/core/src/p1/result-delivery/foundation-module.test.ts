import assert from 'node:assert/strict';
import test from 'node:test';

import { AssistedReceiptService } from './assisted-receipt-service.js';
import { MemoryAssistedReceiptRepository } from './assisted-receipt-repository.js';
import { ResultDeliveryFoundationModule } from './foundation-module.js';
import { ResultDeliveryProjectionService } from './result-delivery-projection-service.js';

const context = {
  workspaceId: 'ws-1',
  userId: 'owner-1',
  correlationId: 'corr-1',
} as const;

function moduleFixture() {
  return new ResultDeliveryFoundationModule(
    {
      async firstAdopt() {
        throw new Error('not used');
      },
      async reviseContentPackageVisuals() {
        throw new Error('not used');
      },
    },
    {
      assistedReceipts: new AssistedReceiptService(
        new MemoryAssistedReceiptRepository(),
      ),
      projections: new ResultDeliveryProjectionService({
        async hasMembership(userId, workspaceId) {
          return userId === 'owner-1' && workspaceId === 'ws-1';
        },
        async loadWorkspace() {
          return {
            workspaceId: 'ws-1',
            creativeWorks: [],
            creativeJobs: [],
            contentPackages: [],
            tasks: [],
          } as never;
        },
      }),
    },
  );
}

async function command(
  module: ResultDeliveryFoundationModule,
  action: string,
  payload: Record<string, unknown>,
) {
  return module.execute({
    context,
    idempotencyKey: `key-${action}`,
    input: { action, payload },
  });
}

test('public result-delivery seam persists and atomically consumes assisted handoff', async () => {
  const module = moduleFixture();
  const prepared = (await command(module, 'assisted_prepare', {
    contentPackageRevision: 1,
    exportReceiptId: 'export-1',
    id: 'receipt-1',
    packageId: 'package-1',
    occurredAt: '2026-07-20T00:00:00.000Z',
    platform: 'xiaohongshu',
    variantVersionId: 'version-1',
  })) as { revision: number };
  assert.equal(prepared.revision, 0);

  const handedOver = (await command(module, 'assisted_hand_over', {
    receiptId: 'receipt-1',
    expectedRevision: 0,
    occurredAt: '2026-07-20T00:01:00.000Z',
    linkToken: 'handoff-token-0000000001',
    binding: {
      accountId: 'account-1',
      approvalReceiptId: 'approval-1',
      contentPackageRevision: 1,
      costRange: { currency: 'CNY', minAmount: 0, maxAmount: 10 },
      packageId: 'package-1',
      platform: 'xiaohongshu',
      purpose: 'publish_current_variant',
      responsibilityRole: 'self_publish',
      scheduledAt: '2026-07-20T00:05:00.000Z',
      variantVersionId: 'version-1',
      workspaceId: 'ws-1',
    },
  })) as { revision: number; receipt: { status: string } };
  assert.equal(handedOver.revision, 1);
  assert.equal(handedOver.receipt.status, 'handed_over');

  const [first, replay] = (await Promise.all([
    command(module, 'assisted_consume_handoff', {
      token: 'handoff-token-0000000001',
      now: '2026-07-20T00:02:00.000Z',
    }),
    command(module, 'assisted_consume_handoff', {
      token: 'handoff-token-0000000001',
      now: '2026-07-20T00:02:00.000Z',
    }),
  ])) as Array<{ kind: string }>;
  assert.deepEqual([first!.kind, replay!.kind].sort(), ['consumed', 'ok']);
  const consumed = first?.kind === 'consumed' ? first : replay;
  assert.deepEqual(consumed, { kind: 'consumed' });

  const loaded = (await module.query({
    context,
    input: {
      action: 'assisted_get',
      payload: { receiptId: 'receipt-1' },
    },
  })) as { revision: number; receipt: { handoffLink?: { consumedAt?: string } } };
  assert.equal(loaded.revision, 2);
  assert.equal(
    loaded.receipt.handoffLink?.consumedAt,
    '2026-07-20T00:02:00.000Z',
  );
});

test('public result-delivery queries expose resolver, Recent and actionable inbox', async () => {
  const module = moduleFixture();
  const resolved = (await module.query({
    context,
    input: {
      action: 'result_target_resolve',
      payload: { target: { workId: 'missing-work' } },
    },
  })) as { kind: string };
  assert.equal(resolved.kind, 'not_found');

  assert.deepEqual(
    await module.query({
      context,
      input: { action: 'recent_list', payload: { viewport: 'mobile' } },
    }),
    [],
  );
  assert.deepEqual(
    await module.query({
      context,
      input: { action: 'actionable_inbox', payload: {} },
    }),
    [],
  );
});
