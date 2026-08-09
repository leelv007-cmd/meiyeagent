import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DBOS } from '@dbos-inc/dbos-sdk';
import type {
  HarnessInteractionRequest,
  QuestionCard,
} from '@meiye/contracts';
import { Pool } from 'pg';

import { HarnessWorkflowEventSource } from '../workflow-events.js';
import { createCreationExecutionSnapshot } from '../execution-spine/creation-execution-snapshot.js';
import { SkillFoundationModule } from '../skills/foundation-module.js';
import { MemorySkillRepository } from '../skills/repository.js';
import { SkillService } from '../skills/service.js';
import type { SkillRevision } from '../skills/types.js';
import { HarnessDbosWorkflowEventReader } from './dbos-workflow-events.js';
import {
  createMediaAdmissionWorkflow,
  type MediaAdmissionCrashMode,
} from './dbos-media-admission.fixture.js';
import {
  normalizeHarnessDbosWorkflowInput,
  registerHarnessDbosWorkflow,
  resumeHarnessDbosInteractionWorkflow,
  resumeHarnessDbosWorkflow,
} from './dbos-workflow.js';
import { harnessRuntimeId } from './workspace-scope.js';
import { PostgresNoteMediaAdmissionCoordinator } from './note-media-admission.js';
import { PostgresProductBillingRepository } from '../product-billing/postgres-repository.js';
import { PostgresHarnessStore } from './postgres-store.js';
import { HarnessInteractionService } from './interaction-service.js';
import { PostgresHarnessResumeReconcilerStore } from './postgres-resume-reconciler-store.js';
import { HarnessResumeReconciler } from './resume-reconciler.js';
import type {
  HarnessMediaSelectionResult,
  HarnessStagePorts,
} from './workflow-core.js';
import {
  createMakeRestartWorkflow,
  MAKE_RESTART_APP_NAME,
  makeRestartRequest,
  migrateMakeRestartReceipt,
} from './dbos-make-restart.fixture.js';
import { PostgresLegacyShadowObservationReader } from './legacy-shadow-observation-reader.js';

const systemDatabaseUrl = process.env.TEST_DBOS_SYSTEM_DATABASE_URL;
const databaseUrl = process.env.TEST_DATABASE_URL;

test('registered workflow accepts both legacy and scoped invocation payloads', () => {
  const request = {
    actorId: 'owner-smoke',
    workspaceId: 'workspace-smoke',
    packageId: 'package-smoke',
    expectedRevision: 0,
    workflowRevision: 1,
    creationMode: 'customized' as const,
    rawInput: '把新团购做一套能发的',
    intent: {
      context: {
        workId: 'work-smoke',
        intent: '把新团购做一套能发的',
        sourceSummaries: [],
      },
      assetReferences: [],
    },
  };
  assert.deepEqual(
    normalizeHarnessDbosWorkflowInput(request, 'legacy-task'),
    { workflowId: 'legacy-task', request },
  );
  assert.deepEqual(
    normalizeHarnessDbosWorkflowInput(
      { workflowId: 'task-logical', request },
      harnessRuntimeId('workspace-smoke', 'task-logical'),
    ),
    { workflowId: 'task-logical', request },
  );
});

test(
  'production DBOS registration launches and delivers one five-stage workflow',
  { skip: !systemDatabaseUrl },
  async () => {
    const workflowId = `harness-smoke-${randomUUID()}`;
    const executionSnapshot = createCreationExecutionSnapshot(
      {
        actorId: 'owner-smoke',
        workspaceId: 'workspace-smoke',
        idempotencyKey: `submission-${workflowId}`,
        taskId: workflowId,
        workId: 'work-smoke',
        contentPackageId: 'package-smoke',
        expectedContentPackageRevision: 0,
        creationMode: 'customized',
        intent: '把新团购做一套能发的',
        surface: { id: 'surface-smoke', revision: 'surface-r1' },
        recipe: { id: 'recipe-smoke', revision: 'recipe-r1' },
        lens: 'copy',
        platform: { id: 'xiaohongshu' },
        deliverables: [
          { id: 'copy-main', kind: 'copy', order: 0, quantity: 1 },
        ],
        sources: { assets: [] },
        rights: { revision: 'rights-r1', summary: 'authorized' },
        identity: { id: 'identity-smoke', revision: 'identity-r1' },
        modelPolicy: { id: 'policy-smoke', revision: 'policy-r1', mode: 'auto' },
        catalogModel: { id: 'model-smoke', revision: 'model-r1' },
        quote: { id: `quote-${workflowId}`, revision: 'quote-r1' },
        route: { id: 'route-smoke', revision: 'route-r1' },
        briefContext: { id: 'brief-smoke', revision: 1 },
        contentModules: ['social_cover'],
      },
      '2026-07-26T09:00:00.000Z',
    );
    const traces: string[] = [];
    const billingReceipts: string[] = [];
    const terminalOrder: string[] = [];
    const recallDue: Array<{
      completedAt: string;
      sourceTaskId: string;
      workspaceId: string;
    }> = [];
    const providerSkillRefs: string[][] = [];
    const skills = await createSmokeSkills(workflowId);
    let pendingQuestion: QuestionCard | null = null;
    let signalPendingRegistered = () => {};
    const pendingRegistered = new Promise<void>((resolve) => {
      signalPendingRegistered = resolve;
    });
    DBOS.setConfig({
      name: 'beauty-marketing-harness-smoke',
      systemDatabaseUrl: systemDatabaseUrl!,
      applicationVersion: 'harness-smoke-v1',
    });
    const workflow = registerHarnessDbosWorkflow(
      smokePorts(workflowId, skills.service, providerSkillRefs),
      {
        async registerPending(_workspaceId, question) {
          pendingQuestion = question;
          signalPendingRegistered();
        },
        async readPending() {
          return pendingQuestion;
        },
        async recordStageTrace(input) {
          traces.push(input.stage);
        },
        async recordTerminalFailure() {},
      },
      {
        billing: {
          async commit({ taskId }) {
            billingReceipts.push(`committed:${taskId}`);
            terminalOrder.push(`committed:${taskId}`);
          },
          async refund({ taskId }) {
            billingReceipts.push(`refunded:${taskId}`);
          },
          async scheduleCompensation({ action, taskId }) {
            billingReceipts.push(`scheduled:${action}:${taskId}`);
          },
        },
        taskRecallDue: {
          async produce(input) {
            recallDue.push(input);
            terminalOrder.push(`recalled:${input.sourceTaskId}`);
          },
        },
      },
    );

    try {
      await DBOS.launch();
      const runtimeWorkflowId = harnessRuntimeId(
        'workspace-smoke',
        workflowId,
      );
      const workflowInput = {
        workflowId,
        request: {
          actorId: 'owner-smoke',
          workspaceId: 'workspace-smoke',
          packageId: 'package-smoke',
          expectedRevision: 0,
          workflowRevision: 1,
          creationMode: 'customized' as const,
          rawInput: '把新团购做一套能发的',
          intent: {
            context: {
              workId: 'work-smoke',
              intent: '把新团购做一套能发的',
              sourceSummaries: [],
            },
            assetReferences: [],
          },
          executionSnapshot,
        },
      };
      const handle = await DBOS.startWorkflow(workflow, {
        workflowID: runtimeWorkflowId,
      })(workflowInput);

      let pendingTimeout: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          pendingRegistered,
          new Promise<never>((_resolve, reject) => {
            pendingTimeout = setTimeout(
              () => reject(new Error('DBOS smoke workflow did not suspend.')),
              15_000,
            );
          }),
        ]);
      } finally {
        if (pendingTimeout) clearTimeout(pendingTimeout);
      }
      const beforeSteps = await DBOS.listWorkflowSteps(runtimeWorkflowId);
      assert.ok(beforeSteps);
      const beforeResolutionNames = beforeSteps
        .filter(({ name }) => name.startsWith('skill-resolve-intent'))
        .map(({ name }) => name);
      assert.deepEqual(beforeResolutionNames, ['skill-resolve-intent']);
      assert.equal(
        JSON.stringify(beforeSteps).includes(SMOKE_PRIVATE_INSTRUCTION),
        false,
      );

      await skills.foundation.execute({
        context: {
          actor: 'admin',
          correlationId: `rollback-${workflowId}`,
          userId: 'operator-smoke',
          workspaceId: 'workspace-smoke',
        },
        idempotencyKey: `rollback-${workflowId}`,
        input: {
          action: 'skill_rollback',
          payload: {
            bindingId: `binding.smoke-v1-${workflowId}`,
            sourceBindingId: `binding.smoke-v2-${workflowId}`,
            targetSkillRevisionRef: 'skill.intent-one@1',
            workflowRevisionRef: 'workflow.copy@1',
          },
        },
      });
      // Cancelling between "setEvent recorded" and "recv durably armed" makes the
      // failure path record refund-product-usage at the fid replay expects for
      // DBOS.recv (dbosErrorCode 26, ~50% under load). Wait for the persisted
      // pending pre-state — DBOS.sleep recorded — before forcing the replay.
      const cancelDeadline = Date.now() + 15_000;
      for (;;) {
        const steps = await DBOS.listWorkflowSteps(runtimeWorkflowId);
        if (steps?.some(({ name }) => name === 'DBOS.sleep')) break;
        if (Date.now() > cancelDeadline) {
          throw new Error('DBOS smoke workflow never persisted its pending pre-state.');
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      await DBOS.cancelWorkflow(runtimeWorkflowId);
      const recoveredHandle =
        await DBOS.resumeWorkflow<
          Awaited<ReturnType<typeof handle.getResult>>
        >(runtimeWorkflowId);
      await resumeHarnessDbosWorkflow('workspace-smoke', workflowId, {
        idempotencyKey: `ignore-${workflowId}`,
        questionId: `${workflowId}:s1:offer_price`,
        workflowRevision: 1,
        patch: {
          field: 'offer_price',
          value: '本次跳过',
          reason: 'DBOS 恢复测试',
        },
        decision: { state: 'ignored', value: '本次跳过' },
      });
      const result = await recoveredHandle.getResult();
      assert.ok(result.delivery);
      assert.ok('trace' in result);
      assert.equal(result.delivery.revision, 1);
      assert.equal(result.trace.winnerCandidateId, 'c01');
      assert.deepEqual(traces, [
        'intent_naming',
        'context_injection',
        'brief_compilation',
        'execution_selection',
        'assembly_delivery',
      ]);
      assert.deepEqual(billingReceipts, [
        `scheduled:commit:${workflowId}`,
        `committed:${workflowId}`,
      ]);
      assert.deepEqual(terminalOrder, [
        `committed:${workflowId}`,
        `recalled:${workflowId}`,
      ]);
      assert.equal(recallDue.length, 1);
      assert.equal(recallDue[0]?.workspaceId, 'workspace-smoke');
      assert.equal(recallDue[0]?.sourceTaskId, workflowId);
      assert.ok(Number.isFinite(Date.parse(recallDue[0]!.completedAt)));
      assert.deepEqual(providerSkillRefs, [['skill.intent-one@2']]);

      const afterSteps = await DBOS.listWorkflowSteps(runtimeWorkflowId);
      assert.ok(afterSteps);
      const afterResolutionSteps = afterSteps.filter(({ name }) =>
        name.startsWith('skill-resolve-intent'),
      );
      assert.deepEqual(
        afterResolutionSteps.map(({ name }) => name),
        beforeResolutionNames,
      );
      assert.equal(afterResolutionSteps.length, 1);
      assert.deepEqual(afterResolutionSteps[0]?.output, {
        skillRevisionRefs: ['skill.intent-one@2'],
        skillContentHashes: ['hash-skill-2'],
        skillCapabilityRequirements: [['structured_output']],
        skillReceiptIds: [
          `skill-materialized:${workflowId}:intent_naming:skill.intent-one%402`,
        ],
        promptRevisionRefs: [],
        stageSkillResolutions: {
          intent_naming: {
            skillRevisionRefs: ['skill.intent-one@2'],
            skillContentHashes: ['hash-skill-2'],
            skillCapabilityRequirements: [['structured_output']],
            skillReceiptIds: [
              `skill-materialized:${workflowId}:intent_naming:skill.intent-one%402`,
            ],
          },
          context_injection: {
            skillRevisionRefs: [],
            skillContentHashes: [],
            skillCapabilityRequirements: [],
            skillReceiptIds: [],
          },
          brief_compilation: {
            skillRevisionRefs: [],
            skillContentHashes: [],
            skillCapabilityRequirements: [],
            skillReceiptIds: [],
          },
          execution_selection: {
            skillRevisionRefs: [],
            skillContentHashes: [],
            skillCapabilityRequirements: [],
            skillReceiptIds: [],
          },
          assembly_delivery: {
            skillRevisionRefs: [],
            skillContentHashes: [],
            skillCapabilityRequirements: [],
            skillReceiptIds: [],
          },
        },
      });
      assert.equal(
        JSON.stringify(afterSteps).includes(SMOKE_PRIVATE_INSTRUCTION),
        false,
      );
      assert.equal(
        afterSteps.filter(({ name }) =>
          name.includes('s1-intent-skills=skill.intent-one%402-0'),
        ).length,
        1,
      );
      assert.equal(
        afterSteps.some(({ name }) =>
          name.includes('s1-intent-skills=skill.intent-one%401-0'),
        ),
        false,
      );
      const events = [];
      const source = new HarnessWorkflowEventSource(
        new HarnessDbosWorkflowEventReader({
          async taskBelongsToWorkspace(taskId, workspaceId) {
            return taskId === workflowId && workspaceId === 'workspace-smoke';
          },
          async workflowRuntimeId(workspaceId, logicalWorkflowId) {
            return harnessRuntimeId(workspaceId, logicalWorkflowId);
          },
          async readTerminalFailure() {
            return null;
          },
        }),
      );
      for await (const frame of source.stream({
        signal: new AbortController().signal,
        workflowId,
        workspaceId: 'workspace-smoke',
      })) {
        events.push(frame);
      }
      assert.deepEqual(
        events.map((frame) => frame.event),
        [
          'workflow.progress',
          'workflow.progress',
          'workflow.progress',
          'workflow.progress',
          'workflow.progress',
          'workflow.progress',
          'workflow.state',
        ],
      );
      assert.equal(events.at(-1)?.data.sourceRevision, 1);
    } finally {
      await DBOS.shutdown({ deregister: true });
    }
  },
);

