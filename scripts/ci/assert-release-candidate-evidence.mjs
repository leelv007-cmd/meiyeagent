#!/usr/bin/env node
/**
 * Same-commit P0 release-candidate evidence gate (#147).
 * Fail closed when provider live evidence or release manifest is missing/invalid.
 *
 * Env:
 *   RELEASE_COMMIT_SHA (required)
 *   PROVIDER_LIVE_EVIDENCE_PATH or PROVIDER_LIVE_EVIDENCE_DIR
 *   RELEASE_MANIFEST_PATH (required JSON deployment artifact)
 *   RELEASE_CANDIDATE_NOW (optional ISO override for expiry checks)
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const CORE_OPERATIONS = ['copy.generate', 'image.generate', 'video.generate'];
const REQUIRED_UNITS = ['web', 'core', 'worker', 'canvas'];
const COMMIT_SHA_PATTERN = /^[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export function resolveEvidencePath(env = process.env) {
  const explicit = env.PROVIDER_LIVE_EVIDENCE_PATH?.trim();
  if (explicit) return explicit;
  const dir = env.PROVIDER_LIVE_EVIDENCE_DIR?.trim();
  if (dir) {
    return dir.endsWith('provider-live-gate.json')
      ? dir
      : resolve(dir, 'provider-live-gate.json');
  }
  return resolve('apps/core/provider-live-evidence/provider-live-gate.json');
}

export function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Pure judgment used by CLI and unit tests. Mirrors core release-candidate rules
 * without importing TS runtime (keeps the gate script dependency-light).
 */
