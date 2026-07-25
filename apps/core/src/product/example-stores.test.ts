import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  EXAMPLE_STORE_INDUSTRIES,
  PLATFORM_SAMPLE_ID_PREFIX,
  isPlatformSampleId,
  type Asset,
  type ProductState,
} from '@meiye/contracts';
import {
  exampleStoreEntityIds,
  hydrateExampleStores,
  initialExampleStores,
  withoutPlatformSamples,
} from './example-stores.js';

function tenantAsset(id: string): Asset {
  return {
    id,
    objectKey: `objects/${id}`,
    mediaType: 'image',
    sourceType: 'real',
    tags: [],
    rightsOwner: '门店自有',
    consentScope: 'public_marketing',
    containsPerson: false,
    containsSensitiveData: false,
    minorStatus: 'none',
    aigcStatus: 'not_ai',
    authorizationStatus: 'authorized',
    replacementRequired: false,
    createdAt: '2026-07-25T00:00:00.000Z',
  };
}

describe('D-126 platform sample seed', () => {
  it('seeds one sample store per C-5 industry', () => {
    const stores = initialExampleStores();
    assert.deepEqual(
      stores.map((store) => store.industry),
      [...EXAMPLE_STORE_INDUSTRIES]
    );
    for (const store of stores) {
      assert.equal(store.provenance, 'platform_sample');
      assert.equal(store.readOnly, true);
      assert.ok(store.facts.length > 0, `${store.industry} needs sample facts`);
      assert.ok(store.assetPreviews.length > 0);
      assert.ok(store.contentPreviews.length > 0);
    }
  });

  it('keeps every sample id inside the reserved namespace', () => {
    for (const id of exampleStoreEntityIds(initialExampleStores())) {
      assert.ok(
        isPlatformSampleId(id),
        `${id} must live under ${PLATFORM_SAMPLE_ID_PREFIX}`
      );
    }
  });

  it('states sample copy in merchant language without internal identifiers', () => {
    for (const store of initialExampleStores()) {
      const merchantFacing = [
        store.name,
        store.profile.city,
        store.profile.project,
        ...store.facts.flatMap((fact) => [fact.label, fact.value]),
        ...store.assetPreviews.map((asset) => asset.label),
        ...store.contentPreviews.flatMap((content) => [
          content.title,
          content.summary,
        ]),
        store.handoffPreview.title,
      ];
      for (const text of merchantFacing) {
        assert.doesNotMatch(
          text,
          /platform-sample|[A-Za-z]{4,}|成本|毛利/u,
          `${store.industry} sample copy leaks internals: ${text}`
        );
      }
    }
  });
});

describe('D-126 example store hydrate', () => {
  it('hydrates a pre-D-126 single-store blob into the three-industry shape', () => {
    const legacy = {
      workspaceId: 'workspace-legacy',
      exampleStore: {
        id: 'example-manicure-store',
        name: '弥鹿美甲示例店',
        readOnly: true,
        hidden: true,
        assets: 4,
        contentCards: 3,
        packages: 1,
        profile: { city: '杭州', project: '透亮猫眼', confirmedPrice: 299 },
        assetPreviews: [
          {
            id: 'example-asset-1',
            label: '猫眼纹理特写',
            authorizationStatus: 'authorized',
          },
        ],
        contentPreviews: [
          {
            id: 'example-content-1',
            title: '阴天也透亮的显白猫眼',
            platform: 'xiaohongshu',
          },
        ],
        handoffPreview: {
          id: 'example-handoff-1',
          title: '猫眼项目发布包',
          platform: 'xiaohongshu',
        },
      },
    };

    const hydrated = hydrateExampleStores(legacy);

    assert.deepEqual(
      hydrated.map((store) => store.industry),
      [...EXAMPLE_STORE_INDUSTRIES]
    );
    for (const store of hydrated) {
      assert.equal(store.provenance, 'platform_sample');
      assert.equal(store.readOnly, true);
      assert.ok(store.name.length > 0);
      assert.ok(store.profile.confirmedPrice > 0);
      assert.ok(store.facts.length > 0);
      assert.ok(store.assetPreviews.length > 0);
      assert.ok(store.contentPreviews.length > 0);
      assert.ok(store.handoffPreview.title.length > 0);
      // The merchant had hidden the pre-D-126 example; that choice survives.
      assert.equal(store.hidden, true);
    }
  });

  it('carries a revealed legacy example forward as revealed', () => {
    const hydrated = hydrateExampleStores({
      exampleStore: { id: 'example-manicure-store', hidden: false },
    });
    assert.ok(hydrated.every((store) => store.hidden === false));
  });

  it('prefers persisted per-industry visibility over the legacy blob', () => {
    const hydrated = hydrateExampleStores({
      exampleStore: { hidden: true },
      exampleStores: [{ industry: 'skin_management', hidden: false }],
    });
    const byIndustry = new Map(
      hydrated.map((store) => [store.industry, store.hidden])
    );
    assert.equal(byIndustry.get('skin_management'), false);
    assert.equal(byIndustry.get('hair_care'), true);
    assert.equal(byIndustry.get('hair_growth'), true);
  });

  it('seeds a workspace that never persisted an example store', () => {
    assert.deepEqual(
      hydrateExampleStores({}).map((store) => store.industry),
      [...EXAMPLE_STORE_INDUSTRIES]
    );
  });
});

describe('D-126 platform sample isolation', () => {
  it('drops sample entities from tenant projections and keeps the merchant own ones', () => {
    const sampleAssetId = `${PLATFORM_SAMPLE_ID_PREFIX}asset/hair-care/scalp-check`;
    const sampleContentId = `${PLATFORM_SAMPLE_ID_PREFIX}content/hair-care/oily-scalp`;
    const sampleHandoffId = `${PLATFORM_SAMPLE_ID_PREFIX}handoff/hair-care`;
    const state = {
      assets: [tenantAsset(sampleAssetId), tenantAsset('asset-merchant-1')],
      contents: [
        { id: sampleContentId, title: '示例内容' },
        { id: 'content-merchant-1', title: '我的内容' },
      ],
      handoffPackages: [
        { id: sampleHandoffId },
        { id: 'handoff-merchant-1' },
      ],
    } as unknown as ProductState;

    const projected = withoutPlatformSamples(state);

    const assetIds = projected.assets.map((asset) => asset.id);
    const contentIds = projected.contents.map((content) => content.id);
    const handoffIds = projected.handoffPackages.map((handoff) => handoff.id);

    // Absence: no sample entity reaches the merchant workspace projection.
    assert.equal(assetIds.includes(sampleAssetId), false);
    assert.equal(contentIds.includes(sampleContentId), false);
    assert.equal(handoffIds.includes(sampleHandoffId), false);

    // Positive control: a filter that returns nothing would fail here.
    assert.deepEqual(assetIds, ['asset-merchant-1']);
    assert.deepEqual(contentIds, ['content-merchant-1']);
    assert.deepEqual(handoffIds, ['handoff-merchant-1']);
  });

  it('leaves a sample-free projection untouched', () => {
    const state = {
      assets: [tenantAsset('asset-merchant-1')],
      contents: [],
      handoffPackages: [],
    } as unknown as ProductState;
    assert.equal(withoutPlatformSamples(state), state);
  });
});
