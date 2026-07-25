import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  canCreateFromUploads,
  composerAssetAuthorizationDraft,
  confirmedAssetFacts,
  exampleStoreBrowsingMessage,
  exampleRemixIntent,
  exampleStoreVisibility,
  isComposerSubmitShortcut,
  openingSuggestions,
  ordinaryOneClickAnswers,
  primaryCreationOperations,
  readCreationDraftIntent,
  shouldLaunchAgentHarness,
  systemInlineAuthEvidence,
  writeCreationDraftIntent,
} from './creation-entry-model';
import {
  MARKETING_ENTRY_IDS,
  productionMarketingEntryCapabilities,
  releasedMarketingEntries,
} from './marketing-entry-model';

test('offers complete image-text or video outcomes as the two primary choices', () => {
  assert.deepEqual(primaryCreationOperations(), [
    'copy.generate',
    'video.generate',
  ]);
});

test('launches the copy harness only for an agent copy intent', () => {
  assert.equal(shouldLaunchAgentHarness('agent', 'copy.generate'), true);
  assert.equal(shouldLaunchAgentHarness('agent', 'video.generate'), false);
  assert.equal(shouldLaunchAgentHarness('direct', 'copy.generate'), false);
});

test('production releases all five complete marketing entries', () => {
  assert.deepEqual(
    releasedMarketingEntries(productionMarketingEntryCapabilities()),
    [...MARKETING_ENTRY_IDS]
  );
});

test('mounts lens and Recipe choices on the canonical Composer axis', () => {
  const source = readFileSync(
    new URL('./composer/composer-home.tsx', import.meta.url),
    'utf8'
  );

  assert.match(source, /<LensRadiogroup/u);
  assert.match(source, /<RecipeCardsPanel/u);
  assert.doesNotMatch(source, /<CreationEntry/u);
  assert.doesNotMatch(source, /<CreationModePicker/u);
});

test('states the real authorized-asset gate before generation', () => {
  const messages = JSON.parse(
    readFileSync(
      new URL('../../project.inlang/messages/zh.json', import.meta.url),
      'utf8'
    )
  ) as { workbench_no_references: string };

  assert.match(messages.workbench_no_references, /可用于宣传的真实门店素材/u);
  assert.doesNotMatch(messages.workbench_no_references, /不是创作门槛/u);
});

test('one-click public copy states the unrestricted-material attestation in both locales', () => {
  const zh = JSON.parse(
    readFileSync(
      new URL('../../project.inlang/messages/zh.json', import.meta.url),
      'utf8'
    )
  ) as { composer_image_one_click_yes: string };
  const en = JSON.parse(
    readFileSync(
      new URL('../../project.inlang/messages/en.json', import.meta.url),
      'utf8'
    )
  ) as { composer_image_one_click_yes: string };

  assert.match(
    zh.composer_image_one_click_yes,
    /不含人像.*前后对比.*顾客案例.*隐私信息/u
  );
  assert.match(
    en.composer_image_one_click_yes,
    /no people.*before-and-after.*customer cases.*private information/iu
  );
});

test('merchant workbench copy hides orchestration and debugging terminology', () => {
  const zh = JSON.parse(
    readFileSync(
      new URL('../../project.inlang/messages/zh.json', import.meta.url),
      'utf8'
    )
  ) as Record<string, string>;
  const en = JSON.parse(
    readFileSync(
      new URL('../../project.inlang/messages/en.json', import.meta.url),
      'utf8'
    )
  ) as Record<string, string>;
  const merchantKeys = [
    'workbench_advanced_details',
    'workbench_details_drawer',
    'workbench_harness_stop_unavailable',
    'workbench_record_direct_aria',
    'workbench_view_model_details',
    'workbench_view_settings',
  ];

  assert.doesNotMatch(
    merchantKeys.map((key) => zh[key]).join('\n'),
    /Harness|revision|直接模式|排查与详情/u
  );
  assert.doesNotMatch(
    merchantKeys.map((key) => en[key]).join('\n'),
    /Harness|revision|Direct mode|Details & support|Details for this run/iu
  );
});

test('opening suggestions prefer real signals, stay unique, and stop at three', () => {
  const suggestions = openingSuggestions({
    assets: [
      { id: 'asset-a', label: '透亮猫眼' },
      { id: 'asset-b', label: '夏日新色' },
    ],
    tasks: [
      { id: 'task-a', title: '周末空档引流' },
      { id: 'task-b', title: '夏日新色' },
    ],
  });

  assert.equal(suggestions.length, 3);
  assert.equal(suggestions[0]?.sourceLabel, '来自当前任务');
  assert.equal(suggestions[0]?.label, '周末空档引流');
  assert.equal(new Set(suggestions.map((item) => item.intent)).size, 3);
});

test('opening suggestions identify fallback copy as common instead of insight', () => {
  const suggestions = openingSuggestions({ assets: [], tasks: [] });
  assert.equal(suggestions.length, 3);
  assert.ok(suggestions.every((item) => item.sourceLabel === '常用建议'));
});

