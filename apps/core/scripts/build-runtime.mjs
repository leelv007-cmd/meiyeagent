#!/usr/bin/env node
/**
 * Immutable runtime build contract for Core API + Worker (#143 / P0-D2).
 *
 * Same package/artifact family, two start commands:
 *   pnpm --filter @meiye/core start          → runtime-entry api
 *   pnpm --filter @meiye/core start:worker   → runtime-entry worker
 *
 * This script validates the dual-command contract and writes a release
 * identity stub that deploy pipelines can enrich with digest/config revision.
 * It intentionally does not invent multi-channel live claims.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const start = pkg.scripts?.start ?? '';
const startWorker = pkg.scripts?.['start:worker'] ?? '';

const problems = [];
if (!start.includes('runtime-entry') || !/\bapi\b/.test(start)) {
  problems.push('scripts.start must launch runtime-entry with role api');
}
if (!startWorker.includes('runtime-entry') || !/\bworker\b/.test(startWorker)) {
  problems.push(
    'scripts.start:worker must launch runtime-entry with role worker',
  );
}
if (/tsx watch/.test(start) || /tsx watch/.test(startWorker)) {
  problems.push('production start commands must not use tsx watch');
}

if (problems.length > 0) {
  console.error('Immutable runtime build contract failed:');
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}

const outDir = join(root, 'dist');
mkdirSync(outDir, { recursive: true });

const commitSha =
  process.env.RELEASE_COMMIT_SHA?.trim() ||
  process.env.GITHUB_SHA?.trim() ||
  'unknown';
const artifactDigest =
  process.env.RELEASE_ARTIFACT_DIGEST?.trim() ||
  process.env.IMAGE_DIGEST?.trim() ||
  undefined;
const configRevision =
  process.env.RELEASE_CONFIG_REVISION?.trim() ||
  process.env.PROVIDER_LIVE_CONFIG_REVISION?.trim() ||
  undefined;

const manifest = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  packageName: pkg.name,
  dualStartCommands: {
    api: 'node --import tsx src/runtime-entry.ts api',
    worker: 'node --import tsx src/runtime-entry.ts worker',
  },
  units: [
    {
      unit: 'core',
      commitSha,
      ...(artifactDigest ? { artifactDigest } : {}),
      ...(configRevision ? { configRevision } : {}),
    },
    {
      unit: 'worker',
      commitSha,
      ...(artifactDigest ? { artifactDigest } : {}),
      ...(configRevision ? { configRevision } : {}),
    },
  ],
  notes: [
    'Web and Canvas units are bound by the deploy pipeline into the same commit.',
    'This artifact does not claim multi-channel provider live readiness.',
  ],
};

const manifestPath = join(outDir, 'release-manifest.core.json');
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${manifestPath}`);
console.log(
  'Immutable runtime contract ok: same package, dual start commands (api|worker).',
);
