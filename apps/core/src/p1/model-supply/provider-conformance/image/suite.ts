/**
 * MP-04I image lifecycle conformance suite.
 *
 * Covers the async side-effect contract without reworking stable
 * submit/poll/download/cancel implementations:
 * - health reporting
 * - drain semantics
 * - cross-process durable recover
 * - late-terminal reconciliation (poll after cancel)
 * - idempotent replay
 * - accepted/unknown MUST NOT cross-channel resubmit
 */
import assert from 'node:assert/strict';
import type {
  MediaProviderEffectRequest,
  MediaProviderLifecyclePort,
  MediaProviderSubmissionReceipt,
} from '../../index.js';

export interface ImageLifecycleConformanceHarness {
  /** Human label, e.g. official_direct / upstream_reseller. */
  channelId: string;
  channelKind: 'official_direct' | 'upstream_reseller';
  createPort(): MediaProviderLifecyclePort;
  /**
   * Simulate process restart while sharing durable state (receipt store / task id).
   * When omitted, cross-process cases are skipped for this harness.
   */
  restartPort?: () => MediaProviderLifecyclePort;
  buildRequest(input?: {
    effectIdempotencyKey?: string;
    workspaceId?: string;
  }): MediaProviderEffectRequest;
  /**
   * Force next submit to surface acceptance_unknown without a confirmed task.
   * Optional; unknown contract is skipped when not provided.
   */
  forceAcceptanceUnknown?: (port: MediaProviderLifecyclePort) => void;
  /**
   * After cancel, make the provider report a late terminal success.
   * Optional; late-terminal cases are skipped when not provided.
   */
  forceLateTerminalSuccess?: (
    port: MediaProviderLifecyclePort,
    taskRef: string,
  ) => void;
}

export interface ImageLifecycleConformanceReport {
  channelId: string;
  channelKind: 'official_direct' | 'upstream_reseller';
  cases: Array<{ name: string; ok: true }>;
}

export async function runImageLifecycleConformance(
  harness: ImageLifecycleConformanceHarness,
): Promise<ImageLifecycleConformanceReport> {
  const cases: Array<{ name: string; ok: true }> = [];
  const record = (name: string) => {
    cases.push({ name, ok: true });
  };

  await caseSubmitTaskIdAcceptance(harness, record);
  await caseIdempotentReplay(harness, record);
  await caseRecoverQuery(harness, record);
  await casePollDownloadUrlTtl(harness, record);
  await caseCancel(harness, record);
  await caseHealthReport(harness, record);
  await caseDrainSemantics(harness, record);
  if (harness.restartPort) {
    await caseCrossProcessDurableRecover(harness, record);
  }
  if (harness.forceLateTerminalSuccess) {
    await caseLateTerminalReconciliation(harness, record);
  }
  if (harness.forceAcceptanceUnknown) {
    await caseUnknownDoesNotResubmit(harness, record);
  }
  await caseCostSettlement(harness, record);

  return {
    channelId: harness.channelId,
    channelKind: harness.channelKind,
    cases,
  };
}

/**
 * Dual-channel gate: accepted/unknown on channel A must not cause a submit on channel B.
 */
export async function assertNoCrossChannelResubmit(input: {
  primary: ImageLifecycleConformanceHarness;
  fallback: ImageLifecycleConformanceHarness;
  primarySubmitCount: () => number;
  fallbackSubmitCount: () => number;
}) {
  const primary = input.primary.createPort();
  const fallback = input.fallback.createPort();
  const request = input.primary.buildRequest({
    effectIdempotencyKey: 'cross-channel-no-resubmit',
  });
  const beforePrimary = input.primarySubmitCount();
  const beforeFallback = input.fallbackSubmitCount();

  const receipt = await primary.submit(request);
  assert.ok(
    receipt.acceptance === 'accepted' ||
      receipt.acceptance === 'acceptance_unknown',
    'primary must leave accepted or unknown before fallback is considered',
  );
  assert.equal(input.primarySubmitCount(), beforePrimary + 1);

  // Recover on primary; never hand the same effect to the other channel.
  const recovered = await primary.recover(request);
  assert.ok(recovered);
  assert.equal(recovered.acceptance, receipt.acceptance);
  if (receipt.taskRef) {
    assert.equal(recovered.taskRef, receipt.taskRef);
  }

  // Fallback must not be submitted for the same logical effect.
  assert.equal(input.fallbackSubmitCount(), beforeFallback);
  assert.equal(input.primarySubmitCount(), beforePrimary + 1);

  // Explicitly prove fallback was never invoked.
  void fallback;
}

async function caseSubmitTaskIdAcceptance(
  harness: ImageLifecycleConformanceHarness,
  record: (name: string) => void,
) {
  const port = harness.createPort();
  const request = harness.buildRequest({
    effectIdempotencyKey: `${harness.channelId}-submit`,
  });
  const receipt = await port.submit(request);
  assert.equal(receipt.acceptance, 'accepted');
  assert.ok(receipt.taskRef && receipt.taskRef.length > 0, 'task id required');
  assert.ok(
    Number.isFinite(receipt.providerCost.amount),
    'cost amount required',
  );
  record('submit/task-id/acceptance');
}

