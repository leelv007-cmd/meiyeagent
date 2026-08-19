const MAX_CORE_REQUEST_BYTES = 1024 * 1024;
const SAFE_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/u;
const STRUCTURED_COMMAND_RESOURCES = new Set(['p1/commands', 'p1/query']);

/** Default BFF budget for unregistered Core operations. Do not raise globally. */
export const DEFAULT_CORE_TIMEOUT_MS = 10_000;
export const CORE_TIMEOUT_CODE = 'CORE_TIMEOUT';
export const CORE_UNAVAILABLE_CODE = 'CORE_UNAVAILABLE';

/**
 * Per-operation Web/Core budgets. Quote is the shipped 12s entry; structured
 * commands (`module.action` on p1/commands and p1/query) and dedicated
 * submission routes resolve through this table instead of inheriting a raised
 * global default.
 */
export const CORE_OPERATION_TIMEOUT_MS = {
  'p1/composer/submissions': DEFAULT_CORE_TIMEOUT_MS,
  'product-billing.quote': 12_000,
} as const;

class CoreTimeoutError extends Error {
  constructor(
    readonly timeoutMs: number,
    options?: { cause?: unknown }
  ) {
    super(`Core request timed out after ${timeoutMs}ms.`, options);
    this.name = 'CoreTimeoutError';
  }
}

function coreOperationKey(resource: string, body?: string) {
  if (STRUCTURED_COMMAND_RESOURCES.has(resource)) {
    if (!body) return null;
    try {
      const parsed = JSON.parse(body) as {
        action?: unknown;
        module?: unknown;
      };
      if (
        typeof parsed.module === 'string' &&
        parsed.module.length > 0 &&
        typeof parsed.action === 'string' &&
        parsed.action.length > 0
      ) {
        return `${parsed.module}.${parsed.action}`;
      }
    } catch {
      return null;
    }
    return null;
  }
  return resource;
}

export function resolveCoreOperationTimeoutMs(resource: string, body?: string) {
  const key = coreOperationKey(resource, body);
  if (key && Object.hasOwn(CORE_OPERATION_TIMEOUT_MS, key)) {
    return CORE_OPERATION_TIMEOUT_MS[
      key as keyof typeof CORE_OPERATION_TIMEOUT_MS
    ];
  }
  return DEFAULT_CORE_TIMEOUT_MS;
}

export function registeredCoreOperationTimeoutMs(
  module: string,
  action: string
) {
  const key = `${module}.${action}`;
  if (Object.hasOwn(CORE_OPERATION_TIMEOUT_MS, key)) {
    return CORE_OPERATION_TIMEOUT_MS[
      key as keyof typeof CORE_OPERATION_TIMEOUT_MS
    ];
  }
  return undefined;
}

function isCallerAbortError(error: unknown) {
  if (error instanceof CoreTimeoutError) return false;
  return error instanceof Error && error.name === 'AbortError';
}

function coreTimeoutResponse(input?: {
  correlationId?: string;
  timeoutMs?: number;
}) {
  return coreBoundaryResponse({
    code: CORE_TIMEOUT_CODE,
    correlationId: input?.correlationId,
    details:
      input?.timeoutMs == null ? undefined : { timeoutMs: input.timeoutMs },
    message: 'Product Core timed out.',
    status: 504,
  });
}

function coreUnavailableResponse(correlationId?: string) {
  return coreBoundaryResponse({
    code: CORE_UNAVAILABLE_CODE,
    correlationId,
    message: 'Product Core unavailable.',
    status: 503,
  });
}

export function coreFetchFailureResponse(
  error: unknown,
  input?: { correlationId?: string }
) {
  if (error instanceof CoreTimeoutError) {
    return coreTimeoutResponse({
      correlationId: input?.correlationId,
      timeoutMs: error.timeoutMs,
    });
  }
  if (isCallerAbortError(error)) return null;
  return coreUnavailableResponse(input?.correlationId);
}

function coreBoundaryResponse(input: {
  code: typeof CORE_TIMEOUT_CODE | typeof CORE_UNAVAILABLE_CODE;
  correlationId?: string;
  details?: Record<string, unknown>;
  message: string;
  status: 503 | 504;
}) {
  return Response.json(
    {
      error: {
        code: input.code,
        message: input.message,
        ...(input.details ? { details: input.details } : {}),
      },
      ...(input.correlationId
        ? { meta: { correlationId: input.correlationId } }
        : {}),
    },
    { status: input.status }
  );
}

export class CoreRequestBoundaryError extends Error {
  constructor(
    readonly status: 400 | 413,
    readonly code: 'INVALID_IDEMPOTENCY_KEY' | 'REQUEST_BODY_TOO_LARGE',
    message: string
  ) {
    super(message);
    this.name = 'CoreRequestBoundaryError';
  }
}

export function forwardedCorrelationId(value: string | null) {
  return value && SAFE_REQUEST_ID.test(value)
    ? value
    : `corr-${crypto.randomUUID()}`;
}

