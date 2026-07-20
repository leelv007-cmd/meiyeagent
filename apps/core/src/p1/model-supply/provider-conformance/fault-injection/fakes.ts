/**
 * Dual-channel fakes for MP-08 fault-injection matrix unit path.
 * Text uses TextConformanceFakePort scenarios; image/video wrap lifecycle fakes.
 */
import type { ProviderExecutionPort } from '../../provider-lifecycle.js';
import {
  dualChannelTextFixtures,
  type TextChannelFixture,
  type TextFixtureScenario,
} from '../text/fixtures.js';
import {
  FakeImageChannelPort,
  MemoryReceiptStore as ImageMemoryReceiptStore,
} from '../image/fake-channel.js';
import {
  FakeVideoChannelPort,
  MemoryReceiptStore as VideoMemoryReceiptStore,
} from '../video/fake-channel.js';
import type { ChannelExecutionOutcome } from './dual-channel-router.js';
import type { FaultInjectionChannelControl, FaultInjectionHarness } from './matrix.js';
import type {
  DualChannelRouteCandidate,
  FaultInjectionModality,
  FaultInjectionOperation,
} from './types.js';

type ForcedOutcome = 'reject' | 'unknown' | 'success' | null;

function baseCandidate(
  fixture: {
    deploymentId: string;
    catalogModelId: string;
    providerProfileId: string;
    executionChannelId: string;
    channelKind: DualChannelRouteCandidate['channelKind'];
    endpointRevision?: string;
  },
  manufacturer?: string,
): DualChannelRouteCandidate {
  return {
    deploymentId: fixture.deploymentId,
    catalogModelId: fixture.catalogModelId,
    providerProfileId: fixture.providerProfileId,
    executionChannelId: fixture.executionChannelId,
    channelKind: fixture.channelKind,
    manufacturer,
    credentialVersion: 'fixture-v1',
    endpointRevision: fixture.endpointRevision ?? 'endpoint-v1',
    priceRevision: 'price-v1',
    region: fixture.channelKind === 'official_direct' ? 'domestic' : 'overseas',
  };
}

function createTextChannelControl(
  fixture: TextChannelFixture,
  manufacturer: string,
): FaultInjectionChannelControl {
  let forced: ForcedOutcome = null;
  let isolated = false;
  let draining = false;
  let submits = 0;
  const candidate = baseCandidate(fixture, manufacturer);

  const applyScenario = (scenario: TextFixtureScenario) => {
    fixture.setScenario(scenario);
  };

  return {
    candidate,
    forceRejectBeforeAccept: () => {
      forced = 'reject';
    },
    forceAcceptanceUnknown: () => {
      forced = 'unknown';
    },
    forceSuccess: () => {
      forced = 'success';
    },
    isolate: () => {
      isolated = true;
      candidate.isolated = true;
    },
    drain: () => {
      draining = true;
      candidate.draining = true;
    },
    clearControlPlane: () => {
      isolated = false;
      draining = false;
      forced = null;
      candidate.isolated = false;
      candidate.draining = false;
      applyScenario('success');
    },
    submitCount: () => submits,
    execute: async () => {
      submits += 1;
      if (draining || isolated) {
        return {
          acceptance: 'rejected_before_accept',
          errorCode: draining ? 'channel_draining' : 'channel_isolated',
          retryable: false,
          message: 'channel not accepting',
          costAmount: 0,
          currency: 'CNY',
        } satisfies ChannelExecutionOutcome;
      }
      if (forced === 'reject') {
        forced = null;
        applyScenario('auth_401');
      } else if (forced === 'unknown') {
        forced = null;
        applyScenario('server_5xx');
      } else {
        forced = null;
        applyScenario('success');
      }
      const response = await (fixture.port as ProviderExecutionPort).execute({
        jobId: `job-fi-${submits}`,
        model: fixture.model,
        deployment: fixture.deployment,
        submission: {
          workspaceId: 'ws-fi',
          actorId: 'actor-fi',
          operation: 'copy.generate',
          prompt: 'fault injection text',
          selection: { mode: 'fixed', catalogModelId: fixture.catalogModelId },
          dataClass: [],
          idempotencyKey: `fi-${submits}`,
        },
      });
      if (response.kind === 'completed') {
        return {
          acceptance: 'accepted',
          providerTaskRef: response.providerTaskRef,
          costAmount: response.providerCost.amount,
          currency: response.providerCost.currency,
        };
      }
      return {
        acceptance: response.acceptance,
        providerTaskRef: response.providerTaskRef,
        errorCode: response.errorCode,
        retryable: response.retryable,
        message: response.message,
        costAmount: response.providerCost.amount,
        currency: response.providerCost.currency,
      };
    },
  };
}

