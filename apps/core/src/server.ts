import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import {
  p1ModuleRequestSchema,
  assistantStreamRequestSchema,
  firstUsableDraftMetricSchema,
  harnessInteractionAnswerSchema,
  harnessInteractionMerchantMessageSchema,
  structuredDecisionInputSchema,
  hasProductCapability,
  productCommandSchema,
  publicPlanCatalogSchema,
  requiredP1Capability,
  requiredProductCommandCapability,
  type ApiEnvelope,
  type ContentPackage,
  type ProductRole,
  type ProductCommand,
  type ProductContext,
  toPublicContentPackage,
} from '@meiye/contracts';
import { z } from 'zod';
import type {
  DiagnosticIdentity,
  DiagnosticRepository,
} from './diagnostics/repository.js';
import {
  DomainError,
  type ProductApplicationService,
} from './product/product-service.js';
import {
  defaultPermissionAuthorizer,
  PermissionDeniedError,
} from './p1/capability-permission/index.js';
import {
  P1DomainError,
  type P1ApplicationService,
  type P1Context,
} from './p1/foundation/index.js';
import type { IntegrationApplicationService } from './p1/integrations/index.js';
import type { AiStreamingRunner } from './p1/model-supply/ai-sdk-runner.js';
import type {
  CanvasTextGenerationStreamEvent,
  ModelSupplyControlPlaneService,
} from './p1/model-supply/foundation-module.js';
import type { CustodyOwnedAssetContentType } from './p1/model-supply/index.js';
import {
  OperationsError,
  type OperationsApplicationService,
} from './p1/operations/application-service.js';
import type { OperationContext } from './p1/operations/types.js';
import type { HarnessApplicationService } from './p1/harness/application-service.js';
import { composerSubmissionBodySchema } from './p1/execution-spine/creation-execution-snapshot.js';
import {
  composerDestinationMappingRequestSchema,
  type ComposerDestinationMappingPort,
} from './p1/execution-spine/composer-destination-mapper.js';
import {
  CreationSubmissionConflictError,
  type CreationSubmissionCoordinator,
} from './p1/execution-spine/submission-coordinator.js';
import type { PendingActionsService } from './p1/pending-actions.js';
import {
  encodeWorkflowSseFrame,
  type WorkflowEventApplicationService,
} from './p1/workflow-events.js';

interface CoreServerDependencies {
  assetReader?: {
    deleteCanvasAsset?(input: {
      objectKey: string;
      workspaceId: string;
    }): Promise<void>;
    putCanvasAsset?(input: {
      bytes: Uint8Array;
      objectKey: string;
      workspaceId: string;
    }): Promise<void>;
    read(objectKey: string): Promise<{
      bytes: Uint8Array;
      contentType: CustodyOwnedAssetContentType;
    }>;
  };
  diagnosticRepository: DiagnosticRepository;
  douyinCallbackToken?: string;
  productService?: ProductApplicationService;
  p1ApplicationService?: P1ApplicationService;
  integrationService?: IntegrationApplicationService;
  aiStreamingRunner?: AiStreamingRunner;
  canvasTextStreams?: Pick<
    ModelSupplyControlPlaneService,
    'streamCanvasTextGeneration'
  >;
  executionModeGate?: { blocksNewSubmission(): Promise<boolean> };
  operationsService?: Pick<
    OperationsApplicationService,
    'getCreativeWorkbench'
  >;
  composerDestinationMapper?: ComposerDestinationMappingPort;
  composerSubmission?: {
    coordinator: Pick<CreationSubmissionCoordinator, 'submit'>;
  };
  contentPackageReader?: {
    read(context: OperationContext, packageId: string): Promise<ContentPackage>;
  };
  harnessService?: HarnessApplicationService;
  pendingActions?: Pick<PendingActionsService, 'list'>;
  /**
   * Read side of the entitlement catalogue for the public pricing page (D-143).
   * Same `plan.allowances.*` admin-config source the workspace-scoped
   * entitlements module reads, so what a visitor is quoted and what a merchant
   * is granted cannot drift apart.
   */
  planCatalog?: {
    get(): Promise<{
      plans: Array<{
        id: string;
        allowance: { copy: number; image: number; video: number };
        concurrencyLimit: number;
      }>;
    }>;
  };
  /**
   * Optional runtime-truth port for /health/ready and /capabilities.
   * Live endpoints never consult this port.
   */
  runtimeTruth?: {
    evaluateReadiness(): Promise<{
      checks: Array<{ detail?: string; name: string; status: string }>;
      ready: boolean;
      release?: {
        artifactDigest?: string;
        commitSha: string;
        configRevision?: string;
      };
      service: string;
      status: 'ready' | 'not_ready';
    }>;
    listMerchantCapabilities(): Promise<{
      capabilities: Array<{
        channelLabel?: string;
        channelMode?: 'single_channel' | 'multi_channel' | 'none';
        id: string;
        safeExplanation: string;
        state: 'verified' | 'assisted' | 'unavailable';
      }>;
      evidencePolicy: 'merchant_three_state_only';
      release?: {
        artifactDigest?: string;
        commitSha: string;
        configRevision?: string;
      };
    }>;
  };
  serviceToken: string;
  workflowEvents?: WorkflowEventApplicationService;
  workflowHeartbeatMs?: number;
}

function trustedCallbackToken(
  request: IncomingMessage,
  expectedToken: string | undefined
) {
  const provided = request.headers['x-douyin-callback-token'];
  if (typeof provided !== 'string' || !expectedToken) return false;
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expectedToken);
  return (
    providedBytes.byteLength === expectedBytes.byteLength &&
    timingSafeEqual(providedBytes, expectedBytes)
  );
}

/** Constant-time service token compare (length-check first to avoid throw). */
function matchesServiceToken(
  provided: string | string[] | undefined,
  expected: string
): boolean {
  if (typeof provided !== 'string') return false;
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return (
    providedBytes.byteLength === expectedBytes.byteLength &&
    timingSafeEqual(providedBytes, expectedBytes)
  );
}

/** Elevated service actors only via explicit allowlist (after valid service token). */
type ElevatedServiceActor = 'admin' | 'worker' | 'payment';

function elevatedServiceActor(
  actorHeader: string | string[] | undefined
): ElevatedServiceActor | undefined {
  if (typeof actorHeader !== 'string') return undefined;
  if (
    actorHeader === 'admin' ||
    actorHeader === 'worker' ||
    actorHeader === 'payment'
  ) {
    return actorHeader;
  }
  return undefined;
}

/** Worker-only product commands that skip workspace role capability checks. */
const WORKER_VIDEO_LIFECYCLE_COMMANDS = new Set<ProductCommand['type']>([
  'claim_video',
  'complete_video',
  'heartbeat_video',
  'record_video_render',
  'transition_video',
]);

interface ErrorPayload {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

const MAX_JSON_BODY_BYTES = 1024 * 1024;
const MAX_JSON_DEPTH = 64;
const MAX_JSON_NODES = 50_000;
const SAFE_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/u;

function correlationId(request: IncomingMessage) {
  const value = request.headers['x-correlation-id'];
  return typeof value === 'string' && SAFE_REQUEST_ID.test(value)
    ? value
    : randomUUID();
}

function requiredIdempotencyKey(request: IncomingMessage) {
  const value = request.headers['idempotency-key'];
  if (typeof value !== 'string' || value.length === 0) {
    throw new DomainError(
      'IDEMPOTENCY_KEY_REQUIRED',
      'Idempotency key is required.'
    );
  }
  if (!SAFE_REQUEST_ID.test(value)) {
    throw new DomainError(
      'INVALID_IDEMPOTENCY_KEY',
      'Idempotency key is invalid.'
    );
  }
  return value;
}

function sendJson<T>(
  response: ServerResponse,
  status: number,
  data: T,
  requestCorrelationId: string
) {
  const payload: ApiEnvelope<T> = {
    data,
    meta: { correlationId: requestCorrelationId },
  };
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(payload));
}

function sendError(
  response: ServerResponse,
  status: number,
  error: ErrorPayload,
  requestCorrelationId: string
) {
  const payload: ApiEnvelope<never> = {
    error,
    meta: { correlationId: requestCorrelationId },
  };
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(payload));
}

