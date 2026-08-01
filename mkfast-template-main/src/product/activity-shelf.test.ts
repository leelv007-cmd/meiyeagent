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

test('P1-3: unfinished works surface first', () => {
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

test('P1-3: each card carries status + next action labels', () => {
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
    assert.ok(card.thumb, 'thumb present');
  }
  assert.equal(activityShelfStatusLabel('running'), '正在生成');
  assert.equal(activityShelfNextActionLabel('running'), '查看进度');
  assert.equal(activityShelfNextActionLabel('completed'), '继续调整');
  assert.equal(activityShelfNextActionLabel('draft'), '继续编辑');
  assert.equal(activityShelfNextActionLabel('failed'), '重新处理');
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

test('P1-3: missing media degrades to icon thumb kind', () => {
  const thumb = activityShelfThumb(work('w1', 'draft', '草稿'), []);
  assert.equal(thumb.kind, 'unknown');
  assert.equal(thumb.src, undefined);
});
