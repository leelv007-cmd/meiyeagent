import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';

import {
  askMerchantAnswerSchema,
  askMerchantQuestionRequestSchema,
  executionConfirmationRequestSchema,
  questionCardSchema,
  type AskMerchantQuestionRequest,
} from '@meiye/contracts';
import { Pool } from 'pg';

import { fingerprintValue } from '../job-runtime/job-contracts.js';
import {
  HarnessInteractionService,
  HarnessSystemDefaultProducer,
} from './interaction-service.js';
import {
  HarnessDecisionError,
  HarnessDecisionService,
} from './decision-service.js';
import { PostgresHarnessResumeReconcilerStore } from './postgres-resume-reconciler-store.js';
import { PostgresHarnessStore } from './postgres-store.js';
import {
  HarnessResumeReconciler,
  type HarnessResumeWorkflow,
} from './resume-reconciler.js';
import { harnessRuntimeId } from './workspace-scope.js';

const connectionString = process.env.TEST_DATABASE_URL;

function semanticDefaultEligibility(
  itemIds: string[],
  conditionRevision: string,
) {
  const defaultResponse = {
    kind: 'answer' as const,
    items: itemIds.map((itemId) => ({
      itemId,
      result: { kind: 'deferred' as const },
    })),
  };
  return {
    kind: 'safe' as const,
    serverEvaluated: true as const,
    effect: 'none' as const,
    quota: 'not_applicable' as const,
    defaultResponse,
    defaultResponseFingerprint: fingerprintValue(defaultResponse),
    policyRevision: 'ask-semantic-default/v1',
    conditionRevision,
  };
}

function registerTypedPending(
  store: PostgresHarnessStore,
  workspaceId: string,
  request: AskMerchantQuestionRequest,
) {
  const firstQuestion = request.questions[0]!;
  return store.registerPending(
    workspaceId,
    questionCardSchema.parse({
      questionId: request.requestId,
      workflowId: request.runId,
      workflowRevision: request.revision,
      question: firstQuestion.question,
      options: (firstQuestion.options ?? []).map((option, index) => ({
        id: `${firstQuestion.itemId}:${index}`,
        label: option.label,
        ...(option.description
          ? { description: option.description }
          : {}),
      })),
      freeText: { enabled: true },
      response: {
        field: firstQuestion.itemId,
        reason: '需要商家确认后继续',
      },
      unattended:
        request.timeoutPolicy?.kind === 'semantic_default'
          ? 'continue'
          : 'hold',
      scope: 'current_task',
    }),
    {
      timeoutSeconds:
        request.timeoutPolicy?.kind === 'semantic_default'
          ? request.timeoutPolicy.timeoutSeconds
          : null,
      interactionRequest: request,
    },
  );
}

function createPgInteractionService(
  pool: Pool,
  store: PostgresHarnessStore,
  resumeInteraction: HarnessResumeWorkflow['resumeInteraction'],
  now: () => Date = () => new Date(),
) {
  const reconciler = new HarnessResumeReconciler(
    new PostgresHarnessResumeReconcilerStore(pool),
    {
      async resume() {
        throw new Error('A typed interaction must not use the legacy path.');
      },
      resumeInteraction,
    },
  );
  return new HarnessInteractionService(
    store,
    {
      async resume({ eventId }) {
        if (!(await reconciler.resumeEvent(eventId))) {
          throw new Error('The persisted interaction resume is unavailable.');
        }
      },
    },
    now,
  );
}

