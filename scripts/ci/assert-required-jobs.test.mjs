import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';

const scriptPath = resolve(import.meta.dirname, 'assert-required-jobs.mjs');
const requiredResultKeys = [
  'REQUIRED_REDLINE_EVALS_RESULT',
  'REQUIRED_CORE_RESULT',
  'REQUIRED_ROOT_QUALITY_RESULT',
  'REQUIRED_CORE_PERSISTENCE_RESULT',
  'REQUIRED_PRODUCTION_MAIN_JOURNEY_RESULT',
];

function runRequiredGate(overrides = {}) {
  return spawnSync(process.execPath, [scriptPath], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...Object.fromEntries(requiredResultKeys.map((key) => [key, 'success'])),
      ...overrides,
    },
  });
}

test('the aggregate required gate passes only when every dependency succeeds', () => {
  const result = runRequiredGate();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /All required jobs succeeded/u);
});

for (const resultName of ['failure', 'cancelled', 'skipped']) {
  test(`the aggregate required gate rejects ${resultName}`, () => {
    const result = runRequiredGate({
      REQUIRED_PRODUCTION_MAIN_JOURNEY_RESULT: resultName,
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(resultName, 'u'));
  });
}

for (const environmentKey of requiredResultKeys) {
  test(`the aggregate required gate rejects a failed ${environmentKey}`, () => {
    const result = runRequiredGate({ [environmentKey]: 'failure' });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /failure/u);
  });
}

test('the aggregate required gate rejects a missing dependency result', () => {
  const environment = { ...process.env };
  for (const key of requiredResultKeys) environment[key] = 'success';
  delete environment.REQUIRED_CORE_PERSISTENCE_RESULT;

  const result = spawnSync(process.execPath, [scriptPath], {
    encoding: 'utf8',
    env: environment,
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /REQUIRED_CORE_PERSISTENCE_RESULT/u);
});
