#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { validateReleaseManifestArtifact } from './assert-release-candidate-evidence.mjs';

export function verifyReleaseManifest(
  manifestPath,
  expectedCommitSha,
  now = new Date(),
) {
  if (!manifestPath) {
    return { errors: ['RELEASE_MANIFEST_PATH is required.'] };
  }
  if (!/^[a-f0-9]{40}$/u.test(expectedCommitSha ?? '')) {
    return {
      errors: ['RELEASE_COMMIT_SHA must be a full 40-character commit SHA.'],
    };
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(resolve(manifestPath), 'utf8'));
  } catch (error) {
    return {
      errors: [
        `Release manifest is unreadable: ${
          error instanceof Error ? error.message : String(error)
        }.`,
      ],
    };
  }
  return validateReleaseManifestArtifact(manifest, expectedCommitSha, now);
}

export function main(env = process.env) {
  const result = verifyReleaseManifest(
    env.RELEASE_MANIFEST_PATH,
    env.RELEASE_COMMIT_SHA,
  );
  if (result.errors.length > 0) {
    console.error('Release manifest verification failed (fail closed):');
    for (const error of result.errors) console.error(` - ${error}`);
    process.exitCode = 1;
    return result;
  }
  console.log(
    JSON.stringify({
      status: 'verified',
      releaseCommitSha: env.RELEASE_COMMIT_SHA,
      releaseManifestPath: env.RELEASE_MANIFEST_PATH,
    }),
  );
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
