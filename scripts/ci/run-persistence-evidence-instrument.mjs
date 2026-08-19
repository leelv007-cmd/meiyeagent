import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  persistenceEvidenceViolations,
  persistenceFileVerdict,
  verifiedPersistenceEvidence,
} from './persistence-evidence-instrument.mjs';
import { resolveCatalogEntries } from './journey-ownership-catalog.mjs';
import { runPostgresStatementSync } from '../dev/postgres-process.mjs';

const defaultCatalogPath = fileURLToPath(
  new URL('./journey-ownership-catalog.json', import.meta.url)
);
const DEFAULT_PERSISTENCE_FILE_TIMEOUT_MS = 5 * 60 * 1000;
const MIN_PERSISTENCE_FILE_TIMEOUT_MS = 1_000;
const MAX_PERSISTENCE_FILE_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_TEST_OUTPUT_BYTES = 128 * 1024 * 1024;
const ISSUE_255_SAFE_PROVISION_FILE =
  'apps/core/src/p1/harness/issue-255-safe-provision.postgres.test.ts';
const ISSUE_255_DATABASE_NAMES = Object.freeze([
  'meiye_issue255',
  'meiye_issue255_dbos',
]);
const SHARED_E2E_LOCK_PATH = '/tmp/meiye-e2e.lock';

export function parseTapCounts(output) {
  return {
    pass: tapSummaryCount(output, 'pass'),
    fail: tapSummaryCount(output, 'fail'),
    skip: tapSummaryCount(output, 'skipped'),
  };
}

