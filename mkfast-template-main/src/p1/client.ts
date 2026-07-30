import type { ApiEnvelope, P1ModuleRequest } from '@meiye/contracts';
import {
  correlatedApiErrorMessage,
  parseApiErrorEnvelope,
} from '@/lib/correlated-api-error';
import { emitTelemetry, telemetryFetch } from '@/lib/product-telemetry';
import { canonicalJsonString } from './canonical-json';

type P1Module = P1ModuleRequest['module'];

interface P1ModuleCall {
  action: string;
  payload?: Record<string, unknown>;
}

type OperationsCommandSubmit = (
  action: string,
  payload: Record<string, unknown>,
  idempotencyKey: string
) => Promise<unknown>;

export interface OperationsCommandIntentRegistry {
  execute<T = unknown>(
    action: string,
    payload: Record<string, unknown>
  ): Promise<T>;
}

export class P1RequestError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly details?: Record<string, unknown>,
    readonly status?: number
  ) {
    super(message);
    this.name = 'P1RequestError';
  }
}

export function p1ErrorCode(error: unknown) {
  return error instanceof P1RequestError ? error.code : undefined;
}

async function readEnvelope<T>(response: Response) {
  const envelope = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || 'error' in envelope) {
    const failure = parseApiErrorEnvelope(envelope, 'P1 request failed');
    throw new P1RequestError(
      correlatedApiErrorMessage(failure.message, failure.correlationId),
      failure.code,
      failure.details
    );
  }
  return envelope.data;
}

function moduleRequest(module: P1Module, call: P1ModuleCall): P1ModuleRequest {
  return {
    action: call.action,
    module,
    payload: call.payload ?? {},
  };
}

export async function queryP1<T>(
  module: P1Module,
  call: P1ModuleCall,
  signal?: AbortSignal
) {
  const request = moduleRequest(module, call);
  const response = await telemetryFetch('/api/core/p1/query', {
    body: JSON.stringify(request),
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    method: 'POST',
    signal,
  });
  if (response.status === 403) {
    emitTelemetry('permission_denied', {
      capability: 'p1.query',
      surface: `${module}.${call.action}`,
    });
  }
  try {
    return await readEnvelope<T>(response);
  } catch (error) {
    emitTelemetry('query_error', {
      action: call.action,
      errorCode: 'api_error',
      module,
    });
    throw error;
  }
}

export interface P1CommandWait {
  /** Caller cancellation — e.g. the TanStack Query signal for a stale key. */
  signal?: AbortSignal;
  /** Upper bound on the wait; omitted means wait as long as the fetch does. */
  timeoutMs?: number;
}

/**
 * A command that never returns leaves the caller with no state to render but
 * "still waiting", which is exactly how the Composer quote used to hang
 * forever (#240). A bounded wait turns that into a failure the caller can show
 * and retry. Caller cancellation is left alone — it is not a failure — so the
 * caller's own abort reason is forwarded untouched and only the deadline is
 * translated into a P1 error.
 *
 * Built from a plain AbortController rather than `AbortSignal.timeout` +
 * `AbortSignal.any`: this runs in the merchant's browser, and the in-app
 * WebViews this product is opened from still ship engines that predate those
 * two statics — where they would throw on every command instead of bounding it.
 */
function boundedCommandSignal(wait: P1CommandWait) {
  if (wait.timeoutMs == null) {
    return {
      expired: () => false,
      release: () => undefined,
      signal: wait.signal,
    };
  }
  const controller = new AbortController();
  // Ownership is recorded here, not inferred from the error later. A caller is
  // free to cancel with a `TimeoutError` of its own — its own deadline, a
  // higher-level watchdog — and reading the exception name would relabel that
  // as *our* bound and hand the merchant a retry for someone else's decision.
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    controller.abort(new DOMException('P1 command timed out.', 'TimeoutError'));
  }, wait.timeoutMs);
  const callerSignal = wait.signal;
  const forwardCallerAbort = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) {
    forwardCallerAbort();
  } else {
    callerSignal?.addEventListener('abort', forwardCallerAbort);
  }
  return {
    expired: () => expired,
    release: () => {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', forwardCallerAbort);
    },
    signal: controller.signal,
  };
}

