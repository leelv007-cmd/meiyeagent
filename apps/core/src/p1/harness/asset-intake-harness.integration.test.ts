import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AssetIntakeService,
  MemoryAssetIntakeRepository,
} from '../operations/asset-intake-service.js';
import { MemoryContextBundleRepository } from '../operations/context-bundle-repository.js';
import { MemoryStoreFactLedger } from '../operations/store-fact-ledger.js';
import type {
  StructuredNodeRunner,
  StructuredNodeRunnerRequest,
} from '../model-supply/structured-node-runner.js';
import { LedgerBackedHarnessContextPort } from './production-context-port.js';
import { assessRecipeFactSatisfaction } from './fact-satisfaction.js';
import {
  ProductionHarnessStagePorts,
  type HarnessCopyDeliveryPort,
} from './production-stage-ports.js';
import { runHarnessWorkflow } from './workflow-core.js';
import {
  frozenHarnessPrompt,
  frozenHarnessPromptBundle,
} from './frozen-prompt.testing.js';

const now = '2026-07-18T09:00:00.000Z';
const factRef = 'store_fact:fact-price:1';

test('corrected intake fact is the only price in the next frozen Task, output and trace', async () => {
  const facts = new MemoryStoreFactLedger();
  const bundles = new MemoryContextBundleRepository();
  const intake = new AssetIntakeService(
    new MemoryAssetIntakeRepository(),
    facts,
    () => now,
  );
  await intake.recordBatch({
    batchId: 'batch-price',
    taskId: 'task-intake',
    workspaceId: 'workspace-a',
    source: {
      sourceId: 'source-price-list',
      kind: 'price_list',
      referenceId: 'upload-price-list',
      capabilityStatus: 'assisted',
      sourceWorkspaceId: 'workspace-a',
      capturedAt: now,
      example: false,
    },
    summary: 'One pending price.',
    candidates: [
      {
        candidateId: 'candidate-price',
        objectKind: 'store_fact',
        status: 'pending',
        fact: priceFact(239, 'screenshot_extraction', 'upload-price-list'),
      },
    ],
    createdAt: now,
  });
  await intake.correctFact(
    { workspaceId: 'workspace-a', userId: 'owner-a' },
    {
      batchId: 'batch-price',
      candidateId: 'candidate-price',
      correctedFact: priceFact(299, 'user_confirmation', 'decision-price'),
      idempotencyKey: 'correct-price',
    },
  );
  await intake.confirmFact(
    { workspaceId: 'workspace-a', userId: 'owner-a' },
    {
      batchId: 'batch-price',
      candidateId: 'candidate-price',
      factId: 'fact-price',
      expectedFactRevision: 0,
      idempotencyKey: 'confirm-price',
    },
  );

  const runner = new QueueRunner([
    {
      normalizedIntent: '按已确认价格推广当前团购',
      taskType: 'promotion_groupbuy_conversion',
      deliveryLayer: 'copy',
      relevantAssetCategories: ['promotion_activity'],
      usedAssetCategories: [],
      route: 'guidance',
      implicitConstraints: ['Price must use the frozen fact.'],
      blockingGap: {
        field: 'offer_price',
        question: '这次团购价按哪个金额写？',
        options: [],
        allowFreeText: true,
        scope: 'current_task',
      },
    },
    {
      kind: 'copy',
      instructions:
        'Generate grounded Xiaohongshu copy from the current confirmed price fact, with a clear service value, target audience, booking action, and no invented prices, outcomes, qualifications, cases, or unauthorized assets.',
      platform: 'xiaohongshu',
      cta: '私信预约',
      factRefs: [factRef],
      assetRefs: [],
      identityRefs: [],
      constraints: ['Price must use the frozen fact.'],
    },
    candidate('当前团购价 299 元，私信预约。'),
    candidate('门店已确认团购价 299 元，可私信预约。'),
    candidate('本次团购价 299 元，欢迎私信预约。'),
    score(95),
    score(90),
    score(85),
  ]);
  const delivery = new RecordingDelivery();
  const ports = new ProductionHarnessStagePorts({
    core: {
      runners: { create: () => runner },
      context: new LedgerBackedHarnessContextPort(facts, bundles, () => now),
      delivery: delivery,
      now: () => now,
    },
  });
  ports.assessFacts = async (input) =>
    assessRecipeFactSatisfaction(
      {
        workflowId: input.workflowId,
        workflowRevision: input.request.workflowRevision,
        intent: input.declaration.normalizedIntent,
        factTypes: ['price'],
        bundle: input.context.bundle,
        at: now,
        prompts: {
          factSatisfaction: frozenHarnessPrompt('factSatisfaction'),
          factCriticality: frozenHarnessPrompt('factCriticality'),
        },
      },
      new QueueRunner([
        {
          status: 'satisfied',
          matchedFactRefs: [factRef],
          missingFactTypes: [],
        },
      ]),
      {
        async isAuthorized() {
          return true;
        },
      },
    );
  const traces: unknown[] = [];
  const result = await runHarnessWorkflow(
    'task-after-correction',
    {
      // task-admission freezes a pin for every prompt site the task's packs
      // claim, so a request without prompts is a state production cannot reach.
      prompts: frozenHarnessPromptBundle(),
      actorId: 'owner-a',
      workspaceId: 'workspace-a',
      packageId: 'package-after-correction',
      expectedRevision: 0,
      workflowRevision: 1,
      creationMode: 'customized',
      rawInput: '按已确认价格写团购文案。',
      factScope: {
        storeId: 'workspace-a',
        serviceId: 'scalp-clean',
      },
      intent: {
        context: {
          workId: 'work-after-correction',
          intent: '按已确认价格写团购文案。',
          sourceSummaries: [],
        },
        assetReferences: [],
      },
    },
    ports,
    {
      async runStep(_key, operation) {
        return operation();
      },
      async progress() {},
      async token() {},
      async awaitDecision() {
        throw new Error('No QuestionCard is expected for a confirmed price.');
      },
      async recordTrace(trace) {
        traces.push(trace);
      },
    },
  );

  const bundle = await bundles.get(
    'workspace-a',
    'context-task-after-correction',
    1,
  );
  assert.deepEqual(bundle?.dimensions.store_facts_assets['offer.price'], {
    value: { amount: 299, currency: 'CNY' },
    layer: 'current_fact',
    pool: 'store_personal',
    sourceRef: factRef,
    factSnapshot: {
      factId: 'fact-price',
      kind: 'price',
      revision: 1,
      source: {
        kind: 'user_confirmation',
        referenceId: 'decision-price',
        capturedAt: now,
      },
      effectiveFrom: now,
      expiresAt: null,
    },
  });
  assert.deepEqual(bundle?.referencedFactRevisions, [
    { factId: 'fact-price', revision: 1 },
  ]);
  assert.equal(delivery.inputs[0]?.winner.body.includes('299'), true);
  assert.deepEqual(result.recommendation.decisionTrace.factReferences, [
    factRef,
  ]);
  const downstreamEvidence = JSON.stringify({
    bundle,
    modelRequests: runner.requests,
    delivery: delivery.inputs,
    traces,
    result,
  });
  assert.equal(downstreamEvidence.includes('239'), false);
  assert.ok(bundle);
  const satisfaction = await assessRecipeFactSatisfaction(
    {
      workflowId: 'task-after-correction',
      workflowRevision: 1,
      intent: '按已确认价格写团购文案。',
      factTypes: ['price'],
      bundle,
      at: now,
      prompts: {
        factSatisfaction: frozenHarnessPrompt('factSatisfaction'),
        factCriticality: frozenHarnessPrompt('factCriticality'),
      },
    },
    new QueueRunner([
      {
        status: 'satisfied',
        matchedFactRefs: [factRef],
        missingFactTypes: [],
      },
    ]),
    { async isAuthorized() { return true; } },
  );
  assert.equal(satisfaction.action, 'execute');
});