async function caseIdempotentReplay(
  harness: ImageLifecycleConformanceHarness,
  record: (name: string) => void,
) {
  const port = harness.createPort();
  const request = harness.buildRequest({
    effectIdempotencyKey: `${harness.channelId}-idempotent`,
  });
  const first = await port.submit(request);
  const second = await port.submit(request);
  assert.equal(first.acceptance, 'accepted');
  assert.equal(second.acceptance, first.acceptance);
  assert.equal(second.taskRef, first.taskRef);
  assert.deepEqual(second.providerCost, first.providerCost);
  record('idempotent-replay');
}

async function caseRecoverQuery(
  harness: ImageLifecycleConformanceHarness,
  record: (name: string) => void,
) {
  const port = harness.createPort();
  const request = harness.buildRequest({
    effectIdempotencyKey: `${harness.channelId}-recover`,
  });
  const submitted = await port.submit(request);
  const recovered = await port.recover(request);
  assert.ok(recovered);
  assert.equal(recovered.acceptance, submitted.acceptance);
  assert.equal(recovered.taskRef, submitted.taskRef);
  record('recover-query');
}

async function casePollDownloadUrlTtl(
  harness: ImageLifecycleConformanceHarness,
  record: (name: string) => void,
) {
  const port = harness.createPort();
  const request = harness.buildRequest({
    effectIdempotencyKey: `${harness.channelId}-poll-download`,
  });
  const receipt = await port.submit(request);
  assert.ok(receipt.taskRef);
  const polled = await port.poll({ ...request, taskRef: receipt.taskRef });
  assert.equal(polled.status, 'completed');
  if (receipt.sourceExpiresAt) {
    assert.ok(polled.sourceExpiresAt || receipt.sourceExpiresAt);
  }
  const downloaded = await port.download({
    ...request,
    taskRef: receipt.taskRef,
  });
  assert.ok(downloaded.bytes.byteLength > 0);
  assert.ok(downloaded.contentType.startsWith('image/'));
  record('poll/download/url-ttl');
}

async function caseCancel(
  harness: ImageLifecycleConformanceHarness,
  record: (name: string) => void,
) {
  const port = harness.createPort();
  const request = harness.buildRequest({
    effectIdempotencyKey: `${harness.channelId}-cancel`,
  });
  const receipt = await port.submit(request);
  assert.ok(receipt.taskRef);
  const cancelled = await port.cancel({
    ...request,
    taskRef: receipt.taskRef,
  });
  // Sync image may report pending/already_completed; async may cancel.
  if (cancelled && 'status' in cancelled) {
    assert.ok(
      cancelled.status === 'cancelled' || cancelled.status === 'pending',
    );
  }
  record('cancel');
}

async function caseHealthReport(
  harness: ImageLifecycleConformanceHarness,
  record: (name: string) => void,
) {
  const port = harness.createPort();
  assert.equal(typeof port.reportHealth, 'function', 'reportHealth required');
  const health = await port.reportHealth!();
  assert.ok(
    ['healthy', 'degraded', 'cooldown', 'circuit_open', 'unavailable'].includes(
      health.state,
    ),
  );
  assert.equal(health.source, 'adapter');
  assert.ok(health.reason);
  assert.ok(health.observedAt);
  record('health-report');
}

async function caseDrainSemantics(
  harness: ImageLifecycleConformanceHarness,
  record: (name: string) => void,
) {
  const port = harness.createPort();
  assert.equal(typeof port.setDrainMode, 'function', 'setDrainMode required');
  assert.equal(typeof port.getDrainMode, 'function', 'getDrainMode required');

  const inFlightRequest = harness.buildRequest({
    effectIdempotencyKey: `${harness.channelId}-drain-inflight`,
  });
  const inFlight = await port.submit(inFlightRequest);
  assert.equal(inFlight.acceptance, 'accepted');
  assert.ok(inFlight.taskRef);

  port.setDrainMode!('draining');
  assert.equal(port.getDrainMode!(), 'draining');
  const health = await port.reportHealth!();
  assert.equal(health.drainMode, 'draining');

  const rejected = await port.submit(
    harness.buildRequest({
      effectIdempotencyKey: `${harness.channelId}-drain-new`,
    }),
  );
  assert.equal(rejected.acceptance, 'rejected_before_accept');
  assert.equal(rejected.errorCode, 'channel_draining');

  // In-flight continues: recover/poll/download/cancel still work.
  const recovered = await port.recover(inFlightRequest);
  assert.equal(recovered?.taskRef, inFlight.taskRef);
  const polled = await port.poll({
    ...inFlightRequest,
    taskRef: inFlight.taskRef!,
  });
  assert.ok(
    polled.status === 'completed' ||
      polled.status === 'queued' ||
      polled.status === 'running' ||
      polled.status === 'failed' ||
      polled.status === 'unknown',
  );
  if (polled.status === 'completed') {
    const downloaded = await port.download({
      ...inFlightRequest,
      taskRef: inFlight.taskRef!,
    });
    assert.ok(downloaded.bytes.byteLength > 0);
  }
  await port.cancel({ ...inFlightRequest, taskRef: inFlight.taskRef! });

  // Idempotent replay of the accepted in-flight effect still returns the receipt.
  const replay = await port.submit(inFlightRequest);
  assert.equal(replay.taskRef, inFlight.taskRef);
  assert.equal(replay.acceptance, 'accepted');

  port.setDrainMode!('accepting');
  assert.equal(port.getDrainMode!(), 'accepting');
  record('drain-semantics');
}