test('example store waits for every successful real query and exits on any fact', () => {
  const empty = {
    assetCount: 0,
    contentCount: 0,
    hidden: false,
    queriesReady: true,
    taskCount: 0,
    workCount: 0,
  };
  assert.equal(exampleStoreVisibility(empty), 'visible');
  assert.equal(
    exampleStoreVisibility({ ...empty, queriesReady: false }),
    'unknown'
  );
  assert.equal(exampleStoreVisibility({ ...empty, assetCount: 1 }), 'hidden');
  assert.equal(exampleStoreVisibility({ ...empty, hidden: true }), 'hidden');
});

test('example browsing states in both locales that it uses no allowance', () => {
  assert.equal(exampleStoreBrowsingMessage('zh'), '只读 · 浏览不消耗额度');
  assert.equal(
    exampleStoreBrowsingMessage('en'),
    'Read-only · Browsing does not use your allowance'
  );
});

test('example remix keeps the selected angle and only the reusable structure', () => {
  const intent = exampleRemixIntent({
    industry: 'hair_care',
    platform: 'xiaohongshu',
    title: '阴天也透亮的显白猫眼',
  });
  assert.match(intent, /阴天也透亮的显白猫眼/);
  assert.match(intent, /开场钩子/);
  assert.doesNotMatch(intent, /弥鹿|299|素材/);
});

test('example remix says which service the draft is about', () => {
  // A draft that names its own service does not make the chain stop and ask.
  for (const [industry, service] of [
    ['hair_care', '头皮护理'],
    ['skin_management', '皮肤管理'],
    ['hair_growth', '养发护理'],
  ] as const) {
    const intent = exampleRemixIntent({
      industry,
      platform: 'douyin',
      title: '第一次做护理，70 分钟里发生了什么',
    });
    assert.match(intent, new RegExp(service));
    // Store facts still belong to the merchant, never to the sample.
    assert.match(intent, /门店与价格事实由我稍后补充/);
  }
});

test('example remix draft handoff accepts only a bounded explicit intent', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };

  assert.equal(
    writeCreationDraftIntent(storage, '  保留人工确认的结构  '),
    true
  );
  assert.equal(readCreationDraftIntent(storage), '保留人工确认的结构');
  assert.equal(writeCreationDraftIntent(storage, ' '), false);
});

test('Cmd/Ctrl+Enter is the only composer submit shortcut', () => {
  assert.equal(
    isComposerSubmitShortcut({ ctrlKey: false, key: 'Enter', metaKey: true }),
    true
  );
  assert.equal(
    isComposerSubmitShortcut({ ctrlKey: true, key: 'Enter', metaKey: false }),
    true
  );
  assert.equal(
    isComposerSubmitShortcut({ ctrlKey: false, key: 'Enter', metaKey: false }),
    false,
    'plain Enter keeps inserting a newline'
  );
  assert.equal(
    isComposerSubmitShortcut({ ctrlKey: true, key: 'a', metaKey: false }),
    false
  );
});

test('work creation waits for uploads but permits explicit failed-card removal', () => {
  assert.equal(canCreateFromUploads([]), true);
  assert.equal(canCreateFromUploads([{ status: 'uploading' }]), false);
  assert.equal(canCreateFromUploads([{ status: 'failed' }]), false);
  assert.equal(canCreateFromUploads([{ status: 'ready' }]), true);
});

test('asset facts require three explicit user confirmations', () => {
  assert.equal(
    confirmedAssetFacts({
      category: 'other',
      consentScope: 'internal_only',
      containsPerson: undefined,
      containsSensitiveData: false,
      minorStatus: 'none',
      rightsEvidence: '',
      rightsNoFixedExpiry: false,
      rightsPlatforms: [],
      rightsValidUntil: '',
    }),
    undefined
  );
  assert.deepEqual(
    confirmedAssetFacts({
      category: 'other',
      consentScope: 'internal_only',
      containsPerson: false,
      containsSensitiveData: false,
      minorStatus: 'none',
      rightsEvidence: '',
      rightsNoFixedExpiry: false,
      rightsPlatforms: [],
      rightsValidUntil: '',
    }),
    {
      category: 'other',
      consentScope: 'internal_only',
      containsPerson: false,
      containsSensitiveData: false,
      minorStatus: 'none',
    }
  );
});

test('one-click public marketing requires an explicit unrestricted-material attestation', () => {
  assert.equal(
    ordinaryOneClickAnswers({
      confirmsNoPeopleBeforeAfterCustomerCaseOrSensitiveData: false,
      consentScope: 'public_marketing',
    }),
    undefined
  );
  const answers = ordinaryOneClickAnswers({
    confirmsNoPeopleBeforeAfterCustomerCaseOrSensitiveData: true,
    consentScope: 'public_marketing',
  });
  assert.ok(answers);
  const facts = confirmedAssetFacts(answers, {
    evidenceContext: 'composer',
    evidenceNonce: 'asset-test-nonce',
  });
  assert.deepEqual(facts, {
    category: 'store',
    consentScope: 'public_marketing',
    containsPerson: false,
    containsSensitiveData: false,
    minorStatus: 'none',
    rightsEvidence: systemInlineAuthEvidence({
      context: 'composer',
      nonce: 'asset-test-nonce',
    }),
  });
  assert.match(facts!.rightsEvidence!, /^system:inline-auth:/u);
  assert.deepEqual(
    confirmedAssetFacts(
      ordinaryOneClickAnswers({ consentScope: 'internal_only' })!
    ),
    {
      category: 'store',
      consentScope: 'internal_only',
      containsPerson: false,
      containsSensitiveData: false,
      minorStatus: 'none',
    }
  );
});

