import { drizzle } from 'drizzle-orm/postgres-js';
import { env } from 'cloudflare:workers';
import postgres from 'postgres';
import { schema } from './schema';
import {
  DatabaseBindingUnavailableError,
  hasDatabaseBinding,
} from './runtime';

/**
 * Hyperdrive + Workers local needs max:1 clients that do not outlive the
 * request. A process-wide singleton reuses Writable/I/O across CF request
 * contexts and throws:
 *   "Cannot perform I/O on behalf of a different request"
 *
 * Without idle_timeout, each getDb() also leaked a live connection until the
 * process exited (QA ISSUE-004: too many clients already). Short idle timeout
 * recycles unused clients while keeping one connection per active request.
 */
function createDatabase() {
  if (!hasDatabaseBinding(env)) {
    throw new DatabaseBindingUnavailableError();
  }
  const client = postgres(env.HYPERDRIVE.connectionString, {
    max: 1,
    prepare: false,
    // seconds — drop idle sockets so local Vite SSR cannot pin hundreds open
    idle_timeout: 5,
    max_lifetime: 60 * 5,
    connect_timeout: 10,
  });
  return drizzle(client, { schema });
}

export function getDb() {
  return createDatabase();
}
