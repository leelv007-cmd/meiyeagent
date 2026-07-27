import type { ApiEnvelope, P1ModuleRequest } from '@meiye/contracts';
import {
  correlatedApiErrorMessage,
  parseApiErrorEnvelope,
} from '@/lib/correlated-api-error';
import { emitTelemetry, telemetryFetch } from '@/lib/product-telemetry';

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
    readonly details?: Record<string, unknown>
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
 * and retry. Caller cancellation is left alone — it is not a failure — so only
 * the deadline is translated into a P1 error.
 */
function boundedCommandSignal(wait: P1CommandWait) {
  if (wait.timeoutMs == null) return wait.signal;
  const deadline = AbortSignal.timeout(wait.timeoutMs);
  return wait.signal ? AbortSignal.any([wait.signal, deadline]) : deadline;
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
      signal: boundedCommandSignal(wait),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      emitTelemetry('query_error', {
        action: call.action,
        errorCode: 'timeout',
        module,
      });
      // Internal wording on purpose: what the merchant reads about a timed-out
      // quote is owned by `quote-readiness.ts`, not by the transport.
      throw new P1RequestError(
        `P1 command ${module}.${call.action} timed out.`,
        P1_COMMAND_TIMEOUT_CODE,
        { timeoutMs: wait.timeoutMs }
      );
    }
    throw error;
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
    emitTelemetry('query_error', {
      action: call.action,
      errorCode: 'api_error',
      module,
    });
    throw error;
  }
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
      const fingerprint = JSON.stringify([
        action,
        canonicalIntentValue(payload),
      ]);
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

function canonicalIntentValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalIntentValue);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalIntentValue(entry)])
    );
  }
  return value;
}
