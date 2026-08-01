import { releaseIdentityFromEnv } from './release-identity.js';
import type {
  ReadinessCheckName,
  ReadinessCheckResult,
  ReadyStatus,
  ReleaseIdentity,
  RuntimeTruthPort,
} from './types.js';
import type { MerchantCapabilitiesSnapshot } from './types.js';
import { projectMerchantCapabilities } from './merchant-capabilities.js';
import type { InternalCapabilityRecord } from './types.js';

export type ReadinessProbe = () => Promise<ReadinessCheckResult> | ReadinessCheckResult;

export interface ReadinessProbeMap {
  dbos?: ReadinessProbe;
  objectStorage?: ReadinessProbe;
  outbox?: ReadinessProbe;
  postgresql?: ReadinessProbe;
  providerLive?: ReadinessProbe;
  providerMode?: ReadinessProbe;
  schema?: ReadinessProbe;
  workerFreshness?: ReadinessProbe;
}

const ALL_CHECKS: ReadinessCheckName[] = [
  'postgresql',
  'dbos',
  'schema',
  'objectStorage',
  'workerFreshness',
  'providerMode',
  'providerLive',
  'outbox',
];

export interface EvaluateReadinessOptions {
  /**
   * Protected environments require every named check to pass.
   * Development/test may skip missing probes.
   */
  protectedEnvironment?: boolean;
  probes: ReadinessProbeMap;
  release?: ReleaseIdentity;
  requiredChecks?: ReadinessCheckName[];
}

export async function evaluateReadiness(
  options: EvaluateReadinessOptions,
): Promise<ReadyStatus> {
  const protectedEnvironment = options.protectedEnvironment ?? false;
  const required = new Set(
    options.requiredChecks ??
      (protectedEnvironment
        ? ALL_CHECKS
        : (Object.keys(options.probes) as ReadinessCheckName[])),
  );
  const checks: ReadinessCheckResult[] = [];

  for (const name of ALL_CHECKS) {
    const probe = options.probes[name];
    if (!probe) {
      if (required.has(name)) {
        checks.push({
          name,
          status: 'fail',
          detail: protectedEnvironment
            ? 'Required readiness probe is not configured.'
            : 'Readiness probe is not configured.',
        });
      } else {
        checks.push({
          name,
          status: 'skip',
          detail: 'Probe not configured in this environment.',
        });
      }
      continue;
    }
    try {
      const result = await probe();
      checks.push({
        name,
        status: result.status,
        ...(result.detail ? { detail: result.detail } : {}),
      });
    } catch (error) {
      checks.push({
        name,
        status: 'fail',
        detail:
          error instanceof Error ? error.message : 'Readiness probe threw.',
      });
    }
  }

  const ready = checks.every((check) => {
    if (!required.has(check.name)) {
      return check.status !== 'fail';
    }
    return check.status === 'pass';
  });

  return {
    service: 'meiye-core',
    status: ready ? 'ready' : 'not_ready',
    ready,
    checks,
    ...(options.release ? { release: options.release } : {}),
  };
}

export function isProtectedAppEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const appEnv = (env.APP_ENV ?? env.NODE_ENV ?? '').trim().toLowerCase();
  return appEnv === 'production' || appEnv === 'staging';
}

/**
 * Fail closed when recorded/disabled/filesystem modes reach staging/production.
 * Returns a readiness check result for the providerMode / objectStorage axes.
 */
export function providerModeReadinessFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ReadinessCheckResult {
  const appEnv = (env.APP_ENV ?? env.NODE_ENV ?? '').trim().toLowerCase();
  const protectedEnv = appEnv === 'production' || appEnv === 'staging';
  const mode = (env.MODEL_EXECUTION_MODE ?? 'recorded').trim();
  if (!protectedEnv) {
    return {
      name: 'providerMode',
      status: 'pass',
      detail: `Non-protected environment allows MODEL_EXECUTION_MODE=${mode}.`,
    };
  }
  if (mode === 'recorded' || mode === 'disabled' || mode === 'fixture') {
    return {
      name: 'providerMode',
      status: 'fail',
      detail: `MODEL_EXECUTION_MODE=${mode} is fail-closed in ${appEnv}.`,
    };
  }
  if (mode !== 'gateway' && mode !== 'direct') {
    return {
      name: 'providerMode',
      status: 'fail',
      detail: `Unknown MODEL_EXECUTION_MODE=${mode}.`,
    };
  }
  return {
    name: 'providerMode',
    status: 'pass',
    detail: `MODEL_EXECUTION_MODE=${mode}`,
  };
}