function createImageChannelControl(
  port: FakeImageChannelPort,
  candidate: DualChannelRouteCandidate,
): FaultInjectionChannelControl {
  let forced: ForcedOutcome = null;
  let isolated = false;
  let draining = false;

  return {
    candidate,
    forceRejectBeforeAccept: () => {
      forced = 'reject';
    },
    forceAcceptanceUnknown: () => {
      forced = 'unknown';
    },
    forceSuccess: () => {
      forced = 'success';
    },
    isolate: () => {
      isolated = true;
      candidate.isolated = true;
    },
    drain: () => {
      draining = true;
      candidate.draining = true;
      port.setDrainMode('draining');
    },
    clearControlPlane: () => {
      isolated = false;
      draining = false;
      forced = null;
      candidate.isolated = false;
      candidate.draining = false;
      port.setDrainMode('accepting');
    },
    submitCount: () => port.submitCount,
    execute: async ({ effectIdempotencyKey }) => {
      if (isolated) {
        return {
          acceptance: 'rejected_before_accept',
          errorCode: 'channel_isolated',
          retryable: false,
          message: 'isolated',
          costAmount: 0,
          currency: 'CNY',
        };
      }
      if (forced === 'reject') {
        forced = null;
        // One-shot reject without durable receipt so later scenarios stay clean.
        port.submitCount += 1;
        return {
          acceptance: 'rejected_before_accept',
          errorCode: 'auth_failed',
          retryable: false,
          message: 'forced reject',
          costAmount: 0,
          currency: 'CNY',
        };
      }
      if (forced === 'unknown') {
        forced = null;
        port.submitCount += 1;
        return {
          acceptance: 'acceptance_unknown',
          providerTaskRef: `fake-unknown-${effectIdempotencyKey.slice(0, 12)}`,
          errorCode: 'acceptance_unknown',
          retryable: false,
          message: 'forced acceptance_unknown',
          costAmount: 0,
          currency: 'CNY',
        };
      }
      if (draining) {
        port.setDrainMode('draining');
      }
      const request = port.buildRequest({ effectIdempotencyKey });
      const receipt = await port.submit(request);
      return {
        acceptance: receipt.acceptance,
        providerTaskRef: receipt.taskRef,
        errorCode: receipt.errorCode,
        retryable: receipt.retryable,
        message: receipt.error,
        costAmount: receipt.providerCost.amount,
        currency: receipt.providerCost.currency,
      };
    },
  };
}

function createVideoChannelControl(
  port: FakeVideoChannelPort,
  candidate: DualChannelRouteCandidate,
): FaultInjectionChannelControl {
  let forced: ForcedOutcome = null;
  let isolated = false;
  let draining = false;

  return {
    candidate,
    forceRejectBeforeAccept: () => {
      forced = 'reject';
    },
    forceAcceptanceUnknown: () => {
      forced = 'unknown';
    },
    forceSuccess: () => {
      forced = 'success';
    },
    isolate: () => {
      isolated = true;
      candidate.isolated = true;
    },
    drain: () => {
      draining = true;
      candidate.draining = true;
      port.setDrainMode('draining');
    },
    clearControlPlane: () => {
      isolated = false;
      draining = false;
      forced = null;
      candidate.isolated = false;
      candidate.draining = false;
      port.setDrainMode('accepting');
    },
    submitCount: () => port.submitCount,
    execute: async ({ effectIdempotencyKey }) => {
      if (isolated) {
        return {
          acceptance: 'rejected_before_accept',
          errorCode: 'channel_isolated',
          retryable: false,
          message: 'isolated',
          costAmount: 0,
          currency: 'CNY',
        };
      }
      if (forced === 'reject') {
        forced = null;
        port.submitCount += 1;
        return {
          acceptance: 'rejected_before_accept',
          errorCode: 'auth_failed',
          retryable: false,
          message: 'forced reject',
          costAmount: 0,
          currency: 'CNY',
        };
      }
      if (forced === 'unknown') {
        forced = null;
        port.submitCount += 1;
        return {
          acceptance: 'acceptance_unknown',
          providerTaskRef: `fake-video-unknown-${effectIdempotencyKey.slice(0, 12)}`,
          errorCode: 'acceptance_unknown',
          retryable: false,
          message: 'forced acceptance_unknown',
          costAmount: 0,
          currency: 'CNY',
        };
      }
      if (draining) {
        port.setDrainMode('draining');
      }
      const request = port.buildRequest({
        effectIdempotencyKey,
        durationSeconds: 5,
      });
      const receipt = await port.submit(request);
      return {
        acceptance: receipt.acceptance,
        providerTaskRef: receipt.taskRef,
        errorCode: receipt.errorCode,
        retryable: receipt.retryable,
        message: receipt.error,
        costAmount: receipt.providerCost.amount,
        currency: receipt.providerCost.currency,
      };
    },
  };
}

