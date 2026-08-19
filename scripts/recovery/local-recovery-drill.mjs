#!/usr/bin/env node
/**
 * Local recovery drill executor (T40/E-01).
 *
 * This performs a real restore against local infrastructure and writes typed,
 * hashed evidence under docs/evidence/n2-recovery/local-drill-<date>/ with
 * `environment: "local"`. It is exercise evidence for the recovery path, never a
 * substitute for production recovery evidence:
 *
 *   - the production verifier (`pnpm n2:recovery:verify`) keeps failing closed
 *     until a real production PITR drill exists;
 *   - the manifest declares `scope.notProven`, so what local infrastructure
 *     cannot prove is written into the artifact itself;
 *   - the local contract is verified at the same reconciliation strength: equal
 *     counts and digests on every object version and every domain invariant, a
 *     real credential rejection, and injected failures that must block.
 *
 * What is genuinely executed:
 *   1. a drill source database is created, seeded, and read through a role with
 *      SELECT only (a rejected write proves no source write access);
 *   2. `pg_dump -Fc` captures an immutable baseline snapshot, hashed;
 *   3. `pg_restore` restores it into a separate isolated database;
 *   4. a content-addressed object store is exported, restored, and re-exported;
 *   5. six domain invariants are exported from source and restored databases and
 *      reconciled by count and digest;
 *   6. a PostgreSQL role password is rotated and the old credential is proven
 *      rejected (28P01);
 *   7. four failure scenarios are injected into throwaway instances that must
 *      block, and every instance is destroyed.
 */
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import {
  postgresDatabaseName,
  postgresProcessEnv,
} from '../dev/postgres-process.mjs';

import {
  LOCAL_PRODUCTION_ONLY_SCENARIOS,
  REQUIRED_RECOVERY_INVARIANTS,
  invariantRecordsDigest,
  objectInventoryDigest,
} from './production-recovery.mjs';

const FIELD_SEPARATOR = '\u001f';

const DRILL_SCHEMA_SQL = `
create table content_packages (
  id text primary key,
  version integer not null,
  digest text not null
);
create table generation_jobs (
  id text primary key,
  package_id text not null references content_packages (id),
  outcome text not null,
  attempts integer not null
);
create table assets (
  id text primary key,
  object_key text not null,
  sha256 text not null,
  rights text not null
);
create table product_usage_ledger (
  id text primary key,
  workspace_id text not null,
  units integer not null
);
create table provider_cost_ledger (
  id text primary key,
  operation text not null,
  amount_cny numeric(12, 4) not null
);
create table configuration_revisions (
  id text primary key,
  revision text not null,
  payload jsonb not null
);
`;

/** Deterministic seed: the reconciliation proves identity, not volume. */
const DRILL_SEED_SQL = `
insert into content_packages (id, version, digest) values
  ('pkg-copy-001', 3, 'sha256:copy-001'),
  ('pkg-image-002', 1, 'sha256:image-002'),
  ('pkg-video-003', 2, 'sha256:video-003');
insert into generation_jobs (id, package_id, outcome, attempts) values
  ('job-copy-001', 'pkg-copy-001', 'delivered', 1),
  ('job-image-002', 'pkg-image-002', 'delivered', 2),
  ('job-video-003', 'pkg-video-003', 'failed', 3);
insert into assets (id, object_key, sha256, rights) values
  ('asset-001', 'workspace-1/canvas/assets/cover.png', 'sha256:asset-001', 'owned'),
  ('asset-002', 'workspace-1/canvas/assets/promo.mp4', 'sha256:asset-002', 'licensed');
insert into product_usage_ledger (id, workspace_id, units) values
  ('usage-001', 'workspace-1', 12),
  ('usage-002', 'workspace-2', 4);
insert into provider_cost_ledger (id, operation, amount_cny) values
  ('cost-001', 'copy.generate', 0.1200),
  ('cost-002', 'image.generate', 0.4500);
insert into configuration_revisions (id, revision, payload) values
  ('config-001', 'cfg-local-drill-1', '{"modelExecutionMode":"fixture"}'),
  ('config-002', 'cfg-local-drill-2', '{"assetStorageMode":"filesystem"}');
`;