export function forwardedIdempotencyKey(value: string | null) {
  if (!value) return crypto.randomUUID();
  const normalized = value.trim();
  if (!SAFE_REQUEST_ID.test(normalized)) {
    throw new CoreRequestBoundaryError(
      400,
      'INVALID_IDEMPOTENCY_KEY',
      'Idempotency-Key header is invalid.'
    );
  }
  return normalized;
}

export async function readRequestText(
  request: Request,
  maxBytes = MAX_CORE_REQUEST_BYTES
) {
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw requestBodyTooLarge(maxBytes);
  }
  if (!request.body) return '';

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesRead += value.byteLength;
    if (bytesRead > maxBytes) {
      await reader.cancel();
      throw requestBodyTooLarge(maxBytes);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/**
 * Binary sibling of `readRequestText`. A chunked upload carries no
 * `Content-Length`, so the ceiling can only be enforced while the stream is
 * being consumed: buffering first and checking afterwards means an
 * authenticated member decides how much Worker memory the proxy spends.
 */
export async function readRequestBytes(request: Request, maxBytes: number) {
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw requestBodyTooLarge(maxBytes);
  }
  if (!request.body) return new Uint8Array(0);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytesRead = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesRead += value.byteLength;
    if (bytesRead > maxBytes) {
      await reader.cancel();
      throw requestBodyTooLarge(maxBytes);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(bytesRead);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function coreFetch(
  fetcher: typeof fetch,
  input: Parameters<typeof fetch>[0],
  init: RequestInit,
  options: {
    idleTimeoutMs?: number;
    stream?: boolean;
    timeoutMs?: number;
  } = {}
) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_CORE_TIMEOUT_MS;
  if (!options.stream) {
    const deadline = AbortSignal.timeout(timeoutMs);
    try {
      return await fetcher(input, {
        ...init,
        signal: combinedSignal(init.signal, deadline),
      });
    } catch (error) {
      throw coreDeadlineError(error, init.signal, deadline, timeoutMs);
    }
  }

  const connectController = new AbortController();
  const connectTimer = setTimeout(
    () =>
      connectController.abort(
        new DOMException('Core stream connection timed out.', 'TimeoutError')
      ),
    timeoutMs
  );
  let response: Response;
  try {
    response = await fetcher(input, {
      ...init,
      signal: combinedSignal(init.signal, connectController.signal),
    });
  } catch (error) {
    throw coreDeadlineError(
      error,
      init.signal,
      connectController.signal,
      timeoutMs
    );
  } finally {
    clearTimeout(connectTimer);
  }
  if (!response.body) return response;
  return new Response(
    streamWithIdleTimeout(response.body, options.idleTimeoutMs ?? 60_000),
    {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    }
  );
}

export async function fetchCoreForResource(
  fetcher: typeof fetch,
  input: Parameters<typeof fetch>[0],
  init: RequestInit,
  options: {
    body?: string;
    correlationId?: string;
    idleTimeoutMs?: number;
    resource: string;
    stream?: boolean;
  }
) {
  try {
    return await coreFetch(fetcher, input, init, {
      idleTimeoutMs: options.idleTimeoutMs,
      stream: options.stream,
      timeoutMs: resolveCoreOperationTimeoutMs(options.resource, options.body),
    });
  } catch (error) {
    const response = coreFetchFailureResponse(error, {
      correlationId: options.correlationId,
    });
    if (!response) throw error;
    return response;
  }
}

function coreDeadlineError(
  error: unknown,
  callerSignal: AbortSignal | null | undefined,
  deadlineSignal: AbortSignal,
  timeoutMs: number
) {
  if (callerSignal?.aborted) return error;
  if (deadlineSignal.aborted) {
    return new CoreTimeoutError(timeoutMs, { cause: error });
  }
  return error;
}

function combinedSignal(
  callerSignal: AbortSignal | null | undefined,
  deadlineSignal: AbortSignal
) {
  return callerSignal
    ? AbortSignal.any([callerSignal, deadlineSignal])
    : deadlineSignal;
}

function requestBodyTooLarge(maxBytes: number) {
  return new CoreRequestBoundaryError(
    413,
    'REQUEST_BODY_TOO_LARGE',
    `Core proxy request body exceeds ${maxBytes} bytes.`
  );
}

function streamWithIdleTimeout(
  body: ReadableStream<Uint8Array>,
  timeoutMs: number
) {
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async cancel(reason) {
      await reader.cancel(reason);
    },
    async pull(controller) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          reader.read(),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new DOMException('Core stream became idle.', 'TimeoutError')
                ),
              timeoutMs
            );
          }),
        ]);
        if (result.done) controller.close();
        else controller.enqueue(result.value);
      } catch (error) {
        await reader.cancel(error).catch(() => undefined);
        controller.error(error);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  });
}

