import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  persistenceEvidenceViolations,
  persistenceFileVerdict,
  selectPersistenceEntries,
} from './persistence-evidence-instrument.mjs';

const DEFAULT_CATALOG_PATH = 'scripts/ci/journey-ownership-catalog.json';
const DEFAULT_LEDGER_PATH = 'docs/ops/opt-in-test-evidence.json';

/**
 * Converts the transient, per-file output from the persistence runner into a
 * small committed receipt and updates only the matching ledger records.
 *
 * The runner's output directory is intentionally ignored: TAP can be large,
 * and it is useful only while diagnosing a run. This receipt binds that
 * redacted output to the exact SHA, fresh pair fingerprints, per-file counts,
 * and artifact digests without copying a database URL or a test log into Git.
 */
export async function recordCalibration({
  artifactDigest,
  catalog,
  expectedSha,
  ledger,
  provision,
  receiptPath,
  results,
}) {
  if (!/^[a-f0-9]{40}$/u.test(expectedSha)) {
    throw new Error(
      'A calibration receipt requires a 40-character checked-out SHA.'
    );
  }
  if (typeof receiptPath !== 'string' || receiptPath.length === 0) {
    throw new Error(
      'A calibration receipt requires a repository-relative path.'
    );
  }
  const selectedPaths = results?.files?.map((file) => file?.path);
  const violations = persistenceEvidenceViolations({
    catalog,
    provision,
    results,
    expectedSha,
    paths: selectedPaths,
  });
  if (violations.length > 0) {
    throw new Error(
      `Cannot record invalid persistence evidence:\n- ${violations.join('\n- ')}`
    );
  }

  const entriesByPath = new Map(
    selectPersistenceEntries(catalog, selectedPaths).map((entry) => [
      entry.path,
      entry,
    ])
  );
  const updatedLedger = structuredClone(ledger);
  if (!updatedLedger?.suites || typeof updatedLedger.suites !== 'object') {
    throw new Error('The opt-in evidence ledger requires a suites object.');
  }

  const receiptFiles = [];
  for (const file of results.files) {
    const existing = updatedLedger.suites[file.path];
    if (!existing) {
      throw new Error(
        `Cannot record ${file.path}: missing canonical ledger entry.`
      );
    }
    const entry = entriesByPath.get(file.path);
    const sha256 = await artifactDigest(file.artifact);
    if (!/^[a-f0-9]{64}$/u.test(sha256)) {
      throw new Error(
        `Cannot record ${file.path}: artifact does not have a SHA-256 digest.`
      );
    }
    const artifact = { path: file.artifact, sha256 };
    receiptFiles.push({
      path: file.path,
      owner: entry.owner,
      tier: entry.tier,
      env: entry.env,
      currentDecision: entry.currentDecision,
      ...(entry.ticket ? { ticket: entry.ticket } : {}),
      provisionId: file.provisionId,
      databasePair: file.databasePair,
      ...(file.provisionReceipt
        ? { provisionReceipt: redactedProvision(file.provisionReceipt) }
        : {}),
      counts: file.counts,
      verdict: persistenceFileVerdict(file.counts),
      artifact,
    });
    updatedLedger.suites[file.path] = {
      status: 'green',
      verifiedAt: expectedSha,
      ...(existing.ticket ? { ticket: existing.ticket } : {}),
      receipt: receiptPath,
      note: `Verified by redacted same-SHA persistence receipt ${receiptPath}: ${file.counts.pass} pass, 0 fail, 0 skip.`,
    };
  }

  return {
    ledger: updatedLedger,
    receipt: {
      schemaVersion: 'opt-in-persistence-calibration/v1',
      commitSha: expectedSha,
      calibratedAt: provision.provisionedAt,
      mainProvision: redactedProvision(provision),
      summary: receiptFiles.reduce(
        (summary, file) => ({
          files: summary.files + 1,
          pass: summary.pass + file.counts.pass,
          fail: summary.fail + file.counts.fail,
          skip: summary.skip + file.counts.skip,
        }),
        { files: 0, pass: 0, fail: 0, skip: 0 }
      ),
      files: receiptFiles,
    },
  };
}

