import assert from 'node:assert/strict';
import test from 'node:test';

import { Pool } from 'pg';

import { CanonicalMemoryProposalRedline } from './canonical-memory-redline.js';
import { PostgresReuseMemoryRepository } from './postgres-reuse-memory-repository.js';
import { ReuseMemoryRecordProposalPort } from './record-proposal-port.js';
import {
  ReuseMemoryService,
  type MemorySedimentationAudit,
} from './reuse-memory-service.js';

const connectionString = process.env.TEST_DATABASE_URL;

test(
  'memory sedimentation preserves governance and deletion boundaries in PostgreSQL',
  {
    skip: connectionString ? false : 'TEST_DATABASE_URL is not configured',
  },
  async () => {
    const pool = new Pool({ connectionString, max: 6 });
    const repository = new PostgresReuseMemoryRepository(pool);
    const workspaceId = `memory-pg-${Date.now()}`;
    const conversationId = `conversation-${Date.now()}`;
    const decisionEventId = 'memory:confirmed:confirm-00';
    const approvalReceiptId = 'memory-approval:confirm-00';
    const now = '2026-07-30T05:00:00.000Z';
    const service = new ReuseMemoryService(
      repository,
      {
        async verifyCandidate() {},
        async verifyRevision() {},
      },
      () => now,
    );

    await repository.migrate();

    try {
      const redlineAudit = (
        gateId: string,
        reason: string,
      ): MemorySedimentationAudit => ({
        auditId: `redline:${gateId}`,
        workspaceId,
        conversationId,
        itemId: 'redline-candidate',
        outcome: 'aborted',
        decision: 'redline_aborted',
        reason,
        occurredAt: now,
      });
      const record = new ReuseMemoryRecordProposalPort(
        service,
        new CanonicalMemoryProposalRedline(
          {
            async resolve({ candidateId }) {
              return {
                phase: 'execution',
                bundle: { workspaceId, revision: 1 },
                brief: {},
                candidate: {
                  candidateId,
                  workspaceId,
                  intendedUse: 'internal_draft',
                  factClaims: [],
                  assetRefs: [],
                },
                sourceRefs: [],
                rightsRefs: [],
                identityRefs: [],
              };
            },
          },
          {
            async append({ gateId, reason }) {
              await repository.appendMemorySedimentationAudit(
                redlineAudit(gateId, reason),
              );
            },
          },
        ),
        () => now,
      );

      await assert.rejects(
        record.propose({
          kind: 'propose_preference',
          payload: {
            defaultScope: { storeId: 'store-a' },
            proposedValue: '本月买一送一，名额有限',
            semanticKey: 'offer.default',
          },
          provenance: {
            messageRange: { start: 0, end: 0 },
            sourceConversationId: conversationId,
            sourceTurnId: 'redline-turn',
          },
          workspaceId,
          idempotencyKey: 'redline-record',
          execution: {
            actorId: 'memory-worker',
            correlationId: decisionEventId,
            taskId: 'task-redline',
          },
        }),
        /critical_fact_source/u,
      );
      assert.deepEqual(
        await repository.listPreferenceCandidates(workspaceId),
        [],
      );
      assert.equal(
        (await repository.listMemorySedimentationAudits(workspaceId)).length,
        1,
      );

      const workLogMarker = 'WORKLOG_ONLY_MARKER_251';
      const sourceConversation = {
        workspaceId,
        conversationId,
        turnId: 'source-turn',
        observedAt: now,
        messages: [{ index: 7, text: workLogMarker }],
      };
      await repository.saveMemorySourceConversation(sourceConversation);
      await repository.saveMemoryWorkLog(sourceConversation);
      for (let index = 0; index < 53; index += 1) {
        await service.proposePreference({
          candidateId: `candidate-${index.toString().padStart(2, '0')}`,
          workspaceId,
          semanticKey: `tone.${index}`,
          proposedValue: `tone-${index}`,
          defaultScope: { storeId: 'store-a' },
          evidenceDecisionIds: [`decision-${index}`],
          evidenceTaskIds: [`task-${index}`],
          trigger: 'explicit_long_term_intent',
          status: 'pending',
          proposedAt: now,
          source: {
            conversationId,
            sourceTurnId: 'source-turn',
            messageRange: { start: 7, end: 7 },
          },
        });
      }

      const firstPage = await service.memoryEntriesPage(workspaceId, {
        limit: 50,
      });
      assert.equal(firstPage.items.length, 50);
      assert.ok(firstPage.nextCursor);
      const secondPage = await service.memoryEntriesPage(workspaceId, {
        limit: 50,
        cursor: firstPage.nextCursor ?? undefined,
      });
      assert.equal(secondPage.items.length, 3);
      assert.equal(secondPage.nextCursor, null);
      assert.equal(
        new Set(
          [...firstPage.items, ...secondPage.items].map((item) => item.entryId),
        ).size,
        53,
      );
      await assert.rejects(
        service.memoryEntriesPage(workspaceId, { limit: 51 }),
      );
      await assert.rejects(
        service.memoryEntriesPage(workspaceId, {
          limit: 50,
          all: true,
        } as never),
      );

      const confirmed = await service.confirmPreference(
        { workspaceId, userId: 'merchant-a' },
        {
          candidateId: 'candidate-00',
          preferenceId: 'preference-00',
          expectedRevision: 0,
          positiveExamples: [],
          negativeExamples: [],
          idempotencyKey: 'confirm-00',
        },
      );
      assert.equal(confirmed.candidateId, 'candidate-00');
      const racingDecision = await Promise.allSettled([
        service.confirmPreference(
          { workspaceId, userId: 'merchant-a' },
          {
            candidateId: 'candidate-01',
            preferenceId: 'preference-01',
            expectedRevision: 0,
            positiveExamples: [],
            negativeExamples: [],
            idempotencyKey: 'confirm-01',
          },
        ),
        service.rejectPreferenceCandidate(
          { workspaceId, userId: 'merchant-a' },
          {
            candidateId: 'candidate-01',
            reason: 'Not representative.',
            idempotencyKey: 'reject-01',
          },
        ),
      ]);
      assert.equal(
        racingDecision.filter(({ status }) => status === 'fulfilled').length,
        1,
      );
      assert.equal(
        racingDecision.filter(({ status }) => status === 'rejected').length,
        1,
      );

      const tableSeparation = await pool.query<{
        work_log_matches: string;
        preference_matches: string;
        asset_matches: string;
      }>(
        `SELECT
           (SELECT count(*)::text FROM p1_memory_work_logs
             WHERE workspace_id = $1 AND payload::text LIKE $2)
             AS work_log_matches,
           (SELECT count(*)::text FROM p1_preference_candidates
             WHERE workspace_id = $1 AND payload::text LIKE $2)
             AS preference_matches,
           (SELECT count(*)::text FROM p1_reusable_asset_candidates
             WHERE workspace_id = $1 AND payload::text LIKE $2)
             AS asset_matches`,
        [workspaceId, `%${workLogMarker}%`],
      );
      assert.deepEqual(tableSeparation.rows[0], {
        work_log_matches: '1',
        preference_matches: '0',
        asset_matches: '0',
      });

      assert.equal(
        await service.deleteMemorySourceConversation(
          { workspaceId },
          conversationId,
        ),
        'deleted',
      );
      const sourceDeleted = await service.memoryEntriesPage(workspaceId, {
        limit: 50,
      });
      assert.equal(sourceDeleted.items[0]?.source?.status, 'deleted');
      assert.equal(sourceDeleted.items[0]?.source?.preview, null);
      await assert.rejects(
        repository.saveMemoryWorkLog({
          workspaceId,
          conversationId,
          turnId: 'late-source-turn',
          observedAt: now,
          messages: [{ index: 0, text: 'late resurrection' }],
        }),
      );

      assert.equal(
        await service.deleteMemoryEntry(
          { workspaceId, userId: 'merchant-a' },
          'candidate-00',
        ),
        'deleted',
      );
      assert.equal(
        await service.deleteMemoryEntry(
          { workspaceId, userId: 'merchant-a' },
          'candidate-00',
        ),
        'deleted',
      );

      const deletion = await pool.query<{
        candidate_rows: string;
        promotion_rows: string;
        preference_head_rows: string;
        preference_revision_rows: string;
        preference_receipt_rows: string;
        entry_tombstone_rows: string;
        decision_event_rows: string;
        approval_receipt_rows: string;
      }>(
        `SELECT
           (SELECT count(*)::text FROM p1_preference_candidates
             WHERE workspace_id = $1 AND candidate_id = 'candidate-00')
             AS candidate_rows,
           (SELECT count(*)::text FROM p1_preference_promotions
             WHERE workspace_id = $1 AND candidate_id = 'candidate-00')
             AS promotion_rows,
           (SELECT count(*)::text FROM p1_preference_heads
             WHERE workspace_id = $1 AND preference_id = 'preference-00')
             AS preference_head_rows,
           (SELECT count(*)::text FROM p1_preference_revisions
             WHERE workspace_id = $1 AND preference_id = 'preference-00')
             AS preference_revision_rows,
           (SELECT count(*)::text FROM p1_preference_receipts
             WHERE workspace_id = $1
               AND payload->>'candidateId' = 'candidate-00')
             AS preference_receipt_rows,
           (SELECT count(*)::text FROM p1_memory_entry_tombstones
             WHERE workspace_id = $1 AND entry_id = 'candidate-00')
             AS entry_tombstone_rows,
           (SELECT count(*)::text FROM p1_memory_candidate_decisions
             WHERE workspace_id = $1 AND decision_id = $2)
             AS decision_event_rows,
           (SELECT count(*)::text
              FROM p1_memory_approval_receipts
             WHERE workspace_id = $1 AND receipt_id = $3)
             AS approval_receipt_rows`,
        [workspaceId, decisionEventId, approvalReceiptId],
      );
      assert.deepEqual(deletion.rows[0], {
        candidate_rows: '0',
        promotion_rows: '0',
        preference_head_rows: '0',
        preference_revision_rows: '0',
        preference_receipt_rows: '0',
        entry_tombstone_rows: '1',
        decision_event_rows: '1',
        approval_receipt_rows: '1',
      });
    } finally {
      await repository.deleteWorkspaceForTest(workspaceId);
      await pool.end();
    }
  },
);