export function assertReleaseCandidateEvidence({
  expectedCommitSha,
  providerLiveReport,
  units,
  now = new Date(),
}) {
  const errors = [];
  if (!expectedCommitSha || expectedCommitSha === 'unknown') {
    errors.push('RELEASE_COMMIT_SHA is required.');
  } else if (!COMMIT_SHA_PATTERN.test(expectedCommitSha)) {
    errors.push('RELEASE_COMMIT_SHA must be a full 40-character commit SHA.');
  }
  if (!Number.isFinite(now.getTime())) {
    errors.push('Release candidate clock must be a valid timestamp.');
  }

  if (!Array.isArray(units) || units.length === 0) {
    errors.push('Release units are required.');
  } else {
    const required = new Set(REQUIRED_UNITS);
    const present = new Set(units.map((unit) => unit.unit));
    if (units.length !== REQUIRED_UNITS.length) {
      errors.push('Release manifest must contain exactly web, core, worker, and canvas.');
    }
    for (const unit of required) {
      if (!present.has(unit)) errors.push(`Release manifest missing unit ${unit}.`);
    }
    for (const unit of present) {
      if (!required.has(unit)) errors.push(`Release manifest has unknown unit ${unit}.`);
    }
    if (present.size !== units.length) {
      errors.push('Release manifest must not duplicate units.');
    }
    const commits = new Set(units.map((unit) => unit.commitSha).filter(Boolean));
    if (commits.size !== 1) {
      errors.push('Release units must share a single commit SHA.');
    }
    if (expectedCommitSha && !commits.has(expectedCommitSha)) {
      errors.push(
        `Release units do not include expected commit ${expectedCommitSha}.`,
      );
    }
    for (const unit of units) {
      if (!COMMIT_SHA_PATTERN.test(unit.commitSha ?? '')) {
        errors.push(`Release unit ${unit.unit} must have a full commitSha.`);
      }
      if (!nonEmpty(unit.artifactDigest)) {
        errors.push(`Release unit ${unit.unit} is missing artifactDigest.`);
      }
      if (!nonEmpty(unit.configRevision)) {
        errors.push(`Release unit ${unit.unit} is missing configRevision.`);
      }
    }
  }

  if (!providerLiveReport || typeof providerLiveReport !== 'object') {
    errors.push(
      'Provider live evidence is required for release-candidate acceptance (fail closed).',
    );
    return { ok: false, errors };
  }

  if (!isRecord(providerLiveReport)) {
    errors.push('Provider live evidence must be a JSON object.');
    return { ok: false, errors };
  }
  const report = providerLiveReport;
  if (report.complete === false || report.status === 'preflight_pending') {
    errors.push('Provider live evidence is incomplete.');
  }
  if (report.releaseRef !== expectedCommitSha) {
    errors.push(
      `Provider live evidence releaseRef=${report.releaseRef ?? 'missing'} does not match ${expectedCommitSha}.`,
    );
  }
  if (report.acceptanceMode !== 'primary_connectivity') {
    errors.push(
      `PROVIDER live acceptanceMode must be primary_connectivity (got ${report.acceptanceMode ?? 'missing'}).`,
    );
  }
  for (const field of [
    'runNonce',
    'environment',
    'configurationRevision',
    'effectiveConfigurationSha256',
    'startedAt',
    'completedAt',
    'expiresAt',
  ]) {
    if (!report[field] || typeof report[field] !== 'string') {
      errors.push(`Provider live evidence missing ${field}.`);
    }
  }
  if (!SHA256_PATTERN.test(report.effectiveConfigurationSha256 ?? '')) {
    errors.push('Provider live evidence effectiveConfigurationSha256 must be a SHA-256 fingerprint.');
  }
  const startedAt = Date.parse(report.startedAt ?? '');
  const completedAt = Date.parse(report.completedAt ?? '');
  const expiresAt = Date.parse(report.expiresAt ?? '');
  if (
    Number.isFinite(startedAt) &&
    Number.isFinite(completedAt) &&
    completedAt < startedAt
  ) {
    errors.push('Provider live evidence completed before it started.');
  }
  if (
    Number.isFinite(completedAt) &&
    Number.isFinite(expiresAt) &&
    expiresAt <= completedAt
  ) {
    errors.push('Provider live evidence expires before completion.');
  }
  if (
    typeof report.expiresAt === 'string' &&
    Number.isFinite(Date.parse(report.expiresAt)) &&
    Date.parse(report.expiresAt) <= now.getTime()
  ) {
    errors.push(`Provider live evidence expired at ${report.expiresAt}.`);
  }

  if (!Array.isArray(report.blockedChecks)) {
    errors.push('Provider live evidence missing blockedChecks array.');
  }
  if (!Array.isArray(report.skippedOperations)) {
    errors.push('Provider live evidence missing skippedOperations array.');
  }
  if (!Array.isArray(report.activationEvidence)) {
    errors.push('Provider live evidence missing activationEvidence array.');
  }
  if (!Array.isArray(report.probes)) {
    errors.push('Provider live evidence missing probes array.');
  }
  if (!Array.isArray(report.publishGates)) {
    errors.push('Provider live evidence missing publishGates array.');
  }
  const actualCost = actualCostLedger(report.actualCost);
  if (!actualCost) {
    errors.push('Provider live evidence needs a valid bounded CNY actualCost ledger.');
  }

  const blocked = Array.isArray(report.blockedChecks) ? report.blockedChecks : [];
  const skipped = new Set(
    Array.isArray(report.skippedOperations) ? report.skippedOperations : [],
  );
  if (blocked.some((entry) => !isRecord(entry))) {
    errors.push(
      'Provider live blockedChecks must contain structured evidence records.',
    );
  }
  if ([...skipped].some((operation) => !nonEmpty(operation))) {
    errors.push('Provider live skippedOperations must contain operation names.');
  }
  if (blocked.length > 0 || skipped.size > 0) {
    errors.push(
      'Provider live evidence contains blockedChecks or skippedOperations; release candidate fails closed globally.',
    );
  }

  const activations = Array.isArray(report.activationEvidence)
    ? report.activationEvidence
    : [];
  const probes = Array.isArray(report.probes) ? report.probes : [];
  const gates = Array.isArray(report.publishGates) ? report.publishGates : [];
  let acceptedCoreProbeCny = 0;

  for (const operation of CORE_OPERATIONS) {
    const activation = activations.find((entry) =>
      isCurrentOfficialActivation(entry, operation),
    );
    if (!activation) {
      errors.push(
        `Missing complete live_verified official_direct activation for ${operation}.`,
      );
    } else {
      const probeCostCny = matchingAcceptedProbeCny(
        probes,
        operation,
        activation,
      );
      if (probeCostCny !== undefined) {
        acceptedCoreProbeCny += probeCostCny;
      } else {
        errors.push(
          `Missing accepted CNY-costed provider result for ${operation}.`,
        );
      }
    }
    const gate = gates.find((entry) => entry && entry.operation === operation);
    if (!gate || gate.publishAllowed !== true) {
      errors.push(`Publish gate not allowed for ${operation}.`);
    } else if (gate.status === 'multi_channel_ready') {
      if (
        gate.multiChannelReady !== true ||
        (gate.independentFaultDomainCount ?? 0) < 2
      ) {
        errors.push(
          `${operation}: multi-channel claim requires ≥2 independent fault domains.`,
        );
      }
    } else if (gate.status !== 'single_channel') {
      errors.push(
        `${operation}: expected single_channel or multi_channel_ready publish gate, got ${gate.status}.`,
      );
    } else if (gate.multiChannelReady === true) {
      errors.push(
        `${operation}: single-channel gate cannot claim multi-channel readiness.`,
      );
    } else if (
      gate.channelLabel &&
      gate.channelLabel !== 'single-channel/no-fallback'
    ) {
      errors.push(
        `${operation}: single-channel gate must label single-channel/no-fallback.`,
      );
    }
  }
  if (
    actualCost &&
    actualCost.providerProbeCny + 1e-9 < acceptedCoreProbeCny
  ) {
    errors.push(
      'Provider live actualCost does not cover the accepted core probe CNY costs.',
    );
  }

  const blob = JSON.stringify(report);
  if (
    /sk-[A-Za-z0-9]{16,}/u.test(blob) ||
    /Bearer\s+[A-Za-z0-9._-]{16,}/iu.test(blob) ||
    /"api[_-]?key"\s*:\s*"[^"]{8,}"/iu.test(blob) ||
    /ARK_(?:TEXT_)?API_KEY\s*[:=]\s*\S+/u.test(blob)
  ) {
    errors.push('Provider live evidence appears to contain secret material.');
  }

  return { ok: errors.length === 0, errors };
}

