import assert from 'node:assert/strict';
import test from 'node:test';

import { projectMarketingPackageEvidence } from './marketing-scene-policy.js';
import type { HarnessWorkflowInput } from './task-admission.js';
import {
  nameHarnessIntent,
  type IntentDeclaration,
  type StructuredNodeRunner,
  type StructuredNodeRunnerRequest,
} from './structured-nodes.js';
import type { HarnessContextSnapshot } from './workflow-core.js';

test('promotion without frozen price or benefit stays unpriced and has no digits', () => {
  const evidence = projectMarketingPackageEvidence({
    declaration: declaration('promotion_groupbuy_conversion'),
    request: request('promotion'),
    context: context(),
    at: '2026-07-18T00:00:00.000Z',
  });

  assert.equal(evidence.promotionOffer?.status, 'unpriced');
  assert.equal(
    /\d/u.test(JSON.stringify(evidence.promotionOffer)),
    false,
  );
  assert.equal(evidence.promotionOffer?.callToAction.mode, 'manual');
});

test('promotion exposes only current frozen offer facts and verified CTA endpoints', () => {
  const snapshot = context();
  snapshot.activeFacts = [
    {
      key: 'offer.price',
      value: { amount: 398, currency: 'CNY' },
      sourceRef: 'store_fact:price-1:2',
      effectiveFrom: '2026-07-18T00:00:00.000Z',
      expiresAt: '2026-07-20T00:00:00.000Z',
    },
    {
      key: 'booking.endpoint',
      value: 'https://example.com/book',
      sourceRef: 'store_fact:booking-1:1',
      effectiveFrom: '2026-07-18T00:00:00.000Z',
      expiresAt: null,
    },
  ];
  snapshot.policyReferences.sourceRefs = [
    {
      id: 'store_fact:price-1:2',
      workspaceId: 'workspace-1',
      revision: 2,
      status: 'current',
    },
    {
      id: 'store_fact:booking-1:1',
      workspaceId: 'workspace-1',
      revision: 1,
      status: 'current',
    },
  ];
  const evidence = projectMarketingPackageEvidence({
    declaration: declaration('promotion_groupbuy_conversion'),
    request: request('promotion'),
    context: snapshot,
    at: '2026-07-18T00:00:00.000Z',
  });

  assert.equal(evidence.promotionOffer?.priceText, '398 元');
  assert.deepEqual(evidence.promotionOffer?.sourceRefs, [
    'store_fact:price-1:2',
    'store_fact:booking-1:1',
  ]);
  assert.equal(evidence.promotionOffer?.callToAction.mode, 'actionable');
});

test('traffic without a user source returns evergreen fallback instead of a hot topic', () => {
  const evidence = projectMarketingPackageEvidence({
    declaration: declaration('traffic_opportunity'),
    request: request('帮我做一条同城内容'),
    context: context(),
    at: '2026-07-18T00:00:00.000Z',
  });

  assert.equal(evidence.opportunity?.status, 'evergreen_fallback');
  assert.equal(evidence.opportunity?.protectedExpressionCopied, false);
  assert.deepEqual(evidence.opportunity?.matchedStoreReferences, []);
});

