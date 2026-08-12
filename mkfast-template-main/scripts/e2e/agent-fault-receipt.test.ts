import assert from 'node:assert/strict';
import test from 'node:test';

import { AgentFaultReceiptProbe } from './agent-fault-receipt';

test('keeps injecting the SSE fault until Core returns its receipt', () => {
  const probe = new AgentFaultReceiptProbe('artifact-gap-close');
  const cancelledRequest = {};
  const receiptedRequest = {};
  const recoveredRequest = {};

  probe.bindTargetThread('thread-a');

  const cancelled = probe.beginRequest(
    cancelledRequest,
    'http://127.0.0.1/api/core/p1/agent-threads/thread-a/events'
  );
  assert.equal(
    new URL(cancelled.forwardUrl).searchParams.get('e2eAgentFault'),
    'artifact-gap-close'
  );
  probe.recordFailure(
    cancelledRequest,
    'net::ERR_ABORTED TOKEN=not-for-artifacts user@example.test'
  );
  probe.recordResponse(cancelledRequest, 200, 'artifact-gap-close');
  assert.equal(
    probe.receiptObserved,
    false,
    'a failed request cannot satisfy the target receipt contract'
  );

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
        failure: 'request_failed',
        receipt: 'artifact-gap-close',
        status: 200,
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

test('ignores out-of-order receipts from another Thread or unregistered request', () => {
  const probe = new AgentFaultReceiptProbe('artifact-gap-close');
  const targetRequest = {};
  const otherThreadRequest = {};

  const target = probe.beginRequest(
    targetRequest,
    'http://127.0.0.1/api/core/p1/agent-threads/thread-target/events'
  );
  const other = probe.beginRequest(
    otherThreadRequest,
    'http://127.0.0.1/api/core/p1/agent-threads/thread-other/events'
  );
  assert.equal(
    new URL(target.forwardUrl).searchParams.get('e2eAgentFault'),
    'artifact-gap-close'
  );
  assert.equal(
    new URL(other.forwardUrl).searchParams.get('e2eAgentFault'),
    'artifact-gap-close'
  );

  probe.recordResponse(otherThreadRequest, 200, 'artifact-gap-close');
  probe.recordResponse({}, 200, 'artifact-gap-close');
  assert.equal(probe.receiptObserved, false);

  probe.bindTargetThread('thread-target');
  assert.equal(probe.receiptObserved, false);

  const uninjectedOtherRequest = {};
  const uninjectedOther = probe.beginRequest(
    uninjectedOtherRequest,
    'http://127.0.0.1/api/core/p1/agent-threads/thread-other/events'
  );
  assert.equal(uninjectedOther.forwardUrl, null);
  probe.recordResponse(uninjectedOtherRequest, 200, 'artifact-gap-close');
  assert.equal(probe.receiptObserved, false);

  const unavailableTargetRequest = {};
  const stillInjected = probe.beginRequest(
    unavailableTargetRequest,
    'http://127.0.0.1/api/core/p1/agent-threads/thread-target/events?lastStreamOffset=7'
  );
  assert.equal(
    new URL(stillInjected.forwardUrl).searchParams.get('e2eAgentFault'),
    'artifact-gap-close'
  );

  probe.recordResponse(unavailableTargetRequest, 503, 'artifact-gap-close');
  assert.equal(probe.receiptObserved, false);
  probe.recordResponse(targetRequest, 200, 'artifact-gap-close');
  assert.equal(probe.receiptObserved, true);
});

test('accepts a pre-bind receipt only after its injected request is bound to the target Thread', () => {
  const probe = new AgentFaultReceiptProbe('artifact-gap-close');
  const targetRequest = {};

  probe.beginRequest(
    targetRequest,
    'http://127.0.0.1/api/core/p1/agent-threads/thread-target/events'
  );
  probe.recordResponse(targetRequest, 200, 'artifact-gap-close');
  assert.equal(probe.receiptObserved, false);

  probe.bindTargetThread('thread-target');
  assert.equal(probe.receiptObserved, true);
  assert.throws(
    () => probe.bindTargetThread('thread-other'),
    /target Thread is already bound/u
  );
});

test('diagnostics retain the original route URL without leaking query secrets', () => {
  const probe = new AgentFaultReceiptProbe('artifact-gap-close');
  const request = {};

  probe.beginRequest(
    request,
    'http://127.0.0.1/api/core/p1/agent-threads/thread-a/events?lastEventId=user%40example.test&lastStreamOffset=7&access_token=secret-value'
  );
  probe.recordFailure(
    request,
    'TOKEN=top-secret https://user@example.test/events?credential=secret-value 手机=13800138000 姓名=王小红'
  );
  probe.recordResponse(request, 503, 'Bearer another-secret');

  assert.equal(
    probe.diagnostics()[0]?.originalUrl,
    'http://127.0.0.1/api/core/p1/agent-threads/thread-a/events?access_token=%3Credacted%3E&lastEventId=%3Credacted%3E&lastStreamOffset=%3Credacted%3E'
  );
  assert.equal(probe.diagnostics()[0]?.failure, 'request_failed');
  assert.equal(probe.diagnostics()[0]?.receipt, '<unexpected>');
  assert.doesNotMatch(
    JSON.stringify(probe.diagnostics()),
    /top-secret|another-secret|secret-value|user@example|13800138000|王小红/u
  );
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
