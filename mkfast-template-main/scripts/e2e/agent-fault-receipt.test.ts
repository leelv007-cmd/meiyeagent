import assert from 'node:assert/strict';
import test from 'node:test';

import { AgentFaultReceiptProbe } from './agent-fault-receipt';

function injectedFault(forwardUrl: string | null) {
  assert.ok(forwardUrl, 'request must carry the injected fault URL');
  return new URL(forwardUrl).searchParams.get('e2eAgentFault');
}

test('injects at most once and fails closed after a receipted request fails', () => {
  const probe = new AgentFaultReceiptProbe('artifact-gap-close');
  const requestA = {};
  const requestB = {};

  probe.bindTargetThread('thread-a');

  const attemptA = probe.beginRequest(
    requestA,
    'http://127.0.0.1/api/core/p1/agent-threads/thread-a/events'
  );
  assert.equal(injectedFault(attemptA.forwardUrl), 'artifact-gap-close');
  assert.equal(probe.injectedRequestCount, 1);
  probe.recordResponseStarted(requestA, 200);
  probe.recordResponse(requestA, 200, 'artifact-gap-close');
  assert.equal(probe.receiptedInjectedRequestCount, 1);
  probe.recordFailure(
    requestA,
    'net::ERR_ABORTED TOKEN=not-for-artifacts user@example.test'
  );
  assert.equal(
    probe.receiptObserved,
    false,
    'a failed request cannot satisfy the target receipt contract'
  );

  const attemptB = probe.beginRequest(
    requestB,
    'http://127.0.0.1/api/core/p1/agent-threads/thread-a/events?lastStreamOffset=7'
  );
  assert.equal(
    attemptB.forwardUrl,
    null,
    'a failed injected request must never cause a second actual injection'
  );
  assert.equal(probe.injectedRequestCount, 1);
  assert.equal(probe.receiptedInjectedRequestCount, 1);
  assert.equal(probe.appliedReceiptCount, 0);
  assert.equal(
    probe.diagnostics().filter(({ successfulFault }) => successfulFault).length,
    0
  );
});

test('requires a target binding and ignores other Thread receipts', () => {
  const probe = new AgentFaultReceiptProbe('artifact-gap-close');
  const preBindRequest = {};
  const targetRequest = {};
  const otherThreadRequest = {};

  const preBind = probe.beginRequest(
    preBindRequest,
    'http://127.0.0.1/api/core/p1/agent-threads/thread-wrong/events'
  );
  assert.equal(preBind.forwardUrl, null);
  probe.recordResponseStarted(preBindRequest, 200);
  probe.recordResponse(preBindRequest, 200, 'artifact-gap-close');
  probe.recordFinished(preBindRequest);
  assert.equal(probe.receiptObserved, false);

  probe.bindTargetThread('thread-target');

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

  probe.recordResponseStarted(targetRequest, 200);
  probe.recordResponse(targetRequest, 200, 'artifact-gap-close');
  probe.recordFinished(targetRequest);
  assert.equal(probe.receiptObserved, true);
  assert.equal(probe.appliedReceiptCount, 1);
  assert.throws(
    () => probe.bindTargetThread('thread-other'),
    /target Thread is already bound/u
  );
});

test('holds the first request until its authoritative target is bound', async () => {
  const probe = new AgentFaultReceiptProbe('artifact-gap-close');
  const request = {};

  const pendingAttempt = probe.beginRequestAfterTarget(
    request,
    'http://127.0.0.1/api/core/p1/agent-threads/thread-a/events',
    100
  );
  await Promise.resolve();
  assert.equal(probe.injectedRequestCount, 0);

  probe.bindTargetThread('thread-a');
  const attempt = await pendingAttempt;
  assert.equal(injectedFault(attempt.forwardUrl), 'artifact-gap-close');
  assert.equal(probe.injectedRequestCount, 1);
});

test('fails closed when the authoritative target is not bound in time', async () => {
  const probe = new AgentFaultReceiptProbe('artifact-gap-close');

  await assert.rejects(
    probe.beginRequestAfterTarget(
      {},
      'http://127.0.0.1/api/core/p1/agent-threads/thread-a/events',
      5
    ),
    /target Thread was not bound before the deadline/u
  );
  assert.equal(probe.injectedRequestCount, 0);
  assert.deepEqual(probe.diagnostics(), []);
});

