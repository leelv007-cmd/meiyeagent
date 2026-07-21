const MAX_CORE_REQUEST_BYTES = 1024 * 1024;
const SAFE_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/u;

export class CoreRequestBoundaryError extends Error {
  constructor(
    readonly status: 400 | 413,
    readonly code:
      | 'INVALID_CONTENT_TYPE'
      | 'INVALID_IDEMPOTENCY_KEY'
      | 'REQUEST_BODY_TOO_LARGE',
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
    throw requestBodyTooLarge();
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
      throw requestBodyTooLarge();
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

export async function readRequestFormData(
  request: Request,
  maxBytes = 64 * 1024
) {
  const contentType = request.headers.get('content-type');
  if (
    !contentType ||
    (!contentType.startsWith('application/x-www-form-urlencoded') &&
      !contentType.startsWith('multipart/form-data;'))
  ) {
    throw new CoreRequestBoundaryError(
      400,
      'INVALID_CONTENT_TYPE',
      'A bounded form Content-Type header is required.'
    );
  }
  const text = await readRequestText(request, maxBytes);
  return new Request(request.url, {
    body: text,
    headers: { 'content-type': contentType },
    method: 'POST',
  }).formData();
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
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!options.stream) {
    return fetcher(input, {
      ...init,
      signal: combinedSignal(init.signal, AbortSignal.timeout(timeoutMs)),
    });
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

function combinedSignal(
  callerSignal: AbortSignal | null | undefined,
  deadlineSignal: AbortSignal
) {
  return callerSignal
    ? AbortSignal.any([callerSignal, deadlineSignal])
    : deadlineSignal;
}

function requestBodyTooLarge() {
  return new CoreRequestBoundaryError(
    413,
    'REQUEST_BODY_TOO_LARGE',
    'Core proxy request body exceeds 1 MiB.'
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
export type WorkspaceHarnessTaskCollectionResource = 'p1/harness/tasks';
export type WorkspacePendingActionsResource = 'p1/pending-actions';
export type WorkspaceHarnessDecisionResource =
  `p1/harness/tasks/${string}/decision`;
export type WorkspaceHarnessProductMetricResource =
  `p1/harness/tasks/${string}/product-metrics`;

export function workspaceWorkflowEventResource(
  workflowId: string
): WorkspaceWorkflowEventResource {
  return `p1/workflows/${encodeURIComponent(workflowId)}/events`;
}

export function workspaceHarnessDecisionResource(
  taskId: string
): WorkspaceHarnessDecisionResource {
  return `p1/harness/tasks/${encodeURIComponent(taskId)}/decision`;
}

export function workspaceHarnessProductMetricResource(
  taskId: string
): WorkspaceHarnessProductMetricResource {
  return `p1/harness/tasks/${encodeURIComponent(taskId)}/product-metrics`;
}

export function workspaceCoreUpstreamPath(
  workspaceId: string,
  resource: string,
  requestUrl: string
) {
  return `/v1/workspaces/${encodeURIComponent(workspaceId)}/${resource}${new URL(requestUrl).search}`;
}