class QueueRunner implements StructuredNodeRunner {
  readonly requests: StructuredNodeRunnerRequest<unknown>[] = [];

  constructor(private readonly outputs: unknown[]) {}

  async run<Output>(request: StructuredNodeRunnerRequest<Output>) {
    this.requests.push(request as StructuredNodeRunnerRequest<unknown>);
    return {
      output: request.schema.parse(this.outputs.shift()),
      attempts: 1,
      providerTaskRef: `provider-${this.requests.length}`,
      replayed: false,
      usage: { inputTokens: 1, outputTokens: 1 },
    };
  }
}

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

function priceFact(
  amount: number,
  kind: 'screenshot_extraction' | 'user_confirmation',
  referenceId: string,
) {
  return {
    kind: 'price' as const,
    key: 'offer.price',
    value: { amount, currency: 'CNY' },
    scope: { storeId: 'workspace-a', serviceId: 'scalp-clean' },
    source: { kind, referenceId, capturedAt: now },
    effectiveFrom: now,
    expiresAt: null,
  };
}

function candidate(body: string) {
  return {
    title: '新团购上线',
    body,
    conversionHook: '私信预约',
    factClaims: [{ kind: 'price', value: '299 CNY', sourceRef: factRef }],
    assetRefs: [],
  };
}

function score(value: number) {
  return {
    score: value,
    dimensions: { grounding: 1, usefulness: 1, platformFit: 1 },
    reason: 'Grounded fixture score.',
  };
}
