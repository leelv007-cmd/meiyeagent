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
  harnessInteractionEditingSchema,
  harnessInteractionMerchantMessageSchema,
  harnessInteractionRendererAckSchema,
  structuredDecisionInputSchema,
  hasProductCapability,
  productCommandSchema,
  requiredP1Capability,
  requiredProductCommandCapability,
  type ApiEnvelope,
  type ContentPackage,
  type ProductRole,
  type ProductCommand,
  type ProductContext,
  type PublicPlanCatalog,
  toPublicContentPackage,
} from '@meiye/contracts';
import { z } from 'zod';
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
import {
  type CreditPlanCatalog,
  readPublicCreditPlanCatalog,
} from './p1/credit-billing/credit-plan-catalog.js';
import type { IntegrationApplicationService } from './p1/integrations/index.js';
import type { AiStreamingRunner } from './p1/model-supply/ai-sdk-runner.js';
import type {
  CanvasTextGenerationStreamEvent,
  ModelSupplyControlPlaneService,
} from './p1/model-supply/foundation-module.js';
import type { CustodyOwnedAssetContentType } from './p1/model-supply/index.js';
import type { OperationsApplicationService } from './p1/operations/application-service.js';
import type { OperationContext } from './p1/operations/types.js';
import type { HarnessApplicationService } from './p1/harness/application-service.js';
import type {
  CreateExecutionConfirmationResult,
  DecideExecutionConfirmationInput,
  DecideExecutionConfirmationResult,
  ExpireExecutionConfirmationInput,
  ExpireExecutionConfirmationResult,
} from './p1/agent-session/execution-confirmation-service.js';
import type { CreateExecutionConfirmationAuthorityInput } from './p1/agent-session/execution-confirmation-authority.js';
import { ExecutionConfirmationError } from './p1/agent-session/execution-confirmation-store.js';
import type { StoredConfirmationRequest } from './p1/agent-session/execution-confirmation-store.js';
import { composerSubmissionBodySchema } from './p1/execution-spine/creation-execution-snapshot.js';
import {
  composerDestinationMappingRequestSchema,
  type ComposerDestinationMappingPort,
} from './p1/execution-spine/composer-destination-mapper.js';
import type { CreationSubmissionCoordinator } from './p1/execution-spine/submission-coordinator.js';
import {
  campaignPaidWorkStartBodySchema,
  type CampaignPaidWorkApplication,
} from './p1/goal-proactive/campaign-paid-work-application.js';
import {
  encodeAgentSemanticSseFrame,
  type AgentSemanticFrame,
  type ReplayPackage,
  type WorkbenchSessionProjection,
} from './p1/agent-semantic-events/index.js';
import type { PendingActionsService } from './p1/pending-actions.js';
import {
  encodeWorkflowSseFrame,
  type WorkflowEventApplicationService,
} from './p1/workflow-events.js';
import {
  type HttpErrorFallback,
  toHttpError,
  withErrorEnvelope,
} from './http-errors.js';
import { streamSse } from './sse.js';
import {
  type AssetHttpPolicyPort,
  assetHttpPolicyFor,
} from './p1/model-supply/asset-http-policy.js';
import { RouteTable } from './route-table.js';
import { registerComposerPlanCommandRoutes } from './composer-plan-route-registrar.js';