test('composer reauthorization keeps the uploaded asset owner and tags', () => {
  assert.deepEqual(
    composerAssetAuthorizationDraft({
      assetId: 'asset-real-1',
      currentAsset: {
        rightsOwner: '弥鹿美甲',
        tags: ['门店实拍.jpg'],
      },
      facts: {
        category: 'customer_case',
        consentScope: 'public_marketing',
        containsPerson: true,
        containsSensitiveData: false,
        minorStatus: 'none',
        rightsEvidence: 'system:inline-auth:test',
        rightsNoFixedExpiry: true,
        rightsPlatforms: ['xiaohongshu'],
      },
      fallbackRightsOwner: 'workspace-1',
    }),
    {
      assetId: 'asset-real-1',
      category: 'customer_case',
      consentScope: 'public_marketing',
      containsPerson: true,
      containsSensitiveData: false,
      minorStatus: 'none',
      rightsEvidence: 'system:inline-auth:test',
      rightsNoFixedExpiry: true,
      rightsOwner: '弥鹿美甲',
      rightsPlatforms: ['xiaohongshu'],
      rightsValidUntil: undefined,
      systemEvidence: {
        context: 'composer',
        nonce: 'asset-real-1',
      },
      tags: ['门店实拍.jpg'],
    }
  );
});

test('system evidence is stable for one asset and distinct across assets', () => {
  assert.equal(
    systemInlineAuthEvidence({ context: 'composer', nonce: 'asset-a' }),
    systemInlineAuthEvidence({ context: 'composer', nonce: 'asset-a' })
  );
  assert.notEqual(
    systemInlineAuthEvidence({ context: 'composer', nonce: 'asset-a' }),
    systemInlineAuthEvidence({ context: 'composer', nonce: 'asset-b' })
  );
});

test('non-restricted public marketing accepts empty user evidence via stable system pointer', () => {
  const facts = confirmedAssetFacts(
    {
      category: 'other',
      consentScope: 'public_marketing',
      containsPerson: false,
      containsSensitiveData: false,
      minorStatus: 'none',
      rightsEvidence: '',
      rightsNoFixedExpiry: false,
      rightsPlatforms: [],
      rightsValidUntil: '',
    },
    { evidenceContext: 'composer', evidenceNonce: 'asset-a' }
  );
  assert.equal(facts?.rightsEvidence, 'system:inline-auth:composer:asset-a');
});

test('restricted public marketing still requires platforms and expiry; evidence may be system pointer', () => {
  const base = {
    category: 'before_after' as const,
    consentScope: 'public_marketing' as const,
    containsPerson: false,
    containsSensitiveData: false,
    minorStatus: 'none' as const,
    rightsEvidence: 'consent/archive-2026-0718',
    rightsNoFixedExpiry: false,
    rightsPlatforms: ['xiaohongshu'] as const,
    rightsValidUntil: '2027-07-18',
  };

  // Restricted fields still required — not collapsed to one-click.
  assert.equal(
    confirmedAssetFacts({ ...base, rightsPlatforms: [] }),
    undefined
  );
  assert.equal(
    confirmedAssetFacts({ ...base, rightsValidUntil: '' }),
    undefined
  );
  assert.equal(
    confirmedAssetFacts({
      ...base,
      minorStatus: 'minor',
      rightsEvidence: 'x',
    }),
    undefined
  );
  // External archive optional: empty evidence → system pointer when platforms/expiry ok.
  const withSystem = confirmedAssetFacts(
    { ...base, rightsEvidence: '' },
    { evidenceContext: 'composer', evidenceNonce: 'asset-r' }
  );
  assert.equal(
    withSystem?.rightsEvidence,
    'system:inline-auth:composer:asset-r'
  );
  assert.deepEqual(confirmedAssetFacts(base), {
    ...base,
    rightsValidUntil: '2027-07-18T23:59:59.999Z',
  });
  assert.deepEqual(
    confirmedAssetFacts({
      ...base,
      rightsNoFixedExpiry: true,
      rightsValidUntil: '',
    }),
    {
      ...base,
      rightsNoFixedExpiry: true,
      rightsValidUntil: undefined,
    }
  );
});

test('Z1 retirement: scene chip groups API is gone from creation-entry-model', () => {
  const source = readFileSync(
    new URL('./creation-entry-model.ts', import.meta.url),
    'utf8'
  );
  assert.equal(source.includes('export function sceneChip' + 'Groups'), false);
  assert.equal(source.includes('export interface Scene' + 'Chip'), false);
  assert.equal(source.includes('export function scene' + 'Intent'), false);
  assert.equal(source.includes('resolvePresetIdFor' + 'Scene'), false);
});