test(
  'Postgres interactions survive restart, stay out of pending actions and resume once',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const firstStore = new PostgresHarnessStore(pool);
    await firstStore.applySchema();
    await pool.query(
      `create table if not exists p1_content_packages (
         workspace_id text not null,
         payload jsonb not null
       )`,
    );
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
      const forgedFingerprintRequest =
        askMerchantQuestionRequestSchema.parse({
          ...request,
          timeoutPolicy: {
            kind: 'semantic_default',
            timeoutSeconds: 30,
            eligibility: {
              ...semanticDefaultEligibility(
                ['service'],
                `${request.requestId}:r${request.revision}`,
              ),
              defaultResponseFingerprint: '0'.repeat(64),
            },
          },
        });
      await assert.rejects(
        registerTypedPending(
          firstStore,
          workspaceId,
          forgedFingerprintRequest,
        ),
        /semantic default authority is not current/u,
      );
      const forgedRevisionRequest = askMerchantQuestionRequestSchema.parse({
        ...request,
        timeoutPolicy: {
          kind: 'semantic_default',
          timeoutSeconds: 30,
          eligibility: semanticDefaultEligibility(
            ['service'],
            'forged-condition-r99',
          ),
        },
      });
      await assert.rejects(
        registerTypedPending(
          firstStore,
          workspaceId,
          forgedRevisionRequest,
        ),
        /semantic default authority is not current/u,
      );
      assert.equal(
        (
          await pool.query<{ pending_count: string }>(
            `select count(*)::text as pending_count
               from harness_runtime.pending_questions
              where task_id=$1`,
            [runtimeId],
          )
        ).rows[0]?.pending_count,
        '0',
      );
      const registrations = await Promise.all([
        registerTypedPending(firstStore, workspaceId, request),
        registerTypedPending(firstStore, workspaceId, request),
      ]);
      assert.deepEqual(registrations, [
        { timeoutSeconds: null, interactionRequest: request },
        { timeoutSeconds: null, interactionRequest: request },
      ]);
      assert.deepEqual(
        await firstStore.listPendingQuestions(workspaceId),
        [],
      );
      assert.equal(
        await firstStore.readDecisionTarget(workspaceId, runId),
        null,
      );

      const restartedStore = new PostgresHarnessStore(pool);
      assert.deepEqual(
        await restartedStore.readPendingInteraction(workspaceId, runId),
        request,
      );
      assert.equal(
        (await restartedStore.readPending(workspaceId, runId))?.questionId,
        request.requestId,
      );

      const resumes: unknown[] = [];
      const service = createPgInteractionService(
        pool,
        restartedStore,
        async (_workspaceId, _taskId, signal) => {
          resumes.push(signal);
        },
      );
      assert.deepEqual(await service.submit(workspaceId, answer), {
        kind: 'resumed',
        replayed: false,
      });
      assert.deepEqual(await service.submit(workspaceId, answer), {
        kind: 'resumed',
        replayed: true,
      });
      await assert.rejects(
        service.submit(workspaceId, {
          ...answer,
          response: { kind: 'skipped' },
        }),
        /idempotency key belongs to another answer/u,
      );
      assert.equal(resumes.length, 1);
      assert.deepEqual(resumes[0], {
        kind: 'harness_interaction_resume',
        schemaVersion: 'v1',
        idempotencyKey: answer.idempotencyKey,
        interactionKind: 'ask_merchant',
        requestId: request.requestId,
        revision: request.revision,
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
      await registerTypedPending(restartedStore, workspaceId, raceRequest);
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
          createPgInteractionService(
            pool,
            new PostgresHarnessStore(pool),
            async (_workspaceId, _taskId, signal) => {
              resumes.push(signal);
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

      const executionRequest = executionConfirmationRequestSchema.parse({
        requestId: `interaction-execution-${suffix}`,
        runId,
        step: 'execution_selection',
        revision: 3,
        kind: 'execution_confirmation',
        frozen: {
          executionSnapshotRef: { id: `snapshot-${suffix}`, revision: 1 },
          quoteRevision: `quote-${suffix}`,
          params: [
            {
              key: 'model',
              label: '模型',
              value: 'ark-image-v3',
              hint: null,
            },
          ],
          debitPreview: [{ resource: 'image', quantity: 1 }],
          condition: {
            kind: 'existing_gate',
            required: true,
            serverEvaluated: true,
          },
          timeoutPolicy: {
            kind: 'hold',
            reason: 'unknown',
            serverEvaluated: true,
          },
        },
        presentation: {
          carriers: ['conversation', 'task_card'],
          notification: 'none',
          renderer: 'execution_confirmation',
        },
      });
      await restartedStore.registerPending(
        workspaceId,
        questionCardSchema.parse({
          questionId: executionRequest.requestId,
          workflowId: runId,
          workflowRevision: executionRequest.revision,
          question: '是否按当前方案执行？',
          options: [
            { id: 'approved', label: '确认执行' },
            { id: 'rejected', label: '暂不执行' },
          ],
          freeText: { enabled: true },
          response: {
            field: 'execution_confirmation',
            reason: '执行前需要商家确认',
          },
          scope: 'current_task',
        }),
        { timeoutSeconds: null, interactionRequest: executionRequest },
      );
      const executionResumes: unknown[] = [];
      const executionService = createPgInteractionService(
        pool,
        restartedStore,
        async (_workspaceId, _taskId, signal) => {
          executionResumes.push(signal);
        },
      );
      assert.deepEqual(
        await executionService.submit(workspaceId, {
          requestId: executionRequest.requestId,
          revision: executionRequest.revision,
          idempotencyKey: `execution-waiting-${suffix}`,
          resume: { runId, step: executionRequest.step },
          response: { kind: 'rejected' },
        }),
        { kind: 'waiting', replayed: false },
      );
      assert.equal(
        await restartedStore.readPendingInteraction(workspaceId, runId),
        null,
      );
      const legacyResumes: unknown[] = [];
      const legacyDecisions = new HarnessDecisionService(restartedStore, {
        async resume(_workspaceId, _taskId, command) {
          legacyResumes.push(command);
        },
      });
      await assert.rejects(
        legacyDecisions.submit(workspaceId, runId, {
          idempotencyKey: `legacy-waiting-decision-${suffix}`,
          questionId: executionRequest.requestId,
          workflowRevision: executionRequest.revision,
          patch: {
            field: 'execution_confirmation',
            value: '确认执行',
            reason: '执行前需要商家确认',
          },
          decision: { state: 'accepted', value: '确认执行' },
        }),
        (error: unknown) =>
          error instanceof HarnessDecisionError &&
          error.code === 'STALE_QUESTION',
      );
      assert.deepEqual(legacyResumes, []);
      const messageInput = {
        idempotencyKey: `execution-message-${suffix}`,
        message: '请换成更稳妥的模型再继续',
      };
      assert.deepEqual(
        await executionService.submitMerchantMessage(
          workspaceId,
          runId,
          messageInput,
        ),
        { kind: 'resumed', replayed: false },
      );
      assert.deepEqual(
        await executionService.submitMerchantMessage(
          workspaceId,
          runId,
          messageInput,
        ),
        { kind: 'resumed', replayed: true },
      );
      assert.equal(executionResumes.length, 1);
      assert.deepEqual(
        (executionResumes[0] as { resumeData: unknown }).resumeData,
        {
          kind: 'rejected',
          feedback: messageInput.message,
        },
      );

      const timeoutRequest = askMerchantQuestionRequestSchema.parse({
        ...request,
        requestId: `interaction-timeout-${suffix}`,
        revision: 4,
        timeoutPolicy: {
          kind: 'semantic_default',
          timeoutSeconds: 30,
          eligibility: semanticDefaultEligibility(
            ['window'],
            `interaction-timeout-${suffix}:r4`,
          ),
        },
        questions: [
          {
            itemId: 'window',
            question: '活动到哪天结束？',
            fallback: { kind: 'deferred' },
          },
        ],
      });
      let now = Date.parse('2026-07-30T00:00:00.000Z');
      const timeoutStore = new PostgresHarnessStore(
        pool,
        undefined,
        undefined,
        () => new Date(now),
      );
      const timeoutService = createPgInteractionService(
        pool,
        timeoutStore,
        async (_workspaceId, _taskId, signal) => {
          resumes.push(signal);
        },
        () => new Date(now),
      );
      assert.deepEqual(
        await registerTypedPending(
          timeoutStore,
          workspaceId,
          timeoutRequest,
        ),
        { timeoutSeconds: 30, interactionRequest: timeoutRequest },
      );
      assert.deepEqual(
        await timeoutService.submitSystemDefault(workspaceId, runId),
        { kind: 'held', reason: 'renderer' },
      );
      assert.equal(
        (
          await pool.query<{ event_count: string }>(
            `select count(*)::text as event_count
               from harness_runtime.decision_events
              where task_id=$1
                and idempotency_key=$2`,
            [
              runtimeId,
              `${timeoutRequest.requestId}:r${timeoutRequest.revision}:system_default`,
            ],
          )
        ).rows[0]?.event_count,
        '0',
      );
      assert.equal(
        (await timeoutService.readForCarrier(workspaceId, runId, 'conversation'))
          ?.requestId,
        timeoutRequest.requestId,
      );
      assert.equal(
        (await new PostgresHarnessStore(pool).readPending(workspaceId, runId))
          ?.questionId,
        timeoutRequest.requestId,
      );
      assert.deepEqual(
        await timeoutService.submitSystemDefault(workspaceId, runId),
        { kind: 'held', reason: 'deadline' },
      );
      now += 10_000;
      await timeoutService.setEditing(workspaceId, runId, true);
      now += 90_000;
      const restartedTimeoutService = createPgInteractionService(
        pool,
        new PostgresHarnessStore(pool),
        async (_workspaceId, _taskId, signal) => {
          resumes.push(signal);
        },
        () => new Date(now),
      );
      assert.deepEqual(
        await restartedTimeoutService.submitSystemDefault(workspaceId, runId),
        { kind: 'held', reason: 'editing' },
      );
      await restartedTimeoutService.setEditing(workspaceId, runId, false);
      now += 19_999;
      assert.deepEqual(
        await restartedTimeoutService.submitSystemDefault(workspaceId, runId),
        { kind: 'held', reason: 'deadline' },
      );
      now += 1;
      const databaseDueAt = (
        await pool.query<{ deadline_at: Date }>(
          `select clock_timestamp() - interval '1 second' as deadline_at`,
        )
      ).rows[0]!.deadline_at.toISOString();
      await pool.query(
        `update harness_runtime.pending_questions
            set pending_projection=jsonb_set(
              pending_projection,
              '{timer,deadlineAt}',
              to_jsonb($2::text),
              false
            )
          where task_id=$1`,
        [runtimeId, databaseDueAt],
      );
      assert.deepEqual(
        await new PostgresHarnessStore(pool).listSystemDefaultCandidates(20),
        [
          {
            workspaceId,
            runId,
          },
        ],
      );
      assert.deepEqual(
        await new HarnessSystemDefaultProducer(
          new PostgresHarnessStore(pool),
          createPgInteractionService(
            pool,
            new PostgresHarnessStore(pool),
            async () => {
              throw new Error('simulated system-default DBOS outage');
            },
            () => new Date(now),
          ),
        ).runOnce(),
        { failed: 1, held: 0, resumed: 0 },
      );
      assert.deepEqual(
        await new PostgresHarnessStore(pool).listSystemDefaultCandidates(20),
        [],
      );
      const recoveredDefaults: unknown[] = [];
      const defaultReconciler = new HarnessResumeReconciler(
        new PostgresHarnessResumeReconcilerStore(pool),
        {
          async resume() {
            throw new Error('A system default must use the typed path.');
          },
          async resumeInteraction(_workspaceId, _taskId, signal) {
            recoveredDefaults.push(signal);
          },
        },
      );
      assert.deepEqual(await defaultReconciler.runOnce(), {
        resumed: 1,
        failed: 0,
      });
      assert.deepEqual(
        await new PostgresHarnessStore(pool).listSystemDefaultCandidates(20),
        [],
      );
      assert.deepEqual(await defaultReconciler.runOnce(), {
        resumed: 0,
        failed: 0,
      });
      assert.equal(recoveredDefaults.length, 1);
      assert.deepEqual(
        await restartedTimeoutService.submitSystemDefault(workspaceId, runId),
        { kind: 'resumed', replayed: true },
      );
      await assert.rejects(
        restartedTimeoutService.submit(workspaceId, {
          requestId: timeoutRequest.requestId,
          revision: timeoutRequest.revision,
          idempotencyKey:
            `${timeoutRequest.requestId}:r${timeoutRequest.revision}:system_default`,
          resume: { runId, step: timeoutRequest.step },
          response: {
            kind: 'answer',
            items: [
              {
                itemId: 'window',
                result: { kind: 'answer', value: '伪造异载荷' },
              },
            ],
          },
        }),
        /idempotency key belongs to another answer/u,
      );
      const timeoutEvent = await pool.query<{
        resume_attempts: number;
        resolution_source: string;
        resume_status: string;
      }>(
        `select resolution_source, resume_attempts, resume_status
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
      assert.equal(timeoutEvent.rows[0]?.resume_attempts, 2);
      assert.equal(timeoutEvent.rows[0]?.resume_status, 'sent');
      assert.equal(resumes.length, 2);

      const casRequest = askMerchantQuestionRequestSchema.parse({
        ...request,
        requestId: `interaction-cas-${suffix}`,
        revision: 5,
        timeoutPolicy: {
          kind: 'semantic_default',
          timeoutSeconds: 30,
          eligibility: semanticDefaultEligibility(
            ['window'],
            `interaction-cas-${suffix}:r5`,
          ),
        },
        questions: [
          {
            itemId: 'window',
            question: '活动到哪天结束？',
            fallback: { kind: 'deferred' },
          },
        ],
      });
      let casNow = Date.parse('2026-07-30T01:00:00.000Z');
      const casStore = new PostgresHarnessStore(
        pool,
        undefined,
        undefined,
        () => new Date(casNow),
      );
      await registerTypedPending(casStore, workspaceId, casRequest);
      const casResumes: unknown[] = [];
      const createCasService = () =>
        createPgInteractionService(
          pool,
          casStore,
          async (_workspaceId, _taskId, signal) => {
            casResumes.push(signal);
          },
          () => new Date(casNow),
        );
      await createCasService().readForCarrier(
        workspaceId,
        runId,
        'conversation',
      );
      casNow += 30_000;
      const merchantCasKey = `interaction-cas-merchant-${suffix}`;
      const casResults = await Promise.allSettled([
        createCasService().submitSystemDefault(workspaceId, runId),
        createCasService().submit(workspaceId, {
          requestId: casRequest.requestId,
          revision: casRequest.revision,
          idempotencyKey: merchantCasKey,
          resume: { runId, step: casRequest.step },
          response: {
            kind: 'answer',
            items: [
              {
                itemId: 'window',
                result: { kind: 'answer', value: '2026-08-31' },
              },
            ],
          },
        }),
      ]);
      assert.equal(
        casResults.filter((result) => result.status === 'fulfilled').length,
        1,
      );
      assert.equal(
        casResults.filter((result) => result.status === 'rejected').length,
        1,
      );
      assert.equal(casResumes.length, 1);
      assert.equal(
        (
          await pool.query<{ event_count: string }>(
            `select count(*)::text as event_count
               from harness_runtime.decision_events
              where task_id=$1
                and idempotency_key in ($2,$3)`,
            [
              runtimeId,
              merchantCasKey,
              `${casRequest.requestId}:r${casRequest.revision}:system_default`,
            ],
          )
        ).rows[0]?.event_count,
        '1',
      );

      const recoveryRequest = askMerchantQuestionRequestSchema.parse({
        ...request,
        requestId: `interaction-recovery-${suffix}`,
        revision: 6,
      });
      await registerTypedPending(restartedStore, workspaceId, recoveryRequest);
      const recoveryAnswer = askMerchantAnswerSchema.parse({
        ...answer,
        requestId: recoveryRequest.requestId,
        revision: recoveryRequest.revision,
        idempotencyKey: `interaction-recovery-answer-${suffix}`,
      });
      await assert.rejects(
        createPgInteractionService(
          pool,
          restartedStore,
          async () => {
            throw new Error('simulated DBOS outage');
          },
        ).submit(workspaceId, recoveryAnswer),
        /could not resume the workflow yet/u,
      );
      const malformedEventId = `malformed-interaction-event-${suffix}`;
      await pool.query(
        `insert into harness_runtime.decision_events
           (id, task_id, question_id, workflow_revision, idempotency_key,
            payload_fingerprint, payload, resolution_source, resume_status,
            created_at)
         values ($1,$2,$3,$4,$5,$6,$7::jsonb,'decision','pending',
                 now() - interval '1 minute')`,
        [
          malformedEventId,
          runtimeId,
          `malformed-question-${suffix}`,
          99,
          `malformed-answer-${suffix}`,
          fingerprintValue({ malformed: true }),
          JSON.stringify({
            kind: 'harness_interaction_resolution',
            schemaVersion: 'v1',
          }),
        ],
      );

      const reconciled: unknown[] = [];
      const reconciler = new HarnessResumeReconciler(
        new PostgresHarnessResumeReconcilerStore(pool),
        {
          async resume() {
            throw new Error('legacy resume must not claim interaction events');
          },
          async resumeInteraction(_workspaceId, _taskId, signal) {
            reconciled.push(signal);
          },
        },
      );
      assert.deepEqual(await reconciler.runOnce(), { resumed: 1, failed: 1 });
      assert.deepEqual(await reconciler.runOnce(), { resumed: 0, failed: 0 });
      assert.equal(reconciled.length, 1);
      assert.deepEqual(reconciled[0], {
        kind: 'harness_interaction_resume',
        schemaVersion: 'v1',
        idempotencyKey: recoveryAnswer.idempotencyKey,
        interactionKind: 'ask_merchant',
        requestId: recoveryRequest.requestId,
        revision: recoveryRequest.revision,
        runId,
        step: recoveryRequest.step,
        resumeData: recoveryAnswer.response,
        resolutionSource: 'decision',
      });
      const recoveryEvent = await pool.query<{
        resume_attempts: number;
        resume_status: string;
      }>(
        `select resume_attempts, resume_status
           from harness_runtime.decision_events
          where task_id=$1 and idempotency_key=$2`,
        [runtimeId, recoveryAnswer.idempotencyKey],
      );
      assert.deepEqual(recoveryEvent.rows[0], {
        resume_attempts: 2,
        resume_status: 'sent',
      });
      assert.equal(
        (
          await pool.query<{ resume_status: string }>(
            `select resume_status
               from harness_runtime.decision_events
              where id=$1`,
            [malformedEventId],
          )
        ).rows[0]?.resume_status,
        'invalid',
      );
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
