import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { verifyReleaseManifest } from './verify-release-manifest.mjs';

const repositoryRoot = resolve(import.meta.dirname, '../..');

test('main deployment is bound to a successful same-SHA Core quality run', async () => {
  const workflow = await readFile(
    resolve(repositoryRoot, '.github/workflows/deploy.yml'),
    'utf8',
  );

  assert.doesNotMatch(workflow, /^\s{2}workflow_dispatch:/m);
  assert.match(workflow, /^\s{2}workflow_run:/m);
  assert.match(workflow, /workflows: \['Core quality'\]/);
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /github\.event\.workflow_run\.event == 'push'/);
  assert.match(workflow, /ref: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
  assert.match(workflow, /run-id: \$\{\{ github\.event\.workflow_run\.id \}\}/);
  assert.match(workflow, /RELEASE_COMMIT_SHA: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
  assert.match(workflow, /node scripts\/ci\/verify-release-manifest\.mjs/);
  assert.match(workflow, /verify-wrangler-config\.mjs --require-real-resources/);
});

test('main push mints and consumes release-candidate evidence', async () => {
  const workflow = await readFile(
    resolve(repositoryRoot, '.github/workflows/core-quality.yml'),
    'utf8',
  );

  const pushConditionCount = workflow.match(
    /github\.event_name == 'push'/g,
  )?.length;
  assert.ok(
    (pushConditionCount ?? 0) >= 2,
    'release-manifest and e2e must both run on main push',
  );
});

test('deployment manifest verification accepts only the expected live SHA', async () => {
  const commit = 'a'.repeat(40);
  const directory = await mkdtemp(resolve(tmpdir(), 'meiye-deploy-manifest-'));
  const manifestPath = resolve(directory, 'release-manifest.json');
  await writeFile(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      releaseRef: commit,
      environment: 'staging',
      workflowRun: 'https://github.com/example/repo/actions/runs/1',
      result: 'pass',
      startedAt: '2026-07-27T00:00:00.000Z',
      completedAt: '2026-07-27T00:05:00.000Z',
      capturedAt: '2026-07-27T00:05:00.000Z',
      expiresAt: '2026-07-27T12:05:00.000Z',
      verification: {
        readinessEvidenceRef: 'staging:readiness:1',
        recoveryEvidenceRef: 'staging:recovery:1',
        journeyEvidenceRefs: {
          copy: 'staging:journey:copy:1',
          image: 'staging:journey:image:1',
          video: 'staging:journey:video:1',
        },
      },
      units: ['web', 'core', 'worker', 'canvas'].map((unit) => ({
        unit,
        commitSha: commit,
        artifactDigest: `sha256:${unit}-immutable`,
        configRevision: `staging-${unit}-config-1`,
      })),
    }),
  );

  assert.deepEqual(
    verifyReleaseManifest(
      manifestPath,
      commit,
      new Date('2026-07-27T06:00:00.000Z'),
    ).errors,
    [],
  );
  assert.match(
    verifyReleaseManifest(
      manifestPath,
      'b'.repeat(40),
      new Date('2026-07-27T06:00:00.000Z'),
    ).errors.join('; '),
    /must match RELEASE_COMMIT_SHA/,
  );
});
