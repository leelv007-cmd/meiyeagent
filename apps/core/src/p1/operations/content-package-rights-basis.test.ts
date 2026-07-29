import assert from 'node:assert/strict';
import test from 'node:test';

import { contentPackageSchema, type ContentPackage } from '@meiye/contracts';

import {
  ContentPackageRightsBasisError,
  ContentPackageRightsBasisResolver,
} from './content-package-rights-basis.js';
import { buildVideoPlatformVariants } from '../harness/output-compiler.js';
import { LOCAL_FIXTURE_COMMERCIAL_USE_TERMS_SUFFIX } from '../supply-registry/expand.js';

const CREATED_AT = '2026-07-30T08:00:00.000Z';

test('resolves exact current source authorizations without treating generation receipts as rights', async () => {
  const resolver = new ContentPackageRightsBasisResolver(
    {
      async resolve(input) {
        assert.equal(input.platform, 'douyin');
        return {
          knownAssetIds: ['source-asset-1'],
          unauthorizedAssetIds: [],
        };
      },
    },
    {
      async getRegistryRevision() {
        throw new Error('Source authorization must not consult generation terms.');
      },
    },
  );
  const contentPackage = generatedVideoPackage({
    sourceAssetIds: ['source-asset-1'],
    rightsRefs: ['source-asset-1'],
  });

  assert.deepEqual(
    await resolver.resolve({
      contentPackage,
      platform: 'douyin',
      version: contentPackage.versions[0]!,
      workspaceId: contentPackage.workspaceId,
    }),
    {
      kind: 'source_asset_authorizations',
      rightsRefs: ['source-asset-1'],
    },
  );
});

test('resolves source-free generated video rights from one completed generation and historical supply contract chain', async () => {
  const contentPackage = generatedVideoPackage();
  const historicalVersion = {
    ...contentPackage.versions[0]!,
    id: 'version-video-douyin-r1',
  };
  contentPackage.variants = buildVideoPlatformVariants({
    currentVersionId: 'version-video-douyin-r2',
    packageId: contentPackage.id,
    versions: [
      historicalVersion,
      {
        ...historicalVersion,
        id: 'version-video-douyin-r2',
      },
    ],
  });
  const douyinVariant = contentPackage.variants.find(
    (variant) => variant.platform === 'douyin',
  )!;
  const douyinHistoricalVersion = douyinVariant.versions.find(
    (version) => version.id === `${historicalVersion.id}-douyin`,
  )!;
  const resolver = generationTermsResolver();

  assert.deepEqual(
    await resolver.resolve({
      contentPackage,
      platform: 'douyin',
      version: douyinHistoricalVersion,
      workspaceId: contentPackage.workspaceId,
    }),
    {
      commercialUse: 'allowed',
      generatedAssetId: 'generated-video-1',
      kind: 'ai_generation_terms',
      providerTaskRef: 'provider-task-1',
      runId: 'generation-run-1',
      termsRevisionId: 'terms-provider-1-r7',
    },
  );
});

test('accepts fixture-seeded commercial terms only in the explicit local fixture runtime', async () => {
  const contentPackage = generatedVideoPackage();
  const termsRevisionId =
    `terms-provider-1-r7${LOCAL_FIXTURE_COMMERCIAL_USE_TERMS_SUFFIX}`;

  await assert.rejects(
    () =>
      generationTermsResolver({
        commercialUse: 'allowed',
        termsRevisionId,
      }).resolve({
        contentPackage,
        platform: 'douyin',
        version: contentPackage.versions[0]!,
        workspaceId: contentPackage.workspaceId,
      }),
    ContentPackageRightsBasisError,
  );

  const fixtureBasis = await generationTermsResolver(
    {
      commercialUse: 'allowed',
      termsRevisionId,
    },
    { allowLocalFixtureTerms: true },
  ).resolve({
    contentPackage,
    platform: 'douyin',
    version: contentPackage.versions[0]!,
    workspaceId: contentPackage.workspaceId,
  });
  assert.equal(fixtureBasis.kind, 'ai_generation_terms');
  assert.equal(
    fixtureBasis.kind === 'ai_generation_terms'
      ? fixtureBasis.termsRevisionId
      : undefined,
    termsRevisionId,
  );
});

