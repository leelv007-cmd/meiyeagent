/**
 * V31-61: recorded composition duration is clips-first, never subtitle-derived.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveRecordedCompositionDurationSeconds } from './index.js';

test('V31-61 duration uses clip technicalValidation seconds when present', () => {
  assert.equal(
    resolveRecordedCompositionDurationSeconds([
      { technicalValidation: { durationSeconds: 10 } },
      { technicalValidation: { durationSeconds: 12 } },
    ]),
    22,
  );
});

test('V31-61 duration falls back to 15s per clip without technicalValidation', () => {
  assert.equal(resolveRecordedCompositionDurationSeconds([{}, {}]), 30);
  assert.equal(resolveRecordedCompositionDurationSeconds([]), 15);
});

test('V31-61 duration never consults a subtitle timeline (regression shape)', () => {
  // Same clip count yields same duration regardless of any external subtitle
  // endSeconds that callers might still pass to compose — the helper only sees clips.
  const clips = [
    { technicalValidation: { durationSeconds: 8 } },
    { technicalValidation: { durationSeconds: 8 } },
  ];
  assert.equal(resolveRecordedCompositionDurationSeconds(clips), 16);
  assert.notEqual(resolveRecordedCompositionDurationSeconds(clips), 99);
});
