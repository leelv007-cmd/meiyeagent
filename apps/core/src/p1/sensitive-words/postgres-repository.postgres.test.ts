import assert from 'node:assert/strict';
import test from 'node:test';

import { Pool } from 'pg';

import { BEAUTY_FIXTURE_SENSITIVE_LEXICON } from './beauty-fixture-lexicon.js';
import { PostgresSensitiveWordsRepository } from './postgres-repository.js';

const connectionString = process.env.TEST_DATABASE_URL;

function quoteIdentifier(value: string): string {
  if (!/^[a-z0-9_]+$/u.test(value)) {
    throw new Error('Test schema identifier is invalid.');
  }
  return `"${value}"`;
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
    await repository.migrate();
    await repository.migrate();

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
  }
);
