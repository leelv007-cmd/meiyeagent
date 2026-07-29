import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

import { Pool } from 'pg';

import { PostgresFoundationRepository } from '../foundation/postgres-repository.js';
import { PostgresIssue255LiveReceiptRepository } from './issue-255-postgres-live-receipt.js';

const businessUrl = process.env.TEST_DATABASE_URL;
const dbosUrl = process.env.TEST_DBOS_SYSTEM_DATABASE_URL;
const provisioner =
  '/Users/bin/.codex/monitors/issue-255-safe-provision.mjs';

test(
  'issue 255 conditional reset validates both targets before dropping either database',
  {
    skip:
      businessUrl && dbosUrl
        ? false
        : 'Issue 255 isolated database URLs are not configured',
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
  'issue 255 conditional reset inspects, refuses unsafe state, and drops both safe databases',
  {
    skip:
      businessUrl && dbosUrl
        ? false
        : 'Issue 255 isolated database URLs are not configured',
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
  mode: '--inspect' | '--cleanup-if-safe',
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