function readBodyUpTo(request: IncomingMessage, maxBytes: number) {
  return new Promise<Buffer | null>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let sizeBytes = 0;
    let settled = false;
    request.on('data', (chunk: Buffer | Uint8Array | string) => {
      if (settled) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      sizeBytes += bytes.byteLength;
      if (sizeBytes > maxBytes) {
        settled = true;
        chunks.length = 0;
        resolve(null);
        return;
      }
      chunks.push(bytes);
    });
    request.once('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks, sizeBytes));
    });
    request.once('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    request.once('aborted', () => {
      if (settled) return;
      settled = true;
      reject(new Error('Request body was aborted.'));
    });
  });
}

async function readJson(request: IncomingMessage) {
  const declaredLength = request.headers['content-length'];
  if (
    typeof declaredLength === 'string' &&
    /^\d+$/u.test(declaredLength) &&
    Number(declaredLength) > MAX_JSON_BODY_BYTES
  ) {
    throw requestBodyTooLarge();
  }
  const body = await readBodyUpTo(request, MAX_JSON_BODY_BYTES);
  if (!body) throw requestBodyTooLarge();
  if (body.byteLength === 0) return {};
  const value = JSON.parse(body.toString('utf8')) as unknown;
  assertJsonComplexity(value);
  return value as Record<string, unknown>;
}

function requestBodyTooLarge() {
  return new DomainError(
    'REQUEST_BODY_TOO_LARGE',
    'JSON request body exceeds the 1 MiB limit.',
    413
  );
}

function assertJsonComplexity(value: unknown) {
  const stack: Array<{ depth: number; value: unknown }> = [
    { depth: 1, value },
  ];
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    nodes += 1;
    if (nodes > MAX_JSON_NODES || current.depth > MAX_JSON_DEPTH) {
      throw new DomainError(
        'JSON_TOO_COMPLEX',
        'JSON request body exceeds the complexity limit.',
        400
      );
    }
    if (!current.value || typeof current.value !== 'object') continue;
    const children = Array.isArray(current.value)
      ? current.value
      : Object.values(current.value);
    for (const child of children) {
      stack.push({ depth: current.depth + 1, value: child });
    }
  }
}

function routeId(pathname: string, suffix: string) {
  const match = pathname.match(
    new RegExp(`^/v1/diagnostics/([^/]+)/${suffix}$`)
  );
  return match?.[1] ?? null;
}

function workspaceRoute(pathname: string, suffix: string) {
  const match = pathname.match(
    new RegExp(`^/v1/workspaces/([^/]+)/${suffix}$`)
  );
  return match?.[1] ?? null;
}

function workspaceWorkflowEventRoute(pathname: string) {
  const match = pathname.match(
    /^\/v1\/workspaces\/([^/]+)\/p1\/workflows\/([^/]+)\/events$/
  );
  if (!match?.[1] || !match[2]) return null;
  try {
    return {
      workflowId: decodeURIComponent(match[2]),
      workspaceId: decodeURIComponent(match[1]),
    };
  } catch {
    return null;
  }
}

function workspaceComposerTaskEventRoute(pathname: string) {
  const match = pathname.match(
    /^\/v1\/workspaces\/([^/]+)\/p1\/composer\/tasks\/([^/]+)\/events$/
  );
  if (!match?.[1] || !match[2]) return null;
  try {
    return {
      taskId: decodeURIComponent(match[2]),
      workspaceId: decodeURIComponent(match[1]),
    };
  } catch {
    return null;
  }
}

function workspaceComposerContentPackageRoute(pathname: string) {
  const match = pathname.match(
    /^\/v1\/workspaces\/([^/]+)\/p1\/composer\/content-packages\/([^/]+)$/
  );
  if (!match?.[1] || !match[2]) return null;
  try {
    return {
      packageId: decodeURIComponent(match[2]),
      workspaceId: decodeURIComponent(match[1]),
    };
  } catch {
    return null;
  }
}

function douyinAuthorizationEventRoute(pathname: string) {
  const match = pathname.match(
    /^\/v1\/workspaces\/([^/]+)\/integrations\/douyin\/authorization-events$/
  );
  return match?.[1] ?? null;
}

function douyinPublishEventRoute(pathname: string) {
  const match = pathname.match(
    /^\/v1\/workspaces\/([^/]+)\/integrations\/douyin\/publish-events$/
  );
  return match?.[1] ?? null;
}

function diagnosticIdentity(
  request: IncomingMessage
): DiagnosticIdentity | null {
  const userId = request.headers['x-user-id'];
  const workspaceId = request.headers['x-workspace-id'];
  if (
    typeof userId !== 'string' ||
    userId.length === 0 ||
    typeof workspaceId !== 'string' ||
    workspaceId.length === 0
  ) {
    return null;
  }
  return { userId, workspaceId };
}

function productIdentity(
  request: IncomingMessage,
  workspaceId: string,
  requestCorrelationId: string
): ProductContext {
  const userId = request.headers['x-user-id'];
  const activeWorkspaceId = request.headers['x-workspace-id'];
  if (
    typeof userId !== 'string' ||
    typeof activeWorkspaceId !== 'string' ||
    activeWorkspaceId !== workspaceId
  ) {
    throw new DomainError(
      'NOT_FOUND',
      'Workspace resource was not found.',
      404
    );
  }
  // Elevated actors only via explicit allowlist (service token already validated).
  const elevated = elevatedServiceActor(request.headers['x-core-actor']);
  if (elevated === 'payment' || elevated === 'worker') {
    return {
      actor: elevated,
      userId,
      workspaceId,
      correlationId: requestCorrelationId,
    };
  }
  const roleHeader = request.headers['x-workspace-role'];
  const role: ProductRole | undefined =
    elevated === 'admin'
      ? 'admin'
      : roleHeader === 'owner' ||
          roleHeader === 'operator' ||
          roleHeader === 'reviewer'
        ? roleHeader
        : undefined;
  if (!role) {
    throw new DomainError(
      'WORKSPACE_ROLE_REQUIRED',
      'A trusted workspace role is required.',
      403
    );
  }
  return {
    actor: 'user',
    role,
    userId,
    workspaceId,
    correlationId: requestCorrelationId,
  };
}

function authorizeProductCommand(
  context: ProductContext,
  command: ProductCommand
) {
  const required = requiredProductCommandCapability(command.type);
  if (!required) {
    // Default-deny: only known worker video lifecycle commands (no payment blanket).
    if (
      context.actor === 'worker' &&
      WORKER_VIDEO_LIFECYCLE_COMMANDS.has(command.type)
    ) {
      return;
    }
    throw new DomainError(
      'COMMAND_ACTOR_FORBIDDEN',
      'A trusted service actor is required for this command.',
      403
    );
  }
  if (!context.role || !hasProductCapability(context.role, required)) {
    throw new DomainError(
      'COMMAND_ROLE_FORBIDDEN',
      'The current product role cannot perform this command.',
      403
    );
  }
}

function p1Identity(
  request: IncomingMessage,
  workspaceId: string,
  requestCorrelationId: string
): P1Context {
  const identity = productIdentity(request, workspaceId, requestCorrelationId);
  const roleHeader = request.headers['x-workspace-role'];
  // Elevated actors only via explicit allowlist after valid service token.
  // payment = trusted webhook/internal service for entitlements.payment_grant (Tc-2)
  const elevated = elevatedServiceActor(request.headers['x-core-actor']);
  let actor: ProductRole | 'worker' | 'payment';
  if (elevated) {
    actor = elevated;
  } else if (
    roleHeader === 'owner' ||
    roleHeader === 'operator' ||
    roleHeader === 'reviewer'
  ) {
    actor = roleHeader;
  } else {
    throw new DomainError(
      'WORKSPACE_ROLE_REQUIRED',
      'A trusted workspace role is required.',
      403
    );
  }
  return {
    actor,
    correlationId: identity.correlationId,
    userId: identity.userId,
    workspaceId: identity.workspaceId,
  };
}

function authorizeP1Request(
  context: P1Context,
  kind: 'command' | 'query',
  module: Parameters<typeof requiredP1Capability>[1],
  action: string
) {
  // Central HTTP enforcement (D-057 / #120). Internal executeModule/queryModule
  // also receive PermissionAuthorizerPort via P1ApplicationService (Z2-WIRING).
  try {
    defaultPermissionAuthorizer.authorize({
      actor: context.actor,
      kind,
      module,
      action,
    });
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      throw new P1DomainError('FORBIDDEN', error.message);
    }
    throw error;
  }
}

