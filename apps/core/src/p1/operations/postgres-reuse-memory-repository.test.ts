import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { PostgresReuseMemoryRepository } from './postgres-reuse-memory-repository.js';
import {
  ReuseMemoryError,
  ReuseMemoryService,
} from './reuse-memory-service.js';

test(
  'Postgres reuse memory persists immutable assets and inactive preferences across repository replacement',
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    const repository = new PostgresReuseMemoryRepository(pool);
    const workspaceId = `reuse-memory-${randomUUID()}`;
    await repository.migrate();
    try {
      const service = new ReuseMemoryService(
        repository,
        {
          verifyCandidate: async () => {},
          verifyRevision: async () => {},
        },
        () => '2026-07-18T03:01:00.000Z',
      );
      await service.proposeReusableAsset({
        candidateId: 'reusable-candidate-a',
        assetId: 'series-a',
        workspaceId,
        kind: 'series',
        name: '主理人日常三图团购',
        fixedItems: [
          {
            key: 'structure.three-part',
            value: ['experience', 'evidence', 'cta'],
            sourceRef: 'package-a:version-a',
          },
        ],
        variableSlots: [
          { key: 'offer.price', source: 'current_fact', required: true },
        ],
        defaultScope: { storeId: 'store-a', scene: 'group-buy' },
        provenance: {
          sourcePackageId: 'package-a',
          sourceVersionId: 'version-a',
          sourcePackageRevision: 3,
          contextBundleId: 'bundle-a',
          contextBundleRevision: 2,
        },
        rights: { assetIds: [], status: 'authorized' },
        status: 'pending',
        createdAt: '2026-07-18T03:00:00.000Z',
        createdBy: 'owner-a',
      });
      const revision = await service.confirmReusableAsset(
        { workspaceId, userId: 'owner-a' },
        {
          candidateId: 'reusable-candidate-a',
          expectedAssetRevision: 0,
          revisionId: 'series-a:1',
          nextSuggestions: [
            {
              suggestionId: 'suggestion-a',
              explanation: '用当前价格续写。',
              variableSlotKeys: ['offer.price'],
            },
          ],
          idempotencyKey: 'confirm-series',
        },
      );
      let restartedClock = 2;
      const restarted = new ReuseMemoryService(
        new PostgresReuseMemoryRepository(pool),
        {
          verifyCandidate: async () => {},
          verifyRevision: async () => {},
        },
        () =>
          new Date(
            Date.UTC(2026, 6, 18, 3, restartedClock++, 0),
          ).toISOString(),
      );
      assert.deepEqual(
        await restarted.confirmReusableAsset(
          { workspaceId, userId: 'owner-a' },
          {
            candidateId: 'reusable-candidate-a',
            expectedAssetRevision: 0,
            revisionId: 'series-a:1',
            nextSuggestions: revision.nextSuggestions,
            idempotencyKey: 'confirm-series',
          },
        ),
        revision,
      );
      await restarted.deactivateSeries(
        { workspaceId, userId: 'owner-a' },
        {
          assetId: 'series-a',
          revisionId: 'series-a:1',
          reason: '栏目暂时停用',
          idempotencyKey: 'deactivate-series',
        },
      );
      assert.deepEqual(
        await restarted.listAutomaticSeriesSuggestions(workspaceId),
        [],
      );
      assert.equal(
        (await repository.assetHistory(workspaceId, 'series-a')).length,
        1,
      );

      let repeatedCandidateId = '';
      for (const suffix of ['a', 'b', 'c', 'd']) {
        const result = await restarted.recordPreferenceSignal(
          { workspaceId },
          {
            signalId: `signal-${suffix}`,
            decisionId: `signal-decision-${suffix}`,
            taskId: `signal-task-${suffix}`,
            semanticKey: 'tone.repeated-less-promotional',
            value: true,
            defaultScope: { storeId: 'store-a' },
            kind: 'modified',
          },
        );
        if (result.candidate)
          repeatedCandidateId = result.candidate.candidateId;
      }
      assert.ok(repeatedCandidateId);
      const replayedSignal = await restarted.recordPreferenceSignal(
        { workspaceId },
        {
          signalId: 'signal-d',
          decisionId: 'signal-decision-d',
          taskId: 'signal-task-d',
          semanticKey: 'tone.repeated-less-promotional',
          value: true,
          defaultScope: { storeId: 'store-a' },
          kind: 'modified',
        },
      );
      assert.equal(replayedSignal.candidate?.candidateId, repeatedCandidateId);
      const repeatedView = await new ReuseMemoryService(
        new PostgresReuseMemoryRepository(pool),
        {
          verifyCandidate: async () => {},
          verifyRevision: async () => {},
        },
      ).preferenceView(workspaceId);
      assert.equal(repeatedView.signals.length, 4);
      assert.equal(
        repeatedView.candidates.find(
          (candidate) => candidate.candidateId === repeatedCandidateId,
        )?.trigger,
        'repeated_signal',
      );

      for (const suffix of ['b', 'c']) {
        await restarted.proposePreference({
          candidateId: `preference-candidate-${suffix}`,
          workspaceId,
          semanticKey: `tone.preference-${suffix}`,
          proposedValue: suffix,
          defaultScope: { storeId: 'store-a' },
          evidenceDecisionIds: [`decision-${suffix}`],
          evidenceTaskIds: [`task-${suffix}`],
          trigger: 'explicit_long_term_intent',
          status: 'pending',
          proposedAt: '2026-07-18T03:03:00.000Z',
        });
      }
      const competing = await Promise.allSettled(
        ['b', 'c'].map((suffix) =>
          restarted.confirmPreference(
            { workspaceId, userId: 'owner-a' },
            {
              candidateId: `preference-candidate-${suffix}`,
              preferenceId: `preference-${suffix}`,
              expectedRevision: 0,
              positiveExamples: [],
              negativeExamples: [],
              idempotencyKey: 'shared-preference-receipt',
            },
          ),
        ),
      );
      assert.deepEqual(
        competing.map((result) => result.status).sort(),
        ['fulfilled', 'rejected'],
      );
      const rejected = competing.find(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected',
      );
      assert.equal(rejected?.reason instanceof ReuseMemoryError, true);
      assert.equal((rejected?.reason as ReuseMemoryError).code, 'CONFLICT');

      await restarted.proposePreference({
        candidateId: 'preference-candidate-a',
        workspaceId,
        semanticKey: 'tone.less-promotional',
        proposedValue: true,
        defaultScope: { storeId: 'store-a', platform: 'xiaohongshu' },
        evidenceDecisionIds: ['decision-a'],
        evidenceTaskIds: ['task-a'],
        trigger: 'explicit_long_term_intent',
        status: 'pending',
        proposedAt: '2026-07-18T03:00:00.000Z',
      });
      const preference = await restarted.confirmPreference(
        { workspaceId, userId: 'owner-a' },
        {
          candidateId: 'preference-candidate-a',
          preferenceId: 'preference-a',
          expectedRevision: 0,
          positiveExamples: ['少一点促销感'],
          negativeExamples: [],
          idempotencyKey: 'confirm-preference',
        },
      );
      assert.equal(preference.status, 'inactive_stage2');
      assert.equal(
        (
          await new PostgresReuseMemoryRepository(pool).preferenceHistory(
            workspaceId,
            'preference-a',
          )
        ).length,
        1,
      );
    } finally {
      await repository.deleteWorkspaceForTest(workspaceId);
      await pool.end();
    }
  },
);
