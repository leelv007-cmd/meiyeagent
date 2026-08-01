import assert from 'node:assert/strict';
import test from 'node:test';

import { Pool } from 'pg';

import { P1ApplicationService } from '../foundation/application-service.js';
import type { P1Context } from '../foundation/domain.js';
import { PostgresFoundationRepository } from '../foundation/postgres-repository.js';
import { BEAUTY_FIXTURE_SENSITIVE_LEXICON } from './beauty-fixture-lexicon.js';
import { SensitiveWordsFoundationModule } from './foundation-module.js';
import { PostgresSensitiveWordsRepository } from './postgres-repository.js';

const connectionString = process.env.TEST_DATABASE_URL;

function quoteIdentifier(value: string): string {
  if (!/^[a-z0-9_]+$/u.test(value)) {
    throw new Error('Test schema identifier is invalid.');
  }
  return `"${value}"`;
}

class CrashBeforeModuleReceiptRepository extends PostgresFoundationRepository {
  private crashNextCompletion = false;

  crashNext() {
    this.crashNextCompletion = true;
  }

  override async completeModuleCommand<T>(
    context: P1Context,
    idempotencyKey: string,
    payloadHash: string,
    claimToken: string,
    value: T
  ) {
    if (this.crashNextCompletion) {
      this.crashNextCompletion = false;
      throw new Error('forced crash before module receipt completion');
    }
    return super.completeModuleCommand(
      context,
      idempotencyKey,
      payloadHash,
      claimToken,
      value
    );
  }
}

