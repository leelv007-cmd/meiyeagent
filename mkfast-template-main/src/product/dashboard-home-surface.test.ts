import assert from 'node:assert/strict';
import test from 'node:test';
import type { ExampleStore, ProductState } from '@meiye/contracts';

import {
  exampleStoreIndustryLabel,
  todayRecommendationIntent,
} from './creation-entry-model';
import { exampleShowcaseVisibility } from './dashboard-home-surface';

function sampleStore(
  industry: ExampleStore['industry'],
  hidden: boolean
): ExampleStore {
  return {
    id: `platform-sample:store/${industry}`,
    industry,
    provenance: 'platform_sample',
    name: `${industry} 示例店`,
    readOnly: true,
    hidden,
    assets: 4,
    contentCards: 3,
    packages: 1,
    profile: { city: '杭州', project: '示例项目', confirmedPrice: 268 },
    facts: [
      {
        id: `platform-sample:fact/${industry}`,
        label: '门店位置',
        value: '杭州拱墅区',
      },
    ],
    assetPreviews: [
      {
        id: `platform-sample:asset/${industry}`,
        label: '示例素材',
        authorizationStatus: 'authorized',
      },
    ],
    contentPreviews: [
      {
        id: `platform-sample:content/${industry}`,
        title: '示例作品',
        platform: 'xiaohongshu',
        summary: '示例说明',
      },
    ],
    handoffPreview: {
      id: `platform-sample:handoff/${industry}`,
      title: '示例发布包',
      platform: 'xiaohongshu',
    },
  };
}

function productState(overrides: Partial<ProductState> = {}): ProductState {
  return {
    exampleStores: [
      sampleStore('hair_care', false),
      sampleStore('skin_management', false),
      sampleStore('hair_growth', false),
    ],
    assets: [],
    contents: [],
    handoffPackages: [],
    videoJobs: [],
    operationalEvidence: { generatedCandidateCount: 0 },
    ...overrides,
  } as unknown as ProductState;
}

test('cold home shows the revealed sample showcase', () => {
  assert.equal(
    exampleShowcaseVisibility({ loading: false, state: productState() }),
    'visible'
  );
});

test('cold home offers an opt-in entry once every sample is hidden', () => {
  const state = productState({
    exampleStores: [
      sampleStore('hair_care', true),
      sampleStore('skin_management', true),
      sampleStore('hair_growth', true),
    ],
  });
  assert.equal(
    exampleShowcaseVisibility({ loading: false, state }),
    'opt_in'
  );
});

test('a workspace with real work never sees samples again', () => {
  for (const overrides of [
    { assets: [{ id: 'asset-1' }] },
    { contents: [{ id: 'content-1' }] },
    { videoJobs: [{ id: 'job-1' }] },
    { handoffPackages: [{ id: 'handoff-1' }] },
    { operationalEvidence: { generatedCandidateCount: 1 } },
  ] as unknown as Array<Partial<ProductState>>) {
    assert.equal(
      exampleShowcaseVisibility({
        loading: false,
        state: productState(overrides),
      }),
      'hidden'
    );
  }
});

test('visibility stays unknown until the workspace state has loaded', () => {
  assert.equal(
    exampleShowcaseVisibility({ loading: false, state: undefined }),
    'unknown'
  );
  assert.equal(
    exampleShowcaseVisibility({ loading: true, state: productState() }),
    'unknown'
  );
});

test('industry labels read as merchant Chinese', () => {
  assert.equal(exampleStoreIndustryLabel('hair_care'), '护发');
  assert.equal(exampleStoreIndustryLabel('skin_management'), '皮肤管理');
  assert.equal(exampleStoreIndustryLabel('hair_growth'), '生发');
});

test('the recommendation prefill carries all three explanation elements', () => {
  const intent = todayRecommendationIntent({
    customerAction: '私信预约',
    title: '本周护理项目推荐',
    whyNow: '换季期的咨询量正在上升',
  });
  assert.match(intent, /本周护理项目推荐/);
  assert.match(intent, /换季期的咨询量正在上升/);
  assert.match(intent, /私信预约/);
  // No internal identifiers reach the merchant draft.
  assert.doesNotMatch(intent, /platform-sample|store_fact:|packageId/);
});
