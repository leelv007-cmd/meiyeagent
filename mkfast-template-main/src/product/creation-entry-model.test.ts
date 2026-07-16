import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  canCreateFromUploads,
  confirmedAssetFacts,
  exampleStoreBrowsingMessage,
  exampleRemixIntent,
  exampleStoreVisibility,
  openingSuggestions,
  primaryCreationOperations,
  readCreationDraftIntent,
  sceneChipGroups,
  sceneIntent,
  writeCreationDraftIntent,
} from './creation-entry-model';

test('offers complete image-text or video outcomes as the two primary choices', () => {
  assert.deepEqual(primaryCreationOperations(), [
    'copy.generate',
    'video.generate',
  ]);
});

test('puts the two result choices before materials, Brief, and reuse', () => {
  const source = readFileSync(
    new URL('./unified-creation-workbench.tsx', import.meta.url),
    'utf8'
  );
  const messageTitle = (key: string) =>
    new RegExp(`title=\\{(?:m\\.)?${key}\\(\\)\\}`, 'u');
  const quickStartPattern = messageTitle('workbench_quick_start');
  const quickStart = source.search(quickStartPattern);

  assert.ok(quickStart > -1);
  assert.ok(
    quickStart < source.search(messageTitle('workbench_section_references'))
  );
  assert.ok(quickStart < source.search(messageTitle('creative_brief_title')));
  assert.ok(
    quickStart < source.search(messageTitle('workbench_section_reuse'))
  );
  assert.equal(
    source.match(new RegExp(quickStartPattern.source, 'gu'))?.length,
    1
  );
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

test('scene chips produce deterministic editable intent without creating work', () => {
  assert.equal(
    sceneIntent('retention-nail'),
    '为美甲门店写一条真实克制的老客复购内容，先回顾上次效果，再说明本次可选项目和预约方式。'
  );
});

test('scene chips expose the exact primary and expanded guidance labels', () => {
  assert.deepEqual(sceneChipGroups('zh'), {
    expanded: [
      {
        id: 'lead-gen-hair',
        imageUrl: '/seed/scene/scene-lead-gen-hair.webp',
        label: '引流 · 美发',
      },
      {
        id: 'seeding-hair',
        imageUrl: '/seed/scene/scene-seeding-hair.webp',
        label: '种草 · 美发',
      },
      {
        id: 'lead-gen-skin',
        imageUrl: '/seed/scene/scene-lead-gen-skin.webp',
        label: '引流 · 皮肤管理',
      },
      {
        id: 'seeding-skin',
        imageUrl: '/seed/scene/scene-seeding-skin.webp',
        label: '种草 · 皮肤管理',
      },
    ],
    primary: [
      {
        id: 'lead-gen-nail',
        imageUrl: '/seed/scene/scene-lead-gen-nail.webp',
        label: '引流 · 美甲',
      },
      {
        id: 'seeding-nail',
        imageUrl: '/seed/scene/scene-seeding-nail.webp',
        label: '种草 · 美甲',
      },
      {
        id: 'promotion-nail',
        imageUrl: '/seed/scene/scene-promo-nail.webp',
        label: '促销 · 美甲',
      },
      {
        id: 'retention-nail',
        imageUrl: '/seed/scene/scene-retention-nail.webp',
        label: '复购 · 美甲',
      },
    ],
  });
  assert.deepEqual(sceneChipGroups('en'), {
    expanded: [
      {
        id: 'lead-gen-hair',
        imageUrl: '/seed/scene/scene-lead-gen-hair.webp',
        label: 'Lead gen · Hair',
      },
      {
        id: 'seeding-hair',
        imageUrl: '/seed/scene/scene-seeding-hair.webp',
        label: 'Seeding · Hair',
      },
      {
        id: 'lead-gen-skin',
        imageUrl: '/seed/scene/scene-lead-gen-skin.webp',
        label: 'Lead gen · Skin care',
      },
      {
        id: 'seeding-skin',
        imageUrl: '/seed/scene/scene-seeding-skin.webp',
        label: 'Seeding · Skin care',
      },
    ],
    primary: [
      {
        id: 'lead-gen-nail',
        imageUrl: '/seed/scene/scene-lead-gen-nail.webp',
        label: 'Lead gen · Nails',
      },
      {
        id: 'seeding-nail',
        imageUrl: '/seed/scene/scene-seeding-nail.webp',
        label: 'Seeding · Nails',
      },
      {
        id: 'promotion-nail',
        imageUrl: '/seed/scene/scene-promo-nail.webp',
        label: 'Promotion · Nails',
      },
      {
        id: 'retention-nail',
        imageUrl: '/seed/scene/scene-retention-nail.webp',
        label: 'Retention · Nails',
      },
    ],
  });
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
    platform: 'xiaohongshu',
    title: '阴天也透亮的显白猫眼',
  });
  assert.match(intent, /阴天也透亮的显白猫眼/);
  assert.match(intent, /开场钩子/);
  assert.doesNotMatch(intent, /弥鹿|299|素材/);
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

test('work creation waits for uploads but permits explicit failed-card removal', () => {
  assert.equal(canCreateFromUploads([]), true);
  assert.equal(canCreateFromUploads([{ status: 'uploading' }]), false);
  assert.equal(canCreateFromUploads([{ status: 'failed' }]), false);
  assert.equal(canCreateFromUploads([{ status: 'ready' }]), true);
});

test('asset facts require three explicit user confirmations', () => {
  assert.equal(
    confirmedAssetFacts({
      containsPerson: undefined,
      containsSensitiveData: false,
      minorStatus: 'none',
    }),
    undefined
  );
  assert.deepEqual(
    confirmedAssetFacts({
      containsPerson: false,
      containsSensitiveData: false,
      minorStatus: 'none',
    }),
    {
      containsPerson: false,
      containsSensitiveData: false,
      minorStatus: 'none',
    }
  );
});
