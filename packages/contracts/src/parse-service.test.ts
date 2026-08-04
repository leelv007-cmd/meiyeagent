import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assetDraftSchema,
  assetDraftViewSchema,
  assetParseTaskDraftsSchema,
  parseAssetBatchInputSchema,
  parseTaskSchema,
} from './parse-service.js';

const now = '2026-07-26T02:00:00.000Z';

test('parsed draft fields stay unconfirmed and carry photo provenance', () => {
  const draft = assetDraftSchema.parse({
    draftId: 'draft-a',
    revision: 1,
    workspaceId: 'workspace-a',
    taskId: 'task-a',
    sourceAssetId: 'asset-a',
    parsedDocumentId: 'parsed-a',
    target: 'price_list',
    origin: 'parsed',
    fields: [
      {
        key: 'offer.price',
        value: { amount: 239, currency: 'CNY' },
        provenance: 'photo_extract',
        status: 'unconfirmed',
      },
    ],
    factCandidates: [],
    visualClassification: null,
    createdAt: now,
  });

  assert.equal(draft.fields[0]?.status, 'unconfirmed');
  assert.equal(draft.fields[0]?.provenance, 'photo_extract');
  assert.throws(() =>
    assetDraftSchema.parse({
      ...draft,
      origin: 'manual',
    }),
  );
});

test('fallback drafts stay distinct from merchant-authored drafts', () => {
  const fallback = assetDraftSchema.parse({
    draftId: 'draft-fallback',
    revision: 1,
    workspaceId: 'workspace-a',
    taskId: 'task-fallback',
    sourceAssetId: 'asset-fallback',
    parsedDocumentId: null,
    target: 'price_list',
    origin: 'fallback',
    fields: [
      {
        key: 'fallback.message',
        value: '请直接确认关键信息。',
        provenance: 'ai_suggestion',
        status: 'unconfirmed',
      },
    ],
    factCandidates: [],
    visualClassification: null,
    createdAt: now,
  });

  assert.equal(fallback.origin, 'fallback');
  assert.throws(() =>
    assetDraftSchema.parse({
      ...fallback,
      origin: 'manual',
    }),
  );
});

test('draft views disclose whether parsed content came from a fixture', () => {
  const view = assetDraftViewSchema.parse({
    draftId: 'draft-fixture',
    revision: 1,
    workspaceId: 'workspace-a',
    taskId: 'task-fixture',
    sourceAssetId: 'asset-fixture',
    parsedDocumentId: 'parsed-fixture',
    target: 'price_list',
    origin: 'parsed',
    fields: [],
    factCandidates: [],
    visualClassification: null,
    parser: { kind: 'fixture' },
    createdAt: now,
  });

  assert.equal(view.parser?.kind, 'fixture');
});

test('single and batch task modes cannot silently swap cardinality', () => {
  assert.throws(() =>
    parseTaskSchema.parse({
      taskId: 'task-a',
      workspaceId: 'workspace-a',
      mode: 'single_sync',
      status: 'queued',
      sourceAssetIds: ['asset-a', 'asset-b'],
      progress: { completed: 0, total: 2, message: '正在整理资料' },
      disclosure: '上传内容会交给第三方解析服务处理。',
      createdAt: now,
      updatedAt: now,
    }),
  );
  assert.throws(() =>
    parseAssetBatchInputSchema.parse({
      taskId: 'task-a',
      sources: [source('asset-a'), source('asset-a')],
    }),
  );
});

test('batch input rejects fewer than two sources, duplicate ids, and extras', () => {
  assert.throws(
    () =>
      parseAssetBatchInputSchema.parse({
        taskId: 'task-a',
        sources: [source('asset-a')],
      }),
    /Too small|>=2 items/u,
  );
  assert.throws(
    () =>
      parseAssetBatchInputSchema.parse({
        taskId: 'task-a',
        sources: [source('asset-a'), source('asset-a')],
      }),
    /unique/u,
  );
  assert.throws(
    () =>
      parseAssetBatchInputSchema.parse({
        taskId: 'task-a',
        sources: [source('asset-a'), source('asset-b')],
        extra: true,
      }),
    /unrecognized_keys|Unrecognized key/u,
  );
});

test('parse task draft enumeration keeps null for unproduced sources', () => {
  const empty = assetParseTaskDraftsSchema.parse({
    taskId: 'task-a',
    items: [
      { sourceAssetId: 'asset-a', draft: null },
      { sourceAssetId: 'asset-b', draft: null },
    ],
  });
  assert.equal(empty.items[0]?.draft, null);

  const withDraft = assetParseTaskDraftsSchema.parse({
    taskId: 'task-a',
    items: [
      {
        sourceAssetId: 'asset-a',
        draft: {
          draftId: 'draft-a',
          revision: 1,
          workspaceId: 'workspace-a',
          taskId: 'task-a',
          sourceAssetId: 'asset-a',
          parsedDocumentId: 'parsed-a',
          target: 'price_list',
          origin: 'parsed',
          fields: [],
          factCandidates: [],
          visualClassification: null,
          parser: { kind: 'fixture' },
          createdAt: now,
        },
      },
    ],
  });
  assert.equal(withDraft.items[0]?.draft?.parser?.kind, 'fixture');
  assert.equal(withDraft.items[0]?.draft?.origin, 'parsed');
});

function source(assetId: string) {
  return {
    assetId,
    objectKey: `workspace-a/owned/${assetId}.png`,
    sha256: 'a'.repeat(64),
    sizeBytes: 100,
    contentType: 'image/png',
    sourceUrl: 'https://assets.example.test/a.png',
    inputKind: 'document_image',
    target: 'price_list',
    rightsStatus: 'confirmed',
  };
}
