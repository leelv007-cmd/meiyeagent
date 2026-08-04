import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { Pool } from 'pg';
import { PostgresProductRepository } from './postgres-repository.js';
import { ProductService } from './product-service.js';
import type { CopyProviderRequest } from './copy-provider.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

describe('Postgres product repository', { skip: databaseUrl ? false : 'TEST_DATABASE_URL is not configured' }, () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const workspaceId = `workspace-${randomUUID()}`;
  const userId = `user-${randomUUID()}`;
  const repository = new PostgresProductRepository(pool);

  before(async () => {
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
    `);
    await repository.migrate();
    await pool.query(
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
       VALUES ($1, $2, $3, false, now(), now())`,
      [userId, 'Core test user', `${userId}@example.test`]
    );
    await pool.query('INSERT INTO workspaces (id, name) VALUES ($1, $2)', [workspaceId, 'Test workspace']);
    await pool.query(
      'INSERT INTO workspace_memberships (workspace_id, user_id) VALUES ($1, $2)',
      [workspaceId, userId]
    );
  });

  after(async () => {
    await pool.query('DELETE FROM product_command_results WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM product_states WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM workspace_memberships WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
    await pool.query('DELETE FROM "user" WHERE id = $1', [userId]);
    await pool.end();
  });

  it('persists workspace state and idempotent command output without leaking another member', async () => {
    const service = new ProductService({ repository });
    const context = {
      actor: 'user' as const,
      correlationId: 'corr-pg',
      userId,
      workspaceId,
    };
    const first = await service.execute(context, { type: 'hide_example', hidden: true }, 'hide-example');
    const duplicate = await service.execute(context, { type: 'hide_example', hidden: true }, 'hide-example');

    assert.ok(first.state.exampleStores.every((example) => example.hidden));
    assert.ok(duplicate.state.exampleStores.every((example) => example.hidden));
    assert.ok(
      (await service.bootstrap(context)).exampleStores.every(
        (example) => example.hidden
      )
    );
    await assert.rejects(
      service.execute(
        context,
        { type: 'hide_example', hidden: false },
        'hide-example'
      ),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'IDEMPOTENCY_CONFLICT'
    );
    const commandRecord = await pool.query<{
      payload_hash: string;
      result: { result?: { state?: unknown } };
    }>(
      `SELECT payload_hash, result FROM product_command_results
        WHERE workspace_id = $1 AND idempotency_key = 'hide-example'`,
      [workspaceId]
    );
    assert.match(commandRecord.rows[0]?.payload_hash ?? '', /^[a-f0-9]{64}$/);
    assert.equal(commandRecord.rows[0]?.result.result?.state, undefined);
    await assert.rejects(
      service.bootstrap({ ...context, userId: 'other-user' }),
      (error: unknown) =>
        error instanceof Error && 'code' in error && error.code === 'NOT_FOUND'
    );
  });

  it('rolls back state when the idempotency result cannot be persisted', async () => {
    const service = new ProductService({ repository });
    const context = {
      actor: 'user' as const,
      correlationId: 'corr-pg-atomic',
      userId,
      workspaceId,
    };
    const idempotencyKey = `force-result-failure-${randomUUID()}`;
    await pool.query(`
      CREATE OR REPLACE FUNCTION reject_product_result_for_test()
      RETURNS trigger AS $$
      BEGIN
        IF NEW.idempotency_key = '${idempotencyKey}' THEN
          RAISE EXCEPTION 'forced idempotency persistence failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS reject_product_result_for_test
        ON product_command_results;
      CREATE TRIGGER reject_product_result_for_test
      BEFORE INSERT ON product_command_results
      FOR EACH ROW EXECUTE FUNCTION reject_product_result_for_test();
    `);

    try {
      const before = await service.bootstrap(context);
      await assert.rejects(
        service.execute(
          context,
          { type: 'hide_example', hidden: !before.exampleStores[0]!.hidden },
          idempotencyKey
        ),
        /forced idempotency persistence failure/
      );
      const afterFailure = await service.bootstrap(context);
      assert.deepEqual(
        afterFailure.exampleStores.map((example) => example.hidden),
        before.exampleStores.map((example) => example.hidden)
      );
    } finally {
      await pool.query(`
        DROP TRIGGER IF EXISTS reject_product_result_for_test
          ON product_command_results;
        DROP FUNCTION IF EXISTS reject_product_result_for_test();
      `);
    }
  });

  it('persists enough copy execution state to reclaim a stale provider job exactly once', async () => {
    const context = {
      actor: 'user' as const,
      correlationId: `corr-pg-copy-${randomUUID()}`,
      userId,
      workspaceId,
    };
    let clock = new Date('2026-07-11T00:00:00.000Z');
    let releaseFirstCall = () => {};
    let markFirstCallStarted = () => {};
    const firstCallGate = new Promise<void>((resolve) => {
      releaseFirstCall = resolve;
    });
    const firstCallStarted = new Promise<void>((resolve) => {
      markFirstCallStarted = resolve;
    });
    const providerJobs = new Map<string, Array<{
      assetOrder: string[];
      body: string;
      conversionHook: string;
      title: string;
      topics: string[];
    }>>();
    const providerCalls: string[] = [];
    let billedJobs = 0;
    const provider = {
      name: 'postgres-recovery-provider',
      model: 'postgres-recovery-v1',
      region: 'local' as const,
      async generate(request: CopyProviderRequest) {
        providerCalls.push(request.idempotencyKey);
        let job = providerJobs.get(request.idempotencyKey);
        if (!job) {
          billedJobs += 1;
          job = ['facts', 'experience', 'booking'].map((angle) => ({
            assetOrder: request.brief.assetIds,
            body: `${request.brief.hook} ${angle}`,
            conversionHook: angle,
            title: `${request.brief.hook}-${angle}`,
            topics: ['杭州美业'],
          }));
          providerJobs.set(request.idempotencyKey, job);
        }
        if (providerCalls.length === 1) {
          markFirstCallStarted();
          await firstCallGate;
        }
        return job;
      },
    };
    const options = {
      copyExecutionClock: () => clock,
      copyExecutionLeaseMs: 1_000,
    };
    const providers = { domestic: provider, standard: provider };
    const firstService = new ProductService({
      repository,
      copyProviders: providers,
      acceptedWriteOwner: 'legacy',
      ...options,
    });
    const recoveryService = new ProductService({
      repository,
      copyProviders: providers,
      acceptedWriteOwner: 'legacy',
      ...options,
    });
    const suffix = randomUUID();
    await firstService.execute(
      context,
      {
        type: 'confirm_store',
        store: {
          name: 'Postgres recovery store',
          city: '杭州',
          district: '拱墅区',
          address: '测试路 1 号',
          booking: '预约制',
          brandVoice: '中性、克制',
          prohibitions: [],
          accounts: [],
          projects: [
            {
              id: `pg-copy-project-${suffix}`,
              name: '测试项目',
              price: 299,
              durationMinutes: 60,
              confirmed: true,
            },
          ],
          regulated: false,
        },
      },
      `pg-copy-store-${suffix}`,
    );
    await firstService.execute(
      context,
      {
        type: 'add_asset',
        asset: {
          consentScope: 'public_marketing',
          containsPerson: false,
          containsSensitiveData: false,
          id: `pg-copy-asset-${suffix}`,
          mediaType: 'image',
          minorStatus: 'none',
          objectKey: `${workspaceId}/pg-copy-${suffix}.png`,
          rightsOwner: 'Postgres recovery store',
          sourceType: 'real',
          tags: ['test'],
        },
      },
      `pg-copy-asset-${suffix}`,
    );
    const command = {
      type: 'generate_copy' as const,
      brief: {
        assetIds: [`pg-copy-asset-${suffix}`],
        conversionGoal: '预约到店',
        hook: 'Postgres 崩溃恢复',
        platform: 'xiaohongshu' as const,
        projectId: `pg-copy-project-${suffix}`,
        scenario: '项目种草',
        tone: '中性、克制',
      },
    };
    const idempotencyKey = `pg-copy-recovery-${suffix}`;
    const original = firstService.execute(context, command, idempotencyKey);
    await firstCallStarted;

    const pendingRecord = await pool.query<{
      result: {
        claimToken?: string;
        execution?: { providerModel?: string; reservationId?: string };
        kind?: string;
        leaseExpiresAt?: string;
      };
    }>(
      `SELECT result FROM product_command_results
        WHERE workspace_id = $1 AND idempotency_key = $2`,
      [workspaceId, idempotencyKey],
    );
    assert.equal(pendingRecord.rows[0]?.result.kind, 'pending');
    assert.equal(
      pendingRecord.rows[0]?.result.execution?.providerModel,
      provider.model,
    );
    assert.ok(pendingRecord.rows[0]?.result.execution?.reservationId);
    assert.ok(pendingRecord.rows[0]?.result.claimToken);
    assert.ok(pendingRecord.rows[0]?.result.leaseExpiresAt);
    await assert.rejects(
      recoveryService.execute(context, command, idempotencyKey),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'COMMAND_IN_PROGRESS',
    );

    clock = new Date('2026-07-11T00:00:02.000Z');
    const recovered = await recoveryService.execute(
      context,
      command,
      idempotencyKey,
    );
    releaseFirstCall();
    const originalReplay = await original;

    assert.deepEqual(originalReplay.output, recovered.output);
    assert.equal(billedJobs, 1);
    assert.deepEqual(providerCalls, [idempotencyKey, idempotencyKey]);
    assert.equal(recovered.output.candidateIds?.length, 3);
    assert.equal(
      recovered.state.agentRuns.filter(
        (run) =>
          run.correlationId === context.correlationId &&
          run.workflow === 'content.generate_copy',
      ).length,
      1,
    );
    assert.deepEqual(
      recovered.state.usageEvents
        .filter((event) => event.correlationId === context.correlationId)
        .map((event) => event.status),
      ['reserved', 'committed'],
    );
    const terminalRecord = await pool.query<{ result: { kind?: string } }>(
      `SELECT result FROM product_command_results
        WHERE workspace_id = $1 AND idempotency_key = $2`,
      [workspaceId, idempotencyKey],
    );
    assert.equal(terminalRecord.rows[0]?.result.kind, 'success');
  });
});