function isCurrentOfficialActivation(value, operation) {
  return (
    isRecord(value) &&
    value.operation === operation &&
    value.activationStatus === 'live_verified' &&
    value.channelKind === 'official_direct' &&
    value.adapterExecuted === true &&
    value.providerCallSucceeded === true &&
    nonEmpty(value.deploymentId) &&
    nonEmpty(value.catalogModelId) &&
    nonEmpty(value.providerProfileId) &&
    nonEmpty(value.evidenceRef) &&
    validTimestamp(value.verifiedAt)
  );
}

function matchingAcceptedProbeCny(probes, operation, activation) {
  const probe = probes.find(
    (value) =>
      isRecord(value) &&
      value.operation === operation &&
      value.channelKind === 'official_direct' &&
      value.deploymentId === activation.deploymentId &&
      value.catalogModelId === activation.catalogModelId &&
      value.providerProfileId === activation.providerProfileId &&
      value.adapterExecuted === true &&
      value.providerCallSucceeded === true &&
      value.acceptance === 'accepted' &&
      nonEmpty(value.providerTaskRef) &&
      value.evidenceRef === activation.evidenceRef &&
      validTimestamp(value.observedAt) &&
      isRecord(value.lifecycle) &&
      value.lifecycle.submitted === true &&
      cnyCost(value.providerCost) !== undefined,
  );
  return probe ? cnyCost(probe.providerCost) : undefined;
}

function cnyCost(value) {
  if (!isRecord(value)) return undefined;
  const amount =
    finiteNumber(value.amountCny) ??
    (value.currency === 'CNY' ? finiteNumber(value.amount) : undefined);
  return amount !== undefined && amount >= 0 ? amount : undefined;
}

function actualCostLedger(value) {
  if (!isRecord(value)) return undefined;
  const providerProbeCny = finiteNumber(value.providerProbeCny);
  const externalEvidenceCny = finiteNumber(value.externalEvidenceCny);
  const totalCny = finiteNumber(value.totalCny);
  const capCny = finiteNumber(value.capCny);
  if (
    providerProbeCny !== undefined &&
    providerProbeCny >= 0 &&
    externalEvidenceCny !== undefined &&
    externalEvidenceCny >= 0 &&
    totalCny !== undefined &&
    totalCny >= 0 &&
    capCny !== undefined &&
    capCny > 0 &&
    totalCny <= capCny &&
    Math.abs(totalCny - providerProbeCny - externalEvidenceCny) < 1e-9
  ) {
    return { capCny, externalEvidenceCny, providerProbeCny, totalCny };
  }
  return undefined;
}

function validTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateReleaseManifestArtifact(
  manifest,
  expectedCommitSha,
  now = new Date(),
) {
  const errors = [];
  if (!isRecord(manifest)) {
    return { errors: ['Release manifest must be a JSON object.'], units: [] };
  }
  if (!Number.isFinite(now.getTime())) {
    errors.push('Release candidate clock must be a valid timestamp.');
  }
  if (manifest.schemaVersion !== 1) {
    errors.push('Release manifest schemaVersion must be 1.');
  }
  if (manifest.releaseRef !== expectedCommitSha) {
    errors.push('Release manifest releaseRef must match RELEASE_COMMIT_SHA.');
  }
  if (manifest.environment !== 'staging') {
    errors.push('Release manifest environment must be staging for P0 RC acceptance.');
  }
  if (!nonEmpty(manifest.workflowRun)) {
    errors.push('Release manifest workflowRun is required.');
  }
  for (const field of [
    'startedAt',
    'completedAt',
    'capturedAt',
    'expiresAt',
  ]) {
    if (!validTimestamp(manifest[field])) {
      errors.push(`Release manifest ${field} must be an ISO timestamp.`);
    }
  }
  const startedAt = Date.parse(manifest.startedAt ?? '');
  const completedAt = Date.parse(manifest.completedAt ?? '');
  const expiresAt = Date.parse(manifest.expiresAt ?? '');
  if (
    Number.isFinite(startedAt) &&
    Number.isFinite(completedAt) &&
    completedAt < startedAt
  ) {
    errors.push('Release manifest completed before it started.');
  }
  if (
    Number.isFinite(completedAt) &&
    Number.isFinite(expiresAt) &&
    expiresAt <= completedAt
  ) {
    errors.push('Release manifest expires before completion.');
  }
  if (Number.isFinite(expiresAt) && expiresAt <= now.getTime()) {
    errors.push(`Release manifest expired at ${manifest.expiresAt}.`);
  }
  if (manifest.result !== 'pass') {
    errors.push('Release manifest result must be pass.');
  }
  if (!isRecord(manifest.verification)) {
    errors.push('Release manifest verification evidence is required.');
  } else {
    if (!nonEmpty(manifest.verification.readinessEvidenceRef)) {
      errors.push('Release manifest readiness evidence is required.');
    }
    if (!nonEmpty(manifest.verification.recoveryEvidenceRef)) {
      errors.push('Release manifest recovery evidence is required.');
    }
    if (!isRecord(manifest.verification.journeyEvidenceRefs)) {
      errors.push('Release manifest journey evidence is required.');
    } else {
      for (const medium of ['copy', 'image', 'video']) {
        if (!nonEmpty(manifest.verification.journeyEvidenceRefs[medium])) {
          errors.push(`Release manifest ${medium} journey evidence is required.`);
        }
      }
    }
  }
  return {
    errors,
    units: Array.isArray(manifest.units) ? manifest.units : [],
  };
}

export function main(env = process.env) {
  const expectedCommitSha = env.RELEASE_COMMIT_SHA?.trim();
  if (!expectedCommitSha) {
    console.error('RELEASE_COMMIT_SHA must identify the release candidate');
    process.exit(2);
  }

  const evidencePath = resolveEvidencePath(env);
  if (!existsSync(evidencePath)) {
    console.error(
      `Provider live evidence missing at ${evidencePath} (fail closed).`,
    );
    process.exit(1);
  }

  let providerLiveReport;
  try {
    providerLiveReport = loadJson(evidencePath);
  } catch (error) {
    console.error(
      `Unable to read provider live evidence at ${evidencePath}:`,
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  }

  const manifestPath = env.RELEASE_MANIFEST_PATH?.trim();
  if (!manifestPath) {
    console.error('RELEASE_MANIFEST_PATH is required for release-candidate acceptance (fail closed).');
    process.exit(1);
  }
  if (!existsSync(manifestPath)) {
    console.error(`Release manifest missing at ${manifestPath}.`);
    process.exit(1);
  }

  let manifest;
  try {
    manifest = loadJson(manifestPath);
  } catch (error) {
    console.error(
      `Unable to read release manifest at ${manifestPath}:`,
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  }
  const now = env.RELEASE_CANDIDATE_NOW
    ? new Date(env.RELEASE_CANDIDATE_NOW)
    : new Date();
  if (!Number.isFinite(now.getTime())) {
    console.error('RELEASE_CANDIDATE_NOW must be a valid ISO timestamp.');
    process.exit(2);
  }
  const manifestValidation = validateReleaseManifestArtifact(
    manifest,
    expectedCommitSha,
    now,
  );
  if (manifestValidation.errors.length > 0) {
    console.error('Release manifest gate failed:');
    for (const error of manifestValidation.errors) {
      console.error(` - ${error}`);
    }
    process.exit(1);
  }
  const units = manifestValidation.units;

  const result = assertReleaseCandidateEvidence({
    expectedCommitSha,
    providerLiveReport,
    units,
    now,
  });

  if (!result.ok) {
    console.error('Release-candidate evidence gate failed:');
    for (const error of result.errors) {
      console.error(` - ${error}`);
    }
    process.exit(1);
  }

  console.log(
    JSON.stringify(
      {
        status: 'pass',
        releaseCommitSha: expectedCommitSha,
        evidencePath,
        releaseManifestPath: manifestPath,
        acceptanceMode: providerLiveReport.acceptanceMode,
        expiresAt: providerLiveReport.expiresAt,
        units: units.map((unit) => unit.unit),
      },
      null,
      2,
    ),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
