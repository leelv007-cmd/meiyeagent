import assert from 'node:assert/strict';
import test from 'node:test';
import { Pool } from 'pg';

import { installContentPackageWriteBoundary } from './postgres-content-package-write-adapter.js';
import { PostgresOperationsRepository } from './postgres-repository.js';

const connectionString = process.env.TEST_DATABASE_URL;

test(
  'the ContentPackage write boundary revokes deliberately granted PUBLIC writes',
  { skip: !connectionString },
  async () => {
    const pool = new Pool({ connectionString });
    const role = `r05_unauthorized_${process.pid}_${Date.now()}`;
    assert.match(role, /^[a-z0-9_]+$/);
    const client = await pool.connect();
    try {
      await new PostgresOperationsRepository(pool).migrate();
      await client.query(`CREATE ROLE ${role} NOLOGIN`);
      await client.query(`GRANT SELECT ON p1_content_packages TO ${role}`);
      await client.query(
        'GRANT INSERT, UPDATE, DELETE ON p1_content_packages TO PUBLIC',
      );
      await client.query(`SET ROLE ${role}`);
      assert.equal(
        (
          await client.query(
            `UPDATE p1_content_packages
                SET updated_at = updated_at
              WHERE false`,
          )
        ).rowCount,
        0,
      );
      await client.query('RESET ROLE');
      await installContentPackageWriteBoundary(client);
      await client.query(`SET ROLE ${role}`);
      await assert.rejects(
        client.query(
          `UPDATE p1_content_packages
              SET updated_at = updated_at
            WHERE false`,
        ),
        (error: unknown) =>
          error instanceof Error &&
          'code' in error &&
          error.code === '42501',
      );
    } finally {
      await client.query('RESET ROLE').catch(() => undefined);
      await client
        .query(
          'REVOKE INSERT, UPDATE, DELETE ON p1_content_packages FROM PUBLIC',
        )
        .catch(() => undefined);
      await client.query(`DROP ROLE IF EXISTS ${role}`).catch(() => undefined);
      client.release();
      await pool.end();
    }
  },
);