interface CoreServerDependencies {
  clock?: () => Date;
  assetReader?: Partial<AssetHttpPolicyPort> & {
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
  productService?: ProductApplicationService;
  p1ApplicationService?: P1ApplicationService;
  workspaceBootstrapper?: {
    bootstrap(input: {
      idempotencyKey: string;
      ownerEmail: string;
      ownerName: string;
      ownerUserId: string;
      workspaceId: string;
      workspaceName: string;
    }): Promise<{ created: boolean }>;
  };
  integrationService?: IntegrationApplicationService;
  aiStreamingRunner?: AiStreamingRunner;
  canvasTextStreams?: Pick<
    ModelSupplyControlPlaneService,
    'streamCanvasTextGeneration'
  >;
  executionModeGate?: { blocksNewSubmission(): Promise<boolean> };
  /** E2E-only merchant credit lifecycle seed; absent from non-E2E assemblies. */
  e2eCreditDetailFixture?: {
    seed(input: { workspaceId: string }): Promise<{ ready: true }>;
  };
  /** E2E-only interrupt clock owner; absent from non-E2E assemblies. */
  e2eInterruptExpiryFixture?: {
    expire(input: {
      workspaceId: string;
      interruptId?: string;
      confirmationRequestId?: string;
    }): Promise<{ expired: true }>;
  };
  /** E2E-only stalled-work clock owner; absent from non-E2E assemblies. */
  e2eStalledWorkExpiryFixture?: {
    expire(input: {
      workspaceId: string;
      workId: string;
    }): Promise<{ expired: true }>;
  };
  /**
   * E2E-only Spec E user_selected Skill seed (published + bound). Absent from
   * non-E2E assemblies. Optional foreignWorkspaceId seeds a tenant-scoped pack.
   */
  e2eUserSelectedSkillFixture?: {
    seed(input: {
      workspaceId: string;
      foreignWorkspaceId?: string;
    }): Promise<unknown>;
  };
  /**
   * E2E-only frozen admission evidence for one task (injection + audit axes).
   */
  e2eUserSelectedSkillEvidence?: {
    read(input: {
      workspaceId: string;
      taskId: string;
    }): Promise<unknown | null>;
  };
  /** Explicit capability guard; the fixture must stay unavailable if omitted. */
  e2eFixtureEnabled?: boolean;
  operationsService?: Pick<
    OperationsApplicationService,
    'getCreativeWorkbench'
  >;
  composerDestinationMapper?: ComposerDestinationMappingPort;
  composerSubmission?: {
    coordinator: Pick<CreationSubmissionCoordinator, 'submit'> &
      Partial<
        Pick<
          CreationSubmissionCoordinator,
          | 'answerClarification'
          | 'startPrepared'
          | 'revisePrepared'
          | 'cancelRunning'
        >
      >;
  };
  campaignPaidWorks?: Pick<CampaignPaidWorkApplication, 'start' | 'advance'>;
  /** Workspace-authenticated semantic replay/read seam (V31-28). */
  agentSemanticEvents?: {
    /** Explicit E2E-only transport fault seam; production assemblies omit it. */
    e2eFaultInjectionEnabled?: boolean;
    resolveSession(input: {
      workspaceId: string;
      threadId: string;
    }): Promise<WorkbenchSessionProjection | null>;
    loadReplay(input: {
      session: WorkbenchSessionProjection;
      clientLastEventId?: string;
    }): Promise<ReplayPackage>;
    streamReplay(input: {
      session: WorkbenchSessionProjection;
      lastEventId?: string;
      lastStreamOffset?: string;
      signal?: AbortSignal;
    }): AsyncIterable<AgentSemanticFrame>;
  };
  contentPackageReader?: {
    read(context: OperationContext, packageId: string): Promise<ContentPackage>;
  };
  harnessService?: HarnessApplicationService;
  pendingActions?: Pick<PendingActionsService, 'list'>;
  /**
   * V31-14 typed Interrupt protocol (listPending + resume CAS).
   * Workspace membership is enforced inside the service.
   */
  interruptProtocol?: {
    listPending(input: {
      userId: string;
      workspaceId: string;
      query: { resourceId: string; threadId?: string };
    }): Promise<unknown[]>;
    resume(input: {
      userId: string;
      workspaceId: string;
      command: unknown;
    }): Promise<unknown>;
  };
  /** Read side of the merchant credit catalogue for the public pricing page. */
  planCatalog?: {
    get(): Promise<CreditPlanCatalog>;
    publicView?(): Promise<PublicPlanCatalog>;
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
  /**
   * V31-11: confirmation-card HTTP surface (create/decide/expire/list pending).
   * Backed by sessionAgentHarness.createExecutionConfirmation /
   * decideExecutionConfirmation / expireExecutionConfirmationHold.
   */
  executionConfirmation?: {
    create(
      input: CreateExecutionConfirmationAuthorityInput,
    ): Promise<CreateExecutionConfirmationResult>;
    decide(
      input: DecideExecutionConfirmationInput,
    ): Promise<DecideExecutionConfirmationResult>;
    expire(
      input: ExpireExecutionConfirmationInput,
    ): Promise<ExpireExecutionConfirmationResult>;
    listPending(workspaceId: string): Promise<StoredConfirmationRequest[]>;
  };
  serviceToken: string;
  workflowEvents?: WorkflowEventApplicationService;
  workflowHeartbeatMs?: number;
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
const workspaceBootstrapRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  owner: z.object({
    email: z.string().trim().email().max(320),
    name: z.string().trim().min(1).max(200),
  }),
});

// V31-11: confirmation-card create body (domain service re-validates deeply
// via agentExecutionConfirmationRequestSchema — hold window + campaign bits).
const executionConfirmationCreateBodySchema = z
  .object({
    workflowId: z.string().trim().min(1).max(200),
  })
  .strict();

const executionConfirmationDecideBodySchema = z.object({
  decisionId: z.string().trim().min(1).max(200),
  decision: z.enum(['confirmed', 'rejected']),
});

const executionConfirmationExpireBodySchema = z.object({});

/**
 * V31-11 route-layer translation: ExecutionConfirmationError is a plain domain
 * error (not P1DomainError), so map its codes onto HTTP semantics here.
 */
function translateExecutionConfirmationError(error: unknown): never {
  if (error instanceof ExecutionConfirmationError) {
    const status =
      error.code === 'NOT_FOUND'
        ? 404
        : error.code === 'INSUFFICIENT_CREDITS' ||
            error.code === 'INVALID_STATE' ||
            error.code === 'CAMPAIGN_WORK_ALREADY_OPEN' ||
            error.code === 'DECISION_IMMUTABLE' ||
            error.code === 'IDEMPOTENCY_CONFLICT' ||
            error.code === 'HOLD_NOT_EXPIRED'
          ? 409
          : 400;
    throw new DomainError(error.code, error.message, status);
  }
  throw error;
}

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

function diagnosticRoute(pathname: string, suffix: string) {
  return new RegExp(`^/v1/diagnostics/[^/]+/${suffix}$`).test(pathname);
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

function workspaceCampaignPaidWorkRoute(pathname: string) {
  const match = pathname.match(
    /^\/v1\/workspaces\/([^/]+)\/p1\/campaigns\/paid-works(?:\/([^/]+))?$/
  );
  if (!match?.[1]) return null;
  try {
    return {
      workspaceId: decodeURIComponent(match[1]),
      campaignId: match[2] ? decodeURIComponent(match[2]) : undefined,
    };
  } catch {
    return null;
  }
}

function workspaceAgentSemanticRoute(pathname: string) {
  const match = pathname.match(
    /^\/v1\/workspaces\/([^/]+)\/p1\/agent-threads\/([^/]+)\/(replay|events)$/
  );
  if (!match?.[1] || !match[2] || !match[3]) return null;
  try {
    return {
      workspaceId: decodeURIComponent(match[1]),
      threadId: decodeURIComponent(match[2]),
      kind: match[3] as 'replay' | 'events',
    };
  } catch {
    return null;
  }
}

function semanticCursor(value: string | null | undefined): string | undefined {
  const cursor = value?.trim();
  if (!cursor || cursor.length > 200) return undefined;
  return cursor;
}

function semanticStreamOffset(
  value: string | null | undefined
): string | undefined {
  const cursor = value?.trim();
  if (!cursor || !/^(0|[1-9]\d*)$/u.test(cursor)) return undefined;
  return cursor;
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

export async function streamWorkflowEvents(input: {
  request: IncomingMessage;
  response: ServerResponse;
  requestCorrelationId: string;
  workflowEvents: WorkflowEventApplicationService;
  workflowHeartbeatMs: number;
  workflowId: string;
  workspaceId: string;
}) {
  await streamSse({
    disconnectMessage: 'Client disconnected.',
    errorFallback: {
      code: 'WORKFLOW_EVENTS_UNAVAILABLE',
      message: 'Workflow events are unavailable.',
      status: 503,
    },
    heartbeatMs: input.workflowHeartbeatMs,
    observeRequestClose: true,
    protocol: 'workflow-events-v1',
    request: input.request,
    requestCorrelationId: input.requestCorrelationId,
    response: input.response,
    source: async ({ ready, signal, write }) => {
      const lastEventId = input.request.headers['last-event-id'];
      const subscription = await input.workflowEvents.subscribe({
        ...(typeof lastEventId === 'string' && lastEventId.trim()
          ? { lastEventId: lastEventId.trim() }
          : {}),
        signal,
        workflowId: input.workflowId,
        workspaceId: input.workspaceId,
      });
      if (!subscription) {
        throw new DomainError('NOT_FOUND', 'Workflow was not found.', 404);
      }
      if (signal.aborted) return;
      await ready();
      for await (const frame of subscription.frames) {
        if (signal.aborted) break;
        await write(encodeWorkflowSseFrame(frame));
      }
    },
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
  const domainError = toHttpError(error, {
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
  productService,
  p1ApplicationService,
  workspaceBootstrapper,
  integrationService,
  operationsService,
  composerDestinationMapper,
  composerSubmission,
  campaignPaidWorks,
  agentSemanticEvents,
  contentPackageReader,
  e2eCreditDetailFixture,
  e2eInterruptExpiryFixture,
  e2eStalledWorkExpiryFixture,
  e2eUserSelectedSkillFixture,
  e2eUserSelectedSkillEvidence,
  e2eFixtureEnabled = false,
  harnessService,
  pendingActions,
  interruptProtocol,
  planCatalog,
  runtimeTruth,
  executionConfirmation,
  serviceToken,
  workflowEvents,
  workflowHeartbeatMs = 15_000,
  clock = () => new Date(),
}: CoreServerDependencies) {
  const assetPolicy = assetReader ? assetHttpPolicyFor(assetReader) : undefined;
  return createServer(async (request, response) => {
    const requestCorrelationId = correlationId(request);
    const url = new URL(request.url ?? '/', 'http://core.local');
    const routes = new RouteTable();
    const handleErrors = (
      handler: () => Promise<void> | void,
      fallback: HttpErrorFallback,
      options: {
        includeDetails?: boolean;
        onHeadersSent?: (error: unknown) => Promise<void> | void;
      } = {}
    ) =>
      withErrorEnvelope(handler, {
        ...options,
        fallback,
        requestCorrelationId,
        response,
      });

    // Process-only liveness. Never touches external dependencies or runtimeTruth.
    routes.add('health', [
      'GET',
      () => url.pathname === '/health' || url.pathname === '/health/live',
      'public',
      async () => {
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
      },
    ]);

    routes.add('health-assembly', [
      'GET',
      () => url.pathname === '/health/assembly',
      'public',
      async () => {
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
      },
    ]);

    routes.add('health-ready', [
      'GET',
      () => url.pathname === '/health/ready',
      'public',
      async () => {
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
      },
    ]);

    routes.add('capabilities', [
      'GET',
      () => url.pathname === '/capabilities',
      'public',
      async () => {
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
        await handleErrors(
          async () => {
            const snapshot = await runtimeTruth.listMerchantCapabilities();
            sendJson(response, 200, snapshot, requestCorrelationId);
          },
          {
            code: 'CAPABILITIES_UNAVAILABLE',
            message: 'Capabilities projection failed.',
            status: 500,
            unknownMessage: 'error',
          }
        );
        return;
      },
    ]);

    const bootstrapWorkspaceId = workspaceRoute(url.pathname, 'bootstrap');
    routes.add('workspace-bootstrap', [
      'POST',
      () => Boolean(bootstrapWorkspaceId),
      'service-token',
      async () => {
        await handleErrors(
          async () => {
            if (!workspaceBootstrapper) {
              throw new DomainError(
                'WORKSPACE_BOOTSTRAP_UNAVAILABLE',
                'Workspace bootstrap is not available.',
                503
              );
            }
            const idempotencyKey = requiredIdempotencyKey(request);
            const parsed = workspaceBootstrapRequestSchema.safeParse(
              await readJson(request)
            );
            if (!parsed.success) {
              throw new DomainError(
                'INVALID_WORKSPACE_BOOTSTRAP',
                'A valid workspace bootstrap request is required.'
              );
            }
            const context = p1Identity(
              request,
              bootstrapWorkspaceId!,
              requestCorrelationId
            );
            if (context.actor !== 'worker') {
              throw new DomainError(
                'COMMAND_ACTOR_FORBIDDEN',
                'Only the trusted worker can bootstrap a workspace.',
                403
              );
            }
            sendJson(
              response,
              200,
              await workspaceBootstrapper.bootstrap({
                idempotencyKey,
                ownerEmail: parsed.data.owner.email,
                ownerName: parsed.data.owner.name,
                ownerUserId: context.userId,
                workspaceId: context.workspaceId,
                workspaceName: parsed.data.name,
              }),
              requestCorrelationId
            );
          },
          {
            code: 'WORKSPACE_BOOTSTRAP_FAILED',
            message: 'The workspace bootstrap could not be processed.',
            p1DefaultStatus: 409,
            status: 409,
          },
          { includeDetails: true }
        );
        return;
      },
    ]);

    routes.add('e2e-credit-detail-fixture', [
      'POST',
      () =>
        url.pathname === '/v1/e2e/credit-detail-fixture' &&
        e2eFixtureEnabled &&
        Boolean(e2eCreditDetailFixture),
      'service-token',
      async () => {
        await handleErrors(
          async () => {
            const workspaceId = request.headers['x-workspace-id'];
            if (typeof workspaceId !== 'string' || workspaceId.length === 0) {
              throw new DomainError(
                'NOT_FOUND',
                'Workspace resource was not found.',
                404
              );
            }
            const context = productIdentity(
              request,
              workspaceId,
              requestCorrelationId
            );
            if (context.actor !== 'user') {
              throw new DomainError(
                'COMMAND_ACTOR_FORBIDDEN',
                'The current product role cannot seed E2E credit details.',
                403
              );
            }
            sendJson(
              response,
              200,
              await e2eCreditDetailFixture!.seed({
                workspaceId: context.workspaceId,
              }),
              requestCorrelationId
            );
          },
          {
            code: 'INVALID_STATE',
            message: 'The E2E credit detail fixture could not be seeded.',
            status: 400,
          }
        );
        return;
      },
    ]);

    routes.add('e2e-interrupt-expiry-fixture', [
      'POST',
      () =>
        url.pathname === '/v1/e2e/interrupt-expiry-fixture' &&
        e2eFixtureEnabled &&
        Boolean(e2eInterruptExpiryFixture),
      'service-token',
      async () => {
        await handleErrors(
          async () => {
            const workspaceId = request.headers['x-workspace-id'];
            if (typeof workspaceId !== 'string' || workspaceId.length === 0) {
              throw new DomainError('NOT_FOUND', 'Workspace resource was not found.', 404);
            }
            const context = productIdentity(request, workspaceId, requestCorrelationId);
            const body = (await readJson(request)) as {
              interruptId?: unknown;
              confirmationRequestId?: unknown;
            };
            const interruptId =
              typeof body.interruptId === 'string' ? body.interruptId : undefined;
            const confirmationRequestId =
              typeof body.confirmationRequestId === 'string'
                ? body.confirmationRequestId
                : undefined;
            if (
              context.actor !== 'user' ||
              (!interruptId && !confirmationRequestId)
            ) {
              throw new DomainError('COMMAND_ACTOR_FORBIDDEN', 'The interrupt expiry fixture is unavailable.', 403);
            }
            sendJson(
              response,
              200,
              await e2eInterruptExpiryFixture!.expire({
                workspaceId: context.workspaceId,
                ...(interruptId ? { interruptId } : {}),
                ...(confirmationRequestId ? { confirmationRequestId } : {}),
              }),
              requestCorrelationId,
            );
          },
          {
            code: 'INVALID_STATE',
            message: 'The E2E interrupt expiry fixture could not advance the clock.',
            status: 400,
            unknownMessage: 'error',
          },
        );
        return;
      },
    ]);

    routes.add('e2e-stalled-work-expiry-fixture', [
      'POST',
      () =>
        url.pathname === '/v1/e2e/stalled-work-expiry-fixture' &&
        e2eFixtureEnabled &&
        Boolean(e2eStalledWorkExpiryFixture),
      'service-token',
      async () => {
        await handleErrors(
          async () => {
            const workspaceId = request.headers['x-workspace-id'];
            if (typeof workspaceId !== 'string' || workspaceId.length === 0) {
              throw new DomainError('NOT_FOUND', 'Workspace resource was not found.', 404);
            }
            const context = productIdentity(request, workspaceId, requestCorrelationId);
            const body = (await readJson(request)) as { workId?: unknown };
            if (context.actor !== 'user' || typeof body.workId !== 'string') {
              throw new DomainError(
                'COMMAND_ACTOR_FORBIDDEN',
                'The stalled-work expiry fixture is unavailable.',
                403,
              );
            }
            sendJson(
              response,
              200,
              await e2eStalledWorkExpiryFixture!.expire({
                workspaceId: context.workspaceId,
                workId: body.workId,
              }),
              requestCorrelationId,
            );
          },
          {
            code: 'INVALID_STATE',
            message: 'The E2E stalled-work expiry fixture could not advance the clock.',
            status: 400,
          },
        );
        return;
      },
    ]);

    routes.add('e2e-user-selected-skill-fixture', [
      'POST',
      () =>
        url.pathname === '/v1/e2e/user-selected-skill-fixture' &&
        e2eFixtureEnabled &&
        Boolean(e2eUserSelectedSkillFixture),
      'service-token',
      async () => {
        await handleErrors(
          async () => {
            const workspaceId = request.headers['x-workspace-id'];
            if (typeof workspaceId !== 'string' || workspaceId.length === 0) {
              throw new DomainError(
                'NOT_FOUND',
                'Workspace resource was not found.',
                404
              );
            }
            const context = productIdentity(
              request,
              workspaceId,
              requestCorrelationId
            );
            if (context.actor !== 'user') {
              throw new DomainError(
                'COMMAND_ACTOR_FORBIDDEN',
                'The current product role cannot seed E2E user_selected skills.',
                403
              );
            }
            // Query-only: BFF session proxy does not forward arbitrary e2e headers.
            const foreignQuery = url.searchParams.get('foreignWorkspaceId');
            const foreignWorkspaceId =
              typeof foreignQuery === 'string' && foreignQuery.trim()
                ? foreignQuery.trim()
                : undefined;
            sendJson(
              response,
              200,
              await e2eUserSelectedSkillFixture!.seed({
                workspaceId: context.workspaceId,
                ...(foreignWorkspaceId ? { foreignWorkspaceId } : {}),
              }),
              requestCorrelationId
            );
          },
          {
            code: 'INVALID_STATE',
            message: 'The E2E user_selected skill fixture could not be seeded.',
            status: 400,
          }
        );
        return;
      },
    ]);

    routes.add('e2e-user-selected-skill-evidence', [
      'POST',
      () =>
        url.pathname === '/v1/e2e/user-selected-skill-evidence' &&
        e2eFixtureEnabled &&
        Boolean(e2eUserSelectedSkillEvidence),
      'service-token',
      async () => {
        await handleErrors(
          async () => {
            const workspaceId = request.headers['x-workspace-id'];
            if (typeof workspaceId !== 'string' || workspaceId.length === 0) {
              throw new DomainError(
                'NOT_FOUND',
                'Workspace resource was not found.',
                404
              );
            }
            const context = productIdentity(
              request,
              workspaceId,
              requestCorrelationId
            );
            if (context.actor !== 'user') {
              throw new DomainError(
                'COMMAND_ACTOR_FORBIDDEN',
                'The current product role cannot read E2E skill evidence.',
                403
              );
            }
            // Query-only: BFF session proxy does not forward arbitrary e2e headers.
            const taskQuery = url.searchParams.get('taskId');
            if (typeof taskQuery !== 'string' || taskQuery.trim().length === 0) {
              throw new DomainError(
                'NOT_FOUND',
                'Task resource was not found.',
                404
              );
            }
            const evidence = await e2eUserSelectedSkillEvidence!.read({
              workspaceId: context.workspaceId,
              taskId: taskQuery.trim(),
            });
            if (!evidence) {
              throw new DomainError(
                'NOT_FOUND',
                'Task resource was not found.',
                404
              );
            }
            sendJson(response, 200, evidence, requestCorrelationId);
          },
          {
            code: 'INVALID_STATE',
            message: 'The E2E user_selected skill evidence could not be read.',
            status: 400,
          }
        );
        return;
      },
    ]);

    // The public price page reads the same `plan.credits.*` revision as the
    // subscription grant scheduler. Provider costs never enter this contract.
    // Service-token gated because the browser never talks to core directly —
    // the Web BFF fetches this for its /pricing loader.
    routes.add('public-plan-catalog', [
      'GET',
      () => url.pathname === '/public/plan-catalog' && Boolean(planCatalog),
      'service-token',
      async () => {
        await handleErrors(
          async () => {
            sendJson(
              response,
              200,
              await readPublicCreditPlanCatalog(planCatalog!),
              requestCorrelationId
            );
          },
          {
            code: 'PLAN_CATALOG_UNAVAILABLE',
            message: 'Plan catalogue projection failed.',
            status: 500,
            unknownMessage: 'error',
          }
        );
        return;
      },
    ]);

    const pendingActionsWorkspaceId = workspaceRoute(
      url.pathname,
      'p1/pending-actions'
    );
    routes.add('pending-actions', [
      'GET',
      () => Boolean(pendingActions && pendingActionsWorkspaceId),
      'service-token',
      async () => {
        await handleErrors(
          async () => {
            const context = p1Identity(
              request,
              pendingActionsWorkspaceId!,
              requestCorrelationId
            );
            sendJson(
              response,
              200,
              await pendingActions!.list({
                userId: context.userId,
                workspaceId: context.workspaceId,
              }),
              requestCorrelationId
            );
          },
          {
            code: 'PENDING_ACTIONS_UNAVAILABLE',
            message: 'Pending actions are unavailable.',
            status: 400,
            unknownMessage: 'error',
          }
        );
        return;
      },
    ]);

    // V31-14: listPendingInterrupts({ resourceId, threadId? }) workspace auth.
    const pendingInterruptsWorkspaceId = workspaceRoute(
      url.pathname,
      'p1/pending-interrupts'
    );
    routes.add('pending-interrupts-list', [
      'GET',
      () => Boolean(interruptProtocol && pendingInterruptsWorkspaceId),
      'service-token',
      async () => {
        await handleErrors(
          async () => {
            const context = p1Identity(
              request,
              pendingInterruptsWorkspaceId!,
              requestCorrelationId
            );
            const threadId = url.searchParams.get('threadId')?.trim();
            sendJson(
              response,
              200,
              {
                interrupts: await interruptProtocol!.listPending({
                  userId: context.userId,
                  workspaceId: context.workspaceId,
                  query: {
                    resourceId: context.workspaceId,
                    ...(threadId ? { threadId } : {}),
                  },
                }),
              },
              requestCorrelationId
            );
          },
          {
            code: 'PENDING_INTERRUPTS_UNAVAILABLE',
            message: 'Pending interrupts are unavailable.',
            status: 400,
            unknownMessage: 'error',
          }
        );
        return;
      },
    ]);

    const resumeInterruptWorkspaceId = workspaceRoute(
      url.pathname,
      'p1/interrupts/resume'
    );
    routes.add('pending-interrupts-resume', [
      'POST',
      () => Boolean(interruptProtocol && resumeInterruptWorkspaceId),
      'service-token',
      async () => {
        await handleErrors(
          async () => {
            const context = p1Identity(
              request,
              resumeInterruptWorkspaceId!,
              requestCorrelationId
            );
            const body = await readJson(request);
            sendJson(
              response,
              200,
              await interruptProtocol!.resume({
                userId: context.userId,
                workspaceId: context.workspaceId,
                command: body,
              }),
              requestCorrelationId
            );
          },
          {
            code: 'INTERRUPT_RESUME_FAILED',
            message: 'Interrupt resume failed.',
            status: 400,
            unknownMessage: 'error',
          }
        );
        return;
      },
    ]);

    const composerDestinationWorkspaceId = workspaceRoute(
      url.pathname,
      'p1/composer/destination-map'
    );
    routes.add('composer-destination-map', [
      '*',
      () =>
        Boolean(composerDestinationMapper && composerDestinationWorkspaceId),
      'service-token',
      async () => {
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
        await handleErrors(
          async () => {
            const context = p1Identity(
              request,
              composerDestinationWorkspaceId!,
              requestCorrelationId
            );
            authorizeContentCreation(context);
            const body = composerDestinationMappingRequestSchema.parse(
              await readJson(request)
            );
            const result = await composerDestinationMapper!.map({
              ...body,
              idempotencyKey: `destination-map-${createHash('sha256')
                .update(
                  JSON.stringify({
                    destination: body.destination.trim(),
                    workspaceId: context.workspaceId,
                  })
                )
                .digest('hex')}`,
              workspaceId: context.workspaceId,
            });
            sendJson(response, 200, result, requestCorrelationId);
          },
          {
            code: 'INVALID_COMPOSER_DESTINATION',
            message: 'Composer destination mapping input is invalid.',
            status: 400,
          }
        );
        return;
      },
    ]);

    const composerSubmissionWorkspaceId = workspaceRoute(
      url.pathname,
      'p1/composer/submissions'
    );
    routes.add('composer-submissions', [
      '*',
      () => Boolean(composerSubmission && composerSubmissionWorkspaceId),
      'service-token',
      async () => {
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
        await handleErrors(
          async () => {
            const context = p1Identity(
              request,
              composerSubmissionWorkspaceId!,
              requestCorrelationId
            );
            authorizeContentCreation(context);
            const body = composerSubmissionBodySchema.parse(
              await readJson(request)
            );
            const result = await composerSubmission!.coordinator.submit({
              ...body,
              actorId: context.userId,
              workspaceId: context.workspaceId,
            });
            sendJson(response, 202, result, requestCorrelationId);
          },
          {
            code: 'INVALID_COMPOSER_SUBMISSION',
            message: 'Composer submission is invalid.',
            status: 400,
            unknownMessage: 'error',
          }
        );
        return;
      },
    ]);

    registerComposerPlanCommandRoutes({
      routes,
      pathname: url.pathname,
      coordinator: composerSubmission?.coordinator,
      authorize(workspaceId) {
        const context = p1Identity(request, workspaceId, requestCorrelationId);
        authorizeContentCreation(context);
        return context;
      },
      readBody: () => readJson(request),
      respond: (status, payload) =>
        sendJson(response, status, payload, requestCorrelationId),
      handle: (command, fallback) => handleErrors(command, fallback),
    });
    const campaignPaidWorkRoute = workspaceCampaignPaidWorkRoute(url.pathname);
    routes.add('campaign-paid-work-start', [
      'POST',
      () =>
        Boolean(
          campaignPaidWorks &&
            campaignPaidWorkRoute &&
            !campaignPaidWorkRoute.campaignId
        ),
      'service-token',
      async () => {
        await handleErrors(
          async () => {
            const context = p1Identity(
              request,
              campaignPaidWorkRoute!.workspaceId,
              requestCorrelationId
            );
            authorizeContentCreation(context);
            const body = campaignPaidWorkStartBodySchema.parse(
              await readJson(request)
            );
            const result = await campaignPaidWorks!.start({
              ...body,
              actorId: context.userId,
              workspaceId: context.workspaceId,
            });
            sendJson(response, 202, result, requestCorrelationId);
          },
          {
            code: 'INVALID_CAMPAIGN_PAID_WORK_START',
            message: 'Campaign paid Work could not be started.',
            status: 400,
            unknownMessage: 'error',
          }
        );
        return;
      },
    ]);
    routes.add('campaign-paid-work-status', [
      'GET',
      () =>
        Boolean(
          campaignPaidWorks &&
            campaignPaidWorkRoute?.campaignId
        ),
      'service-token',
      async () => {
        await handleErrors(
          async () => {
            const context = p1Identity(
              request,
              campaignPaidWorkRoute!.workspaceId,
              requestCorrelationId
            );
            authorizeContentCreation(context);
            const result = await campaignPaidWorks!.advance(
              context.workspaceId,
              campaignPaidWorkRoute!.campaignId!
            );
            sendJson(response, 200, result, requestCorrelationId);
          },
          {
            code: 'CAMPAIGN_PAID_WORK_UNAVAILABLE',
            message: 'Campaign paid Work is unavailable.',
            status: 400,
            unknownMessage: 'error',
          }
        );
        return;
      },
    ]);

    const composerTaskEventRoute = workspaceComposerTaskEventRoute(
      url.pathname
    );
    routes.add('composer-task-events', [
      '*',
      () => Boolean(composerSubmission && composerTaskEventRoute),
      'service-token',
      async () => {
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
        await handleErrors(
          async () => {
            if (!workflowEvents) {
              throw new DomainError(
                'COMPOSER_EVENTS_UNAVAILABLE',
                'Composer events are unavailable.',
                503
              );
            }
            const context = p1Identity(
              request,
              composerTaskEventRoute!.workspaceId,
              requestCorrelationId
            );
            authorizeP1Request(
              context,
              'query',
              'model-supply',
              'video_workflow'
            );
            await streamWorkflowEvents({
              request,
              response,
              requestCorrelationId,
              workflowEvents,
              workflowHeartbeatMs,
              workflowId: composerTaskEventRoute!.taskId,
              workspaceId: composerTaskEventRoute!.workspaceId,
            });
          },
          {
            code: 'COMPOSER_EVENTS_UNAVAILABLE',
            message: 'Composer events are unavailable.',
            status: 503,
          }
        );
        return;
      },
    ]);

    const composerContentPackageRoute = workspaceComposerContentPackageRoute(
      url.pathname
    );
    routes.add('composer-content-package', [
      '*',
      () => Boolean(composerSubmission && composerContentPackageRoute),
      'service-token',
      async () => {
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
        await handleErrors(
          async () => {
            if (!contentPackageReader) {
              throw new DomainError(
                'COMPOSER_CONTENT_PACKAGE_UNAVAILABLE',
                'Composer ContentPackage projections are unavailable.',
                503
              );
            }
            const context = p1Identity(
              request,
              composerContentPackageRoute!.workspaceId,
              requestCorrelationId
            );
            authorizeP1Request(
              context,
              'query',
              'model-supply',
              'video_workflow'
            );
            const contentPackage = await contentPackageReader.read(
              {
                actor: context.actor as OperationContext['actor'],
                correlationId: context.correlationId,
                userId: context.userId,
                workspaceId: context.workspaceId,
              },
              composerContentPackageRoute!.packageId
            );
            sendJson(
              response,
              200,
              toPublicContentPackage(contentPackage),
              requestCorrelationId
            );
          },
          {
            code: 'COMPOSER_CONTENT_PACKAGE_UNAVAILABLE',
            message: 'Composer ContentPackage projection is unavailable.',
            status: 503,
          }
        );
        return;
      },
    ]);

    const agentSemanticRoute = workspaceAgentSemanticRoute(url.pathname);
    routes.add('agent-semantic-replay', [
      'GET',
      () =>
        Boolean(agentSemanticEvents && agentSemanticRoute?.kind === 'replay'),
      'service-token',
      async () => {
        await handleErrors(
          async () => {
            const context = p1Identity(
              request,
              agentSemanticRoute!.workspaceId,
              requestCorrelationId
            );
            authorizeP1Request(context, 'query', 'agent-session', 'get_thread');
            const session = await agentSemanticEvents!.resolveSession({
              workspaceId: context.workspaceId,
              threadId: agentSemanticRoute!.threadId,
            });
            if (!session) {
              throw new DomainError(
                'NOT_FOUND',
                'Agent Thread was not found in this workspace.',
                404
              );
            }
            const clientLastEventId = semanticCursor(
              url.searchParams.get('lastEventId')
            );
            const replay = await agentSemanticEvents!.loadReplay({
              session,
              ...(clientLastEventId ? { clientLastEventId } : {}),
            });
            const replayFault = agentSemanticEvents!.e2eFaultInjectionEnabled
              ? url.searchParams.get('e2eAgentFault')
              : null;
            if (replayFault === 'artifact-head-replay') {
              const firstArtifactIndex = replay.events.findIndex(
                (event) => event.eventType === 'artifact.revised'
              );
              if (firstArtifactIndex >= 0) {
                response.setHeader(
                  'x-meiye-e2e-agent-fault-applied',
                  replayFault
                );
                sendJson(
                  response,
                  200,
                  {
                    ...replay,
                    events: replay.events.slice(0, firstArtifactIndex + 1),
                    snapshot: {
                      ...replay.snapshot,
                      revision: '0',
                      lastEventId: null,
                      lastStreamOffset: null,
                      includedEventIds: [],
                      summarizedEventIds: [],
                      excludedEventIds: [],
                    },
                  },
                  requestCorrelationId
                );
                return;
              }
            }
            sendJson(response, 200, replay, requestCorrelationId);
          },
          {
            code: 'AGENT_SEMANTIC_REPLAY_UNAVAILABLE',
            message: 'Agent Thread replay is unavailable.',
            status: 503,
          }
        );
        return;
      },
    ]);

    routes.add('agent-semantic-events', [
      'GET',
      () =>
        Boolean(agentSemanticEvents && agentSemanticRoute?.kind === 'events'),
      'service-token',
      async () => {
        const streamFault = agentSemanticEvents!.e2eFaultInjectionEnabled
          ? url.searchParams.get('e2eAgentFault')
          : null;
        await streamSse({
          ...(streamFault === 'artifact-gap-close'
            ? {
                additionalResponseHeaders: {
                  'x-meiye-e2e-agent-fault-applied': streamFault,
                },
              }
            : {}),
          disconnectMessage: 'Agent semantic stream disconnected.',
          errorFallback: {
            code: 'AGENT_SEMANTIC_EVENTS_UNAVAILABLE',
            message: 'Agent semantic events are unavailable.',
            status: 503,
          },
          heartbeatMs: workflowHeartbeatMs,
          observeRequestClose: true,
          protocol: 'agent-semantic-events-v1',
          request,
          requestCorrelationId,
          response,
          source: async ({ ready, signal, write }) => {
            const context = p1Identity(
              request,
              agentSemanticRoute!.workspaceId,
              requestCorrelationId
            );
            authorizeP1Request(context, 'query', 'agent-session', 'get_thread');
            const session = await agentSemanticEvents!.resolveSession({
              workspaceId: context.workspaceId,
              threadId: agentSemanticRoute!.threadId,
            });
            if (!session) {
              throw new DomainError(
                'NOT_FOUND',
                'Agent Thread was not found in this workspace.',
                404
              );
            }
            const lastEventId = semanticCursor(
              typeof request.headers['last-event-id'] === 'string'
                ? request.headers['last-event-id']
                : url.searchParams.get('lastEventId')
            );
            const lastStreamOffset = semanticStreamOffset(
              url.searchParams.get('lastStreamOffset')
            );
            await ready();
            let skippedArtifactRevision = false;
            for await (const frame of agentSemanticEvents!.streamReplay({
              session,
              ...(lastEventId ? { lastEventId } : {}),
              ...(!lastEventId && lastStreamOffset ? { lastStreamOffset } : {}),
              signal,
            })) {
              if (signal.aborted) break;
              if (
                streamFault === 'artifact-gap-close' &&
                frame.event === 'agent.semantic' &&
                frame.data.eventType === 'artifact.revised'
              ) {
                if (!skippedArtifactRevision) {
                  skippedArtifactRevision = true;
                  continue;
                }
                await write(encodeAgentSemanticSseFrame(frame));
                return;
              }
              await write(encodeAgentSemanticSseFrame(frame));
            }
          },
        });
        return;
      },
    ]);

    const harnessRecommendationWorkspaceId = workspaceRoute(
      url.pathname,
      'p1/harness/recommendation'
    );
    routes.add('harness-recommendation', [
      'GET',
      () => Boolean(harnessService && harnessRecommendationWorkspaceId),
      'service-token',
      async () => {
        await handleErrors(
          async () => {
            const context = p1Identity(
              request,
              harnessRecommendationWorkspaceId!,
              requestCorrelationId
            );
            authorizeContentCreation(context);
            sendJson(
              response,
              200,
              await harnessService!.readTodayRecommendation(
                harnessRecommendationWorkspaceId!
              ),
              requestCorrelationId
            );
          },
          {
            code: 'HARNESS_RECOMMENDATION_UNAVAILABLE',
            message: 'Harness recommendation is unavailable.',
            status: 503,
            unknownMessage: 'error',
          }
        );
        return;
      },
    ]);

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
      /^\/v1\/workspaces\/([^/]+)\/p1\/harness\/tasks\/([^/]+)\/interaction\/(?:v2\/)?editing$/
    );
    const harnessInteractionMessageMatch = url.pathname.match(
      /^\/v1\/workspaces\/([^/]+)\/p1\/harness\/tasks\/([^/]+)\/interaction\/message$/
    );
    const harnessInteractionRendererMatch = url.pathname.match(
      /^\/v1\/workspaces\/([^/]+)\/p1\/harness\/tasks\/([^/]+)\/interaction\/(?:v2\/)?renderer$/
    );
    routes.add('harness-product-metrics', [
      'POST',
      () => Boolean(harnessService && harnessProductMetricMatch),
      'service-token',
      async () => {
        await handleErrors(
          async () => {
            const workspaceId = decodeURIComponent(
              harnessProductMetricMatch![1]!
            );
            const taskId = decodeURIComponent(harnessProductMetricMatch![2]!);
            const context = p1Identity(
              request,
              workspaceId,
              requestCorrelationId
            );
            authorizeContentCreation(context);
            const metric = firstUsableDraftMetricSchema.parse(
              await readJson(request)
            );
            sendJson(
              response,
              202,
              await harnessService!.recordFirstUsableDraftMetric(
                workspaceId,
                taskId,
                metric
              ),
              requestCorrelationId
            );
          },
          {
            code: 'INVALID_HARNESS_PRODUCT_METRIC',
            message: 'Harness product metric is invalid.',
            status: 400,
            unknownMessage: 'error',
          }
        );
        return;
      },
    ]);
    // 时间桥 (D-145): what is still running for this workspace. The browser asks
    // on mount, which is how a closed tab stops being a lost run.
    routes.add('harness-active-tasks', [
      'GET',
      () => Boolean(harnessService && harnessTaskCollectionWorkspaceId),
      'service-token',
      async () => {
        await handleErrors(
          async () => {
            const context = p1Identity(
              request,
              harnessTaskCollectionWorkspaceId!,
              requestCorrelationId
            );
            authorizeContentCreation(context);
            sendJson(
              response,
              200,
              await harnessService!.listActiveTasks(
                harnessTaskCollectionWorkspaceId!
              ),
              requestCorrelationId
            );
          },
          {
            code: 'HARNESS_ACTIVE_TASKS_UNAVAILABLE',
            message: 'Harness active tasks are unavailable.',
            status: 503,
          }
        );
        return;
      },
    ]);
    routes.add('harness-task-admission', [
      'POST',
      () => Boolean(harnessTaskCollectionWorkspaceId),
      'service-token',
      async () => {
        await handleErrors(
          async () => {
            const context = p1Identity(
              request,
              harnessTaskCollectionWorkspaceId!,
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
          },
          {
            code: 'INVALID_HARNESS_REQUEST',
            message: 'Harness request is invalid.',
            status: 400,
          }
        );
        return;
      },
    ]);
    routes.add('harness-interaction', [
      '*',
      () =>
        Boolean(
          harnessService &&
            (request.method === 'GET' || request.method === 'POST') &&
            harnessInteractionMatch
        ),
      'service-token',
      async () => {
        await handleErrors(
          async () => {
            const workspaceId = decodeURIComponent(
              harnessInteractionMatch![1]!
            );
            const taskId = decodeURIComponent(harnessInteractionMatch![2]!);
            const context = p1Identity(
              request,
              workspaceId,
              requestCorrelationId
            );
            authorizeContentCreation(context);
            const result =
              request.method === 'GET'
                ? url.searchParams.get('view') === 'snapshot'
                  ? await harnessService!.readInteractionSnapshot(
                      workspaceId,
                      taskId
                    )
                  : await harnessService!.readPendingInteraction(
                      workspaceId,
                      taskId
                    )
                : await harnessService!.submitInteraction(
                    workspaceId,
                    taskId,
                    await readJson(request)
                  );
            sendJson(response, 200, result, requestCorrelationId);
          },
          {
            code: 'INVALID_HARNESS_INTERACTION',
            message: 'Harness interaction is invalid.',
            status: 400,
          }
        );
        return;
      },
    ]);
    routes.add('harness-interaction-message', [
      '*',
      () =>
        Boolean(
          harnessService &&
            (request.method === 'GET' || request.method === 'POST') &&
            harnessInteractionMessageMatch
        ),
      'service-token',
      async () => {
        await handleErrors(
          async () => {
            const workspaceId = decodeURIComponent(
              harnessInteractionMessageMatch![1]!
            );
            const taskId = decodeURIComponent(
              harnessInteractionMessageMatch![2]!
            );
            const context = p1Identity(
              request,
              workspaceId,
              requestCorrelationId
            );
            authorizeContentCreation(context);
            const result =
              request.method === 'GET'
                ? await harnessService!.readInteractionMerchantMessage(
                    workspaceId,
                    taskId
                  )
                : await harnessService!.submitInteractionMerchantMessage(
                    workspaceId,
                    taskId,
                    harnessInteractionMerchantMessageSchema.parse(
                      await readJson(request)
                    )
                  );
            sendJson(response, 200, result, requestCorrelationId);
          },
          {
            code: 'INVALID_HARNESS_INTERACTION_MESSAGE',
            message: 'Harness interaction message is invalid.',
            status: 400,
          }
        );
        return;
      },
    ]);
    routes.add('harness-interaction-renderer', [
      'POST',
      () => Boolean(harnessService && harnessInteractionRendererMatch),
      'service-token',
      async () => {
        await handleErrors(
          async () => {
            const workspaceId = decodeURIComponent(
              harnessInteractionRendererMatch![1]!
            );
            const taskId = decodeURIComponent(
              harnessInteractionRendererMatch![2]!
            );
            const context = p1Identity(
              request,
              workspaceId,
              requestCorrelationId
            );
            authorizeContentCreation(context);
            if (!url.pathname.endsWith('/interaction/v2/renderer')) {
              sendJson(
                response,
                426,
                {
                  code: 'HARNESS_INTERACTION_VERSION_REQUIRED',
                  requiredVersion: 2,
                },
                requestCorrelationId
              );
              return;
            }
            await harnessService!.ackInteractionRenderer(
              workspaceId,
              taskId,
              harnessInteractionRendererAckSchema.parse(await readJson(request))
            );
            response.writeHead(204, {
              'x-correlation-id': requestCorrelationId,
            });
            response.end();
          },
          {
            code: 'INVALID_HARNESS_INTERACTION_RENDERER',
            message: 'Harness interaction renderer acknowledgement is invalid.',
            status: 400,
          }
        );
        return;
      },
    ]);
    routes.add('harness-interaction-editing', [
      'POST',
      () => Boolean(harnessService && harnessInteractionEditingMatch),
      'service-token',
      async () => {
        await handleErrors(
          async () => {
            const workspaceId = decodeURIComponent(
              harnessInteractionEditingMatch![1]!
            );
            const taskId = decodeURIComponent(
              harnessInteractionEditingMatch![2]!
            );
            const context = p1Identity(
              request,
              workspaceId,
              requestCorrelationId
            );
            authorizeContentCreation(context);
            if (!url.pathname.endsWith('/interaction/v2/editing')) {
              sendJson(
                response,
                426,
                {
                  code: 'HARNESS_INTERACTION_VERSION_REQUIRED',
                  requiredVersion: 2,
                },
                requestCorrelationId
              );
              return;
            }
            const editing = harnessInteractionEditingSchema.parse(
              await readJson(request)
            );
            await harnessService!.setInteractionEditing(
              workspaceId,
              taskId,
              editing
            );
            response.writeHead(204, {
              'x-correlation-id': requestCorrelationId,
            });
            response.end();
          },
          {
            code: 'INVALID_HARNESS_INTERACTION_EDITING',
            message: 'Harness interaction editing state is invalid.',
            status: 400,
          }
        );
        return;
      },
    ]);
    routes.add('harness-decision', [
      '*',
      () =>
        Boolean(
          harnessService &&
            (request.method === 'GET' || request.method === 'POST') &&
            harnessDecisionMatch
        ),
      'service-token',
      async () => {
        await handleErrors(
          async () => {
            const workspaceId = decodeURIComponent(harnessDecisionMatch![1]!);
            const taskId = decodeURIComponent(harnessDecisionMatch![2]!);
            const context = p1Identity(
              request,
              workspaceId,
              requestCorrelationId
            );
            authorizeContentCreation(context);
            if (request.method === 'GET') {
              const snapshot = await harnessService!.readPendingDecision(
                workspaceId,
                taskId
              );
              sendJson(response, 200, snapshot, requestCorrelationId);
            } else {
              const decision = structuredDecisionInputSchema.parse(
                await readJson(request)
              );
              const result = await harnessService!.submitDecision(
                workspaceId,
                taskId,
                decision
              );
              sendJson(response, 200, result, requestCorrelationId);
            }
          },
          {
            code: 'INVALID_HARNESS_REQUEST',
            message: 'Harness request is invalid.',
            status: 400,
            unknownMessage: 'error',
          }
        );
        return;
      },
    ]);

    // V31-11: confirmation-card HTTP surface (create/decide/expire/list pending).
    // Backed by sessionAgentHarness confirmation methods (core-assembly binding).
    const confirmationCollectionWorkspaceId = workspaceRoute(
      url.pathname,
      'p1/confirmation-requests'
    );
    const confirmationActionMatch = url.pathname.match(
      /^\/v1\/workspaces\/([^/]+)\/p1\/confirmation-requests\/([^/]+)\/(decide|expire)$/
    );
    routes.add('confirmation-create', [
      'POST',
      () => Boolean(executionConfirmation && confirmationCollectionWorkspaceId),
      'service-token',
      async () => {
        await handleErrors(
          async () => {
            const context = p1Identity(
              request,
              confirmationCollectionWorkspaceId!,
              requestCorrelationId
            );
            authorizeContentCreation(context);
            const body = executionConfirmationCreateBodySchema.parse(
              await readJson(request)
            );
            let result: CreateExecutionConfirmationResult;
            try {
              result = await executionConfirmation!.create({
                ...body,
                actorId: context.userId,
                workspaceId: context.workspaceId,
              });
            } catch (error) {
              throw translateExecutionConfirmationError(error);
            }
            sendJson(response, 201, result, requestCorrelationId);
          },
          {
            code: 'INVALID_CONFIRMATION_REQUEST',
            message: 'The confirmation request could not be created.',
            status: 400,
            unknownMessage: 'error',
          }
        );
        return;
      },
    ]);
    routes.add('confirmation-list-pending', [
      'GET',
      () => Boolean(executionConfirmation && confirmationCollectionWorkspaceId),
      'service-token',
      async () => {
        await handleErrors(
          async () => {
            const context = p1Identity(
              request,
              confirmationCollectionWorkspaceId!,
              requestCorrelationId
            );
            authorizeContentCreation(context);
            const requests = await executionConfirmation!.listPending(
              context.workspaceId
            );
            sendJson(response, 200, { requests }, requestCorrelationId);
          },
          {
            code: 'CONFIRMATION_LIST_UNAVAILABLE',
            message: 'Pending confirmation requests are unavailable.',
            status: 400,
            unknownMessage: 'error',
          }
        );
        return;
      },
    ]);
    routes.add('confirmation-decide', [
      'POST',
      () =>
        Boolean(
          executionConfirmation &&
            confirmationActionMatch?.[3] === 'decide'
        ),
      'service-token',
      async () => {
        await handleErrors(
          async () => {
            const workspaceId = decodeURIComponent(
              confirmationActionMatch![1]!
            );
            const requestId = decodeURIComponent(
              confirmationActionMatch![2]!
            );
            const context = p1Identity(
              request,
              workspaceId,
              requestCorrelationId
            );
            authorizeContentCreation(context);
            const body = executionConfirmationDecideBodySchema.parse(
              await readJson(request)
            );
            let result: DecideExecutionConfirmationResult;
            try {
              result = await executionConfirmation!.decide({
                ...body,
                requestId,
                actorId: context.userId,
                workspaceId: context.workspaceId,
                decidedAt: clock().toISOString(),
              });
            } catch (error) {
              throw translateExecutionConfirmationError(error);
            }
            sendJson(response, 200, result, requestCorrelationId);
          },
          {
            code: 'CONFIRMATION_DECIDE_FAILED',
            message: 'The confirmation decision could not be recorded.',
            p1Statuses: {
              IDEMPOTENCY_CONFLICT: 409,
              NOT_FOUND: 404,
              INVALID_STATE: 409,
            },
            status: 400,
            unknownMessage: 'error',
          }
        );
        return;
      },
    ]);
    routes.add('confirmation-expire', [
      'POST',
      () =>
        Boolean(
          executionConfirmation &&
            confirmationActionMatch?.[3] === 'expire'
        ),
      'service-token',
      async () => {
        await handleErrors(
          async () => {
            const workspaceId = decodeURIComponent(
              confirmationActionMatch![1]!
            );
            const requestId = decodeURIComponent(
              confirmationActionMatch![2]!
            );
            const context = p1Identity(
              request,
              workspaceId,
              requestCorrelationId
            );
            authorizeContentCreation(context);
            executionConfirmationExpireBodySchema.parse(
              await readJson(request)
            );
            let result: ExpireExecutionConfirmationResult;
            try {
              result = await executionConfirmation!.expire({
                requestId,
                now: clock().toISOString(),
                actorId: context.userId,
                workspaceId: context.workspaceId,
              });
            } catch (error) {
              throw translateExecutionConfirmationError(error);
            }
            sendJson(response, 200, result, requestCorrelationId);
          },
          {
            code: 'CONFIRMATION_EXPIRE_FAILED',
            message: 'The confirmation hold could not be expired.',
            p1Statuses: {
              IDEMPOTENCY_CONFLICT: 409,
              NOT_FOUND: 404,
              INVALID_STATE: 409,
            },
            status: 400,
            unknownMessage: 'error',
          }
        );
        return;
      },
    ]);

    const workflowEventRoute = workspaceWorkflowEventRoute(url.pathname);
    routes.add('workflow-events', [
      'GET',
      () => Boolean(workflowEventRoute && workflowEvents),
      'service-token',
      async () => {
        await handleErrors(
          async () => {
            const context = p1Identity(
              request,
              workflowEventRoute!.workspaceId,
              requestCorrelationId
            );
            authorizeP1Request(
              context,
              'query',
              'model-supply',
              'video_workflow'
            );
            await streamWorkflowEvents({
              request,
              response,
              requestCorrelationId,
              workflowEvents: workflowEvents!,
              workflowHeartbeatMs,
              workflowId: workflowEventRoute!.workflowId,
              workspaceId: workflowEventRoute!.workspaceId,
            });
          },
          {
            code: 'WORKFLOW_EVENTS_UNAVAILABLE',
            message: 'Workflow events are unavailable.',
            status: 503,
          }
        );
        return;
      },
    ]);

    const canvasTextStreamWorkspaceId = workspaceRoute(
      url.pathname,
      'canvas/text/stream'
    );
    routes.add('canvas-text-stream', [
      'POST',
      () => Boolean(canvasTextStreamWorkspaceId),
      'service-token',
      async () => {
        await streamSse({
          disconnectMessage: 'Canvas text stream disconnected.',
          encodeStreamError: encodeCanvasTextStreamError,
          errorFallback: {
            code: 'CANVAS_TEXT_STREAM_FAILED',
            message: 'Canvas text streaming failed.',
            status: 502,
          },
          heartbeatMs: workflowHeartbeatMs,
          protocol: 'canvas-text-events-v1',
          request,
          requestCorrelationId,
          response,
          source: async ({ ready, signal, write }) => {
            if (!canvasTextStreams) {
              throw new DomainError(
                'CANVAS_TEXT_STREAM_UNAVAILABLE',
                'Canvas text streaming is unavailable in the current execution mode.',
                503
              );
            }
            const context = p1Identity(
              request,
              canvasTextStreamWorkspaceId!,
              requestCorrelationId
            );
            if (context.actor !== 'worker') {
              throw new DomainError(
                'FORBIDDEN',
                'Canvas text streaming requires the Canvas service actor.',
                403
              );
            }
            const parsed = canvasTextStreamRequest(await readJson(request));
            const afterSequence = canvasTextStreamCursor(
              request.headers['last-event-id']
            );
            await canvasTextStreams.streamCanvasTextGeneration(context, {
              abortSignal: signal,
              afterSequence,
              jobId: parsed.jobId,
              onEvent: async (event) => {
                await write(encodeCanvasTextStreamEvent(event));
              },
              onReady: ready,
              projectId: parsed.projectId,
              runner: aiStreamingRunner,
            });
          },
        });
        return;
      },
    ]);

    const assistantWorkspaceId = workspaceRoute(
      url.pathname,
      'p1/assistant/stream'
    );
    routes.add('assistant-stream', [
      'POST',
      () => Boolean(assistantWorkspaceId),
      'service-token',
      async () => {
        await handleErrors(
          async () => {
            if (!aiStreamingRunner || !operationsService) {
              throw new DomainError(
                'AI_STREAM_UNAVAILABLE',
                'AI streaming is unavailable in the current execution mode.',
                503
              );
            }
            const context = p1Identity(
              request,
              assistantWorkspaceId!,
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
            if (
              !aiStreamingRunner.supportsCatalogModel(
                parsed.data.catalogModelId
              )
            ) {
              throw new DomainError(
                'FIXED_MODEL_REQUIRED',
                'The assistant stream cannot switch to another model.',
                409
              );
            }
            if (
              executionModeGate &&
              (await executionModeGate.blocksNewSubmission())
            ) {
              throw new DomainError(
                'MODEL_EXECUTION_DISABLED',
                '模型执行已停用。',
                503
              );
            }
            const workbench =
              await operationsService.getCreativeWorkbench(context);
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
                abortController.signal,
                {
                  actorId: context.userId,
                  modality: 'llm',
                  operation: 'assistant.stream',
                  workspaceId: context.workspaceId,
                }
              ),
              response,
              requestCorrelationId
            );
          },
          {
            code: 'ASSISTANT_STREAM_FAILED',
            message: 'The assistant stream could not be started.',
            p1DefaultStatus: 403,
            p1Statuses: { INSUFFICIENT_ENTITLEMENT: 409 },
            status: 502,
          }
        );
        return;
      },
    ]);

    routes.add('assets', [
      '*',
      () =>
        (request.method === 'DELETE' ||
          request.method === 'GET' ||
          request.method === 'PUT') &&
        Boolean(assetReader && url.pathname.startsWith('/v1/assets/')),
      'service-token',
      async () => {
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
        try {
          assetPolicy!.assertOwnedBy({ objectKey, workspaceId });
        } catch {
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
        const ownedWorkspaceId = workspaceId as string;
        if (request.method === 'DELETE') {
          if (!assetReader!.deleteCanvasAsset) {
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
            await assetReader!.deleteCanvasAsset({
              objectKey,
              workspaceId: ownedWorkspaceId,
            });
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
          if (!assetReader!.putCanvasAsset) {
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
          const declaredLength = Number(request.headers['content-length']);
          if (
            Number.isFinite(declaredLength) &&
            declaredLength > assetPolicy!.maxUploadBytes
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
            body = await readBodyUpTo(request, assetPolicy!.maxUploadBytes);
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
            await assetReader!.putCanvasAsset({
              bytes: Uint8Array.from(body),
              objectKey,
              workspaceId: ownedWorkspaceId,
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
          const asset = await assetReader!.read(objectKey);
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
      },
    ]);

    const retireDiagnostic = async () => {
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
    };
    routes.add('diagnostics-create-retired', [
      'POST',
      () => url.pathname === '/v1/diagnostics',
      'service-token',
      retireDiagnostic,
    ]);

    const stateWorkspaceId = workspaceRoute(url.pathname, 'state');
    routes.add('product-state', [
      'GET',
      () => Boolean(stateWorkspaceId && productService),
      'service-token',
      async () => {
        await handleErrors(
          async () => {
            const state = await productService!.bootstrap(
              productIdentity(request, stateWorkspaceId!, requestCorrelationId)
            );
            sendJson(response, 200, state, requestCorrelationId);
          },
          {
            code: 'INTERNAL_ERROR',
            message: 'Product state could not be loaded.',
            status: 500,
          },
          { includeDetails: true }
        );
        return;
      },
    ]);

    const commandWorkspaceId = workspaceRoute(url.pathname, 'commands');
    routes.add('product-commands', [
      'POST',
      () => Boolean(commandWorkspaceId && productService),
      'service-token',
      async () => {
        await handleErrors(
          async () => {
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
              commandWorkspaceId!,
              requestCorrelationId
            );
            authorizeProductCommand(context, command);
            const result = await productService!.execute(
              context,
              command,
              idempotencyKey
            );
            sendJson(response, 200, result, requestCorrelationId);
          },
          {
            code: 'INVALID_COMMAND',
            message: 'The product command could not be processed.',
            status: 400,
          },
          { includeDetails: true }
        );
        return;
      },
    ]);

    const p1CommandWorkspaceId = workspaceRoute(url.pathname, 'p1/commands');
    routes.add('p1-commands', [
      'POST',
      () => Boolean(p1CommandWorkspaceId && p1ApplicationService),
      'service-token',
      async () => {
        await handleErrors(
          async () => {
            const idempotencyKey = requiredIdempotencyKey(request);
            const parsed = p1ModuleRequestSchema.safeParse(
              await readJson(request)
            );
            if (!parsed.success) {
              throw new DomainError(
                'INVALID_COMMAND',
                'A valid P1 module command is required.'
              );
            }
            const context = p1Identity(
              request,
              p1CommandWorkspaceId!,
              requestCorrelationId
            );
            authorizeP1Request(
              context,
              'command',
              parsed.data.module,
              parsed.data.action
            );
            const result = await p1ApplicationService!.executeModule(
              context,
              parsed.data.module,
              { action: parsed.data.action, payload: parsed.data.payload },
              idempotencyKey
            );
            sendJson(response, 200, result, requestCorrelationId);
          },
          {
            code: 'INVALID_COMMAND',
            message: 'The P1 command could not be processed.',
            p1DefaultStatus: 409,
            p1Statuses: { FORBIDDEN: 403, NOT_FOUND: 404 },
            shapedMessage: 'fallback',
            status: 400,
          },
          { includeDetails: true }
        );
        return;
      },
    ]);

    const p1QueryWorkspaceId = workspaceRoute(url.pathname, 'p1/query');
    routes.add('p1-query', [
      'POST',
      () => Boolean(p1QueryWorkspaceId && p1ApplicationService),
      'service-token',
      async () => {
        await handleErrors(
          async () => {
            const parsed = p1ModuleRequestSchema.safeParse(
              await readJson(request)
            );
            if (!parsed.success) {
              throw new DomainError(
                'INVALID_QUERY',
                'A valid P1 module query is required.'
              );
            }
            const context = p1Identity(
              request,
              p1QueryWorkspaceId!,
              requestCorrelationId
            );
            authorizeP1Request(
              context,
              'query',
              parsed.data.module,
              parsed.data.action
            );
            const result = await p1ApplicationService!.queryModule(
              context,
              parsed.data.module,
              { action: parsed.data.action, payload: parsed.data.payload }
            );
            sendJson(response, 200, result, requestCorrelationId);
          },
          {
            code: 'INVALID_QUERY',
            message: 'The P1 query could not be processed.',
            p1DefaultStatus: 409,
            p1Statuses: { FORBIDDEN: 403, NOT_FOUND: 404 },
            shapedMessage: 'fallback',
            status: 400,
          }
        );
        return;
      },
    ]);

    routes.add('diagnostic-events', [
      'GET',
      () => diagnosticRoute(url.pathname, 'events'),
      'service-token',
      retireDiagnostic,
    ]);

    routes.add('diagnostic-resume-retired', [
      'POST',
      () => diagnosticRoute(url.pathname, 'resume'),
      'service-token',
      retireDiagnostic,
    ]);

    if (
      await routes.dispatch({
        authorized: matchesServiceToken(
          request.headers['x-service-token'],
          serviceToken
        ),
        method: request.method,
        onUnauthorized() {
          sendError(
            response,
            401,
            {
              code: 'UNAUTHORIZED_SERVICE',
              message: 'Invalid service identity.',
            },
            requestCorrelationId
          );
        },
      })
    ) {
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
