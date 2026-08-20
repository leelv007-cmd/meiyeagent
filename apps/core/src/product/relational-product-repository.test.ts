import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { Pool } from 'pg';
import { CutoverProductService } from './cutover-product-service.js';
import { PostgresProductRepository } from './postgres-repository.js';
import { PostgresRelationalProductRepository } from './relational-product-repository.js';
import { ProductService } from './product-service.js';
import type { CopyProviderRequest } from './copy-provider.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

describe(
  'Postgres relational product cutover',
  { skip: databaseUrl ? false : 'TEST_DATABASE_URL is not configured' },
  () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const workspaceId = `workspace-relational-${randomUUID()}`;
    const userId = `user-relational-${randomUUID()}`;
    const legacyRepository = new PostgresProductRepository(pool);
    const relationalRepository = new PostgresRelationalProductRepository(pool);
    const context = {
      actor: 'user' as const,
      correlationId: 'corr-relational-cutover',
      userId,
      workspaceId,
    };

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
      await legacyRepository.migrate();
      await relationalRepository.migrate();
      await pool.query(
        `INSERT INTO "user" (id, name, email)
         VALUES ($1, 'Relational product user', $2)`,
        [userId, `${userId}@example.test`]
      );
      await pool.query(
        `INSERT INTO workspaces (id, name) VALUES ($1, 'Relational product')`,
        [workspaceId]
      );
      await pool.query(
        `INSERT INTO workspace_memberships (workspace_id, user_id)
         VALUES ($1, $2)`,
        [workspaceId, userId]
      );
    });

    after(async () => {
      await pool.query(
        'DELETE FROM p1_product_command_results WHERE workspace_id = $1',
        [workspaceId]
      );
      await pool.query(
        'DELETE FROM p1_relation_facts WHERE workspace_id = $1',
        [workspaceId]
      );
      await pool.query(
        'DELETE FROM product_command_results WHERE workspace_id = $1',
        [workspaceId]
      );
      await pool.query('DELETE FROM product_states WHERE workspace_id = $1', [
        workspaceId,
      ]);
      await pool.query('DELETE FROM p1_write_ownership WHERE workspace_id = $1', [
        workspaceId,
      ]);
      await pool.query(
        'DELETE FROM workspace_memberships WHERE workspace_id = $1',
        [workspaceId]
      );
      await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
      await pool.query('DELETE FROM "user" WHERE id = $1', [userId]);
      await pool.end();
    });

    it('keeps legacy JSON immutable after P1 takes ownership and appends the complete journey as relation revisions', async () => {
      const legacyService = new ProductService({ repository: legacyRepository });
      await legacyService.execute(
        context,
        { hidden: true, type: 'hide_example' },
        'legacy-baseline'
      );
      const legacyHashBefore = await legacyStateHash();
      await pool.query(
        `INSERT INTO p1_write_ownership (workspace_id, owner)
         VALUES ($1, 'p1')
         ON CONFLICT (workspace_id) DO UPDATE SET owner = 'p1', updated_at = now()`,
        [workspaceId]
      );
      const relationalService = new ProductService({
        repository: relationalRepository,
        acceptedWriteOwner: 'p1',
      });
      const service = new CutoverProductService(
        legacyRepository,
        legacyService,
        relationalService
      );

      await service.execute(
        context,
        {
          store: {
            accounts: [
              { nickname: '关系事实测试店', platform: 'xiaohongshu' },
            ],
            address: '湖墅南路 88 号',
            booking: '提前一天预约',
            brandVoice: '真实、克制',
            city: '杭州',
            district: '拱墅区',
            name: '关系事实测试店',
            prohibitions: ['不虚构价格'],
            projects: [
              {
                confirmed: true,
                durationMinutes: 90,
                id: 'project-relational',
                name: '透亮猫眼',
                price: 299,
              },
            ],
            regulated: false,
          },
          type: 'confirm_store',
        },
        'p1-confirm-store'
      );
      await service.execute(
        context,
        {
          asset: {
            consentScope: 'internal_only',
            containsPerson: false,
            containsSensitiveData: false,
            id: 'asset-relational',
            mediaType: 'image',
            minorStatus: 'none',
            objectKey: `${workspaceId}/assets/cat-eye.jpg`,
            rightsOwner: '关系事实测试店',
            sourceType: 'real',
            tags: ['猫眼'],
          },
          type: 'add_asset',
        },
        'p1-add-asset'
      );
      await service.execute(
        context,
        {
          assetId: 'asset-relational',
          consentScope: 'public_marketing',
          rightsEvidence: 'owner-consent-asset-relational',
          type: 'authorize_asset',
        },
        'p1-authorize-asset'
      );
      const generated = await service.execute(
        context,
        {
          brief: {
            assetIds: ['asset-relational'],
            conversionGoal: '预约到店',
            hook: '阴天也透亮的猫眼',
            platform: 'xiaohongshu',
            projectId: 'project-relational',
            scenario: '项目种草',
            tone: '真实、克制',
          },
          type: 'generate_copy',
        },
        'p1-generate-copy'
      );
      const contentId = generated.output.candidateIds?.[0];
      assert.ok(contentId);
      await service.execute(
        context,
        { contentId, type: 'select_content' },
        'p1-select-content'
      );
      const handoff = await service.execute(
        context,
        { contentId, platform: 'xiaohongshu', type: 'create_handoff' },
        'p1-create-handoff'
      );
      const packageId = handoff.output.packageId;
      assert.ok(packageId);
      await service.execute(
        context,
        { packageId, type: 'mark_published' },
        'p1-mark-published'
      );
      assert.equal(await legacyStateHash(), legacyHashBefore);
      const stateBlobs = await pool.query(
        `SELECT id FROM p1_relation_facts
          WHERE workspace_id = $1
            AND (
              data->>'recordType' = 'product_state_revision'
              OR data ? 'state'
            )`,
        [workspaceId]
      );
      assert.equal(stateBlobs.rowCount, 0);
      await assert.rejects(
        service.execute(
          context,
          { contentId, type: 'select_content' },
          'p1-mark-published'
        ),
        (error: unknown) =>
          error instanceof Error &&
          'code' in error &&
          error.code === 'IDEMPOTENCY_CONFLICT'
      );
      const relationKinds = await pool.query<{ kind: string }>(
        `SELECT DISTINCT kind
           FROM p1_relation_facts
          WHERE workspace_id = $1
            AND data->>'recordType' = 'product_entity_revision'`,
        [workspaceId]
      );
      const kinds = new Set(relationKinds.rows.map((row) => row.kind));
      for (const kind of [
        'store',
        'project',
        'asset_rights',
        'content',
        'content_version',
        'platform_variant',
        'publish_package',
        'publish_record',
        'usage_event',
        'audit',
      ]) {
        assert.ok(kinds.has(kind), `expected a ${kind} relation revision`);
      }
      const legacyFacts = await pool.query(
        `SELECT id FROM p1_relation_facts
          WHERE workspace_id = $1 AND legacy_source IS NOT NULL`,
        [workspaceId]
      );
      assert.ok((legacyFacts.rowCount ?? 0) > 0);

      const p1FactsBeforeRollback = await p1FactFingerprint();
      await pool.query(
        `UPDATE p1_write_ownership SET owner = 'legacy', updated_at = now()
          WHERE workspace_id = $1`,
        [workspaceId]
      );
      await service.execute(
        context,
        { hidden: false, type: 'hide_example' },
        'legacy-after-rollback'
      );
      assert.equal(await p1FactFingerprint(), p1FactsBeforeRollback);
    });

    it('reclaims a stale copy execution through the relational P1 repository without duplicate facts', async () => {
      await pool.query(
        `UPDATE p1_write_ownership SET owner = 'p1', updated_at = now()
          WHERE workspace_id = $1`,
        [workspaceId]
      );
      const recoveryContext = {
        ...context,
        correlationId: `corr-relational-recovery-${randomUUID()}`,
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
      const jobs = new Map<string, Array<{
        assetOrder: string[];
        body: string;
        conversionHook: string;
        title: string;
        topics: string[];
      }>>();
      const calls: string[] = [];
      let billedJobs = 0;
      const provider = {
        name: 'relational-recovery-provider',
        model: 'relational-recovery-v1',
        region: 'local' as const,
        async generate(request: CopyProviderRequest) {
          calls.push(request.idempotencyKey);
          let job = jobs.get(request.idempotencyKey);
          if (!job) {
            billedJobs += 1;
            job = ['facts', 'experience', 'booking'].map((angle) => ({
              assetOrder: request.brief.assetIds,
              body: `${request.brief.hook} ${angle}`,
              conversionHook: angle,
              title: `${request.brief.hook}-${angle}`,
              topics: ['杭州美业'],
            }));
            jobs.set(request.idempotencyKey, job);
          }
          if (calls.length === 1) {
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
        repository: relationalRepository,
        copyProviders: providers,
        acceptedWriteOwner: 'p1',
        ...options,
      });
      const recoveryService = new ProductService({
        repository: relationalRepository,
        copyProviders: providers,
        acceptedWriteOwner: 'p1',
        ...options,
      });
      const command = {
        brief: {
          assetIds: ['asset-relational'],
          conversionGoal: '预约到店',
          hook: '关系仓库崩溃恢复',
          platform: 'xiaohongshu' as const,
          projectId: 'project-relational',
          scenario: '项目种草',
          tone: '真实、克制',
        },
        type: 'generate_copy' as const,
      };
      const idempotencyKey = `relational-copy-recovery-${randomUUID()}`;
      const original = firstService.execute(
        recoveryContext,
        command,
        idempotencyKey
      );
      await firstCallStarted;
      const pending = await pool.query<{
        result: { execution?: { providerModel?: string }; kind?: string };
      }>(
        `SELECT result FROM p1_product_command_results
          WHERE workspace_id = $1 AND idempotency_key = $2`,
        [workspaceId, idempotencyKey]
      );
      assert.equal(pending.rows[0]?.result.kind, 'pending');
      assert.equal(
        pending.rows[0]?.result.execution?.providerModel,
        provider.model
      );
      await assert.rejects(
        recoveryService.execute(recoveryContext, command, idempotencyKey),
        (error: unknown) =>
          error instanceof Error &&
          'code' in error &&
          error.code === 'COMMAND_IN_PROGRESS'
      );

      clock = new Date('2026-07-11T00:00:02.000Z');
      const recovered = await recoveryService.execute(
        recoveryContext,
        command,
        idempotencyKey
      );
      releaseFirstCall();
      const originalReplay = await original;

      assert.deepEqual(originalReplay.output, recovered.output);
      assert.equal(billedJobs, 1);
      assert.deepEqual(calls, [idempotencyKey, idempotencyKey]);
      assert.equal(recovered.output.candidateIds?.length, 3);
      assert.equal(
        recovered.state.agentRuns.filter(
          (run) => run.correlationId === recoveryContext.correlationId
        ).length,
        1
      );
      assert.deepEqual(
        recovered.state.usageEvents
          .filter(
            (event) =>
              event.correlationId === recoveryContext.correlationId
          )
          .map((event) => event.status),
        []
      );
      const terminal = await pool.query<{ result: { kind?: string } }>(
        `SELECT result FROM p1_product_command_results
          WHERE workspace_id = $1 AND idempotency_key = $2`,
        [workspaceId, idempotencyKey]
      );
      assert.equal(terminal.rows[0]?.result.kind, 'success');
    });

    async function legacyStateHash() {
      const result = await pool.query<{ hash: string }>(
        `SELECT md5(state::text) AS hash FROM product_states
          WHERE workspace_id = $1`,
        [workspaceId]
      );
      return result.rows[0]?.hash ?? '';
    }

    async function p1FactFingerprint() {
      const result = await pool.query<{ hash: string }>(
        `SELECT md5(string_agg(id || ':' || data::text, '|' ORDER BY id)) AS hash
           FROM p1_relation_facts WHERE workspace_id = $1`,
        [workspaceId]
      );
      return result.rows[0]?.hash ?? '';
    }
  }
);