test(
  'production Make survives a DBOS worker SIGKILL after the PG delivery commit exactly once',
  { skip: !systemDatabaseUrl || !databaseUrl },
  async () => {
    const workflowId = `harness-make-restart-${randomUUID()}`;
    const workspaceId = `workspace-make-restart-${workflowId}`;
    const runtimeWorkflowId = harnessRuntimeId(workspaceId, workflowId);
    const applicationVersion = `harness-make-restart-${workflowId}`;
    const pool = new Pool({ connectionString: databaseUrl! });
    await migrateMakeRestartReceipt(pool);
    await pool.query(
      'delete from p1_make_restart_delivery_receipts where workflow_id=$1',
      [workflowId],
    );
    try {
      await createMakeRestartCrashFixture(
        workflowId,
        workspaceId,
        applicationVersion,
      );
      DBOS.setConfig({
        name: MAKE_RESTART_APP_NAME,
        systemDatabaseUrl: systemDatabaseUrl!,
        applicationVersion,
      });
      createMakeRestartWorkflow({
        crashAfterDeliveryCommit: false,
        pool,
        workflowId,
        workspaceId,
      });
      await DBOS.launch();
      const recovered = DBOS.retrieveWorkflow<{
        delivery: { packageId: string; revision: number; versionId: string };
      }>(runtimeWorkflowId);
      const result = await recovered.getResult();
      assert.deepEqual(result.delivery, {
        packageId: `package-${workflowId}`,
        revision: 1,
        versionId: `version-${workflowId}`,
      });
      const receipts = await pool.query<{
        effect_key: string;
        package_id: string;
        revision: string;
      }>(
        `select effect_key, package_id, revision::text
           from p1_make_restart_delivery_receipts
          where workflow_id=$1`,
        [workflowId],
      );
      assert.deepEqual(receipts.rows, [
        {
          effect_key: `make-delivery:${workflowId}`,
          package_id: `package-${workflowId}`,
          revision: '1',
        },
      ]);
      const steps = await DBOS.listWorkflowSteps(runtimeWorkflowId);
      assert.ok(steps);
      const primitiveSteps = steps.filter(({ name }) =>
        name.startsWith('compiled-primitive-'),
      );
      assert.equal(primitiveSteps.length, 5);
      assert.equal(new Set(primitiveSteps.map(({ name }) => name)).size, primitiveSteps.length);
    } finally {
      await pool.query(
        'delete from p1_make_restart_delivery_receipts where workflow_id=$1',
        [workflowId],
      );
      await DBOS.shutdown({ deregister: true });
      await pool.end();
    }
  },
);

test(
  'production force-legacy Make writes a durable shadow observation consumed by the read-only observer',
  { skip: !systemDatabaseUrl || !databaseUrl },
  async () => {
    const workflowId = `harness-legacy-observation-${randomUUID()}`;
    const workspaceId = `workspace-legacy-observation-${workflowId}`;
    const runtimeWorkflowId = harnessRuntimeId(workspaceId, workflowId);
    const applicationVersion = `harness-legacy-observation-${workflowId}`;
    const pool = new Pool({ connectionString: databaseUrl! });
    const persistence = new PostgresHarnessStore(pool);
    const workflowInput = makeRestartRequest(workflowId, workspaceId);
    await persistence.applySchema();
    await migrateMakeRestartReceipt(pool);
    await pool.query(
      `insert into harness_runtime.task_requests
         (task_id, workflow_id, runtime_id, fingerprint, request)
       values ($1, $2, $1, $3, $4::jsonb)`,
      [
        runtimeWorkflowId,
        workflowId,
        `fixture-${workflowId}`,
        JSON.stringify(workflowInput.request),
      ],
    );
    try {
      DBOS.setConfig({
        name: MAKE_RESTART_APP_NAME,
        systemDatabaseUrl: systemDatabaseUrl!,
        applicationVersion,
      });
      const workflow = createMakeRestartWorkflow({
        crashAfterDeliveryCommit: false,
        forceLegacyFiveStage: true,
        persistence,
        pool,
        workflowId,
        workspaceId,
      });
      await DBOS.launch();
      const result = await DBOS.startWorkflow(workflow, {
        workflowID: runtimeWorkflowId,
      })(workflowInput).then((handle) => handle.getResult());
      assert.ok(result.delivery);
      assert.equal(result.delivery.packageId, `package-${workflowId}`);
      const observation = await new PostgresLegacyShadowObservationReader(
        pool,
      ).read({ workflowId, workspaceId });
      assert.deepEqual(observation?.deliverables, [
        { kind: 'copy', quantity: 1 },
      ]);
      assert.deepEqual(observation?.quoteRef, {
        id: `quote-${workflowId}`,
        revision: 'quote-r1',
      });
      const steps = await DBOS.listWorkflowSteps(runtimeWorkflowId);
      assert.equal(
        steps?.filter(({ name }) => name === 'persist-legacy-shadow-observation')
          .length,
        1,
      );
      assert.equal(
        steps?.some(({ name }) => name.startsWith('compiled-primitive-')),
        false,
      );
    } finally {
      await DBOS.shutdown({ deregister: true });
      await pool.query(
        'delete from harness_runtime.audit_events where workflow_id=$1',
        [runtimeWorkflowId],
      );
      await pool.query(
        'delete from harness_runtime.decision_traces where task_id=$1',
        [runtimeWorkflowId],
      );
      await pool.query(
        'delete from harness_runtime.task_requests where workflow_id=$1',
        [workflowId],
      );
      await pool.query(
        'delete from p1_make_restart_delivery_receipts where workflow_id=$1',
        [workflowId],
      );
      await pool.end();
    }
  },
);

