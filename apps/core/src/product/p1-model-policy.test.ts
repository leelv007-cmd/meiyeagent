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
    ready.snapshot.store.projects.map((project) => project.id),
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
});
