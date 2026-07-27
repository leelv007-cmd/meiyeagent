import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const applicationVersionVariable = 'HARNESS_DBOS_APPLICATION_VERSION';

export function checkHarnessReleaseVersionContract({
  coreQualityWorkflow,
  deployWorkflow,
  runtimeConfig,
}) {
  const errors = [];

  if (
    !/^env:\n {2}HARNESS_DBOS_APPLICATION_VERSION: quality-\$\{\{\s*github\.sha\s*\}\}/mu.test(
      coreQualityWorkflow,
    )
  ) {
    errors.push(
      'Core quality must set HARNESS_DBOS_APPLICATION_VERSION to quality-${{ github.sha }} at workflow scope.',
    );
  }

  if (
    !coreQualityWorkflow.includes(
      'run: node scripts/ci/assert-harness-release-version.mjs',
    )
  ) {
    errors.push('Core quality must execute the Harness release-version check.');
  }

  if (
    !deployWorkflow.includes(
      'run: node scripts/ci/assert-harness-release-version.mjs',
    )
  ) {
    errors.push('The deployment workflow must re-check the Harness release-version contract.');
  }

  if (
    !runtimeConfig.includes(
      'env.HARNESS_DBOS_APPLICATION_VERSION ?? env.DBOS__APPVERSION',
    )
  ) {
    errors.push(
      'Harness runtime config must prefer HARNESS_DBOS_APPLICATION_VERSION and retain the legacy DBOS__APPVERSION fallback.',
    );
  }

  if (!runtimeConfig.includes('...(applicationVersion ? { applicationVersion } : {})')) {
    errors.push('Harness runtime config must pass the resolved application version to DBOS.');
  }

  if (
    !deployWorkflow.startsWith('# Web (Cloudflare Worker) deployment.') ||
    !deployWorkflow.includes('name: Deploy to Cloudflare Workers')
  ) {
    errors.push('The current deployment workflow must remain explicitly Web-only.');
  }

  if (
    /apps\/core|pnpm --filter @meiye\/core|start:worker/u.test(deployWorkflow)
  ) {
    errors.push('The Web deployment workflow must not claim to deploy apps/core.');
  }

  return errors;
}

async function readContractInputs(root = repositoryRoot) {
  const workflowsDirectory = join(root, '.github/workflows');
  return {
    coreQualityWorkflow: await readFile(
      join(workflowsDirectory, 'core-quality.yml'),
      'utf8',
    ),
    deployWorkflow: await readFile(
      join(workflowsDirectory, 'deploy.yml'),
      'utf8',
    ),
    runtimeConfig: await readFile(
      join(root, 'apps/core/src/p1/harness/runtime-config.ts'),
      'utf8',
    ),
  };
}

export async function assertHarnessReleaseVersionContract(root = repositoryRoot) {
  const inputs = await readContractInputs(root);
  const errors = checkHarnessReleaseVersionContract(inputs);
  return { errors };
}

if (import.meta.main) {
  const { errors } = await assertHarnessReleaseVersionContract();
  if (errors.length > 0) {
    console.error('Harness release-version contract failed (fail closed):');
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log(
      `${applicationVersionVariable} is set and verified by the quality and deployment workflows.`,
    );
  }
}
