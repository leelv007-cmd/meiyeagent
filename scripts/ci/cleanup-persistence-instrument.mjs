import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { databaseFingerprint } from './run-persistence-evidence-instrument.mjs';
import { runPostgresStatementSync } from '../dev/postgres-process.mjs';

const OWNERSHIP_PREFIX = 'meiye-persistence-instrument/v1';

export function instrumentOwnershipComment(provision) {
  return `${OWNERSHIP_PREFIX}:${provision.provisionId}:${provision.commitSha}`;
}

export function markInstrumentPairOwnership(
  { adminUrl, provision },
  { runStatement = runPostgresStatementSync } = {}
) {
  const validated = validateInstrumentProvision({ adminUrl, provision });
  const statement = validated.databaseNames
    .map(
      (databaseName) =>
        `COMMENT ON DATABASE ${quoteIdentifier(databaseName)} IS ${quoteLiteral(validated.ownerComment)};`
    )
    .join('\n');
  const result = runStatement(adminUrl, statement);
  if (result.status !== 0) {
    throw new Error('Unable to mark the fresh persistence database pair owner.');
  }
  return validated;
}

export function cleanupInstrumentPair(
  { adminUrl, expectedSha, provision },
  { runStatement = runPostgresStatementSync } = {}
) {
  const validated = validateInstrumentProvision({
    adminUrl,
    expectedSha,
    provision,
  });
  const ownership = runStatement(
    adminUrl,
    ownershipInspectionStatement(validated.databaseNames)
  );
  if (ownership.status !== 0) {
    throw new Error('Unable to inspect the persistence database pair owner marker.');
  }
  if (!hasExactOwnership(ownership.stdout, validated)) {
    throw new Error(
      'Persistence database pair owner marker does not match this provision receipt.'
    );
  }

  const termination = runStatement(
    adminUrl,
    terminationStatement(validated.databaseNames)
  );
  if (termination.status !== 0) {
    throw new Error('Unable to terminate persistence database pair connections.');
  }
  for (const databaseName of validated.databaseNames) {
    const result = runStatement(
      adminUrl,
      `DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)};`
    );
    if (result.status !== 0) {
      throw new Error('Unable to drop the owner-verified persistence database pair.');
    }
  }
  const remaining = runStatement(
    adminUrl,
    presenceStatement(validated.databaseNames)
  );
  if (remaining.status !== 0 || remaining.stdout.trim().length > 0) {
    throw new Error('Persistence database pair cleanup did not verify absence.');
  }
  return { databaseNames: provision.databaseNames };
}

export function validateInstrumentProvision({ adminUrl, expectedSha, provision }) {
  if (!/^[a-f0-9]{40}$/u.test(provision?.commitSha ?? '')) {
    throw new Error('Persistence provision receipt requires a 40-character commit SHA.');
  }
  if (expectedSha && provision.commitSha !== expectedSha) {
    throw new Error('Persistence provision receipt does not belong to this checked-out SHA.');
  }
  if (
    provision?.schemaVersion !== 'persistence-provision/v1' ||
    provision?.provisioner !== 'provision-persistence-instrument/v1' ||
    provision?.fresh !== true ||
    typeof provision?.provisionId !== 'string'
  ) {
    throw new Error('Persistence provision receipt is not an owned fresh instrument pair.');
  }
  const databaseNames = expectedDatabaseNames(provision.provisionId);
  if (
    provision.databaseNames?.business !== databaseNames[0] ||
    provision.databaseNames?.dbosSystem !== databaseNames[1]
  ) {
    throw new Error('Persistence provision database names do not match its provision id.');
  }
  const [businessUrl, dbosUrl] = databaseNames.map((databaseName) =>
    databaseUrl(adminUrl, databaseName)
  );
  if (
    provision.databasePair?.business !== databaseFingerprint(businessUrl) ||
    provision.databasePair?.dbosSystem !== databaseFingerprint(dbosUrl)
  ) {
    throw new Error('Persistence provision database fingerprints do not match its pair.');
  }
  return {
    databaseNames,
    ownerComment: instrumentOwnershipComment(provision),
  };
}

function expectedDatabaseNames(provisionId) {
  const normalized = provisionId.toLowerCase().replace(/[^a-z0-9]+/gu, '_');
  if (!normalized) throw new Error('Persistence provision receipt has no usable provision id.');
  const suffix = normalized.slice(-32);
  return [
    `meiye_instrument_${suffix}_biz`,
    `meiye_instrument_${suffix}_dbos`,
  ];
}

function databaseUrl(adminUrl, databaseName) {
  const url = new URL(adminUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('Persistence admin URL must use PostgreSQL.');
  }
  url.pathname = `/${databaseName}`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

function ownershipInspectionStatement(databaseNames) {
  return `SELECT d.datname, COALESCE(shobj_description(d.oid, 'pg_database'), '')
FROM pg_database d
WHERE d.datname IN (${databaseNames.map(quoteLiteral).join(', ')})
ORDER BY d.datname;`;
}

function terminationStatement(databaseNames) {
  return `SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname IN (${databaseNames.map(quoteLiteral).join(', ')})
  AND pid <> pg_backend_pid();`;
}

function presenceStatement(databaseNames) {
  return `SELECT datname
FROM pg_database
WHERE datname IN (${databaseNames.map(quoteLiteral).join(', ')})
ORDER BY datname;`;
}

export function hasExactOwnership(output, { databaseNames, ownerComment }) {
  const observed = new Map(
    output
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => {
        const [databaseName, comment] = line.split('|');
        return [databaseName, comment];
      })
  );
  return (
    observed.size === databaseNames.length &&
    databaseNames.every((databaseName) => observed.get(databaseName) === ownerComment)
  );
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

async function main() {
  const provisionPath = requiredArgument(process.argv.slice(2), '--provision');
  const adminUrl = requiredEnvironment('PERSISTENCE_POSTGRES_ADMIN_URL');
  const expectedSha = requiredEnvironment('RELEASE_COMMIT_SHA');
  const provision = JSON.parse(await readFile(path.resolve(provisionPath), 'utf8'));
  const result = cleanupInstrumentPair({ adminUrl, expectedSha, provision });
  process.stdout.write(
    `Removed owner-verified persistence pair ${result.databaseNames.business} / ${result.databaseNames.dbosSystem}.\n`
  );
}

function requiredArgument(arguments_, name) {
  const index = arguments_.indexOf(name);
  const value = index === -1 ? undefined : arguments_[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
