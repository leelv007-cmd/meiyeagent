import assert from 'node:assert/strict';
import test from 'node:test';
import type { ProductState } from '@meiye/contracts';
import { defaultProductPlanConfig } from './plans.js';
import {
  ProductAssetDataClassResolver,
  ProductCreativeGroundingResolver,
  ProductStateEntitlementPolicy,
} from './p1-model-policy.js';
import type { ProductRepository } from './repository.js';

const state = {
  assets: [
    {
      containsPerson: true,
      containsSensitiveData: true,
      id: 'asset-a',
    },
  ],
  entitlement: {
    content: { allowance: 71 },
    package: { allowance: 29 },
    plan: 'growth',
    sourceEventId: 'payment-a',
    video: { allowance: 13 },
  },
  store: { regulated: true },
} as unknown as ProductState;
const repository = {
  async load() {
    return state;
  },
} as unknown as ProductRepository;

test('P1 model policy derives actor-independent usage and asset classification from Product facts', async () => {
  const classes = await new ProductAssetDataClassResolver(repository).resolve(
    'workspace-a',
    'asset-a'
  );
  assert.deepEqual(classes, ['contains_face', 'pii', 'medical']);
  assert.equal(
    await new ProductAssetDataClassResolver(repository).resolve(
      'workspace-a',
      'asset-missing'
    ),
    null
  );

  const policy = await new ProductStateEntitlementPolicy(
    repository,
    defaultProductPlanConfig
  ).resolve('workspace-a');
  assert.equal(policy.tier, 'growth');
  assert.deepEqual(policy.allowance, { audio: 0, copy: 71, image: 29, video: 13 });
  assert.match(policy.revision, /payment-a$/);
});

test('creative grounding exposes only confirmed store facts and requested real authorized Assets', async () => {
  const product = {
    assets: [
      {
        authorizationStatus: 'authorized',
        category: 'store',
        consentScope: 'public_marketing',
        containsPerson: false,
        containsSensitiveData: false,
        id: 'asset-real-a',
        minorStatus: 'none',
        rightsEvidence: 'private evidence must not enter the snapshot',
        sourceType: 'real',
        tags: ['门头'],
      },
      {
        authorizationStatus: 'authorized',
        consentScope: 'public_marketing',
        containsPerson: false,
        containsSensitiveData: false,
        id: 'asset-ai-a',
        minorStatus: 'none',
        rightsEvidence: 'recorded',
        sourceType: 'ai_generated',
        tags: [],
      },
      {
        authorizationStatus: 'authorized',
        consentScope: 'internal_only',
        containsPerson: false,
        containsSensitiveData: false,
        id: 'asset-internal-a',
        minorStatus: 'none',
        rightsEvidence: 'recorded',
        sourceType: 'real',
        tags: [],
      },
      {
        authorizationStatus: 'authorized',
        category: 'before_after',
        consentScope: 'public_marketing',
        containsPerson: true,
        containsSensitiveData: false,
        id: 'asset-expired-rights',
        minorStatus: 'none',
        rightsEvidence: 'consent/archive-expired',
        rightsNoFixedExpiry: false,
        rightsPlatforms: ['xiaohongshu'],
        rightsValidUntil: '2026-07-14T07:59:59.000Z',
        sourceType: 'real',
        tags: [],
      },
      {
        authorizationStatus: 'authorized',
        category: 'customer_case',
        consentScope: 'public_marketing',
        containsPerson: false,
        containsSensitiveData: false,
        id: 'asset-incomplete-restricted-rights',
        minorStatus: 'none',
        rightsEvidence: 'consent/archive-incomplete',
        sourceType: 'real',
        tags: [],
      },
    ],
    qualification: { admitted: false, confirmed: true },
    store: {
      address: '88 号',
      booking: '预约到店',
      brandVoice: '真诚、不夸张',
      city: '成都',
      confirmedAt: '2026-07-14T07:00:00.000Z',
      district: '锦江区',
      name: '春日美甲',
      prohibitions: ['不虚构折扣'],
      projects: [
        {
          confirmed: true,
          durationMinutes: 90,
          id: 'project-confirmed',
          name: '纯色美甲',
          price: 168,
        },
        {
          confirmed: false,
          durationMinutes: 30,
          id: 'project-draft',
          name: '未确认项目',
          price: 1,
        },
      ],
      regulated: false,
    },
  } as unknown as ProductState;
  const productRepository = {
    async load() {
      return structuredClone(product);
    },
  } as unknown as ProductRepository;
  const resolver = new ProductCreativeGroundingResolver(
    productRepository,
    () => new Date('2026-07-14T08:00:00.000Z')
  );

  const ready = await resolver.resolve('workspace-a', ['asset-real-a']);
  assert.equal(ready.status, 'ready');
  if (ready.status !== 'ready') return;
  assert.deepEqual(
    ready.snapshot.store?.projects.map((project) => project.id),
    ['project-confirmed']
  );
  assert.deepEqual(ready.snapshot.assets, [
    {
      authorizationStatus: 'authorized',
      category: 'store',
      consentScope: 'public_marketing',
      containsPerson: false,
      containsSensitiveData: false,
      id: 'asset-real-a',
      minorStatus: 'none',
      rightsEvidenceRecorded: true,
      sourceType: 'real',
      tags: ['门头'],
    },
  ]);
  assert.equal(
    JSON.stringify(ready.snapshot).includes('private evidence'),
    false
  );

  const textOnly = await resolver.resolve('workspace-a', []);
  assert.equal(textOnly.status, 'ready');
  if (textOnly.status === 'ready') {
    assert.deepEqual(textOnly.snapshot.assets, []);
  }

  assert.deepEqual(await resolver.resolve('workspace-a', ['asset-ai-a']), {
    missing: ['real_authorized_asset'],
    status: 'missing',
  });
  assert.deepEqual(
    await resolver.resolve('workspace-a', ['asset-internal-a']),
    {
      missing: ['real_authorized_asset'],
      status: 'missing',
    }
  );
  assert.deepEqual(
    await resolver.resolve('workspace-a', ['asset-expired-rights']),
    {
      missing: ['real_authorized_asset'],
      status: 'missing',
    }
  );
  assert.deepEqual(
    await resolver.resolve('workspace-a', [
      'asset-incomplete-restricted-rights',
    ]),
    {
      missing: ['real_authorized_asset'],
      status: 'missing',
    }
  );
});