test('rejects a variant version outside the selected platform rights scope', async () => {
  const contentPackage = generatedVideoPackage();
  contentPackage.variants = buildVideoPlatformVariants({
    currentVersionId: contentPackage.versions[0]!.id,
    packageId: contentPackage.id,
    versions: contentPackage.versions,
  });
  const xiaohongshuVersion = contentPackage.variants.find(
    (variant) => variant.platform === 'xiaohongshu',
  )!.versions[0]!;
  const foreignPackage = generatedVideoPackage();
  foreignPackage.id = 'package-video-foreign';
  foreignPackage.versions[0]!.id = 'version-video-foreign';

  for (const version of [
    xiaohongshuVersion,
    foreignPackage.versions[0]!,
  ]) {
    await assert.rejects(
      () =>
        generationTermsResolver().resolve({
          contentPackage,
          platform: 'douyin',
          version,
          workspaceId: contentPackage.workspaceId,
        }),
      ContentPackageRightsBasisError,
    );
  }
});

test('fails closed when any source authorization or generation-contract link is missing, stale, or mismatched', async () => {
  const cases: Array<{
    mutate: (contentPackage: ContentPackage) => void;
    name: string;
    resolver?: ContentPackageRightsBasisResolver;
  }> = [
    {
      name: 'source refs differ from frozen source assets',
      mutate(contentPackage) {
        contentPackage.source.assetIds = ['source-asset-1'];
        contentPackage.marketing!.rightsRefs = [];
      },
    },
    {
      name: 'frozen source asset is no longer authorized',
      mutate(contentPackage) {
        contentPackage.source.assetIds = ['source-asset-1'];
        contentPackage.marketing!.rightsRefs = ['source-asset-1'];
      },
      resolver: new ContentPackageRightsBasisResolver(
        {
          async resolve() {
            return {
              knownAssetIds: ['source-asset-1'],
              unauthorizedAssetIds: ['source-asset-1'],
            };
          },
        },
        {
          async getRegistryRevision() {
            throw new Error(
              'Source authorization must not consult generation terms.',
            );
          },
        },
      ),
    },
    {
      name: 'owned asset task differs from completed attempt',
      mutate(contentPackage) {
        contentPackage.generated.ownedAssets![0]!.sourceTaskRef =
          'provider-task-other';
      },
    },
    {
      name: 'attempt job differs from child run',
      mutate(contentPackage) {
        contentPackage.generated.childRuns[0]!.providerAttempts![0]!.jobId =
          'generation-run-other';
      },
    },
    {
      name: 'attempt deployment differs from frozen route',
      mutate(contentPackage) {
        contentPackage.generated.childRuns[0]!.providerAttempts![0]!.deploymentId =
          'deployment-other';
      },
    },
    {
      name: 'route reference differs from frozen route',
      mutate(contentPackage) {
        contentPackage.generated.childRuns[0]!.routeSnapshotId =
          'route-video-other';
      },
    },
    {
      name: 'generation contract was already expired',
      mutate() {},
      resolver: generationTermsResolver({
        effectiveTo: '2026-07-30T07:59:59.000Z',
      }),
    },
    {
      name: 'generation deployment was not active in the frozen registry',
      mutate() {},
      resolver: generationTermsResolver({
        commercialUse: 'allowed',
        lifecycleStatus: 'inactive',
      }),
    },
    {
      name: 'generation contract lacks commercial-use permission',
      mutate() {},
      resolver: generationTermsResolver({ commercialUse: undefined }),
    },
    {
      name: 'generation contract lacks a terms revision',
      mutate() {},
      resolver: generationTermsResolver({
        commercialUse: 'allowed',
        termsRevisionId: '',
      }),
    },
  ];

  for (const scenario of cases) {
    const contentPackage = generatedVideoPackage();
    scenario.mutate(contentPackage);
    await assert.rejects(
      () =>
        (scenario.resolver ?? generationTermsResolver()).resolve({
          contentPackage,
          platform: 'douyin',
          version: contentPackage.versions[0]!,
          workspaceId: contentPackage.workspaceId,
        }),
      (error: unknown) =>
        error instanceof ContentPackageRightsBasisError &&
        error.code === 'CONTENT_PACKAGE_RIGHTS_BASIS_UNAVAILABLE',
      scenario.name,
    );
  }
});

