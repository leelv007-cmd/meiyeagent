import assert from 'node:assert/strict';
import test from 'node:test';

import { createMarketingPackageEvidence } from './marketing-package-evidence.js';
import type { IntentDeclaration } from './structured-nodes.js';
import type { HarnessContextSnapshot } from './workflow-core.js';

test('new marketing evidence retains only structured declaration and eligible authorized current facts', () => {
  const evidence = createMarketingPackageEvidence({
    declaration: declaration(),
    context: context(),
    authorizedFactRefs: [
      'store_fact:service-current:1',
      'store_fact:price-noncurrent-layer:1',
      'store_fact:group-buy-wrong-pool:1',
    ],
    at: '2026-07-27T12:00:00.000Z',
  });

  assert.deepEqual(evidence.factRefs, ['store_fact:service-current:1']);
  assert.deepEqual(evidence.rightsRefs, ['asset-authorized-1']);
  assert.deepEqual(evidence.identityRefs, ['marketing_identity:brand-1:2']);
  assert.deepEqual(evidence.declaration, declaration());
  assert.equal('capabilities' in evidence, false);
  assert.equal('promotionOffer' in evidence, false);
  assert.equal('opportunity' in evidence, false);
  assert.equal('materialSpecs' in evidence, false);
});

function declaration(): IntentDeclaration {
  return {
    normalizedIntent: '介绍本店已确认的护理服务',
    taskType: 'daily_service_exposure',
    deliveryLayer: 'copy',
    relevantAssetCategories: ['product_service'],
    usedAssetCategories: ['product_service'],
    route: 'customized',
    routingSource: 'model',
    implicitConstraints: ['只引用当前已确认事实'],
  };
}

function context(): HarnessContextSnapshot {
  return {
    bundle: {
      bundleId: 'bundle-1',
      revision: 1,
      hash: 'a'.repeat(64),
      serializerVersion: 'context-bundle-c14n-v1',
      workspaceId: 'workspace-1',
      taskId: 'task-1',
      frozenAt: '2026-07-27T11:00:00.000Z',
      frozenBy: 'owner-1',
      previousRevision: null,
      referencedFactRevisions: [
        { factId: 'service-current', revision: 1 },
        { factId: 'price-noncurrent-layer', revision: 1 },
        { factId: 'group-buy-wrong-pool', revision: 1 },
      ],
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
        promotion_task: {},
        traffic_opportunity: {},
        expression_identity: {},
        platform_mechanism: {},
        store_facts_assets: {
          service: factContribution({
            factId: 'service-current',
            kind: 'service',
            key: 'service',
            layer: 'current_fact',
            pool: 'store_personal',
          }),
          noncurrent: factContribution({
            factId: 'price-noncurrent-layer',
            kind: 'price',
            key: 'price',
            layer: 'confirmed_asset',
            pool: 'store_personal',
          }),
          wrongPool: factContribution({
            factId: 'group-buy-wrong-pool',
            kind: 'group_buy',
            key: 'group_buy',
            layer: 'current_fact',
            pool: 'industry',
          }),
        },
        conversion_action: {},
      },
    },
    activeFacts: [
      {
        key: 'service',
        value: '头皮护理',
        sourceRef: 'store_fact:service-current:1',
        effectiveFrom: '2026-07-27T00:00:00.000Z',
        expiresAt: null,
      },
      {
        key: 'price',
        value: 398,
        sourceRef: 'store_fact:price-noncurrent-layer:1',
        effectiveFrom: '2026-07-27T00:00:00.000Z',
        expiresAt: null,
      },
      {
        key: 'group_buy',
        value: 298,
        sourceRef: 'store_fact:group-buy-wrong-pool:1',
        effectiveFrom: '2026-07-27T00:00:00.000Z',
        expiresAt: null,
      },
    ],
    policyReferences: {
      sourceRefs: [
        {
          id: 'store_fact:service-current:1',
          workspaceId: 'workspace-1',
          revision: 1,
          status: 'current',
        },
        {
          id: 'store_fact:price-noncurrent-layer:1',
          workspaceId: 'workspace-1',
          revision: 1,
          status: 'current',
        },
        {
          id: 'store_fact:group-buy-wrong-pool:1',
          workspaceId: 'workspace-1',
          revision: 1,
          status: 'current',
        },
      ],
      rightsRefs: [
        {
          assetId: 'asset-authorized-1',
          workspaceId: 'workspace-1',
          status: 'authorized',
          allowedUses: ['public_content'],
        },
      ],
      identityRefs: [
        {
          id: 'marketing_identity:brand-1:2',
          workspaceId: 'workspace-1',
          status: 'registered',
        },
      ],
    },
  };
}

function factContribution(input: {
  factId: string;
  kind: 'service' | 'price' | 'group_buy';
  key: string;
  layer: 'current_fact' | 'confirmed_asset';
  pool: 'store_personal' | 'industry';
}) {
  return {
    value: input.key,
    layer: input.layer,
    pool: input.pool,
    sourceRef: `store_fact:${input.factId}:1`,
    factSnapshot: {
      factId: input.factId,
      kind: input.kind,
      revision: 1,
      source: {
        kind: 'user_confirmation' as const,
        referenceId: `confirmation:${input.factId}`,
        capturedAt: '2026-07-27T00:00:00.000Z',
      },
      effectiveFrom: '2026-07-27T00:00:00.000Z',
      expiresAt: null,
    },
  };
}
