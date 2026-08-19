import {
  UnregisteredP1OperationError,
  apiEnvelopeSchema,
  isP1RegistryOwnedModule,
  merchantCreditDetailSchema,
  merchantSkillProjectionSchema,
  p1ModuleRequestSchema,
  publicProductQuoteSnapshotSchema,
  resolveP1ModuleOperation,
  type P1CommandAction,
  type P1Module,
  type P1ModuleCommandOutput,
  type P1ModuleQueryOutput,
  type P1ModuleRequest,
  type P1QueryAction,
  type P1RegistryOwnedModule,
} from '@meiye/contracts';
import { z } from 'zod';
import { registeredCoreOperationTimeoutMs } from '@/lib/core-request';
import { correlatedApiErrorMessage } from '@/lib/correlated-api-error';
import { merchantMessageFromP1 } from '@/p1/merchant-p1-error';
import { emitTelemetry, telemetryFetch } from '@/lib/product-telemetry';
import { contentPackageProjectionListSchema } from '@/product/content-package-presentation';

interface P1ModuleCall {
  action: string;
  payload?: Record<string, unknown>;
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

/**
 * TanStack Query retry policy for reads: a 4xx is the server's answer, not a
 * hiccup, and asking again only reprints it — in the browser console, once per
 * attempt. Server-side and transport failures keep the library's default three
 * attempts.
 */
export function retryP1QueryUnlessRejected(
  failureCount: number,
  error: unknown
) {
  const status = error instanceof P1RequestError ? error.status : undefined;
  if (status !== undefined && status >= 400 && status < 500) return false;
  return failureCount < 3;
}

const unknownResponseSchema = z.unknown();

const responseSchemas = new Map<string, z.ZodType>([
  ['entitlements.credit_detail', merchantCreditDetailSchema],
  ['operations.content_packages', contentPackageProjectionListSchema],
  ['product-billing.quote', publicProductQuoteSnapshotSchema],
  ['skills.merchant_skill_projection', merchantSkillProjectionSchema],
]);

function registeredOperationSchema(
  kind: 'query' | 'command',
  module: string,
  action: string
) {
  if (!isP1RegistryOwnedModule(module)) return undefined;
  try {
    return resolveP1ModuleOperation(module, action, kind).output;
  } catch (error) {
    if (error instanceof UnregisteredP1OperationError) {
      throw new P1RequestError(error.message, error.code);
    }
    throw error;
  }
}

function responseSchema(
  kind: 'query' | 'command',
  module: P1Module,
  action: string
) {
  return (
    registeredOperationSchema(kind, module, action) ??
    responseSchemas.get(`${module}.${action}`) ??
    unknownResponseSchema
  );
}

export function readP1Envelope<Schema extends z.ZodType>(
  response: Response,
  dataSchema: Schema,
  fallback?: string
): Promise<z.output<Schema>>;
export function readP1Envelope<T = unknown>(
  response: Response,
  dataSchema?: z.ZodType,
  fallback?: string
): Promise<T>;
export async function readP1Envelope(
  response: Response,
  dataSchema: z.ZodType = unknownResponseSchema,
  fallback = 'P1 request failed'
): Promise<unknown> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new P1RequestError(
      `${fallback} Response was not valid JSON.`,
      undefined,
      undefined,
      response.status
    );
  }
  const parsed = apiEnvelopeSchema(dataSchema).safeParse(body);
  if (!parsed.success) {
    throw new P1RequestError(
      `${fallback} Response envelope was invalid.`,
      undefined,
      undefined,
      response.status
    );
  }
  const envelope = parsed.data;
  if (!response.ok || 'error' in envelope) {
    const error = 'error' in envelope ? envelope.error : undefined;
    throw new P1RequestError(
      correlatedApiErrorMessage(
        merchantMessageFromP1({
          code: error?.code,
          message: error?.message,
          fallback,
        }),
        envelope.meta.correlationId
      ),
      error?.code,
      error?.details,
      response.status
    );
  }
  return envelope.data;
}

function moduleRequest(module: P1Module, call: P1ModuleCall): P1ModuleRequest {
  return p1ModuleRequestSchema.parse({
    action: call.action,
    module,
    payload: call.payload ?? {},
  });
}

export function queryP1<
  M extends P1RegistryOwnedModule,
  A extends string,