test(
  'confirmation timeout exits DBOS pending state and delivers the generic route',
  { skip: !systemDatabaseUrl },
  async () => {
    const workflowId = `harness-timeout-${randomUUID()}`;
    const runtimeWorkflowId = harnessRuntimeId(
      'workspace-timeout',
      workflowId,
    );
    const skills = await createSmokeSkills(workflowId);
    const ports = smokePorts(workflowId, skills.service, []);
    ports.nameIntent = async () => ({
      declaration: {
        normalizedIntent: '推广本店团购',
        taskType: 'promotion_groupbuy_conversion',
        deliveryLayer: 'copy',
        relevantAssetCategories: ['promotion_activity'],
        usedAssetCategories: [],
        route: 'guidance',
        routingSource: 'model',
        implicitConstraints: [],
      },
      blockingQuestion: {
        questionId: `${workflowId}:offer-price`,
        workflowId,
        workflowRevision: 1,
        question: 'What is the current offer price?',
        options: [],
        freeText: { enabled: true },
        response: {
          field: 'offer_price',
          reason: 'Ground the promotion in the current merchant offer',
        },
        unattended: 'continue',
        semanticDefaultAuthority: {
          kind: 'non_resource_no_effect',
          source: 'intent_gap',
          revision: 'intent-gap/v1',
        },
        scope: 'current_task',
      },
    });
    let pendingQuestionId: string | null = null;
    let pendingTimeoutSeconds: number | null | undefined;
    let configReads = 0;
    const persistedTimeouts: string[] = [];
    DBOS.setConfig({
      name: 'beauty-marketing-harness-timeout-smoke',
      systemDatabaseUrl: systemDatabaseUrl!,
      applicationVersion: 'harness-timeout-smoke-v1',
    });
    const workflow = registerHarnessDbosWorkflow(
      ports,
      {
        async registerPending(_workspaceId, question, projection) {
          if (
            autoApprovePaidGenerationConfirmation(
              'workspace-timeout',
              workflowId,
              question,
            )
          ) {
            return;
          }
          pendingQuestionId = question.questionId;
          pendingTimeoutSeconds = projection?.timeoutSeconds;
        },
        async readPending() {
          return null;
        },
        async recordStageTrace() {},
        async recordTerminalFailure() {},
      },
      {
        config: {
          async get() {
            configReads += 1;
            return {
              actorId: 'platform-admin',
              correlationId: 'timeout-smoke-config',
              createdAt: '2026-07-26T09:00:00.000Z',
              key: 'harness.confirmation_card.timeout_seconds',
              reason: 'Exercise durable timeout',
              revision: 1,
              rolledBackToRevision: null,
              scope: 'global',
              status: 'applied',
              value: 2,
              workspaceId: '__global__',
            };
          },
        },
        decisions: {
          async submitCoreTimeout(_workspaceId, _taskId, command) {
            persistedTimeouts.push(command.idempotencyKey);
            return { eventId: 'timeout-event', replayed: false };
          },
        },
      },
    );

    try {
      await DBOS.launch();
      const request = snapshotTimeoutRequest(
        workflowId,
        'workspace-timeout',
      );
      const handle = await DBOS.startWorkflow(workflow, {
        workflowID: runtimeWorkflowId,
      })({
        workflowId,
        request: {
          ...request,
          usageReservation: {
            id: `usage-reservation-${workflowId}`,
            units: [{ resource: 'copy', quantity: 1 }],
          },
        },
      });

      const pending = await DBOS.getEvent(
        runtimeWorkflowId,
        'pending-structured-decision',
        { timeoutSeconds: 5 },
      );
      assert.equal(
        (pending as { questionId?: string } | null)?.questionId,
        `${workflowId}:offer-price`,
      );
      assert.equal(pendingTimeoutSeconds, 2);
      assert.equal((await handle.getStatus())?.status, 'PENDING');

      const result = await handle.getResult();
      assert.ok(result.delivery);
      assert.ok('trace' in result);
      assert.equal(result.delivery.revision, 1);
      assert.equal(result.trace.winnerCandidateId, 'c01');
      assert.equal(await waitForWorkflowStatus(handle, 'SUCCESS'), 'SUCCESS');
      assert.equal(
        (
          await DBOS.listWorkflows({
            workflowIDs: [runtimeWorkflowId],
            status: 'PENDING',
          })
        ).length,
        0,
      );
      assert.equal(pendingQuestionId, `${workflowId}:offer-price`);
      assert.equal(configReads, 1);
      assert.deepEqual(persistedTimeouts, [
        `${workflowId}:offer-price:r1:core_timeout`,
      ]);
      assert.deepEqual(
        (await DBOS.listWorkflowSteps(runtimeWorkflowId))
          ?.filter((step) => step.functionID >= 4 && step.functionID <= 7)
          .map((step) => [step.functionID, step.name]),
        [
          [
            4,
            `persist-pending-${workflowId}:offer-price`,
          ],
          [5, 'DBOS.setEvent'],
          [6, 'DBOS.recv'],
          [7, 'DBOS.sleep'],
        ],
      );
      assert.deepEqual(
        (await DBOS.listWorkflowSteps(runtimeWorkflowId))
          ?.filter((step) => step.functionID === 8)
          .map((step) => [step.functionID, step.name]),
        [[8, `persist-core-timeout-${workflowId}:offer-price`]],
      );
      assert.equal(
        (await DBOS.listWorkflowSteps(runtimeWorkflowId))?.some((step) =>
          step.name.startsWith('snapshot-confirmation-timeout-'),
        ),
        false,
      );
    } finally {
      await DBOS.shutdown({ deregister: true });
    }
  },
);

test(
  'typed confirmation timeout persists system_default and resumes the production DBOS topic',
  { skip: !systemDatabaseUrl },
  async () => {
    const workflowId = `harness-system-default-${randomUUID()}`;
    const workspaceId = 'workspace-system-default';
    const runtimeWorkflowId = harnessRuntimeId(workspaceId, workflowId);
    const skills = await createSmokeSkills(workflowId);
    const ports = smokePorts(workflowId, skills.service, []);
    ports.nameIntent = async () => ({
      declaration: {
        normalizedIntent: '推广本店团购',
        taskType: 'promotion_groupbuy_conversion',
        deliveryLayer: 'copy',
        relevantAssetCategories: ['promotion_activity'],
        usedAssetCategories: [],
        route: 'guidance',
        routingSource: 'model',
        implicitConstraints: [],
      },
      blockingQuestion: {
        questionId: `${workflowId}:offer-price`,
        workflowId,
        workflowRevision: 1,
        question: 'What is the current offer price?',
        options: [],
        freeText: { enabled: true },
        response: {
          field: 'offer_price',
          reason: 'Ground the promotion in the current merchant offer',
        },
        unattended: 'continue',
        semanticDefaultAuthority: {
          kind: 'non_resource_no_effect',
          source: 'intent_gap',
          revision: 'intent-gap/v1',
        },
        scope: 'current_task',
      },
    });
    let interactionRequest: HarnessInteractionRequest | undefined;
    const persistedDefaults: string[] = [];
    const forbiddenCoreTimeouts: string[] = [];
    DBOS.setConfig({
      name: 'beauty-marketing-harness-system-default-smoke',
      systemDatabaseUrl: systemDatabaseUrl!,
      applicationVersion: 'harness-system-default-smoke-v1',
    });
    const workflow = registerHarnessDbosWorkflow(
      ports,
      {
        async registerPending(_workspaceId, question, projection) {
          if (
            autoApprovePaidGenerationConfirmation(
              workspaceId,
              workflowId,
              question,
            )
          ) {
            return;
          }
          interactionRequest = projection?.interactionRequest;
          return projection;
        },
        async readPending() {
          return null;
        },
        async readPendingInteraction() {
          return interactionRequest ?? null;
        },
        async recordStageTrace() {},
        async recordTerminalFailure() {},
      },
      {
        config: {
          async get() {
            return {
              actorId: 'platform-admin',
              correlationId: 'system-default-smoke-config',
              createdAt: '2026-07-30T09:00:00.000Z',
              key: 'harness.confirmation_card.timeout_seconds',
              reason: 'Exercise typed durable timeout',
              revision: 1,
              rolledBackToRevision: null,
              scope: 'global',
              status: 'applied',
              value: 1,
              workspaceId: '__global__',
            };
          },
        },
        decisions: {
          async submitCoreTimeout(_workspaceId, _taskId, command) {
            forbiddenCoreTimeouts.push(command.idempotencyKey);
            throw new Error('Typed timeout must not use core_timeout.');
          },
        },
        interactions: {
          async expireUnrendered() {
            throw new Error('An acknowledged renderer must not expire.');
          },
          async submitSystemDefault(targetWorkspaceId, runId) {
            const request = interactionRequest;
            if (
              !request ||
              request.kind !== 'ask_merchant' ||
              request.timeoutPolicy?.kind !== 'semantic_default'
            ) {
              throw new Error('Typed system-default request is unavailable.');
            }
            const idempotencyKey =
              `${request.requestId}:r${request.revision}:system_default`;
            persistedDefaults.push(idempotencyKey);
            await resumeHarnessDbosInteractionWorkflow(
              targetWorkspaceId,
              runId,
              {
                kind: 'harness_interaction_resume',
                schemaVersion: 'v1',
                idempotencyKey,
                interactionKind: request.kind,
                requestId: request.requestId,
                revision: request.revision,
                runId: request.runId,
                step: request.step,
                resumeData:
                  request.timeoutPolicy.eligibility.defaultResponse,
                resolutionSource: 'system_default',
              },
            );
            return { kind: 'resumed' as const, replayed: false };
          },
        },
      },
    );

    try {
      await DBOS.launch();
      const request = snapshotTimeoutRequest(workflowId, workspaceId);
      const handle = await DBOS.startWorkflow(workflow, {
        workflowID: runtimeWorkflowId,
      })({
        workflowId,
        request: {
          ...request,
          usageReservation: {
            id: `usage-reservation-${workflowId}`,
            units: [{ resource: 'copy', quantity: 1 }],
          },
        },
      });

      const result = await handle.getResult();
      assert.ok(result.delivery);
      assert.deepEqual(forbiddenCoreTimeouts, []);
      assert.deepEqual(persistedDefaults, [
        `${workflowId}:offer-price:r1:system_default`,
      ]);
      assert.equal(await waitForWorkflowStatus(handle, 'SUCCESS'), 'SUCCESS');
      assert.deepEqual(
        (await DBOS.listWorkflowSteps(runtimeWorkflowId))
          ?.filter((step) => step.functionID === 8)
          .map((step) => step.name),
        [`persist-system-default-${workflowId}:offer-price`],
      );
    } finally {
      await DBOS.shutdown({ deregister: true });
    }
  },
);

test(
  'snapshot without usage reservation does not persist a paid generation confirmation',
  { skip: !systemDatabaseUrl },
  async () => {
    const workflowId = `harness-execution-confirmation-${randomUUID()}`;
    const workspaceId = `workspace-execution-confirmation-${randomUUID()}`;
    const runtimeWorkflowId = harnessRuntimeId(workspaceId, workflowId);
    const skills = await createSmokeSkills(workflowId);
    const ports = smokePorts(workflowId, skills.service, []);
    ports.nameIntent = async () => ({
      declaration: {
        normalizedIntent: '发布本店团购',
        taskType: 'promotion_groupbuy_conversion',
        deliveryLayer: 'copy',
        relevantAssetCategories: ['promotion_activity'],
        usedAssetCategories: ['promotion_activity'],
        route: 'customized',
        routingSource: 'model',
        implicitConstraints: [],
      },
      blockingQuestion: null,
    });
    DBOS.setConfig({
      name: 'beauty-marketing-harness-manual-handoff-smoke',
      systemDatabaseUrl: systemDatabaseUrl!,
      applicationVersion: 'harness-manual-handoff-smoke-v1',
    });
    const workflow = registerHarnessDbosWorkflow(ports, {
      async registerPending() {
        throw new Error(
          'Unreserved snapshot paths must not create a paid generation confirmation.',
        );
      },
      async readPending() {
        return null;
      },
      async readPendingInteraction() {
        return null;
      },
      async recordStageTrace() {},
      async recordTerminalFailure() {},
    });

    try {
      await DBOS.launch();
      // D-164③: confirmation requires usageReservation (paid freeze). Snapshot
      // alone with manual_copy / export is not enough.
      const request = snapshotTimeoutRequest(
        workflowId,
        workspaceId,
        'manual_copy',
      );
      const handle = await DBOS.startWorkflow(workflow, {
        workflowID: runtimeWorkflowId,
      })({ workflowId, request });
      const result = await handle.getResult();
      assert.ok(result.delivery);
      assert.equal(await waitForWorkflowStatus(handle, 'SUCCESS'), 'SUCCESS');
    } finally {
      await DBOS.shutdown({ deregister: true });
    }
  },
);

