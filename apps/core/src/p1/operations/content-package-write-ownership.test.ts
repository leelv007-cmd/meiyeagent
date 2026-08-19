import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool, type PoolClient } from 'pg';
import { PostgresProductRepository } from '../../product/postgres-repository.js';
import {
  MemoryContentPackageWriteOwnership,
  PostgresContentPackageWriteOwnership,
} from './content-package-write-ownership.js';
import { PostgresOperationsRepository } from './postgres-repository.js';

const connectionString = process.env.TEST_DATABASE_URL;

test('gates the legacy baseline behind one durable migration claim', async () => {
  const statements: string[] = [];
  const client = {
    async query(statement: string) {
      statements.push(statement);
      return { rows: [] };
    },
  } as unknown as PoolClient;
  const ownership = new PostgresContentPackageWriteOwnership(
    {} as unknown as Pool
  );

  await ownership.migrate(client);

  assert.match(
    statements.join('\n'),
    /^\s*SELECT pg_advisory_xact_lock\(5570743275655394900\);\s*CREATE TABLE/u
  );
  assert.match(
    statements.join('\n'),
    /CREATE TABLE IF NOT EXISTS content_package_write_ownership_migrations/u
  );
  assert.match(
    statements.join('\n'),
    /WITH claimed_baseline AS \([\s\S]*INSERT INTO content_package_write_ownership_migrations[\s\S]*ON CONFLICT \(id\) DO NOTHING[\s\S]*RETURNING id[\s\S]*\)[\s\S]*INSERT INTO content_package_write_ownership[\s\S]*CROSS JOIN claimed_baseline/u
  );

  const memory = new MemoryContentPackageWriteOwnership();
  assert.equal(await memory.get('workspace-created-after-cutover'), null);
});

test(
  'keeps post-baseline workspaces on ContentPackage after concurrent migrations',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async (t) => {
    const admin = new Pool({ connectionString });
    const schema = `content_package_ownership_${randomUUID().replaceAll('-', '')}`;
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const pool = new Pool({
      connectionString,
      options: `-c search_path=${schema},public`,
    });
    t.after(async () => {
      await pool.end();
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
    });
    await pool.query(`
      CREATE TABLE workspaces (
        id text PRIMARY KEY,
        name text NOT NULL
      )
    `);
    await pool.query(
      `INSERT INTO workspaces (id, name)
       VALUES ('workspace-before-baseline', 'Before baseline')`
    );
    const ownership = new PostgresContentPackageWriteOwnership(pool);

    await Promise.all([ownership.migrate(), ownership.migrate()]);
    assert.equal(await ownership.get('workspace-before-baseline'), 'legacy');

    await pool.query(
      `INSERT INTO workspaces (id, name)
       VALUES ('workspace-after-baseline', 'After baseline')`
    );
    assert.equal(await ownership.get('workspace-after-baseline'), null);

    await ownership.set('workspace-after-baseline', 'contentpackage');
    await Promise.all([ownership.migrate(), ownership.migrate()]);
    assert.equal(
      await ownership.get('workspace-after-baseline'),
      'contentpackage'
    );
  }
);

test(
  'serializes Product and Operations writes on the same workspace advisory lock',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async (t) => {
    const pool = new Pool({ connectionString });
    t.after(() => pool.end());
    const workspaceId = `workspace-lock-${randomUUID()}`;
    const product = new PostgresProductRepository(pool);
    const operations = new PostgresOperationsRepository(pool);
    let releaseProduct = () => {};
    let markProductLocked = () => {};
    const productLocked = new Promise<void>((resolve) => {
      markProductLocked = resolve;
    });
    const productGate = new Promise<void>((resolve) => {
      releaseProduct = resolve;
    });
    const holdingProduct = product.withWorkspaceLock(
      workspaceId,
      async () => {
        markProductLocked();
        await productGate;
      }
    );
    await productLocked;
    let operationsAcquired = false;
    const waitingOperations = operations.withWorkspaceLock(
      workspaceId,
      async () => {
        operationsAcquired = true;
      }
    );

    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(operationsAcquired, false);
    releaseProduct();
    await Promise.all([holdingProduct, waitingOperations]);
    assert.equal(operationsAcquired, true);
  }
);
