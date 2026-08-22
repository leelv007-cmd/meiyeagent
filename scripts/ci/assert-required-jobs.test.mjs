import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  ADVISORY_TELEMETRY_JOBS,
  MERGE_REQUIRED_JOBS,
  aggregateMergeRequired,
  jobNames,
} from './assert-required-jobs.mjs';

const scriptPath = resolve(import.meta.dirname, 'assert-required-jobs.mjs');
const repositoryRoot = resolve(import.meta.dirname, '../..');
const requiredResultKeys = MERGE_REQUIRED_JOBS.map(
  ([, environmentKey]) => environmentKey
);
const advisoryResultKeys = ADVISORY_TELEMETRY_JOBS.map(
  ([, environmentKey]) => environmentKey
);

function successfulBlockingEnv() {
  return Object.fromEntries(requiredResultKeys.map((key) => [key, 'success']));
}

function advisoryRedEnv() {
  return Object.fromEntries(
    advisoryResultKeys.map((key) => [key, 'failure'])
  );
}

function runRequiredGate(overrides = {}) {
  return spawnSync(process.execPath, [scriptPath], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...successfulBlockingEnv(),
      ...overrides,
    },
  });
}

function extractJobBlock(workflow, jobName) {
  const block = workflow.match(
    new RegExp(`^ {2}${jobName}:$([\\s\\S]*?)(?=^ {2}\\S|(?![\\s\\S]))`, 'mu')
  );
  assert.ok(block, `job ${jobName} is missing from the workflow`);
  return block[1];
}

function listJobNames(workflow) {
  const jobsIndex = workflow.search(/^jobs:\s*$/mu);
  assert.ok(jobsIndex >= 0, 'workflow is missing a jobs: map');
  return [...workflow.slice(jobsIndex).matchAll(/^ {2}([a-z0-9-]+):$/gmu)].map(
    (match) => match[1]
  );
}

test('advisory telemetry jobs never belong to the merge-required set', () => {
  const required = new Set(jobNames(MERGE_REQUIRED_JOBS));
  for (const jobName of jobNames(ADVISORY_TELEMETRY_JOBS)) {
    assert.equal(required.has(jobName), false, jobName);
  }
  assert.deepEqual(jobNames(ADVISORY_TELEMETRY_JOBS), [
    'p2-browser-acceptance',
    'v31-browser-report',
  ]);
  assert.ok(required.has('persistence-instrument'));
  assert.ok(required.has('production-main-journey'));
  assert.ok(required.has('v31-day0-gate'));
});

test('the aggregate required gate passes only when every blocking job succeeds', () => {
  const result = runRequiredGate();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /All merge-required jobs succeeded/u);
});

test('advisory red does not fail merge-required when every blocking job succeeded', () => {
  const verdict = aggregateMergeRequired({
    ...successfulBlockingEnv(),
    ...advisoryRedEnv(),
  });
  assert.equal(verdict.mergeRequired, true);
  assert.deepEqual(verdict.blockingFailures, []);
  assert.equal(verdict.advisoryFailures.length, ADVISORY_TELEMETRY_JOBS.length);

  const result = runRequiredGate(advisoryRedEnv());
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /All merge-required jobs succeeded/u);
  assert.match(
    result.stdout,
    /Advisory telemetry red \(does not block merge-required\)/u
  );
  assert.match(result.stdout, /p2-browser-acceptance: failure/u);
  assert.match(result.stdout, /v31-browser-report: failure/u);
});

