/**
 * D-061 constructive negative tests for eval trace sanitizer (V31-23).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { P1DomainError } from '../foundation/domain.js';
import {
  assertNoEvalTraceLeaks,
  findEvalTraceLeaks,
  hasRequiredEvalTraceFields,
  sanitizeEvalTraceFields,
} from './trace-fields.js';

const safe = {
  threadId: 'thread-1',
  runId: 'run-1',
  harnessReleaseId: 'release-1',
  promptVersion: 'copy@1',
  latencyMs: 12,
};

test('required fields include thread/run/release', () => {
  assert.equal(hasRequiredEvalTraceFields(safe), true);
  assert.equal(
    hasRequiredEvalTraceFields({ threadId: 't', runId: 'r' }),
    false,
  );
});

test('sanitize accepts safe fields and rejects extras via zod strict', () => {
  const parsed = sanitizeEvalTraceFields(safe);
  assert.equal(parsed.harnessReleaseId, 'release-1');
  assert.throws(() =>
    sanitizeEvalTraceFields({ ...safe, apiKey: 'sk-should-never-leave' }),
  );
});

test('D-061: nested apiKey / CoT / upstream USD keys are leaks', () => {
  const findings = findEvalTraceLeaks({
    ok: true,
    nested: {
      apiKey: 'sk-test-leak',
      chainOfThought: 'secret reasoning',
      cost: { upstreamUsdCost: 0.012 },
    },
  });
  const keys = findings.map((item) => item.key).sort();
  assert.ok(keys.includes('apiKey'));
  assert.ok(keys.includes('chainOfThought'));
  assert.ok(keys.includes('upstreamUsdCost'));
  assert.throws(
    () =>
      assertNoEvalTraceLeaks({
        nested: { raw_customer_pii: { phone: '13800000000' } },
      }),
    (error: unknown) =>
      error instanceof P1DomainError && error.code === 'INVALID_STATE',
  );
});

test('D-061: serialized sk- and Bearer tokens are value-shape leaks', () => {
  const findings = findEvalTraceLeaks({
    note: 'provider called with sk-live-ABCDEFGH1234',
  });
  assert.ok(findings.some((item) => item.key === 'openai_sk'));
  const bearer = findEvalTraceLeaks({
    header: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9xx',
  });
  assert.ok(bearer.some((item) => item.key === 'bearer_token'));
});

test('safe payload has zero leaks', () => {
  assert.deepEqual(findEvalTraceLeaks(safe), []);
  assert.doesNotThrow(() => assertNoEvalTraceLeaks(safe));
});
