import { drizzle } from 'drizzle-orm/postgres-js';
import { env } from 'cloudflare:workers';
import postgres from 'postgres';
import { schema } from './schema';
import {
  attachPostgresClientErrorSink,
  installPostgresConnectionProcessGuard,
} from './postgres-connection-safety';
import {
  DatabaseBindingUnavailableError,
  hasDatabaseBinding,
} from './runtime';

// V31-50: install once so capacity/socket errors cannot kill Node SSR.
installPostgresConnectionProcessGuard();

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
  // Align both pool construction sites: sink idle/close errors so they stay
  // request-scoped instead of becoming unhandled process killers (V31-50).
  attachPostgresClientErrorSink(client);

  return drizzle(client, { schema });
}

export function getDb() {
  return createDatabase();
}