test(
  'Postgres repository migrates, rolls back partial seed, recovers, and persists CRUD',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async (t) => {
    const adminPool = new Pool({ connectionString });
    const schema = `issue_320_${process.pid}_${Date.now()}`;
    const schemaSql = quoteIdentifier(schema);
    await adminPool.query(`CREATE SCHEMA ${schemaSql}`);

    const pool = new Pool({
      connectionString,
      options: `-c search_path=${schema}`,
      max: 4,
    });
    const competingPool = new Pool({
      connectionString,
      options: `-c search_path=${schema}`,
      max: 2,
    });
    t.after(async () => {
      await Promise.all([pool.end(), competingPool.end()]);
      await adminPool.query(`DROP SCHEMA ${schemaSql} CASCADE`);
      await adminPool.end();
    });

    const repository = new PostgresSensitiveWordsRepository(pool);
    await pool.query(`
      CREATE TABLE workspaces (
        id text PRIMARY KEY,
        name text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    const foundation = new CrashBeforeModuleReceiptRepository(pool);
    await foundation.migrate();
    await repository.migrate();
    await repository.migrate();

    const workspaceId = 'issue-320-idempotency-workspace';
    await pool.query(
      `INSERT INTO workspaces (id, name) VALUES ($1, 'Issue 320 idempotency')`,
      [workspaceId]
    );
    const context: P1Context = {
      actor: 'admin',
      correlationId: 'issue-320-idempotency',
      userId: 'platform-admin',
      workspaceId,
    };
    const service = new P1ApplicationService(foundation, {
      operations: [new SensitiveWordsFoundationModule(repository)],
    });
    const freshService = () =>
      new P1ApplicationService(new PostgresFoundationRepository(pool), {
        operations: [
          new SensitiveWordsFoundationModule(
            new PostgresSensitiveWordsRepository(pool)
          ),
        ],
      });
    const expireOuterClaim = (idempotencyKey: string) =>
      pool.query(
        `UPDATE p1_module_commands
            SET lease_expires_at = now() - interval '1 second'
          WHERE workspace_id = $1 AND idempotency_key = $2`,
        [workspaceId, idempotencyKey]
      );
    const crashAfterBusinessWrite = async (
      idempotencyKey: string,
      action: 'create' | 'update' | 'delete',
      payload: Record<string, unknown>
    ) => {
      foundation.crashNext();
      await assert.rejects(
        service.executeModule(
          context,
          'sensitive-words',
          { action, payload },
          idempotencyKey
        ),
        /forced crash before module receipt completion/u
      );
      await expireOuterClaim(idempotencyKey);
    };

    await pool.query(`
      CREATE FUNCTION fail_issue_320_seed() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.id = 'sw-medical-001' THEN
          RAISE EXCEPTION 'forced baseline failure';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER fail_issue_320_seed
        BEFORE INSERT ON sensitive_words
        FOR EACH ROW EXECUTE FUNCTION fail_issue_320_seed();
    `);
    await assert.rejects(
      repository.ensurePlatformBaseline(),
      /forced baseline failure/u
    );
    const afterFailedSeed = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM sensitive_words'
    );
    assert.equal(afterFailedSeed.rows[0]?.count, '0');

    await pool.query(`
      DROP TRIGGER fail_issue_320_seed ON sensitive_words;
      DROP FUNCTION fail_issue_320_seed();
    `);
    const competitor = new PostgresSensitiveWordsRepository(competingPool);
    const seedResults = await Promise.all([
      repository.ensurePlatformBaseline(),
      competitor.ensurePlatformBaseline(),
    ]);
    assert.deepEqual(
      seedResults.map(({ seeded }) => seeded).sort((a, b) => a - b),
      [0, BEAUTY_FIXTURE_SENSITIVE_LEXICON.length]
    );
    const seeded = await repository.listEnabled();
    assert.equal(seeded.length, BEAUTY_FIXTURE_SENSITIVE_LEXICON.length);

    const created = await repository.create({
      word: '特效祛斑王',
      category: 'medical',
      replacements: ['专业色斑护理'],
      status: 'enabled',
    });
    assert.equal((await repository.get(created.id))?.word, '特效祛斑王');
    assert.equal((await repository.list({ q: '专业色斑' })).length, 1);

    const updated = await repository.update({
      id: created.id,
      word: '祛斑特效王',
      category: 'cosmetic',
      replacements: ['肤色护理'],
      status: 'disabled',
    });
    assert.equal(updated.category, 'cosmetic');
    assert.deepEqual(updated.replacements, ['肤色护理']);
    assert.equal(
      (await repository.listEnabled()).some(({ id }) => id === created.id),
      false
    );
    await assert.rejects(
      repository.create({
        word: '祛斑特效王',
        category: 'other',
        replacements: [],
        status: 'enabled',
      }),
      /duplicate key|unique constraint/iu
    );

    assert.deepEqual(await repository.delete(created.id), {
      id: created.id,
      deleted: true,
    });
    assert.equal(await repository.get(created.id), null);
    await assert.rejects(repository.delete(created.id), /not found/iu);

    await t.test('create replays the committed row after a receipt-completion crash', async () => {
      const idempotencyKey = 'sensitive-create-crash';
      const command = {
        word: '重放建档词',
        category: 'other',
        replacements: ['替代词'],
        status: 'enabled',
      } as const;
      await crashAfterBusinessWrite(idempotencyKey, 'create', command);
      const [persisted] = await repository.list({ q: command.word });
      assert.ok(persisted);

      const replayed = await freshService().executeModule(
        context,
        'sensitive-words',
        { action: 'create', payload: command },
        idempotencyKey
      );
      assert.deepEqual(replayed, persisted);
      assert.equal((await repository.list({ q: command.word })).length, 1);
    });

    await t.test('update replays the first committed revision after a receipt-completion crash', async () => {
      const target = await repository.create({
        word: '重放更新原词',
        category: 'other',
        replacements: [],
        status: 'enabled',
      });
      const idempotencyKey = 'sensitive-update-crash';
      const command = {
        id: target.id,
        replacements: ['稳定替代词'],
        status: 'disabled',
      } as const;
      await crashAfterBusinessWrite(idempotencyKey, 'update', command);
      const persisted = await repository.get(target.id);
      assert.ok(persisted);
      await pool.query('SELECT pg_sleep(0.01)');

      const replayed = await freshService().executeModule(
        context,
        'sensitive-words',
        { action: 'update', payload: command },
        idempotencyKey
      );
      assert.deepEqual(replayed, persisted);
    });

    await t.test('delete replays success after a receipt-completion crash', async () => {
      const target = await repository.create({
        word: '重放删除原词',
        category: 'other',
        replacements: [],
        status: 'enabled',
      });
      const idempotencyKey = 'sensitive-delete-crash';
      await crashAfterBusinessWrite(idempotencyKey, 'delete', {
        id: target.id,
      });
      assert.equal(await repository.get(target.id), null);

      assert.deepEqual(
        await freshService().executeModule(
          context,
          'sensitive-words',
          { action: 'delete', payload: { id: target.id } },
          idempotencyKey
        ),
        { id: target.id, deleted: true }
      );
    });

    await t.test('durable receipt rejects a different payload even without the outer receipt', async () => {
      const idempotencyKey = 'sensitive-payload-conflict';
      await service.executeModule(
        context,
        'sensitive-words',
        {
          action: 'create',
          payload: {
            word: '幂等绑定原词',
            category: 'other',
            replacements: [],
            status: 'enabled',
          },
        },
        idempotencyKey
      );
      await pool.query(
        `DELETE FROM p1_module_commands
          WHERE workspace_id = $1 AND idempotency_key = $2`,
        [workspaceId, idempotencyKey]
      );

      await assert.rejects(
        freshService().executeModule(
          context,
          'sensitive-words',
          {
            action: 'create',
            payload: {
              word: '幂等绑定异词',
              category: 'other',
              replacements: [],
              status: 'enabled',
            },
          },
          idempotencyKey
        ),
        (error: unknown) =>
          error instanceof Error &&
          'code' in error &&
          error.code === 'IDEMPOTENCY_CONFLICT'
      );

      const secondWorkspaceId = `${workspaceId}-second`;
      await pool.query(
        `INSERT INTO workspaces (id, name) VALUES ($1, 'Issue 320 second workspace')`,
        [secondWorkspaceId]
      );
      const crossWorkspace = await freshService().executeModule<
        Record<string, unknown>,
        { word: string }
      >(
        { ...context, workspaceId: secondWorkspaceId },
        'sensitive-words',
        {
          action: 'create',
          payload: {
            word: '幂等绑定跨工作区词',
            category: 'other',
            replacements: [],
            status: 'enabled',
          },
        },
        idempotencyKey
      );
      assert.equal(crossWorkspace.word, '幂等绑定跨工作区词');
    });
  }
);