test(
  'an unacknowledged renderer expires and refunds after DBOS cold recovery',
  { skip: !systemDatabaseUrl },
  async () => {
    const workflowId = `harness-renderer-expiry-${randomUUID()}`;
    const workspaceId = `workspace-renderer-expiry-${randomUUID()}`;
    const runtimeWorkflowId = harnessRuntimeId(workspaceId, workflowId);
    const skills = await createSmokeSkills(workflowId);
    const ports = smokePorts(workflowId, skills.service, []);
    ports.nameIntent = async () => ({
      declaration: {
        normalizedIntent: '推广本店团购',
        taskType: 'promotion_groupbuy_conversion',
        deliveryLayer: 'copy',
        relevantAssetCategories: ['promotion_activity'],
        usedAssetCategories: [],
        route: 'guidance',
        routingSource: 'model',
        implicitConstraints: [],
      },
      blockingQuestion: {
        questionId: `${workflowId}:offer-price`,
        workflowId,
        workflowRevision: 1,
        question: '当前团购价是多少？',
        options: [],
        freeText: { enabled: true },
        response: {
          field: 'offer_price',
          reason: '补充当前任务所需的权威事实',
        },
        unattended: 'continue',
        semanticDefaultAuthority: {
          kind: 'non_resource_no_effect',
          source: 'intent_gap',
          revision: 'intent-gap/v1',
        },
        scope: 'current_task',
      },
    });
    let interactionRequest: HarnessInteractionRequest | undefined;
    let defaultAttempts = 0;
    let expiries = 0;
    let refunds = 0;
    DBOS.setConfig({
      name: 'beauty-marketing-harness-renderer-expiry',
      systemDatabaseUrl: systemDatabaseUrl!,
      applicationVersion: `harness-renderer-expiry-${workflowId}`,
    });
    const workflow = registerHarnessDbosWorkflow(
      ports,
      {
        async registerPending(_workspaceId, question, projection) {
          if (
            autoApprovePaidGenerationConfirmation(
              workspaceId,
              workflowId,
              question,
            )
          ) {
            return;
          }
          interactionRequest = projection?.interactionRequest;
          return projection;
        },
        async readPending() {
          return null;
        },
        async readPendingInteraction() {
          return interactionRequest ?? null;
        },
        async recordStageTrace() {},
        async recordTerminalFailure() {},
      },
      {
        billing: {
          async commit() {
            throw new Error('A renderer expiry must not commit usage.');
          },
          async refund() {
            refunds += 1;
          },
          async scheduleCompensation() {
            throw new Error('The renderer-expiry refund succeeds.');
          },
        },
        config: {
          async get() {
            return {
              actorId: 'platform-admin',
              correlationId: `renderer-expiry-${workflowId}`,
              createdAt: '2026-07-30T09:00:00.000Z',
              key: 'harness.confirmation_card.timeout_seconds',
              reason: 'Exercise renderer expiry after recovery',
              revision: 1,
              rolledBackToRevision: null,
              scope: 'global',
              status: 'applied',
              value: 2,
              workspaceId: '__global__',
            };
          },
        },
        decisions: {
          async submitCoreTimeout() {
            throw new Error('A typed timeout must not use core_timeout.');
          },
        },
        interactions: {
          async expireUnrendered() {
            expiries += 1;
            return 'expired' as const;
          },
          async submitSystemDefault() {
            defaultAttempts += 1;
            return { kind: 'held' as const, reason: 'renderer' as const };
          },
        },
      },
    );

    let launched = false;
    try {
      await DBOS.launch();
      launched = true;
      const request = snapshotTimeoutRequest(workflowId, workspaceId);
      await DBOS.startWorkflow(workflow, {
        workflowID: runtimeWorkflowId,
      })({
        workflowId,
        request: {
          ...request,
          usageReservation: {
            id: `usage-reservation-${workflowId}`,
            units: [{ resource: 'copy', quantity: 1 }],
          },
        },
      });
      await DBOS.getEvent(
        runtimeWorkflowId,
        'pending-structured-decision',
        { timeoutSeconds: 5 },
      );
      await DBOS.shutdown();
      launched = false;

      await DBOS.launch();
      launched = true;
      const recovered = DBOS.retrieveWorkflow<{
        delivery: null;
        merchantMessage: string;
        outcome: 'cancelled';
        resolutionSource: 'core_hold_expired';
      }>(runtimeWorkflowId);
      assert.deepEqual(await recovered.getResult(), {
        delivery: null,
        merchantMessage: '超时未选择，本次任务已取消，积分已退回',
        outcome: 'cancelled',
        resolutionSource: 'core_hold_expired',
      });
      assert.equal(await waitForWorkflowStatus(recovered, 'SUCCESS'), 'SUCCESS');
      assert.equal(defaultAttempts, 1);
      assert.equal(expiries, 1);
      assert.equal(refunds, 1);
      assert.deepEqual(
        (await DBOS.listWorkflowSteps(runtimeWorkflowId))
          ?.filter((step) => step.functionID >= 8 && step.functionID <= 10)
          .map((step) => step.name),
        [
          `persist-system-default-${workflowId}:offer-price`,
          `persist-renderer-unavailable-${workflowId}:offer-price`,
          'refund-product-usage',
        ],
      );
    } finally {
      if (launched) await DBOS.shutdown({ deregister: true });
    }
  },
);

test(
  'durable r2 reask resumes the original production DBOS question exactly once',
  { skip: !systemDatabaseUrl || !databaseUrl },
  async () => {
    const suffix = randomUUID();
    const workflowId = `harness-reask-${suffix}`;
    const workspaceId = `workspace-reask-${suffix}`;
    const runtimeWorkflowId = harnessRuntimeId(workspaceId, workflowId);
    const pool = new Pool({ connectionString: databaseUrl });
    const store = new PostgresHarnessStore(pool);
    await store.applySchema();
    await new PostgresProductBillingRepository(pool).migrate();
    await pool.query(
      `create table if not exists p1_content_packages (
         workspace_id text not null,
         payload jsonb not null
       )`,
    );
    const request = snapshotTimeoutRequest(workflowId, workspaceId);
    await pool.query(
      `insert into harness_runtime.task_requests
         (task_id, workflow_id, runtime_id, fingerprint, request)
       values ($1,$2,$1,$3,$4::jsonb)`,
      [
        runtimeWorkflowId,
        workflowId,
        `reask-smoke-${suffix}`,
        JSON.stringify(request),
      ],
    );
    const skills = await createSmokeSkills(workflowId);
    const ports = smokePorts(workflowId, skills.service, []);
    ports.nameIntent = async () => ({
      declaration: {
        normalizedIntent: '推广本店团购',
        taskType: 'promotion_groupbuy_conversion',
        deliveryLayer: 'copy',
        relevantAssetCategories: ['promotion_activity'],
        usedAssetCategories: [],
        route: 'guidance',
        routingSource: 'model',
        implicitConstraints: [],
      },
      blockingQuestion: {
        questionId: `${workflowId}:service`,
        workflowId,
        workflowRevision: 1,
        question: '这次主推哪个项目？',
        options: [{ id: 'scalp-care', label: '头皮护理' }],
        freeText: { enabled: false },
        response: {
          field: 'service',
          reason: '需要商家确认主推项目',
        },
        unattended: 'continue',
        semanticDefaultAuthority: {
          kind: 'non_resource_no_effect',
          source: 'intent_gap',
          revision: 'intent-gap/v1',
        },
        scope: 'current_task',
      },
    });
    let resumeCalls = 0;
    const workflowResumer = {
      async resume() {
        throw new Error('A typed interaction must not use the legacy path.');
      },
      async resumeInteraction(
        targetWorkspaceId: string,
        targetWorkflowId: string,
        signal: unknown,
      ) {
        resumeCalls += 1;
        await resumeHarnessDbosInteractionWorkflow(
          targetWorkspaceId,
          targetWorkflowId,
          signal,
          store,
        );
      },
    };
    const reconciler = new HarnessResumeReconciler(
      new PostgresHarnessResumeReconcilerStore(pool),
      workflowResumer,
    );
    const interactions = new HarnessInteractionService(store, {
      async resume({ eventId }) {
        if (!(await reconciler.resumeEvent(eventId))) {
          throw new Error('The persisted interaction resume is unavailable.');
        }
      },
    });
    DBOS.setConfig({
      name: 'beauty-marketing-harness-reask-smoke',
      systemDatabaseUrl: systemDatabaseUrl!,
      applicationVersion: 'harness-reask-smoke-v1',
    });
    const workflow = registerHarnessDbosWorkflow(
      ports,
      store,
      {
        config: {
          async get() {
            return {
              actorId: 'platform-admin',
              correlationId: `reask-timeout-${suffix}`,
              createdAt: '2026-07-30T09:00:00.000Z',
              key: 'harness.confirmation_card.timeout_seconds',
              reason: 'Exercise durable r2 system default',
              revision: 1,
              rolledBackToRevision: null,
              scope: 'global',
              status: 'applied',
              value: 2,
              workspaceId: '__global__',
            };
          },
        },
        interactions,
      },
    );

    try {
      await DBOS.launch();
      const handle = await DBOS.startWorkflow(workflow, {
        workflowID: runtimeWorkflowId,
      })({ workflowId, request });
      await DBOS.getEvent(
        runtimeWorkflowId,
        'pending-structured-decision',
        { timeoutSeconds: 5 },
      );
      const first = await interactions.readForCarrier(
        workspaceId,
        workflowId,
        'conversation',
      );
      assert.equal(first?.revision, 1);
      const reask = await interactions.submit(workspaceId, {
        requestId: first?.requestId,
        revision: first?.revision,
        idempotencyKey: `invalid-r1-${suffix}`,
        resume: { runId: workflowId, step: 'intent_naming' },
        response: {
          kind: 'answer',
          items: [
            {
              itemId: 'service',
              result: { kind: 'answer', value: '伪造选项' },
            },
          ],
        },
      });
      assert.equal(reask.kind, 'reask');
      assert.equal(reask.kind === 'reask' ? reask.request.revision : null, 2);
      const second = await interactions.readForCarrier(
        workspaceId,
        workflowId,
        'conversation',
      );
      assert.equal(second?.revision, 2);
      await interactions.ackRenderer(workspaceId, workflowId, {
        requestId: second!.requestId,
        revision: second!.revision,
        step: second!.step,
        carrier: 'conversation',
      });
      const result = await handle.getResult();
      assert.ok(result.delivery);
      assert.equal(await waitForWorkflowStatus(handle, 'SUCCESS'), 'SUCCESS');
      assert.equal(resumeCalls, 1);
      assert.deepEqual(
        await interactions.submitSystemDefault(workspaceId, workflowId),
        {
          kind: 'resumed',
          replayed: true,
        },
      );
      const systemDefaultKey =
        `${workflowId}:service:r2:system_default`;
      assert.deepEqual(
        (
          await pool.query<{
            event_count: string;
            resume_status: string;
            workflow_revision: string;
          }>(
            `select count(*)::text as event_count,
                    max(resume_status) as resume_status,
                    max(workflow_revision)::text as workflow_revision
               from harness_runtime.decision_events
              where task_id=$1
                and idempotency_key=$2`,
            [runtimeWorkflowId, systemDefaultKey],
          )
        ).rows[0],
        {
          event_count: '1',
          resume_status: 'sent',
          workflow_revision: '2',
        },
      );
    } finally {
      await DBOS.shutdown({ deregister: true });
      await pool.query(
        `delete from harness_runtime.langfuse_outbox
          where audit_id in (
            select id from harness_runtime.audit_events where workflow_id=$1
          )`,
        [runtimeWorkflowId],
      );
      await pool.query(
        'delete from harness_runtime.audit_events where workflow_id=$1',
        [runtimeWorkflowId],
      );
      for (const table of [
        'decision_traces',
        'decision_events',
        'pending_questions',
        'task_requests',
      ]) {
        await pool.query(
          `delete from harness_runtime.${table} where task_id=$1`,
          [runtimeWorkflowId],
        );
      }
      await pool.end();
    }
  },
);

