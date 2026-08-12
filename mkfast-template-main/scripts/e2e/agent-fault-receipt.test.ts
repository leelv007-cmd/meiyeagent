import assert from 'node:assert/strict';
import test from 'node:test';

import { AgentFaultReceiptProbe } from './agent-fault-receipt';

function injectedFault(forwardUrl: string | null) {
  assert.ok(forwardUrl, 'request must carry the injected fault URL');
  return new URL(forwardUrl).searchParams.get('e2eAgentFault');
}

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
  assert.equal(injectedFault(cancelled.forwardUrl), 'artifact-gap-close');
  probe.recordResponseStarted(cancelledRequest, 200);
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
  assert.equal(injectedFault(receipted.forwardUrl), 'artifact-gap-close');
  probe.recordResponseStarted(receiptedRequest, 200);
  probe.recordResponse(receiptedRequest, 200, 'artifact-gap-close');
  assert.equal(probe.receiptObserved, false);
  probe.recordFinished(receiptedRequest);

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
  assert.equal(injectedFault(target.forwardUrl), 'artifact-gap-close');
  assert.equal(other.forwardUrl, null);

  probe.recordResponseStarted(otherThreadRequest, 200);
  probe.recordResponse(otherThreadRequest, 200, 'artifact-gap-close');
  probe.recordFinished(otherThreadRequest);
  probe.recordResponse({}, 200, 'artifact-gap-close');
  assert.equal(probe.receiptObserved, false);

  probe.bindTargetThread('thread-target');
  assert.equal(probe.receiptObserved, false);

  probe.recordResponseStarted(targetRequest, 503);
  probe.recordResponse(targetRequest, 503, 'artifact-gap-close');
  probe.recordFinished(targetRequest);
  assert.equal(probe.receiptObserved, false);

  const uninjectedOtherRequest = {};
  const uninjectedOther = probe.beginRequest(
    uninjectedOtherRequest,
    'http://127.0.0.1/api/core/p1/agent-threads/thread-other/events'
  );
  assert.equal(uninjectedOther.forwardUrl, null);
  probe.recordResponseStarted(uninjectedOtherRequest, 200);
  probe.recordResponse(uninjectedOtherRequest, 200, 'artifact-gap-close');
  probe.recordFinished(uninjectedOtherRequest);
  assert.equal(probe.receiptObserved, false);

  const unavailableTargetRequest = {};
  const stillInjected = probe.beginRequest(
    unavailableTargetRequest,
    'http://127.0.0.1/api/core/p1/agent-threads/thread-target/events?lastStreamOffset=7'
  );
  assert.equal(injectedFault(stillInjected.forwardUrl), 'artifact-gap-close');

  probe.recordResponseStarted(unavailableTargetRequest, 200);
  probe.recordResponse(unavailableTargetRequest, 200, 'artifact-gap-close');
  probe.recordFinished(unavailableTargetRequest);
  assert.equal(probe.receiptObserved, true);
});

test('accepts a pre-bind receipt only after its injected request is bound to the target Thread', () => {
  const probe = new AgentFaultReceiptProbe('artifact-gap-close');
  const targetRequest = {};

  probe.beginRequest(
    targetRequest,
    'http://127.0.0.1/api/core/p1/agent-threads/thread-target/events'
  );
  probe.recordResponseStarted(targetRequest, 200);
  probe.recordResponse(targetRequest, 200, 'artifact-gap-close');
  probe.recordFinished(targetRequest);
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

test('serializes injected requests and waits for a successful terminal request', () => {
  const probe = new AgentFaultReceiptProbe('artifact-gap-close');
  const requestA = {};
  const requestB = {};
  const requestC = {};
  const requestD = {};
  const requestE = {};

  probe.bindTargetThread('thread-a');

  const attemptA = probe.beginRequest(
    requestA,
    'http://127.0.0.1/api/core/p1/agent-threads/thread-a/events'
  );
  const attemptB = probe.beginRequest(
    requestB,
    'http://127.0.0.1/api/core/p1/agent-threads/thread-a/events?lastStreamOffset=1'
  );
  assert.equal(injectedFault(attemptA.forwardUrl), 'artifact-gap-close');
  assert.equal(attemptB.forwardUrl, null, 'only request A may be injected');

  probe.recordResponseStarted(requestA, 200);
  probe.recordResponse(requestA, 200, 'artifact-gap-close');
  assert.equal(
    probe.receiptObserved,
    false,
    'receipt headers are insufficient before requestfinished'
  );

  probe.recordFailure(requestA, 'TOKEN=must-not-leak');
  assert.equal(probe.receiptObserved, false);

  const attemptC = probe.beginRequest(
    requestC,
    'http://127.0.0.1/api/core/p1/agent-threads/thread-a/events?lastStreamOffset=2'
  );
  assert.equal(
    injectedFault(attemptC.forwardUrl),
    'artifact-gap-close',
    'request C may retry after request A fails'
  );

  probe.recordResponseStarted(requestC, 200);
  probe.recordResponse(requestC, 200, 'artifact-gap-close');
  probe.recordFinished(requestC);
  assert.equal(probe.receiptObserved, true);
  assert.equal(probe.appliedReceiptCount, 1);

  const attemptD = probe.beginRequest(
    requestD,
    'http://127.0.0.1/api/core/p1/agent-threads/thread-a/events?lastStreamOffset=3'
  );
  assert.equal(attemptD.forwardUrl, null);
  assert.equal(
    probe.diagnostics().filter(({ successfulFault }) => successfulFault).length,
    1
  );

  probe.recordFailure(requestC, 'late requestfailed TOKEN=must-not-leak');
  assert.equal(
    probe.receiptObserved,
    false,
    'a late requestfailed event revokes the completed attempt'
  );
  assert.equal(probe.appliedReceiptCount, 0);

  const attemptE = probe.beginRequest(
    requestE,
    'http://127.0.0.1/api/core/p1/agent-threads/thread-a/events?lastStreamOffset=4'
  );
  assert.equal(injectedFault(attemptE.forwardUrl), 'artifact-gap-close');
});

test('keeps a finished response in flight until receipt header lookup settles', () => {
  const probe = new AgentFaultReceiptProbe('artifact-gap-close');
  const requestA = {};
  const requestB = {};

  probe.bindTargetThread('thread-a');
  probe.beginRequest(
    requestA,
    'http://127.0.0.1/api/core/p1/agent-threads/thread-a/events'
  );
  probe.recordResponseStarted(requestA, 200);
  probe.recordFinished(requestA);

  const attemptB = probe.beginRequest(
    requestB,
    'http://127.0.0.1/api/core/p1/agent-threads/thread-a/events?lastStreamOffset=1'
  );
  assert.equal(
    attemptB.forwardUrl,
    null,
    'request A remains in flight while headerValue is pending'
  );

  probe.recordResponse(requestA, 200, 'artifact-gap-close');
  assert.equal(probe.receiptObserved, true);
  assert.equal(probe.appliedReceiptCount, 1);
});