export function sanitizeTestOutput(output, sensitiveValues = []) {
  const exactValues = new Set();
  const credentialFragments = new Set();
  for (const value of sensitiveValues.filter(Boolean)) {
    exactValues.add(value);
    try {
      const url = new URL(value);
      if (!['postgres:', 'postgresql:'].includes(url.protocol)) continue;
      for (const component of [
        url.username,
        url.password,
        url.pathname.slice(1),
      ]) {
        if (!component) continue;
        credentialFragments.add(component);
        credentialFragments.add(safeDecodeURIComponent(component));
      }
    } catch {
      // Non-URL values are still redacted exactly.
    }
  }
  const orderedExactValues = [...exactValues].sort(
    (left, right) => right.length - left.length
  );
  const orderedCredentialFragments = [...credentialFragments].sort(
    (left, right) => right.length - left.length
  );
  const sanitizeContent = (content) => {
    let sanitized = content.replace(
      /postgres(?:ql)?:\/\/[^\s"'`]+/giu,
      '[REDACTED_POSTGRES_URL]'
    );
    for (const value of orderedExactValues) {
      sanitized = sanitized.split(value).join('[REDACTED_POSTGRES_URL]');
    }
    for (const fragment of orderedCredentialFragments) {
      sanitized = redactStandaloneFragment(sanitized, fragment);
    }
    return sanitized;
  };
  return output
    .split(/(\r?\n)/u)
    .map((line) =>
      /^(?:\r?\n)$/u.test(line)
        ? line
        : sanitizeTapLine(line, sanitizeContent)
    )
    .join('');
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

export function persistenceFileTimeoutMs(rawValue) {
  if (rawValue === undefined || rawValue === '') {
    return DEFAULT_PERSISTENCE_FILE_TIMEOUT_MS;
  }
  const value = Number(rawValue);
  if (
    !Number.isInteger(value) ||
    value < MIN_PERSISTENCE_FILE_TIMEOUT_MS ||
    value > MAX_PERSISTENCE_FILE_TIMEOUT_MS
  ) {
    throw new Error(
      `PERSISTENCE_FILE_TIMEOUT_MS must be an integer between ${MIN_PERSISTENCE_FILE_TIMEOUT_MS} and ${MAX_PERSISTENCE_FILE_TIMEOUT_MS}.`
    );
  }
  return value;
}

export function issue255PersistenceSuitePlan({
  environment,
  file,
  repositoryRoot,
}) {
  if (file !== ISSUE_255_SAFE_PROVISION_FILE) return null;
  const adminUrl = requiredEnvironmentFrom(
    environment,
    'PERSISTENCE_POSTGRES_ADMIN_URL',
  );
  const [businessName, dbosName] = ISSUE_255_DATABASE_NAMES;
  const businessUrl = databaseUrl(adminUrl, businessName);
  const dbosUrl = databaseUrl(adminUrl, dbosName);
  const provisionerPath = path.resolve(
    repositoryRoot,
    'scripts/ci/issue-255-safe-provision.mjs',
  );
  return {
    adminUrl,
    databaseNames: [...ISSUE_255_DATABASE_NAMES],
    environment: {
      ...environment,
      ISSUE_255_SAFE_PROVISIONER_PATH: provisionerPath,
      RUN_ISSUE_255_SAFE_PROVISION_POSTGRES_TEST: '1',
      TEST_DATABASE_URL: businessUrl,
      TEST_DBOS_SYSTEM_DATABASE_URL: dbosUrl,
    },
    provisionerPath,
    sensitiveValues: [businessUrl, dbosUrl],
  };
}

export async function runIssue255PersistenceSuite(
  {
    environment,
    file,
    invocation,
    lockPath = SHARED_E2E_LOCK_PATH,
    repositoryRoot = process.cwd(),
    timeoutMs,
  },
  {
    inspectExistingDatabases = inspectIssue255Databases,
    runInvocation = runTestInvocation,
    runProvisioner = runIssue255Provisioner,
  } = {},
) {
  const plan = issue255PersistenceSuitePlan({
    environment,
    file,
    repositoryRoot,
  });
  if (!plan) {
    throw new Error('Issue 255 suite orchestration received another file.');
  }
  const lock = await acquireIssue255Lock(lockPath, repositoryRoot);
  try {
    const residue = inspectExistingDatabases(
      plan.adminUrl,
      plan.databaseNames,
    );
    if (residue.length > 0) {
      throw new Error(
        `Issue 255 isolated database residue exists: ${residue.join(', ')}.`,
      );
    }
    await runProvisioner(
      plan.provisionerPath,
      plan.environment,
      timeoutMs,
    );
    const result = await runInvocation(
      invocation,
      timeoutMs,
      plan.environment,
    );
    const residualAfterTest = inspectExistingDatabases(
      plan.adminUrl,
      plan.databaseNames,
    );
    if (residualAfterTest.length > 0) {
      throw new Error(
        `Issue 255 test did not drop its isolated databases: ${residualAfterTest.join(', ')}.`,
      );
    }
    return { result, sensitiveValues: plan.sensitiveValues };
  } finally {
    await releaseIssue255Lock(lock);
  }
}

async function main() {
  const [command, ...arguments_] = process.argv.slice(2);
  if (command !== 'run') {
    throw new Error(
      'Usage: node run-persistence-evidence-instrument.mjs run [--catalog path] --provision path --output-dir path'
    );
  }
  const catalogPath =
    optionalPath(arguments_, '--catalog') ?? defaultCatalogPath;
  const outputDir = requiredPath(arguments_, '--output-dir');
  const provisionPath = requiredPath(arguments_, '--provision');
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
  const fileTimeoutMs = persistenceFileTimeoutMs(
    process.env.PERSISTENCE_FILE_TIMEOUT_MS
  );
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
  const provision = JSON.parse(await readFile(provisionPath, 'utf8'));
  const provisionId = provision.provisionId;
  const businessName = decodeURIComponent(
    new URL(businessUrl).pathname.slice(1)
  );
  const dbosName = decodeURIComponent(new URL(dbosUrl).pathname.slice(1));
  if (
    provision.commitSha !== commitSha ||
    provision.provisioner !== 'provision-persistence-instrument/v1' ||
    provision.fresh !== true ||
    provision.databasePair?.business !== databasePair.business ||
    provision.databasePair?.dbosSystem !== databasePair.dbosSystem ||
    provision.databaseNames?.business !== businessName ||
    provision.databaseNames?.dbosSystem !== dbosName
  ) {
    throw new Error(
      'Provision receipt does not match this checked-out run and database pair.'
    );
  }
  const logDirectory = path.join(outputDir, 'files');
  await mkdir(logDirectory, { recursive: true });

  const files = [];
  for (const entry of entries) {
    const artifact = path.join(
      logDirectory,
      `${createHash('sha256').update(entry.path).digest('hex').slice(0, 12)}-${path.basename(entry.path)}.tap`
    );
    const invocation = testInvocation(entry.path);
    const execution =
      entry.path === ISSUE_255_SAFE_PROVISION_FILE
        ? await runIssue255PersistenceSuite({
            environment: process.env,
            file: entry.path,
            invocation,
            repositoryRoot: process.cwd(),
            timeoutMs: fileTimeoutMs,
          })
        : {
            result: await runTestInvocation(
              invocation,
              fileTimeoutMs,
              process.env,
            ),
            sensitiveValues: [businessUrl, dbosUrl],
          };
    const { result } = execution;
    const rawOutput = result.timedOut
      ? persistenceTimeoutTap(entry.path, fileTimeoutMs)
      : result.outputLimitExceeded
        ? persistenceOutputLimitTap(entry.path)
        : `${result.stdout ?? ''}${result.stderr ?? ''}`;
    const output =
      result.timedOut || result.outputLimitExceeded
        ? rawOutput
        : sanitizeTestOutput(rawOutput, execution.sensitiveValues);
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

function runTestInvocation(invocation, timeoutMs, environment = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.arguments, {
      cwd: process.cwd(),
      detached: true,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let timedOut = false;
    let outputLimitExceeded = false;
    let terminationPromise;
    const terminate = () => {
      if (!child.pid) return Promise.resolve();
      terminationPromise ??= terminateProcessGroup(child.pid);
      return terminationPromise;
    };
    const capture = (target) => (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_TEST_OUTPUT_BYTES && !outputLimitExceeded) {
        outputLimitExceeded = true;
        void terminate();
        return;
      }
      if (!outputLimitExceeded) target.push(chunk);
    };
    child.stdout.on('data', capture(stdout));
    child.stderr.on('data', capture(stderr));
    child.once('error', reject);
    const timeout = setTimeout(() => {
      timedOut = true;
      void terminate();
    }, timeoutMs);
    child.once('close', async (status, signal) => {
      clearTimeout(timeout);
      try {
        await terminationPromise;
      } catch (error) {
        reject(error);
        return;
      }
      resolve({
        status: timedOut || outputLimitExceeded ? 1 : status,
        signal,
        timedOut,
        outputLimitExceeded,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
  });
}

async function runIssue255Provisioner(
  provisionerPath,
  environment,
  timeoutMs,
) {
  const result = await runTestInvocation(
    { command: process.execPath, arguments: [provisionerPath] },
    timeoutMs,
    environment,
  );
  if (
    result.timedOut ||
    result.outputLimitExceeded ||
    (result.status ?? 1) !== 0
  ) {
    throw new Error('Issue 255 isolated database provisioning failed.');
  }
}

function inspectIssue255Databases(adminUrl, databaseNames) {
  const adminDatabaseUrl = databaseUrl(adminUrl, 'postgres');
  const result = runPostgresStatementSync(
    adminDatabaseUrl,
    `SELECT datname
       FROM pg_database
      WHERE datname IN ('${databaseNames[0]}', '${databaseNames[1]}')
      ORDER BY datname;\n`,
  );
  if (result.status !== 0) {
    throw new Error('Unable to inspect Issue 255 isolated databases.');
  }
  return result.stdout.split(/\r?\n/u).filter(Boolean);
}

async function acquireIssue255Lock(lockPath, repositoryRoot) {
  const contents =
    `pid ${process.pid} in ${repositoryRoot} persistence issue-255 suite\n`;
  let handle;
  try {
    handle = await open(lockPath, 'wx', 0o600);
    await handle.writeFile(contents);
  } catch (error) {
    await handle?.close();
    if (error?.code === 'EEXIST') {
      throw new Error(
        'Issue 255 shared e2e lock is already present; refusing mutation.',
      );
    }
    throw error;
  }
  await handle.close();
  return { contents, lockPath };
}

async function releaseIssue255Lock({ contents, lockPath }) {
  let currentContents;
  try {
    currentContents = await readFile(lockPath, 'utf8');
  } catch (error) {
    throw new Error(
      `Issue 255 shared e2e lock disappeared before release: ${error?.code ?? 'unknown'}.`,
    );
  }
  if (currentContents !== contents) {
    throw new Error(
      'Issue 255 shared e2e lock ownership changed; refusing unlink.',
    );
  }
  await unlink(lockPath);
}

function databaseUrl(rawUrl, databaseName) {
  const url = new URL(rawUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('Persistence admin URL must use PostgreSQL.');
  }
  url.pathname = `/${databaseName}`;
  url.searchParams.delete('application_name');
  return url.toString();
}

function requiredEnvironmentFrom(environment, name) {
  const value = environment[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function terminateProcessGroup(processGroupId) {
  signalProcessGroup(processGroupId, 'SIGTERM');
  await delay(250);
  if (processGroupIsAlive(processGroupId)) {
    signalProcessGroup(processGroupId, 'SIGKILL');
  }
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (!processGroupIsAlive(processGroupId)) return;
    await delay(25);
  }
  throw new Error(
    `Persistence test process group ${processGroupId} survived SIGKILL.`
  );
}

function signalProcessGroup(processGroupId, signal) {
  try {
    process.kill(-processGroupId, signal);
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

function processGroupIsAlive(processGroupId) {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function persistenceTimeoutTap(file, timeoutMs) {
  return `TAP version 13
not ok 1 - persistence file timed out after ${timeoutMs} ms
  ---
  error: "Persistence instrument file timeout"
  file: ${JSON.stringify(file)}
  timeout_ms: ${timeoutMs}
  ...
1..1
# tests 1
# pass 0
# fail 1
# skipped 0
`;
}

function persistenceOutputLimitTap(file) {
  return `TAP version 13
not ok 1 - persistence file output exceeded ${MAX_TEST_OUTPUT_BYTES} bytes
  ---
  error: "Persistence instrument file output limit"
  file: ${JSON.stringify(file)}
  output_limit_bytes: ${MAX_TEST_OUTPUT_BYTES}
  ...
1..1
# tests 1
# pass 0
# fail 1
# skipped 0
`;
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function redactStandaloneFragment(output, fragment) {
  const escaped = fragment.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return output.replace(
    new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'gu'),
    '[REDACTED_POSTGRES_CREDENTIAL]'
  );
}

function sanitizeTapLine(line, sanitizeContent) {
  if (
    /^\s*(?:TAP version \d+|# (?:tests|suites|pass|fail|cancelled|skipped|todo) \d+|# duration_ms \d+(?:\.\d+)?|---|\.\.\.)\s*$/u.test(
      line,
    )
  ) {
    return line;
  }
  const structuredLine =
    /^(\s*\d+\.\.\d+)(.*)$/u.exec(line) ??
    /^(\s*Bail out!)(.*)$/u.exec(line) ??
    /^(\s*# Subtest:\s*)(.*)$/u.exec(line) ??
    /^(\s*(?:not )?ok\b(?:\s+\d+)?(?:\s*-\s*)?)(.*)$/u.exec(line) ??
    /^(\s+[A-Za-z_][A-Za-z0-9_-]*:\s*)(.*)$/u.exec(line);
  return structuredLine
    ? `${structuredLine[1]}${sanitizeTapPayload(structuredLine[2], sanitizeContent)}`
    : sanitizeContent(line);
}

function sanitizeTapPayload(payload, sanitizeContent) {
  const directive = /^(.*?)(\s+#\s*)((?:SKIP|TODO)\b)(.*)$/iu.exec(
    payload,
  );
  return directive
    ? `${sanitizeContent(directive[1])}${directive[2]}${directive[3]}${sanitizeContent(directive[4])}`
    : sanitizeContent(payload);
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
