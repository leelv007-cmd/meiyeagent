import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';

import { apiEnvelopeSchema } from './api-envelope.js';

const envelopeSchema = apiEnvelopeSchema(
  z.object({ value: z.string() }).strict(),
);

test('API envelope parses success and governed error responses', () => {
  assert.deepEqual(
    envelopeSchema.parse({
      data: { value: 'ok' },
      meta: { correlationId: 'corr-1' },
    }),
    { data: { value: 'ok' }, meta: { correlationId: 'corr-1' } },
  );
  assert.deepEqual(
    envelopeSchema.parse({
      error: { code: 'FORBIDDEN', message: 'Denied.' },
      meta: { correlationId: 'corr-2' },
    }),
    {
      error: { code: 'FORBIDDEN', message: 'Denied.' },
      meta: { correlationId: 'corr-2' },
    },
  );
});

test('API envelope keeps non-empty legacy codes but rejects malformed wire shapes', () => {
  assert.equal(
    envelopeSchema.safeParse({
      error: { code: 'LEGACY_DOMAIN_CODE', message: 'Legacy failure.' },
      meta: { correlationId: 'corr-3' },
    }).success,
    true,
  );
  for (const malformed of [
    { data: { value: 'ok' } },
    { data: { value: 'ok' }, meta: { correlationId: '' } },
    {
      error: { code: '', message: 'Missing code.' },
      meta: { correlationId: 'corr-4' },
    },
    {
      data: { value: 'ok' },
      error: { code: 'FORBIDDEN', message: 'Ambiguous.' },
      meta: { correlationId: 'corr-5' },
    },
  ]) {
    assert.equal(envelopeSchema.safeParse(malformed).success, false);
  }
});