function redactedProvision(provision) {
  return {
    schemaVersion: provision.schemaVersion,
    provisioner: provision.provisioner,
    commitSha: provision.commitSha,
    provisionId: provision.provisionId,
    fresh: provision.fresh,
    provisionedAt: provision.provisionedAt,
    databasePair: provision.databasePair,
    databaseNames: provision.databaseNames,
    ...(provision.selfDropped === true ? { selfDropped: true } : {}),
    ...(provision.dropVerifiedAt
      ? { dropVerifiedAt: provision.dropVerifiedAt }
      : {}),
  };
}

async function artifactDigestFromRepository(cwd, artifactPath) {
  if (typeof artifactPath !== 'string' || artifactPath.length === 0) {
    throw new Error('Persistence evidence requires a per-file artifact path.');
  }
  if (!artifactPath.startsWith('output/ci/')) {
    throw new Error(
      `Persistence artifact must be written under output/ci: ${artifactPath}.`
    );
  }
  const resolved = path.resolve(cwd, artifactPath);
  const relative = path.relative(cwd, resolved);
  if (
    !relative ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(
      `Persistence artifact escapes the repository: ${artifactPath}.`
    );
  }
  const content = await readFile(resolved);
  return createHash('sha256').update(content).digest('hex');
}

async function main(cwd = process.cwd(), arguments_ = process.argv.slice(2)) {
  const options = parseOptions(arguments_);
  const checkoutSha = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd,
    encoding: 'utf8',
  }).trim();
  const catalogPath = path.resolve(
    cwd,
    options.catalog ?? DEFAULT_CATALOG_PATH
  );
  const ledgerPath = path.resolve(cwd, options.ledger ?? DEFAULT_LEDGER_PATH);
  const provisionPath = path.resolve(cwd, options.provision);
  const resultsPath = path.resolve(cwd, options.results);
  const receiptAbsolutePath = path.resolve(cwd, options.receipt);
  const receiptPath = path.relative(cwd, receiptAbsolutePath);
  if (
    !receiptPath ||
    receiptPath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(receiptPath)
  ) {
    throw new Error('Receipt path must remain inside the repository.');
  }
  const [catalog, ledger, provision, results] = await Promise.all(
    [catalogPath, ledgerPath, provisionPath, resultsPath].map(async (file) =>
      JSON.parse(await readFile(file, 'utf8'))
    )
  );
  const recorded = await recordCalibration({
    artifactDigest: (artifact) => artifactDigestFromRepository(cwd, artifact),
    catalog,
    expectedSha: checkoutSha,
    ledger,
    provision,
    receiptPath,
    results,
  });
  await mkdir(path.dirname(receiptAbsolutePath), { recursive: true });
  await writeFile(
    receiptAbsolutePath,
    `${JSON.stringify(recorded.receipt, null, 2)}\n`,
    { flag: 'wx' }
  );
  await writeFile(ledgerPath, `${JSON.stringify(recorded.ledger, null, 2)}\n`);
  process.stdout.write(
    `Recorded ${recorded.receipt.summary.files} same-SHA persistence suite(s) in ${receiptPath}.\n`
  );
}

function parseOptions(arguments_) {
  const values = {};
  const aliases = new Map([
    ['--catalog', 'catalog'],
    ['--ledger', 'ledger'],
    ['--provision', 'provision'],
    ['--receipt', 'receipt'],
    ['--results', 'results'],
  ]);
  for (let index = 0; index < arguments_.length; index += 1) {
    const name = arguments_[index];
    const key = aliases.get(name);
    if (!key) {
      throw new Error(
        'Usage: node scripts/ci/record-opt-in-persistence-evidence.mjs --provision provision.json --results results.json --receipt docs/ops/persistence-calibrations/run.json [--catalog catalog.json] [--ledger evidence.json]'
      );
    }
    const value = arguments_[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`${name} requires a path.`);
    }
    values[key] = value;
    index += 1;
  }
  for (const key of ['provision', 'results', 'receipt']) {
    if (!values[key]) throw new Error(`--${key} is required.`);
  }
  return values;
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
