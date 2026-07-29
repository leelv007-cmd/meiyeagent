import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { Pool } from 'pg';

import { PostgresFoundationRepository } from '../foundation/postgres-repository.js';
import { PostgresIssue255LiveReceiptRepository } from './issue-255-postgres-live-receipt.js';

const businessUrl = process.env.TEST_DATABASE_URL;
const dbosUrl = process.env.TEST_DBOS_SYSTEM_DATABASE_URL;
const provisioner =
  process.env.ISSUE_255_SAFE_PROVISIONER_PATH?.trim() ||
  '/Users/bin/.codex/monitors/issue-255-safe-provision.mjs';
const provisionerSkip =
  process.env.RUN_ISSUE_255_SAFE_PROVISION_POSTGRES_TEST !== '1'
    ? 'Issue 255 destructive safe-provision test requires explicit opt-in'
    : !businessUrl || !dbosUrl
      ? 'Issue 255 isolated database URLs are not configured'
      : !existsSync(provisioner)
        ? 'Issue 255 safe provisioner is not available'
        : false;

test(
  'issue 255 conditional reset validates both targets before dropping either database',
  {
    skip: provisionerSkip,
  },
  async () => {
    const business = new Pool({ connectionString: businessUrl, max: 1 });
    const dbos = new Pool({ connectionString: dbosUrl, max: 1 });
    const unexpectedDbosUrl = new URL(dbosUrl!);
    unexpectedDbosUrl.pathname = '/postgres';
    const unexpectedDbos = new Pool({
      connectionString: unexpectedDbosUrl.toString(),
      max: 1,
    });

    try {
      await business.query('SELECT 1');
      await dbos.query('SELECT 1');
      await unexpectedDbos.query('SELECT 1');

      const refusedCleanup = runProvisioner('--cleanup-if-safe', {
        TEST_DBOS_SYSTEM_DATABASE_URL: unexpectedDbosUrl.toString(),
      });
      assert.notEqual(refusedCleanup.status, 0);
      assert.match(
        refusedCleanup.stderr,
        /cleanup refused an unexpected database name/u,
      );

      await business.query('SELECT 1');
      await dbos.query('SELECT 1');
    } finally {
      await unexpectedDbos.end();
      await business.end();
      await dbos.end();
    }
  },
);

