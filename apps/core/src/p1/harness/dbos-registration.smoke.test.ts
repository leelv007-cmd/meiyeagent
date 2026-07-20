import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { DBOS } from '@dbos-inc/dbos-sdk';

import { HarnessWorkflowEventSource } from '../workflow-events.js';
import { HarnessDbosWorkflowEventReader } from './dbos-workflow-events.js';
import {
  normalizeHarnessDbosWorkflowInput,
  registerHarnessDbosWorkflow,
} from './dbos-workflow.js';
import { harnessRuntimeId } from './workspace-scope.js';
import type { HarnessStagePorts } from './workflow-core.js';

const systemDatabaseUrl = process.env.TEST_DBOS_SYSTEM_DATABASE_URL;

test('registered workflow accepts both legacy and scoped invocation payloads', () => {
  const request = {
    actorId: 'owner-smoke',
    workspaceId: 'workspace-smoke',
    packageId: 'package-smoke',
    expectedRevision: 0,
    workflowRevision: 1,
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
    const traces: string[] = [];
    DBOS.setConfig({
      name: 'beauty-marketing-harness-smoke',
      systemDatabaseUrl: systemDatabaseUrl!,
      applicationVersion: 'harness-smoke-v1',
    });
    const workflow = registerHarnessDbosWorkflow(smokePorts(), {
      async registerPending() {},
      async recordStageTrace(input) {
        traces.push(input.stage);
      },
      async recordTerminalFailure() {},
    });

    try {
      await DBOS.launch();
      const handle = await DBOS.startWorkflow(workflow, {
        workflowID: harnessRuntimeId('workspace-smoke', workflowId),
      })({
        workflowId,
        request: {
          actorId: 'owner-smoke',
          workspaceId: 'workspace-smoke',
          packageId: 'package-smoke',
          expectedRevision: 0,
          workflowRevision: 1,
          rawInput: '把新团购做一套能发的',
          intent: {
            context: {
              workId: 'work-smoke',
              intent: '把新团购做一套能发的',
              sourceSummaries: [],
            },
            assetReferences: [],
          },
        },
      });

      const result = await handle.getResult();
      assert.equal(result.delivery.revision, 1);
      assert.equal(result.trace.winnerCandidateId, 'c01');
      assert.deepEqual(traces, [
        'intent_naming',
        'context_injection',
        'brief_compilation',
        'execution_selection',
        'assembly_delivery',
      ]);
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
          'workflow.state',
        ],
      );
      assert.equal(events.at(-1)?.data.sourceRevision, 1);
    } finally {
      await DBOS.shutdown({ deregister: true });
    }
  },
);

function smokePorts(): HarnessStagePorts {
  const context = {
    bundle: {
      bundleId: 'bundle-smoke',
      revision: 1,
      hash: 'a'.repeat(64),
      serializerVersion: 'context-bundle-c14n-v1' as const,
      workspaceId: 'workspace-smoke',
      taskId: 'task-smoke',
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
    async nameIntent() {
      return {
        declaration: {
          taskType: 'promotion_groupbuy_conversion',
          deliveryLayer: 'copy',
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
