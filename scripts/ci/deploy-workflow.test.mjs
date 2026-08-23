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
  // Arbitration 2026-08-23: merge-required and deploy-required are different
  // sets. The 2026-08-14 gate shrink made the two browser jobs advisory for
  // merge; deploy must still refuse to ship while they are red, so deploy.yml
  // gates on a green same-SHA Advisory telemetry run.
  assert.match(workflow, /Require a green same-SHA Advisory telemetry run/);
  assert.match(
    workflow,
    /actions\/workflows\/advisory-telemetry\.yml\/runs\?head_sha=\$\{HEAD_SHA\}/,
  );
  assert.match(workflow, /HEAD_SHA: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
  assert.match(workflow, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(workflow, /\[ "\$\{status\}" != "completed" \]/);
  assert.match(workflow, /\[ "\$\{conclusion\}" = "success" \]/);
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /github\.event\.workflow_run\.event == 'push'/);
  assert.match(workflow, /ref: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
  assert.match(workflow, /run-id: \$\{\{ github\.event\.workflow_run\.id \}\}/);
  assert.match(workflow, /RELEASE_COMMIT_SHA: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
  assert.match(workflow, /node scripts\/ci\/verify-release-manifest\.mjs/);
  assert.match(workflow, /verify-wrangler-config\.mjs --require-real-resources/);
});

test('release-candidate evidence runs only when explicitly requested', async () => {
  const workflow = await readFile(
    resolve(repositoryRoot, '.github/workflows/core-quality.yml'),
    'utf8',
  );

  const pushConditionCount =
    workflow.match(/github\.event_name == 'push'/g)?.length ?? 0;
  assert.equal(
    pushConditionCount,
    0,
    'release-candidate evidence must not run on an ordinary main push',
  );
  assert.match(
    workflow,
    /release-manifest:[\s\S]*github\.event_name == 'workflow_dispatch'[\s\S]*release-candidate/,
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
      units: ['web', 'core', 'worker'].map((unit) => ({
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

test('the Advisory telemetry poll window outlives a real Advisory telemetry run', async () => {
  const workflow = await readFile(
    resolve(repositoryRoot, '.github/workflows/deploy.yml'),
    'utf8',
  );

  // V31-105 §9: the first window (30 × 60s) was shorter than Advisory
  // telemetry itself, so every main deploy hit the timeout branch and had to
  // be re-run by hand (run 32590987502 stopped at attempt 30/30 with the
  // Advisory run still `in_progress`). Observed Advisory durations on
  // 2026-08-23 were 56–63 minutes (runs 32607773750 / 32609257815 /
  // 32615842113 / 32618549598), so the window must clear 70 minutes.
  const maxAttempts = Number(workflow.match(/^\s*max_attempts=(\d+)$/mu)?.[1]);
  const sleepSeconds = Number(workflow.match(/^\s*sleep (\d+)$/mu)?.[1]);
  assert.ok(
    Number.isInteger(maxAttempts) && maxAttempts > 0,
    'deploy.yml must declare a numeric max_attempts for the Advisory poll',
  );
  assert.ok(
    Number.isInteger(sleepSeconds) && sleepSeconds > 0,
    'deploy.yml must declare a numeric sleep interval for the Advisory poll',
  );

  const windowMinutes = (maxAttempts * sleepSeconds) / 60;
  assert.ok(
    windowMinutes >= 70,
    `Advisory telemetry poll window is ${windowMinutes} minutes; it must be at least 70 ` +
      'so a deploy is not timed out by an Advisory run that is still healthy (V31-105 §9)',
  );

  // A step timeout shorter than the poll window would silently reinstate the
  // same bug one level up.
  const gateStep = workflow.match(
    /- name: Require a green same-SHA Advisory telemetry run[\s\S]*?(?=\n      - name: )/u,
  )?.[0];
  assert.ok(gateStep, 'deploy.yml must still contain the Advisory telemetry gate step');
  const stepTimeout = Number(gateStep.match(/^\s*timeout-minutes: (\d+)$/mu)?.[1]);
  assert.ok(
    stepTimeout > windowMinutes,
    `gate step timeout-minutes (${stepTimeout}) must exceed the ${windowMinutes}-minute poll window`,
  );

  // ...and neither would a job timeout that cannot hold the wait plus the
  // build/deploy budget the job was originally sized for (50 - 31 = 19).
  const jobTimeout = Number(workflow.match(/^ {4}timeout-minutes: (\d+)$/mu)?.[1]);
  assert.ok(
    jobTimeout - stepTimeout >= 19,
    `job timeout-minutes (${jobTimeout}) must leave at least 19 minutes for build/deploy ` +
      `after the ${stepTimeout}-minute gate step`,
  );
});
