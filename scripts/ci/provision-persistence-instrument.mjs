import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { databaseFingerprint } from './run-persistence-evidence-instrument.mjs';

async function main() {
  const arguments_ = process.argv.slice(2);
  const adminUrl = requiredArgument(arguments_, '--admin-url');
  const commitSha = requiredArgument(arguments_, '--commit-sha');
  const requestedId =
    argumentValue(arguments_, '--provision-id') ?? randomUUID();
  const receiptPath = path.resolve(requiredArgument(arguments_, '--receipt'));
  const envOutputPath = path.resolve(
    requiredArgument(arguments_, '--env-output')
  );
  const provisionId = requestedId.toLowerCase().replace(/[^a-z0-9]+/gu, '_');
  if (!provisionId || !/^[a-f0-9]{40}$/u.test(commitSha)) {
    throw new Error('Provision id and 40-character commit SHA are required.');
  }
  const suffix = provisionId.slice(-32);
  const businessName = `meiye_instrument_${suffix}_biz`;
  const dbosName = `meiye_instrument_${suffix}_dbos`;
  const businessUrl = databaseUrl(adminUrl, businessName);
  const dbosUrl = databaseUrl(adminUrl, dbosName);

  const existing = inspectExistingDatabases(adminUrl, businessName, dbosName);
  if (existing.length > 0) {
    throw new Error(
      `Fresh persistence database already exists: ${existing.join(', ')}`
    );
  }
  createDatabases(adminUrl, businessName, dbosName);
  try {
    execFileSync(
      'bash',
      ['scripts/ci/provision-test-db.sh', businessUrl, dbosUrl],
      { cwd: process.cwd(), env: process.env, stdio: 'inherit' }
    );
  } catch {
    throw new Error('Fresh persistence database provisioning failed.');
  }
  assertCurrentDatabase(businessUrl, businessName);
  assertCurrentDatabase(dbosUrl, dbosName);

  const receipt = {
    schemaVersion: 'persistence-provision/v1',
    provisioner: 'provision-persistence-instrument/v1',
    commitSha,
    provisionId,
    fresh: true,
    provisionedAt: new Date().toISOString(),
    databasePair: {
      business: databaseFingerprint(businessUrl),
      dbosSystem: databaseFingerprint(dbosUrl),
    },
    databaseNames: { business: businessName, dbosSystem: dbosName },
  };
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  await writeFile(
    envOutputPath,
    `${JSON.stringify({ TEST_DATABASE_URL: businessUrl, TEST_DBOS_SYSTEM_DATABASE_URL: dbosUrl })}\n`,
    { flag: 'wx', mode: 0o600 }
  );
  process.stdout.write(
    `Provisioned fresh persistence pair ${businessName} / ${dbosName}.\n`
  );
}

function inspectExistingDatabases(adminUrl, businessName, dbosName) {
  try {
    const output = execFileSync(
      'psql',
      [
        adminUrl,
        '-X',
        '-v',
        'ON_ERROR_STOP=1',
        '-Atqc',
        `SELECT datname FROM pg_database WHERE datname IN ('${businessName}', '${dbosName}') ORDER BY datname`,
      ],
      { encoding: 'utf8' }
    );
    return output.split(/\r?\n/u).filter(Boolean);
  } catch {
    throw new Error('Unable to inspect fresh persistence database names.');
  }
}

function createDatabases(adminUrl, businessName, dbosName) {
  try {
    execFileSync(
      'psql',
      [
        adminUrl,
        '-X',
        '-v',
        'ON_ERROR_STOP=1',
        `--set=biz=${businessName}`,
        `--set=dbos=${dbosName}`,
      ],
      {
        encoding: 'utf8',
        input:
          "SELECT format('CREATE DATABASE %I', :'biz')\n\\gexec\nSELECT format('CREATE DATABASE %I', :'dbos')\n\\gexec\n",
      }
    );
  } catch {
    throw new Error('Unable to create the fresh persistence database pair.');
  }
}

function assertCurrentDatabase(url, expectedName) {
  try {
    const actual = execFileSync(
      'psql',
      [
        url,
        '-X',
        '-v',
        'ON_ERROR_STOP=1',
        '-Atqc',
        'SELECT current_database()',
      ],
      { encoding: 'utf8' }
    ).trim();
    if (actual !== expectedName) throw new Error('mismatch');
  } catch {
    throw new Error(
      `Provisioned database identity check failed for ${expectedName}.`
    );
  }
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

function requiredArgument(arguments_, name) {
  const value = argumentValue(arguments_, name);
  if (!value) throw new Error(`${name} requires a value`);
  return value;
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