function authorizeContentCreation(
  context: P1Context
): asserts context is P1Context & {
  actor: 'admin' | 'owner' | 'operator';
} {
  if (
    !context.actor ||
    context.actor === 'worker' ||
    context.actor === 'payment' ||
    !hasProductCapability(context.actor, 'content.create')
  ) {
    throw new P1DomainError(
      'FORBIDDEN',
      'The current product role cannot create content.'
    );
  }
}

async function pipeWebResponse(
  source: Response,
  target: ServerResponse,
  requestCorrelationId: string,
  beforeEnd?: () => Promise<void>
) {
  const headers = Object.fromEntries(source.headers.entries());
  headers['cache-control'] = 'no-store';
  headers['x-correlation-id'] = requestCorrelationId;
  target.writeHead(source.status, headers);
  if (!source.body) {
    target.end();
    return;
  }
  const reader = source.body.getReader();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      target.write(Buffer.from(chunk.value));
    }
    await beforeEnd?.();
    target.end();
  } catch (error) {
    target.destroy(error instanceof Error ? error : undefined);
  }
}

function p1HttpError(
  error: unknown,
  fallback: { code: string; message: string; status: number }
) {
  if (error instanceof DomainError) return error;
  if (error instanceof P1DomainError) {
    return new DomainError(
      error.code,
      error.message,
      error.code === 'FORBIDDEN'
        ? 403
        : error.code === 'NOT_FOUND'
          ? 404
          : error.code === 'INSUFFICIENT_ENTITLEMENT' ||
              error.code === 'IDEMPOTENCY_CONFLICT'
            ? 409
            : 400
    );
  }
  if (
    typeof error === 'object' &&
    error &&
    'status' in error &&
    typeof error.status === 'number' &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return new DomainError(
      error.code,
      error instanceof Error ? error.message : fallback.message,
      error.status
    );
  }
  return new DomainError(fallback.code, fallback.message, fallback.status);
}

function sendP1HttpError(
  response: ServerResponse,
  error: unknown,
  fallback: { code: string; message: string; status: number },
  requestCorrelationId: string
) {
  const domainError = p1HttpError(error, fallback);
  sendError(
    response,
    domainError.status,
    { code: domainError.code, message: domainError.message },
    requestCorrelationId
  );
}

export async function streamWorkflowEvents(input: {
  request: IncomingMessage;
  response: ServerResponse;
  requestCorrelationId: string;
  workflowEvents: WorkflowEventApplicationService;
  workflowHeartbeatMs: number;
  workflowId: string;
  workspaceId: string;
}) {
  const abortController = new AbortController();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const disconnect = () => {
    if (!input.response.writableEnded && !abortController.signal.aborted) {
      abortController.abort(new Error('Client disconnected.'));
    }
  };
  input.request.once('aborted', disconnect);
  input.request.once('close', disconnect);
  input.response.once('close', disconnect);
  try {
    const lastEventId = input.request.headers['last-event-id'];
    const subscription = await input.workflowEvents.subscribe({
      ...(typeof lastEventId === 'string' && lastEventId.trim()
        ? { lastEventId: lastEventId.trim() }
        : {}),
      signal: abortController.signal,
      workflowId: input.workflowId,
      workspaceId: input.workspaceId,
    });
    if (!subscription) {
      throw new DomainError('NOT_FOUND', 'Workflow was not found.', 404);
    }
    if (abortController.signal.aborted) return;
    input.response.writeHead(200, {
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'content-type': 'text/event-stream; charset=utf-8',
      'x-accel-buffering': 'no',
      'x-correlation-id': input.requestCorrelationId,
      'x-meiye-stream-protocol': 'workflow-events-v1',
    });
    const writer = new WorkflowSseWriter(input.response, abortController.signal);
    if (!(await writer.write(': heartbeat\n\n'))) return;
    let heartbeatInFlight = false;
    heartbeat = setInterval(() => {
      if (heartbeatInFlight || abortController.signal.aborted) return;
      heartbeatInFlight = true;
      void writer
        .write(': heartbeat\n\n')
        .then((written) => {
          if (!written && !abortController.signal.aborted) {
            abortController.abort(new Error('SSE response is no longer writable.'));
          }
        })
        .finally(() => {
          heartbeatInFlight = false;
        });
    }, input.workflowHeartbeatMs);
    for await (const frame of subscription.frames) {
      if (abortController.signal.aborted) break;
      if (!(await writer.write(encodeWorkflowSseFrame(frame)))) break;
    }
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = undefined;
    }
    await writer.flush();
    if (!input.response.writableEnded) input.response.end();
  } catch (error) {
    if (abortController.signal.aborted) return;
    if (input.response.headersSent) {
      input.response.destroy(error instanceof Error ? error : undefined);
    } else {
      sendP1HttpError(
        input.response,
        error,
        {
          code: 'WORKFLOW_EVENTS_UNAVAILABLE',
          message: 'Workflow events are unavailable.',
          status: 503,
        },
        input.requestCorrelationId
      );
    }
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    input.request.off('aborted', disconnect);
    input.request.off('close', disconnect);
    input.response.off('close', disconnect);
    if (!abortController.signal.aborted) abortController.abort();
  }
}

class WorkflowSseWriter {
  private pending: Promise<boolean> = Promise.resolve(true);

  constructor(
    private readonly response: ServerResponse,
    private readonly signal: AbortSignal,
  ) {}

  write(chunk: string) {
    this.pending = this.pending.then((previousWriteSucceeded) => {
      if (!previousWriteSucceeded || this.signal.aborted) return false;
      return writeWorkflowSseChunk(this.response, chunk, this.signal);
    });
    return this.pending;
  }

  flush() {
    return this.pending;
  }
}

async function writeWorkflowSseChunk(
  response: ServerResponse,
  chunk: string,
  signal: AbortSignal,
) {
  if (signal.aborted || response.destroyed || response.writableEnded) {
    return false;
  }
  try {
    if (response.write(chunk)) return true;
  } catch {
    return false;
  }
  return waitForSseDrain(response, signal);
}

function waitForSseDrain(response: ServerResponse, signal: AbortSignal) {
  if (signal.aborted || response.destroyed || response.writableEnded) {
    return Promise.resolve(false);
  }
  return new Promise<boolean>((resolve) => {
    const cleanup = () => {
      response.off('close', onClose);
      response.off('drain', onDrain);
      response.off('error', onClose);
      signal.removeEventListener('abort', onClose);
    };
    const settle = (written: boolean) => {
      cleanup();
      resolve(written);
    };
    const onClose = () => settle(false);
    const onDrain = () => settle(true);
    response.once('close', onClose);
    response.once('drain', onDrain);
    response.once('error', onClose);
    signal.addEventListener('abort', onClose, { once: true });
  });
}

function canvasTextStreamRequest(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DomainError(
      'INVALID_CANVAS_TEXT_STREAM_REQUEST',
      'A Canvas project and text generation job are required.',
      400,
    );
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some((key) => key !== 'jobId' && key !== 'projectId') ||
    typeof record.projectId !== 'string' ||
    !SAFE_REQUEST_ID.test(record.projectId) ||
    typeof record.jobId !== 'string' ||
    !SAFE_REQUEST_ID.test(record.jobId)
  ) {
    throw new DomainError(
      'INVALID_CANVAS_TEXT_STREAM_REQUEST',
      'A valid Canvas project and text generation job are required.',
      400,
    );
  }
  return { jobId: record.jobId, projectId: record.projectId };
}

function canvasTextStreamCursor(value: string | string[] | undefined) {
  if (value === undefined) return 0;
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/u.test(value)) {
    throw new DomainError(
      'INVALID_CANVAS_TEXT_STREAM_CURSOR',
      'Canvas text stream cursor is invalid.',
      400,
    );
  }
  const cursor = Number(value);
  if (!Number.isSafeInteger(cursor)) {
    throw new DomainError(
      'INVALID_CANVAS_TEXT_STREAM_CURSOR',
      'Canvas text stream cursor is invalid.',
      400,
    );
  }
  return cursor;
}

function encodeCanvasTextStreamEvent(event: CanvasTextGenerationStreamEvent) {
  const data =
    event.type === 'delta'
      ? {
          delta: event.delta,
          jobId: event.jobId,
          sequence: event.sequence,
        }
      : event.type === 'recoverable'
        ? {
            code: event.code,
            jobId: event.jobId,
            message: event.message,
            retryable: event.retryable,
            sequence: event.sequence,
          }
      : {
          failureCode: event.result.failureCode,
          jobId: event.jobId,
          sequence: event.sequence,
          status: event.result.status,
        };
  return `id: ${event.sequence}\nevent: canvas.text.${event.type}\ndata: ${JSON.stringify(data)}\n\n`;
}

