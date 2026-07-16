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

export async function commandP1<T>(
  module: P1Module,
  call: P1ModuleCall,
  idempotencyKey?: string
) {
  const request = moduleRequest(module, call);
  const requestId = idempotencyKey ?? crypto.randomUUID();
  const response = await telemetryFetch('/api/core/p1/commands', {
    body: JSON.stringify(request),
    credentials: 'same-origin',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': requestId,
    },
    method: 'POST',
  });
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