export const P1_COMMAND_TIMEOUT_CODE = 'P1_COMMAND_TIMEOUT';

export async function commandP1<T>(
  module: P1Module,
  call: P1ModuleCall,
  idempotencyKey?: string,
  wait: P1CommandWait = {}
) {
  const request = moduleRequest(module, call);
  const requestId = idempotencyKey ?? crypto.randomUUID();
  const bounded = boundedCommandSignal(wait);
  // Held open across the body read, not just the round trip: a server that
  // sends headers and then stalls its body would otherwise leave the caller
  // waiting forever on `response.json()` with the timer already cleared — the
  // same permanent "requesting" this ticket removes, one layer down (#240 P1).
  try {
    let response: Response;
    try {
      response = await telemetryFetch('/api/core/p1/commands', {
        body: JSON.stringify(request),
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': requestId,
        },
        method: 'POST',
        signal: bounded.signal,
      });
    } catch (error) {
      // Caller cancellation and plain network failures are rethrown untouched;
      // only our own deadline becomes a P1 error.
      throw (
        commandDeadlineError(module, call, wait, bounded.expired()) ?? error
      );
    }
    if (response.status === 403) {
      emitTelemetry('permission_denied', {
        capability: 'p1.command',
        surface: `${module}.${call.action}`,
      });
    }
    try {
      return await readEnvelope<T>(response);
    } catch (error) {
      const deadline = commandDeadlineError(
        module,
        call,
        wait,
        bounded.expired()
      );
      if (deadline) throw deadline;
      emitTelemetry('query_error', {
        action: call.action,
        errorCode: 'api_error',
        module,
      });
      throw error;
    }
  } finally {
    bounded.release();
  }
}

/**
 * Translate our own deadline into a retryable P1 failure, or return null so the
 * caller sees the original error unchanged.
 *
 * Keyed on whether *our* timer fired, never on the exception's name: a caller
 * that cancels with its own `DOMException('…', 'TimeoutError')` is making a
 * decision about its own request, and dressing that up as `P1_COMMAND_TIMEOUT`
 * would tell the merchant the server was slow and offer a retry for something
 * nobody asked to retry.
 */
function commandDeadlineError(
  module: P1Module,
  call: P1ModuleCall,
  wait: P1CommandWait,
  expired: boolean
) {
  if (!expired) return null;
  emitTelemetry('query_error', {
    action: call.action,
    errorCode: 'timeout',
    module,
  });
  // Internal wording on purpose: what the merchant reads about a timed-out
  // quote is owned by `quote-readiness.ts`, not by the transport.
  return new P1RequestError(
    `P1 command ${module}.${call.action} timed out.`,
    P1_COMMAND_TIMEOUT_CODE,
    { timeoutMs: wait.timeoutMs }
  );
}

export function operationsQuery<T>(
  action: string,
  payload: Record<string, unknown> = {},
  signal?: AbortSignal
) {
  return queryP1<T>('operations', { action, payload }, signal);
}

export function operationsCommand<T>(
  action: string,
  payload: Record<string, unknown> = {},
  idempotencyKey: string = crypto.randomUUID()
) {
  return commandP1<T>('operations', { action, payload }, idempotencyKey);
}

export function createOperationsCommandIntentRegistry(
  createIdempotencyKey: () => string = () => crypto.randomUUID(),
  submit: OperationsCommandSubmit = operationsCommand
): OperationsCommandIntentRegistry {
  const pendingKeys = new Map<string, string>();
  return {
    async execute<T>(action: string, payload: Record<string, unknown>) {
      const fingerprint = canonicalJsonString([action, payload]);
      const idempotencyKey =
        pendingKeys.get(fingerprint) ?? createIdempotencyKey();
      pendingKeys.set(fingerprint, idempotencyKey);
      const result = await submit(action, payload, idempotencyKey);
      if (pendingKeys.get(fingerprint) === idempotencyKey) {
        pendingKeys.delete(fingerprint);
      }
      return result as T;
    },
  };
}
