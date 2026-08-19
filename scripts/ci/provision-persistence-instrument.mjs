import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  cleanupInstrumentPair,
  markInstrumentDatabaseOwnership,
} from './cleanup-persistence-instrument.mjs';
import { databaseFingerprint } from './run-persistence-evidence-instrument.mjs';

async function main() {
  const arguments_ = process.argv.slice(2);
  const adminUrl = requiredEnvironment('PERSISTENCE_POSTGRES_ADMIN_URL');
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
  const existing = inspectExistingDatabases(adminUrl, businessName, dbosName);
  if (existing.length > 0) {
    throw new Error(
      `Fresh persistence database already exists: ${existing.join(', ')}`
    );
  }
  const markedDatabaseNames = [];
  try {
    createOwnedDatabase(adminUrl, businessName, receipt);
    markedDatabaseNames.push(businessName);
    createOwnedDatabase(adminUrl, dbosName, receipt);
    markedDatabaseNames.push(dbosName);
    execFileSync('bash', ['scripts/ci/provision-test-db.sh'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        TEST_DATABASE_URL: businessUrl,
        TEST_DBOS_SYSTEM_DATABASE_URL: dbosUrl,
      },
      stdio: 'inherit',
    });
    assertCurrentDatabase(businessUrl, businessName);
    assertCurrentDatabase(dbosUrl, dbosName);
    await writeFile(
      envOutputPath,
      `${JSON.stringify({ TEST_DATABASE_URL: businessUrl, TEST_DBOS_SYSTEM_DATABASE_URL: dbosUrl })}\n`,
      { flag: 'wx', mode: 0o600 }
    );
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
  } catch (error) {
    if (markedDatabaseNames.length > 0) {
      try {
        cleanupInstrumentPair({
          adminUrl,
          allowPartial: true,
          expectedSha: commitSha,
          provision: receipt,
        });
      } catch {
        throw new Error(
          'Fresh persistence database provisioning failed and owner cleanup failed.'
        );
      }
    }
    if (error instanceof Error && error.message.includes('Fresh persistence')) {
      throw error;
    }
    throw new Error('Fresh persistence database provisioning failed.');
  }
  process.stdout.write(
    `Provisioned fresh persistence pair ${businessName} / ${dbosName}.\n`
  );
}

function inspectExistingDatabases(adminUrl, businessName, dbosName) {
  try {
    const output = execFileSync(
      'psql',
      [
        '-X',
        '-v',
        'ON_ERROR_STOP=1',
        '-Atqc',
        `SELECT datname FROM pg_database WHERE datname IN ('${businessName}', '${dbosName}') ORDER BY datname`,
      ],
      { encoding: 'utf8', env: postgresEnvironment(adminUrl) }
    );
    return output.split(/\r?\n/u).filter(Boolean);
  } catch {
    throw new Error('Unable to inspect fresh persistence database names.');
  }
}

function createOwnedDatabase(adminUrl, databaseName, receipt) {
  createDatabase(adminUrl, databaseName);
  try {
    markInstrumentDatabaseOwnership({
      adminUrl,
      databaseName,
      provision: receipt,
    });
  } catch (error) {
    try {
      dropJustCreatedDatabase(adminUrl, databaseName);
    } catch {
      throw new Error(
        'Unable to mark the fresh persistence database owner and remove the unmarked database.'
      );
    }
    throw error;
  }
}

function createDatabase(adminUrl, databaseName) {
  try {
    execFileSync(
      'psql',
      [
        '-X',
        '-v',
        'ON_ERROR_STOP=1',
        `--set=name=${databaseName}`,
      ],
      {
        encoding: 'utf8',
        input: "SELECT format('CREATE DATABASE %I', :'name')\n\\gexec\n",
        env: postgresEnvironment(adminUrl),
      }
    );
  } catch {
    throw new Error('Unable to create the fresh persistence database.');
  }
}

function dropJustCreatedDatabase(adminUrl, databaseName) {
  try {
    execFileSync(
      'psql',
      ['-X', '-v', 'ON_ERROR_STOP=1', `--set=name=${databaseName}`],
      {
        encoding: 'utf8',
        input: "SELECT format('DROP DATABASE IF EXISTS %I', :'name')\n\\gexec\n",
        env: postgresEnvironment(adminUrl),
      }
    );
  } catch {
    throw new Error('Unable to remove the unmarked fresh persistence database.');
  }
}

function assertCurrentDatabase(url, expectedName) {
  try {
    const actual = execFileSync(
      'psql',
      ['-X', '-v', 'ON_ERROR_STOP=1', '-Atqc', 'SELECT current_database()'],
      { encoding: 'utf8', env: postgresEnvironment(url) }
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

function postgresEnvironment(rawUrl) {
  const url = new URL(rawUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('Persistence database URL must use PostgreSQL.');
  }
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (!databaseName || databaseName.includes('/')) {
    throw new Error('Persistence database URL must name one database.');
  }
  const environment = {
    ...process.env,
    PGDATABASE: databaseName,
    PGHOST: url.hostname,
    PGPASSWORD: decodeURIComponent(url.password),
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
  };
  const sslMode = url.searchParams.get('sslmode');
  if (sslMode) environment.PGSSLMODE = sslMode;
  return environment;
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
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