export function objectStorageModeReadinessFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ReadinessCheckResult {
  const appEnv = (env.APP_ENV ?? env.NODE_ENV ?? '').trim().toLowerCase();
  const protectedEnv = appEnv === 'production' || appEnv === 'staging';
  const mode = (env.P1_ASSET_STORAGE_MODE ?? 'filesystem').trim();
  if (!protectedEnv) {
    return {
      name: 'objectStorage',
      status: 'pass',
      detail: `Non-protected environment allows P1_ASSET_STORAGE_MODE=${mode}.`,
    };
  }
  if (mode !== 's3') {
    return {
      name: 'objectStorage',
      status: 'fail',
      detail: `Shared object storage must be s3 in ${appEnv}; got ${mode || 'unset'}.`,
    };
  }
  return {
    name: 'objectStorage',
    status: 'pass',
    detail: 'P1_ASSET_STORAGE_MODE=s3',
  };
}

export interface ComposeRuntimeTruthOptions {
  capabilityRecords?: InternalCapabilityRecord[];
  env?: NodeJS.ProcessEnv;
  probes?: ReadinessProbeMap;
  release?: ReleaseIdentity;
  /**
   * When true, objectStorage/providerMode env gates still run even if a custom
   * probe is provided for other checks. Custom probes override env gates when set.
   */
  includeEnvModeGates?: boolean;
  /**
   * When true (default in protected envs, or when PROVIDER_LIVE_REQUIRE_EVIDENCE=1),
   * a missing providerLive probe fails closed instead of skipping.
   */
  requireProviderLiveEvidence?: boolean;
}

/** Portable runtime-truth port used by HTTP handlers and assembly wiring. */
export function composeRuntimeTruth(
  options: ComposeRuntimeTruthOptions = {},
): RuntimeTruthPort {
  const env = options.env ?? process.env;
  const release = options.release ?? releaseIdentityFromEnv(env);
  const protectedEnvironment = isProtectedAppEnv(env);
  const includeEnvModeGates = options.includeEnvModeGates ?? true;
  const requireProviderLiveEvidence =
    options.requireProviderLiveEvidence ??
    (env.PROVIDER_LIVE_REQUIRE_EVIDENCE === '1' || protectedEnvironment);

  const probes: ReadinessProbeMap = { ...(options.probes ?? {}) };
  if (includeEnvModeGates) {
    if (!probes.providerMode) {
      probes.providerMode = () => providerModeReadinessFromEnv(env);
    }
    if (!probes.objectStorage) {
      // Env mode gate only; real R/W probe should replace this in main.ts wiring.
      probes.objectStorage = () => objectStorageModeReadinessFromEnv(env);
    }
  }
  if (!probes.providerLive && requireProviderLiveEvidence) {
    // Fail closed: callers must supply a real judgment via capability assembly.
    probes.providerLive = () => ({
      name: 'providerLive',
      status: 'fail',
      detail:
        'Provider live evidence probe is required but not wired; refuse readiness.',
    });
  }

  return {
    releaseIdentity() {
      return release.commitSha === 'unknown' && !release.artifactDigest
        ? release
        : release;
    },
    async evaluateReadiness() {
      return evaluateReadiness({
        // When provider live evidence is explicitly required outside staging/
        // production, treat the evaluation as protected for required checks.
        protectedEnvironment:
          protectedEnvironment || requireProviderLiveEvidence,
        probes,
        release,
      });
    },
    async listMerchantCapabilities() {
      const snapshot = projectMerchantCapabilities({
        records: options.capabilityRecords ?? [],
        release,
      });
      return snapshot;
    },
  };
}

export function liveStatus(role?: 'api' | 'worker'): {
  service: 'meiye-core';
  status: 'live';
  role?: 'api' | 'worker';
} {
  return {
    service: 'meiye-core',
    status: 'live',
    ...(role ? { role } : {}),
  };
}

export type { MerchantCapabilitiesSnapshot };