test(
  'a pre-be bounded hold input exits its old unbounded branch after cold recovery',
  { skip: !systemDatabaseUrl },
  async () => {
    const workflowId = `harness-unattended-hold-${randomUUID()}`;
    const workspaceId = 'workspace-hold-replay';
    const runtimeWorkflowId = harnessRuntimeId(workspaceId, workflowId);
    const questionId = `${workflowId}:offer-price`;
    const applicationVersion = `harness-expiring-hold-${workflowId}`;
    await createHoldLayoutFixture(
      workflowId,
      applicationVersion,
      'pre_be_bounded_input',
    );
    const skills = await createSmokeSkills(workflowId);
    const ports = smokePorts(workflowId, skills.service, []);
    ports.nameIntent = async () => ({
      declaration: {
        normalizedIntent: '推广本店团购',
        taskType: 'promotion_groupbuy_conversion',
        deliveryLayer: 'copy',
        relevantAssetCategories: ['promotion_activity'],
        usedAssetCategories: [],
        route: 'guidance',
        routingSource: 'model',
        implicitConstraints: [],
      },
      blockingQuestion: {
        questionId,
        workflowId,
        workflowRevision: 1,
        question: '当前团购价是多少？',
        options: [],
        freeText: { enabled: true },
        response: {
          field: 'offer_price',
          reason: '补充当前任务所需的权威事实',
        },
        scope: 'current_task',
      },
    });
    let coreTimeouts = 0;
    let coreHoldExpiries = 0;
    let refunds = 0;
    let recallDue = 0;
    DBOS.setConfig({
      name: 'beauty-marketing-harness-unattended-hold',
      systemDatabaseUrl: systemDatabaseUrl!,
      applicationVersion,
    });
    registerHarnessDbosWorkflow(
      ports,
      {
        async registerPending() {},
        async readPending() {
          return null;
        },
        async recordStageTrace() {},
        async recordTerminalFailure() {},
      },
      {
        billing: {
          async commit() {
            throw new Error('A cancelled hold must not commit usage.');
          },
          async refund() {
            refunds += 1;
          },
          async scheduleCompensation() {
            throw new Error('The refund succeeds in this fixture.');
          },
        },
        config: {
          async get() {
            throw new Error('A recovered hold must use its frozen value.');
          },
        },
        decisions: {
          async submitCoreTimeout() {
            coreTimeouts += 1;
            return { eventId: 'unexpected', replayed: false };
          },
          async submitCoreHoldExpired() {
            coreHoldExpiries += 1;
            return { eventId: 'hold-expired', replayed: false };
          },
        },
        taskRecallDue: {
          async produce() {
            recallDue += 1;
          },
        },
      },
    );

    try {
      await DBOS.launch();
      const handle = DBOS.retrieveWorkflow<{
        delivery: null;
        merchantMessage: string;
        outcome: 'cancelled';
        resolutionSource: 'core_hold_expired';
      }>(runtimeWorkflowId);
      const result = await handle.getResult();
      assert.deepEqual(result, {
        delivery: null,
        merchantMessage: '超时未选择，本次任务已取消，积分已退回',
        outcome: 'cancelled',
        resolutionSource: 'core_hold_expired',
      });
      assert.equal(await waitForWorkflowStatus(handle, 'SUCCESS'), 'SUCCESS');
      assert.equal(coreTimeouts, 0);
      assert.equal(coreHoldExpiries, 1);
      assert.equal(refunds, 1);
      assert.equal(recallDue, 0);
      assert.deepEqual(
        (await DBOS.listWorkflowSteps(runtimeWorkflowId))
          ?.filter((step) => step.functionID >= 4 && step.functionID <= 9)
          .map((step) => [step.functionID, step.name]),
        [
          [4, `persist-pending-${questionId}`],
          [5, 'DBOS.setEvent'],
          [6, 'DBOS.recv'],
          [7, 'DBOS.sleep'],
          [8, `persist-core-hold-expired-${questionId}`],
          [9, 'refund-product-usage'],
        ],
      );
    } finally {
      await DBOS.shutdown({ deregister: true });
    }
  },
);

test(
  'a reserved hold delivers when the merchant answers inside the hold window',
  { skip: !systemDatabaseUrl },
  async () => {
    const workflowId = `harness-held-answer-${randomUUID()}`;
    const workspaceId = 'workspace-held-answer';
    const runtimeWorkflowId = harnessRuntimeId(workspaceId, workflowId);
    const questionId = `${workflowId}:note-style`;
    const skills = await createSmokeSkills(workflowId);
    const ports = smokePorts(workflowId, skills.service, []);
    ports.nameIntent = async () => ({
      declaration: {
        normalizedIntent: '制作两版图文笔记',
        taskType: 'routine_marketing_materials',
        deliveryLayer: 'copy',
        relevantAssetCategories: ['product_service'],
        usedAssetCategories: [],
        route: 'guidance',
        routingSource: 'model',
        implicitConstraints: [],
      },
      blockingQuestion: {
        questionId,
        workflowId,
        workflowRevision: 1,
        question: '这次想采用哪种笔记风格？',
        options: [
          { id: 'style-a', label: '克制专业' },
          { id: 'style-b', label: '轻松种草' },
        ],
        freeText: { enabled: false },
        response: {
          field: 'note_style',
          reason: '选择本次图文笔记的表达风格',
        },
        scope: 'current_task',
      },
    });
    let commits = 0;
    let configReads = 0;
    let expiries = 0;
    DBOS.setConfig({
      name: 'beauty-marketing-harness-held-answer',
      systemDatabaseUrl: systemDatabaseUrl!,
      applicationVersion: 'harness-held-answer-v1',
    });
    const workflow = registerHarnessDbosWorkflow(
      ports,
      {
        async registerPending(_workspaceId, question) {
          autoApprovePaidGenerationConfirmation(
            workspaceId,
            workflowId,
            question,
          );
        },
        async readPending() {
          return null;
        },
        async recordStageTrace() {},
        async recordTerminalFailure() {},
      },
      {
        billing: {
          async commit() {
            commits += 1;
          },
          async refund() {
            throw new Error('A delivered hold must not refund usage.');
          },
          async scheduleCompensation() {
            throw new Error('The commit succeeds in this fixture.');
          },
        },
        config: {
          async get(_scope, _workspaceId, key) {
            configReads += 1;
            return {
              actorId: 'platform-admin',
              correlationId: 'held-answer-config',
              createdAt: '2026-07-26T09:00:00.000Z',
              key,
              reason: 'Keep the hold open for a merchant answer',
              revision: 1,
              rolledBackToRevision: null,
              scope: 'global',
              status: 'applied',
              value: 3_600,
              workspaceId: '__global__',
            };
          },
        },
        decisions: {
          async submitCoreTimeout() {
            throw new Error('A hold must not use continuation timeout.');
          },
          async submitCoreHoldExpired() {
            expiries += 1;
            return { eventId: 'unexpected', replayed: false };
          },
        },
      },
    );

    try {
      await DBOS.launch();
      const handle = await DBOS.startWorkflow(workflow, {
        workflowID: runtimeWorkflowId,
      })({
        workflowId,
        request: {
          ...snapshotTimeoutRequest(workflowId, workspaceId),
          usageReservation: {
            id: `usage-reservation-${workflowId}`,
            units: [{ resource: 'copy', quantity: 1 }],
          },
        },
      });
      await DBOS.getEvent(runtimeWorkflowId, 'pending-structured-decision', {
        timeoutSeconds: 5,
      });
      await assert.rejects(
        resumeHarnessDbosWorkflow(workspaceId, workflowId, {
          questionId,
        }),
      );
      await resumeHarnessDbosWorkflow(workspaceId, workflowId, {
        idempotencyKey: `${questionId}:merchant-answer`,
        questionId,
        workflowRevision: 1,
        patch: {
          field: 'note_style',
          value: 'style-a',
          reason: '选择本次图文笔记的表达风格',
        },
        decision: { state: 'ignored', value: 'style-a' },
      });
      const result = await handle.getResult();
      assert.ok(result.delivery);
      assert.equal(result.delivery.revision, 1);
      assert.equal(await waitForWorkflowStatus(handle, 'SUCCESS'), 'SUCCESS');
      assert.equal(commits, 1);
      assert.equal(configReads, 1);
      assert.equal(expiries, 0);
    } finally {
      await DBOS.shutdown({ deregister: true });
    }
  },
);