test('missing advisory telemetry results do not fail merge-required', () => {
  const environment = { ...process.env, ...successfulBlockingEnv() };
  for (const key of advisoryResultKeys) delete environment[key];

  const result = spawnSync(process.execPath, [scriptPath], {
    encoding: 'utf8',
    env: environment,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /All merge-required jobs succeeded/u);
  assert.doesNotMatch(result.stdout, /Advisory telemetry red/u);
});

for (const resultName of ['failure', 'cancelled', 'skipped']) {
  test(`advisory ${resultName} does not fail merge-required`, () => {
    const result = runRequiredGate({
      ADVISORY_P2_BROWSER_ACCEPTANCE_RESULT: resultName,
      ADVISORY_V31_BROWSER_REPORT_RESULT: resultName,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /All merge-required jobs succeeded/u);
  });

  test(`the aggregate required gate rejects blocking ${resultName}`, () => {
    const result = runRequiredGate({
      REQUIRED_PRODUCTION_MAIN_JOURNEY_RESULT: resultName,
      ...advisoryRedEnv(),
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(resultName, 'u'));
    assert.match(result.stderr, /production-main-journey/u);
  });
}

for (const environmentKey of requiredResultKeys) {
  test(`the aggregate required gate rejects a failed ${environmentKey}`, () => {
    const result = runRequiredGate({
      [environmentKey]: 'failure',
      ...advisoryRedEnv(),
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /failure/u);
    assert.doesNotMatch(
      result.stderr,
      /does not block merge-required[\s\S]*All merge-required jobs succeeded/u
    );
  });
}

test('the aggregate required gate rejects a missing dependency result', () => {
  const environment = { ...process.env, ...successfulBlockingEnv() };
  delete environment.REQUIRED_CORE_PERSISTENCE_RESULT;

  const result = spawnSync(process.execPath, [scriptPath], {
    encoding: 'utf8',
    env: environment,
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /REQUIRED_CORE_PERSISTENCE_RESULT/u);
});

test('Core quality merge-required needs only blocking jobs', async () => {
  const coreQuality = await readFile(
    resolve(repositoryRoot, '.github/workflows/core-quality.yml'),
    'utf8'
  );
  const advisoryTelemetry = await readFile(
    resolve(repositoryRoot, '.github/workflows/advisory-telemetry.yml'),
    'utf8'
  );

  const requiredBlock = extractJobBlock(coreQuality, 'required');
  const declaredNeeds = [
    ...requiredBlock.matchAll(/^ {6}- ([a-z0-9-]+)$/gmu),
  ].map((match) => match[1]);
  assert.deepEqual(
    [...declaredNeeds].sort(),
    [...jobNames(MERGE_REQUIRED_JOBS)].sort()
  );
  for (const jobName of jobNames(ADVISORY_TELEMETRY_JOBS)) {
    assert.equal(declaredNeeds.includes(jobName), false, jobName);
    assert.doesNotMatch(
      coreQuality,
      new RegExp(`^ {2}${jobName}:$`, 'mu')
    );
    extractJobBlock(advisoryTelemetry, jobName);
  }
  assert.match(
    extractJobBlock(coreQuality, 'production-main-journey-batch'),
    /PLAYWRIGHT_PRODUCTION_CANDIDATE: true/
  );
  assert.match(
    extractJobBlock(coreQuality, 'production-main-journey'),
    /needs:[\s\S]*production-main-journey-batch/u
  );
  assert.doesNotMatch(
    extractJobBlock(coreQuality, 'production-main-journey'),
    /PLAYWRIGHT_PRODUCTION_CANDIDATE: true/
  );
  assert.doesNotMatch(
    extractJobBlock(coreQuality, 'persistence-instrument'),
    /continue-on-error/
  );
});

test('advisory telemetry is a separate workflow whose red cannot fail Core quality', async () => {
  const coreQuality = await readFile(
    resolve(repositoryRoot, '.github/workflows/core-quality.yml'),
    'utf8'
  );
  const advisoryTelemetry = await readFile(
    resolve(repositoryRoot, '.github/workflows/advisory-telemetry.yml'),
    'utf8'
  );
  const deploy = await readFile(
    resolve(repositoryRoot, '.github/workflows/deploy.yml'),
    'utf8'
  );

  assert.match(advisoryTelemetry, /^name: Advisory telemetry$/m);
  assert.deepEqual(
    listJobNames(advisoryTelemetry).sort(),
    [...jobNames(ADVISORY_TELEMETRY_JOBS)].sort()
  );
  assert.match(deploy, /workflows: \['Core quality'\]/);
  assert.doesNotMatch(deploy, /Advisory telemetry/);
  assert.doesNotMatch(coreQuality, /run-v31-instruments/);
  const v31Instrument = extractJobBlock(
    advisoryTelemetry,
    'v31-browser-report'
  );
  assert.match(v31Instrument, /run-v31-instruments\.sh/);
  assert.match(
    v31Instrument,
    /Run V31-82 timeout instrument separately from product verdicts[\s\S]*continue-on-error: true/
  );
});
