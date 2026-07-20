import assert from 'node:assert/strict';
import test from 'node:test';
import { contentPackageSchema, type ContextBundle } from '@meiye/contracts';

import { buildContentPackage } from './content-package.js';
import {
  ContentPackageDeliveryError,
  ContextBundleApprovalPolicyResolver,
} from './content-package-delivery.js';

const timestamp = '2026-07-18T00:00:00.000Z';

test('delivery approval rejects a price revision newer than the frozen package', async () => {
  const resolver = createResolver({ identityRevision: 1, factRevision: 2 });
  await assert.rejects(
    resolver.resolve({
      contentPackage: contentPackage(),
      intendedUse: 'public_content',
      variantVersionId: 'xiaohongshu-v1',
    }),
    (error: unknown) =>
      error instanceof ContentPackageDeliveryError &&
      error.code === 'APPROVAL_CONTEXT_UNAVAILABLE',
  );
});

test('delivery approval rejects an identity head newer than the frozen package', async () => {
  const resolver = createResolver({ identityRevision: 2, factRevision: 1 });
  await assert.rejects(
    resolver.resolve({
      contentPackage: contentPackage(),
      intendedUse: 'public_content',
      variantVersionId: 'xiaohongshu-v1',
    }),
    /Facts or identity changed/u,
  );
});

function createResolver(input: {
  identityRevision: number;
  factRevision: number;
}) {
  return new ContextBundleApprovalPolicyResolver(
    { async get() { return bundle(); } },
    {
      sourceRevisions: {
        async current() {
          return {
            facts: 0,
            assets: 0,
            identity: input.identityRevision,
            rights: 0,
            preferences: 0,
            recipe: 0,
            platformRules: 0,
            currentSignal: 0,
          };
        },
      },
      facts: {
        async history() {
          return [
            {
              factId: 'price-1',
              workspaceId: 'workspace-1',
              kind: 'price' as const,
              key: 'offer.price',
              value: 398,
              scope: { storeId: 'workspace-1' },
              source: {
                kind: 'user_confirmation' as const,
                referenceId: 'decision-1',
                capturedAt: timestamp,
              },
              effectiveFrom: timestamp,
              expiresAt: null,
              revision: input.factRevision,
              recordedAt: timestamp,
              recordedBy: 'owner-1',
            },
          ];
        },
      },
      now: () => '2026-07-18T01:00:00.000Z',
    },
  );
}

function contentPackage() {
  const draft = buildContentPackage({
    id: 'package-1',
    workspaceId: 'workspace-1',
    kind: 'image_text',
    source: { assetIds: [], workflowId: 'workflow-1' },
    timestamp,
  });
  return contentPackageSchema.parse({
    ...draft,
    status: 'accepted',
    variants: ['xiaohongshu', 'douyin', 'video_account'].map((platform) => ({
      id: `${platform}-variant`,
      platform,
      currentVersionId: `${platform}-v1`,
      versions: [
        {
          id: `${platform}-v1`,
          title: 'Title',
          body: 'Body',
          orderedAssetIds: [],
          topics: [],
          createdAt: timestamp,
        },
      ],
    })),
  });
}

function bundle(): ContextBundle {
  return {
    bundleId: 'context-workflow-1',
    revision: 1,
    hash: 'a'.repeat(64),
    serializerVersion: 'context-bundle-c14n-v1',
    workspaceId: 'workspace-1',
    taskId: 'workflow-1',
    sourceRevisions: {
      facts: 'frozen-facts-hash',
      assets: 0,
      identity: 1,
      rights: 0,
      preferences: 0,
      recipe: 0,
      platformRules: 0,
      currentSignal: 0,
    },
    dimensions: {
      promotion_task: {},
      traffic_opportunity: {},
      expression_identity: {},
      platform_mechanism: {},
      store_facts_assets: {
        'offer.price': {
          value: 398,
          layer: 'current_fact',
          pool: 'store_personal',
          sourceRef: 'store_fact:price-1:1',
        },
      },
      conversion_action: {},
    },
    referencedFactRevisions: [{ factId: 'price-1', revision: 1 }],
    frozenAt: timestamp,
    frozenBy: 'owner-1',
    previousRevision: null,
  };
}
