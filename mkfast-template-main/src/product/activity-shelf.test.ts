/**
 * P1-3 Activity Shelf pure projection (#318).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  CreativeAssetProjection,
  CreativeWork,
  CreativeWorkbenchProjection,
} from '@meiye/contracts';

import {
  ACTIVITY_SHELF_MAX_CARDS,
  activityShelfNextActionLabel,
  activityShelfStatusLabel,
  activityShelfThumb,
  dashboardContinueItems,
  projectActivityShelfCards,
} from './activity-shelf';

function work(
  id: string,
  status: CreativeWork['status'],
  intent: string,
  extras: Partial<CreativeWork> = {}
): CreativeWork {
  return {
    id,
    workspaceId: 'ws-1',
    sessionId: 's-1',
    intent,
    mode: 'agent',
    sourceReferences: [],
    status,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...extras,
  };
}

function projection(
  works: CreativeWork[],
  assets: CreativeAssetProjection[] = []
): CreativeWorkbenchProjection {
  return { assets, contents: [], events: [], jobs: [], works };
}

test('P1-3: Activity Shelf caps at 3 cards', () => {
  assert.equal(ACTIVITY_SHELF_MAX_CARDS, 3);
  const cards = projectActivityShelfCards(
    projection(
      Array.from({ length: 8 }, (_, i) =>
        work(`w-${i}`, 'completed', `intent ${i}`)
      )
    )
  );
  assert.equal(cards.length, 3);
  assert.equal(
    dashboardContinueItems(
      projection(
        Array.from({ length: 8 }, (_, i) =>
          work(`w-${i}`, 'completed', `intent ${i}`)
        )
      )
    ).length,
    3
  );
});

test('P1-3: needs-attention works surface first (draft/running/failed)', () => {
  const cards = projectActivityShelfCards(
    projection([
      work('done-1', 'completed', 'finished one'),
      work('running-1', 'running', 'still going'),
      work('draft-1', 'draft', 'never sent'),
    ])
  );
  assert.deepEqual(
    cards.map((c) => c.workId),
    ['running-1', 'draft-1', 'done-1']
  );
});

test('P1-3: failed is needs-attention and sorts ahead of completed', () => {
  const cards = projectActivityShelfCards(
    projection([
      work('done-1', 'completed', 'finished one'),
      work('fail-1', 'failed', 'broken set'),
      work('run-1', 'running', 'still going'),
    ])
  );
  assert.deepEqual(
    cards.map((c) => c.workId),
    ['fail-1', 'run-1', 'done-1']
  );
  const failed = cards.find((c) => c.workId === 'fail-1');
  assert.ok(failed);
  assert.equal(failed.needsAttention, true);
  assert.equal(failed.unfinished, false);
  assert.equal(failed.statusLabel, activityShelfStatusLabel('failed'));
  assert.match(failed.statusLabel, /生成失败|Generation failed/u);
  assert.equal(failed.nextActionLabel, activityShelfNextActionLabel('failed'));
});

test('P1-3: each card carries status + next action + full intent', () => {
  const cards = projectActivityShelfCards(
    projection([
      work('r1', 'running', '母亲节朋友圈文案'),
      work('c1', 'completed', '新客到店海报'),
      work('f1', 'failed', '失败的套图'),
    ])
  );
  assert.equal(cards.length, 3);
  for (const card of cards) {
    assert.ok(card.statusLabel.length > 0, 'status present');
    assert.ok(card.nextActionLabel.length > 0, 'next action present');
    assert.ok(card.title.length > 0, 'title present');
    assert.ok(card.intent.length > 0, 'full intent present');
    assert.ok(card.thumb, 'thumb present');
  }
  assert.match(activityShelfStatusLabel('running'), /正在生成|Generating/iu);
  assert.match(activityShelfNextActionLabel('running'), /查看进度|progress/iu);
  assert.match(
    activityShelfNextActionLabel('completed'),
    /继续调整|adjusting/iu
  );
  assert.match(activityShelfNextActionLabel('draft'), /继续编辑|editing/iu);
  assert.match(activityShelfNextActionLabel('failed'), /重新处理|retry/iu);
});

test('P1-3: thumb prefers image objectKey for the work', () => {
  const workRow = work('w1', 'completed', '套图');
  const assets: CreativeAssetProjection[] = [
    {
      id: 'a-text',
      workspaceId: 'ws-1',
      workId: 'w1',
      jobId: 'j1',
      kind: 'text',
      title: '文案',
      createdAt: '2026-08-01T00:00:00.000Z',
    },
    {
      id: 'a-img',
      workspaceId: 'ws-1',
      workId: 'w1',
      jobId: 'j1',
      kind: 'image',
      title: '封面',
      objectKey: 'ws-1/cover.png',
      contentType: 'image/png',
      createdAt: '2026-08-01T00:00:00.000Z',
    },
  ];
  const thumb = activityShelfThumb(workRow, assets);
  assert.equal(thumb.kind, 'image');
  assert.match(thumb.src ?? '', /objectKey=ws-1%2Fcover\.png/u);

  const cards = projectActivityShelfCards(projection([workRow], assets));
  assert.equal(cards[0]?.thumb.kind, 'image');
});

test('P1-3: video objectKey yields video thumb kind', () => {
  const workRow = work('w-video', 'completed', '抖音成片');
  const assets: CreativeAssetProjection[] = [
    {
      id: 'a-vid',
      workspaceId: 'ws-1',
      workId: 'w-video',
      jobId: 'j1',
      kind: 'video',
      title: '成片',
      objectKey: 'ws-1/clip.mp4',
      contentType: 'video/mp4',
      createdAt: '2026-08-01T00:00:00.000Z',
    },
  ];
  const thumb = activityShelfThumb(workRow, assets);
  assert.equal(thumb.kind, 'video');
  assert.match(thumb.src ?? '', /objectKey=ws-1%2Fclip\.mp4/u);
});

test('P1-3: coverAssetId draft cover is used when no owned media yet', () => {
  const workRow = work('w-cover', 'running', '套图进行中', {
    workingSelectionDraft: {
      baseRevisionId: 'rev-1',
      orderedAssetIds: ['cover-1'],
      coverAssetId: 'cover-1',
      surfaceVersion: 'v1',
      revision: 1,
      savedAt: '2026-08-01T00:00:00.000Z',
      savedBy: 'user-1',
    },
  });
  const assets: CreativeAssetProjection[] = [
    {
      id: 'cover-1',
      workspaceId: 'ws-1',
      workId: 'other-work',
      jobId: 'j1',
      kind: 'image',
      title: '封面',
      objectKey: 'ws-1/draft-cover.png',
      contentType: 'image/png',
      createdAt: '2026-08-01T00:00:00.000Z',
    },
  ];
  const thumb = activityShelfThumb(workRow, assets);
  assert.equal(thumb.kind, 'image');
  assert.match(thumb.src ?? '', /draft-cover/u);
});

test('P1-3: missing media degrades to icon thumb kind', () => {
  const thumb = activityShelfThumb(work('w1', 'draft', '草稿'), []);
  assert.equal(thumb.kind, 'unknown');
  assert.equal(thumb.src, undefined);
});
