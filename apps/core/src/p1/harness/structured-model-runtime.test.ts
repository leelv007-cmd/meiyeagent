import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ModelSupplyApplicationService,
  modelRuntimeAssemblyFromEnv,
} from '../model-supply/index.js';
import { ModelSupplyStructuredNodeRunner } from '../model-supply/structured-node-runner.js';
import {
  HARNESS_FIXTURE_STRUCTURED_MODEL_WARNING,
  createHarnessStructuredModelExecutor,
} from './structured-model-runtime.js';
import {
  ProductionHarnessStagePorts,
  type HarnessCopyDeliveryPort,
} from './production-stage-ports.js';
import { runHarnessWorkflow } from './workflow-core.js';

test('fixture harness runtime assembles and completes its structured model path', async () => {
  const catalog = modelRuntimeAssemblyFromEnv({
    APP_ENV: 'e2e',
    MODEL_EXECUTION_MODE: 'fixture',
  });
  const warnings: string[] = [];
  const executor = createHarnessStructuredModelExecutor(
    catalog.runtime,
    (message) => warnings.push(message),
  );
  const application = new ModelSupplyApplicationService({
    deployments: catalog.deployments,
    execution: catalog.runtime.execution,
    models: catalog.models,
    runtimeCapabilities: catalog.runtimeCapabilities,
  });
  const delivery = new RecordingDelivery();
  const ports = new ProductionHarnessStagePorts(
    {
      create({ workspaceId, actorId }) {
        return new ModelSupplyStructuredNodeRunner({
          application,
          executor,
          workspaceId,
          actorId,
          selection: { mode: 'auto', profile: 'quality' },
        });
      },
    },
    {
      async compileAndFreeze() {
        return contextSnapshot();
      },
      async fence(input) {
        return input.context;
      },
    },
    delivery,
    () => '2026-07-18T00:01:00.000Z',
  );
  let pendingQuestionField: string | undefined;
  const tokens: Array<{
    candidateId?: string;
    channel: string;
    delta: string;
    sequence: number;
  }> = [];

  const result = await runHarnessWorkflow(
    'fixture-harness-task',
    taskInput(),
    ports,
    {
      async runStep(_key, operation) {
        return operation();
      },
      async progress() {},
      async token(token) {
        tokens.push(token);
      },
      async awaitDecision(question) {
        pendingQuestionField = question.response.field;
        return {
          idempotencyKey: 'fixture-decision-1',
          questionId: question.questionId,
          workflowRevision: question.workflowRevision,
          patch: {
            field: question.response.field,
            value: '299 元',
            reason: question.response.reason,
          },
          decision: { state: 'accepted', value: '299 元' },
        };
      },
      async recordTrace() {},
    },
  );

  assert.deepEqual(warnings, [HARNESS_FIXTURE_STRUCTURED_MODEL_WARNING]);
  assert.equal(pendingQuestionField, 'promotion_details');
  assert.equal(result.deliveryLayer, 'copy');
  assert.equal(result.trace.winnerCandidateId, 'c01');
  assert.equal(delivery.inputs.length, 1);
  assert.ok(tokens.length >= 9);
  assert.deepEqual(
    [...new Set(tokens.map(({ channel }) => channel))],
    ['copy.title', 'copy.body', 'copy.cta'],
  );
  assert.deepEqual(
    tokens.map(({ sequence }) => sequence),
    [...tokens.keys()].map((index) => index + 5),
  );
});

test('production harness without a live direct model retains the hard failure', () => {
  const catalog = modelRuntimeAssemblyFromEnv({
    APP_ENV: 'production',
    MODEL_EXECUTION_MODE: 'recorded',
  });

  assert.throws(
    () => createHarnessStructuredModelExecutor(catalog.runtime),
    new Error(
      'Harness production runtime requires a live direct structured model.',
    ),
  );
});

class RecordingDelivery implements HarnessCopyDeliveryPort {
  readonly inputs: Array<
    Parameters<HarnessCopyDeliveryPort['deliverCopyRevision']>[0]
  > = [];

  async deliverCopyRevision(
    input: Parameters<HarnessCopyDeliveryPort['deliverCopyRevision']>[0],
  ) {
    this.inputs.push(input);
    return { packageId: input.packageId, versionId: 'version-1', revision: 1 };
  }
}

function taskInput() {
  return {
    actorId: 'owner-fixture',
    workspaceId: 'workspace-fixture',
    packageId: 'package-fixture',
    expectedRevision: 0,
    workflowRevision: 1,
    creationMode: 'customized' as const,
    rawInput: '把新团购做成一条可以发的小红书文案',
    intent: {
      context: {
        workId: 'work-fixture',
        intent: '把新团购做成一条可以发的小红书文案',
        sourceSummaries: [],
      },
      assetReferences: [],
    },
  };
}

function contextSnapshot() {
  return {
    bundle: {
      bundleId: 'bundle-fixture',
      revision: 1,
      hash: 'a'.repeat(64),
      serializerVersion: 'context-bundle-c14n-v1' as const,
      workspaceId: 'workspace-fixture',
      taskId: 'fixture-harness-task',
      frozenAt: '2026-07-18T00:00:00.000Z',
      frozenBy: 'owner-fixture',
      previousRevision: null,
      referencedFactRevisions: [],
      sourceRevisions: {
        facts: 1,
        assets: 1,
        identity: 1,
        rights: 1,
        preferences: 1,
        recipe: 1,
        platformRules: 1,
        currentSignal: 1,
      },
      dimensions: {
        promotion_task: {
          task_type: {
            value: 'promotion_groupbuy_conversion',
            layer: 'current_instruction' as const,
            pool: 'current_signal' as const,
            sourceRef: 'task:fixture-harness-task:intent',
          },
        },
        traffic_opportunity: {},
        expression_identity: {},
        platform_mechanism: {},
        store_facts_assets: {},
        conversion_action: {},
      },
    },
    policyReferences: { sourceRefs: [], rightsRefs: [], identityRefs: [] },
  };
}
