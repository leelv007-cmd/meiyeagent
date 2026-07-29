import assert from 'node:assert/strict';
import test from 'node:test';

import { notePageRegeneratedEventSchema } from './index.js';

test('note page regeneration records the user-selection trigger in the canonical event envelope', () => {
  const event = notePageRegeneratedEventSchema.parse({
    eventType: 'note_page_regenerated',
    payload: {
      auditRef: 'note-page-regeneration:page-2:r2',
      imagePoints: 1,
      pageId: 'page-2',
      trigger: 'user_selection',
    },
  });

  assert.deepEqual(event, {
    eventType: 'note_page_regenerated',
    payload: {
      auditRef: 'note-page-regeneration:page-2:r2',
      imagePoints: 1,
      pageId: 'page-2',
      trigger: 'user_selection',
    },
  });
});

test('note page regeneration distinguishes a consistency-check violation without changing its text payload', () => {
  assert.deepEqual(
    notePageRegeneratedEventSchema.parse({
      eventType: 'note_page_regenerated',
      payload: {
        auditRef: 'note-page-rewrite:page-2:r2',
        imagePoints: 0,
        pageId: 'page-2',
        reason: '文字语气与整套内容不一致',
        side: 'text',
        trigger: 'check_violation',
      },
    }),
    {
      eventType: 'note_page_regenerated',
      payload: {
        auditRef: 'note-page-rewrite:page-2:r2',
        imagePoints: 0,
        pageId: 'page-2',
        reason: '文字语气与整套内容不一致',
        side: 'text',
        trigger: 'check_violation',
      },
    },
  );
});

test('note page regeneration rejects payloads outside the two production event shapes', () => {
  const base = {
    auditRef: 'note-page-regeneration:page-2:r2',
    pageId: 'page-2',
    trigger: 'check_violation',
  };

  for (const invalid of [
    {
      eventType: 'note_page_regenerated',
      payload: { ...base, imagePoints: 2 },
    },
    {
      eventType: 'note_page_regenerated',
      payload: { ...base, imagePoints: 0 },
    },
    {
      eventType: 'note_page_regenerated',
      payload: {
        ...base,
        imagePoints: 1,
        reason: '不应出现在图片回炉事件',
        side: 'text',
      },
    },
    {
      eventType: 'note_page_regenerated',
      payload: {
        ...base,
        imagePoints: 0,
        reason: '文字需回炉',
        side: 'image',
      },
    },
    {
      eventType: 'note_page_regenerated',
      payload: {
        ...base,
        imagePoints: 1,
        trigger: 'unknown',
      },
    },
    {
      eventType: 'note_page_regenerated',
      payload: {
        auditRef: 'note-page-regeneration:page-2:r2',
        imagePoints: 1,
        pageId: 'page-2',
      },
    },
    {
      eventType: 'note_page_regenerated',
      payload: { ...base, imagePoints: 1, prompt: 'hidden' },
    },
    {
      eventType: 'note_page_regenerated',
      payload: { ...base, auditRef: ' ', imagePoints: 1 },
    },
    {
      eventType: 'note_page_regenerated',
      payload: { ...base, imagePoints: 1 },
      recordedAt: '2026-07-29T00:00:00.000Z',
    },
  ]) {
    assert.equal(notePageRegeneratedEventSchema.safeParse(invalid).success, false);
  }
});
