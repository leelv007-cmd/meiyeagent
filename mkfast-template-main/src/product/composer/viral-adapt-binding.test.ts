import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bindViralAdaptSource,
  viralAdaptSourceForSession,
} from './viral-adapt-binding';

const payload = {
  schemaVersion: 'viral-adapt-source/v1' as const,
  track: 'paste' as const,
  noteText: 'RAW_NOTE_TOKEN_9f71',
  authorizedAssetIds: ['asset-reference-1'],
};

test('viral source binds only after every authorized id has revision and public rights', () => {
  assert.deepEqual(
    bindViralAdaptSource({
      sessionId: 'session-1',
      payload,
      sources: [{ id: 'asset-reference-1', rightsStatus: 'public_marketing' }],
    }),
    { ok: false, error: 'source_not_ready' }
  );
  assert.deepEqual(
    bindViralAdaptSource({
      sessionId: 'session-1',
      payload,
      sources: [
        {
          id: 'asset-reference-1',
          revision: 'asset-r1',
          rightsStatus: 'internal_only',
        },
      ],
    }),
    { ok: false, error: 'source_not_ready' }
  );

  const ready = bindViralAdaptSource({
    sessionId: 'session-1',
    payload,
    sources: [
      {
        id: 'asset-reference-1',
        revision: 'asset-r1',
        rightsStatus: 'public_marketing',
      },
    ],
  });
  assert.equal(ready.ok, true);
  if (!ready.ok) return;
  assert.deepEqual(ready.binding, { sessionId: 'session-1', payload });
});

test('stale viral binding never enters a different session submission', () => {
  const ready = bindViralAdaptSource({
    sessionId: 'session-old',
    payload: { ...payload, authorizedAssetIds: [] },
    sources: [],
  });
  assert.equal(ready.ok, true);
  if (!ready.ok) return;

  assert.deepEqual(
    viralAdaptSourceForSession(ready.binding, 'session-old'),
    ready.binding.payload
  );
  assert.equal(
    viralAdaptSourceForSession(ready.binding, 'session-new'),
    undefined
  );
  assert.equal(viralAdaptSourceForSession(null, 'session-old'), undefined);
});