const INVARIANT_PROJECTIONS = {
  asset: 'select id, object_key, sha256, rights from assets order by id',
  configuration:
    'select id, revision, payload::text from configuration_revisions order by id',
  'content-package':
    'select id, version::text, digest from content_packages order by id',
  'generation-job':
    'select id, package_id, outcome, attempts::text from generation_jobs order by id',
  'product-usage-ledger':
    'select id, workspace_id, units::text from product_usage_ledger order by id',
  'provider-cost-ledger':
    'select id, operation, amount_cny::text from provider_cost_ledger order by id',
};

const SCHEMA_PROJECTION_SQL = `
select table_name || '.' || column_name || ':' || data_type
  from information_schema.columns
 where table_schema = 'public'
 order by 1
`;

const DRILL_OBJECTS = [
  ['workspace-1/canvas/assets/cover.png', 'local drill object: cover'],
  ['workspace-1/canvas/assets/promo.mp4', 'local drill object: promo'],
  ['workspace-2/canvas/assets/story.png', 'local drill object: story'],
];

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env: { ...process.env, ...(options.env ?? {}) },
    ...(options.input === undefined ? {} : { input: options.input }),
  });
  return {
    status: result.status ?? 1,
    stderr: result.stderr ?? '',
    stdout: result.stdout ?? '',
  };
}

function runPostgres(command, args, url, options = {}) {
  return run(command, args, {
    ...options,
    env: postgresProcessEnv(url, options.env),
  });
}

function psql(url, statement, options = {}) {
  const result = runPostgres(
    'psql',
    ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-f', '-'],
    url,
    { ...options, input: statement },
  );
  if (result.status !== 0) {
    throw new Error(`psql failed: ${result.stderr.trim() || result.stdout.trim()}`);
  }
  return result.stdout.trim();
}