export function workspaceCoreFetchInit(
  request: Request,
  headers: Headers,
  body: string | undefined
): RequestInit {
  const lastEventId = request.headers.get('last-event-id');
  if (lastEventId) headers.set('last-event-id', lastEventId);
  return {
    body,
    headers,
    method: request.method,
    signal: request.signal,
  };
}

export type WorkspaceWorkflowEventResource = `p1/workflows/${string}/events`;
export type WorkspaceComposerDestinationResource =
  'p1/composer/destination-map';
export type WorkspaceComposerSubmissionResource = 'p1/composer/submissions';
export type WorkspaceComposerTaskStartResource =
  `p1/composer/tasks/${string}/start`;
export type WorkspaceComposerTaskReviseResource =
  `p1/composer/tasks/${string}/revise`;
export type WorkspaceComposerTaskAnswerResource =
  `p1/composer/tasks/${string}/answer`;
export type WorkspaceComposerTaskCancelResource =
  `p1/composer/tasks/${string}/cancel`;
export type WorkspaceCampaignPaidWorkResource =
  | 'p1/campaigns/paid-works'
  | `p1/campaigns/paid-works/${string}`;
export type WorkspaceAgentSemanticResource =
  `p1/agent-threads/${string}/${'events' | 'replay'}`;
export type WorkspaceHarnessTaskCollectionResource = 'p1/harness/tasks';
export type WorkspacePendingActionsResource = 'p1/pending-actions';
export type WorkspacePendingInterruptResource =
  | 'p1/pending-interrupts'
  | 'p1/interrupts/resume';
export type WorkspaceHarnessDecisionResource =
  `p1/harness/tasks/${string}/decision`;
export type WorkspaceHarnessInteractionResource =
  | `p1/harness/tasks/${string}/interaction`
  | `p1/harness/tasks/${string}/interaction/editing`
  | `p1/harness/tasks/${string}/interaction/message`
  | `p1/harness/tasks/${string}/interaction/renderer`
  | `p1/harness/tasks/${string}/interaction/v2/editing`
  | `p1/harness/tasks/${string}/interaction/v2/renderer`;
export type WorkspaceHarnessProductMetricResource =
  `p1/harness/tasks/${string}/product-metrics`;
export type WorkspaceConfirmationDecisionResource =
  `p1/confirmation-requests/${string}/decide`;

export function workspaceWorkflowEventResource(
  workflowId: string
): WorkspaceWorkflowEventResource {
  return `p1/workflows/${encodeURIComponent(workflowId)}/events`;
}

export function workspaceAgentSemanticResource(
  threadId: string,
  kind: 'events' | 'replay'
): WorkspaceAgentSemanticResource {
  return `p1/agent-threads/${encodeURIComponent(threadId)}/${kind}`;
}

export function workspaceComposerTaskStartResource(
  taskId: string
): WorkspaceComposerTaskStartResource {
  return `p1/composer/tasks/${encodeURIComponent(taskId)}/start`;
}

export function workspaceComposerTaskReviseResource(
  taskId: string
): WorkspaceComposerTaskReviseResource {
  return `p1/composer/tasks/${encodeURIComponent(taskId)}/revise`;
}

export function workspaceComposerTaskAnswerResource(
  taskId: string
): WorkspaceComposerTaskAnswerResource {
  return `p1/composer/tasks/${encodeURIComponent(taskId)}/answer`;
}

export function workspaceComposerTaskCancelResource(
  taskId: string
): WorkspaceComposerTaskCancelResource {
  return `p1/composer/tasks/${encodeURIComponent(taskId)}/cancel`;
}

export function workspaceHarnessDecisionResource(
  taskId: string
): WorkspaceHarnessDecisionResource {
  return `p1/harness/tasks/${encodeURIComponent(taskId)}/decision`;
}

export function workspaceHarnessInteractionResource(
  taskId: string,
  action?: 'editing' | 'message' | 'renderer' | 'v2/editing' | 'v2/renderer'
): WorkspaceHarnessInteractionResource {
  const base: `p1/harness/tasks/${string}/interaction` = `p1/harness/tasks/${encodeURIComponent(taskId)}/interaction`;
  if (action === 'editing') return `${base}/editing`;
  if (action === 'message') return `${base}/message`;
  if (action === 'renderer') return `${base}/renderer`;
  if (action === 'v2/editing') return `${base}/v2/editing`;
  if (action === 'v2/renderer') return `${base}/v2/renderer`;
  return base;
}

export function workspaceHarnessProductMetricResource(
  taskId: string
): WorkspaceHarnessProductMetricResource {
  return `p1/harness/tasks/${encodeURIComponent(taskId)}/product-metrics`;
}

export function workspaceConfirmationDecisionResource(
  requestId: string
): WorkspaceConfirmationDecisionResource {
  return `p1/confirmation-requests/${encodeURIComponent(requestId)}/decide`;
}

export function workspaceCoreUpstreamPath(
  workspaceId: string,
  resource: string,
  requestUrl: string
) {
  return `/v1/workspaces/${encodeURIComponent(workspaceId)}/${resource}${new URL(requestUrl).search}`;
}
