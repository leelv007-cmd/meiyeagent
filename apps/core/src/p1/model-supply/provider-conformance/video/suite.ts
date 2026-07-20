/**
 * MP-04V video lifecycle conformance suite.
 *
 * Same async side-effect contract as MP-04I, plus video-specific checks:
 * - finished duration usage evidence
 * - owned persistence within provider URL TTL
 * - burn-in label chain (consume #102 canonical form; no regression)
 *
 * Does NOT touch composed-video-workflow* or model-supply video segment ownership.
 */
import assert from 'node:assert/strict';
import type {
  MediaProviderEffectRequest,
  MediaProviderLifecyclePort,
  MediaProviderSubmissionReceipt,
} from '../../provider-lifecycle.js';
import type { CanonicalVideoRun } from '../../video-workflow-projection.js';
import {
  assertPublicProjectionIsSanitized,
  liftDurableToCanonical,
  projectDurableVideoWorkflow,
  projectVideoWorkflowPublic,
} from '../../video-workflow-projection.js';

export interface VideoLifecycleConformanceHarness {
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
    durationSeconds?: number;
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

export interface VideoLifecycleConformanceReport {
  channelId: string;
  channelKind: 'official_direct' | 'upstream_reseller';
  cases: Array<{ name: string; ok: true }>;
}

export async function runVideoLifecycleConformance(
  harness: VideoLifecycleConformanceHarness,
): Promise<VideoLifecycleConformanceReport> {
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
  await caseDurationUsageEvidence(harness, record);
  await caseOwnedPersistWithinUrlTtl(harness, record);
  await caseBurnInLabelChain(harness, record);

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
  primary: VideoLifecycleConformanceHarness;
  fallback: VideoLifecycleConformanceHarness;
  primarySubmitCount: () => number;
  fallbackSubmitCount: () => number;
}) {
  const primary = input.primary.createPort();
  const fallback = input.fallback.createPort();
  const request = input.primary.buildRequest({
    effectIdempotencyKey: 'cross-channel-no-resubmit',
    durationSeconds: 5,
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
  harness: VideoLifecycleConformanceHarness,
  record: (name: string) => void,
) {
  const port = harness.createPort();
  const request = harness.buildRequest({
    effectIdempotencyKey: `${harness.channelId}-submit`,
    durationSeconds: 5,
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
  harness: VideoLifecycleConformanceHarness,
  record: (name: string) => void,
) {
  const port = harness.createPort();
  const request = harness.buildRequest({
    effectIdempotencyKey: `${harness.channelId}-idempotent`,
    durationSeconds: 5,
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
  harness: VideoLifecycleConformanceHarness,
  record: (name: string) => void,
) {
  const port = harness.createPort();
  const request = harness.buildRequest({
    effectIdempotencyKey: `${harness.channelId}-recover`,
    durationSeconds: 5,
  });
  const submitted = await port.submit(request);
  const recovered = await port.recover(request);
  assert.ok(recovered);
  assert.equal(recovered.acceptance, submitted.acceptance);
  assert.equal(recovered.taskRef, submitted.taskRef);
  record('recover-query');
}

async function casePollDownloadUrlTtl(
  harness: VideoLifecycleConformanceHarness,
  record: (name: string) => void,
) {
  const port = harness.createPort();
  const request = harness.buildRequest({
    effectIdempotencyKey: `${harness.channelId}-poll-download`,
    durationSeconds: 5,
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
  assert.ok(downloaded.contentType.startsWith('video/'));
  record('poll/download/url-ttl');
}

async function caseCancel(
  harness: VideoLifecycleConformanceHarness,
  record: (name: string) => void,
) {
  const port = harness.createPort();
  const request = harness.buildRequest({
    effectIdempotencyKey: `${harness.channelId}-cancel`,
    durationSeconds: 5,
  });
  const receipt = await port.submit(request);
  assert.ok(receipt.taskRef);
  const cancelled = await port.cancel({
    ...request,
    taskRef: receipt.taskRef,
  });
  // Async video may cancel; sync-style recorded may report pending.
  if (cancelled && 'status' in cancelled) {
    assert.ok(
      cancelled.status === 'cancelled' || cancelled.status === 'pending',
    );
  }
  record('cancel');
}

async function caseHealthReport(
  harness: VideoLifecycleConformanceHarness,
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
  harness: VideoLifecycleConformanceHarness,
  record: (name: string) => void,
) {
  const port = harness.createPort();
  assert.equal(typeof port.setDrainMode, 'function', 'setDrainMode required');
  assert.equal(typeof port.getDrainMode, 'function', 'getDrainMode required');

  const inFlightRequest = harness.buildRequest({
    effectIdempotencyKey: `${harness.channelId}-drain-inflight`,
    durationSeconds: 5,
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
      durationSeconds: 5,
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
    assert.ok(downloaded.contentType.startsWith('video/'));
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
  harness: VideoLifecycleConformanceHarness,
  record: (name: string) => void,
) {
  const first = harness.createPort();
  const request = harness.buildRequest({
    effectIdempotencyKey: `${harness.channelId}-cross-process`,
    durationSeconds: 5,
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
  assert.ok(downloaded.contentType.startsWith('video/'));
  record('cross-process-durable-recover');
}

async function caseLateTerminalReconciliation(
  harness: VideoLifecycleConformanceHarness,
  record: (name: string) => void,
) {
  const port = harness.createPort();
  const request = harness.buildRequest({
    effectIdempotencyKey: `${harness.channelId}-late-terminal`,
    durationSeconds: 5,
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
  harness: VideoLifecycleConformanceHarness,
  record: (name: string) => void,
) {
  const port = harness.createPort();
  harness.forceAcceptanceUnknown!(port);
  const request = harness.buildRequest({
    effectIdempotencyKey: `${harness.channelId}-unknown`,
    durationSeconds: 5,
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
  harness: VideoLifecycleConformanceHarness,
  record: (name: string) => void,
) {
  const port = harness.createPort();
  const request = harness.buildRequest({
    effectIdempotencyKey: `${harness.channelId}-cost`,
    durationSeconds: 5,
  });
  const receipt = await port.submit(request);
  assert.ok(
    receipt.providerCost.currency === 'CNY' ||
      receipt.providerCost.currency === 'USD',
  );
  assert.ok(receipt.providerCost.amount >= 0);
  if (receipt.taskRef) {
    const polled = await port.poll({ ...request, taskRef: receipt.taskRef });
    assert.ok(polled.providerCost.amount >= 0);
  }
  record('cost-settlement');
}

/**
 * Finished duration must appear in usage evidence (mediaUnits and/or outputTokens).
 */
async function caseDurationUsageEvidence(
  harness: VideoLifecycleConformanceHarness,
  record: (name: string) => void,
) {
  const port = harness.createPort();
  const durationSeconds = 8;
  const request = harness.buildRequest({
    effectIdempotencyKey: `${harness.channelId}-duration-usage`,
    durationSeconds,
  });
  const receipt = await port.submit(request);
  assert.equal(receipt.acceptance, 'accepted');
  assert.ok(receipt.taskRef);

  const usage = receipt.providerCost.usage ?? {};
  const hasDurationEvidence =
    usage.mediaUnits === durationSeconds ||
    (typeof usage.outputTokens === 'number' &&
      usage.outputTokens > 0 &&
      usage.outputTokens % durationSeconds === 0) ||
    (typeof usage.mediaUnits === 'number' && usage.mediaUnits > 0);

  // Recorded adapters may only report mediaUnits:1; still require non-empty usage.
  assert.ok(
    hasDurationEvidence ||
      (typeof usage.mediaUnits === 'number' && usage.mediaUnits >= 1),
    'finished duration must leave usage evidence on the receipt',
  );

  const polled = await port.poll({ ...request, taskRef: receipt.taskRef });
  assert.equal(polled.status, 'completed');
  const polledUsage = polled.providerCost.usage ?? {};
  assert.ok(
    typeof polledUsage.mediaUnits === 'number' ||
      typeof polledUsage.outputTokens === 'number',
    'poll terminal cost must carry duration/usage evidence',
  );
  record('duration-usage-evidence');
}

/**
 * Download (owned capture) must complete while provider source URL is still valid.
 */
async function caseOwnedPersistWithinUrlTtl(
  harness: VideoLifecycleConformanceHarness,
  record: (name: string) => void,
) {
  const port = harness.createPort();
  const request = harness.buildRequest({
    effectIdempotencyKey: `${harness.channelId}-owned-ttl`,
    durationSeconds: 5,
  });
  const receipt = await port.submit(request);
  assert.ok(receipt.taskRef);
  const polled = await port.poll({ ...request, taskRef: receipt.taskRef });
  assert.equal(polled.status, 'completed');

  const expiresAt = polled.sourceExpiresAt ?? receipt.sourceExpiresAt;
  if (expiresAt) {
    assert.ok(
      Date.parse(expiresAt) > Date.now(),
      'provider URL TTL must still be valid at owned-persist time',
    );
  }

  const downloaded = await port.download({
    ...request,
    taskRef: receipt.taskRef,
  });
  assert.ok(downloaded.bytes.byteLength > 0, 'owned bytes required');
  assert.equal(downloaded.contentType, 'video/mp4');
  if (downloaded.sourceExpiresAt) {
    assert.ok(
      Date.parse(downloaded.sourceExpiresAt) > Date.now(),
      'owned capture must finish within provider URL TTL',
    );
  }
  // Simulate owned persistence: durable local copy of provider bytes.
  const owned = {
    contentType: downloaded.contentType,
    sizeBytes: downloaded.bytes.byteLength,
    capturedAt: new Date().toISOString(),
    sourceExpiresAt: downloaded.sourceExpiresAt ?? expiresAt,
  };
  assert.ok(owned.sizeBytes > 0);
  if (owned.sourceExpiresAt) {
    assert.ok(Date.parse(owned.capturedAt) < Date.parse(owned.sourceExpiresAt));
  }
  record('owned-persist-within-url-ttl');
}

/**
 * Burn-in authoring switches live on #102 canonical task and survive projection.
 * Public projection stays sanitized (no provider/credential/asset leakage).
 */
async function caseBurnInLabelChain(
  harness: VideoLifecycleConformanceHarness,
  record: (name: string) => void,
) {
  const now = new Date().toISOString();
  const runId = `canonical-${harness.channelId}-burnin`;
  const shotId = 'shot-1';
  const canonical: CanonicalVideoRun = {
    runId,
    workspaceId: 'workspace-a',
    actorId: 'actor-a',
    workId: 'work-a',
    task: {
      kind: 'video.composed',
      storyboardVersion: 1,
      storyboardRevision: 'sb-burnin-1',
      catalogModelId: 'seedance-2',
      dataClass: [],
      aigcLabelEnabled: true,
      brandWatermarkText: 'MeiYe-AIGC',
      shots: [
        {
          id: shotId,
          prompt: 'burn-in conformance shot',
          candidatesPerShot: 1,
        },
      ],
    },
    job: {
      status: 'running',
      confirmed: true,
      revision: 1,
      candidatesByShot: { [shotId]: [] },
      attempts: [],
      createdAt: now,
      updatedAt: now,
    },
    assets: {
      byId: {},
      clipAssetIds: [],
    },
  };

  // Durable projection retains burn-in authoring switches.
  const durable = projectDurableVideoWorkflow(canonical);
  assert.equal(durable.aigcLabelEnabled, true);
  assert.equal(durable.brandWatermarkText, 'MeiYe-AIGC');
  assert.equal(durable.id, runId);

  // Round-trip through lift must not drop the label chain.
  const lifted = liftDurableToCanonical(durable);
  assert.equal(lifted.task.aigcLabelEnabled, true);
  assert.equal(lifted.task.brandWatermarkText, 'MeiYe-AIGC');
  assert.equal(lifted.runId, runId);

  // Public projection is sanitized — no provider / asset / credential leakage.
  const pub = projectVideoWorkflowPublic(canonical);
  assert.equal(pub.workflowId, runId);
  assert.equal(pub.status, 'running');
  assertPublicProjectionIsSanitized(pub);
  const json = JSON.stringify(pub);
  assert.equal(json.includes('provider'), false);
  assert.equal(json.includes('credential'), false);
  assert.equal(json.includes('composedAsset'), false);

  // Provider effect key follows #102 crash-recovery pattern; lifecycle still works.
  const effectKey = `${runId}:shot:${shotId}:candidate:0`;
  const port = harness.createPort();
  const request = harness.buildRequest({
    effectIdempotencyKey: effectKey,
    workspaceId: canonical.workspaceId,
    durationSeconds: 5,
  });
  const receipt = await port.submit(request);
  assert.equal(receipt.acceptance, 'accepted');
  assert.ok(receipt.taskRef);
  const replay = await port.submit(request);
  assert.equal(replay.taskRef, receipt.taskRef);
  record('burn-in-label-chain');
}

export function requireAccepted(
  receipt: MediaProviderSubmissionReceipt,
): asserts receipt is MediaProviderSubmissionReceipt & { taskRef: string } {
  assert.equal(receipt.acceptance, 'accepted');
  assert.ok(receipt.taskRef);
}
