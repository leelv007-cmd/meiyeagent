import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { resolveCatalogEntries } from './journey-ownership-catalog.mjs';

export function persistenceEvidenceViolations({
  catalog,
  provision,
  results,
  expectedSha,
}) {
  const violations = [];
  const expectedFiles = resolveCatalogEntries(catalog)
    .filter((entry) => entry.kind === 'persistence')
    .map((entry) => entry.path);
  if (provision?.schemaVersion !== 'persistence-provision/v1') {
    violations.push('provision schemaVersion must be persistence-provision/v1');
  }
  if (provision?.provisioner !== 'provision-persistence-instrument/v1') {
    violations.push('receipt was not produced by the persistence provisioner');
  }
  if (
    provision?.fresh !== true ||
    !provision?.provisionId ||
    !provision?.provisionedAt ||
    !provision?.databasePair?.business ||
    !provision?.databasePair?.dbosSystem ||
    provision?.databasePair?.business === provision?.databasePair?.dbosSystem ||
    !provision?.databaseNames?.business ||
    !provision?.databaseNames?.dbosSystem ||
    provision?.databaseNames?.business === provision?.databaseNames?.dbosSystem
  ) {
    violations.push('evidence requires a fresh isolated database pair');
  }
  if (provision?.commitSha !== expectedSha) {
    violations.push(
      `provision commit SHA mismatch: expected ${expectedSha}, got ${provision?.commitSha}`
    );
  }
  if (results?.schemaVersion !== 'persistence-results/v1') {
    violations.push('results schemaVersion must be persistence-results/v1');
  }
  if (results?.commitSha !== expectedSha) {
    violations.push(
      `results commit SHA mismatch: expected ${expectedSha}, got ${results?.commitSha}`
    );
  }
  if (results?.provisionId !== provision?.provisionId) {
    violations.push(
      'results provisionId does not match the fresh database receipt'
    );
  }

  const files = Array.isArray(results?.files) ? results.files : [];
  const byPath = new Map();
  for (const file of files) {
    if (byPath.has(file?.path))
      violations.push(`duplicate file evidence: ${file?.path}`);
    byPath.set(file?.path, file);
  }
  for (const filePath of expectedFiles) {
    const file = byPath.get(filePath);
    if (!file) {
      violations.push(`missing per-file persistence evidence: ${filePath}`);
      continue;
    }
    if (file.commitSha !== expectedSha) {
      violations.push(`same-SHA mismatch for ${filePath}`);
    }
    if (file.provisionId !== provision?.provisionId) {
      violations.push(`provision receipt mismatch for ${filePath}`);
    }
    if (file.databasePair?.business !== provision?.databasePair?.business) {
      violations.push(`business database pair mismatch for ${filePath}`);
    }
    if (file.databasePair?.dbosSystem !== provision?.databasePair?.dbosSystem) {
      violations.push(`DBOS pair mismatch for ${filePath}`);
    }
    const counts = file.counts ?? {};
    if (![counts.pass, counts.fail, counts.skip].every(isCount)) {
      violations.push(`invalid test counts for ${filePath}`);
      continue;
    }
    const total = counts.pass + counts.fail + counts.skip;
    if (total === 0) violations.push(`${filePath} contributed 0 tests`);
    if (counts.skip > 0)
      violations.push(`${filePath} reported unexpected skip (${counts.skip})`);
    if (counts.fail > 0)
      violations.push(`${filePath} reported ${counts.fail} failing test(s)`);
    if (file.verdict !== persistenceFileVerdict(counts)) {
      violations.push(`${filePath} verdict does not match its test counts`);
    }
    if (!file.artifact)
      violations.push(`${filePath} lacks a per-file artifact`);
  }
  for (const filePath of byPath.keys()) {
    if (!expectedFiles.includes(filePath)) {
      violations.push(`unexpected persistence file evidence: ${filePath}`);
    }
  }
  return violations;
}

export function verifiedPersistenceEvidence({ provision, results }) {
  const files = results.files.map((file) => ({
    path: file.path,
    counts: file.counts,
    artifact: file.artifact,
    verdict: persistenceFileVerdict(file.counts),
  }));
  return {
    schemaVersion: 'persistence-evidence/v1',
    commitSha: results.commitSha,
    provisionId: provision.provisionId,
    decision: 'instrument',
    releaseVerdict: null,
    verdict: 'pass',
    summary: files.reduce(
      (summary, file) => ({
        files: summary.files + 1,
        pass: summary.pass + file.counts.pass,
        fail: summary.fail + file.counts.fail,
        skip: summary.skip + file.counts.skip,
      }),
      { files: 0, pass: 0, fail: 0, skip: 0 }
    ),
    files,
  };
}

export function persistenceFileVerdict(counts) {
  if (counts.fail > 0) return 'fail';
  if (counts.skip > 0) return 'skip';
  return counts.pass > 0 ? 'pass' : 'fail';
}

async function main() {
  const [command, ...arguments_] = process.argv.slice(2);
  if (command !== 'verify') {
    throw new Error(
      'Usage: node persistence-evidence-instrument.mjs verify --catalog path --provision path --results path --expected-sha sha --output path'
    );
  }
  const catalogPath = requiredArgument(arguments_, '--catalog');
  const provisionPath = requiredArgument(arguments_, '--provision');
  const resultsPath = requiredArgument(arguments_, '--results');
  const expectedSha = rawRequiredArgument(arguments_, '--expected-sha');
  const outputPath = requiredArgument(arguments_, '--output');
  const [catalog, provision, results] = await Promise.all(
    [catalogPath, provisionPath, resultsPath].map(async (file) =>
      JSON.parse(await readFile(file, 'utf8'))
    )
  );
  const violations = persistenceEvidenceViolations({
    catalog,
    provision,
    results,
    expectedSha,
  });
  if (violations.length > 0) {
    throw new Error(
      `Persistence evidence is invalid:\n- ${violations.join('\n- ')}`
    );
  }
  const evidence = verifiedPersistenceEvidence({ catalog, provision, results });
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(
    `Persistence instrument passed: ${evidence.summary.files} files, ${evidence.summary.pass} tests, 0 failures, 0 skips.\n`
  );
}

function isCount(value) {
  return Number.isInteger(value) && value >= 0;
}

function requiredArgument(arguments_, name) {
  return path.resolve(rawRequiredArgument(arguments_, name));
}

function rawRequiredArgument(arguments_, name) {
  const index = arguments_.indexOf(name);
  const value = index === -1 ? undefined : arguments_[index + 1];
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
