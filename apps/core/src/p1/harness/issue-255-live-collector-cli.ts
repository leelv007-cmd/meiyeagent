import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Pool } from 'pg';

import { PostgresFoundationRepository } from '../foundation/postgres-repository.js';
import { ProviderSafeFetch } from '../model-supply/reference-asset-delivery.js';
import { modelRuntimeAssemblyFromEnv } from '../model-supply/runtime-config.js';
import {
  assertIssue255PositiveFrozenPrice,
  collectIssue255LiveAnchors,
  issue255DirectCopyExecutor,
  issue255TuziExecutor,
  issue255VideoQuote,
  recoverIssue255LiveManifest,
} from './issue-255-live-collector.js';
import { reconcileIssue255LiveRun } from './issue-255-live-reconciliation.js';
import { PostgresIssue255LiveReceiptRepository } from './issue-255-postgres-live-receipt.js';

export function assertIssue255LiveModesMutuallyExclusive(
  env: NodeJS.ProcessEnv,
) {
  if (
    env.RUN_LIVE_ISSUE_255 === '1' &&
    env.RUN_LIVE_TUZI_CANCELLATION_TEST === '1'
  ) {
    throw new Error(
      'Issue 255 live collector and Tuzi cancellation mode are mutually exclusive.',
    );
  }
}

export function assertIssue255LiveCollectorLaunch(
  env: NodeJS.ProcessEnv,
  sharedLockHeld = isIssue255SharedE2eLockHeld,
) {
  assertIssue255LiveModesMutuallyExclusive(env);
  if (env.RUN_LIVE_ISSUE_255 !== '1') {
    throw new Error(
      'Issue 255 live collector remains disabled until RUN_LIVE_ISSUE_255=1 is explicitly authorized.',
    );
  }
  if (
    env.MODEL_EXECUTION_MODE !== 'direct' ||
    env.MODEL_MEDIA_EXECUTION_MODE !== 'tuzi'
  ) {
    throw new Error(
      'Issue 255 live collector requires fixed direct copy and Tuzi media modes.',
    );
  }
  const providerCap = Number(env.PROVIDER_LIVE_COST_CAP_CNY);
  const providerCapMicros = Math.floor(providerCap * 1_000_000);
  if (
    !Number.isFinite(providerCap) ||
    providerCap <= 0 ||
    providerCap > 5 ||
    !Number.isSafeInteger(providerCapMicros) ||
    providerCapMicros <= 0
  ) {
    throw new Error(
      'Issue 255 live collector requires the existing provider cap at or below CNY 5.',
    );
  }
  if (!sharedLockHeld()) {
    throw new Error(
      'Issue 255 live collector requires the shared e2e lock.',
    );
  }
  return { providerCapMicros };
}