>(
  module: M,
  call: { action: A; payload?: Record<string, unknown> },
  signal?: AbortSignal
): Promise<A extends P1QueryAction<M> ? P1ModuleQueryOutput<M, A> : unknown>;
export function queryP1<T = unknown>(
  module: Exclude<P1Module, P1RegistryOwnedModule>,
  call: P1ModuleCall,
  signal?: AbortSignal
): Promise<T>;
export function queryP1(
  module: P1Module,
  call: P1ModuleCall,
  signal?: AbortSignal
): Promise<unknown>;
export async function queryP1(
  module: P1Module,
  call: P1ModuleCall,
  signal?: AbortSignal
) {
  const request = moduleRequest(module, call);
  const dataSchema = responseSchema('query', module, call.action);
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
    return await readP1Envelope(response, dataSchema);
  } catch (error) {
    emitTelemetry('query_error', {
      action: call.action,
      errorCode: 'api_error',
      module,
    });
    throw error;
  }
}

export interface P1RequestWait {
  /** Caller cancellation — e.g. the TanStack Query signal for a stale key. */
  signal?: AbortSignal;
  /** Upper bound on the wait; omitted means wait as long as the fetch does. */
  timeoutMs?: number;
}

export type P1CommandWait = P1RequestWait;

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
function registeredP1Wait(
  module: P1Module,
  action: string,
  wait: P1RequestWait
): P1RequestWait {
  if (wait.timeoutMs != null) return wait;
  const timeoutMs = registeredCoreOperationTimeoutMs(module, action);
  return timeoutMs == null ? wait : { ...wait, timeoutMs };
}

function boundedRequestSignal(wait: P1RequestWait) {
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

export const P1_QUERY_TIMEOUT_CODE = 'P1_QUERY_TIMEOUT';

/** Query seam with a caller-owned total deadline, including response-body read. */
export function boundedQueryP1<
  M extends P1RegistryOwnedModule,
  A extends string,
>(
  module: M,
  call: { action: A; payload?: Record<string, unknown> },
  wait: P1RequestWait
): Promise<A extends P1QueryAction<M> ? P1ModuleQueryOutput<M, A> : unknown>;
export function boundedQueryP1<T = unknown>(
  module: Exclude<P1Module, P1RegistryOwnedModule>,
  call: P1ModuleCall,
  wait: P1RequestWait
): Promise<T>;
export function boundedQueryP1(
  module: P1Module,
  call: P1ModuleCall,
  wait: P1RequestWait
): Promise<unknown>;
export async function boundedQueryP1(
  module: P1Module,
  call: P1ModuleCall,
  wait: P1RequestWait
) {
  wait = registeredP1Wait(module, call.action, wait);
  const bounded = boundedRequestSignal(wait);
  try {
    try {
      return await queryP1(module, call, bounded.signal);
    } catch (error) {
      if (!bounded.expired()) throw error;
      emitTelemetry('query_error', {
        action: call.action,
        errorCode: 'timeout',
        module,
      });
      throw new P1RequestError(
        `P1 query ${module}.${call.action} timed out.`,
        P1_QUERY_TIMEOUT_CODE,
        { timeoutMs: wait.timeoutMs }
      );
    }
  } finally {
    bounded.release();
  }
}

export const P1_COMMAND_TIMEOUT_CODE = 'P1_COMMAND_TIMEOUT';

export function commandP1<
  M extends P1RegistryOwnedModule,
  A extends string,
>(
  module: M,
  call: { action: A; payload?: Record<string, unknown> },
  idempotencyKey?: string,
  wait?: P1CommandWait
): Promise<A extends P1CommandAction<M> ? P1ModuleCommandOutput<M, A> : unknown>;
export function commandP1<T = unknown>(
  module: Exclude<P1Module, P1RegistryOwnedModule>,
  call: P1ModuleCall,
  idempotencyKey?: string,
  wait?: P1CommandWait
): Promise<T>;
export function commandP1(
  module: P1Module,
  call: P1ModuleCall,
  idempotencyKey?: string,
  wait?: P1CommandWait
): Promise<unknown>;
export async function commandP1(
  module: P1Module,
  call: P1ModuleCall,
  idempotencyKey?: string,
  wait: P1CommandWait = {}
) {
  wait = registeredP1Wait(module, call.action, wait);
  const request = moduleRequest(module, call);
  const dataSchema = responseSchema('command', module, call.action);
  const requestId = idempotencyKey ?? crypto.randomUUID();
  const bounded = boundedRequestSignal(wait);
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
      return await readP1Envelope(response, dataSchema);
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
