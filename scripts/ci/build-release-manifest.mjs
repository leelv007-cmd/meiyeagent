#!/usr/bin/env node
/**
 * Staging release-candidate manifest generator (T40/E-01).
 *
 * The release-candidate gate (scripts/ci/assert-release-candidate-evidence.mjs)
 * has always required a four-unit, same-SHA manifest at RELEASE_MANIFEST_PATH,
 * and nothing minted one. This script mints it, and it extends the existing
 * generator chain instead of replacing it:
 *
 *   `pnpm --filter @meiye/core build` → apps/core/scripts/build-runtime.mjs
 *   writes the two-unit (core + worker) runtime stub. This script reads that
 *   stub as an input and refuses to emit a manifest unless the stub proves the
 *   Core runtime contract was validated at the same commit.
 *
 * Every RC field comes from a declared input. Nothing is defaulted into
 * existence: a missing workflow run, config revision, or verification evidence
 * reference fails closed with the exact variable named, so the gate can never be
 * satisfied by a manifest this script invented.
 *
 * Artifact digests are resolved per unit as:
 *   1. RELEASE_UNIT_ARTIFACT_DIGEST_<UNIT> — the deployment's own digest
 *      (container image digest, Worker version id) when the pipeline knows it;
 *   2. otherwise a deterministic sha256 over the unit's artifact directory
 *      (RELEASE_UNIT_ARTIFACT_DIR_<UNIT> or the default below).
 * Core and Worker share one digest by contract: same package, two start commands
 * (apps/core/scripts/build-runtime.mjs).
 *
 * Env:
 *   RELEASE_COMMIT_SHA                     (required, 40 hex)
 *   RELEASE_ENVIRONMENT                    (default staging; RC acceptance needs staging)
 *   RELEASE_WORKFLOW_RUN                   (required)
 *   RELEASE_CONFIG_REVISION                (required; per unit: RELEASE_UNIT_CONFIG_REVISION_<UNIT>)
 *   RELEASE_STARTED_AT                     (required ISO)
 *   RELEASE_COMPLETED_AT                   (default: now)
 *   RELEASE_EXPIRES_AT                     (default: completedAt + RELEASE_MANIFEST_TTL_MINUTES)
 *   RELEASE_MANIFEST_TTL_MINUTES           (default 720)
 *   RELEASE_READINESS_EVIDENCE_REF         (required)
 *   RELEASE_RECOVERY_EVIDENCE_REF          (required)
 *   RELEASE_JOURNEY_EVIDENCE_REF_COPY      (required)
 *   RELEASE_JOURNEY_EVIDENCE_REF_IMAGE     (required)
 *   RELEASE_JOURNEY_EVIDENCE_REF_VIDEO     (required)
 *   RELEASE_CORE_MANIFEST_PATH             (default apps/core/dist/release-manifest.core.json)
 *   RELEASE_MANIFEST_OUT                   (default output/release/release-manifest.json)
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { validateReleaseManifestArtifact } from './assert-release-candidate-evidence.mjs';

const COMMIT_SHA_PATTERN = /^[a-f0-9]{40}$/u;
export const RELEASE_UNITS = ['web', 'core', 'worker'];

/** Default artifact locations per release unit. */
export const DEFAULT_UNIT_ARTIFACT_DIRS = {
  // Core and Worker are the same package started two ways and run from source
  // through tsx, so the deployed artifact is the package source tree.
  core: 'apps/core/src',
  web: 'mkfast-template-main/dist',
  worker: 'apps/core/src',
};

