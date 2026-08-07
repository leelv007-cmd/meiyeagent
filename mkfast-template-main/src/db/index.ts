import { drizzle } from 'drizzle-orm/postgres-js';
import { env } from 'cloudflare:workers';
import postgres from 'postgres';
import { schema } from './schema';
import {
  DatabaseBindingUnavailableError,
  hasDatabaseBinding,
} from './runtime';

type MeiyeDb = ReturnType<typeof drizzle<typeof schema>>;

type DbGlobal = typeof globalThis & {
  __meiyeDb?: MeiyeDb;
  __meiyeDbConnectionString?: string;
  __meiyeDbClient?: ReturnType<typeof postgres>;
};

/**
 * One client per Worker isolate / local Node process.
 *
 * Hyperdrive docs recommend max:1 per isolate. Creating a fresh postgres.js
 * client on every getDb() call never ends the previous one, so local SSR
 * exhausts Postgres (`sorry, too many clients already`) after a few dozen
 * requests. Cache by connection string; HMR-safe via globalThis.
 */
function createDatabase(connectionString: string): MeiyeDb {
  const client = postgres(connectionString, {
    max: 1,
    prepare: false,
  });
  (globalThis as DbGlobal).__meiyeDbClient = client;
  return drizzle(client, { schema });
}

export function getDb() {
  if (!hasDatabaseBinding(env)) {
    throw new DatabaseBindingUnavailableError();
  }
  const connectionString = env.HYPERDRIVE.connectionString;
  const g = globalThis as DbGlobal;
  if (g.__meiyeDb && g.__meiyeDbConnectionString === connectionString) {
    return g.__meiyeDb;
  }
  const db = createDatabase(connectionString);
  g.__meiyeDb = db;
  g.__meiyeDbConnectionString = connectionString;
  return db;
}
