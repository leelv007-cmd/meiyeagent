import { DBOS } from '@dbos-inc/dbos-sdk';

import { registerHarnessDbosWorkflow } from './dbos-workflow.js';
import { harnessRuntimeId } from './workspace-scope.js';
import type { HarnessStagePorts } from './workflow-core.js';

const systemDatabaseUrl = process.env.TEST_DBOS_SYSTEM_DATABASE_URL;
const workflowId = process.env.T45_REPLAY_WORKFLOW_ID;
const applicationVersion = process.env.T45_REPLAY_APP_VERSION;
if (!systemDatabaseUrl || !workflowId || !applicationVersion) {
  throw new Error('T45 replay fixture requires DBOS URL, workflow ID and app version.');
}
const workspaceId = 'workspace-replay';
const runtimeWorkflowId = harnessRuntimeId(workspaceId, workflowId);
DBOS.setConfig({
  name: 'beauty-marketing-harness-replay',
  systemDatabaseUrl,
  applicationVersion,
});
const workflow = registerHarnessDbosWorkflow(
  fixturePorts(workflowId),
  {
    async registerPending() {},
    async readPending() {
      return null;
    },
    async recordStageTrace() {},
    async recordTerminalFailure() {},
  },
  undefined,
  undefined,
  {
    async get() {
      return {
        actorId: 'platform-admin',
        correlationId: 'legacy-layout',
        createdAt: '2026-07-26T09:00:00.000Z',
        key: 'harness.confirmation_card.timeout_seconds',
        reason: 'Keep the legacy run pending',
        revision: 1,
        rolledBackToRevision: null,
        scope: 'global',
        status: 'applied',
        value: 300,
        workspaceId: '__global__',
      };
    },
  },
  { async submitCoreTimeout() { throw new Error('Unexpected timeout.'); } },
);
await DBOS.launch();
await DBOS.startWorkflow(workflow, {
  workflowID: runtimeWorkflowId,
})({
  workflowId,
  request: {
    actorId: 'owner-replay',
    workspaceId,
    packageId: `package-${workflowId}`,
    expectedRevision: 0,
    workflowRevision: 1,
    creationMode: 'customized',
    rawInput: '把新团购做一套能发的',
    intent: {
      context: {
        workId: `work-${workflowId}`,
        intent: '把新团购做一套能发的',
        sourceSummaries: [],
      },
      assetReferences: [],
    },
  },
});
await DBOS.getEvent(runtimeWorkflowId, 'pending-structured-decision', {
  timeoutSeconds: 5,
});
for (let attempt = 0; attempt < 100; attempt += 1) {
  const steps = await DBOS.listWorkflowSteps(runtimeWorkflowId);
  if (steps?.some((step) => step.functionID === 6 && step.name === 'DBOS.sleep')) {
    process.stdout.write('PENDING_READY\n');
    process.exit(0);
  }
  await new Promise((resolve) => setTimeout(resolve, 20));
}
throw new Error('Legacy pending layout did not persist its durable recv deadline.');

function fixturePorts(taskId: string): HarnessStagePorts {
  const context = {
    bundle: {
      bundleId: 'bundle-replay',
      revision: 1,
      hash: 'a'.repeat(64),
      serializerVersion: 'context-bundle-c14n-v1' as const,
      workspaceId: 'workspace-replay',
      taskId,
      frozenAt: '2026-07-18T00:00:00.000Z',
      frozenBy: 'owner-replay',
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
    async injectContext() {
      return context;
    },
    async fenceContext() {
      return context;
    },
    async compileBrief() {
      return {
        kind: 'copy',
        instructions: '生成可直接发布的团购文案。',
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
            body: '到店了解当前团购服务。',
            conversionHook: '私信预约',
            score: 90,
          },
        ],
        winner: {
          candidateId: 'c01',
          title: '新团购体验',
          body: '到店了解当前团购服务。',
          conversionHook: '私信预约',
        },
        trace: {
          stage: 'execution_selection',
          winnerCandidateId: 'c01',
          candidateScores: [],
          blockedCandidates: [],
          rubricVersion: 'copy-quality-v1',
          rubricHash: 'replay-rubric',
        },
      };
    },
    async assembleAndDeliver() {
      return {
        packageId: `package-${taskId}`,
        versionId: `version-${taskId}`,
        revision: 1,
      };
    },
  };
}
