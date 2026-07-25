import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assetDraftSchema,
  parseAssetBatchCommandSchema,
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
    parseAssetBatchCommandSchema.parse({
      taskId: 'task-a',
      sources: [source('asset-a'), source('asset-a')],
    }),
  );
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