export function createTextFaultInjectionHarness(
  operation: FaultInjectionOperation = 'copy.generate',
): FaultInjectionHarness {
  const fixtures = dualChannelTextFixtures();
  return {
    operation,
    modality: 'llm',
    catalogModelId: fixtures.officialDirect.catalogModelId,
    primary: createTextChannelControl(fixtures.officialDirect, 'volcengine'),
    fallback: createTextChannelControl(fixtures.upstreamReseller, 'google'),
    evidenceKind: 'recorded',
  };
}

export function createImageFaultInjectionHarness(
  operation: FaultInjectionOperation = 'image.generate',
): FaultInjectionHarness {
  const official = new FakeImageChannelPort({
    channelId: 'channel-ark-seedream-official',
    channelKind: 'official_direct',
    catalogModelId: 'seedream-5-pro',
    costPerImage: 0.22,
    currency: 'CNY',
    receiptStore: new ImageMemoryReceiptStore(),
  });
  const reseller = new FakeImageChannelPort({
    channelId: 'channel-tuzi-seedream-reseller',
    channelKind: 'upstream_reseller',
    catalogModelId: 'gpt-image-2',
    costPerImage: 0.18,
    currency: 'USD',
    receiptStore: new ImageMemoryReceiptStore(),
  });
  return {
    operation,
    modality: 'image',
    catalogModelId: 'seedream-5-pro',
    primary: createImageChannelControl(
      official,
      baseCandidate(
        {
          deploymentId: 'dep-image-ark-official',
          catalogModelId: 'seedream-5-pro',
          providerProfileId: 'pp-volcengine-ark',
          executionChannelId: official.channelId,
          channelKind: 'official_direct',
        },
        'bytedance',
      ),
    ),
    fallback: createImageChannelControl(
      reseller,
      baseCandidate(
        {
          deploymentId: 'dep-image-tuzi-reseller',
          catalogModelId: 'gpt-image-2',
          providerProfileId: 'pp-tuzi-upstream',
          executionChannelId: reseller.channelId,
          channelKind: 'upstream_reseller',
        },
        'bytedance',
      ),
    ),
    evidenceKind: 'recorded',
  };
}

export function createVideoFaultInjectionHarness(
  operation: FaultInjectionOperation = 'video.generate',
): FaultInjectionHarness {
  // Both sides share seedance-1-5-pro CatalogModel → channel_matrix_aligned.
  const official = new FakeVideoChannelPort({
    channelId: 'channel-ark-seedance-official',
    channelKind: 'official_direct',
    catalogModelId: 'seedance-1-5-pro',
    receiptStore: new VideoMemoryReceiptStore(),
  });
  const reseller = new FakeVideoChannelPort({
    channelId: 'channel-tuzi-seedance-reseller',
    channelKind: 'upstream_reseller',
    catalogModelId: 'seedance-1-5-pro',
    receiptStore: new VideoMemoryReceiptStore(),
  });
  return {
    operation,
    modality: 'video',
    catalogModelId: 'seedance-1-5-pro',
    primary: createVideoChannelControl(
      official,
      baseCandidate(
        {
          deploymentId: 'dep-video-ark-official',
          catalogModelId: 'seedance-1-5-pro',
          providerProfileId: 'pp-volcengine-ark',
          executionChannelId: official.channelId,
          channelKind: 'official_direct',
        },
        'bytedance',
      ),
    ),
    fallback: createVideoChannelControl(
      reseller,
      baseCandidate(
        {
          deploymentId: 'dep-video-tuzi-reseller',
          catalogModelId: 'seedance-1-5-pro',
          providerProfileId: 'pp-tuzi-upstream',
          executionChannelId: reseller.channelId,
          channelKind: 'upstream_reseller',
        },
        'bytedance',
      ),
    ),
    evidenceKind: 'recorded',
  };
}

export function createFaultInjectionHarnessForModality(
  modality: FaultInjectionModality,
): FaultInjectionHarness {
  if (modality === 'llm') return createTextFaultInjectionHarness();
  if (modality === 'image') return createImageFaultInjectionHarness();
  return createVideoFaultInjectionHarness();
}