test('diagnostics retain the original route URL without leaking query secrets', () => {
  const probe = new AgentFaultReceiptProbe('artifact-gap-close');
  const request = {};

  probe.bindTargetThread('thread-a');
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
    'http://127.0.0.1/api/core/p1/agent-threads/thread-a/events?lastEventId=%3Credacted%3E&lastStreamOffset=%3Credacted%3E&other=%3Credacted%3E'
  );
  assert.equal(probe.diagnostics()[0]?.failure, 'request_failed');
  assert.equal(probe.diagnostics()[0]?.receipt, '<unexpected>');
  assert.doesNotMatch(
    JSON.stringify(probe.diagnostics()),
    /top-secret|another-secret|secret-value|access_token|credential|user@example|13800138000|王小红/u
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
  probe.recordFinished(requestA);
  assert.equal(probe.receiptObserved, true);
  assert.equal(probe.injectedRequestCount, 1);
  assert.equal(probe.receiptedInjectedRequestCount, 1);

  const attemptC = probe.beginRequest(
    requestC,
    'http://127.0.0.1/api/core/p1/agent-threads/thread-a/events?lastStreamOffset=2'
  );
  assert.equal(attemptC.forwardUrl, null);
  assert.equal(probe.isRecoveryRequest(requestC), true);
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

  probe.recordFailure(requestA, 'late requestfailed TOKEN=must-not-leak');
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
  assert.equal(
    attemptE.forwardUrl,
    null,
    'a late failure must not permit a second actual injection'
  );
  assert.equal(probe.injectedRequestCount, 1);
  assert.equal(probe.receiptedInjectedRequestCount, 1);
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
  assert.equal(probe.injectedRequestCount, 1);
  assert.equal(probe.receiptedInjectedRequestCount, 1);
  assert.equal(probe.appliedReceiptCount, 1);
});

test('marks only the first target request begun after fault success as recovery', () => {
  const probe = new AgentFaultReceiptProbe('artifact-gap-close');
  const requestA = {};
  const requestB = {};
  const requestC = {};
  const requestD = {};

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
  assert.equal(attemptB.forwardUrl, null);

  probe.recordResponseStarted(requestA, 200);
  probe.recordResponse(requestA, 200, 'artifact-gap-close');
  probe.recordFinished(requestA);
  assert.equal(probe.receiptObserved, true);
  assert.equal(
    probe.isRecoveryRequest(requestB),
    false,
    'a clean concurrent request cannot become recovery retroactively'
  );

  const attemptC = probe.beginRequest(
    requestC,
    'http://127.0.0.1/api/core/p1/agent-threads/thread-a/events?lastStreamOffset=2'
  );
  const attemptD = probe.beginRequest(
    requestD,
    'http://127.0.0.1/api/core/p1/agent-threads/thread-a/events?lastStreamOffset=3'
  );
  assert.equal(attemptC.forwardUrl, null);
  assert.equal(attemptD.forwardUrl, null);
  assert.equal(probe.isRecoveryRequest(requestC), true);
  assert.equal(
    probe.isRecoveryRequest(requestD),
    false,
    'only the first post-success target request is recovery'
  );
  const diagnostics = probe.diagnostics();
  const successful = diagnostics.find(({ successfulFault }) => successfulFault);
  const recovery = diagnostics.find(({ recoveryRequest }) => recoveryRequest);
  assert.equal(
    diagnostics.filter(({ recoveryRequest }) => recoveryRequest).length,
    1
  );
  assert.ok(successful?.successfulTerminalSequence);
  assert.ok(
    successful.successfulTerminalSequence > successful.requestSequence,
    'the receipt terminal token must be sequenced after its request began'
  );
  assert.equal(
    recovery?.recoveryForTerminalSequence,
    successful.successfulTerminalSequence
  );
});

test('applies replay faults only to one bound target request until terminal receipt', () => {
  const probe = new AgentFaultReceiptProbe('artifact-head-replay');
  const preBindRequest = {};
  const wrongThreadRequest = {};
  const targetRequest = {};
  const concurrentRequest = {};
  const laterRequest = {};

  const preBind = probe.beginRequest(
    preBindRequest,
    'http://127.0.0.1/api/core/p1/agent-threads/thread-wrong/replay'
  );
  assert.equal(preBind.forwardUrl, null);

  probe.bindTargetThread('thread-a');
  const wrongThread = probe.beginRequest(
    wrongThreadRequest,
    'http://127.0.0.1/api/core/p1/agent-threads/thread-wrong/replay'
  );
  const target = probe.beginRequest(
    targetRequest,
    'http://127.0.0.1/api/core/p1/agent-threads/thread-a/replay'
  );
  const concurrent = probe.beginRequest(
    concurrentRequest,
    'http://127.0.0.1/api/core/p1/agent-threads/thread-a/replay?lastEventId=event-1'
  );
  assert.equal(wrongThread.forwardUrl, null);
  assert.equal(injectedFault(target.forwardUrl), 'artifact-head-replay');
  assert.equal(concurrent.forwardUrl, null);

  probe.recordResponseStarted(wrongThreadRequest, 200);
  probe.recordResponse(wrongThreadRequest, 200, 'artifact-head-replay');
  probe.recordFinished(wrongThreadRequest);
  probe.recordResponseStarted(targetRequest, 200);
  probe.recordResponse(targetRequest, 200, 'artifact-head-replay');
  assert.equal(probe.receiptObserved, false);
  probe.recordFinished(targetRequest);

  const later = probe.beginRequest(
    laterRequest,
    'http://127.0.0.1/api/core/p1/agent-threads/thread-a/replay?lastEventId=event-2'
  );
  assert.equal(later.forwardUrl, null);

  assert.equal(probe.receiptObserved, true);
  assert.equal(probe.injectedRequestCount, 1);
  assert.equal(probe.receiptedInjectedRequestCount, 1);
  assert.equal(probe.appliedReceiptCount, 1);
  assert.equal(
    probe.diagnostics().filter(({ successfulFault }) => successfulFault).length,
    1
  );
});
