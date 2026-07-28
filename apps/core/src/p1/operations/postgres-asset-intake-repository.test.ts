import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import {
  AssetIntakeError,
  AssetIntakeService,
} from './asset-intake-service.js';
import { PostgresAssetIntakeRepository } from './postgres-asset-intake-repository.js';
import { PostgresStoreFactLedger } from './postgres-store-fact-ledger.js';

test(
  'Postgres asset intake persists batches and replays confirmation after repository replacement',
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    const repository = new PostgresAssetIntakeRepository(pool);
    const ledger = new PostgresStoreFactLedger(pool);
    const workspaceId = `asset-intake-${randomUUID()}`;
    await repository.migrate();
    await ledger.migrate();
    try {
      const service = new AssetIntakeService(
        repository,
        ledger,
        () => '2026-07-18T02:00:00.000Z',
      );
      const assistedBatch = {
        batchId: 'batch-assisted-recovery',
        workspaceId,
        taskId: 'task-assisted-recovery',
        source: {
          sourceId: 'assisted-source:batch-assisted-recovery',
          kind: 'pasted_text' as const,
          referenceId: 'assisted-paste_text:batch-assisted-recovery',
          capabilityStatus: 'assisted' as const,
          sourceWorkspaceId: workspaceId,
          capturedAt: '2026-07-18T02:00:00.000Z',
          example: false,
        },
        summary: 'Current price candidate: CNY 239',
        candidates: [
          {
            candidateId: 'candidate-assisted-recovery',
            objectKind: 'store_fact' as const,
            status: 'pending' as const,
            fact: {
              kind: 'price' as const,
              key: 'service.scalp-clean.price',
              value: { amount: 239, currency: 'CNY' },
              scope: { storeId: 'store-a', serviceId: 'scalp-clean' },
              source: {
                kind: 'user_confirmation' as const,
                referenceId: 'assisted-paste_text:batch-assisted-recovery',
                capturedAt: '2026-07-18T02:00:00.000Z',
              },
              effectiveFrom: '2026-07-18T01:00:00.000Z',
              expiresAt: null,
            },
          },
        ],
        createdAt: '2026-07-18T02:00:00.000Z',
      };
      const assisted = await service.recordBatch(assistedBatch, 'fingerprint-a');
      const assistedReplay = await new AssetIntakeService(
        new PostgresAssetIntakeRepository(pool),
        new PostgresStoreFactLedger(pool),
        () => '2026-07-18T03:00:00.000Z',
      ).recordBatch(assistedBatch, 'fingerprint-a');
      assert.deepEqual(assistedReplay, assisted);
      await assert.rejects(
        new AssetIntakeService(
          new PostgresAssetIntakeRepository(pool),
          new PostgresStoreFactLedger(pool),
          () => '2026-07-18T04:00:00.000Z',
        ).recordBatch(assistedBatch, 'fingerprint-b'),
        (error: unknown) =>
          error instanceof AssetIntakeError && error.code === 'BATCH_CONFLICT',
      );
      await service.recordBatch({
        batchId: 'batch-a',
        workspaceId,
        taskId: 'task-a',
        source: {
          sourceId: 'source-a',
          kind: 'price_list',
          referenceId: 'upload-a',
          capabilityStatus: 'assisted',
          sourceWorkspaceId: workspaceId,
          capturedAt: '2026-07-18T01:00:00.000Z',
          example: false,
        },
        summary: '识别到一个价格。',
        candidates: [
          {
            candidateId: 'candidate-price',
            objectKind: 'store_fact',
            status: 'pending',
            fact: {
              kind: 'price',
              key: 'service.price',
              value: 239,
              scope: { storeId: 'store-a' },
              source: {
                kind: 'screenshot_extraction',
                referenceId: 'upload-a',
                capturedAt: '2026-07-18T01:00:00.000Z',
              },
              effectiveFrom: '2026-07-18T01:00:00.000Z',
              expiresAt: null,
            },
          },
        ],
        createdAt: '2026-07-18T01:00:01.000Z',
      });
      const first = await service.confirmFact(
        { workspaceId, userId: 'owner-a' },
        {
          batchId: 'batch-a',
          candidateId: 'candidate-price',
          factId: 'fact-price',
          expectedFactRevision: 0,
          idempotencyKey: 'confirm-price',
        },
      );
      const restarted = new AssetIntakeService(
        new PostgresAssetIntakeRepository(pool),
        new PostgresStoreFactLedger(pool),
      );
      const replay = await restarted.confirmFact(
        { workspaceId, userId: 'owner-a' },
        {
          batchId: 'batch-a',
          candidateId: 'candidate-price',
          factId: 'fact-price',
          expectedFactRevision: 0,
          idempotencyKey: 'confirm-price',
        },
      );
      assert.deepEqual(replay, first);
      await assert.rejects(
        restarted.confirmFact(
          { workspaceId, userId: 'owner-a' },
          {
            batchId: 'batch-a',
            candidateId: 'candidate-price',
            factId: 'fact-price',
            expectedFactRevision: 0,
            idempotencyKey: 'confirm-price-competing',
          },
        ),
        (error: unknown) =>
          error instanceof AssetIntakeError &&
          error.code === 'DECISION_CONFLICT',
      );
      assert.equal(
        (await ledger.history(workspaceId, 'fact-price')).length,
        1,
      );
      await service.recordBatch({
        batchId: 'batch-concurrent',
        workspaceId,
        taskId: 'task-concurrent',
        source: {
          sourceId: 'source-concurrent',
          kind: 'price_list',
          referenceId: 'upload-concurrent',
          capabilityStatus: 'assisted',
          sourceWorkspaceId: workspaceId,
          capturedAt: '2026-07-18T01:00:00.000Z',
          example: false,
        },
        summary: '并发确认测试。',
        candidates: [
          {
            candidateId: 'candidate-concurrent',
            objectKind: 'store_fact',
            status: 'pending',
            fact: {
              kind: 'price',
              key: 'service.concurrent.price',
              value: 299,
              scope: { storeId: 'store-a' },
              source: {
                kind: 'screenshot_extraction',
                referenceId: 'upload-concurrent',
                capturedAt: '2026-07-18T01:00:00.000Z',
              },
              effectiveFrom: '2026-07-18T01:00:00.000Z',
              expiresAt: null,
            },
          },
        ],
        createdAt: '2026-07-18T01:00:01.000Z',
      });
      const concurrent = await Promise.allSettled(
        ['a', 'b'].map((suffix) =>
          service.confirmFact(
            { workspaceId, userId: 'owner-a' },
            {
              batchId: 'batch-concurrent',
              candidateId: 'candidate-concurrent',
              factId: `fact-concurrent-${suffix}`,
              expectedFactRevision: 0,
              idempotencyKey: `confirm-concurrent-${suffix}`,
            },
          ),
        ),
      );
      assert.deepEqual(
        concurrent.map((result) => result.status).sort(),
        ['fulfilled', 'rejected'],
      );
      const rejected = concurrent.find(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected',
      );
      assert.equal(rejected?.reason instanceof AssetIntakeError, true);
      const raceSource = await repository.getBatch(
        workspaceId,
        'batch-concurrent',
      );
      assert.ok(raceSource);
      await service.recordBatch({
        ...raceSource,
        batchId: 'batch-correction-race',
        taskId: 'task-correction-race',
        candidates: raceSource.candidates.map((candidate) => ({
          ...candidate,
          candidateId: 'candidate-correction-race',
        })),
      });
      const correctionRace = await Promise.allSettled([
        service.correctFact(
          { workspaceId, userId: 'owner-a' },
          {
            batchId: 'batch-correction-race',
            candidateId: 'candidate-correction-race',
            correctedFact: {
              kind: 'price',
              key: 'service.concurrent.price',
              value: 399,
              scope: { storeId: 'store-a' },
              source: {
                kind: 'user_confirmation',
                referenceId: 'decision-correction-race',
                capturedAt: '2026-07-18T02:00:00.000Z',
              },
              effectiveFrom: '2026-07-18T02:00:00.000Z',
              expiresAt: null,
            },
            idempotencyKey: 'correction-race-correct',
          },
        ),
        service.confirmFact(
          { workspaceId, userId: 'owner-a' },
          {
            batchId: 'batch-correction-race',
            candidateId: 'candidate-correction-race',
            factId: 'fact-correction-race',
            expectedFactRevision: 0,
            idempotencyKey: 'correction-race-confirm',
          },
        ),
      ]);
      assert.deepEqual(
        correctionRace.map((result) => result.status).sort(),
        ['fulfilled', 'rejected'],
      );
      await service.recordBatch({
        ...raceSource,
        batchId: 'batch-stale-recovery',
        taskId: 'task-stale-recovery',
        candidates: raceSource.candidates.map((candidate) => ({
          ...candidate,
          candidateId: 'candidate-stale-recovery',
        })),
      });
      await ledger.append({
        factId: 'fact-stale-recovery',
        workspaceId,
        kind: 'price',
        key: 'service.concurrent.price',
        value: 199,
        scope: { storeId: 'store-a' },
        source: {
          kind: 'user_confirmation',
          referenceId: 'older-stale-fact',
          capturedAt: '2026-07-18T00:00:00.000Z',
        },
        effectiveFrom: '2026-07-18T00:00:00.000Z',
        expiresAt: null,
        recordedAt: '2026-07-18T00:00:00.000Z',
        recordedBy: 'owner-a',
        expectedRevision: 0,
      });
      await assert.rejects(
        service.confirmFact(
          { workspaceId, userId: 'owner-a' },
          {
            batchId: 'batch-stale-recovery',
            candidateId: 'candidate-stale-recovery',
            factId: 'fact-stale-recovery',
            expectedFactRevision: 0,
            idempotencyKey: 'stale-recovery-first',
          },
        ),
        /expected revision 0, current revision is 1/,
      );
      await service.correctFact(
        { workspaceId, userId: 'owner-a' },
        {
          batchId: 'batch-stale-recovery',
          candidateId: 'candidate-stale-recovery',
          correctedFact: {
            kind: 'price',
            key: 'service.concurrent.price',
            value: 399,
            scope: { storeId: 'store-a' },
            source: {
              kind: 'user_confirmation',
              referenceId: 'stale-recovery-correction',
              capturedAt: '2026-07-18T02:00:00.000Z',
            },
            effectiveFrom: '2026-07-18T02:00:00.000Z',
            expiresAt: null,
          },
          idempotencyKey: 'stale-recovery-correction',
        },
      );
      const recoveredFact = await service.confirmFact(
        { workspaceId, userId: 'owner-a' },
        {
          batchId: 'batch-stale-recovery',
          candidateId: 'candidate-stale-recovery',
          factId: 'fact-stale-recovery',
          expectedFactRevision: 1,
          idempotencyKey: 'stale-recovery-confirmed',
        },
      );
      assert.equal(recoveredFact.revision, 2);
      assert.equal(
        await new PostgresAssetIntakeRepository(pool).getBatch(
          'another-workspace',
          'batch-a',
        ),
        null,
      );
    } finally {
      await repository.deleteWorkspaceForTest(workspaceId);
      await ledger.deleteWorkspaceForTest(workspaceId);
      await pool.end();
    }
  },
);
