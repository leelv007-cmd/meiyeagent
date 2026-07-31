import type {
  P0ReleaseCandidateManifest,
  ReleaseIdentity,
  ReleaseManifest,
  ReleaseUnitIdentity,
} from './types.js';

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

const REQUIRED_UNITS: ReleaseUnitIdentity['unit'][] = [
  'web',
  'core',
  'worker',
];
const COMMIT_SHA_PATTERN = /^[a-f0-9]{40}$/u;

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

/** Deploy units must share one commit for a coherent release candidate. */
export function assertReleaseManifestCoherent(manifest: ReleaseManifest) {
  const present = new Set(manifest.units.map((unit) => unit.unit));
  if (manifest.units.length !== REQUIRED_UNITS.length) {
    throw new Error(
      'Release manifest must contain exactly web, core, and worker.',
    );
  }
  if (present.size !== manifest.units.length) {
    throw new Error('Release manifest must not duplicate units.');
  }
  for (const unit of REQUIRED_UNITS) {
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
}

/**
 * Validate the staging-produced artifact consumed by #147. This intentionally
 * rejects in-process/unit-only manifests: they do not prove a deployed RC.
 */
export function assertP0ReleaseCandidateManifest(
  manifest: P0ReleaseCandidateManifest,
  expectedCommitSha: string,
  now = new Date(),
) {
  assertReleaseManifestCoherent(manifest);
  if (!COMMIT_SHA_PATTERN.test(expectedCommitSha)) {
    throw new Error('Release candidate must use a full 40-character commit SHA.');
  }
  if (!Number.isFinite(now.getTime())) {
    throw new Error('Release candidate requires a valid current clock.');
  }
  if (manifest.schemaVersion !== 1) {
    throw new Error('Release manifest schemaVersion must be 1.');
  }
  if (manifest.releaseRef !== expectedCommitSha) {
    throw new Error('Release manifest releaseRef must match the release candidate SHA.');
  }
  if (manifest.environment !== 'staging') {
    throw new Error('P0 release manifest environment must be staging.');
  }
  if (!nonEmpty(manifest.workflowRun)) {
    throw new Error('Release manifest workflowRun is required.');
  }
  if (
    !validTimestamp(manifest.startedAt) ||
    !validTimestamp(manifest.completedAt) ||
    !validTimestamp(manifest.capturedAt) ||
    !validTimestamp(manifest.expiresAt)
  ) {
    throw new Error('Release manifest requires valid start, completion, capture, and expiry timestamps.');
  }
  if (Date.parse(manifest.completedAt) < Date.parse(manifest.startedAt)) {
    throw new Error('Release manifest completed before it started.');
  }
  if (Date.parse(manifest.expiresAt) <= Date.parse(manifest.completedAt)) {
    throw new Error('Release manifest expires before completion.');
  }
  if (Date.parse(manifest.expiresAt) <= now.getTime()) {
    throw new Error(`Release manifest expired at ${manifest.expiresAt}.`);
  }
  if (manifest.result !== 'pass') {
    throw new Error('Release manifest result must be pass.');
  }
  if (
    !nonEmpty(manifest.verification?.readinessEvidenceRef) ||
    !nonEmpty(manifest.verification?.recoveryEvidenceRef)
  ) {
    throw new Error('Release manifest requires readiness and recovery evidence references.');
  }
  for (const medium of ['copy', 'image', 'video'] as const) {
    if (!nonEmpty(manifest.verification?.journeyEvidenceRefs?.[medium])) {
      throw new Error(`Release manifest is missing ${medium} journey evidence.`);
    }
  }
  for (const unit of manifest.units) {
    if (!COMMIT_SHA_PATTERN.test(unit.commitSha)) {
      throw new Error(`Release unit ${unit.unit} must have a full commit SHA.`);
    }
    if (!nonEmpty(unit.artifactDigest)) {
      throw new Error(`Release unit ${unit.unit} is missing an immutable artifact digest.`);
    }
    if (!nonEmpty(unit.configRevision)) {
      throw new Error(`Release unit ${unit.unit} is missing a configuration revision.`);
    }
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

function nonEmpty(value: string | undefined): value is string {
  return Boolean(value?.trim());
}

function validTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}
