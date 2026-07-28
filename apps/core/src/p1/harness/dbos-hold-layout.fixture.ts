import { DBOS } from '@dbos-inc/dbos-sdk';
import {
  workflowProgressEnvelopeSchema,
  workflowTokenEnvelopeSchema,
  type StructuredDecisionInput,
} from '@meiye/contracts';

import { createCreationExecutionSnapshot } from '../execution-spine/creation-execution-snapshot.js';
import {
  normalizeHarnessDbosWorkflowInput,
  type HarnessDbosWorkflowInput,
} from './dbos-workflow.js';
import { harnessRuntimeId } from './workspace-scope.js';
import {
  runHarnessWorkflow,
  type HarnessStagePorts,
  type HarnessWorkflowRuntime,
} from './workflow-core.js';

const systemDatabaseUrl = process.env.TEST_DBOS_SYSTEM_DATABASE_URL;
const workflowId = process.env.C1_HOLD_REPLAY_WORKFLOW_ID;
const applicationVersion = process.env.C1_HOLD_REPLAY_APP_VERSION;
const replayMode = process.env.C1_HOLD_REPLAY_MODE ?? 'legacy';
if (!systemDatabaseUrl || !workflowId || !applicationVersion) {
  throw new Error(
    'C1 hold replay fixture requires DBOS URL, workflow ID and app version.',
  );
}
if (replayMode !== 'legacy' && replayMode !== 'expiring') {
  throw new Error('C1 hold replay fixture mode must be legacy or expiring.');
}

const workspaceId = 'workspace-hold-replay';
const runtimeWorkflowId = harnessRuntimeId(workspaceId, workflowId);
const progressStream = 'progress';
DBOS.setConfig({
  name: 'beauty-marketing-harness-hold-replay',
  systemDatabaseUrl,
  applicationVersion,
});
const workflow = DBOS.registerWorkflow(
  async (input: HarnessDbosWorkflowInput) => {
    const normalized = normalizeHarnessDbosWorkflowInput(
      input,
      runtimeWorkflowId,
    );
    const request = normalized.request;
    const runtime: HarnessWorkflowRuntime = {
      runStep(effectIdempotencyKey, operation) {
        return DBOS.runStep(operation, {
          name: effectIdempotencyKey.replaceAll(':', '-'),
        });
      },
      awaitSignal<T>(topic: string, options: { timeoutSeconds: number }) {
        return DBOS.recv<T>(topic, options);
      },
      async progress(event) {
        const occurredAt = new Date(await DBOS.now()).toISOString();
        await DBOS.writeStream(
          progressStream,
          workflowProgressEnvelopeSchema.parse({
            eventId: `${workflowId}:progress:${event.sequence}`,
            workflowId,
            workflowType: 'beauty_marketing_harness',
            sourceRevision: request.workflowRevision,
            ...event,
            occurredAt,
          }),
        );
      },
      async token(event) {
        const occurredAt = new Date(await DBOS.now()).toISOString();
        await DBOS.writeStream(
          progressStream,
          workflowTokenEnvelopeSchema.parse({
            eventId: `${workflowId}:token:${event.sequence}`,
            workflowId,
            sourceRevision: request.workflowRevision,
            ...event,
            occurredAt,
          }),
        );
      },
      async hasRegisteredPendingQuestion() {
        return false;
      },
      async awaitDecision(question) {
        await DBOS.runStep(
          async () => ({
            timeoutSeconds: null,
            ...(replayMode === 'expiring' ? { holdTimeoutSeconds: 1 } : {}),
          }),
          { name: `persist-pending-${question.questionId}` },
        );
        await DBOS.setEvent('pending-structured-decision', question);
        if (replayMode === 'expiring') {
          const decision = await DBOS.recv<StructuredDecisionInput>(
            `structured-decision:${question.questionId}`,
            { timeoutSeconds: 1 },
          );
          return decision
            ? { command: decision, resolutionSource: 'decision' as const }
            : {
                cancelled: true as const,
                merchantMessage: '超时未选择，本次任务已取消，额度已退回',
                resolutionSource: 'core_hold_expired' as const,
              };
        }
        for (;;) {
          const decision = await DBOS.recv<StructuredDecisionInput>(
            `structured-decision:${question.questionId}`,
            { timeoutSeconds: 1 },
          );
          if (decision) {
            return { command: decision, resolutionSource: 'decision' as const };
          }
        }
      },
      recordTrace(input) {
        return DBOS.runStep(async () => undefined, {
          name: `persist-${input.stage}-trace`,
        });
      },
    };
    return runHarnessWorkflow(
      workflowId,
      request,
      holdFixturePorts(workflowId),
      runtime,
    );
  },
  { name: 'beautyMarketingHarnessWorkflow' },
);
await DBOS.launch();
await DBOS.startWorkflow(workflow, {
  workflowID: runtimeWorkflowId,
})({
  workflowId,
  request: {
    actorId: 'owner-hold-replay',
    workspaceId,
    packageId: `package-${workflowId}`,
    expectedRevision: 0,
    workflowRevision: 1,
    creationMode: 'customized',
    rawInput: '制作两版图文笔记',
    executionSnapshot: createCreationExecutionSnapshot(
      {
        actorId: 'owner-hold-replay',
        workspaceId,
        idempotencyKey: `submission-${workflowId}`,
        taskId: workflowId,
        workId: `work-${workflowId}`,
        contentPackageId: `package-${workflowId}`,
        expectedContentPackageRevision: 0,
        creationMode: 'customized',
        intent: '制作两版图文笔记',
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
      },
      '2026-07-26T09:00:00.000Z',
    ),
    usageReservation: {
      id: `usage-reservation-${workflowId}`,
      units: [{ resource: 'copy', quantity: 1 }],
    },
    intent: {
      context: {
        workId: `work-${workflowId}`,
        intent: '制作两版图文笔记',
        sourceSummaries: [],
      },
      assetReferences: [],
    },
  },
});
await DBOS.getEvent(runtimeWorkflowId, 'pending-structured-decision', {
  timeoutSeconds: 5,
});
for (let attempt = 0; attempt < 200; attempt += 1) {
  const steps = await DBOS.listWorkflowSteps(runtimeWorkflowId);
  const readyFunctionId = replayMode === 'expiring' ? 7 : 9;
  if (
    steps?.some(
      (step) =>
        step.functionID === readyFunctionId && step.name === 'DBOS.sleep',
    )
  ) {
    process.stdout.write('HOLD_PENDING_READY\n');
    process.exit(0);
  }
  await new Promise((resolve) => setTimeout(resolve, 20));
}
throw new Error('Legacy hold layout did not persist the expected recv cycle.');

function holdFixturePorts(taskId: string): HarnessStagePorts {
  const unreachable = async (): Promise<never> => {
    throw new Error('Hold layout fixture advanced past its pending question.');
  };
  return {
    async nameIntent() {
      return {
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
          questionId: `${taskId}:offer-price`,
          workflowId: taskId,
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
      };
    },
    injectContext: unreachable,
    fenceContext: unreachable,
    compileBrief: unreachable,
    executeAndSelect: unreachable,
    assembleAndDeliver: unreachable,
  };
}
