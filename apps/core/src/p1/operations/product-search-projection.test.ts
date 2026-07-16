import assert from 'node:assert/strict';
import test from 'node:test';
import type { ProductState } from '@meiye/contracts';
import { MemoryOperationsRepository } from './repository.js';
import { OperationsProductSearchProjection } from './product-search-projection.js';

test('projects Product assets and current content into the rebuildable search read model', async () => {
  const repository = new MemoryOperationsRepository();
  const projection = new OperationsProductSearchProjection(repository);
  const state = {
    assets: [
      {
        aigcStatus: 'not_ai',
        authorizationStatus: 'authorized',
        consentScope: 'public_marketing',
        containsPerson: true,
        containsSensitiveData: false,
        createdAt: '2026-07-11T00:00:00.000Z',
        id: 'asset-cat-eye',
        mediaType: 'image',
        minorStatus: 'none',
        objectKey: 'workspace-a/assets/cat-eye.png',
        replacementRequired: false,
        rightsOwner: '晴岚美甲',
        sourceType: 'real',
        tags: ['猫眼', '前后对比'],
      },
    ],
    contents: [
      {
        assetIds: ['asset-cat-eye'],
        complianceStatus: 'clear',
        createdAt: '2026-07-11T00:01:00.000Z',
        id: 'content-cat-eye',
        projectId: 'project-cat-eye',
        scenario: '到店种草',
        selected: true,
        status: 'draft',
        variants: [
          {
            aiDefaultVersionId: 'version-1',
            currentVersionId: 'version-1',
            id: 'variant-1',
            platform: 'xiaohongshu',
            versions: [
              {
                assetOrder: ['asset-cat-eye'],
                body: '自然光下也透亮的猫眼效果',
                conversionHook: '预约到店体验',
                createdAt: '2026-07-11T00:02:00.000Z',
                id: 'version-1',
                source: 'merchant',
                title: '阴天也透亮',
                topics: ['显白', '猫眼'],
              },
            ],
          },
          {
            aiDefaultVersionId: 'version-2',
            currentVersionId: 'version-2',
            id: 'variant-2',
            platform: 'douyin',
            versions: [
              {
                assetOrder: ['asset-cat-eye'],
                body: '抖音短视频口播版',
                conversionHook: '私信预约',
                createdAt: '2026-07-11T00:02:30.000Z',
                id: 'version-2',
                source: 'merchant',
                title: '猫眼短视频',
                topics: ['猫眼'],
              },
            ],
          },
        ],
      },
    ],
    store: { name: '晴岚美甲' },
    updatedAt: '2026-07-20T00:03:00.000Z',
    workspaceId: 'workspace-a',
  } as unknown as ProductState;

  await projection.sync(state);

  assert.deepEqual(
    (
      await repository.searchDocuments('workspace-a', {
        kinds: ['asset'],
        metadata: { authorization: 'authorized', store: '晴岚美甲' },
        query: '人物 猫眼',
      })
    ).map((item) => item.id),
    ['asset-cat-eye']
  );
  assert.deepEqual(
    (
      await repository.searchDocuments('workspace-a', {
        kinds: ['content'],
        metadata: {
          projectId: 'project-cat-eye',
          status: 'draft',
          updatedDate: '2026-07-11',
        },
        query: '阴天 预约',
        tags: ['douyin'],
      })
    ).map((item) => item.id),
    ['content-cat-eye']
  );
  assert.deepEqual(
    (
      await repository.searchDocuments('workspace-a', {
        kinds: ['content'],
        tags: ['xiaohongshu'],
      })
    ).map((item) => item.id),
    ['content-cat-eye']
  );

  await repository.upsertSearchDocument({
    id: 'external-content',
    kind: 'content',
    metadata: { projectionOwner: 'operations' },
    tags: [],
    text: '外部运营记录',
    title: '外部记录',
    updatedAt: '2026-07-20T00:03:30.000Z',
    workspaceId: 'workspace-a',
  });

  await projection.sync({
    ...state,
    assets: [],
    contents: [],
    updatedAt: '2026-07-21T00:04:00.000Z',
  });
  assert.deepEqual(
    await repository.searchDocuments('workspace-a', { query: '猫眼' }),
    []
  );
  assert.deepEqual(
    (
      await repository.searchDocuments('workspace-a', { query: '外部运营' })
    ).map((item) => item.id),
    ['external-content']
  );

  await projection.sync(state);
  assert.deepEqual(
    await repository.searchDocuments('workspace-a', { query: '猫眼' }),
    []
  );
});

