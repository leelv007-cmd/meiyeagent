import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evalLayerResultSchema,
  type EvalLayerResult,
} from '@meiye/contracts';

import {
  EVAL_LAYER_RESULT_EVENT_TYPE,
  MemoryEvalLangfuseOutboxEnqueue,
  OutboxLangfuseEvalWriter,
  RecordingLangfuseEvalWriter,
  buildEvalLayerOutboxPayload,
  projectEvalResultToLangfuseScores,
  verdictToLangfuseValue,
} from './langfuse-eval-writer.js';
import { findEvalTraceLeaks } from './trace-fields.js';

const sample: EvalLayerResult = evalLayerResultSchema.parse({
  schemaVersion: 'eval-layer-result/v1',
  resultId: 'r-langfuse-1',
  layer: 'l1',
  harnessReleaseId: 'release-lf-1',
  evalSuiteRevision: 'eval/1',
  gates: [
    { id: 'g-f', kind: 'fidelity', passed: true },
    { id: 'g-r', kind: 'rights', passed: true },
    { id: 'g-rl', kind: 'redline', passed: true },
  ],
  thresholds: [],
  verdict: 'scored',
  scoredBookkept: true,
  releasable: true,
  createdAt: '2026-08-08T03:00:00.000Z',
});

test('verdict maps to stable numeric scores', () => {
  assert.equal(verdictToLangfuseValue('passed'), 1);
  assert.equal(verdictToLangfuseValue('scored'), 0.5);
  assert.equal(verdictToLangfuseValue('failed'), 0);
});

test('Langfuse projection tags releaseId and never leaks secrets', () => {
  const projected = projectEvalResultToLangfuseScores(sample);
  assert.deepEqual(projected.tags, ['releaseId:release-lf-1']);
  assert.ok(projected.events.length >= 1);
  assert.equal(projected.events[0]?.body.name, 'eval.layer.verdict');
  assert.equal(projected.events[0]?.body.value, 0.5);
  const serialized = JSON.stringify(projected);
  assert.equal(serialized.includes('apiKey'), false);
  assert.equal(serialized.includes('upstreamUsdCost'), false);
  assert.equal(serialized.includes('chainOfThought'), false);
  assert.deepEqual(findEvalTraceLeaks(projected), []);
});

test('recording writer stores projected events', async () => {
  const writer = new RecordingLangfuseEvalWriter();
  const outcome = await writer.writeEvalResult(sample);
  assert.equal(outcome.eventCount, writer.written[0]?.events.length);
  assert.equal(writer.written.length, 1);
});

test('outbox writer enqueues D-061-clean payload (constructive leak check)', async () => {
  const outbox = new MemoryEvalLangfuseOutboxEnqueue();
  const writer = new OutboxLangfuseEvalWriter(outbox);
  const outcome = await writer.writeEvalResult(sample);

  assert.equal(outbox.events.length, 1);
  const event = outbox.events[0]!;
  assert.equal(event.eventType, EVAL_LAYER_RESULT_EVENT_TYPE);
  assert.equal(event.stage, 'eval_layer');
  assert.equal(event.id, `eval-layer:${sample.resultId}`);
  assert.ok(outcome.eventCount >= 1);

  // Constructive: enqueued payload must pass the same D-061 scanner.
  assert.deepEqual(findEvalTraceLeaks(event.payload), []);
  const payload = buildEvalLayerOutboxPayload(sample);
  assert.deepEqual(findEvalTraceLeaks(payload), []);
  assert.equal(
    JSON.stringify(event.payload).includes('apiKey'),
    false,
  );
  assert.equal(
    JSON.stringify(event.payload).includes('upstreamUsdCost'),
    false,
  );
  assert.equal(
    JSON.stringify(event.payload).includes('chainOfThought'),
    false,
  );
  assert.ok(
    Array.isArray((event.payload as { scores?: unknown }).scores) &&
      ((event.payload as { scores: unknown[] }).scores.length > 0),
  );
});
