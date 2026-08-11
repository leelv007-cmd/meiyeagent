/**
 * V31-50: Request-scoped survival for Postgres connection/socket failures.
 *
 * postgres.js attaches its own socket 'error' listeners, but some SSR paths
 * still surface connection-capacity / idle-socket errors as unhandled 'error'
 * events that take down the whole Node process. Product rule: one failed
 * request must become a 5xx (or rejected promise), never process death.
 *
 * Do not increase max_connections or add retries here — those mask congestion.
 */

export type PostgresConnectionErrorLike = {
  code?: string;
  message?: string;
  severity?: string;
  name?: string;
};

/**
 * True for Postgres capacity / admin / idle-socket failures that must stay
 * request-scoped. Generic TCP peer resets (ECONNRESET without Postgres
 * signature) are left to the e2e HTTP socket guard — not this product path.
 */
export function isPostgresConnectionCapacityError(
  error: unknown,
): error is PostgresConnectionErrorLike {
  if (!error || typeof error !== 'object') return false;
  const err = error as PostgresConnectionErrorLike & {
    severity_local?: string;
    severity?: string;
  };
  if (err.code === '53300') return true;
  if (err.code === '57P01' || err.code === '57P03' || err.code === '08006') {
    return true;
  }
  const message =
    typeof err.message === 'string' ? err.message.toLowerCase() : '';
  if (message.includes('too many clients already')) return true;
  if (message.includes('sorry, too many clients')) return true;
  if (message.includes('connection terminated unexpectedly')) return true;
  if (message.includes('server closed the connection unexpectedly')) return true;
  if (err.name === 'PostgresError' && message.includes('connection')) return true;
  return false;
}

/**
 * Attach a no-throw sink so idle postgres.js sockets never emit unhandled
 * 'error'. Query failures still reject their own promises for request handlers.
 */
export function attachPostgresClientErrorSink(
  client: { options?: { onclose?: (id: number) => void } },
  log: (message: string, detail?: Record<string, unknown>) => void = defaultLog,
): void {
  const previous = client.options?.onclose;
  if (!client.options) return;
  client.options.onclose = (connId: number) => {
    try {
      previous?.(connId);
    } catch (error) {
      if (isPostgresConnectionCapacityError(error)) {
        log('postgres connection closed with capacity/transport error', {
          connId,
          code:
            error && typeof error === 'object' && 'code' in error
              ? String((error as { code?: unknown }).code ?? 'unknown')
              : 'unknown',
        });
        return;
      }
      throw error;
    }
  };
}

function defaultLog(message: string, detail?: Record<string, unknown>) {
  console.error(`[postgres-connection] ${message}`, detail ?? {});
}

let processGuardInstalled = false;

/**
 * Last-resort process survival for Node SSR: unhandled postgres connection
 * errors become logged non-fatal events so subsequent requests can still run.
 * Only connection-capacity / transport classes are swallowed; other errors exit.
 */
export function installPostgresConnectionProcessGuard(
  log: (message: string, detail?: Record<string, unknown>) => void = defaultLog,
): void {
  if (processGuardInstalled) return;
  if (typeof process === 'undefined' || typeof process.on !== 'function') {
    return;
  }
  processGuardInstalled = true;
  process.on('uncaughtException', (error) => {
    if (isPostgresConnectionCapacityError(error)) {
      log('suppressed unhandled postgres connection error; process continues', {
        code:
          error && typeof error === 'object' && 'code' in error
            ? String((error as { code?: unknown }).code ?? 'unknown')
            : 'unknown',
        name:
          error instanceof Error
            ? error.name
            : typeof error === 'object' &&
                error &&
                'name' in error &&
                typeof (error as { name?: unknown }).name === 'string'
              ? String((error as { name: string }).name)
              : 'Error',
      });
      return;
    }
    console.error(error);
    process.exit(1);
  });
}
