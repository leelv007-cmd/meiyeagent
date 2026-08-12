import assert from 'node:assert/strict';
import test from 'node:test';

import { AgentFaultReceiptProbe } from './agent-fault-receipt';

test('keeps injecting the SSE fault until Core returns its receipt', () => {
  const probe = new AgentFaultReceiptProbe('artifact-gap-close');
  const cancelledRequest = {};
  const receiptedRequest = {};
  const recoveredRequest = {};

  const cancelled = probe.beginRequest(
    cancelledRequest,
    'http://127.0.0.1/api/core/p1/agent-threads/thread-a/events'
  );
  assert.equal(
    new URL(cancelled.forwardUrl).searchParams.get('e2eAgentFault'),
    'artifact-gap-close'
  );
  probe.recordFailure(cancelledRequest, 'net::ERR_ABORTED');

  const receipted = probe.beginRequest(
    receiptedRequest,
    'http://127.0.0.1/api/core/p1/agent-threads/thread-a/events?lastStreamOffset=7'
  );
  assert.equal(
    new URL(receipted.forwardUrl).searchParams.get('e2eAgentFault'),
    'artifact-gap-close'
  );
  probe.recordResponse(receiptedRequest, 200, 'artifact-gap-close');

  const recovered = probe.beginRequest(
    recoveredRequest,
    'http://127.0.0.1/api/core/p1/agent-threads/thread-a/events?lastStreamOffset=8'
  );
  assert.equal(recovered.forwardUrl, null);
  assert.equal(probe.receiptObserved, true);
  assert.deepEqual(
    probe.diagnostics().map(({ failure, receipt, status }) => ({
      failure,
      receipt,
      status,
    })),
    [
      {
        failure: 'net::ERR_ABORTED',
        receipt: null,
        status: null,
      },
      {
        failure: null,
        receipt: 'artifact-gap-close',
        status: 200,
      },
      { failure: null, receipt: null, status: null },
    ]
  );
});

test('diagnostics retain the original route URL without leaking query secrets', () => {
  const probe = new AgentFaultReceiptProbe('artifact-gap-close');
  const request = {};

  probe.beginRequest(
    request,
    'http://127.0.0.1/api/core/p1/agent-threads/thread-a/events?lastEventId=event-7&access_token=secret-value'
  );
  probe.recordFailure(
    request,
    'failed at https://example.test/events?credential=secret-value'
  );

  assert.equal(
    probe.diagnostics()[0]?.originalUrl,
    'http://127.0.0.1/api/core/p1/agent-threads/thread-a/events?access_token=%3Credacted%3E&lastEventId=event-7'
  );
  assert.doesNotMatch(JSON.stringify(probe.diagnostics()), /secret-value/u);
});

test('rejects an original browser URL that already carries the test fault', () => {
  const probe = new AgentFaultReceiptProbe('artifact-gap-close');

  assert.throws(
    () =>
      probe.beginRequest(
        {},
        'http://127.0.0.1/api/core/p1/agent-threads/thread-a/events?e2eAgentFault=artifact-gap-close'
      ),
    /original browser request already contains e2eAgentFault/u
  );
});
