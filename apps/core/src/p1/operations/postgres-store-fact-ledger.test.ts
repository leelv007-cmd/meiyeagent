import assert from 'node:assert/strict';
import test from 'node:test';
import { Pool } from 'pg';
import { PostgresStoreFactLedger } from './postgres-store-fact-ledger.js';
import { StoreFactRevisionConflictError } from './store-fact-ledger.js';

const connectionString = process.env.TEST_DATABASE_URL;

test(
  'Postgres fact ledger persists immutable scoped revisions and expiry semantics',
  { skip: !connectionString },
  async () => {
    const pool = new Pool({ connectionString });
    const ledger = new PostgresStoreFactLedger(pool);
    const workspaceId = `context-facts-${Date.now()}`;
    await ledger.migrate();
    try {
      const input = {
        factId: 'offer-price',
        workspaceId,
        kind: 'price' as const,
        key: 'offer.price',
        value: { amount: 199, currency: 'CNY' },
        scope: { storeId: 'store-a', serviceId: 'service-a' },
        source: {
          kind: 'screenshot_extraction' as const,
          referenceId: 'price-list-asset',
          capturedAt: '2026-07-18T01:00:00.000Z',
        },
        effectiveFrom: '2026-07-18T01:00:00.000Z',
        expiresAt: null,
        recordedAt: '2026-07-18T01:00:00.000Z',
        recordedBy: 'owner-a',
      };
      await ledger.append({ ...input, expectedRevision: 0 });
      await ledger.append({
        ...input,
        value: { amount: 239, currency: 'CNY' },
        effectiveFrom: '2026-07-19T01:00:00.000Z',
        expiresAt: '2026-07-20T01:00:00.000Z',
        expectedRevision: 1,
      });
      assert.equal(await ledger.currentRevision(workspaceId), 2);

      const beforeChange = await ledger.listActive({
        workspaceId,
        scope: { storeId: 'store-a', serviceId: 'service-a' },
        at: '2026-07-18T12:00:00.000Z',
      });
      assert.equal(beforeChange[0]?.revision, 1);
      const afterChange = await ledger.listActive({
        workspaceId,
        scope: { storeId: 'store-a', serviceId: 'service-a' },
        at: '2026-07-19T12:00:00.000Z',
      });
      assert.equal(afterChange[0]?.revision, 2);
      assert.deepEqual(
        await ledger.listActive({
          workspaceId,
          scope: { storeId: 'store-a', serviceId: 'service-a' },
          at: '2026-07-20T01:00:00.000Z',
        }),
        [],
      );
      assert.deepEqual(
        (await ledger.history(workspaceId, input.factId)).map(
          (fact) => fact.revision,
        ),
        [1, 2],
      );
      await assert.rejects(
        ledger.append({ ...input, expectedRevision: 1 }),
        StoreFactRevisionConflictError,
      );
      await ledger.append({
        ...input,
        factId: 'moving-offer',
        expiresAt: null,
        expectedRevision: 0,
      });
      await ledger.append({
        ...input,
        factId: 'moving-offer',
        scope: { storeId: 'store-b', serviceId: 'service-a' },
        effectiveFrom: '2026-07-19T01:00:00.000Z',
        expiresAt: null,
        expectedRevision: 1,
      });
      assert.deepEqual(
        (
          await ledger.listActive({
            workspaceId,
            scope: { storeId: 'store-a', serviceId: 'service-a' },
            at: '2026-07-21T01:00:00.000Z',
          })
        ).filter((fact) => fact.factId === 'moving-offer'),
        [],
      );
      await ledger.append({
        ...input,
        factId: 'revoked-offer',
        expectedRevision: 0,
      });
      await ledger.append({
        ...input,
        factId: 'revoked-offer',
        value: null,
        revisionKind: 'revocation',
        source: { ...input.source, referenceId: 'revocation-confirmation' },
        effectiveFrom: '2026-07-19T01:00:00.000Z',
        recordedAt: '2026-07-19T01:00:00.000Z',
        expectedRevision: 1,
      });
      assert.deepEqual(
        (
          await ledger.listActive({
            workspaceId,
            scope: { storeId: 'store-a', serviceId: 'service-a' },
            at: '2026-07-19T02:00:00.000Z',
          })
        ).filter((fact) => fact.factId === 'revoked-offer'),
        [],
      );
    } finally {
      await ledger.deleteWorkspaceForTest(workspaceId);
      await pool.end();
    }
  },
);

test(
  'Postgres fact ledger reads only legacy promotion window candidate heads',
  { skip: !connectionString },
  async () => {
    const pool = new Pool({ connectionString });
    const ledger = new PostgresStoreFactLedger(pool);
    const workspaceId = `legacy-promotion-candidates-${Date.now()}`;
    const otherWorkspaceId = `${workspaceId}-other`;
    const source = {
      kind: 'import' as const,
      referenceId: 'legacy-profile',
      capturedAt: '2026-07-18T01:00:00.000Z',
    };
    const baseInput = {
      workspaceId,
      kind: 'discount' as const,
      key: 'service.promotion',
      value: { amount: 199, currency: 'CNY' },
      scope: { storeId: 'store-a', serviceId: 'service-a' },
      source,
      effectiveFrom: '2026-07-18T01:00:00.000Z',
      expiresAt: null,
      recordedAt: '2026-07-18T01:00:00.000Z',
      recordedBy: 'owner-a',
    };
    await ledger.migrate();
    try {
      for (const input of [
        { factId: 'missing-discount-window', kind: 'discount' as const },
        { factId: 'missing-group-buy-window', kind: 'group_buy' as const },
        { factId: 'open-ended-standard-price', kind: 'price' as const },
        {
          factId: 'windowed-discount',
          kind: 'discount' as const,
          expiresAt: '2026-07-20T01:00:00.000Z',
        },
        {
          factId: 'other-store-discount',
          kind: 'discount' as const,
          scope: { storeId: 'store-b', serviceId: 'service-a' },
        },
        {
          factId: 'other-workspace-discount',
          workspaceId: otherWorkspaceId,
          kind: 'discount' as const,
        },
      ]) {
        await ledger.append({
          ...baseInput,
          ...input,
          expectedRevision: 0,
        });
      }
      await ledger.append({
        ...baseInput,
        factId: 'superseded-discount',
        expectedRevision: 0,
      });
      await ledger.append({
        ...baseInput,
        factId: 'superseded-discount',
        expiresAt: '2026-07-20T01:00:00.000Z',
        expectedRevision: 1,
      });
      await ledger.append({
        ...baseInput,
        factId: 'revoked-group-buy',
        kind: 'group_buy',
        expectedRevision: 0,
      });
      await ledger.append({
        ...baseInput,
        factId: 'revoked-group-buy',
        kind: 'group_buy',
        value: null,
        revisionKind: 'revocation',
        source: { ...source, referenceId: 'revocation-confirmation' },
        expectedRevision: 1,
      });

      assert.deepEqual(
        (
          await ledger.listLegacyPromotionWindowCandidates({
            workspaceId,
            scope: { storeId: 'store-a', serviceId: 'service-a' },
          })
        ).map((fact) => fact.factId),
        ['missing-discount-window', 'missing-group-buy-window'],
      );
    } finally {
      await ledger.deleteWorkspaceForTest(workspaceId);
      await ledger.deleteWorkspaceForTest(otherWorkspaceId);
      await pool.end();
    }
  },
);
