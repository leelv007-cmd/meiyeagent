import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeCatalog } from './settings-view-model';

test('keeps validated observed duration evidence in the public catalog view', () => {
  const catalog = normalizeCatalog(
    {
      models: [
        {
          activationEvidence: { status: 'live_verified' },
          available: true,
          displayName: 'OpenAI',
          durationEstimate: {
            asOf: '2026-07-13T12:00:00.000Z',
            p50Seconds: 42,
            p90Seconds: 88,
            sampleSize: 8,
            status: 'observed',
            windowDays: 30,
          },
          id: 'llm-openai',
          modality: 'llm',
          operations: ['copy.generate'],
        },
      ],
    },
    'copy.generate'
  );

  assert.deepEqual(catalog.models[0]?.durationEstimate, {
    asOf: '2026-07-13T12:00:00.000Z',
    p50Seconds: 42,
    p90Seconds: 88,
    sampleSize: 8,
    status: 'observed',
    windowDays: 30,
  });
});

test('drops malformed duration evidence instead of showing a guess', () => {
  const catalog = normalizeCatalog(
    {
      models: [
        {
          durationEstimate: {
            p50Seconds: 12,
            sampleSize: 2,
            status: 'observed',
          },
          id: 'llm-openai',
          operations: ['copy.generate'],
        },
      ],
    },
    'copy.generate'
  );
  assert.equal(catalog.models[0]?.durationEstimate, undefined);
});