test(
  'a pre-T45 pending function-ID layout replays without branching or failure',
  { skip: !systemDatabaseUrl },
  async () => {
    const workflowId = `harness-replay-${randomUUID()}`;
    const workspaceId = 'workspace-replay';
    const runtimeWorkflowId = harnessRuntimeId(workspaceId, workflowId);
    const questionId = `${workflowId}:offer-price`;
    const applicationVersion = `harness-replay-layout-${workflowId}`;
    await createPendingLayoutFixture(workflowId, applicationVersion);
    const skills = await createSmokeSkills(workflowId);
    const ports = smokePorts(workflowId, skills.service, []);
    ports.nameIntent = async () => ({
      declaration: {
        normalizedIntent: '推广本店团购',
        taskType: 'promotion_groupbuy_conversion',
        deliveryLayer: 'copy',
        relevantAssetCategories: ['promotion_activity'],
        usedAssetCategories: [],
        route: 'guidance',
        routingSource: 'model',
        implicitConstraints: [],
      },
      blockingQuestion: {
        questionId,
        workflowId,
        workflowRevision: 1,
        question: '当前团购价是多少？',
        options: [],
        freeText: { enabled: true },
        response: {
          field: 'offer_price',
          reason: '补充当前任务所需的权威事实',
        },
        unattended: 'continue',
        scope: 'current_task',
      },
    });
    const persistence = {
      async registerPending() {},
      async readPending() {
        return null;
      },
      async recordStageTrace() {},
      async recordTerminalFailure() {},
    };
    DBOS.setConfig({
      name: 'beauty-marketing-harness-replay',
      systemDatabaseUrl: systemDatabaseUrl!,
      applicationVersion,
    });
    registerHarnessDbosWorkflow(
      ports,
      persistence,
      {
        config: {
          async get() {
            return {
              actorId: 'platform-admin',
              correlationId: 'replayed-layout',
              createdAt: '2026-07-26T09:01:00.000Z',
              key: 'harness.confirmation_card.timeout_seconds',
              reason: 'Recovered layout must not fork replay',
              revision: 2,
              rolledBackToRevision: null,
              scope: 'global',
              status: 'applied',
              value: 1,
              workspaceId: '__global__',
            };
          },
        },
        decisions: {
          async submitCoreTimeout() {
            throw new Error('Unexpected timeout.');
          },
        },
      },
    );
    try {
      await DBOS.launch();
      assert.deepEqual(
        (await DBOS.listWorkflowSteps(runtimeWorkflowId))
          ?.filter((step) => step.functionID >= 4 && step.functionID <= 7)
          .map((step) => [step.functionID, step.name]),
        [
          [4, `persist-pending-${questionId}`],
          [5, 'DBOS.setEvent'],
          [7, 'DBOS.sleep'],
        ],
      );
      await resumeHarnessDbosWorkflow(workspaceId, workflowId, {
        idempotencyKey: `${questionId}:merchant-answer`,
        questionId,
        workflowRevision: 1,
        patch: {
          field: 'offer_price',
          value: '这次先跳过',
          reason: '补充当前任务所需的权威事实',
        },
        decision: { state: 'ignored', value: '这次先跳过' },
      });
      const recovered = DBOS.retrieveWorkflow<{
        delivery: { revision: number };
      }>(runtimeWorkflowId);
      assert.equal((await recovered.getResult()).delivery.revision, 1);
      assert.equal(await waitForWorkflowStatus(recovered, 'SUCCESS'), 'SUCCESS');
      assert.deepEqual(
        (await DBOS.listWorkflowSteps(runtimeWorkflowId))
          ?.filter((step) => step.functionID >= 4 && step.functionID <= 7)
          .map((step) => [step.functionID, step.name]),
        [
          [4, `persist-pending-${questionId}`],
          [5, 'DBOS.setEvent'],
          [6, 'DBOS.recv'],
          [7, 'DBOS.sleep'],
        ],
      );
    } finally {
      await DBOS.shutdown({ deregister: true });
    }
  },
);

test(
  'a pre-C1 held function-ID layout replays without branching or failure',
  { skip: !systemDatabaseUrl },
  async () => {
    const workflowId = `harness-hold-replay-${randomUUID()}`;
    const workspaceId = 'workspace-hold-replay';
    const runtimeWorkflowId = harnessRuntimeId(workspaceId, workflowId);
    const questionId = `${workflowId}:offer-price`;
    const applicationVersion = `harness-hold-replay-layout-${workflowId}`;
    await createHoldLayoutFixture(workflowId, applicationVersion, 'legacy');
    const skills = await createSmokeSkills(workflowId);
    const ports = smokePorts(workflowId, skills.service, []);
    ports.nameIntent = async () => ({
      declaration: {
        normalizedIntent: '推广本店团购',
        taskType: 'promotion_groupbuy_conversion',
        deliveryLayer: 'copy',
        relevantAssetCategories: ['promotion_activity'],
        usedAssetCategories: [],
        route: 'guidance',
        routingSource: 'model',
        implicitConstraints: [],
      },
      blockingQuestion: {
        questionId,
        workflowId,
        workflowRevision: 1,
        question: '当前团购价是多少？',
        options: [],
        freeText: { enabled: true },
        response: {
          field: 'offer_price',
          reason: '补充当前任务所需的权威事实',
        },
        scope: 'current_task',
      },
    });
    DBOS.setConfig({
      name: 'beauty-marketing-harness-hold-replay',
      systemDatabaseUrl: systemDatabaseUrl!,
      applicationVersion,
    });
    registerHarnessDbosWorkflow(
      ports,
      {
        async registerPending() {},
        async readPending() {
          return null;
        },
        async recordStageTrace() {},
        async recordTerminalFailure() {},
      },
      {
        billing: {
          async commit() {},
          async refund() {
            throw new Error('A recovered hold must not be refunded.');
          },
          async scheduleCompensation() {},
        },
        config: {
          async get() {
            throw new Error('A replayed hold must not read live config.');
          },
        },
        decisions: {
          async submitCoreTimeout() {
            throw new Error('A hold must not use continuation timeout.');
          },
          async submitCoreHoldExpired() {
            throw new Error('A legacy hold must retain its original wait.');
          },
        },
      },
    );
    try {
      await DBOS.launch();
      await resumeHarnessDbosWorkflow(workspaceId, workflowId, {
        idempotencyKey: `${questionId}:merchant-answer`,
        questionId,
        workflowRevision: 1,
        patch: {
          field: 'offer_price',
          value: '这次先跳过',
          reason: '补充当前任务所需的权威事实',
        },
        decision: { state: 'ignored', value: '这次先跳过' },
      });
      const recovered = DBOS.retrieveWorkflow<{
        delivery: { revision: number };
      }>(runtimeWorkflowId);
      assert.equal((await recovered.getResult()).delivery.revision, 1);
      assert.equal(await waitForWorkflowStatus(recovered, 'SUCCESS'), 'SUCCESS');
      assert.equal(
        (await DBOS.listWorkflowSteps(runtimeWorkflowId))?.some(
          (step) =>
            step.functionID === 8 &&
            step.name.startsWith('persist-core-hold-expired-'),
        ),
        false,
      );
    } finally {
      await DBOS.shutdown({ deregister: true });
    }
  },
);

test(
  'a run without a usage reservation never arms core auto-continuation',
  { skip: !systemDatabaseUrl },
  async () => {
    const workflowId = `harness-quota-hold-${randomUUID()}`;
    const workspaceId = 'workspace-quota-hold';
    const runtimeWorkflowId = harnessRuntimeId(workspaceId, workflowId);
    const questionId = `${workflowId}:offer-price`;
    const skills = await createSmokeSkills(workflowId);
    const ports = smokePorts(workflowId, skills.service, []);
    ports.nameIntent = async () => ({
      declaration: {
        normalizedIntent: '推广本店团购',
        taskType: 'promotion_groupbuy_conversion',
        deliveryLayer: 'copy',
        relevantAssetCategories: ['promotion_activity'],
        usedAssetCategories: [],
        route: 'guidance',
        routingSource: 'model',
        implicitConstraints: [],
      },
      blockingQuestion: {
        questionId,
        workflowId,
        workflowRevision: 1,
        question: '当前团购价是多少？',
        options: [],
        freeText: { enabled: true },
        response: {
          field: 'offer_price',
          reason: '补充当前任务所需的权威事实',
        },
        unattended: 'continue',
        scope: 'current_task',
      },
    });
    let configReads = 0;
    let coreTimeouts = 0;
    DBOS.setConfig({
      name: 'beauty-marketing-harness-quota-hold',
      systemDatabaseUrl: systemDatabaseUrl!,
      applicationVersion: 'harness-quota-hold-v1',
    });
    const workflow = registerHarnessDbosWorkflow(
      ports,
      {
        async registerPending() {},
        async readPending() {
          return null;
        },
        async recordStageTrace() {},
        async recordTerminalFailure() {},
      },
      {
        config: {
          async get() {
            configReads += 1;
            return {
              actorId: 'platform-admin',
              correlationId: 'quota-hold-config',
              createdAt: '2026-07-26T09:00:00.000Z',
              key: 'harness.confirmation_card.timeout_seconds',
              reason: 'Would release if the quota guard failed',
              revision: 1,
              rolledBackToRevision: null,
              scope: 'global',
              status: 'applied',
              value: 1,
              workspaceId: '__global__',
            };
          },
        },
        decisions: {
          async submitCoreTimeout() {
            coreTimeouts += 1;
            return { eventId: 'unexpected', replayed: false };
          },
        },
      },
    );

    try {
      await DBOS.launch();
      const handle = await DBOS.startWorkflow(workflow, {
        workflowID: runtimeWorkflowId,
      })({
        workflowId,
        request: snapshotTimeoutRequest(workflowId, workspaceId),
      });
      await DBOS.getEvent(runtimeWorkflowId, 'pending-structured-decision', {
        timeoutSeconds: 5,
      });
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      assert.equal((await handle.getStatus())?.status, 'PENDING');
      assert.equal(configReads, 0);
      assert.equal(coreTimeouts, 0);

      await resumeHarnessDbosWorkflow(workspaceId, workflowId, {
        idempotencyKey: `${questionId}:merchant-answer`,
        questionId,
        workflowRevision: 1,
        patch: {
          field: 'offer_price',
          value: '这次先跳过',
          reason: '补充当前任务所需的权威事实',
        },
        decision: { state: 'ignored', value: '这次先跳过' },
      });
      const result = await handle.getResult();
      assert.ok(result.delivery);
      assert.equal(result.delivery.revision, 1);
      assert.equal(await waitForWorkflowStatus(handle, 'SUCCESS'), 'SUCCESS');
      assert.equal(coreTimeouts, 0);
      assert.deepEqual(
        (await DBOS.listWorkflowSteps(runtimeWorkflowId))
          ?.filter((step) => step.functionID >= 4 && step.functionID <= 7)
          .map((step) => [step.functionID, step.name]),
        [
          [4, `persist-pending-${questionId}`],
          [5, 'DBOS.setEvent'],
          [6, 'DBOS.recv'],
          [7, 'DBOS.sleep'],
        ],
      );
    } finally {
      await DBOS.shutdown({ deregister: true });
    }
  },
);