test('projects every Product content status and every platform variant as facets', async () => {
  const repository = new MemoryOperationsRepository();
  const projection = new OperationsProductSearchProjection(repository);
  const statuses = ['candidate', 'draft', 'abandoned', 'published'] as const;
  const contents = statuses.map((status, index) => ({
    assetIds: [],
    complianceStatus: 'clear',
    createdAt: `2026-07-11T0${index}:00:00.000Z`,
    id: `content-${status}`,
    projectId: `project-${status}`,
    scenario: `scenario-${status}`,
    selected: status === 'draft',
    status,
    variants: [
      {
        aiDefaultVersionId: `${status}-xhs-version`,
        currentVersionId: `${status}-xhs-version`,
        id: `${status}-xhs`,
        platform: 'xiaohongshu',
        versions: [
          {
            assetOrder: [],
            body: `${status} 小红书正文`,
            conversionHook: '预约',
            createdAt: `2026-07-11T0${index}:01:00.000Z`,
            id: `${status}-xhs-version`,
            source: 'merchant',
            title: `${status} 内容`,
            topics: [],
          },
        ],
      },
      {
        aiDefaultVersionId: `${status}-douyin-version`,
        currentVersionId: `${status}-douyin-version`,
        id: `${status}-douyin`,
        platform: 'douyin',
        versions: [
          {
            assetOrder: [],
            body: `${status} 抖音正文`,
            conversionHook: '预约',
            createdAt: `2026-07-11T0${index}:02:00.000Z`,
            id: `${status}-douyin-version`,
            source: 'merchant',
            title: `${status} 抖音内容`,
            topics: [],
          },
        ],
      },
    ],
  }));

  await projection.sync({
    assets: [],
    contents,
    updatedAt: '2026-07-11T10:00:00.000Z',
    workspaceId: 'workspace-facets',
  } as unknown as ProductState);

  for (const status of statuses) {
    assert.deepEqual(
      (
        await repository.searchDocuments('workspace-facets', {
          kinds: ['content'],
          metadata: { status },
          tags: ['douyin'],
        })
      ).map((item) => item.id),
      [`content-${status}`]
    );
  }
  assert.deepEqual(
    (
      await repository.searchDocuments('workspace-facets', {
        kinds: ['content'],
        metadata: { status: 'candidate' },
        tags: ['xiaohongshu'],
      })
    ).map((item) => item.id),
    ['content-candidate']
  );
});

test('fallback search titles never expose Product object identifiers', async () => {
  const repository = new MemoryOperationsRepository();
  const projection = new OperationsProductSearchProjection(repository);
  await projection.sync({
    assets: [
      {
        aigcStatus: 'not_ai',
        authorizationStatus: 'pending',
        consentScope: 'internal_only',
        containsPerson: false,
        containsSensitiveData: false,
        createdAt: '2026-07-11T00:00:00.000Z',
        id: 'asset-private-identifier',
        mediaType: 'image',
        minorStatus: 'none',
        objectKey: 'workspace/assets/untitled.png',
        replacementRequired: false,
        rightsOwner: '',
        sourceType: 'real',
        tags: [],
      },
    ],
    contents: [
      {
        assetIds: [],
        complianceStatus: 'clear',
        createdAt: '2026-07-11T00:01:00.000Z',
        id: 'content-private-identifier',
        projectId: 'project-private',
        scenario: '',
        selected: false,
        status: 'candidate',
        variants: [],
      },
    ],
    updatedAt: '2026-07-11T00:02:00.000Z',
    workspaceId: 'workspace-private',
  } as unknown as ProductState);

  const results = await repository.searchDocuments('workspace-private', {});
  assert.deepEqual(
    results.map((item) => item.title).sort(),
    ['\u5185\u5bb9', '\u7d20\u6750']
  );
  assert.doesNotMatch(
    results.map((item) => item.title).join(' '),
    /asset-private-identifier|content-private-identifier/
  );
});
