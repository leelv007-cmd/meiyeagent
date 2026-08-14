/**
 * V31-50: Request-scoped survival for Postgres connection/socket failures.
 *
 * postgres.js rejects the query that loses its connection and reconnects on a
 * later query. Product rule: catch that rejected query in its request owner so
 * one failed SSR request becomes a 5xx, never process-wide recovery.
 *
 * Do not increase max_connections or add retries here — those mask congestion.
 */

export type PostgresConnectionErrorLike = {
  code?: string;
  message?: string;
  severity?: string;
  name?: string;
};

export type PostgresRequestContext = {
  correlationId: string;
  route: string;
  workspaceId?: string;
  log?: PostgresConnectionLog;
};

export type PostgresConnectionLog = (
  message: string,
  detail?: Record<string, unknown>,
) => void;

/**
 * Deliberately contains no database message, host, or connection string: this
 * may cross the auth API and be rendered by an SSR error boundary.
 */
export class PostgresRequestUnavailableError extends Error {
  readonly code = 'POSTGRES_UNAVAILABLE';
  readonly statusCode = 503;

  constructor(
    readonly context: Pick<
      PostgresRequestContext,
      'correlationId' | 'route' | 'workspaceId'
    >,
    readonly databaseCode: string,
  ) {
    super('Database is temporarily unavailable. Please try again.');
    this.name = 'PostgresRequestUnavailableError';
  }

  get correlationId() {
    return this.context.correlationId;
  }
}

/**
 * True for Postgres capacity / admin / idle-socket failures that must stay
 * request-scoped. This predicate is used only around PostgreSQL query
 * promises, so the socket error codes cannot misclassify an unrelated HTTP
 * request.
 */
export function isPostgresConnectionCapacityError(
  error: unknown,
): error is PostgresConnectionErrorLike {
  if (!error || typeof error !== 'object') return false;
  const err = error as PostgresConnectionErrorLike & {
    severity_local?: string;
    severity?: string;
  };
  if (
    err.code === '53300' ||
    err.code === '57P01' ||
    err.code === '57P03' ||
    err.code === '08006' ||
    err.code === 'CONNECTION_CLOSED' ||
    err.code === 'ECONNRESET' ||
    err.code === 'EPIPE' ||
    err.code === 'ETIMEDOUT'
  ) {
    return true;
  }
  const message =
    typeof err.message === 'string' ? err.message.toLowerCase() : '';
  if (message.includes('too many clients already')) return true;
  if (message.includes('sorry, too many clients')) return true;
  if (message.includes('connection terminated unexpectedly')) return true;
  if (message.includes('server closed the connection unexpectedly')) return true;
  if (message.includes('socket hang up')) return true;
  if (message.includes('socket closed')) return true;
  if (err.name === 'PostgresError' && message.includes('connection')) return true;
  return false;
}

/**
 * Converts only PostgreSQL connection failures from a query promise into the
 * typed 503 consumed by the owning SSR/API request. Other failures preserve
 * their existing owner and semantics.
 */
export async function withPostgresRequestBoundary<T>(
  context: PostgresRequestContext,
  operation: () => Promise<T>,
  log: PostgresConnectionLog = context.log ?? defaultLog,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isPostgresConnectionCapacityError(error)) throw error;
    const databaseCode = postgresErrorCode(error);
    log('postgres request unavailable', {
      correlationId: context.correlationId,
      databaseCode,
      route: context.route,
      ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),
    });
    throw new PostgresRequestUnavailableError(context, databaseCode);
  }
}

function postgresErrorCode(error: PostgresConnectionErrorLike) {
  return typeof error.code === 'string' && error.code.length > 0
    ? error.code
    : 'UNKNOWN';
}

function defaultLog(message: string, detail?: Record<string, unknown>): void {
  console.error(`[postgres-connection] ${message}`, detail ?? {});
}

/**
 * V31-50: idle sockets can emit `error` off the query promise. Swallow
 * capacity/socket errors here so the isolate stays up; the next query still
 * fails through withPostgresRequestBoundary.
 */
export function bindPostgresClientSocketErrors(client: {
  on?: (event: string, listener: (error: unknown) => void) => unknown;
}): void {
  if (typeof client.on !== 'function') return;
  client.on('error', (error) => {
    if (isPostgresConnectionCapacityError(error)) return;
  });
}