test(
  'note media admission recovery keeps the wait inside one stable DBOS effect',
  { skip: !systemDatabaseUrl || !databaseUrl },
  async () => {
    const workflowId = `harness-media-admission-${randomUUID()}`;
    const workspaceId = `workspace-media-admission-${workflowId}`;
    const runtimeWorkflowId = harnessRuntimeId(workspaceId, workflowId);
    const applicationVersion = `harness-media-admission-${workflowId}`;
    const pool = new Pool({ connectionString: databaseUrl! });
    const noteAdmission = new PostgresNoteMediaAdmissionCoordinator(pool);
    await noteAdmission.migrate();
    const blocker = await noteAdmission.claim({
      taskId: workflowId,
      workflowId: `blocker-${workflowId}`,
      workspaceId,
    });
    assert.ok(blocker);

    try {
      await createMediaAdmissionCrashFixture(
        workflowId,
        workspaceId,
        applicationVersion,
        'wait',
      );
      DBOS.setConfig({
        name: 'beauty-marketing-harness-media-admission',
        systemDatabaseUrl: systemDatabaseUrl!,
        applicationVersion,
      });
      createMediaAdmissionWorkflow(noteAdmission);
      await DBOS.launch();
      await DBOS.cancelWorkflow(runtimeWorkflowId);

      assert.equal(
        await noteAdmission.markTerminal(blocker, 'completed'),
        true,
      );
      const recovered = await DBOS.resumeWorkflow<HarnessMediaSelectionResult>(
        runtimeWorkflowId,
      );
      const result = await recovered.getResult();
      assert.equal(result.asset?.id, 'image-s6-admission');

      const steps = await DBOS.listWorkflowSteps(runtimeWorkflowId);
      assert.ok(steps);
      assertAdmissionEffectLayout(steps, workflowId);
      const claimRow = await pool.query<{
        generation: string;
        job_id: string | null;
        status: string;
      }>(
        `SELECT generation::text, job_id, status
           FROM harness_runtime.note_media_admission_claims
          WHERE workspace_id = $1 AND task_id = $2`,
        [workspaceId, workflowId],
      );
      assert.deepEqual(claimRow.rows, [
        { generation: '2', job_id: 'job-s6-admission', status: 'completed' },
      ]);
    } finally {
      await pool.query(
        `DELETE FROM harness_runtime.note_media_admission_claims
          WHERE workspace_id = $1 AND task_id = $2`,
        [workspaceId, workflowId],
      );
      await DBOS.shutdown({ deregister: true });
      await pool.end();
    }
  },
);

test(
  'same note media claim resumes idempotently after a crash',
  { skip: !systemDatabaseUrl || !databaseUrl },
  async () => {
    const workflowId = `harness-media-admission-idempotent-${randomUUID()}`;
    const workspaceId = `workspace-media-admission-${workflowId}`;
    const runtimeWorkflowId = harnessRuntimeId(workspaceId, workflowId);
    const applicationVersion = `harness-media-admission-${workflowId}`;
    const pool = new Pool({ connectionString: databaseUrl! });
    const noteAdmission = new PostgresNoteMediaAdmissionCoordinator(pool);
    await noteAdmission.migrate();

    try {
      await createMediaAdmissionCrashFixture(
        workflowId,
        workspaceId,
        applicationVersion,
        'after-claim',
      );
      DBOS.setConfig({
        name: 'beauty-marketing-harness-media-admission',
        systemDatabaseUrl: systemDatabaseUrl!,
        applicationVersion,
      });
      createMediaAdmissionWorkflow(noteAdmission);
      await DBOS.launch();
      const recovered = DBOS.retrieveWorkflow<HarnessMediaSelectionResult>(
        runtimeWorkflowId,
      );
      const result = await recovered.getResult();
      assert.equal(result.asset?.id, 'image-s6-admission');

      const steps = await DBOS.listWorkflowSteps(runtimeWorkflowId);
      assert.ok(steps);
      assertAdmissionEffectLayout(steps, workflowId);
      const claimRow = await pool.query<{
        generation: string;
        job_id: string | null;
        status: string;
      }>(
        `SELECT generation::text, job_id, status
           FROM harness_runtime.note_media_admission_claims
          WHERE workspace_id = $1 AND task_id = $2`,
        [workspaceId, workflowId],
      );
      assert.deepEqual(claimRow.rows, [
        { generation: '1', job_id: 'job-s6-admission', status: 'completed' },
      ]);
    } finally {
      await pool.query(
        `DELETE FROM harness_runtime.note_media_admission_claims
          WHERE workspace_id = $1 AND task_id = $2`,
        [workspaceId, workflowId],
      );
      await DBOS.shutdown({ deregister: true });
      await pool.end();
    }
  },
);

test(
  'terminal note media admission replay is idempotent after the database commit',
  { skip: !systemDatabaseUrl || !databaseUrl },
  async () => {
    const workflowId = `harness-media-admission-terminal-${randomUUID()}`;
    const workspaceId = `workspace-media-admission-${workflowId}`;
    const runtimeWorkflowId = harnessRuntimeId(workspaceId, workflowId);
    const applicationVersion = `harness-media-admission-${workflowId}`;
    const pool = new Pool({ connectionString: databaseUrl! });
    const noteAdmission = new PostgresNoteMediaAdmissionCoordinator(pool);
    await noteAdmission.migrate();

    try {
      await createMediaAdmissionCrashFixture(
        workflowId,
        workspaceId,
        applicationVersion,
        'after-terminal',
      );
      DBOS.setConfig({
        name: 'beauty-marketing-harness-media-admission',
        systemDatabaseUrl: systemDatabaseUrl!,
        applicationVersion,
      });
      createMediaAdmissionWorkflow(noteAdmission);
      await DBOS.launch();
      const recovered = DBOS.retrieveWorkflow<HarnessMediaSelectionResult>(
        runtimeWorkflowId,
      );
      const result = await recovered.getResult();
      assert.equal(result.asset?.id, 'image-s6-admission');
      assert.equal(
        await recovered.getStatus().then((status) => status?.status),
        'SUCCESS',
      );

      const claimRow = await pool.query<{
        generation: string;
        job_id: string | null;
        status: string;
      }>(
        `SELECT generation::text, job_id, status
           FROM harness_runtime.note_media_admission_claims
          WHERE workspace_id = $1 AND task_id = $2`,
        [workspaceId, workflowId],
      );
      assert.deepEqual(claimRow.rows, [
        { generation: '1', job_id: 'job-s6-admission', status: 'completed' },
      ]);
    } finally {
      await pool.query(
        `DELETE FROM harness_runtime.note_media_admission_claims
          WHERE workspace_id = $1 AND task_id = $2`,
        [workspaceId, workflowId],
      );
      await DBOS.shutdown({ deregister: true });
      await pool.end();
    }
  },
);

function legacyTimeoutRequest(workflowId: string, workspaceId: string) {
  return {
    actorId: 'owner-replay',
    workspaceId,
    packageId: `package-${workflowId}`,
    expectedRevision: 0,
    workflowRevision: 1,
    creationMode: 'customized' as const,
    rawInput: '把新团购做一套能发的',
    intent: {
      context: {
        workId: `work-${workflowId}`,
        intent: '把新团购做一套能发的',
        sourceSummaries: [],
      },
      assetReferences: [],
    },
  };
}

function snapshotTimeoutRequest(
  workflowId: string,
  workspaceId: string,
  distributionTarget:
    | 'export'
    | 'manual_copy'
    | 'assisted_handoff' = 'export',
) {
  return {
    ...legacyTimeoutRequest(workflowId, workspaceId),
    executionSnapshot: createCreationExecutionSnapshot(
      {
        actorId: 'owner-replay',
        workspaceId,
        idempotencyKey: `submission-${workflowId}`,
        taskId: workflowId,
        workId: `work-${workflowId}`,
        contentPackageId: `package-${workflowId}`,
        expectedContentPackageRevision: 0,
        creationMode: 'customized',
        intent: '把新团购做一套能发的',
        surface: { id: 'surface-smoke', revision: 'surface-r1' },
        recipe: { id: 'recipe-smoke', revision: 'recipe-r1' },
        lens: 'copy',
        platform: { id: 'xiaohongshu' },
        deliverables: [
          { id: 'copy-main', kind: 'copy', order: 0, quantity: 1 },
        ],
        sources: { assets: [] },
        rights: { revision: 'rights-r1', summary: 'authorized' },
        identity: { id: 'identity-smoke', revision: 'identity-r1' },
        modelPolicy: {
          id: 'policy-smoke',
          revision: 'policy-r1',
          mode: 'auto',
        },
        catalogModel: { id: 'model-smoke', revision: 'model-r1' },
        quote: { id: `quote-${workflowId}`, revision: 'quote-r1' },
        route: { id: 'route-smoke', revision: 'route-r1' },
        briefContext: { id: 'brief-smoke', revision: 1 },
        contentModules: ['social_cover'],
        distributionTarget,
      },
      '2026-07-26T09:00:00.000Z',
    ),
  };
}

function createPendingLayoutFixture(
  workflowId: string,
  applicationVersion: string,
) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        fileURLToPath(
          new URL('./dbos-pending-layout.fixture.ts', import.meta.url),
        ),
      ],
      {
        env: {
          ...process.env,
          T45_REPLAY_APP_VERSION: applicationVersion,
          T45_REPLAY_WORKFLOW_ID: workflowId,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0 && stdout.includes('PENDING_READY')) {
        resolve();
        return;
      }
      reject(
        new Error(
          `Pending-layout fixture failed (${String(code)}): ${stderr || stdout}`,
        ),
      );
    });
  });
}

function createHoldLayoutFixture(
  workflowId: string,
  applicationVersion: string,
  replayMode: 'expiring' | 'legacy' | 'pre_be_bounded_input',
) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        fileURLToPath(
          new URL('./dbos-hold-layout.fixture.ts', import.meta.url),
        ),
      ],
      {
        env: {
          ...process.env,
          C1_HOLD_REPLAY_APP_VERSION: applicationVersion,
          C1_HOLD_REPLAY_MODE: replayMode,
          C1_HOLD_REPLAY_WORKFLOW_ID: workflowId,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0 && stdout.includes('HOLD_PENDING_READY')) {
        resolve();
        return;
      }
      reject(
        new Error(
          `Hold-layout fixture failed (${String(code)}): ${stderr || stdout}`,
        ),
      );
    });
  });
}