async function caseCrossProcessDurableRecover(
  harness: ImageLifecycleConformanceHarness,
  record: (name: string) => void,
) {
  const first = harness.createPort();
  const request = harness.buildRequest({
    effectIdempotencyKey: `${harness.channelId}-cross-process`,
  });
  const submitted = await first.submit(request);
  assert.equal(submitted.acceptance, 'accepted');
  assert.ok(submitted.taskRef);

  const restarted = harness.restartPort!();
  const recovered = await restarted.recover(request);
  assert.ok(recovered, 'restarted process must recover durable receipt');
  assert.equal(recovered.acceptance, 'accepted');
  assert.equal(recovered.taskRef, submitted.taskRef);

  // Must not create a second provider task.
  const replay = await restarted.submit(request);
  assert.equal(replay.taskRef, submitted.taskRef);

  const polled = await restarted.poll({
    ...request,
    taskRef: submitted.taskRef!,
  });
  assert.equal(polled.status, 'completed');
  const downloaded = await restarted.download({
    ...request,
    taskRef: submitted.taskRef!,
  });
  assert.ok(downloaded.bytes.byteLength > 0);
  record('cross-process-durable-recover');
}

async function caseLateTerminalReconciliation(
  harness: ImageLifecycleConformanceHarness,
  record: (name: string) => void,
) {
  const port = harness.createPort();
  const request = harness.buildRequest({
    effectIdempotencyKey: `${harness.channelId}-late-terminal`,
  });
  const receipt = await port.submit(request);
  assert.ok(receipt.taskRef);
  await port.cancel({ ...request, taskRef: receipt.taskRef });
  harness.forceLateTerminalSuccess!(port, receipt.taskRef);

  const late = await port.poll({ ...request, taskRef: receipt.taskRef });
  assert.equal(late.status, 'completed');
  assert.ok(Number.isFinite(late.providerCost.amount));
  const downloaded = await port.download({
    ...request,
    taskRef: receipt.taskRef,
  });
  assert.ok(downloaded.bytes.byteLength > 0);
  // Second poll is stable (idempotent late observation).
  const again = await port.poll({ ...request, taskRef: receipt.taskRef });
  assert.equal(again.status, 'completed');
  assert.deepEqual(again.providerCost, late.providerCost);
  record('late-terminal-reconciliation');
}

async function caseUnknownDoesNotResubmit(
  harness: ImageLifecycleConformanceHarness,
  record: (name: string) => void,
) {
  const port = harness.createPort();
  harness.forceAcceptanceUnknown!(port);
  const request = harness.buildRequest({
    effectIdempotencyKey: `${harness.channelId}-unknown`,
  });
  const unknown = await port.submit(request);
  assert.equal(unknown.acceptance, 'acceptance_unknown');

  const recovered = await port.recover(request);
  assert.ok(recovered);
  assert.equal(recovered.acceptance, 'acceptance_unknown');

  // Replay must not create a new accepted task.
  const replay = await port.submit(request);
  assert.equal(replay.acceptance, 'acceptance_unknown');
  if (unknown.taskRef) {
    assert.equal(replay.taskRef, unknown.taskRef);
  }
  record('unknown-no-resubmit');
}

async function caseCostSettlement(
  harness: ImageLifecycleConformanceHarness,
  record: (name: string) => void,
) {
  const port = harness.createPort();
  const request = harness.buildRequest({
    effectIdempotencyKey: `${harness.channelId}-cost`,
  });
  const receipt = await port.submit(request);
  assert.ok(receipt.providerCost.currency === 'CNY' || receipt.providerCost.currency === 'USD');
  assert.ok(receipt.providerCost.amount >= 0);
  if (receipt.taskRef) {
    const polled = await port.poll({ ...request, taskRef: receipt.taskRef });
    assert.ok(polled.providerCost.amount >= 0);
  }
  record('cost-settlement');
}

export function requireAccepted(
  receipt: MediaProviderSubmissionReceipt,
): asserts receipt is MediaProviderSubmissionReceipt & { taskRef: string } {
  assert.equal(receipt.acceptance, 'accepted');
  assert.ok(receipt.taskRef);
}
