import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import {
  assertHarnessReleaseVersionContract,
  checkHarnessReleaseVersionContract,
} from './assert-harness-release-version.mjs';

const repositoryRoot = resolve(import.meta.dirname, '../..');

async function currentInputs() {
  return {
    coreQualityWorkflow: await readFile(
      join(repositoryRoot, '.github/workflows/core-quality.yml'),
      'utf8',
    ),
    deployWorkflow: await readFile(
      join(repositoryRoot, '.github/workflows/deploy.yml'),
      'utf8',
    ),
    runtimeConfig: await readFile(
      join(repositoryRoot, 'apps/core/src/p1/harness/runtime-config.ts'),
      'utf8',
    ),
  };
}

test('the repository satisfies the Harness release-version contract', async () => {
  assert.deepEqual((await assertHarnessReleaseVersionContract(repositoryRoot)).errors, []);
});

test('a missing quality-gate application version fails closed', async () => {
  const inputs = await currentInputs();
  inputs.coreQualityWorkflow = inputs.coreQualityWorkflow.replace(
    '  HARNESS_DBOS_APPLICATION_VERSION: quality-${{ github.sha }}\n',
    '',
  );

  const errors = checkHarnessReleaseVersionContract(inputs);
  assert.ok(errors.some((error) => error.includes('HARNESS_DBOS_APPLICATION_VERSION')));
});

test('a non-sticky quality-gate version fails closed', async () => {
  const inputs = await currentInputs();
  inputs.coreQualityWorkflow = inputs.coreQualityWorkflow.replace(
    '  HARNESS_DBOS_APPLICATION_VERSION: quality-${{ github.sha }}',
    '  HARNESS_DBOS_APPLICATION_VERSION: quality-latest',
  );

  const errors = checkHarnessReleaseVersionContract(inputs);
  assert.ok(errors.some((error) => error.includes('quality-${{ github.sha }}')));
});

test('runtime config changes that drop explicit version precedence fail closed', async () => {
  const inputs = await currentInputs();
  inputs.runtimeConfig = inputs.runtimeConfig.replace(
    'env.HARNESS_DBOS_APPLICATION_VERSION ?? env.DBOS__APPVERSION',
    'env.DBOS__APPVERSION',
  );

  const errors = checkHarnessReleaseVersionContract(inputs);
  assert.ok(errors.some((error) => error.includes('prefer HARNESS_DBOS_APPLICATION_VERSION')));
});

test('a deployment change that claims apps/core is rejected', async () => {
  const inputs = await currentInputs();
  inputs.deployWorkflow = `${inputs.deployWorkflow}\n# apps/core deployment\n`;

  const errors = checkHarnessReleaseVersionContract(inputs);
  assert.ok(errors.some((error) => error.includes('must not claim to deploy apps/core')));
});

test('software deploy version contract is not HarnessRelease artifact evidence', async () => {
  const source = await readFile(
    join(repositoryRoot, 'scripts/ci/assert-harness-release-version.mjs'),
    'utf8',
  );
  assert.ok(source.includes('This is NOT HarnessRelease evidence'));
  assert.ok(source.includes('HARNESS_DBOS_APPLICATION_VERSION'));
  assert.equal(source.includes('promptBindings'), false);
  assert.equal(source.includes('promptPackBindings'), false);
  assert.equal(source.includes('skillBindings'), false);
  assert.equal(source.includes('computeHarnessReleaseManifestHash'), false);
});