test('parsed user URL and screenshot inputs project matched active opportunity cards', async () => {
  const snapshot = context();
  snapshot.policyReferences.sourceRefs = [
    {
      id: 'store_fact:service-1:2',
      workspaceId: 'workspace-1',
      revision: 2,
      status: 'current',
    },
  ];
  const parsedTrafficIntent = {
    taskType: 'traffic_opportunity' as const,
    deliveryLayer: 'copy' as const,
    implicitConstraints: ['仅复用热点机制，不复制受保护表达'],
    blockingGap: null,
  };
  const linkRequest = request(
    '参考这个同城热点做本店原创角度：https://example.com/city-trend',
  );
  const linkNaming = await nameHarnessIntent(
    {
      workflowId: 'workflow-hot-link',
      workflowRevision: 1,
      intent: linkRequest.intent,
    },
    new FixtureStructuredNodeRunner(parsedTrafficIntent),
  );
  const linkEvidence = projectMarketingPackageEvidence({
    declaration: linkNaming.declaration,
    request: linkRequest,
    context: snapshot,
    at: '2026-07-18T08:00:00.000Z',
  });
  const screenshotRequest = request('参考这张热点截图做本店版本');
  screenshotRequest.intent.assetReferences = ['hot-topic-screenshot-asset-1'];
  const screenshotNaming = await nameHarnessIntent(
    {
      workflowId: 'workflow-hot-screenshot',
      workflowRevision: 1,
      intent: screenshotRequest.intent,
    },
    new FixtureStructuredNodeRunner(parsedTrafficIntent),
  );
  const screenshotEvidence = projectMarketingPackageEvidence({
    declaration: screenshotNaming.declaration,
    request: screenshotRequest,
    context: snapshot,
    at: '2026-07-18T08:00:00.000Z',
  });

  assert.deepEqual(
    {
      status: linkEvidence.opportunity?.status,
      source: linkEvidence.opportunity?.source,
      sourceType: linkEvidence.opportunity?.sourceType,
      matches: linkEvidence.opportunity?.matchedStoreReferences,
      capturedAt: linkEvidence.opportunity?.capturedAt,
      expiresAt: linkEvidence.opportunity?.expiresAt,
    },
    {
      status: 'active',
      source: 'https://example.com/city-trend',
      sourceType: 'user_link',
      matches: ['store_fact:service-1:2'],
      capturedAt: '2026-07-18T08:00:00.000Z',
      expiresAt: '2026-07-19T08:00:00.000Z',
    },
  );
  assert.deepEqual(
    {
      status: screenshotEvidence.opportunity?.status,
      source: screenshotEvidence.opportunity?.source,
      sourceType: screenshotEvidence.opportunity?.sourceType,
      matches: screenshotEvidence.opportunity?.matchedStoreReferences,
    },
    {
      status: 'active',
      source: 'hot-topic-screenshot-asset-1',
      sourceType: 'user_screenshot',
      matches: ['store_fact:service-1:2'],
    },
  );
  assert.match(
    linkEvidence.opportunity?.relevanceExplanation ?? '',
    /可追溯信号.*门店事实/u,
  );
});

class FixtureStructuredNodeRunner implements StructuredNodeRunner {
  constructor(private readonly output: unknown) {}

  async run<Output>(request: StructuredNodeRunnerRequest<Output>) {
    return {
      output: request.schema.parse(this.output),
      attempts: 1,
      providerTaskRef: 'fixture-structured-task',
      replayed: false,
      usage: { inputTokens: 10, outputTokens: 20 },
    };
  }
}

test('material package freezes the four first-release Light Composer specs', () => {
  const evidence = projectMarketingPackageEvidence({
    declaration: declaration('routine_marketing_materials'),
    request: request('做一组宣传物料'),
    context: context(),
    at: '2026-07-18T00:00:00.000Z',
  });

  assert.deepEqual(
    evidence.materialSpecs?.map(({ purpose, width, height }) => ({
      purpose,
      width,
      height,
    })),
    [
      { purpose: 'xiaohongshu_cover', width: 1242, height: 1660 },
      { purpose: 'douyin_cover', width: 1080, height: 1440 },
      { purpose: 'wechat_moments_poster', width: 1080, height: 1080 },
      { purpose: 'offline_a4_poster', width: 2480, height: 3508 },
    ],
  );
});

function declaration(taskType: IntentDeclaration['taskType']): IntentDeclaration {
  return { taskType, deliveryLayer: 'copy' as const, implicitConstraints: [] };
}

function request(rawInput: string): HarnessWorkflowInput {
  return {
    actorId: 'owner-1',
    workspaceId: 'workspace-1',
    packageId: 'package-1',
    expectedRevision: 0,
    workflowRevision: 1,
    rawInput,
    intent: {
      context: { workId: 'work-1', intent: rawInput, sourceSummaries: [] },
      assetReferences: [],
    },
  };
}

function context(): HarnessContextSnapshot {
  return {
    bundle: {
      bundleId: 'bundle-1',
      revision: 1,
      hash: 'a'.repeat(64),
      serializerVersion: 'context-bundle-c14n-v1' as const,
      workspaceId: 'workspace-1',
      taskId: 'task-1',
      frozenAt: '2026-07-18T00:00:00.000Z',
      frozenBy: 'owner-1',
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
    activeFacts: [],
    policyReferences: { sourceRefs: [], rightsRefs: [], identityRefs: [] },
  };
}