export function isIssue255SharedE2eLockHeld() {
  let owner: string;
  try {
    owner = readFileSync('/tmp/meiye-e2e.lock', 'utf8');
  } catch {
    return false;
  }
  const match = /^pid ([1-9]\d*) in /u.exec(owner.trim());
  if (!match) {
    return false;
  }
  const ownerPid = Number(match[1]);
  let candidatePid = process.pid;
  for (let depth = 0; depth < 32; depth += 1) {
    if (candidatePid === ownerPid) {
      return true;
    }
    const result = spawnSync(
      'ps',
      ['-o', 'ppid=', '-p', String(candidatePid)],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    if (result.error || result.status !== 0) {
      return false;
    }
    const parentPid = Number(result.stdout.trim());
    if (
      !Number.isSafeInteger(parentPid) ||
      parentPid <= 0 ||
      parentPid === candidatePid
    ) {
      return false;
    }
    candidatePid = parentPid;
  }
  return false;
}

export function preflightIssue255LiveRuntime(env: NodeJS.ProcessEnv) {
  const estimatedTokensPerSecond = positiveInteger(
    env.TUZI_SEEDANCE_ESTIMATED_TOKENS_PER_SECOND,
    'video estimated tokens per second',
  );
  const assembly = modelRuntimeAssemblyFromEnv(env);
  const direct = assembly.runtime.direct;
  const tuzi = assembly.runtime.tuziMedia;
  if (!direct || !tuzi) {
    throw new Error(
      'Issue 255 live collector could not resolve the fixed direct and Tuzi runtimes.',
    );
  }
  const directDeployment = deploymentFor(
    assembly.deployments,
    direct.catalogModelId,
    '-direct',
  );
  const imageDeployment = deploymentFor(
    assembly.deployments,
    tuzi.image.catalogModelId,
    '-tuzi-relay',
  );
  const videoDeployment = deploymentFor(
    assembly.deployments,
    tuzi.video.catalogModelId,
    '-tuzi-relay',
  );
  const positivePrice = (value: string | undefined, label: string) =>
    assertIssue255PositiveFrozenPrice(
      requiredDeploymentText(value, label),
      label,
    );

  const frozenPrices = {
    directInputCostPerMillionCny: positivePrice(
      env.MODEL_DIRECT_INPUT_COST_PER_MILLION,
      'direct input frozen price',
    ),
    directOutputCostPerMillionCny: positivePrice(
      env.MODEL_DIRECT_OUTPUT_COST_PER_MILLION,
      'direct output frozen price',
    ),
    imageCostCny: positivePrice(
      env.TUZI_GPT_IMAGE_2_COST_PER_IMAGE_CNY,
      'Tuzi image frozen price',
    ),
    videoCostPerMillionTokensCny: positivePrice(
      env.TUZI_SEEDANCE_COST_PER_MILLION_TOKENS_CNY,
      'Tuzi video frozen price',
    ),
  };
  const videoQuote = issue255VideoQuote({
    estimatedTokensPerSecond,
    frozenPriceCny: frozenPrices.videoCostPerMillionTokensCny,
  });

  return {
    assembly,
    direct,
    directDeployment,
    frozenPrices,
    imageDeployment,
    tuzi,
    videoQuote,
    videoDeployment,
  };
}

function positiveInteger(value: string | undefined, label: string) {
  if (!value || !/^[1-9]\d*$/u.test(value)) {
    throw new Error(`Issue 255 ${label} must be a positive integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Issue 255 ${label} must be a positive integer.`);
  }
  return parsed;
}

export async function runIssue255LiveCollectorCli(input: {
  argv: readonly string[];
  env: NodeJS.ProcessEnv;
}) {
  const launch = assertIssue255LiveCollectorLaunch(input.env);
  const [recordedSamplesPath, manifestPath, runNonce] = input.argv;
  if (!recordedSamplesPath || !manifestPath || !runNonce?.trim()) {
    throw new Error(
      'Usage: issue-255-live-collector <recorded-samples.json> <manifest.json> <run-nonce>',
    );
  }
  const preflight = preflightIssue255LiveRuntime(input.env);
  const businessUrl = isolatedDatabaseUrl(
    input.env.TEST_DATABASE_URL,
    'meiye_issue255',
  );
  const dbosUrl = isolatedDatabaseUrl(
    input.env.TEST_DBOS_SYSTEM_DATABASE_URL,
    'meiye_issue255_dbos',
  );
  const {
    assembly,
    direct,
    directDeployment,
    frozenPrices,
    imageDeployment,
    tuzi,
    videoDeployment,
  } = preflight;
  const assetFetch = new ProviderSafeFetch({
    allowedHosts: [
      new URL(tuzi.baseUrl).hostname,
      ...(tuzi.assetSourceHosts ?? []),
    ],
    maxRedirects: 0,
  });
  const countedTuzi = { ...tuzi, assetFetch };
  const business = new Pool({
    connectionString: businessUrl,
    max: 4,
  });
  const dbos = new Pool({ connectionString: dbosUrl, max: 1 });
  try {
    await dbos.query('SELECT 1');
    const foundation = new PostgresFoundationRepository(business);
    const receipts = new PostgresIssue255LiveReceiptRepository(business);
    await foundation.migrate();
    await receipts.migrate();
    const recordedSamples = JSON.parse(
      await readFile(resolve(recordedSamplesPath), 'utf8'),
    ) as unknown;
    return await collectIssue255LiveAnchors({
      database: business,
      executors: [
        issue255DirectCopyExecutor({
          configurationRevision: configurationRevision(
            assembly.configurationRevisions,
            directDeployment.id,
          ),
          credentialRevision: requiredDeploymentText(
            directDeployment.credentialVersion,
            'direct credential revision',
          ),
          deploymentId: directDeployment.id,
          frozenPrices: {
            inputCostPerMillionCny:
              frozenPrices.directInputCostPerMillionCny,
            outputCostPerMillionCny:
              frozenPrices.directOutputCostPerMillionCny,
          },
          options: direct,
          priceRevision: requiredDeploymentText(
            directDeployment.priceRevision,
            'direct price revision',
          ),
          receipts,
        }),
        issue255TuziExecutor({
          configurationRevision: configurationRevision(
            assembly.configurationRevisions,
            imageDeployment.id,
          ),
          credentialRevision: requiredDeploymentText(
            imageDeployment.credentialVersion,
            'Tuzi image credential revision',
          ),
          deploymentId: imageDeployment.id,
          frozenPriceCny: frozenPrices.imageCostCny,
          modality: 'image_text',
          options: countedTuzi,
          priceRevision: requiredDeploymentText(
            imageDeployment.priceRevision,
            'Tuzi image price revision',
          ),
          receipts,
        }),
        issue255TuziExecutor({
          configurationRevision: configurationRevision(
            assembly.configurationRevisions,
            videoDeployment.id,
          ),
          credentialRevision: requiredDeploymentText(
            videoDeployment.credentialVersion,
            'Tuzi video credential revision',
          ),
          deploymentId: videoDeployment.id,
          frozenPriceCny: frozenPrices.videoCostPerMillionTokensCny,
          modality: 'video',
          options: countedTuzi,
          priceRevision: requiredDeploymentText(
            videoDeployment.priceRevision,
            'Tuzi video price revision',
          ),
          receipts,
        }),
      ],
      foundation,
      manifestPath: resolve(manifestPath),
      providerCapMicros: launch.providerCapMicros,
      recordedSamples,
      receipts,
      runNonce,
    });
  } finally {
    await Promise.all([business.end(), dbos.end()]);
  }
}

export async function runIssue255LiveReconciliationCli(input: {
  argv: readonly string[];
  env: NodeJS.ProcessEnv;
}) {
  if (input.env.RUN_ISSUE_255_RECONCILIATION !== '1') {
    throw new Error(
      'Issue 255 reconciliation remains disabled without explicit recovery authorization.',
    );
  }
  const [runNonce] = input.argv;
  if (!runNonce?.trim()) {
    throw new Error(
      'Usage: issue-255-live-reconciliation <run-nonce>',
    );
  }
  const business = new Pool({
    connectionString: isolatedDatabaseUrl(
      input.env.TEST_DATABASE_URL,
      'meiye_issue255',
    ),
    max: 2,
  });
  try {
    const foundation = new PostgresFoundationRepository(business);
    const receipts = new PostgresIssue255LiveReceiptRepository(business);
    await foundation.migrate();
    await receipts.migrate();
    return await reconcileIssue255LiveRun({
      foundation,
      receipts,
      runNonce,
    });
  } finally {
    await business.end();
  }
}

export async function runIssue255LiveManifestRecoveryCli(input: {
  argv: readonly string[];
  env: NodeJS.ProcessEnv;
}) {
  if (input.env.RUN_ISSUE_255_MANIFEST_RECOVERY !== '1') {
    throw new Error(
      'Issue 255 manifest recovery remains disabled without explicit recovery authorization.',
    );
  }
  const [manifestPath] = input.argv;
  if (!manifestPath) {
    throw new Error(
      'Usage: issue-255-live-manifest-recovery <manifest.json>',
    );
  }
  const business = new Pool({
    connectionString: isolatedDatabaseUrl(
      input.env.TEST_DATABASE_URL,
      'meiye_issue255',
    ),
    max: 1,
  });
  try {
    const receipts = new PostgresIssue255LiveReceiptRepository(business);
    await receipts.migrate();
    return await recoverIssue255LiveManifest({
      database: business,
      manifestPath: resolve(manifestPath),
    });
  } finally {
    await business.end();
  }
}

function isolatedDatabaseUrl(
  value: string | undefined,
  expectedDatabase: string,
) {
  if (!value) {
    throw new Error(
      `Issue 255 live collector requires the isolated ${expectedDatabase} database.`,
    );
  }
  const parsed = new URL(value);
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    decodeURIComponent(parsed.pathname.slice(1)) !== expectedDatabase
  ) {
    throw new Error(
      `Issue 255 live collector refuses a database other than ${expectedDatabase}.`,
    );
  }
  return parsed.toString();
}

function deploymentFor(
  deployments: ReturnType<
    typeof modelRuntimeAssemblyFromEnv
  >['deployments'],
  catalogModelId: string,
  suffix: string,
) {
  const deployment = deployments.find(
    (candidate) =>
      candidate.catalogModelId === catalogModelId &&
      candidate.id.endsWith(suffix),
  );
  if (!deployment) {
    throw new Error(
      'Issue 255 live collector could not freeze its approved deployment.',
    );
  }
  return deployment;
}

function configurationRevision(
  revisions: Readonly<Record<string, string>>,
  deploymentId: string,
) {
  return requiredDeploymentText(
    revisions[deploymentId],
    'configuration revision',
  );
}

function requiredDeploymentText(
  value: string | undefined,
  label: string,
) {
  if (!value?.trim()) {
    throw new Error(`Issue 255 live collector requires ${label}.`);
  }
  return value;
}
