import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLandingHandoff,
  captureLandingIntent,
  clearLandingHandoff,
  isLandingHandoffFresh,
  LANDING_HANDOFF_FORBIDDEN_KEYS,
  LANDING_HANDOFF_SCHEMA,
  LANDING_HANDOFF_STORAGE_KEY,
  projectLandingHandoff,
  readLandingHandoff,
  writeLandingHandoff,
} from './landing-handoff';

function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem(key: string) {
      return map.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
    removeItem(key: string) {
      map.delete(key);
    },
  };
}

test('landing handoff only allows intent, optional lens, and createdAt', () => {
  const ok = projectLandingHandoff({
    schemaVersion: LANDING_HANDOFF_SCHEMA,
    intent: '发一条本周美甲上新',
    createdAt: '2026-07-22T12:00:00.000Z',
    lens: 'copy',
  });
  assert.equal(ok.ok, true);
  if (!ok.ok) return;
  assert.deepEqual(ok.handoff, {
    schemaVersion: LANDING_HANDOFF_SCHEMA,
    intent: '发一条本周美甲上新',
    createdAt: '2026-07-22T12:00:00.000Z',
    lens: 'copy',
  });
});

test('landing handoff rejects assets, rights, quotes, provider, and prompts', () => {
  for (const key of [
    'assets',
    'rights',
    'quote',
    'provider',
    'hiddenPrompt',
    'composerDraft',
  ] as const) {
    const result = projectLandingHandoff({
      schemaVersion: LANDING_HANDOFF_SCHEMA,
      intent: 'valid intent text',
      createdAt: '2026-07-22T12:00:00.000Z',
      [key]: key === 'assets' ? [] : 'x',
    });
    assert.equal(result.ok, false, `expected reject for ${key}`);
    if (result.ok) return;
    assert.match(result.reason, /forbidden|whitelist/u);
  }
  assert.ok(LANDING_HANDOFF_FORBIDDEN_KEYS.includes('hiddenPrompt'));
});

test('capture + read restores intent without auto-submit side effects', () => {
  const storage = memoryStorage();
  assert.equal(
    captureLandingIntent({
      intent: '  今天想发透亮猫眼  ',
      lens: 'image_text',
      storage,
      createdAt: '2026-07-22T08:00:00.000Z',
    }),
    true
  );
  const handoff = readLandingHandoff(storage, {
    nowMs: Date.parse('2026-07-22T09:00:00.000Z'),
  });
  assert.deepEqual(handoff, {
    schemaVersion: LANDING_HANDOFF_SCHEMA,
    intent: '今天想发透亮猫眼',
    createdAt: '2026-07-22T08:00:00.000Z',
    lens: 'image_text',
  });
  clearLandingHandoff(storage);
  assert.equal(readLandingHandoff(storage), null);
});

test('stale handoff expires and empty intent is not stored', () => {
  const storage = memoryStorage();
  assert.equal(captureLandingIntent({ intent: ' ', storage }), false);
  const built = buildLandingHandoff({
    intent: '还在有效期内吗',
    createdAt: '2026-07-20T00:00:00.000Z',
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.equal(writeLandingHandoff(built.handoff, storage), true);
  assert.equal(
    readLandingHandoff(storage, {
      nowMs: Date.parse('2026-07-22T01:00:00.000Z'),
    }),
    null
  );
  assert.equal(
    isLandingHandoffFresh(
      built.handoff,
      Date.parse('2026-07-20T01:00:00.000Z')
    ),
    true
  );
  assert.equal(storage.getItem(LANDING_HANDOFF_STORAGE_KEY) != null, true);
});