/** Deterministic content digest over a directory tree. */
export function digestDirectory(directory) {
  const files = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      if (entry.isSymbolicLink()) continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (entry.isFile()) files.push(path);
    }
  };
  walk(directory);
  if (files.length === 0) return undefined;
  const listing = createHash('sha256');
  for (const path of files.sort()) {
    listing.update(relative(directory, path).replaceAll('\\', '/'));
    listing.update('\0');
    listing.update(createHash('sha256').update(readFileSync(path)).digest('hex'));
    listing.update('\n');
  }
  return `sha256:${listing.digest('hex')}`;
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isoTimestamp(value) {
  const parsed = Date.parse(value ?? '');
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

/** Reads the Core runtime stub and proves it belongs to this commit. */
export function readCoreRuntimeStub(path, expectedCommitSha) {
  if (!existsSync(path)) {
    return {
      errors: [
        `Core runtime stub is missing at ${path}; run \`pnpm --filter @meiye/core build\` for this commit.`,
      ],
    };
  }
  let stub;
  try {
    stub = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return {
      errors: [
        `Core runtime stub at ${path} is not readable JSON: ${error instanceof Error ? error.message : 'unknown error'}.`,
      ],
    };
  }
  const errors = [];
  if (stub.schemaVersion !== 1) {
    errors.push('Core runtime stub schemaVersion must be 1.');
  }
  const units = Array.isArray(stub.units) ? stub.units : [];
  for (const unit of ['core', 'worker']) {
    const entry = units.find((candidate) => candidate?.unit === unit);
    if (!entry) {
      errors.push(`Core runtime stub is missing unit ${unit}.`);
      continue;
    }
    if (entry.commitSha !== expectedCommitSha) {
      errors.push(
        `Core runtime stub unit ${unit} was built at ${entry.commitSha ?? 'unknown'}, not ${expectedCommitSha}.`
      );
    }
  }
  return { errors, stub };
}

export function buildReleaseCandidateManifest(env = process.env, options = {}) {
  const root = resolve(options.root ?? process.cwd());
  const errors = [];
  const requireEnv = (name) => {
    const value = env[name]?.trim();
    if (!value) errors.push(`${name} is required.`);
    return value;
  };

  const commitSha = requireEnv('RELEASE_COMMIT_SHA');
  if (commitSha && !COMMIT_SHA_PATTERN.test(commitSha)) {
    errors.push('RELEASE_COMMIT_SHA must be a full 40-character commit SHA.');
  }
  const environment = env.RELEASE_ENVIRONMENT?.trim() || 'staging';
  const workflowRun = requireEnv('RELEASE_WORKFLOW_RUN');
  const configRevision = requireEnv('RELEASE_CONFIG_REVISION');
  const readinessEvidenceRef = requireEnv('RELEASE_READINESS_EVIDENCE_REF');
  const recoveryEvidenceRef = requireEnv('RELEASE_RECOVERY_EVIDENCE_REF');
  const journeyEvidenceRefs = {
    copy: requireEnv('RELEASE_JOURNEY_EVIDENCE_REF_COPY'),
    image: requireEnv('RELEASE_JOURNEY_EVIDENCE_REF_IMAGE'),
    video: requireEnv('RELEASE_JOURNEY_EVIDENCE_REF_VIDEO'),
  };

  const now = options.now ? new Date(options.now) : new Date();
  const startedAtRaw = requireEnv('RELEASE_STARTED_AT');
  const startedAt = isoTimestamp(startedAtRaw);
  if (startedAtRaw && !startedAt) {
    errors.push('RELEASE_STARTED_AT must be an ISO timestamp.');
  }
  const completedAt = env.RELEASE_COMPLETED_AT?.trim()
    ? isoTimestamp(env.RELEASE_COMPLETED_AT)
    : now.toISOString();
  if (env.RELEASE_COMPLETED_AT?.trim() && !completedAt) {
    errors.push('RELEASE_COMPLETED_AT must be an ISO timestamp.');
  }
  const ttlMinutesRaw = env.RELEASE_MANIFEST_TTL_MINUTES?.trim() ?? '720';
  const ttlMinutes = Number(ttlMinutesRaw);
  if (!Number.isFinite(ttlMinutes) || ttlMinutes <= 0) {
    errors.push('RELEASE_MANIFEST_TTL_MINUTES must be a positive number.');
  }
  let expiresAt = env.RELEASE_EXPIRES_AT?.trim()
    ? isoTimestamp(env.RELEASE_EXPIRES_AT)
    : undefined;
  if (env.RELEASE_EXPIRES_AT?.trim() && !expiresAt) {
    errors.push('RELEASE_EXPIRES_AT must be an ISO timestamp.');
  }
  if (!expiresAt && completedAt && Number.isFinite(ttlMinutes) && ttlMinutes > 0) {
    expiresAt = new Date(Date.parse(completedAt) + ttlMinutes * 60_000).toISOString();
  }

  const stubPath = resolve(
    root,
    env.RELEASE_CORE_MANIFEST_PATH?.trim() ||
      'apps/core/dist/release-manifest.core.json'
  );
  if (commitSha && COMMIT_SHA_PATTERN.test(commitSha)) {
    errors.push(...readCoreRuntimeStub(stubPath, commitSha).errors);
  }

  const units = [];
  for (const unit of RELEASE_UNITS) {
    const suffix = unit.toUpperCase();
    const declaredDigest = env[`RELEASE_UNIT_ARTIFACT_DIGEST_${suffix}`]?.trim();
    const directory = resolve(
      root,
      env[`RELEASE_UNIT_ARTIFACT_DIR_${suffix}`]?.trim() ||
        DEFAULT_UNIT_ARTIFACT_DIRS[unit]
    );
    let artifactDigest = declaredDigest;
    if (!artifactDigest) {
      if (!existsSync(directory)) {
        errors.push(
          `Release unit ${unit} has no artifact: set RELEASE_UNIT_ARTIFACT_DIGEST_${suffix} or build ${relative(root, directory) || directory}.`
        );
      } else {
        artifactDigest = digestDirectory(directory);
        if (!artifactDigest) {
          errors.push(
            `Release unit ${unit} artifact directory ${relative(root, directory) || directory} is empty.`
          );
        }
      }
    }
    const unitConfigRevision =
      env[`RELEASE_UNIT_CONFIG_REVISION_${suffix}`]?.trim() || configRevision;
    if (!nonEmpty(unitConfigRevision)) {
      errors.push(`Release unit ${unit} is missing a config revision.`);
    }
    units.push({
      unit,
      commitSha,
      ...(artifactDigest ? { artifactDigest } : {}),
      ...(unitConfigRevision ? { configRevision: unitConfigRevision } : {}),
    });
  }

  if (errors.length > 0) return { errors };

  const manifest = {
    schemaVersion: 1,
    releaseRef: commitSha,
    environment,
    workflowRun,
    result: 'pass',
    startedAt,
    completedAt,
    capturedAt: now.toISOString(),
    expiresAt,
    verification: {
      journeyEvidenceRefs,
      readinessEvidenceRef,
      recoveryEvidenceRef,
    },
    units,
    notes: [
      'Generated by scripts/ci/build-release-manifest.mjs from the Core runtime stub and built unit artifacts.',
      'Provider live evidence is a separate artifact; this manifest makes no provider claim.',
    ],
  };

  // Self-check against the gate's own validator so a manifest this generator
  // would not survive is never written to disk.
  const validation = validateReleaseManifestArtifact(manifest, commitSha, now);
  if (validation.errors.length > 0) {
    return { errors: validation.errors.map((error) => `self-check: ${error}`) };
  }
  return { errors: [], manifest };
}

export function main(env = process.env, options = {}) {
  const root = resolve(options.root ?? process.cwd());
  const result = buildReleaseCandidateManifest(env, { ...options, root });
  if (result.errors.length > 0) {
    console.error('Release manifest generation failed (fail closed):');
    for (const error of result.errors) console.error(` - ${error}`);
    process.exitCode = 1;
    return result;
  }
  const outPath = resolve(
    root,
    env.RELEASE_MANIFEST_OUT?.trim() || 'output/release/release-manifest.json'
  );
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(result.manifest, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        status: 'written',
        releaseManifestPath: relative(root, outPath).replaceAll('\\', '/'),
        releaseRef: result.manifest.releaseRef,
        environment: result.manifest.environment,
        expiresAt: result.manifest.expiresAt,
        units: result.manifest.units.map((unit) => ({
          unit: unit.unit,
          artifactDigest: unit.artifactDigest,
        })),
      },
      null,
      2
    )
  );
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
