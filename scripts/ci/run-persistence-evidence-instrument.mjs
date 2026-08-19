import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  persistenceEvidenceViolations,
  persistenceFileVerdict,
  verifiedPersistenceEvidence,
} from './persistence-evidence-instrument.mjs';
import { resolveCatalogEntries } from './journey-ownership-catalog.mjs';

const defaultCatalogPath = fileURLToPath(
  new URL('./journey-ownership-catalog.json', import.meta.url)
);

export function parseTapCounts(output) {
  return {
    pass: tapSummaryCount(output, 'pass'),
    fail: tapSummaryCount(output, 'fail'),
    skip: tapSummaryCount(output, 'skipped'),
  };
}

export function databaseFingerprint(rawUrl) {
  const url = new URL(rawUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error(
      'Persistence instrument database URLs must use PostgreSQL.'
    );
  }
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (!databaseName || databaseName.includes('/')) {
    throw new Error(
      'Persistence instrument database URLs must name one database.'
    );
  }
  const identity = `${url.protocol}//${url.hostname}:${url.port || '5432'}/${databaseName}`;
  return createHash('sha256').update(identity).digest('hex');
}

async function main() {
  const [command, ...arguments_] = process.argv.slice(2);
  if (command !== 'run') {
    throw new Error(
      'Usage: node run-persistence-evidence-instrument.mjs run [--catalog path] --output-dir path'
    );
  }
  const catalogPath =
    optionalPath(arguments_, '--catalog') ?? defaultCatalogPath;
  const outputDir = requiredPath(arguments_, '--output-dir');
  const commitSha = requiredEnvironment('RELEASE_COMMIT_SHA');
  const checkoutSha = execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  if (checkoutSha !== commitSha) {
    throw new Error(
      `RELEASE_COMMIT_SHA ${commitSha} does not match checked-out HEAD ${checkoutSha}.`
    );
  }
  const businessUrl = requiredEnvironment('TEST_DATABASE_URL');
  const dbosUrl = requiredEnvironment('TEST_DBOS_SYSTEM_DATABASE_URL');
  if (process.env.PERSISTENCE_DATABASES_FRESH !== 'true') {
    throw new Error(
      'PERSISTENCE_DATABASES_FRESH=true is required after provisioning a fresh isolated pair.'
    );
  }
  const databasePair = {
    business: databaseFingerprint(businessUrl),
    dbosSystem: databaseFingerprint(dbosUrl),
  };
  if (databasePair.business === databasePair.dbosSystem) {
    throw new Error(
      'Business and DBOS system storage must be separate databases.'
    );
  }

  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
  const entries = resolveCatalogEntries(catalog).filter(
    (entry) => entry.kind === 'persistence'
  );
  const provisionId = process.env.PERSISTENCE_PROVISION_ID ?? randomUUID();
  const provision = {
    schemaVersion: 'persistence-provision/v1',
    commitSha,
    provisionId,
    fresh: true,
    provisionedAt: new Date().toISOString(),
    databasePair,
  };
  const logDirectory = path.join(outputDir, 'files');
  await mkdir(logDirectory, { recursive: true });
  await writeFile(
    path.join(outputDir, 'provision.json'),
    `${JSON.stringify(provision, null, 2)}\n`
  );

  const files = [];
  for (const entry of entries) {
    const artifact = path.join(
      logDirectory,
      `${createHash('sha256').update(entry.path).digest('hex').slice(0, 12)}-${path.basename(entry.path)}.tap`
    );
    const invocation = testInvocation(entry.path);
    const result = spawnSync(invocation.command, invocation.arguments, {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: process.env,
      maxBuffer: 128 * 1024 * 1024,
    });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    await writeFile(artifact, output);
    const counts = parseTapCounts(output);
    if ((result.status ?? 1) !== 0 && counts.fail === 0) counts.fail = 1;
    files.push({
      path: entry.path,
      commitSha,
      provisionId,
      databasePair,
      counts,
      verdict: persistenceFileVerdict(counts),
      artifact: path.relative(process.cwd(), artifact),
    });
  }

  const results = {
    schemaVersion: 'persistence-results/v1',
    commitSha,
    provisionId,
    files,
  };
  await writeFile(
    path.join(outputDir, 'results.json'),
    `${JSON.stringify(results, null, 2)}\n`
  );
  const violations = persistenceEvidenceViolations({
    catalog,
    provision,
    results,
    expectedSha: commitSha,
  });
  const evidence = {
    ...(violations.length === 0
      ? verifiedPersistenceEvidence({ catalog, provision, results })
      : {
          schemaVersion: 'persistence-evidence/v1',
          commitSha,
          provisionId,
          decision: 'instrument',
          releaseVerdict: null,
          verdict: 'fail',
          violations,
          files,
        }),
  };
  await writeFile(
    path.join(outputDir, 'evidence.json'),
    `${JSON.stringify(evidence, null, 2)}\n`
  );
  if (violations.length > 0) {
    throw new Error(
      `Persistence evidence is invalid:\n- ${violations.join('\n- ')}`
    );
  }
  process.stdout.write(
    `Persistence instrument passed: ${evidence.summary.files} files, ${evidence.summary.pass} tests.\n`
  );
}

function testInvocation(file) {
  const corePrefix = 'apps/core/';
  const webPrefix = 'mkfast-template-main/';
  const common = [
    'exec',
    'node',
    '--import',
    'tsx',
    '--test',
    '--test-concurrency=1',
    '--test-reporter=tap',
  ];
  if (file.startsWith(corePrefix)) {
    return {
      command: 'pnpm',
      arguments: [
        '--filter',
        '@meiye/core',
        ...common,
        file.slice(corePrefix.length),
      ],
    };
  }
  if (file.startsWith(webPrefix)) {
    return {
      command: 'pnpm',
      arguments: [
        '--filter',
        '@meiye/web',
        ...common,
        file.slice(webPrefix.length),
      ],
    };
  }
  throw new Error(`Unsupported persistence suite location: ${file}`);
}

function tapSummaryCount(output, label) {
  const matches = [
    ...output.matchAll(new RegExp(`^# ${label} (\\d+)\\s*$`, 'gmu')),
  ];
  return matches.length === 0 ? 0 : Number(matches.at(-1)[1]);
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requiredPath(arguments_, name) {
  const value = argumentValue(arguments_, name);
  if (!value) throw new Error(`${name} requires a value`);
  return path.resolve(value);
}

function optionalPath(arguments_, name) {
  const value = argumentValue(arguments_, name);
  return value ? path.resolve(value) : undefined;
}

function argumentValue(arguments_, name) {
  const index = arguments_.indexOf(name);
  if (index === -1) return undefined;
  const value = arguments_[index + 1];
  if (!value || value.startsWith('--'))
    throw new Error(`${name} requires a value`);
  return value;
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
