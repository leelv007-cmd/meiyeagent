import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
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
const DEFAULT_PERSISTENCE_FILE_TIMEOUT_MS = 5 * 60 * 1000;
const MIN_PERSISTENCE_FILE_TIMEOUT_MS = 1_000;
const MAX_PERSISTENCE_FILE_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_TEST_OUTPUT_BYTES = 128 * 1024 * 1024;

export function parseTapCounts(output) {
  return {
    pass: tapSummaryCount(output, 'pass'),
    fail: tapSummaryCount(output, 'fail'),
    skip: tapSummaryCount(output, 'skipped'),
  };
}

export function sanitizeTestOutput(output, sensitiveValues = []) {
  let sanitized = output.replace(
    /postgres(?:ql)?:\/\/[^\s"'`]+/giu,
    '[REDACTED_POSTGRES_URL]'
  );
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
  for (const value of [...exactValues].sort(
    (left, right) => right.length - left.length
  )) {
    sanitized = sanitized.split(value).join('[REDACTED_POSTGRES_URL]');
  }
  for (const fragment of [...credentialFragments].sort(
    (left, right) => right.length - left.length
  )) {
    sanitized = redactStandaloneFragment(sanitized, fragment);
  }
  return sanitized;
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
    const result = await runTestInvocation(invocation, fileTimeoutMs);
    const rawOutput = result.timedOut
      ? persistenceTimeoutTap(entry.path, fileTimeoutMs)
      : result.outputLimitExceeded
        ? persistenceOutputLimitTap(entry.path)
        : `${result.stdout ?? ''}${result.stderr ?? ''}`;
    const output = sanitizeTestOutput(
      rawOutput,
      [businessUrl, dbosUrl]
    );
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

function runTestInvocation(invocation, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.arguments, {
      cwd: process.cwd(),
      detached: true,
      env: process.env,
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
