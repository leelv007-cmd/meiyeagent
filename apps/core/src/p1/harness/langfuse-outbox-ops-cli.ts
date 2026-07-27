import { Pool } from 'pg';

import { PostgresHarnessStore } from './postgres-store.js';

const [action, auditId] = process.argv.slice(2);
if (action !== 'replay' && action !== 'discard') {
  throw new Error('Usage: langfuse:outbox:ops <replay|discard> <audit-id>.');
}
if (!auditId?.trim()) throw new Error('An audit id is required.');
const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error('DATABASE_URL is required.');

const pool = new Pool({ connectionString });
try {
  const store = new PostgresHarnessStore(pool);
  const changed =
    action === 'replay'
      ? await store.replayLangfuseDeadLetter(auditId)
      : await store.discardLangfuseDeadLetter(auditId);
  if (!changed) {
    throw new Error(`No dead-letter Langfuse outbox row changed for ${auditId}.`);
  }
  console.log(`${action === 'replay' ? 'replayed' : 'discarded'} ${auditId}`);
} finally {
  await pool.end();
}
