import type { ReleaseIdentity, ReleaseManifest, ReleaseUnitIdentity } from './types.js';

const COMMIT_ENV_KEYS = [
  'RELEASE_COMMIT_SHA',
  'GIT_COMMIT_SHA',
  'GITHUB_SHA',
  'COMMIT_SHA',
] as const;

const DIGEST_ENV_KEYS = [
  'RELEASE_ARTIFACT_DIGEST',
  'ARTIFACT_DIGEST',
  'IMAGE_DIGEST',
] as const;

const CONFIG_ENV_KEYS = [
  'RELEASE_CONFIG_REVISION',
  'PROVIDER_LIVE_CONFIG_REVISION',
  'CONFIG_REVISION',
] as const;

/**
 * Resolve release identity from process env without inventing multi-channel claims.
 * Missing commit is reported as "unknown" so readiness can fail closed in protected envs.
 */
export function releaseIdentityFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ReleaseIdentity {
  return {
    commitSha: firstNonEmpty(env, COMMIT_ENV_KEYS) ?? 'unknown',
    ...(firstNonEmpty(env, DIGEST_ENV_KEYS)
      ? { artifactDigest: firstNonEmpty(env, DIGEST_ENV_KEYS) }
      : {}),
    ...(firstNonEmpty(env, CONFIG_ENV_KEYS)
      ? { configRevision: firstNonEmpty(env, CONFIG_ENV_KEYS) }
      : {}),
  };
}

export function buildReleaseManifest(input: {
  capturedAt?: string;
  units: Array<
    Partial<ReleaseIdentity> & {
      unit: ReleaseUnitIdentity['unit'];
    }
  >;
}): ReleaseManifest {
  if (input.units.length === 0) {
    throw new Error('Release manifest requires at least one unit.');
  }
  const units = input.units.map((unit) => {
    const commitSha = unit.commitSha?.trim();
    if (!commitSha) {
      throw new Error(`Release unit ${unit.unit} is missing commitSha.`);
    }
    return {
      unit: unit.unit,
      commitSha,
      ...(unit.artifactDigest?.trim()
        ? { artifactDigest: unit.artifactDigest.trim() }
        : {}),
      ...(unit.configRevision?.trim()
        ? { configRevision: unit.configRevision.trim() }
        : {}),
    } satisfies ReleaseUnitIdentity;
  });
  return {
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    units,
  };
}

/** All four deploy units must share one commit for a coherent release candidate. */
export function assertReleaseManifestCoherent(manifest: ReleaseManifest) {
  const required: ReleaseUnitIdentity['unit'][] = [
    'web',
    'core',
    'worker',
    'canvas',
  ];
  const present = new Set(manifest.units.map((unit) => unit.unit));
  for (const unit of required) {
    if (!present.has(unit)) {
      throw new Error(`Release manifest is missing unit ${unit}.`);
    }
  }
  const commits = new Set(manifest.units.map((unit) => unit.commitSha));
  if (commits.size !== 1) {
    throw new Error(
      'Release manifest units must share a single commit SHA.',
    );
  }
  const digests = manifest.units
    .map((unit) => unit.artifactDigest)
    .filter((value): value is string => Boolean(value));
  if (digests.length > 0 && new Set(digests).size !== 1) {
    throw new Error(
      'When artifact digests are present they must match across units.',
    );
  }
}

function firstNonEmpty(
  env: NodeJS.ProcessEnv,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}
