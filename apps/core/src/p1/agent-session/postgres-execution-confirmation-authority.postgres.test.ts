import { Pool } from 'pg';

import { PostgresConfirmationAuthorityStore } from './execution-confirmation-authority-store.js';
import { runConfirmationAuthorityStoreConformance } from './execution-confirmation-authority-conformance.js';

const connectionString = process.env.TEST_DATABASE_URL;
const skip = connectionString ? false : 'TEST_DATABASE_URL is not configured';

runConfirmationAuthorityStoreConformance({
  label: 'postgres confirmation authority store',
  skip,
  createFixture: async () => {
    const pool = new Pool({ connectionString });
    const store = new PostgresConfirmationAuthorityStore(pool);
    await store.migrate();
    return {
      store,
      withTransaction: async (body) => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await body(client);
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      },
      dispose: async () => {
        await pool.query(
          `DELETE FROM p1_execution_confirmation_authorities
            WHERE workspace_id IN ('ws-conformance', 'ws-other')`,
        );
        await pool.end();
      },
    };
  },
});
