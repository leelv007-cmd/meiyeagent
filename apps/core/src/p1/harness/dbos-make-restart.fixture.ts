import { DBOS } from '@dbos-inc/dbos-sdk';
import { harnessReleaseIdSchema } from '@meiye/contracts';
import type { Pool } from 'pg';

import { createCreationExecutionSnapshot } from '../execution-spine/creation-execution-snapshot.js';
import { createCanonicalCarrierUnitRecipeRegistry } from './carrier-unit-recipes.js';
import {
  buildExecutionPlanSnapshot,
  freezeExecutionPlanContent,
} from './execution-plan-admission.js';
import { registerHarnessDbosWorkflow } from './dbos-workflow.js';
import type { HarnessWorkflowPersistence } from './dbos-workflow.js';
import type { HarnessStagePorts } from './workflow-core.js';

export const MAKE_RESTART_APP_NAME = 'beauty-marketing-harness-make-restart';

export async function migrateMakeRestartReceipt(pool: Pool) {
  await pool.query(
    `create table if not exists p1_make_restart_delivery_receipts (
       effect_key text primary key,
       workflow_id text not null,
       package_id text not null,
       revision bigint not null,
       created_at timestamptz not null default now()
     )`,
  );
}

export function createMakeRestartWorkflow(input: {
  crashAfterDeliveryCommit: boolean;
  persistence?: HarnessWorkflowPersistence;
  pool: Pool;
  workflowId: string;
  workspaceId: string;
}) {
  const ports = makeRestartPorts(input);
  return registerHarnessDbosWorkflow(
    ports,
    input.persistence ?? {
      async registerPending() {},
      async readPending() {
        return null;
      },
      async recordStageTrace() {},
      async recordTerminalFailure() {},
    },
  );
}

export function makeRestartRequest(workflowId: string, workspaceId: string) {
  const executionSnapshot = createCreationExecutionSnapshot(
    {
      actorId: 'owner-make-restart',
      workspaceId,
      idempotencyKey: `submission-${workflowId}`,
      taskId: workflowId,
      workId: `work-${workflowId}`,
      contentPackageId: `package-${workflowId}`,
      expectedContentPackageRevision: 0,
      creationMode: 'customized',
      intent: '生成一条可发布的门店活动文案',
      surface: { id: 'surface-make-restart', revision: 'surface-r1' },
      recipe: { id: 'recipe-make-restart', revision: 'recipe-r1' },
      lens: 'copy',
      platform: { id: 'xiaohongshu' },
      deliverables: [
        { id: 'copy-main', kind: 'copy', order: 0, quantity: 1 },
      ],
      sources: { assets: [] },
      rights: { revision: 'rights-r1', summary: 'authorized' },
      identity: { id: 'identity-make-restart', revision: 'identity-r1' },
      modelPolicy: { id: 'policy-make-restart', revision: 'policy-r1', mode: 'auto' },
      catalogModel: { id: 'model-make-restart', revision: 'model-r1' },
      quote: { id: `quote-${workflowId}`, revision: 'quote-r1' },
      route: { id: 'route-make-restart', revision: 'route-r1' },
      briefContext: { id: 'brief-make-restart', revision: 1 },
      contentModules: ['social_cover'],
    },
    '2026-08-09T00:00:00.000Z',
  );
  const content = {
    planId: `plan-${workflowId}`,
    planRevision: 1,
    intentDeclaration: { summary: '门店活动文案' },
    contextBundleRef: {
      bundleId: `bundle-${workflowId}`,
      revision: 1,
      hash: 'a'.repeat(64),
    },
    executionPlan: createCanonicalCarrierUnitRecipeRegistry().resolve('copy').plan,
    deliverables: [{ deliverableId: 'copy-main', kind: 'copy', quantity: 1 }],
    promptRevisionRefs: {},
    skillManifestRefs: {},
    routeRequirements: [],
    quoteRef: { id: `quote-${workflowId}`, revision: 1 },
    rightsRevisionRefs: ['rights-r1'],
    factRevisionRefs: [],
    boundedExecution: {
      schemaVersion: 'bounded-execution-snapshot/v1' as const,
      maxIterations: 10,
      maxCostCents: 100,
      maxWallClockMs: 60_000,
      maxDelegations: 2,
      requiredLimits: ['maxIterations', 'maxCostCents'] as const,
      consumption: {
        iterations: 0,
        costCents: 0,
        wallClockMs: 0,
        delegations: 0,
      },
      stopReason: null,
      triggeredLimit: null,
    },
    harnessReleaseId: harnessReleaseIdSchema.parse('make-restart-v1'),
    approvalBasis: 'policy_exempt_copy' as const,
  };
  const { snapshotHash } = freezeExecutionPlanContent(content as never);
  return {
    workflowId,
    request: {
      actorId: executionSnapshot.actorId,
      workspaceId,
      packageId: executionSnapshot.contentPackage.id,
      expectedRevision: executionSnapshot.contentPackage.expectedRevision,
      workflowRevision: executionSnapshot.revision,
      creationMode: executionSnapshot.creationMode,
      rawInput: executionSnapshot.intent.text,
      intent: {
        context: {
          workId: executionSnapshot.work.id,
          intent: executionSnapshot.intent.text,
          sourceSummaries: [],
        },
        assetReferences: [],
      },
      executionSnapshot,
      executionPlanSnapshot: buildExecutionPlanSnapshot({
        content: content as never,
        snapshotHash,
      }),
    },
  };
}

