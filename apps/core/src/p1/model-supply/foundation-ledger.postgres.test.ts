import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { P1ApplicationService } from '../foundation/application-service.js';
import { PostgresFoundationRepository } from '../foundation/postgres-repository.js';
import { FoundationModelSupplyLedger } from './foundation-ledger.js';
import {
  ModelSupplyApplicationService,
  RecordedProviderExecutionPort,
  type CatalogModel,
  type ModelDeployment,
  type ProviderExecutionPort,
} from './index.js';

const connectionString = process.env.TEST_DATABASE_URL;

test(
  'Postgres commits the dispatch checkpoint before the provider and settles one authoritative ledger',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async (t) => {
    const pool = new Pool({ connectionString });
    const suffix = randomUUID();
    const workspaceId = `model-ledger-workspace-${suffix}`;
    const userId = `model-ledger-owner-${suffix}`;
    const repository = new PostgresFoundationRepository(pool);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "user" (
        id text PRIMARY KEY,
        name text NOT NULL,
        email text NOT NULL UNIQUE,
        email_verified boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS workspaces (
        id text PRIMARY KEY,
        name text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS workspace_memberships (
        workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id text NOT NULL,
        role text NOT NULL DEFAULT 'owner',
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS p1_usage_events (
        workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        id text NOT NULL,
        resource text NOT NULL,
        action text NOT NULL,
        amount integer NOT NULL,
        reservation_id text,
        reason text NOT NULL,
        actor_id text NOT NULL,
        correlation_id text NOT NULL,
        created_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, id)
      );
      ALTER TABLE p1_usage_events
        DROP CONSTRAINT IF EXISTS p1_usage_events_amount_check;
      ALTER TABLE p1_usage_events
        ADD CONSTRAINT p1_usage_events_amount_check
        CHECK (amount <> 0) NOT VALID;
    `);
    await repository.migrate();
    await pool.query(
      `INSERT INTO "user" (id, name, email) VALUES ($1, 'Ledger owner', $2)`,
      [userId, `${userId}@example.test`],
    );
    await pool.query(
      `INSERT INTO workspaces (id, name) VALUES ($1, 'Ledger test')`,
      [workspaceId],
    );
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'owner')`,
      [workspaceId, userId],
    );
    t.after(async () => {
      await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
      await pool.query('DELETE FROM "user" WHERE id = $1', [userId]);
      await pool.end();
    });

    const model: CatalogModel = {
      id: 'seedream-5-pro',
      modality: 'image',
      operations: ['image.generate'],
      displayName: 'Seedream 5.0 Pro',
      qualityRank: 90,
    };
    const deployment: ModelDeployment = {
      id: 'seedream-5-pro-direct',
      catalogModelId: model.id,
      apiFamily: 'image',
      channel: 'direct',
      region: 'domestic',
      status: 'active',
      policyRevision: 'policy-cn-v1',
      priceRevision: 'price-cn-v2',
      credentialMode: 'platform',
      credentialVersion: 'secret-version-3',
    };
    let executions = 0;
    const execution: ProviderExecutionPort = {
      async execute(request) {
        executions += 1;
        const checkpoint = await pool.query<{
          job_status: string;
          acceptance: string;
          usage_action: string;
        }>(
          `SELECT jobs.status AS job_status, attempts.acceptance,
                  usage.action AS usage_action
             FROM p1_generation_jobs jobs
             JOIN p1_provider_attempts attempts
               ON attempts.workspace_id = jobs.workspace_id
              AND attempts.job_id = jobs.id
             JOIN p1_usage_events usage
               ON usage.workspace_id = jobs.workspace_id
              AND usage.reservation_id = jobs.usage_reservation_id
            WHERE jobs.workspace_id = $1 AND jobs.id = $2
              AND usage.action = 'reserve'`,
          [workspaceId, request.jobId],
        );
        assert.deepEqual(checkpoint.rows[0], {
          job_status: 'running',
          acceptance: 'pending',
          usage_action: 'reserve',
        });
        return new RecordedProviderExecutionPort().execute(request);
      },
    };
    const foundation = new P1ApplicationService(repository);
    const ledger = new FoundationModelSupplyLedger(foundation, {
      async resolve() {
        return {
          revision: 'pro-pg-v1',
          tier: 'pro',
          allowance: { audio: 0, copy: 10, image: 10, video: 5 },
          concurrencyLimit: 4,
          queuePriority: 100,
          supportLabel: 'priority',
          addOns: [],
          autoTopUp: {
            enabled: false,
            monthlyCapMicros: 0,
            spentThisMonthMicros: 0,
          },
        };
      },
    });
    const application = new ModelSupplyApplicationService({
      models: [model],
      deployments: [deployment],
      execution,
      ledger,
    });
    const submission = {
      workspaceId,
      actorId: userId,
      idempotencyKey: 'postgres-model-ledger-1',
      operation: 'image.generate' as const,
      selection: { mode: 'fixed' as const, catalogModelId: model.id },
      dataClass: [],
      prompt: 'Postgres checkpoint',
    };

    const completed = await application.submit(submission);
    const restarted = new ModelSupplyApplicationService({
      models: [model],
      deployments: [deployment],
      execution,
      ledger,
    });
    const replayed = await restarted.submit(submission);
    const zeroUsage = await restarted.submit({
      ...submission,
      idempotencyKey: 'postgres-model-ledger-zero-usage',
      productUsageQuantity: 0,
      prompt: 'Postgres zero usage checkpoint',
    });

    assert.equal(replayed.asset?.sha256, completed.asset?.sha256);
    assert.equal(zeroUsage.usage.quantity, 0);
    assert.equal(executions, 2);
    assert.deepEqual(
      (
        await pool.query<{ action: string; amount: number }>(
          `SELECT action, amount FROM p1_usage_events
            WHERE workspace_id = $1 AND reservation_id = $2
            ORDER BY CASE action WHEN 'reserve' THEN 0 ELSE 1 END`,
          [workspaceId, zeroUsage.usage.id],
        )
      ).rows,
      [
        { action: 'reserve', amount: 0 },
        { action: 'commit', amount: 0 },
      ],
    );
    assert.match(
      (
        await pool.query<{ definition: string }>(
          `SELECT pg_get_constraintdef(oid) AS definition
             FROM pg_constraint
            WHERE conrelid = 'p1_usage_events'::regclass
              AND conname = 'p1_usage_events_amount_v2_check'`,
        )
      ).rows[0]?.definition ?? '',
      /amount >= 0/i,
    );
    assert.equal(
      (
        await pool.query(
          `SELECT count(*)::integer AS count FROM p1_provider_cost_events
            WHERE workspace_id = $1`,
          [workspaceId],
        )
      ).rows[0]?.count,
      2,
    );
    assert.equal(
      (
        await pool.query(
          `SELECT count(*)::integer AS count FROM p1_usage_events
            WHERE workspace_id = $1 AND action = 'commit'`,
          [workspaceId],
        )
      ).rows[0]?.count,
      2,
    );
  },
);