function encodeCanvasTextStreamError(error: unknown) {
  const domainError = p1HttpError(error, {
    code: 'CANVAS_TEXT_STREAM_FAILED',
    message: 'Canvas text streaming failed.',
    status: 502,
  });
  return `event: canvas.text.error\ndata: ${JSON.stringify({
    code: domainError.code,
    message: domainError.message,
  })}\n\n`;
}

export function createCoreServer({
  aiStreamingRunner,
  canvasTextStreams,
  executionModeGate,
  assetReader,
  diagnosticRepository,
  douyinCallbackToken,
  productService,
  p1ApplicationService,
  integrationService,
  operationsService,
  composerDestinationMapper,
  composerSubmission,
  contentPackageReader,
  harnessService,
  pendingActions,
  planCatalog,
  runtimeTruth,
  serviceToken,
  workflowEvents,
  workflowHeartbeatMs = 15_000,
}: CoreServerDependencies) {
  return createServer(async (request, response) => {
    const requestCorrelationId = correlationId(request);
    const url = new URL(request.url ?? '/', 'http://core.local');

    // Process-only liveness. Never touches external dependencies or runtimeTruth.
    if (
      request.method === 'GET' &&
      (url.pathname === '/health' || url.pathname === '/health/live')
    ) {
      sendJson(
        response,
        200,
        {
          service: 'meiye-core',
          status: url.pathname === '/health/live' ? 'live' : 'ok',
        },
        requestCorrelationId
      );
      return;
    }

    if (request.method === 'GET' && url.pathname === '/health/assembly') {
      const active = Boolean(harnessService && composerSubmission);
      sendJson(
        response,
        active ? 200 : 503,
        {
          composerSubmission: composerSubmission ? 'active' : 'inactive',
          harness: harnessService ? 'active' : 'inactive',
          service: 'meiye-core',
          status: active ? 'active' : 'inactive',
        },
        requestCorrelationId
      );
      return;
    }

    if (request.method === 'GET' && url.pathname === '/health/ready') {
      if (!runtimeTruth) {
        sendJson(
          response,
          503,
          {
            service: 'meiye-core',
            status: 'not_ready',
            ready: false,
            checks: [
              {
                name: 'runtimeTruth',
                status: 'fail',
                detail:
                  'Runtime truth port is not wired; instance cannot prove readiness.',
              },
            ],
          },
          requestCorrelationId
        );
        return;
      }
      try {
        const readiness = await runtimeTruth.evaluateReadiness();
        sendJson(
          response,
          readiness.ready ? 200 : 503,
          readiness,
          requestCorrelationId
        );
      } catch (error) {
        sendJson(
          response,
          503,
          {
            service: 'meiye-core',
            status: 'not_ready',
            ready: false,
            checks: [
              {
                name: 'runtimeTruth',
                status: 'fail',
                detail:
                  error instanceof Error
                    ? error.message
                    : 'Readiness evaluation failed.',
              },
            ],
          },
          requestCorrelationId
        );
      }
      return;
    }

    if (request.method === 'GET' && url.pathname === '/capabilities') {
      if (!runtimeTruth) {
        sendJson(
          response,
          200,
          {
            evidencePolicy: 'merchant_three_state_only',
            capabilities: [],
          },
          requestCorrelationId
        );
        return;
      }
      try {
        const snapshot = await runtimeTruth.listMerchantCapabilities();
        sendJson(response, 200, snapshot, requestCorrelationId);
      } catch (error) {
        sendError(
          response,
          500,
          {
            code: 'CAPABILITIES_UNAVAILABLE',
            message:
              error instanceof Error
                ? error.message
                : 'Capabilities projection failed.',
          },
          requestCorrelationId
        );
      }
      return;
    }

    const douyinEventWorkspaceId = douyinAuthorizationEventRoute(url.pathname);
    const douyinPublishWorkspaceId = douyinPublishEventRoute(url.pathname);
    if (
      request.method === 'POST' &&
      (douyinEventWorkspaceId || douyinPublishWorkspaceId)
    ) {
      if (
        !integrationService ||
        !trustedCallbackToken(request, douyinCallbackToken)
      ) {
        sendError(
          response,
          401,
          {
            code: 'DOUYIN_CALLBACK_UNAUTHORIZED',
            message: 'Invalid Douyin callback identity.',
          },
          requestCorrelationId
        );
        return;
      }
      const workspaceId = douyinEventWorkspaceId ?? douyinPublishWorkspaceId!;
      const callbackContext = {
        correlationId: requestCorrelationId,
        role: 'owner' as const,
        userId: 'douyin-callback',
        workspaceId,
      };
      try {
        const body = await readJson(request);
        if (douyinEventWorkspaceId) {
          const connection =
            await integrationService.handleDouyinAuthorizationEvent(
              callbackContext,
              body as unknown as Parameters<
                IntegrationApplicationService['handleDouyinAuthorizationEvent']
              >[1]
            );
          const {
            credentialTransition: _credentialTransition,
            secretRef: _secretRef,
            ...view
          } = connection;
          sendJson(response, 200, view, requestCorrelationId);
        } else {
          const job = await integrationService.handleDouyinPublishStatusEvent(
            callbackContext,
            body as unknown as Parameters<
              IntegrationApplicationService['handleDouyinPublishStatusEvent']
            >[1]
          );
          sendJson(response, 200, job, requestCorrelationId);
        }
      } catch (error) {
        const status =
          typeof error === 'object' &&
          error &&
          'status' in error &&
          typeof error.status === 'number'
            ? error.status
            : 400;
        const code =
          typeof error === 'object' &&
          error &&
          'code' in error &&
          typeof error.code === 'string'
            ? error.code
            : douyinEventWorkspaceId
              ? 'DOUYIN_AUTHORIZATION_EVENT_INVALID'
              : 'DOUYIN_PUBLISH_EVENT_INVALID';
        sendError(
          response,
          status,
          {
            code,
            message:
              error instanceof Error
                ? error.message
                : 'Douyin callback event could not be processed.',
          },
          requestCorrelationId
        );
      }
      return;
    }

    if (!matchesServiceToken(request.headers['x-service-token'], serviceToken)) {
      sendError(
        response,
        401,
        { code: 'UNAUTHORIZED_SERVICE', message: 'Invalid service identity.' },
        requestCorrelationId
      );
      return;
    }

    // D-143 单一商品目录：the public pricing page reads the same
    // `plan.allowances.*` admin-config revision the entitlement grant reads.
    // Service-token gated because the browser never talks to core directly —
    // the Web BFF fetches this for its /pricing loader.
    if (
      request.method === 'GET' &&
      url.pathname === '/public/plan-catalog' &&
      planCatalog
    ) {
      try {
        const catalog = await planCatalog.get();
        sendJson(
          response,
          200,
          publicPlanCatalogSchema.parse({
            plans: catalog.plans
              .filter((plan) => plan.id !== 'trial')
              .map((plan) => ({
                id: plan.id,
                allowance: {
                  copy: plan.allowance.copy,
                  image: plan.allowance.image,
                  video: plan.allowance.video,
                },
                concurrencyLimit: plan.concurrencyLimit,
              })),
          }),
          requestCorrelationId
        );
      } catch (error) {
        sendError(
          response,
          500,
          {
            code: 'PLAN_CATALOG_UNAVAILABLE',
            message:
              error instanceof Error
                ? error.message
                : 'Plan catalogue projection failed.',
          },
          requestCorrelationId
        );
      }
      return;
    }

    const pendingActionsWorkspaceId = workspaceRoute(
      url.pathname,
      'p1/pending-actions'
    );
    if (
      pendingActions &&
      request.method === 'GET' &&
      pendingActionsWorkspaceId
    ) {
      try {
        const context = p1Identity(
          request,
          pendingActionsWorkspaceId,
          requestCorrelationId
        );
        sendJson(
          response,
          200,
          await pendingActions.list({
            userId: context.userId,
            workspaceId: context.workspaceId,
          }),
          requestCorrelationId
        );
      } catch (error) {
        const status =
          typeof error === 'object' &&
          error &&
          'status' in error &&
          typeof error.status === 'number'
            ? error.status
            : 400;
        const code =
          typeof error === 'object' &&
          error &&
          'code' in error &&
          typeof error.code === 'string'
            ? error.code
            : 'PENDING_ACTIONS_UNAVAILABLE';
        sendError(
          response,
          status,
          {
            code,
            message:
              error instanceof Error
                ? error.message
                : 'Pending actions are unavailable.',
          },
          requestCorrelationId
        );
      }
      return;
    }

    const composerDestinationWorkspaceId = workspaceRoute(
      url.pathname,
      'p1/composer/destination-map'
    );
    if (composerDestinationMapper && composerDestinationWorkspaceId) {
      if (request.method !== 'POST') {
        sendError(
          response,
          405,
          {
            code: 'METHOD_NOT_ALLOWED',
            message: 'Composer destination mapping requires POST.',
          },
          requestCorrelationId
        );
        return;
      }
      try {
        const context = p1Identity(
          request,
          composerDestinationWorkspaceId,
          requestCorrelationId
        );
        authorizeContentCreation(context);
        const body = composerDestinationMappingRequestSchema.parse(
          await readJson(request)
        );
        const result = await composerDestinationMapper.map({
          ...body,
          idempotencyKey: `destination-map-${createHash('sha256')
            .update(
              JSON.stringify({
                destination: body.destination.trim(),
                workspaceId: context.workspaceId,
              }),
            )
            .digest('hex')}`,
          workspaceId: context.workspaceId,
        });
        sendJson(response, 200, result, requestCorrelationId);
      } catch (error) {
        sendP1HttpError(
          response,
          error,
          {
            code: 'INVALID_COMPOSER_DESTINATION',
            message: 'Composer destination mapping input is invalid.',
            status: 400,
          },
          requestCorrelationId
        );
      }
      return;
    }

    const composerSubmissionWorkspaceId = workspaceRoute(
      url.pathname,
      'p1/composer/submissions'
    );
    if (composerSubmission && composerSubmissionWorkspaceId) {
      if (request.method !== 'POST') {
        sendError(
          response,
          405,
          {
            code: 'METHOD_NOT_ALLOWED',
            message: 'Composer submissions require POST.',
          },
          requestCorrelationId
        );
        return;
      }
      try {
        const context = p1Identity(
          request,
          composerSubmissionWorkspaceId,
          requestCorrelationId
        );
        authorizeContentCreation(context);
        const body = composerSubmissionBodySchema.parse(
          await readJson(request)
        );
        const result = await composerSubmission.coordinator.submit({
          ...body,
          actorId: context.userId,
          workspaceId: context.workspaceId,
        });
        sendJson(response, 202, result, requestCorrelationId);
      } catch (error) {
        sendP1HttpError(
          response,
          error,
          {
            code:
              error instanceof CreationSubmissionConflictError
                ? error.code
                : 'INVALID_COMPOSER_SUBMISSION',
            message:
              error instanceof Error
                ? error.message
                : 'Composer submission is invalid.',
            status:
              error instanceof CreationSubmissionConflictError
                ? error.status
                : 400,
          },
          requestCorrelationId
        );
      }
      return;
    }

    const composerTaskEventRoute = workspaceComposerTaskEventRoute(
      url.pathname
    );
    if (composerSubmission && composerTaskEventRoute) {
      if (request.method !== 'GET') {
        sendError(
          response,
          405,
          {
            code: 'METHOD_NOT_ALLOWED',
            message: 'Composer events require GET.',
          },
          requestCorrelationId
        );
        return;
      }
      try {
        if (!workflowEvents) {
          throw new DomainError(
            'COMPOSER_EVENTS_UNAVAILABLE',
            'Composer events are unavailable.',
            503
          );
        }
        const context = p1Identity(
          request,
          composerTaskEventRoute.workspaceId,
          requestCorrelationId
        );
        authorizeP1Request(context, 'query', 'model-supply', 'video_workflow');
        await streamWorkflowEvents({
          request,
          response,
          requestCorrelationId,
          workflowEvents,
          workflowHeartbeatMs,
          workflowId: composerTaskEventRoute.taskId,
          workspaceId: composerTaskEventRoute.workspaceId,
        });
      } catch (error) {
        if (!response.headersSent) {
          sendP1HttpError(
            response,
            error,
            {
              code: 'COMPOSER_EVENTS_UNAVAILABLE',
              message: 'Composer events are unavailable.',
              status: 503,
            },
            requestCorrelationId
          );
        }
      }
      return;
    }

    const composerContentPackageRoute = workspaceComposerContentPackageRoute(
      url.pathname
    );
    if (composerSubmission && composerContentPackageRoute) {
      if (request.method !== 'GET') {
        sendError(
          response,
          405,
          {
            code: 'METHOD_NOT_ALLOWED',
            message: 'Composer ContentPackage projections require GET.',
          },
          requestCorrelationId
        );
        return;
      }
      try {
        if (!contentPackageReader) {
          throw new DomainError(
            'COMPOSER_CONTENT_PACKAGE_UNAVAILABLE',
            'Composer ContentPackage projections are unavailable.',
            503
          );
        }
        const context = p1Identity(
          request,
          composerContentPackageRoute.workspaceId,
          requestCorrelationId
        );
        authorizeP1Request(context, 'query', 'model-supply', 'video_workflow');
        const contentPackage = await contentPackageReader.read(
          {
            actor: context.actor as OperationContext['actor'],
            correlationId: context.correlationId,
            userId: context.userId,
            workspaceId: context.workspaceId,
          },
          composerContentPackageRoute.packageId
        );
        sendJson(
          response,
          200,
          toPublicContentPackage(contentPackage),
          requestCorrelationId
        );
      } catch (error) {
        sendP1HttpError(
          response,
          error,
          {
            code: 'COMPOSER_CONTENT_PACKAGE_UNAVAILABLE',
            message: 'Composer ContentPackage projection is unavailable.',
            status: 503,
          },
          requestCorrelationId
        );
      }
      return;
    }

    const harnessRecommendationWorkspaceId = workspaceRoute(
      url.pathname,
      'p1/harness/recommendation'
    );
    if (
      harnessService &&
      request.method === 'GET' &&
      harnessRecommendationWorkspaceId
    ) {
      try {
        const context = p1Identity(
          request,
          harnessRecommendationWorkspaceId,
          requestCorrelationId
        );
        authorizeContentCreation(context);
        sendJson(
          response,
          200,
          await harnessService.readTodayRecommendation(
            harnessRecommendationWorkspaceId
          ),
          requestCorrelationId
        );
      } catch (error) {
        const status =
          typeof error === 'object' &&
          error &&
          'status' in error &&
          typeof error.status === 'number'
            ? error.status
            : 503;
        const code =
          typeof error === 'object' &&
          error &&
          'code' in error &&
          typeof error.code === 'string'
            ? error.code
            : 'HARNESS_RECOMMENDATION_UNAVAILABLE';
        sendError(
          response,
          status,
          {
            code,
            message:
              error instanceof Error
                ? error.message
                : 'Harness recommendation is unavailable.',
          },
          requestCorrelationId
        );
      }
      return;
    }

    const harnessTaskCollectionWorkspaceId = workspaceRoute(
      url.pathname,
      'p1/harness/tasks'
    );
    const harnessProductMetricMatch = url.pathname.match(
      /^\/v1\/workspaces\/([^/]+)\/p1\/harness\/tasks\/([^/]+)\/product-metrics$/
    );
    const harnessDecisionMatch = url.pathname.match(
      /^\/v1\/workspaces\/([^/]+)\/p1\/harness\/tasks\/([^/]+)\/decision$/
    );
    const harnessInteractionMatch = url.pathname.match(
      /^\/v1\/workspaces\/([^/]+)\/p1\/harness\/tasks\/([^/]+)\/interaction$/
    );
    const harnessInteractionEditingMatch = url.pathname.match(
      /^\/v1\/workspaces\/([^/]+)\/p1\/harness\/tasks\/([^/]+)\/interaction\/editing$/
    );
    const harnessInteractionMessageMatch = url.pathname.match(
      /^\/v1\/workspaces\/([^/]+)\/p1\/harness\/tasks\/([^/]+)\/interaction\/message$/
    );
    if (
      harnessService &&
      request.method === 'POST' &&
      harnessProductMetricMatch
    ) {
      try {
        const workspaceId = decodeURIComponent(harnessProductMetricMatch[1]!);
        const taskId = decodeURIComponent(harnessProductMetricMatch[2]!);
        const context = p1Identity(request, workspaceId, requestCorrelationId);
        authorizeContentCreation(context);
        const metric = firstUsableDraftMetricSchema.parse(
          await readJson(request)
        );
        sendJson(
          response,
          202,
          await harnessService.recordFirstUsableDraftMetric(
            workspaceId,
            taskId,
            metric
          ),
          requestCorrelationId
        );
      } catch (error) {
        const status =
          typeof error === 'object' &&
          error &&
          'status' in error &&
          typeof error.status === 'number'
            ? error.status
            : 400;
        const code =
          typeof error === 'object' &&
          error &&
          'code' in error &&
          typeof error.code === 'string'
            ? error.code
            : 'INVALID_HARNESS_PRODUCT_METRIC';
        sendError(
          response,
          status,
          {
            code,
            message:
              error instanceof Error
                ? error.message
                : 'Harness product metric is invalid.',
          },
          requestCorrelationId
        );
      }
      return;
    }
    // 时间桥 (D-145): what is still running for this workspace. The browser asks
    // on mount, which is how a closed tab stops being a lost run.
    if (
      harnessService &&
      request.method === 'GET' &&
      harnessTaskCollectionWorkspaceId
    ) {
      try {
        const context = p1Identity(
          request,
          harnessTaskCollectionWorkspaceId,
          requestCorrelationId
        );
        authorizeContentCreation(context);
        sendJson(
          response,
          200,
          await harnessService.listActiveTasks(harnessTaskCollectionWorkspaceId),
          requestCorrelationId
        );
      } catch (error) {
        sendP1HttpError(
          response,
          error,
          {
            code: 'HARNESS_ACTIVE_TASKS_UNAVAILABLE',
            message: 'Harness active tasks are unavailable.',
            status: 503,
          },
          requestCorrelationId
        );
      }
      return;
    }
    if (request.method === 'POST' && harnessTaskCollectionWorkspaceId) {
      try {
        const context = p1Identity(
          request,
          harnessTaskCollectionWorkspaceId,
          requestCorrelationId
        );
        authorizeContentCreation(context);
        sendError(
          response,
          410,
          {
            code: 'HARNESS_TASK_ADMISSION_RETIRED',
            message:
              'Direct Harness task admission is retired; submit through the Composer execution spine.',
          },
          requestCorrelationId
        );
      } catch (error) {
        sendP1HttpError(
          response,
          error,
          {
            code: 'INVALID_HARNESS_REQUEST',
            message: 'Harness request is invalid.',
            status: 400,
          },
          requestCorrelationId
        );
      }
      return;
    }
    if (
      harnessService &&
      (request.method === 'GET' || request.method === 'POST') &&
      harnessInteractionMatch
    ) {
      try {
        const workspaceId = decodeURIComponent(harnessInteractionMatch[1]!);
        const taskId = decodeURIComponent(harnessInteractionMatch[2]!);
        const context = p1Identity(request, workspaceId, requestCorrelationId);
        authorizeContentCreation(context);
        const result =
          request.method === 'GET'
            ? await harnessService.readPendingInteraction(workspaceId, taskId)
            : await harnessService.submitInteraction(
                workspaceId,
                taskId,
                await readJson(request)
              );
        sendJson(response, 200, result, requestCorrelationId);
      } catch (error) {
        sendP1HttpError(
          response,
          error,
          {
            code: 'INVALID_HARNESS_INTERACTION',
            message: 'Harness interaction is invalid.',
            status: 400,
          },
          requestCorrelationId
        );
      }
      return;
    }
    if (
      harnessService &&
      request.method === 'POST' &&
      harnessInteractionMessageMatch
    ) {
      try {
        const workspaceId = decodeURIComponent(
          harnessInteractionMessageMatch[1]!
        );
        const taskId = decodeURIComponent(harnessInteractionMessageMatch[2]!);
        const context = p1Identity(request, workspaceId, requestCorrelationId);
        authorizeContentCreation(context);
        sendJson(
          response,
          200,
          await harnessService.submitInteractionMerchantMessage(
            workspaceId,
            taskId,
            harnessInteractionMerchantMessageSchema.parse(
              await readJson(request)
            )
          ),
          requestCorrelationId
        );
      } catch (error) {
        sendP1HttpError(
          response,
          error,
          {
            code: 'INVALID_HARNESS_INTERACTION_MESSAGE',
            message: 'Harness interaction message is invalid.',
            status: 400,
          },
          requestCorrelationId
        );
      }
      return;
    }
    if (
      harnessService &&
      request.method === 'POST' &&
      harnessInteractionEditingMatch
    ) {
      try {
        const workspaceId = decodeURIComponent(
          harnessInteractionEditingMatch[1]!
        );
        const taskId = decodeURIComponent(harnessInteractionEditingMatch[2]!);
        const context = p1Identity(request, workspaceId, requestCorrelationId);
        authorizeContentCreation(context);
        const { editing } = z
          .object({ editing: z.boolean() })
          .strict()
          .parse(await readJson(request));
        await harnessService.setInteractionEditing(
          workspaceId,
          taskId,
          editing
        );
        response.writeHead(204, {
          'x-correlation-id': requestCorrelationId,
        });
        response.end();
      } catch (error) {
        sendP1HttpError(
          response,
          error,
          {
            code: 'INVALID_HARNESS_INTERACTION_EDITING',
            message: 'Harness interaction editing state is invalid.',
            status: 400,
          },
          requestCorrelationId
        );
      }
      return;
    }
    if (
      harnessService &&
      (request.method === 'GET' || request.method === 'POST') &&
      harnessDecisionMatch
    ) {
      try {
        const workspaceId = decodeURIComponent(harnessDecisionMatch[1]!);
        const taskId = decodeURIComponent(harnessDecisionMatch[2]!);
        const context = p1Identity(request, workspaceId, requestCorrelationId);
        authorizeContentCreation(context);
        if (request.method === 'GET') {
          const snapshot = await harnessService.readPendingDecision(
            workspaceId,
            taskId
          );
          sendJson(response, 200, snapshot, requestCorrelationId);
        } else {
          const decision = structuredDecisionInputSchema.parse(
            await readJson(request)
          );
          const result = await harnessService.submitDecision(
            workspaceId,
            taskId,
            decision
          );
          sendJson(response, 200, result, requestCorrelationId);
        }
      } catch (error) {
        const status =
          typeof error === 'object' &&
          error &&
          'status' in error &&
          typeof error.status === 'number'
            ? error.status
            : 400;
        const code =
          typeof error === 'object' &&
          error &&
          'code' in error &&
          typeof error.code === 'string'
            ? error.code
            : 'INVALID_HARNESS_REQUEST';
        sendError(
          response,
          status,
          {
            code,
            message:
              error instanceof Error
                ? error.message
                : 'Harness request is invalid.',
          },
          requestCorrelationId
        );
      }
      return;
    }

    const workflowEventRoute = workspaceWorkflowEventRoute(url.pathname);
    if (request.method === 'GET' && workflowEventRoute && workflowEvents) {
      try {
        const context = p1Identity(
          request,
          workflowEventRoute.workspaceId,
          requestCorrelationId
        );
        authorizeP1Request(context, 'query', 'model-supply', 'video_workflow');
        await streamWorkflowEvents({
          request,
          response,
          requestCorrelationId,
          workflowEvents,
          workflowHeartbeatMs,
          workflowId: workflowEventRoute.workflowId,
          workspaceId: workflowEventRoute.workspaceId,
        });
      } catch (error) {
        if (!response.headersSent) {
          sendP1HttpError(
            response,
            error,
            {
              code: 'WORKFLOW_EVENTS_UNAVAILABLE',
              message: 'Workflow events are unavailable.',
              status: 503,
            },
            requestCorrelationId
          );
        }
      }
      return;
    }

    const canvasTextStreamWorkspaceId = workspaceRoute(
      url.pathname,
      'canvas/text/stream'
    );
    if (request.method === 'POST' && canvasTextStreamWorkspaceId) {
      const abortController = new AbortController();
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let writer: WorkflowSseWriter | undefined;
      const disconnect = () => {
        if (!abortController.signal.aborted) {
          abortController.abort(new Error('Canvas text stream disconnected.'));
        }
      };
      request.once('aborted', disconnect);
      response.once('close', disconnect);
      try {
        if (!canvasTextStreams) {
          throw new DomainError(
            'CANVAS_TEXT_STREAM_UNAVAILABLE',
            'Canvas text streaming is unavailable in the current execution mode.',
            503,
          );
        }
        const context = p1Identity(
          request,
          canvasTextStreamWorkspaceId,
          requestCorrelationId
        );
        if (context.actor !== 'worker') {
          throw new DomainError(
            'FORBIDDEN',
            'Canvas text streaming requires the Canvas service actor.',
            403,
          );
        }
        const parsed = canvasTextStreamRequest(await readJson(request));
        const afterSequence = canvasTextStreamCursor(
          request.headers['last-event-id']
        );
        await canvasTextStreams.streamCanvasTextGeneration(context, {
          abortSignal: abortController.signal,
          afterSequence,
          jobId: parsed.jobId,
          onEvent: async (event) => {
            if (!writer || !(await writer.write(encodeCanvasTextStreamEvent(event)))) {
              disconnect();
              throw new Error('Canvas text stream response is no longer writable.');
            }
          },
          onReady: async () => {
            if (abortController.signal.aborted) {
              throw new Error('Canvas text stream disconnected before start.');
            }
            response.writeHead(200, {
              'cache-control': 'no-cache, no-transform',
              connection: 'keep-alive',
              'content-type': 'text/event-stream; charset=utf-8',
              'x-accel-buffering': 'no',
              'x-correlation-id': requestCorrelationId,
              'x-meiye-stream-protocol': 'canvas-text-events-v1',
            });
            writer = new WorkflowSseWriter(response, abortController.signal);
            if (!(await writer.write(': heartbeat\n\n'))) {
              disconnect();
              throw new Error('Canvas text stream response is no longer writable.');
            }
            heartbeat = setInterval(() => {
              if (abortController.signal.aborted || !writer) return;
              void writer.write(': heartbeat\n\n').then((written) => {
                if (!written) disconnect();
              });
            }, workflowHeartbeatMs);
          },
          projectId: parsed.projectId,
          runner: aiStreamingRunner,
        });
        if (heartbeat) clearInterval(heartbeat);
        await writer?.flush();
        if (!response.writableEnded) response.end();
      } catch (error) {
        if (!abortController.signal.aborted) {
          if (response.headersSent) {
            await writer?.write(encodeCanvasTextStreamError(error));
            if (!response.writableEnded) response.end();
          } else {
            sendP1HttpError(
              response,
              error,
              {
                code: 'CANVAS_TEXT_STREAM_FAILED',
                message: 'Canvas text streaming failed.',
                status: 502,
              },
              requestCorrelationId
            );
          }
        }
      } finally {
        if (heartbeat) clearInterval(heartbeat);
        request.off('aborted', disconnect);
        response.off('close', disconnect);
        if (!abortController.signal.aborted) abortController.abort();
      }
      return;
    }

    const assistantWorkspaceId = workspaceRoute(
      url.pathname,
      'p1/assistant/stream'
    );
    if (request.method === 'POST' && assistantWorkspaceId) {
      try {
        if (!aiStreamingRunner || !operationsService) {
          throw new DomainError(
            'AI_STREAM_UNAVAILABLE',
            'AI streaming is unavailable in the current execution mode.',
            503
          );
        }
        const context = p1Identity(
          request,
          assistantWorkspaceId,
          requestCorrelationId
        );
        authorizeContentCreation(context);
        const parsed = assistantStreamRequestSchema.safeParse(
          await readJson(request)
        );
        if (!parsed.success) {
          throw new DomainError(
            'INVALID_ASSISTANT_STREAM_REQUEST',
            'A valid assistant stream request is required.'
          );
        }
        if (!aiStreamingRunner.supportsCatalogModel(parsed.data.catalogModelId)) {
          throw new DomainError(
            'FIXED_MODEL_REQUIRED',
            'The assistant stream cannot switch to another model.',
            409
          );
        }
        if (executionModeGate && (await executionModeGate.blocksNewSubmission())) {
          throw new DomainError(
            'MODEL_EXECUTION_DISABLED',
            '模型执行已停用。',
            503
          );
        }
        const workbench = await operationsService.getCreativeWorkbench(context);
        const work = workbench.works.find(
          (candidate) => candidate.id === parsed.data.context.workId
        );
        if (!work) {
          throw new DomainError(
            'CREATIVE_WORK_NOT_FOUND',
            'The assistant Work was not found.',
            404
          );
        }
        const abortController = new AbortController();
        response.once('close', () => {
          if (!response.writableEnded) {
            abortController.abort(new Error('Client disconnected.'));
          }
        });
        await pipeWebResponse(
          aiStreamingRunner.streamAssistant(
            {
              ...parsed.data,
              context: {
                ...parsed.data.context,
                intent: work.intent,
              },
            },
            abortController.signal
          ),
          response,
          requestCorrelationId
        );
      } catch (error) {
        if (response.headersSent) return;
        const domainError =
          error instanceof DomainError
            ? error
            : error instanceof P1DomainError
              ? new DomainError(
                  error.code,
                  error.message,
                  error.code === 'INSUFFICIENT_ENTITLEMENT' ? 409 : 403
                )
              : new DomainError(
                  'ASSISTANT_STREAM_FAILED',
                  'The assistant stream could not be started.',
                  502
                );
        sendError(
          response,
          domainError.status,
          { code: domainError.code, message: domainError.message },
          requestCorrelationId
        );
      }
      return;
    }

    if (
      (request.method === 'DELETE' ||
        request.method === 'GET' ||
        request.method === 'PUT') &&
      assetReader &&
      url.pathname.startsWith('/v1/assets/')
    ) {
      const workspaceId = request.headers['x-workspace-id'];
      let objectKey: string;
      try {
        objectKey = decodeURIComponent(
          url.pathname.slice('/v1/assets/'.length)
        );
      } catch {
        sendError(
          response,
          400,
          { code: 'INVALID_ASSET_KEY', message: 'Asset key is invalid.' },
          requestCorrelationId
        );
        return;
      }
      if (
        typeof workspaceId !== 'string' ||
        objectKey.split('/')[0] !== workspaceId
      ) {
        sendError(
          response,
          403,
          {
            code: 'ASSET_WORKSPACE_FORBIDDEN',
            message: 'Asset does not belong to the active workspace.',
          },
          requestCorrelationId
        );
        return;
      }
      if (request.method === 'DELETE') {
        if (!assetReader.deleteCanvasAsset) {
          sendError(
            response,
            404,
            {
              code: 'ASSET_DELETE_UNAVAILABLE',
              message: 'Asset storage does not support deletion.',
            },
            requestCorrelationId
          );
          return;
        }
        try {
          await assetReader.deleteCanvasAsset({ objectKey, workspaceId });
          response.writeHead(204, {
            'x-correlation-id': requestCorrelationId,
          });
          response.end();
        } catch {
          sendError(
            response,
            500,
            {
              code: 'ASSET_DELETE_FAILED',
              message: 'Asset could not be deleted.',
            },
            requestCorrelationId
          );
        }
        return;
      }
      if (request.method === 'PUT') {
        if (!assetReader.putCanvasAsset) {
          sendError(
            response,
            404,
            {
              code: 'ASSET_WRITE_UNAVAILABLE',
              message: 'Asset storage is not writable.',
            },
            requestCorrelationId
          );
          return;
        }
        const maxCanvasAssetBytes = 25 * 1024 * 1024;
        const declaredLength = Number(request.headers['content-length']);
        if (
          Number.isFinite(declaredLength) &&
          declaredLength > maxCanvasAssetBytes
        ) {
          sendError(
            response,
            413,
            {
              code: 'CANVAS_ASSET_TOO_LARGE',
              message: 'Canvas asset exceeds the upload limit.',
            },
            requestCorrelationId
          );
          return;
        }
        let body: Buffer | null;
        try {
          body = await readBodyUpTo(request, maxCanvasAssetBytes);
        } catch {
          sendError(
            response,
            400,
            {
              code: 'INVALID_ASSET_PAYLOAD',
              message: 'Asset payload could not be read.',
            },
            requestCorrelationId
          );
          return;
        }
        if (!body) {
          sendError(
            response,
            413,
            {
              code: 'CANVAS_ASSET_TOO_LARGE',
              message: 'Canvas asset exceeds the upload limit.',
            },
            requestCorrelationId
          );
          return;
        }
        try {
          await assetReader.putCanvasAsset({
            bytes: Uint8Array.from(body),
            objectKey,
            workspaceId,
          });
          response.writeHead(204, {
            'x-correlation-id': requestCorrelationId,
          });
          response.end();
        } catch {
          sendError(
            response,
            400,
            {
              code: 'INVALID_ASSET_PAYLOAD',
              message: 'Asset payload could not be persisted.',
            },
            requestCorrelationId
          );
        }
        return;
      }
      try {
        const asset = await assetReader.read(objectKey);
        response.writeHead(200, {
          'cache-control': 'private, max-age=31536000, immutable',
          'content-length': asset.bytes.byteLength,
          'content-type': asset.contentType,
        });
        response.end(Buffer.from(asset.bytes));
      } catch {
        sendError(
          response,
          404,
          { code: 'ASSET_NOT_FOUND', message: 'Asset was not found.' },
          requestCorrelationId
        );
      }
      return;
    }

    if (request.method === 'POST' && url.pathname === '/v1/diagnostics') {
      sendError(
        response,
        410,
        {
          code: 'DIAGNOSTIC_CONTENT_GENERATION_RETIRED',
          message:
            'Content-generation diagnostics are retired. Use the ModelSupply generation path.',
        },
        requestCorrelationId
      );
      return;
    }

    const stateWorkspaceId = workspaceRoute(url.pathname, 'state');
    if (request.method === 'GET' && stateWorkspaceId && productService) {
      try {
        const state = await productService.bootstrap(
          productIdentity(request, stateWorkspaceId, requestCorrelationId)
        );
        sendJson(response, 200, state, requestCorrelationId);
      } catch (error) {
        const domainError =
          error instanceof DomainError
            ? error
            : new DomainError(
                'INTERNAL_ERROR',
                'Product state could not be loaded.',
                500
              );
        sendError(
          response,
          domainError.status,
          {
            code: domainError.code,
            message: domainError.message,
            details: domainError.details,
          },
          requestCorrelationId
        );
      }
      return;
    }

    const commandWorkspaceId = workspaceRoute(url.pathname, 'commands');
    if (request.method === 'POST' && commandWorkspaceId && productService) {
      try {
        const idempotencyKey = requiredIdempotencyKey(request);
        const parsedCommand = productCommandSchema.safeParse(
          await readJson(request)
        );
        if (!parsedCommand.success) {
          throw new DomainError(
            'INVALID_COMMAND',
            'A valid typed product command is required.'
          );
        }
        const command: ProductCommand = parsedCommand.data;
        const context = productIdentity(
          request,
          commandWorkspaceId,
          requestCorrelationId
        );
        authorizeProductCommand(context, command);
        const result = await productService.execute(
          context,
          command,
          idempotencyKey
        );
        sendJson(response, 200, result, requestCorrelationId);
      } catch (error) {
        const domainError =
          error instanceof DomainError
            ? error
            : new DomainError(
                'INVALID_COMMAND',
                'The product command could not be processed.'
              );
        sendError(
          response,
          domainError.status,
          {
            code: domainError.code,
            message: domainError.message,
            details: domainError.details,
          },
          requestCorrelationId
        );
      }
      return;
    }

    const p1CommandWorkspaceId = workspaceRoute(url.pathname, 'p1/commands');
    if (
      request.method === 'POST' &&
      p1CommandWorkspaceId &&
      p1ApplicationService
    ) {
      try {
        const idempotencyKey = requiredIdempotencyKey(request);
        const parsed = p1ModuleRequestSchema.safeParse(await readJson(request));
        if (!parsed.success) {
          throw new DomainError(
            'INVALID_COMMAND',
            'A valid P1 module command is required.'
          );
        }
        const context = p1Identity(
          request,
          p1CommandWorkspaceId,
          requestCorrelationId
        );
        authorizeP1Request(
          context,
          'command',
          parsed.data.module,
          parsed.data.action
        );
        const result = await p1ApplicationService.executeModule(
          context,
          parsed.data.module,
          { action: parsed.data.action, payload: parsed.data.payload },
          idempotencyKey
        );
        sendJson(response, 200, result, requestCorrelationId);
      } catch (error) {
        const domainError =
          error instanceof DomainError
            ? error
            : error instanceof P1DomainError
              ? new DomainError(
                  error.code,
                  error.message,
                  error.code === 'NOT_FOUND'
                    ? 404
                    : error.code === 'FORBIDDEN'
                      ? 403
                      : 409
                )
              : error instanceof OperationsError
                ? new DomainError(
                    error.code,
                    error.message,
                    error.status,
                    error.details
                  )
              : typeof error === 'object' &&
                  error &&
                  'code' in error &&
                  typeof error.code === 'string' &&
                  'status' in error &&
                  typeof error.status === 'number'
                ? new DomainError(
                    error.code,
                    'The P1 command could not be processed.',
                    error.status,
                    'details' in error &&
                      typeof error.details === 'object' &&
                      error.details !== null
                      ? (error.details as Record<string, unknown>)
                      : undefined
                  )
                : new DomainError(
                    'INVALID_COMMAND',
                    'The P1 command could not be processed.'
                  );
        sendError(
          response,
          domainError.status,
          {
            code: domainError.code,
            message: domainError.message,
            details: domainError.details,
          },
          requestCorrelationId
        );
      }
      return;
    }

    const p1QueryWorkspaceId = workspaceRoute(url.pathname, 'p1/query');
    if (
      request.method === 'POST' &&
      p1QueryWorkspaceId &&
      p1ApplicationService
    ) {
      try {
        const parsed = p1ModuleRequestSchema.safeParse(await readJson(request));
        if (!parsed.success) {
          throw new DomainError(
            'INVALID_QUERY',
            'A valid P1 module query is required.'
          );
        }
        const context = p1Identity(
          request,
          p1QueryWorkspaceId,
          requestCorrelationId
        );
        authorizeP1Request(
          context,
          'query',
          parsed.data.module,
          parsed.data.action
        );
        const result = await p1ApplicationService.queryModule(
          context,
          parsed.data.module,
          { action: parsed.data.action, payload: parsed.data.payload }
        );
        sendJson(response, 200, result, requestCorrelationId);
      } catch (error) {
        const domainError =
          error instanceof DomainError
            ? error
            : error instanceof P1DomainError
              ? new DomainError(
                  error.code,
                  error.message,
                  error.code === 'NOT_FOUND'
                    ? 404
                    : error.code === 'FORBIDDEN'
                      ? 403
                      : 409
                )
              : typeof error === 'object' &&
                  error &&
                  'code' in error &&
                  typeof error.code === 'string' &&
                  'status' in error &&
                  typeof error.status === 'number'
                ? new DomainError(
                    error.code,
                    'The P1 query could not be processed.',
                    error.status
                  )
                : new DomainError(
                    'INVALID_QUERY',
                    'The P1 query could not be processed.'
                  );
        sendError(
          response,
          domainError.status,
          { code: domainError.code, message: domainError.message },
          requestCorrelationId
        );
      }
      return;
    }

    const eventRunId = routeId(url.pathname, 'events');
    if (request.method === 'GET' && eventRunId) {
      const identity = diagnosticIdentity(request);
      if (!identity) {
        sendError(
          response,
          401,
          {
            code: 'UNAUTHORIZED_IDENTITY',
            message: 'User and workspace identity are required.',
          },
          requestCorrelationId
        );
        return;
      }
      const run = await diagnosticRepository.get(eventRunId, identity);
      if (!run) {
        sendError(
          response,
          404,
          { code: 'RUN_NOT_FOUND', message: 'Diagnostic run not found.' },
          requestCorrelationId
        );
        return;
      }
      response.writeHead(200, {
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'content-type': 'text/event-stream; charset=utf-8',
      });
      for (const event of run.events) {
        response.write(
          `event: progress\ndata: ${JSON.stringify({ message: event })}\n\n`
        );
      }
      response.end(
        `event: state\ndata: ${JSON.stringify({ status: run.status })}\n\n`
      );
      return;
    }

    const resumeRunId = routeId(url.pathname, 'resume');
    if (request.method === 'POST' && resumeRunId) {
      sendError(
        response,
        410,
        {
          code: 'DIAGNOSTIC_CONTENT_GENERATION_RETIRED',
          message:
            'Content-generation diagnostics are retired. Use the ModelSupply generation path.',
        },
        requestCorrelationId
      );
      return;
    }

    sendError(
      response,
      404,
      { code: 'NOT_FOUND', message: 'Route not found.' },
      requestCorrelationId
    );
  });
}