function makeRestartPorts(input: {
  crashAfterDeliveryCommit: boolean;
  pool: Pool;
  workflowId: string;
  workspaceId: string;
}): HarnessStagePorts {
  const context = {
    bundle: {
      bundleId: `bundle-${input.workflowId}`,
      revision: 1,
      hash: 'a'.repeat(64),
      serializerVersion: 'context-bundle-c14n-v1' as const,
      workspaceId: input.workspaceId,
      taskId: input.workflowId,
      frozenAt: '2026-08-09T00:00:00.000Z',
      frozenBy: 'owner-make-restart',
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
          normalizedIntent: '门店活动文案',
          taskType: 'routine_marketing_materials',
          deliveryLayer: 'copy',
          relevantAssetCategories: [],
          usedAssetCategories: [],
          route: 'customized',
          routingSource: 'policy',
          implicitConstraints: [],
        },
        blockingQuestion: null,
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
        instructions: '生成一条可发布的门店活动文案',
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
            candidateId: 'candidate-make-restart',
            title: '门店活动',
            body: '到店了解活动详情。',
            conversionHook: '私信预约',
            score: 90,
          },
        ],
        winner: {
          candidateId: 'candidate-make-restart',
          title: '门店活动',
          body: '到店了解活动详情。',
          conversionHook: '私信预约',
        },
        trace: {
          stage: 'execution_selection',
          winnerCandidateId: 'candidate-make-restart',
          candidateScores: [],
          blockedCandidates: [],
          rubricVersion: 'make-restart-v1',
          rubricHash: 'make-restart-rubric',
        },
      };
    },
    async assembleAndDeliver() {
      const effectKey = `make-delivery:${input.workflowId}`;
      await input.pool.query(
        `insert into p1_make_restart_delivery_receipts
           (effect_key, workflow_id, package_id, revision)
         values ($1, $2, $3, 1)
         on conflict (effect_key) do nothing`,
        [effectKey, input.workflowId, `package-${input.workflowId}`],
      );
      if (input.crashAfterDeliveryCommit) {
        process.stdout.write('MAKE_DELIVERY_COMMITTED\n', () => {
          process.kill(process.pid, 'SIGKILL');
        });
        await new Promise<never>(() => {});
      }
      return {
        packageId: `package-${input.workflowId}`,
        versionId: `version-${input.workflowId}`,
        revision: 1,
      };
    },
  };
}