function generatedVideoPackage(input?: {
  rightsRefs?: string[];
  sourceAssetIds?: string[];
}): ContentPackage {
  return contentPackageSchema.parse({
    compliance: {
      aigcLabelEnabled: true,
      watermarkEnabled: false,
    },
    createdAt: CREATED_AT,
    exportReceipts: [],
    generated: {
      assetIds: ['generated-video-1'],
      childRuns: [
        {
          actualCatalogModelId: 'model-video-1',
          assetIds: ['generated-video-1'],
          providerAttempts: [
            {
              acceptance: 'accepted',
              catalogModelId: 'model-video-1',
              createdAt: CREATED_AT,
              deploymentId: 'deployment-video-1',
              id: 'attempt-video-1',
              jobId: 'generation-run-1',
              providerTaskRef: 'provider-task-1',
              status: 'completed',
            },
          ],
          routeSnapshot: {
            actualCatalogModelId: 'model-video-1',
            catalogRevisionId: 'catalog-r7',
            deploymentId: 'deployment-video-1',
            id: 'route-video-1',
          },
          routeSnapshotId: 'route-video-1',
          runId: 'generation-run-1',
          runType: 'model_job',
          status: 'succeeded',
        },
      ],
      ownedAssets: [
        {
          contentType: 'video/mp4',
          id: 'generated-video-1',
          objectKey: 'workspace-rights/generated/video.mp4',
          sha256: 'a'.repeat(64),
          sizeBytes: 1024,
          sourceTaskRef: 'provider-task-1',
        },
      ],
    },
    id: 'package-video-1',
    kind: 'video',
    lineage: {},
    marketing: {
      contextBundle: {
        bundleId: 'bundle-1',
        hash: 'b'.repeat(64),
        revision: 1,
      },
      declaration: {
        deliveryLayer: 'finished_media',
        implicitConstraints: [],
        normalizedIntent: '生成门店宣传视频',
        relevantAssetCategories: [],
        route: 'customized',
        routingSource: 'model',
        taskType: 'daily_service_exposure',
        usedAssetCategories: [],
      },
      factRefs: [],
      identityRefs: [],
      rightsRefs: input?.rightsRefs ?? [],
    },
    revision: 1,
    rights: { state: 'authorized' },
    source: { assetIds: input?.sourceAssetIds ?? [] },
    status: 'review_ready',
    updatedAt: CREATED_AT,
    variants: [],
    versions: [
      {
        body: '视频正文',
        createdAt: CREATED_AT,
        id: 'version-video-1',
        orderedAssetIds: ['generated-video-1'],
        source: 'ai_generated',
        title: '视频标题',
        topics: [],
      },
    ],
    workspaceId: 'workspace-rights',
  });
}

function generationTermsResolver(
  contract: {
    commercialUse?: 'allowed';
    effectiveTo?: string;
    lifecycleStatus?: 'active' | 'inactive';
    termsRevisionId?: string;
  } = { commercialUse: 'allowed' },
  options: { allowLocalFixtureTerms?: boolean } = {},
) {
  return new ContentPackageRightsBasisResolver(
    {
      async resolve() {
        return { knownAssetIds: [], unauthorizedAssetIds: [] };
      },
    },
    {
      async getRegistryRevision(workspaceId, revisionId) {
        assert.equal(workspaceId, 'workspace-rights');
        assert.equal(revisionId, 'catalog-r7');
        return {
          catalogRevisionId: 'catalog-r7',
          contracts: [
            {
              id: 'contract-provider-1',
              providerProfileId: 'provider-profile-1',
              termsRevisionId:
                contract.termsRevisionId ?? 'terms-provider-1-r7',
              ...(contract.commercialUse
                ? { commercialUse: contract.commercialUse }
                : {}),
              effectiveFrom: '2026-07-01T00:00:00.000Z',
              ...(contract.effectiveTo
                ? { effectiveTo: contract.effectiveTo }
                : {}),
            },
          ],
          deployments: [
            {
              catalogModelId: 'model-video-1',
              executionChannelId: 'channel-video-1',
              id: 'deployment-video-1',
              lifecycleStatus: contract.lifecycleStatus ?? 'active',
              providerProfileId: 'provider-profile-1',
              revisionId: 'deployment-video-1-r7',
            },
          ],
        };
      },
    },
    options,
  );
}
