import assert from 'node:assert/strict';
import test from 'node:test';

import {
  observabilityAxesSchema,
  observabilityDropEventSchema,
} from './index.js';

test('observability axes accept only flat execution dimensions with locked composite revisions', () => {
  const result = observabilityAxesSchema.parse({
    skillRevision: ' copywriter@rev-17 ',
    promptVersion: ' marketing/copy@v4 ',
    catalogRevision: ' catalog-2026-07-29 ',
    scene: ' copy.generate ',
  });

  assert.deepEqual(result, {
    skillRevision: 'copywriter@rev-17',
    promptVersion: 'marketing/copy@v4',
    catalogRevision: 'catalog-2026-07-29',
    scene: 'copy.generate',
  });

  for (const invalid of [
    {
      skillRevision: { skillId: 'copywriter', revision: 'rev-17' },
      promptVersion: 'marketing/copy@v4',
      catalogRevision: 'catalog-2026-07-29',
      scene: 'copy.generate',
    },
    {
      skillRevision: 'copywriter@rev-17',
      promptVersion: { promptName: 'marketing/copy', version: 'v4' },
      catalogRevision: 'catalog-2026-07-29',
      scene: 'copy.generate',
    },
    {
      skillRevision: 'copywriter',
      promptVersion: 'marketing/copy@v4',
      catalogRevision: 'catalog-2026-07-29',
      scene: 'copy.generate',
    },
    {
      skillRevision: 'copywriter@rev-17',
      promptVersion: 'marketing/copy@v4@latest',
      catalogRevision: 'catalog-2026-07-29',
      scene: 'copy.generate',
    },
    {
      skillRevision: 'copywriter@rev-17',
      promptVersion: 'marketing/copy@v4',
      catalogRevision: 'catalog-2026-07-29',
    },
    {
      skillRevision: 'copywriter@rev-17',
      promptVersion: 'marketing/copy@v4',
      catalogRevision: ' ',
      scene: 'copy.generate',
    },
    {
      skillRevision: 'copywriter@rev-17',
      promptVersion: 'marketing/copy@v4',
      catalogRevision: 'catalog-2026-07-29',
      scene: ' ',
    },
    {
      skillRevision: 'copywriter@rev-17',
      promptVersion: 'marketing/copy@v4',
      catalogRevision: 'catalog-2026-07-29',
      scene: 'copy.generate',
      versions: {},
    },
  ]) {
    assert.equal(observabilityAxesSchema.safeParse(invalid).success, false);
  }
});

test('observability drop events record a known lost signal on the independent health contract', () => {
  assert.deepEqual(
    observabilityDropEventSchema.parse({
      signal: 'trace',
      reason: 'permanent-config',
      count: 3,
      source: 'langfuse-outbox',
    }),
    {
      signal: 'trace',
      reason: 'permanent-config',
      count: 3,
      source: 'langfuse-outbox',
    },
  );

  for (const signal of ['trace', 'log', 'metric', 'score', 'feedback']) {
    assert.equal(
      observabilityDropEventSchema.safeParse({
        signal,
        reason: 'transient',
        count: 1,
        source: ' langfuse-outbox ',
      }).success,
      true,
    );
  }

  for (const invalid of [
    {
      signal: 'trace',
      reason: 'unknown',
      count: 3,
      source: 'langfuse-outbox',
    },
    {
      signal: 'trace',
      reason: 'permanent-config',
      count: 0,
      source: 'langfuse-outbox',
    },
    {
      signal: 'trace',
      reason: 'transient',
      count: 3,
      source: ' ',
    },
    {
      signal: 'trace',
      reason: 'transient',
      count: 3,
      source: 'langfuse-outbox',
      retryAt: '2026-07-29T00:00:00.000Z',
    },
  ]) {
    assert.equal(
      observabilityDropEventSchema.safeParse(invalid).success,
      false,
    );
  }
});