function groundingResolverFor(product: unknown) {
  return new ProductCreativeGroundingResolver(
    {
      async load() {
        return structuredClone(product);
      },
    } as unknown as ProductRepository,
    () => new Date('2026-08-06T08:00:00.000Z')
  );
}

const dayZeroAssets = [
  {
    authorizationStatus: 'authorized',
    consentScope: 'public_marketing',
    containsPerson: false,
    containsSensitiveData: false,
    id: 'asset-real-day0',
    minorStatus: 'none',
    rightsEvidence: 'recorded',
    sourceType: 'real',
    tags: [],
  },
  {
    authorizationStatus: 'authorized',
    consentScope: 'public_marketing',
    containsPerson: false,
    containsSensitiveData: false,
    id: 'asset-ai-day0',
    minorStatus: 'none',
    rightsEvidence: 'recorded',
    sourceType: 'ai_generated',
    tags: [],
  },
];

test('D-175: free creation is grounded without a confirmed store or project', async () => {
  const resolver = groundingResolverFor({ assets: dayZeroAssets });

  // Day-0 merchant: no store row at all.
  const customized = await resolver.resolve('workspace-day0', []);
  assert.deepEqual(customized, {
    missing: ['confirmed_store', 'confirmed_project'],
    status: 'missing',
  });

  const free = await resolver.resolve('workspace-day0', [], 'free');
  assert.equal(free.status, 'ready');
  if (free.status !== 'ready') return;
  assert.equal(free.snapshot.store, undefined);
  assert.deepEqual(free.snapshot.assets, []);

  // The rights gate is a compliance floor: free creation keeps it.
  assert.deepEqual(
    await resolver.resolve('workspace-day0', ['asset-ai-day0'], 'free'),
    { missing: ['real_authorized_asset'], status: 'missing' }
  );
  const freeWithAsset = await resolver.resolve(
    'workspace-day0',
    ['asset-real-day0'],
    'free'
  );
  assert.equal(freeWithAsset.status, 'ready');
  if (freeWithAsset.status === 'ready') {
    assert.deepEqual(
      freeWithAsset.snapshot.assets.map((asset) => asset.id),
      ['asset-real-day0']
    );
  }
});

test('D-175: free creation keeps the regulated qualification gate', async () => {
  const regulatedStore = {
    address: '1 号',
    booking: '预约到店',
    brandVoice: '克制',
    city: '上海',
    district: '静安区',
    name: '未确认医美门店',
    projects: [],
    prohibitions: [],
    regulated: true,
  };

  const unqualified = groundingResolverFor({
    assets: dayZeroAssets,
    store: regulatedStore,
  });
  // Store facts waived, regulated qualification still refused.
  assert.deepEqual(await unqualified.resolve('workspace-b', [], 'free'), {
    missing: ['confirmed_qualification'],
    status: 'missing',
  });

  const qualified = groundingResolverFor({
    assets: dayZeroAssets,
    qualification: { admitted: true, confirmed: true },
    store: regulatedStore,
  });
  const ready = await qualified.resolve('workspace-b', [], 'free');
  assert.equal(ready.status, 'ready');
  if (ready.status !== 'ready') return;
  // The store was never confirmed, so it contributes no facts to the snapshot.
  assert.equal(ready.snapshot.store, undefined);
  assert.equal(ready.snapshot.qualification?.confirmed, true);
});

test('D-175: free creation still reads a confirmed store when the merchant has one', async () => {
  const resolver = groundingResolverFor({
    assets: dayZeroAssets,
    store: {
      address: '88 号',
      booking: '预约到店',
      brandVoice: '真诚',
      city: '成都',
      confirmedAt: '2026-08-05T07:00:00.000Z',
      district: '锦江区',
      name: '春日美甲',
      projects: [
        {
          confirmed: true,
          durationMinutes: 90,
          id: 'project-confirmed',
          name: '纯色美甲',
          price: 168,
        },
      ],
      prohibitions: [],
      regulated: false,
    },
  });

  const free = await resolver.resolve('workspace-c', [], 'free');
  assert.equal(free.status, 'ready');
  if (free.status !== 'ready') return;
  assert.equal(free.snapshot.store?.name, '春日美甲');
  assert.deepEqual(
    free.snapshot.store?.projects.map((project) => project.id),
    ['project-confirmed']
  );
});