test(
  'issue 255 conditional reset rejects every unsafe or unknown predicate before mutation',
  {
    skip: provisionerSkip,
  },
  async () => {
    const business = new Pool({ connectionString: businessUrl, max: 2 });
    const dbos = new Pool({ connectionString: dbosUrl, max: 1 });
    const foundation = new PostgresFoundationRepository(business);
    const receipts = new PostgresIssue255LiveReceiptRepository(business);

    try {
      await foundation.migrate();
      await receipts.migrate();
      await receipts.claimFreshLiveRunOwner(
        `issue-255-predicate-${randomUUID()}`,
      );

      await business.query(
        'ALTER TABLE issue255_live_generation_authorizations RENAME TO issue255_live_generation_authorizations_missing_probe',
      );
      try {
        const missingSchemaInspection = inspectResetSafety();
        assert.equal(missingSchemaInspection.inspectionComplete, false);
        assert.equal(missingSchemaInspection.receiptCount, null);
        await assertCleanupRefusedAndDatabasesStayReachable(
          business,
          dbos,
        );
      } finally {
        await business.query(
          'ALTER TABLE issue255_live_generation_authorizations_missing_probe RENAME TO issue255_live_generation_authorizations',
        );
      }

      const collector = spawn(
        process.execPath,
        [
          '-e',
          'setInterval(() => {}, 1000)',
          'issue-255-live-collector-cli-entry.ts',
        ],
        { stdio: 'ignore' },
      );
      await once(collector, 'spawn');
      try {
        const inspection = inspectResetSafety();
        assert.ok(
          typeof inspection.collectorProcessCount === 'number' &&
            inspection.collectorProcessCount >= 1,
        );
        assert.equal(inspection.collectorStopped, false);
        await assertCleanupRefusedAndDatabasesStayReachable(
          business,
          dbos,
        );
      } finally {
        const collectorExited = once(collector, 'exit');
        collector.kill();
        await collectorExited;
      }

      const receiptNonce = `issue-255-receipt-${randomUUID()}`;
      await business.query(
        `INSERT INTO issue255_live_generation_receipts (
           workspace_id,
           run_nonce,
           modality,
           effect_id,
           request_fingerprint,
           adapter,
           deployment_id,
           provider_idempotency_key,
           provider_job_id,
           provider_attempt_id,
           provider_cost_event_id,
           recorded_matrix_digest,
           reserved_amount_micros,
           price_revision,
           exchange_revision,
           status
         )
         VALUES (
           $1, $2, 'copy', $3, $4, 'direct-copy', $5, $6, $7, $8, $9,
           $10, 1, $11, 'native-cny-v1', 'claimed'
         )`,
        [
          `issue-255-live-${randomUUID()}`,
          receiptNonce,
          'd'.repeat(64),
          'e'.repeat(64),
          'issue-255-test-deployment',
          'issue-255-test-idempotency',
          `issue-255-job-${randomUUID()}`,
          `issue-255-attempt-${randomUUID()}`,
          `issue-255-cost-${randomUUID()}`,
          'f'.repeat(64),
          'issue-255-test-price',
        ],
      );
      assert.equal(inspectResetSafety().receiptCount, 1);
      await assertCleanupRefusedAndDatabasesStayReachable(business, dbos);
      await business.query(
        'DELETE FROM issue255_live_generation_receipts WHERE run_nonce = $1',
        [receiptNonce],
      );

      const operationalWorkspace =
        `issue-255-live-operational-${randomUUID()}`;
      await business.query(
        `INSERT INTO workspaces (id, name)
         VALUES ($1, 'Issue 255 operational predicate')`,
        [operationalWorkspace],
      );
      const operationalInspection = inspectResetSafety();
      assert.equal(operationalInspection.liveOperationalFactCount, 1);
      assert.equal(operationalInspection.issue255ProviderCostCount, 0);
      await assertCleanupRefusedAndDatabasesStayReachable(business, dbos);
      await business.query('DELETE FROM workspaces WHERE id = $1', [
        operationalWorkspace,
      ]);

      const costWorkspace = `issue-255-live-cost-${randomUUID()}`;
      await insertProviderCostPredicate(
        business,
        foundation,
        costWorkspace,
      );
      const costInspection = inspectResetSafety();
      assert.equal(costInspection.issue255ProviderCostCount, 1);
      assert.ok(
        typeof costInspection.liveOperationalFactCount === 'number' &&
          costInspection.liveOperationalFactCount >= 3,
      );
      await assertCleanupRefusedAndDatabasesStayReachable(business, dbos);
      await business.query('DELETE FROM workspaces WHERE id = $1', [
        costWorkspace,
      ]);

      await business.query(
        'ALTER TABLE p1_provider_cost_events RENAME TO p1_provider_cost_events_issue255_probe',
      );
      await business.query(`
        CREATE FUNCTION issue255_fail_cost_scan()
        RETURNS SETOF p1_provider_cost_events_issue255_probe
        LANGUAGE plpgsql
        AS $$
        BEGIN
          RAISE EXCEPTION 'issue 255 forced inspection failure';
        END
        $$
      `);
      await business.query(`
        CREATE VIEW p1_provider_cost_events AS
        SELECT * FROM issue255_fail_cost_scan()
      `);
      try {
        await assertCleanupRefusedAndDatabasesStayReachable(
          business,
          dbos,
        );
      } finally {
        await business.query('DROP VIEW p1_provider_cost_events');
        await business.query('DROP FUNCTION issue255_fail_cost_scan()');
        await business.query(
          'ALTER TABLE p1_provider_cost_events_issue255_probe RENAME TO p1_provider_cost_events',
        );
      }

      const psqlLookup = spawnSync('which', ['psql'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      assert.equal(psqlLookup.status, 0);
      const processProbePath = await mkdtemp(
        join(tmpdir(), 'issue-255-process-probe-'),
      );
      try {
        await symlink(
          psqlLookup.stdout.trim(),
          join(processProbePath, 'psql'),
        );
        const processInspection = inspectResetSafety({
          PATH: processProbePath,
        });
        assert.equal(processInspection.collectorProcessCount, null);
        assert.equal(processInspection.inspectionComplete, false);
        await assertCleanupRefusedAndDatabasesStayReachable(
          business,
          dbos,
          { PATH: processProbePath },
        );
      } finally {
        await rm(processProbePath, { force: true, recursive: true });
      }
    } finally {
      await business.query('DELETE FROM issue255_live_run_owners');
      await business.end();
      await dbos.end();
    }
  },
);

test(
  'issue 255 conditional reset inspects, refuses unsafe state, and drops both safe databases',
  {
    skip: provisionerSkip,
  },
  async () => {
    const business = new Pool({ connectionString: businessUrl, max: 2 });
    const dbos = new Pool({ connectionString: dbosUrl, max: 1 });

    try {
      await new PostgresFoundationRepository(business).migrate();
      const receipts = new PostgresIssue255LiveReceiptRepository(business);
      await receipts.migrate();
      await receipts.claimFreshLiveRunOwner(
        `issue-255-reset-${randomUUID()}`,
      );
      await dbos.query('SELECT 1');

      const safeInspection = runProvisioner('--inspect');
      assert.equal(safeInspection.status, 0);
      assert.deepEqual(JSON.parse(safeInspection.stdout), {
        authorizationCount: 0,
        businessDatabaseReachable: true,
        collectorProcessCount: 0,
        collectorStopped: true,
        dbosDatabaseReachable: true,
        inspectionComplete: true,
        issue255ProviderCostCount: 0,
        liveOperationalFactCount: 0,
        ownerCount: 1,
        ownerOnlyDurableFact: true,
        receiptCount: 0,
        resetSafe: true,
        submittedOrNonClaimedReceiptCount: 0,
      });

      await business.query(
        `INSERT INTO issue255_live_generation_authorizations (
           effect_id,
           run_nonce,
           modality,
           request_fingerprint,
           workspace_id,
           adapter,
           deployment_id,
           provider_idempotency_key,
           recorded_matrix_digest,
           reserved_amount_micros,
           price_revision,
           exchange_revision
         )
         VALUES ($1, $2, 'copy', $3, $4, $5, $6, $7, $8, 1, $9, $10)`,
        [
          'a'.repeat(64),
          `issue-255-unsafe-${randomUUID()}`,
          'b'.repeat(64),
          `issue-255-live-${randomUUID()}`,
          'direct-copy',
          'issue-255-test-deployment',
          'issue-255-test-idempotency',
          'c'.repeat(64),
          'issue-255-test-price',
          'native-cny-v1',
        ],
      );

      const refusedLegacyCleanup = runProvisioner('--cleanup');
      assert.notEqual(refusedLegacyCleanup.status, 0);
      assert.match(refusedLegacyCleanup.stderr, /Usage:/u);
      await business.query('SELECT 1');
      await dbos.query('SELECT 1');

      const refusedCleanup = runProvisioner('--cleanup-if-safe');
      assert.notEqual(refusedCleanup.status, 0);
      await business.query('SELECT 1');
      await dbos.query('SELECT 1');

      await business.query(
        'DELETE FROM issue255_live_generation_authorizations',
      );
    } finally {
      await business.end();
      await dbos.end();
    }

    const completedCleanup = runProvisioner('--cleanup-if-safe');
    assert.equal(completedCleanup.status, 0);
    assert.match(
      completedCleanup.stdout,
      /database cleanup residual count: 0/u,
    );
  },
);

function runProvisioner(
  mode: '--cleanup' | '--inspect' | '--cleanup-if-safe',
  environment: NodeJS.ProcessEnv = {},
) {
  return spawnSync(process.execPath, [provisioner, mode], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...environment,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function inspectResetSafety(environment: NodeJS.ProcessEnv = {}) {
  const inspection = runProvisioner('--inspect', environment);
  assert.equal(inspection.status, 0);
  return JSON.parse(inspection.stdout) as {
    collectorProcessCount: number | null;
    collectorStopped: boolean;
    inspectionComplete: boolean;
    issue255ProviderCostCount: number | null;
    liveOperationalFactCount: number | null;
    receiptCount: number | null;
  };
}

async function assertCleanupRefusedAndDatabasesStayReachable(
  business: Pool,
  dbos: Pool,
  environment: NodeJS.ProcessEnv = {},
) {
  const refusedCleanup = runProvisioner(
    '--cleanup-if-safe',
    environment,
  );
  assert.notEqual(refusedCleanup.status, 0);
  await business.query('SELECT 1');
  await dbos.query('SELECT 1');
}

async function insertProviderCostPredicate(
  business: Pool,
  foundation: PostgresFoundationRepository,
  workspaceId: string,
) {
  const nonce = randomUUID();
  const routeSnapshotId = `issue-255-route-${nonce}`;
  const jobId = `issue-255-job-${nonce}`;
  const attemptId = `issue-255-attempt-${nonce}`;
  const now = '2026-07-29T00:00:00.000Z';

  await business.query(
    `INSERT INTO workspaces (id, name)
     VALUES ($1, 'Issue 255 provider-cost predicate')`,
    [workspaceId],
  );
  await business.query(
    `INSERT INTO p1_route_snapshots (
       workspace_id, id, catalog_revision, policy_revision,
       price_revision, requested_catalog_model_id, selection_mode,
       data_class, data_classes, fallback_consent, allowed_candidates,
       created_at
     )
     VALUES (
       $1, $2, 'catalog-v1', 'policy-v1', 'price-v1', 'deepseek-v4-pro',
       'fixed', 'public', '["public"]'::jsonb, false, '[]'::jsonb,
       $3::timestamptz
     )`,
    [workspaceId, routeSnapshotId, now],
  );
  await foundation.insertGenerationJob({
    id: jobId,
    workspaceId,
    operation: 'copy',
    routeSnapshotId,
    usageReservationId: `issue-255-usage-${nonce}`,
    status: 'completed',
    createdBy: 'issue-255',
    correlationId: `issue-255-correlation-${nonce}`,
    createdAt: now,
    updatedAt: now,
  });
  await foundation.insertProviderAttempt({
    id: attemptId,
    workspaceId,
    jobId,
    ordinal: 1,
    deploymentId: 'issue-255-test-deployment',
    acceptance: 'accepted',
    status: 'completed',
    createdAt: now,
    updatedAt: now,
  });
  await foundation.appendProviderCost({
    id: `issue-255-cost-${nonce}`,
    workspaceId,
    attemptId,
    stage: 'observed',
    amountMicros: 1,
    currency: 'CNY',
    unit: 'token',
    evidence: 'issue-255-test',
    payer: 'platform',
    billingStatus: 'known',
    actorId: 'issue-255',
    correlationId: `issue-255-correlation-${nonce}`,
    createdAt: now,
  });
}
