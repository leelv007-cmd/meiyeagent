import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';

import {
  handOverAssistedReceipt,
  prepareAssistedMaterials,
} from './assisted-receipt.js';
import { PostgresAssistedReceiptRepository } from './assisted-receipt-repository.js';

const connectionString = process.env.TEST_DATABASE_URL;

function handedOverFixture(workspaceId: string, suffix: string) {
  const prepared = prepareAssistedMaterials({
    actorId: 'owner-1',
    id: `receipt-${suffix}`,
    occurredAt: '2026-07-20T00:00:00.000Z',
    packageId: `package-${suffix}`,
    workspaceId,
  });
  return handOverAssistedReceipt(prepared, {
    actorId: 'owner-1',
    occurredAt: '2026-07-20T00:01:00.000Z',
    linkToken: `handoff-token-${suffix}`,
    binding: {
      accountId: 'account-1',
      approvalReceiptId: `approval-${suffix}`,
      contentPackageRevision: 1,
      costRange: { currency: 'CNY', minAmount: 0, maxAmount: 20 },
      packageId: `package-${suffix}`,
      platform: 'xiaohongshu',
      purpose: 'publish_current_variant',
      responsibilityRole: 'self_publish',
      scheduledAt: '2026-07-20T00:05:00.000Z',
      variantVersionId: `version-${suffix}`,
      workspaceId,
    },
  });
}

test(
  'Postgres assisted receipt consume is atomic across concurrent callers',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const repository = new PostgresAssistedReceiptRepository(pool);
    const suffix = randomUUID();
    const workspaceId = `workspace-assisted-${suffix}`;
    const receipt = handedOverFixture(workspaceId, suffix);
    try {
      await repository.migrate();
      const stored = await repository.create(receipt);
      assert.equal(stored.revision, 0);

      const outcomes = await Promise.all([
        repository.consumeHandoffLink({
          now: '2026-07-20T00:02:00.000Z',
          token: receipt.handoffLink!.token,
          workspaceId,
        }),
        repository.consumeHandoffLink({
          now: '2026-07-20T00:02:00.000Z',
          token: receipt.handoffLink!.token,
          workspaceId,
        }),
      ]);

      assert.deepEqual(
        outcomes.map((outcome) => outcome.kind).sort(),
        ['ok', 'replay'],
      );
      const loaded = await repository.get(workspaceId, receipt.id);
      assert.equal(loaded?.revision, 1);
      assert.equal(loaded?.receipt.handoffLink?.consumedAt, '2026-07-20T00:02:00.000Z');
      assert.equal(
        loaded?.receipt.events.filter(
          (event) => event.type === 'handoff_link_consumed',
        ).length,
        1,
      );
    } finally {
      await pool.query(
        'DELETE FROM p1_assisted_receipts WHERE workspace_id = $1',
        [workspaceId],
      ).catch(() => undefined);
      await pool.end();
    }
  },
);

test(
  'Postgres assisted receipt link is workspace-scoped and expires without mutation',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const repository = new PostgresAssistedReceiptRepository(pool);
    const suffix = randomUUID();
    const workspaceId = `workspace-assisted-${suffix}`;
    const receipt = handedOverFixture(workspaceId, suffix);
    try {
      await repository.migrate();
      await repository.create(receipt);
      assert.deepEqual(
        await repository.consumeHandoffLink({
          now: '2026-07-20T00:02:00.000Z',
          token: receipt.handoffLink!.token,
          workspaceId: 'workspace-other',
        }),
        { kind: 'not_found' },
      );
      assert.deepEqual(
        await repository.consumeHandoffLink({
          now: '2026-07-24T00:02:00.000Z',
          token: receipt.handoffLink!.token,
          workspaceId,
        }),
        { kind: 'expired' },
      );
      const loaded = await repository.get(workspaceId, receipt.id);
      assert.equal(loaded?.revision, 0);
      assert.equal(loaded?.receipt.handoffLink?.consumedAt, undefined);
    } finally {
      await pool.query(
        'DELETE FROM p1_assisted_receipts WHERE workspace_id = $1',
        [workspaceId],
      ).catch(() => undefined);
      await pool.end();
    }
  },
);