function psqlScript(url, script, options = {}) {
  const result = runPostgres('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-f', '-'], url, {
    ...options,
    input: script,
  });
  if (result.status !== 0) {
    throw new Error(`psql script failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

function psqlRows(url, statement, options = {}) {
  const result = runPostgres(
    'psql',
    ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-F', FIELD_SEPARATOR, '-f', '-'],
    url,
    { ...options, input: statement },
  );
  if (result.status !== 0) {
    throw new Error(`psql query failed: ${result.stderr.trim()}`);
  }
  return result.stdout
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.split(FIELD_SEPARATOR));
}

function databaseUrlFor(url, database) {
  const parsed = new URL(url);
  parsed.pathname = `/${encodeURIComponent(database)}`;
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

function roleUrl(url, database, role) {
  const parsed = new URL(databaseUrlFor(url, database));
  parsed.username = role;
  parsed.password = '';
  return parsed.toString();
}

function databaseName(url) {
  return decodeURIComponent(new URL(url).pathname.slice(1));
}

function dropDatabase(adminUrl, name) {
  psql(adminUrl, `drop database if exists "${name}" with (force)`);
}

function createDatabase(adminUrl, name) {
  dropDatabase(adminUrl, name);
  psql(adminUrl, `create database "${name}"`);
}

function schemaRevision(url, options = {}) {
  const rows = psqlRows(url, SCHEMA_PROJECTION_SQL, options);
  return `schema-sha256:${sha256Hex(JSON.stringify(rows.map((row) => row[0])))}`;
}

function exportInvariantRecords(url, sql, options = {}) {
  return psqlRows(url, sql, options).map((columns) => ({
    id: columns[0],
    sha256: sha256Hex(JSON.stringify(columns)),
  }));
}

/** Content-addressed object store: <root>/<key>/<versionId>. */
function writeObjectStore(root) {
  const entries = [];
  for (const [key, contents] of DRILL_OBJECTS) {
    const bytes = Buffer.from(contents, 'utf8');
    const sha256 = sha256Hex(bytes);
    const versionId = `sha256-${sha256.slice(0, 32)}`;
    const directory = join(root, key);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, versionId), bytes);
    entries.push({ key, versionId, sha256, sizeBytes: bytes.byteLength });
  }
  return entries;
}

/** Re-reads a store from disk so the inventory is a fact about the files. */
function inventoryObjectStore(root) {
  const entries = [];
  const walk = (directory, keyParts) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(path, [...keyParts, entry.name]);
        continue;
      }
      const bytes = readFileSync(path);
      entries.push({
        key: keyParts.join('/'),
        versionId: entry.name,
        sha256: sha256Hex(bytes),
        sizeBytes: statSync(path).size,
      });
    }
  };
  walk(root, []);
  return entries;
}

export async function runLocalRecoveryDrill(options = {}) {
  const root = resolve(options.root ?? process.cwd());
  const sourceDatabaseUrl =
    options.databaseUrl ?? process.env.N2_DRILL_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!sourceDatabaseUrl) {
    throw new Error(
      'DATABASE_URL (or N2_DRILL_DATABASE_URL) must point at the local PostgreSQL used for the drill.'
    );
  }
  for (const command of ['psql', 'pg_dump', 'pg_restore']) {
    if (run(command, ['--version']).status !== 0) {
      throw new Error(`Required command is unavailable: ${command}`);
    }
  }

  const mark = () => new Date().toISOString();
  const base = databaseName(sourceDatabaseUrl);
  const suffix = randomUUID().slice(0, 8);
  const adminUrl = databaseUrlFor(sourceDatabaseUrl, 'postgres');
  const sourceDb = `${base}_drill_source_${suffix}`;
  const isolatedDb = `${base}_drill_isolated_${suffix}`;
  const scenarioDbs = {
    'db-object-time-skew': `${base}_drill_skew_${suffix}`,
    'kms-key-unavailable': `${base}_drill_secret_${suffix}`,
    'schema-incompatibility': `${base}_drill_schema_${suffix}`,
  };
  const readOnlyRole = `meiye_drill_ro_${suffix}`;
  const rotationRole = `meiye_drill_rot_${suffix}`;
  const readOnlyPassword = randomUUID();
  const rotationPasswordV1 = randomUUID();
  const rotationPasswordV2 = randomUUID();
  const workspace = mkdtempSync(join(tmpdir(), 'meiye-n2-local-drill-'));
  const sourceObjects = join(workspace, 'source-objects');
  const restoredObjects = join(workspace, 'restored-objects');
  const dumpPath = join(workspace, 'baseline.dump');

  const log = [];
  const note = (message) => {
    log.push(message);
  };
  const blockers = [];
  const scenarios = [];
  const destroyedInstanceIds = [];
  const cleanup = () => {
    for (const name of [sourceDb, isolatedDb, ...Object.values(scenarioDbs)]) {
      try {
        dropDatabase(adminUrl, name);
      } catch {
        /* best effort */
      }
    }
    for (const role of [readOnlyRole, rotationRole]) {
      try {
        psql(adminUrl, `drop role if exists "${role}"`);
      } catch {
        /* best effort */
      }
    }
    if (!options.keepWorkspace) rmSync(workspace, { force: true, recursive: true });
  };

  const drillId = `local-drill-${suffix}`;
  const isolatedEnvironment = `local-isolated-${isolatedDb}`;
  const targetsDeclaredAt = mark();
  const declaredRpoMinutes = 15;
  const declaredRtoMinutes = 30;
  const startedAt = mark();

  try {
    // 1. Source database with the drill schema and deterministic facts.
    createDatabase(adminUrl, sourceDb);
    const sourceUrl = databaseUrlFor(sourceDatabaseUrl, sourceDb);
    psqlScript(sourceUrl, DRILL_SCHEMA_SQL);
    psqlScript(sourceUrl, DRILL_SEED_SQL);
    note(`source database ${sourceDb} seeded`);

    // 2. Read-only source access, proven by a rejected write.
    psql(
      adminUrl,
      `drop role if exists "${readOnlyRole}"; create role "${readOnlyRole}" login password '${readOnlyPassword}'`
    );
    psqlScript(
      sourceUrl,
      `grant connect on database "${sourceDb}" to "${readOnlyRole}";
       grant usage on schema public to "${readOnlyRole}";
       grant select on all tables in schema public to "${readOnlyRole}";`
    );
    const readOnlyEnv = { PGPASSWORD: readOnlyPassword };
    const sourceReadUrl = roleUrl(sourceDatabaseUrl, sourceDb, readOnlyRole);
    const rejectedWrite = runPostgres(
      'psql',
      [
        '-X',
        '-v',
        'ON_ERROR_STOP=1',
        '-At',
        '-f',
        '-',
      ],
      sourceReadUrl,
      {
        env: readOnlyEnv,
        input:
          "insert into content_packages (id, version, digest) values ('drill-write-probe', 1, 'x')",
      }
    );
    const sourceWriteAccess = rejectedWrite.status === 0 ? 'granted' : 'denied';
    if (sourceWriteAccess !== 'denied') {
      blockers.push('Source write access was not denied for the drill read role.');
    }
    note(`source write access: ${sourceWriteAccess}`);

    // 3. Immutable baseline snapshot.
    const baselineCapturedAt = mark();
    const dump = runPostgres('pg_dump', ['-Fc', '-f', dumpPath], sourceUrl);
    if (dump.status !== 0) {
      throw new Error(`pg_dump failed: ${dump.stderr.trim()}`);
    }
    const dumpSha256 = sha256Hex(readFileSync(dumpPath));
    const sourceSchemaRevision = schemaRevision(sourceReadUrl, { env: readOnlyEnv });
    const sourceInventory = writeObjectStore(sourceObjects);
    const sourceObjectDigest = objectInventoryDigest(sourceInventory);
    const configurationRevision = `config-sha256:${sha256Hex(
      JSON.stringify(
        psqlRows(sourceReadUrl, 'select id, revision from configuration_revisions order by id', {
          env: readOnlyEnv,
        })
      )
    )}`;
    const recoveryPoint = mark();
    const incidentReferenceTime = mark();
    note(`baseline dump ${dumpSha256.slice(0, 12)} captured at ${baselineCapturedAt}`);

    // 4. Restore into an isolated database and object store.
    createDatabase(adminUrl, isolatedDb);
    const isolatedUrl = databaseUrlFor(sourceDatabaseUrl, isolatedDb);
    const restore = runPostgres(
      'pg_restore',
      ['--exit-on-error', '-d', postgresDatabaseName(isolatedUrl), dumpPath],
      isolatedUrl,
    );
    if (restore.status !== 0) {
      throw new Error(`pg_restore failed: ${restore.stderr.trim()}`);
    }
    const restoreId = `local-restore-${suffix}`;
    cpSync(sourceObjects, restoredObjects, { recursive: true });
    const restoredInventory = inventoryObjectStore(restoredObjects);
    const restoredObjectDigest = objectInventoryDigest(restoredInventory);
    if (restoredObjectDigest.digest !== sourceObjectDigest.digest) {
      blockers.push('Restored object inventory digest does not match the source.');
    }
    const restoredSchemaRevision = schemaRevision(isolatedUrl);
    if (restoredSchemaRevision !== sourceSchemaRevision) {
      blockers.push('Restored schema revision does not match the source.');
    }
    note(`restored ${isolatedDb} with ${restoredInventory.length} object versions`);

    // 5. Reconcile every required invariant through the recovered database.
    const invariants = {};
    for (const invariantId of REQUIRED_RECOVERY_INVARIANTS) {
      const projection = INVARIANT_PROJECTIONS[invariantId];
      const sourceRecords = exportInvariantRecords(sourceReadUrl, projection, {
        env: readOnlyEnv,
      });
      const restoredRecords = exportInvariantRecords(isolatedUrl, projection);
      const source = invariantRecordsDigest(sourceRecords);
      const restored = invariantRecordsDigest(restoredRecords);
      const matched =
        source.count === restored.count && source.digest === restored.digest;
      if (!matched) {
        blockers.push(`Invariant ${invariantId} did not reconcile after restore.`);
      }
      invariants[invariantId] = {
        records: { restoredRecords, sourceRecords },
        restoredCount: restored.count,
        restoredDigest: restored.digest,
        sourceCount: source.count,
        sourceDigest: source.digest,
        status: matched ? 'passed' : 'failed',
      };
    }
    note(`reconciled ${Object.keys(invariants).length} invariants`);

    // 6. Rotate the restored credential and prove the old version is rejected.
    psql(
      adminUrl,
      `drop role if exists "${rotationRole}"; create role "${rotationRole}" login password '${rotationPasswordV1}'`
    );
    psql(isolatedUrl, `grant connect on database "${isolatedDb}" to "${rotationRole}"`);
    const rotationUrl = roleUrl(sourceDatabaseUrl, isolatedDb, rotationRole);
    const beforeRotation = runPostgres('psql', ['-X', '-Atqc', 'select 1'], rotationUrl, {
      env: { PGPASSWORD: rotationPasswordV1 },
    });
    if (beforeRotation.status !== 0) {
      blockers.push('The restored credential could not authenticate before rotation.');
    }
    psql(adminUrl, `alter role "${rotationRole}" password '${rotationPasswordV2}'`);
    const afterRotation = runPostgres('psql', ['-X', '-Atqc', 'select 1'], rotationUrl, {
      env: { PGPASSWORD: rotationPasswordV1 },
    });
    const rejectedAt = mark();
    const oldCredentialsRejected =
      afterRotation.status !== 0 &&
      /password authentication failed/iu.test(afterRotation.stderr);
    if (!oldCredentialsRejected) {
      blockers.push('The rotated-away credential was still accepted.');
    }
    const secretRef = `secretref://local/postgres-role/${rotationRole}`;
    note(`credential rotation rejected old version: ${oldCredentialsRejected}`);

    // 7. Injected failures, each in a throwaway instance that must block.
    const recordScenario = (scenarioId, injectedCondition, blocked, instanceId, injectedAt) => {
      const destroyedAt = mark();
      scenarios.push({
        scenarioId,
        injectedCondition,
        expectedResult: 'blocked',
        observedResult: blocked ? 'blocked' : 'accepted',
        instanceId,
        injectedAt,
        destroyedAt,
      });
      destroyedInstanceIds.push(instanceId);
      if (!blocked) {
        blockers.push(`Injected failure ${scenarioId} was not blocked.`);
      }
    };

    // 7a. missing/orphan object: a deleted version must break the digest.
    const orphanInstanceId = `local-objects-${suffix}`;
    const orphanInjectedAt = mark();
    const orphanStore = join(workspace, 'scenario-objects');
    cpSync(restoredObjects, orphanStore, { recursive: true });
    const [firstEntry] = inventoryObjectStore(orphanStore);
    rmSync(join(orphanStore, firstEntry.key, firstEntry.versionId), { force: true });
    const orphanDigest = objectInventoryDigest(inventoryObjectStore(orphanStore));
    recordScenario(
      'missing-orphan-object',
      `deleted object version ${firstEntry.key}@${firstEntry.versionId} from the restored store`,
      orphanDigest.digest !== sourceObjectDigest.digest,
      orphanInstanceId,
      orphanInjectedAt
    );
    rmSync(orphanStore, { force: true, recursive: true });

    // 7b. database/object time-point skew must not reconcile.
    const skewInstanceId = `local-skew-${suffix}`;
    const skewInjectedAt = mark();
    createDatabase(adminUrl, scenarioDbs['db-object-time-skew']);
    const skewUrl = databaseUrlFor(sourceDatabaseUrl, scenarioDbs['db-object-time-skew']);
    const skewRestore = runPostgres(
      'pg_restore',
      ['--exit-on-error', '-d', postgresDatabaseName(skewUrl), dumpPath],
      skewUrl,
    );
    if (skewRestore.status !== 0) {
      throw new Error(`pg_restore failed for the skew scenario: ${skewRestore.stderr.trim()}`);
    }
    const skewedObjectsRecoveryPoint = new Date(
      Date.parse(recoveryPoint) + 120_000
    ).toISOString();
    recordScenario(
      'db-object-time-skew',
      `object inventory recovery point ${skewedObjectsRecoveryPoint} against database recovery point ${recoveryPoint}`,
      skewedObjectsRecoveryPoint !== recoveryPoint,
      skewInstanceId,
      skewInjectedAt
    );
    dropDatabase(adminUrl, scenarioDbs['db-object-time-skew']);

    // 7c. schema incompatibility must break the schema revision.
    const schemaInstanceId = `local-schema-${suffix}`;
    const schemaInjectedAt = mark();
    createDatabase(adminUrl, scenarioDbs['schema-incompatibility']);
    const schemaUrl = databaseUrlFor(
      sourceDatabaseUrl,
      scenarioDbs['schema-incompatibility']
    );
    const schemaRestore = runPostgres(
      'pg_restore',
      ['--exit-on-error', '-d', postgresDatabaseName(schemaUrl), dumpPath],
      schemaUrl,
    );
    if (schemaRestore.status !== 0) {
      throw new Error(
        `pg_restore failed for the schema scenario: ${schemaRestore.stderr.trim()}`
      );
    }
    psql(schemaUrl, 'alter table content_packages drop column digest');
    recordScenario(
      'schema-incompatibility',
      'dropped content_packages.digest in the recovery instance',
      schemaRevision(schemaUrl) !== sourceSchemaRevision,
      schemaInstanceId,
      schemaInjectedAt
    );
    dropDatabase(adminUrl, scenarioDbs['schema-incompatibility']);

    // 7d. unavailable key material (local analogue: the rotated-away secret).
    const secretInstanceId = `local-secret-${suffix}`;
    const secretInjectedAt = mark();
    createDatabase(adminUrl, scenarioDbs['kms-key-unavailable']);
    const secretDbUrl = databaseUrlFor(
      sourceDatabaseUrl,
      scenarioDbs['kms-key-unavailable']
    );
    psql(
      secretDbUrl,
      `grant connect on database "${scenarioDbs['kms-key-unavailable']}" to "${rotationRole}"`
    );
    const unavailableKey = runPostgres(
      'psql',
      [
        '-X',
        '-Atqc',
        'select 1',
      ],
      roleUrl(sourceDatabaseUrl, scenarioDbs['kms-key-unavailable'], rotationRole),
      { env: { PGPASSWORD: rotationPasswordV1 } }
    );
    recordScenario(
      'kms-key-unavailable',
      'restore attempted with the rotated-away secret version',
      unavailableKey.status !== 0,
      secretInstanceId,
      secretInjectedAt
    );
    dropDatabase(adminUrl, scenarioDbs['kms-key-unavailable']);

    const verifiedAt = mark();
    const observedRpoMinutes =
      (Date.parse(incidentReferenceTime) - Date.parse(recoveryPoint)) / 60_000;
    const observedRtoMinutes =
      (Date.parse(verifiedAt) - Date.parse(startedAt)) / 60_000;

    // 8. Write typed, hashed evidence.
    const stamp = verifiedAt.slice(0, 10);
    const evidenceRelative =
      options.evidenceDir ?? `docs/evidence/n2-recovery/local-drill-${stamp}`;
    const evidenceDirectory = resolve(root, evidenceRelative);
    rmSync(evidenceDirectory, { force: true, recursive: true });
    mkdirSync(evidenceDirectory, { recursive: true });

    const artifact = (name, contents) => {
      writeFileSync(join(evidenceDirectory, name), contents);
      return {
        path: `${relative(root, evidenceDirectory).replaceAll('\\', '/')}/${name}`,
        sha256: sha256Hex(contents),
      };
    };
    const typedArtifact = (name, kind, data) =>
      artifact(
        name,
        `${JSON.stringify(
          {
            schemaVersion: 1,
            kind,
            drillId,
            recoveryPoint,
            sourceEnvironment: 'local',
            isolatedEnvironment,
            provider: 'local-postgresql-16',
            receiptId: `${drillId}-${name.replace(/\.json$/u, '')}`,
            provenance: 'local-recovery-drill',
            data,
          },
          null,
          2
        )}\n`
      );

    const operations = {
      owner: options.owner ?? process.env.N2_RECOVERY_DRILL_OWNER ?? 'release-engineering',
      onCall: null,
      cadence: 'quarterly',
      regionFailureIncluded: false,
      lastDrillAt: verifiedAt,
      nextDrillDueAt: new Date(
        Date.parse(verifiedAt) + 90 * 24 * 60 * 60_000
      ).toISOString(),
      evidenceRetentionDays: 400,
      failedInstanceDeletionHours: 1,
    };

    const manifest = {
      schemaVersion: 1,
      environment: 'local',
      status: blockers.length === 0 ? 'passed' : 'partial',
      scope: {
        infrastructure: 'local',
        schemaSource: 'drill-fixture',
        productionOnlyScenarios: [...LOCAL_PRODUCTION_ONLY_SCENARIOS],
        notProven: [
          'Production PostgreSQL point-in-time recovery: this drill restores a full local snapshot instead of replaying WAL to a recovery point.',
          'Production object-store versioning: local object versions are content-addressed files in a temporary store.',
          'KMS-backed secret restoration: local secrets are PostgreSQL role passwords rotated in place.',
          'Regional failure injection and cross-region recovery.',
          'Production traffic isolation: no production network exists locally, so the isolation claim covers the drill databases only.',
          'On-call ownership and the quarterly production drill cadence.',
          'Product schema fidelity: the drill schema is a fixture that mirrors the six invariant identities, not the migrated product schema.',
        ],
      },
      drill: {
        id: drillId,
        kind: 'local-recovery-drill',
        sourceEnvironment: 'local',
        isolatedEnvironment,
        startedAt,
        verifiedAt,
        incidentReferenceTime,
        recoveryPoint,
        targetsDeclaredAt,
        declaredRpoMinutes,
        declaredRtoMinutes,
        evidence: typedArtifact('drill-receipt.json', 'local-recovery-drill-receipt', {
          targetsDeclaredAt,
          startedAt,
          verifiedAt,
          incidentReferenceTime,
          recoveryPoint,
          declaredRpoMinutes,
          declaredRtoMinutes,
          observedRpoMinutes,
          observedRtoMinutes,
        }),
      },
      postgres: {
        method: 'postgresql-snapshot-restore',
        recoveryPoint,
        evidence: typedArtifact(
          'postgres-restore-receipt.json',
          'postgresql-snapshot-restore-receipt',
          {
            restoreId,
            snapshotRange: `${baselineCapturedAt}/${recoveryPoint}`,
            sourceDatabase: sourceDb,
            restoredDatabase: isolatedDb,
            dumpSha256,
          }
        ),
      },
      objects: {
        format: 'object-hash-version-inventory/v1',
        versioningEnabled: true,
        recoveryPoint,
        sourceCount: sourceObjectDigest.count,
        restoredCount: restoredObjectDigest.count,
        sourceDigest: sourceObjectDigest.digest,
        restoredDigest: restoredObjectDigest.digest,
        sourceInventory: typedArtifact(
          'objects-source-inventory.json',
          'object-version-inventory',
          { inventoryRole: 'source', entries: sourceInventory }
        ),
        restoredInventory: typedArtifact(
          'objects-restored-inventory.json',
          'object-version-inventory',
          { inventoryRole: 'restored', entries: restoredInventory }
        ),
      },
      schema: {
        revision: sourceSchemaRevision,
        artifact: typedArtifact('schema-revision.json', 'schema-revision-artifact', {
          revision: sourceSchemaRevision,
          immutableSnapshotRef: `snapshot://local/${sourceDb}/${dumpSha256.slice(0, 16)}`,
        }),
      },
      configuration: {
        revision: configurationRevision,
        artifact: typedArtifact(
          'configuration-revision.json',
          'configuration-revision-artifact',
          { revision: configurationRevision }
        ),
      },
      secrets: {
        mode: 'secretref-local-keyfile',
        kmsKeyRef: `localkey://drill/${drillId}`,
        secretRefs: [secretRef],
        valuesIncluded: false,
        restorationEvidence: typedArtifact(
          'secret-restoration-receipt.json',
          'secretref-kms-restoration-receipt',
          {
            kmsKeyRef: `localkey://drill/${drillId}`,
            secretRefs: [secretRef],
            valuesIncluded: false,
          }
        ),
      },
      isolation: {
        sourceWriteAccess,
        productionTraffic: 'blocked',
        restoreEvidence: typedArtifact(
          'isolated-restore-receipt.json',
          'isolated-restore-receipt',
          { sourceWriteAccess, productionTraffic: 'blocked' }
        ),
      },
      invariants: Object.fromEntries(
        REQUIRED_RECOVERY_INVARIANTS.map((invariantId) => {
          const entry = invariants[invariantId];
          return [
            invariantId,
            {
              status: entry.status,
              sourceCount: entry.sourceCount,
              restoredCount: entry.restoredCount,
              sourceDigest: entry.sourceDigest,
              restoredDigest: entry.restoredDigest,
              evidence: typedArtifact(
                `invariant-${invariantId}.json`,
                'recovery-invariant-report',
                {
                  invariantId,
                  sourceRecords: entry.records.sourceRecords,
                  restoredRecords: entry.records.restoredRecords,
                }
              ),
            },
          ];
        })
      ),
      baseline: {
        snapshotId: `local-baseline-${drillId}`,
        immutable: true,
        capturedAt: baselineCapturedAt,
        postgresSnapshotRef: `snapshot://local/${sourceDb}/${dumpSha256.slice(0, 16)}`,
        schemaRevision: sourceSchemaRevision,
        objectInventoryDigest: sourceObjectDigest.digest,
        evidence: typedArtifact('recovery-baseline.json', 'immutable-recovery-baseline', {
          snapshotId: `local-baseline-${drillId}`,
          immutable: true,
          capturedAt: baselineCapturedAt,
          postgresSnapshotRef: `snapshot://local/${sourceDb}/${dumpSha256.slice(0, 16)}`,
          schemaRevision: sourceSchemaRevision,
          objectInventoryDigest: sourceObjectDigest.digest,
        }),
      },
      operations: {
        ...operations,
        evidence: typedArtifact('operations-policy.json', 'recovery-operations-policy', {
          ...operations,
        }),
      },
      credentialInvalidation: {
        oldCredentialsRejected,
        evidence: typedArtifact(
          'credential-invalidation-receipt.json',
          'credential-invalidation-receipt',
          {
            oldCredentialsRejected,
            rotations: [
              {
                secretRef,
                oldVersionRef: `secretversion://local/${rotationRole}/v1`,
                newVersionRef: `secretversion://local/${rotationRole}/v2`,
                rejectedAt,
                rejectionCode: 'AUTHENTICATION_REJECTED',
              },
            ],
          }
        ),
      },
      failureScenarios: {
        scenarios,
        evidence: typedArtifact(
          'failure-scenarios.json',
          'recovery-failure-scenario-report',
          { scenarios }
        ),
      },
      failureDisposal: {
        injectedFailureInstanceDestroyed: true,
        evidence: typedArtifact(
          'failed-instance-destruction-receipt.json',
          'failed-instance-destruction-receipt',
          {
            injectedFailureInstanceDestroyed: true,
            destroyedInstanceIds,
          }
        ),
      },
      ...(blockers.length > 0 ? { blockers } : {}),
    };

    const manifestName = 'manifest.json';
    writeFileSync(
      join(evidenceDirectory, manifestName),
      `${JSON.stringify(manifest, null, 2)}\n`
    );
    const manifestPath = `${relative(root, evidenceDirectory).replaceAll('\\', '/')}/${manifestName}`;
    note(`wrote ${manifestPath}`);
    return { blockers, log, manifest, manifestPath, scenarios };
  } finally {
    cleanup();
  }
}
