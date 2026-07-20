/**
 * Unified ResultCommandAdapter tests (WT-D1 / #99).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRecordingResultCommandPort,
  createResultCommandAdapter,
  validateResultCommandInput,
} from './result-command-adapter';

test('rejects missing workId without calling the port', async () => {
  const port = createRecordingResultCommandPort();
  const adapter = createResultCommandAdapter({ port });
  const outcome = await adapter.execute({
    action: 'adopt_candidate',
    target: { workId: '' },
    idempotencyKey: 'idem-1',
  });
  assert.equal(outcome.kind, 'rejected');
  if (outcome.kind !== 'rejected') return;
  assert.equal(outcome.code, 'MISSING_WORK_ID');
  assert.equal(port.calls.length, 0);
});

test('rejects missing idempotency key', () => {
  const invalid = validateResultCommandInput({
    action: 'deliver',
    target: { workId: 'work-1' },
    idempotencyKey: '',
  });
  assert.equal(invalid?.kind, 'rejected');
  if (invalid?.kind !== 'rejected') return;
  assert.equal(invalid.code, 'MISSING_IDEMPOTENCY_KEY');
});

test('rejects unknown action ids', () => {
  const invalid = validateResultCommandInput({
    // @ts-expect-error intentional invalid action for validation
    action: 'invented_action',
    target: { workId: 'work-1' },
    idempotencyKey: 'idem-1',
  });
  assert.equal(invalid?.kind, 'rejected');
  if (invalid?.kind !== 'rejected') return;
  assert.equal(invalid.code, 'UNKNOWN_ACTION');
});

test('dispatches valid commands through the single port', async () => {
  const port = createRecordingResultCommandPort();
  port.setOutcome({ kind: 'ok', revisionId: 'rev-9' });
  const adapter = createResultCommandAdapter({ port });

  const outcome = await adapter.execute({
    action: 'adopt_candidate',
    target: { workId: 'work-1', contentId: 'pkg-1' },
    expectedRevision: 'rev-8',
    idempotencyKey: 'idem-adopt-1',
  });

  assert.equal(outcome.kind, 'ok');
  if (outcome.kind !== 'ok') return;
  assert.equal(outcome.revisionId, 'rev-9');
  assert.equal(port.calls.length, 1);
  assert.equal(port.calls[0]?.action, 'adopt_candidate');
  assert.equal(port.calls[0]?.idempotencyKey, 'idem-adopt-1');
  assert.equal(port.calls[0]?.expectedRevision, 'rev-8');
});

test('stale expectedRevision is detected before port dispatch', async () => {
  const port = createRecordingResultCommandPort();
  const adapter = createResultCommandAdapter({
    port,
    getCurrentRevision: async () => 'rev-20',
  });

  const outcome = await adapter.execute({
    action: 'continue_adjust',
    target: { workId: 'work-1' },
    expectedRevision: 'rev-19',
    idempotencyKey: 'idem-2',
  });

  assert.equal(outcome.kind, 'stale');
  if (outcome.kind !== 'stale') return;
  assert.equal(outcome.currentRevisionId, 'rev-20');
  assert.equal(outcome.baseRevisionId, 'rev-19');
  assert.equal(port.calls.length, 0);
});

test('matching expectedRevision proceeds to port', async () => {
  const port = createRecordingResultCommandPort();
  const adapter = createResultCommandAdapter({
    port,
    getCurrentRevision: async () => 'rev-19',
  });

  const outcome = await adapter.execute({
    action: 'deliver',
    target: { workId: 'work-1' },
    expectedRevision: 'rev-19',
    idempotencyKey: 'idem-3',
  });

  assert.equal(outcome.kind, 'ok');
  assert.equal(port.calls.length, 1);
});