function createMediaAdmissionCrashFixture(
  workflowId: string,
  workspaceId: string,
  applicationVersion: string,
  crashMode: MediaAdmissionCrashMode,
) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        fileURLToPath(
          new URL('./dbos-media-admission.process.fixture.ts', import.meta.url),
        ),
      ],
      {
        env: {
          ...process.env,
          S6_MEDIA_ADMISSION_APP_VERSION: applicationVersion,
          S6_MEDIA_ADMISSION_CRASH_MODE: crashMode,
          S6_MEDIA_ADMISSION_WORKFLOW_ID: workflowId,
          S6_MEDIA_ADMISSION_WORKSPACE_ID: workspaceId,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Media admission fixture did not reach its crash point.'));
    }, 15_000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (_code, signal) => {
      clearTimeout(timeout);
      const marker =
        crashMode === 'wait'
          ? 'ADMISSION_WAITING_AFTER_POLL'
          : crashMode === 'after-terminal'
            ? 'ADMISSION_TERMINAL_WRITTEN'
            : 'ADMISSION_CLAIMED';
      if (stdout.includes(marker) && signal === 'SIGKILL') {
        resolve();
        return;
      }
      reject(
        new Error(
          `Media admission fixture failed (${String(signal)}): ${stderr || stdout}`,
        ),
      );
    });
  });
}

function createMakeRestartCrashFixture(
  workflowId: string,
  workspaceId: string,
  applicationVersion: string,
) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        fileURLToPath(
          new URL('./dbos-make-restart.process.fixture.ts', import.meta.url),
        ),
      ],
      {
        env: {
          ...process.env,
          V31_MAKE_RESTART_APP_VERSION: applicationVersion,
          V31_MAKE_RESTART_WORKFLOW_ID: workflowId,
          V31_MAKE_RESTART_WORKSPACE_ID: workspaceId,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Make restart fixture did not commit delivery.'));
    }, 20_000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (_code, signal) => {
      clearTimeout(timeout);
      if (stdout.includes('MAKE_DELIVERY_COMMITTED') && signal === 'SIGKILL') {
        resolve();
        return;
      }
      reject(
        new Error(
          `Make restart fixture failed (${String(signal)}): ${stderr || stdout}`,
        ),
      );
    });
  });
}

function assertAdmissionEffectLayout(
  steps: Awaited<ReturnType<typeof DBOS.listWorkflowSteps>>,
  workflowId: string,
) {
  assert.ok(steps);
  assert.equal(
    steps.some(({ name }) => name === 'DBOS.sleep'),
    false,
  );
  assert.deepEqual(
    steps
      .filter(({ name }) =>
        name.startsWith('admission-') || name.startsWith('submit-'),
      )
      .map(({ functionID, name }) => [functionID, name]),
    [
      [0, `admission-claim-harness-media-${workflowId}-image`],
      [1, `submit-harness-media-${workflowId}-image`],
      [2, `admission-running-harness-media-${workflowId}-image`],
      [3, `admission-terminal-harness-media-${workflowId}-image-completed`],
    ],
  );
}

async function waitForWorkflowStatus(
  handle: {
    getStatus(): Promise<{ status?: string } | null>;
  },
  expected: string,
) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const status = (await handle.getStatus())?.status;
    if (status === expected) return status;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return (await handle.getStatus())?.status;
}

/** D-164③: auto-approve paid generation confirmation so later assertions stay focused. */
function autoApprovePaidGenerationConfirmation(
  workspaceId: string,
  workflowId: string,
  question: QuestionCard,
) {
  if (!question.executionConfirmationAuthority) {
    return false;
  }
  queueMicrotask(() => {
    void resumeHarnessDbosWorkflow(workspaceId, workflowId, {
      idempotencyKey: `auto-approve-paid-generation:${question.questionId}`,
      questionId: question.questionId,
      workflowRevision: question.workflowRevision,
      patch: {
        field: question.response.field,
        value: 'approved',
        reason: question.response.reason,
      },
      decision: { state: 'accepted', value: 'approved' },
    });
  });
  return true;
}

const SMOKE_PRIVATE_INSTRUCTION =
  'F21 private Skill instruction must never enter DBOS step output.';

function smokePorts(
  workflowId: string,
  skills: SkillService,
  providerSkillRefs: string[][],
): HarnessStagePorts {
  const context = {
    bundle: {
      bundleId: 'bundle-smoke',
      revision: 1,
      hash: 'a'.repeat(64),
      serializerVersion: 'context-bundle-c14n-v1' as const,
      workspaceId: 'workspace-smoke',
      taskId: workflowId,
      frozenAt: '2026-07-18T00:00:00.000Z',
      frozenBy: 'owner-smoke',
      previousRevision: null,
      referencedFactRevisions: [],
      sourceRevisions: {
        facts: 0,
        assets: 0,
        identity: 0,
        rights: 0,
        preferences: 0,
        recipe: 0,
        platformRules: 0,
        currentSignal: 1,
      },
      dimensions: {
        promotion_task: {},
        traffic_opportunity: {},
        expression_identity: {},
        platform_mechanism: {},
        store_facts_assets: {},
        conversion_action: {},
      },
    },
    policyReferences: { sourceRefs: [], rightsRefs: [], identityRefs: [] },
  };
  return {
    async resolveStageSkills(input) {
      const instructions = input.skillRevisionRefs
        ? await skills.resolveFrozenRevisions(input.skillRevisionRefs)
        : (
            await skills.resolveStage({
              stage: input.stage,
              userSelectedSkillRefs: [],
              workflowRevisionRef: 'workflow.copy@1',
            })
          ).allowlist;
      const receipts = await skills.recordPromptMaterializationReceipts({
        instructions,
        stage: input.stage,
        taskId: workflowId,
        workflowRevisionRef: 'workflow.copy@1',
        workspaceId: 'workspace-smoke',
      });
      return {
        instructions,
        receipts,
      };
    },
    async nameIntent(input) {
      providerSkillRefs.push(
        input.skillInstructions?.map(
          ({ skillRevisionRef }) => skillRevisionRef,
        ) ?? [],
      );
      return {
        declaration: {
          normalizedIntent: '推广本店团购',
          taskType: 'promotion_groupbuy_conversion',
          deliveryLayer: 'copy',
          relevantAssetCategories: ['promotion_activity'],
          usedAssetCategories: ['promotion_activity'],
          route: 'customized',
          routingSource: 'model',
          implicitConstraints: [],
        },
        blockingQuestion: {
          questionId: `${workflowId}:s1:offer_price`,
          workflowId,
          workflowRevision: 1,
          question: '本次团购的当前价格是多少？',
          options: [],
          freeText: { enabled: true },
          response: {
            field: 'offer_price',
            reason: '补充当前任务所需的权威事实',
          },
          scope: 'current_task',
        },
      };
    },
    async injectContext() {
      return context;
    },
    async fenceContext() {
      return context;
    },
    async compileBrief() {
      return {
        kind: 'copy',
        instructions:
          '基于当前有效的门店事实生成可直接发布的团购文案，明确服务价值、适用人群、预约动作与事实边界，不编造价格、效果或顾客案例，并保留必要的审核信息。',
        platform: 'xiaohongshu',
        cta: '私信预约',
        factRefs: [],
        assetRefs: [],
        identityRefs: [],
        constraints: [],
      };
    },
    async executeAndSelect() {
      return {
        candidates: [
          {
            candidateId: 'c01',
            title: '新团购体验',
            body: '到店了解当前团购服务，按你的需求确认适合项目。',
            conversionHook: '私信预约',
            score: 90,
          },
        ],
        winner: {
          candidateId: 'c01',
          title: '新团购体验',
          body: '到店了解当前团购服务，按你的需求确认适合项目。',
          conversionHook: '私信预约',
        },
        trace: {
          stage: 'execution_selection',
          winnerCandidateId: 'c01',
          candidateScores: [],
          blockedCandidates: [],
          rubricVersion: 'copy-quality-v1',
          rubricHash: 'smoke-rubric',
        },
      };
    },
    async assembleAndDeliver() {
      return {
        packageId: 'package-smoke',
        versionId: 'version-smoke',
        revision: 1,
      };
    },
  };
}

async function createSmokeSkills(workflowId: string) {
  const repository = new MemorySkillRepository();
  const service = new SkillService(
    repository,
    () => '2026-07-26T09:00:00.000Z',
  );
  await repository.putCatalog({
    activeRevisionRef: 'skill.intent-one@2',
    actorId: 'operator-smoke',
    createdAt: '2026-07-26T09:00:00.000Z',
    name: 'F21 smoke Skill',
    description: 'Draft daily industry copy for a store.',
    sourceKind: 'authored',
    tier: 'platform',
    presentationPolicy: 'backend_only',
    publicationGeneration: 0,
    skillId: 'skill.intent-one',
    updatedAt: '2026-07-26T09:00:00.000Z',
  });
  await repository.putRevision(
    smokeSkillRevision(1, 'Earlier private instruction.'),
    null,
  );
  await repository.putRevision(
    smokeSkillRevision(2, SMOKE_PRIVATE_INSTRUCTION),
    1,
  );
  await service.bindRevision({
    bindingId: `binding.smoke-v2-${workflowId}`,
    mode: 'required',
    skillRevisionRef: 'skill.intent-one@2',
    triggerCondition: { harnessStage: 'intent_naming' },
    workflowRevisionRef: 'workflow.copy@1',
  });
  return {
    foundation: new SkillFoundationModule(service),
    service,
  };
}

function smokeSkillRevision(
  revision: number,
  instruction: string,
): SkillRevision {
  return {
    formatVersion: 2,
    acceptedAt: '2026-07-26T09:00:00.000Z',
    acceptedBy: 'operator-smoke',
    contentHash: `hash-skill-${revision}`,
    createdAt: '2026-07-26T09:00:00.000Z',
    createdBy: 'operator-smoke',
    evalRunId: `eval-smoke-${revision}`,
    instruction,
    manifest: {
      description:
        'Applies a frozen smoke-test instruction. Use in DBOS replay tests.',
      name: 'f21-smoke',
    },
    packagePaths: ['SKILL.md'],
    governance: {
      budget: {
        maxChildEffects: 0,
        maxCostCents: 0,
        timeoutMs: 10_000,
      },
      contextScopes: [],
      executionMode: 'prompt_materialized',
      fallback: 'fail_closed',
      inputSchemaRef: 'skill-input.intent@1',
      outputSchemaRef: 'skill-output.intent@1',
      requiredModelCapabilities: ['structured_output'],
      sideEffectClass: 'none',
      workflowRevisionRefs: ['workflow.copy@1'],
    },
    prompt: {
      // The Skill service verifies the fallback pin for real, so the fixture
      // hash must be the production-producible value, not a placeholder.
      contentHash: createHash('sha256').update(instruction).digest('hex'),
      content: instruction,
      isFallback: false,
      label: 'production',
      name: 'skills/f21-smoke',
      source: 'langfuse',
      version: String(revision),
    },
    revision,
    skillId: 'skill.intent-one',
    skillRevisionRef: `skill.intent-one@${revision}`,
    status: 'accepted_frozen',
  };
}
