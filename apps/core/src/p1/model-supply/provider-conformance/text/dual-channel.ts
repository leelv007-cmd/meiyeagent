/**
 * Dual-channel text conformance matrix (official_direct + upstream_reseller).
 *
 * "两候选" = max 2 provider route attempts (slice(0,2) / attemptLimit:2).
 * This is NOT the live LLM three-copy-candidates dimension.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { ProviderExecutionPort } from '../../index.js';
import {
  buildActivationEvidenceInputs,
  dualChannelActivationGateReady,
} from '../activation-evidence-input.js';
import {
  TEXT_ROUTE_ATTEMPT_LIMIT,
  type TextChannelConformanceResult,
  type TextConformanceOperation,
  type TextDualChannelConformanceResult,
  type TextRouteAttemptLimit,
} from '../types.js';
import {
  dualChannelTextFixtures,
  type TextChannelFixture,
  type TextFixtureScenario,
} from './fixtures.js';
import { runTextChannelConformance } from './runner.js';

export { TEXT_ROUTE_ATTEMPT_LIMIT };

/**
 * Cap authorized route candidates to the two-attempt ceiling.
 * Mirrors model-supply resolveCandidates slice(0, 2) / attemptLimit: 2.
 */
export function selectTextRouteAttempts<T>(candidates: readonly T[]): T[] {
  return candidates.slice(0, TEXT_ROUTE_ATTEMPT_LIMIT);
}

export interface TextRouteAttempt {
  deploymentId: string;
  channelKind: TextChannelConformanceResult['channelKind'];
  rank: number;
}

/**
 * Simulate pre-accept failover planning: at most two route attempts.
 * Does not execute providers — pure attempt-limit contract for conformance assertions.
 */
export function planTextRouteAttempts(
  candidates: readonly {
    deploymentId: string;
    channelKind: TextChannelConformanceResult['channelKind'];
  }[]
): {
  attemptLimit: TextRouteAttemptLimit;
  attempts: TextRouteAttempt[];
} {
  const limited = selectTextRouteAttempts(candidates);
  return {
    attemptLimit: TEXT_ROUTE_ATTEMPT_LIMIT,
    attempts: limited.map((candidate, index) => ({
      deploymentId: candidate.deploymentId,
      channelKind: candidate.channelKind,
      rank: index + 1,
    })),
  };
}

export interface TextDualChannelRunInput {
  officialDirect: {
    fixture: TextChannelFixture;
    port: ProviderExecutionPort;
    injectErrorProbe?: (scenario: TextFixtureScenario) => void;
  };
  upstreamReseller: {
    fixture: TextChannelFixture;
    port: ProviderExecutionPort;
    injectErrorProbe?: (scenario: TextFixtureScenario) => void;
  };
  operation?: TextConformanceOperation;
  evidenceKind?: 'recorded' | 'live_provider';
  observedAt?: string;
  /** When true (default for recorded), run error-normalization probe per channel. */
  runErrorProbes?: boolean;
}

/**
 * Run official_direct + upstream_reseller text conformance and build
 * activation-evidence inputs for Deployment publish gates.
 */
export async function runTextDualChannelConformance(
  input: TextDualChannelRunInput
): Promise<TextDualChannelConformanceResult> {
  const operation = input.operation ?? 'copy.generate';
  const evidenceKind = input.evidenceKind ?? 'recorded';
  const observedAt = input.observedAt ?? new Date().toISOString();
  const runErrorProbes = input.runErrorProbes ?? evidenceKind === 'recorded';
  const resultId = createHash('sha256')
    .update(
      [
        'text-dual',
        operation,
        input.officialDirect.fixture.deploymentId,
        input.upstreamReseller.fixture.deploymentId,
        observedAt,
        randomUUID(),
      ].join('|')
    )
    .digest('hex')
    .slice(0, 20);

  const official = await runTextChannelConformance({
    fixture: input.officialDirect.fixture,
    port: input.officialDirect.port,
    operation,
    evidenceKind,
    observedAt,
    resultId: `${resultId}-official`,
    ...(runErrorProbes
      ? {
          errorProbeScenario: 'rate_limit_429' as const,
          injectErrorProbe:
            input.officialDirect.injectErrorProbe ??
            ((scenario) => input.officialDirect.fixture.setScenario(scenario)),
        }
      : {}),
  });

  const reseller = await runTextChannelConformance({
    fixture: input.upstreamReseller.fixture,
    port: input.upstreamReseller.port,
    operation,
    evidenceKind,
    observedAt,
    resultId: `${resultId}-reseller`,
    ...(runErrorProbes
      ? {
          errorProbeScenario: 'auth_401' as const,
          injectErrorProbe:
            input.upstreamReseller.injectErrorProbe ??
            ((scenario) =>
              input.upstreamReseller.fixture.setScenario(scenario)),
        }
      : {}),
  });

  const channels = [official, reseller];
  const dualChannelReady =
    official.passed &&
    reseller.passed &&
    official.channelKind === 'official_direct' &&
    reseller.channelKind === 'upstream_reseller';

  const dual: TextDualChannelConformanceResult = {
    id: resultId,
    operation,
    attemptLimit: TEXT_ROUTE_ATTEMPT_LIMIT,
    channels,
    dualChannelReady,
    observedAt,
    activationEvidenceInputs: [],
  };
  dual.activationEvidenceInputs = buildActivationEvidenceInputs(dual);
  return dual;
}

/** Convenience: recorded dual-channel fixtures + fake ports. */
export async function runRecordedTextDualChannelConformance(
  options: {
    operation?: TextConformanceOperation;
    observedAt?: string;
  } = {}
): Promise<TextDualChannelConformanceResult> {
  const fixtures = dualChannelTextFixtures();
  return runTextDualChannelConformance({
    officialDirect: {
      fixture: fixtures.officialDirect,
      port: fixtures.officialDirect.port,
    },
    upstreamReseller: {
      fixture: fixtures.upstreamReseller,
      port: fixtures.upstreamReseller.port,
    },
    operation: options.operation,
    evidenceKind: 'recorded',
    observedAt: options.observedAt,
    runErrorProbes: true,
  });
}

export function assertAttemptLimitContract(
  dual: TextDualChannelConformanceResult
): void {
  if (dual.attemptLimit !== TEXT_ROUTE_ATTEMPT_LIMIT) {
    throw new Error(
      `attemptLimit must be ${TEXT_ROUTE_ATTEMPT_LIMIT} (两候选 route attempts), got ${dual.attemptLimit}`
    );
  }
  const planned = planTextRouteAttempts(
    dual.channels.map((channel) => ({
      deploymentId: channel.deploymentId,
      channelKind: channel.channelKind,
    }))
  );
  if (planned.attempts.length > TEXT_ROUTE_ATTEMPT_LIMIT) {
    throw new Error(
      `Route attempts exceeded ceiling ${TEXT_ROUTE_ATTEMPT_LIMIT}`
    );
  }
}

export { dualChannelActivationGateReady };
