import { drizzle } from 'drizzle-orm/postgres-js';
import { env } from 'cloudflare:workers';
import postgres from 'postgres';
import { schema } from './schema';
import {
  DatabaseBindingUnavailableError,
  hasDatabaseBinding,
} from './runtime';

function createDatabase() {
  if (!hasDatabaseBinding(env)) {
    throw new DatabaseBindingUnavailableError();
  }
  const client = postgres(env.HYPERDRIVE.connectionString, {
    max: 1,
    prepare: false,
  });

  return drizzle(client, { schema });
}

export function getDb() {
  return createDatabase();
}
