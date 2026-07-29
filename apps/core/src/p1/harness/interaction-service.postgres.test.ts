import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';

import {
  askMerchantAnswerSchema,
  askMerchantQuestionRequestSchema,
} from '@meiye/contracts';
import { Pool } from 'pg';

import { fingerprintValue } from '../job-runtime/job-contracts.js';
import { HarnessInteractionService } from './interaction-service.js';
import { PostgresHarnessStore } from './postgres-store.js';
import { harnessRuntimeId } from './workspace-scope.js';

const connectionString = process.env.TEST_DATABASE_URL;

test(
  'Postgres interactions survive restart, stay out of pending actions and resume once',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const firstStore = new PostgresHarnessStore(pool);
    await firstStore.applySchema();
    const suffix = randomUUID();
    const workspaceId = `interaction-workspace-${suffix}`;
    const runId = `interaction-run-${suffix}`;
    const runtimeId = harnessRuntimeId(workspaceId, runId);
    const request = askMerchantQuestionRequestSchema.parse({
      requestId: `interaction-request-${suffix}`,
      runId,
      step: 'context_injection',
      revision: 1,
      kind: 'ask_merchant',
      questions: [
        {
          itemId: 'service',
          question: '这次主推哪个项目？',
          options: [
            {
              label: '头皮护理',
              description: '这段说明只给商家看。',
            },
          ],
          fallback: { kind: 'deferred' },
        },
      ],
      groupSkip: true,
      presentation: {
        carriers: ['conversation', 'store_page'],
        blocking: 'none',
        notification: 'none',
      },
    });
    const answer = askMerchantAnswerSchema.parse({
      requestId: request.requestId,
      revision: request.revision,
      idempotencyKey: `interaction-answer-${suffix}`,
      resume: { runId, step: request.step },
      response: {
        kind: 'answer',
        items: [
          {
            itemId: 'service',
            result: { kind: 'answer', value: '头皮护理' },
          },
        ],
      },
    });

    try {
      await pool.query(
        `insert into harness_runtime.task_requests
           (task_id, workflow_id, runtime_id, fingerprint, request)
         values ($1,$2,$1,$3,$4::jsonb)`,
        [
          runtimeId,
          runId,
          fingerprintValue({ workspaceId, runId }),
          JSON.stringify({ workspaceId }),
        ],
      );
      const registrations = await Promise.all([
        firstStore.registerInteraction(workspaceId, request),
        firstStore.registerInteraction(workspaceId, request),
      ]);
      assert.deepEqual(
        registrations.map((item) => item.outcome).sort(),
        ['created', 'replayed'],
      );

      const restartedStore = new PostgresHarnessStore(pool);
      assert.deepEqual(
        await restartedStore.readPendingInteraction(workspaceId, runId),
        request,
      );
      assert.deepEqual(
        await restartedStore.listPendingQuestions(workspaceId),
        [],
      );

      const resumes: unknown[] = [];
      const service = new HarnessInteractionService(restartedStore, {
        async resume(input) {
          resumes.push(input);
        },
      });
      assert.deepEqual(await service.submit(workspaceId, answer), {
        kind: 'resumed',
        replayed: false,
      });
      assert.deepEqual(await service.submit(workspaceId, answer), {
        kind: 'resumed',
        replayed: true,
      });
      assert.equal(resumes.length, 1);
      assert.deepEqual(resumes[0], {
        workspaceId,
        runId,
        step: 'context_injection',
        resumeData: answer.response,
        resolutionSource: 'decision',
      });

      const persisted = await pool.query<{
        payload: {
          answer: unknown;
          resumeData: unknown;
        };
        resolution_source: string;
        resume_status: string;
      }>(
        `select payload, resolution_source, resume_status
           from harness_runtime.decision_events
          where task_id=$1 and idempotency_key=$2`,
        [runtimeId, answer.idempotencyKey],
      );
      assert.equal(persisted.rows[0]?.resolution_source, 'decision');
      assert.equal(persisted.rows[0]?.resume_status, 'sent');
      assert.deepEqual(persisted.rows[0]?.payload.resumeData, answer.response);
      assert.doesNotMatch(
        JSON.stringify(persisted.rows[0]?.payload.resumeData),
        /这段说明只给商家看/u,
      );

      const raceRequest = askMerchantQuestionRequestSchema.parse({
        ...request,
        requestId: `interaction-race-${suffix}`,
        revision: 2,
        questions: [
          {
            itemId: 'window',
            question: '活动到哪天结束？',
            fallback: { kind: 'deferred' },
          },
        ],
      });
      await restartedStore.registerInteraction(workspaceId, raceRequest);
      const raceAnswers = ['2026-08-31', '2026-09-30'].map((value, index) =>
        askMerchantAnswerSchema.parse({
          requestId: raceRequest.requestId,
          revision: raceRequest.revision,
          idempotencyKey: `race-answer-${index}-${suffix}`,
          resume: { runId, step: raceRequest.step },
          response: {
            kind: 'answer',
            items: [
              {
                itemId: 'window',
                result: { kind: 'answer', value },
              },
            ],
          },
        }),
      );
      const race = await Promise.allSettled(
        raceAnswers.map((raceAnswer) =>
          new HarnessInteractionService(
            new PostgresHarnessStore(pool),
            {
              async resume(input) {
                resumes.push(input);
              },
            },
          ).submit(workspaceId, raceAnswer),
        ),
      );
      assert.equal(
        race.filter((result) => result.status === 'fulfilled').length,
        1,
      );
      assert.equal(
        race.filter((result) => result.status === 'rejected').length,
        1,
      );
      assert.equal(resumes.length, 2);

      const timeoutRequest = askMerchantQuestionRequestSchema.parse({
        ...request,
        requestId: `interaction-timeout-${suffix}`,
        revision: 3,
        questions: [
          {
            itemId: 'window',
            question: '活动到哪天结束？',
            fallback: { kind: 'deferred' },
          },
        ],
      });
      await restartedStore.registerInteraction(workspaceId, timeoutRequest);
      const timeoutService = new HarnessInteractionService(
        new PostgresHarnessStore(pool),
        {
          async resume(input) {
            resumes.push(input);
          },
        },
      );
      await timeoutService.setEditing(workspaceId, runId, true);
      assert.equal(
        await new PostgresHarnessStore(pool).isInteractionEditing(
          workspaceId,
          runId,
        ),
        true,
      );
      assert.deepEqual(
        await timeoutService.submitSystemDefault(workspaceId, runId),
        { kind: 'held', reason: 'editing' },
      );
      await timeoutService.setEditing(workspaceId, runId, false);
      assert.deepEqual(
        await timeoutService.submitSystemDefault(workspaceId, runId),
        { kind: 'resumed', replayed: false },
      );
      const timeoutEvent = await pool.query<{
        resolution_source: string;
      }>(
        `select resolution_source
           from harness_runtime.decision_events
          where task_id=$1
            and idempotency_key=$2`,
        [
          runtimeId,
          `${timeoutRequest.requestId}:r${timeoutRequest.revision}:system_default`,
        ],
      );
      assert.equal(
        timeoutEvent.rows[0]?.resolution_source,
        'system_default',
      );
      assert.equal(resumes.length, 3);
    } finally {
      await pool.query(
        `delete from harness_runtime.langfuse_outbox
          where audit_id in (
            select id from harness_runtime.audit_events where workflow_id=$1
          )`,
        [runtimeId],
      );
      await pool.query(
        'delete from harness_runtime.audit_events where workflow_id=$1',
        [runtimeId],
      );
      for (const table of [
        'decision_traces',
        'decision_events',
        'pending_questions',
        'task_requests',
      ]) {
        await pool.query(
          `delete from harness_runtime.${table} where task_id=$1`,
          [runtimeId],
        );
      }
      await pool.end();
    }
  },
);
