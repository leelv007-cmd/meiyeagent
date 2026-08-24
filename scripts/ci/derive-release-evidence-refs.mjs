#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * V31-94 direction A: release evidence references are DERIVED from the run that
 * mints the manifest, never configured as repository constants.
 *
 * A `vars.*` constant cannot express "the evidence for THIS release": filled
 * once with any non-empty string, the fail-closed check never fires again and
 * every later manifest cites evidence unrelated to the release it describes.
 * Deriving the refs from the minting run's own jobs/artifacts makes each
 * manifest describe exactly the release being minted, with zero manual upkeep.
 *
 * Evidence ownership map (adjudicated in V31-94, 2026-08-24):
 *   readiness      -> artifact `root-required-quality-evidence` (root-quality:
 *                     static contracts, audits, evidence guard)
 *   journey copy   -> artifact `production-main-journey-evidence-mainline`
 *                     (m04 three-modality mainline journey, copy leg)
 *   journey image  -> artifact `v31-day0-gate-evidence` (zero-source image_text
 *                     first visit — the V3.1 release gate)
 *   journey video  -> artifact `production-main-journey-evidence-mainline`
 *                     (m04 three-modality mainline journey, video leg)
 *   recovery       -> job `e2e` of the same run — the release-verdict catalog
 *                     (journey-ownership-catalog --purpose release-verdict)
 *                     including the XHS production-candidate fault/recovery
 *                     journeys. This is a FORWARD reference: the e2e job runs
 *                     after the manifest is minted and is itself the gate that
 *                     accepts the manifest, so the pointer becomes valid
 *                     exactly when the release proceeds; on failure the job is
 *                     red and uploads `playwright-failure-artifacts`.
 *
 * Fail-closed is preserved: every backward reference must name an artifact the
 * minting run has actually uploaded (the caller passes the run's artifact
 * listing). A missing artifact is a hard error — the manifest is not minted.
 * Refs embed the run id, so two different runs can never mint identical refs.
 */

export const BACKWARD_EVIDENCE_ARTIFACTS = Object.freeze({
  RELEASE_READINESS_EVIDENCE_REF: 'root-required-quality-evidence',
  RELEASE_JOURNEY_EVIDENCE_REF_COPY: 'production-main-journey-evidence-mainline',
  RELEASE_JOURNEY_EVIDENCE_REF_IMAGE: 'v31-day0-gate-evidence',
  RELEASE_JOURNEY_EVIDENCE_REF_VIDEO: 'production-main-journey-evidence-mainline',
});

export const FORWARD_EVIDENCE_JOBS = Object.freeze({
  RELEASE_RECOVERY_EVIDENCE_REF: 'e2e',
});

export function deriveReleaseEvidenceRefs({ runUrl, artifactNames }) {
  const errors = [];
  const url = typeof runUrl === 'string' ? runUrl.trim() : '';
  if (!url || !/^https?:\/\//u.test(url)) {
    errors.push('runUrl must be the absolute URL of the minting workflow run.');
  }
  if (!Array.isArray(artifactNames)) {
    errors.push('artifactNames must be the run artifact listing (array of names).');
  }
  const names = new Set(Array.isArray(artifactNames) ? artifactNames : []);
  const refs = {};
  for (const [env, artifact] of Object.entries(BACKWARD_EVIDENCE_ARTIFACTS)) {
    if (!names.has(artifact)) {
      errors.push(
        `${env} needs artifact "${artifact}" but this run has not uploaded it; ` +
          'the manifest fails closed instead of citing evidence that does not exist.'
      );
      continue;
    }
    refs[env] = `${url}#artifact=${artifact}`;
  }
  for (const [env, job] of Object.entries(FORWARD_EVIDENCE_JOBS)) {
    refs[env] = `${url}#job=${job}`;
  }
  return { refs, errors };
}

function main() {
  const runUrl = process.env.RELEASE_WORKFLOW_RUN ?? '';
  const listingPath = process.argv[2];
  if (!listingPath) {
    process.stderr.write(
      'Usage: derive-release-evidence-refs.mjs <artifacts.json>\n' +
        '  <artifacts.json> is the GitHub API response for this run’s artifact listing.\n'
    );
    process.exit(2);
  }
  let listing;
  try {
    listing = JSON.parse(readFileSync(listingPath, 'utf8'));
  } catch (error) {
    process.stderr.write(`Cannot read artifact listing at ${listingPath}: ${error}\n`);
    process.exit(2);
  }
  const artifactNames = (listing.artifacts ?? listing ?? [])
    .map((artifact) => artifact?.name)
    .filter(Boolean);
  const { refs, errors } = deriveReleaseEvidenceRefs({ runUrl, artifactNames });
  if (errors.length > 0) {
    for (const error of errors) process.stderr.write(`${error}\n`);
    process.exit(1);
  }
  for (const [env, value] of Object.entries(refs)) {
    process.stdout.write(`${env}=${value}\n`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
