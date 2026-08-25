import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type Server,
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
  type CommercePlanCatalogSnapshot,
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
import { liveStatus } from './runtime-truth/readiness.js';

export type CoreHttpRequestContext = {
  handleErrors: (
    handler: () => Promise<void> | void,
    fallback: HttpErrorFallback,
    options?: {
      includeDetails?: boolean;
      onHeadersSent?: (error: unknown) => Promise<void> | void;
    }
  ) => ReturnType<typeof withErrorEnvelope>;
  request: IncomingMessage;
  requestCorrelationId: string;
  response: ServerResponse;
  url: URL;
};

const coreHttpRouteTables = new WeakMap<
  Server,
  RouteTable<CoreHttpRequestContext>
>();

export function coreRouteTableOf(server: Server) {
  const table = coreHttpRouteTables.get(server);
  if (!table) {
    throw new Error('Server was not created by createCoreServer.');
  }
  return table;
}

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
  /** E2E-only prepare-terminal rejection; absent from non-E2E assemblies. */
  e2ePrepareTerminalRejectionFixture?: {
    reject(input: {
      workspaceId: string;
      workId: string;
    }): Promise<{ rejected: true; alreadyTerminal?: true }>;
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
    coordinator: Pick<CreationSubmissionCoordinator, 'submit' | 'accept'> &
      Partial<
        Pick<
          CreationSubmissionCoordinator,
          | 'answerClarification'
          | 'startPrepared'
          | 'revisePrepared'
          | 'cancelRunning'
          | 'flushAcceptedTurns'
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
    commerceView?(): Promise<CommercePlanCatalogSnapshot>;
    publicView?(): Promise<PublicPlanCatalog>;
  };
  /**
   * Optional runtime-truth port for /health/ready and /capabilities.
   * Live endpoints never consult this port.
   */
  processRole?: 'api' | 'worker';
  runtimeTruth?: {
    evaluateReadiness(): Promise<{
      checks: Array<{ detail?: string; name: string; status: string }>;
      ready: boolean;
      release?: {
        artifactDigest?: string;
        commitSha: string;
        configRevision?: string;
      };
      role?: 'api' | 'worker';
      service: string;
      status: 'ready' | 'not_ready';
    }>;
    evaluateWorkerReadiness?(): Promise<{
      checks: Array<{ detail?: string; name: string; status: string }>;
      ready: boolean;
      release?: {
        artifactDigest?: string;
        commitSha: string;
        configRevision?: string;
      };
      role?: 'api' | 'worker';
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

function workspaceHarnessTaskSuffixRoute(
  pathname: string,
  suffix: string
): { taskId: string; workspaceId: string } | null {
  const match = pathname.match(
    new RegExp(`^/v1/workspaces/([^/]+)/p1/harness/tasks/([^/]+)/${suffix}$`)
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

function workspaceConfirmationActionRoute(pathname: string): {
  action: 'decide' | 'expire';
  requestId: string;
  workspaceId: string;
} | null {
  const match = pathname.match(
    /^\/v1\/workspaces\/([^/]+)\/p1\/confirmation-requests\/([^/]+)\/(decide|expire)$/
  );
  if (!match?.[1] || !match[2] || !match[3]) return null;
  try {
    return {
      action: match[3] as 'decide' | 'expire',
      requestId: decodeURIComponent(match[2]),
      workspaceId: decodeURIComponent(match[1]),
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

export function createCoreServer({
  aiStreamingRunner,
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
  e2ePrepareTerminalRejectionFixture,
  e2eUserSelectedSkillFixture,
  e2eUserSelectedSkillEvidence,
  e2eFixtureEnabled = false,
  harnessService,
  pendingActions,
  interruptProtocol,
  planCatalog,
  processRole = 'api',
  runtimeTruth,
  executionConfirmation,
  serviceToken,
  workflowEvents,
  workflowHeartbeatMs = 15_000,
  clock = () => new Date(),
}: CoreServerDependencies) {
  const assetPolicy = assetReader ? assetHttpPolicyFor(assetReader) : undefined;
  const routes = new RouteTable<CoreHttpRequestContext>();
  registerCoreRoutes();
  routes.seal();

  const server = createServer(async (request, response) => {
    const requestCorrelationId = correlationId(request);
    const url = new URL(request.url ?? '/', 'http://core.local');
    const ctx: CoreHttpRequestContext = {
      request,
      requestCorrelationId,
      response,
      url,
      handleErrors(handler, fallback, options = {}) {
        return withErrorEnvelope(handler, {
          ...options,
          fallback,
          requestCorrelationId,
          response,
        });
      },
    };

    if (
      await routes.dispatch({
        authorized: matchesServiceToken(
          request.headers['x-service-token'],
          serviceToken
        ),
        ctx,
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
        url,
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
  coreHttpRouteTables.set(server, routes);
  return server;

  function registerCoreRoutes() {
    // Process-only liveness. Never touches external dependencies or runtimeTruth.
    routes.add('health', [
      'GET',
      ({ url }) => url.pathname === '/health' || url.pathname === '/health/live',
      'public',
      async ({ request, response, url, requestCorrelationId, handleErrors }) => {
        sendJson(
          response,
          200,
          url.pathname === '/health/live'
            ? liveStatus(processRole)
            : { ...liveStatus(processRole), status: 'ok' },
          requestCorrelationId
        );
        return;
      },
    ]);

    routes.add('health-assembly', [
      'GET',
      ({ url }) => url.pathname === '/health/assembly',
      'public',
      async ({ request, response, url, requestCorrelationId, handleErrors }) => {
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

    routes.add('health-worker', [
      'GET',
      ({ url }) => url.pathname === '/health/worker',
      'public',
      async ({ response, requestCorrelationId }) => {
        if (!runtimeTruth?.evaluateWorkerReadiness) {
          sendJson(
            response,
            503,
            {
              service: 'meiye-core',
              status: 'not_ready',
              ready: false,
              role: 'worker',
              checks: [
                {
                  name: 'workerFreshness',
                  status: 'fail',
                  detail:
                    'Worker readiness projection is not wired on this process.',
                },
              ],
            },
            requestCorrelationId
          );
          return;
        }
        try {
          const readiness = await runtimeTruth.evaluateWorkerReadiness();
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
              role: 'worker',
              checks: [
                {
                  name: 'workerFreshness',
                  status: 'fail',
                  detail:
                    error instanceof Error
                      ? error.message
                      : 'Worker readiness projection threw.',
                },
              ],
            },
            requestCorrelationId
          );
        }
        return;
      },
    ]);

    routes.add('health-ready', [
      'GET',
      ({ url }) => url.pathname === '/health/ready',
      'public',
      async ({ request, response, url, requestCorrelationId, handleErrors }) => {
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
      ({ url }) => url.pathname === '/capabilities',
      'public',
      async ({ request, response, url, requestCorrelationId, handleErrors }) => {
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

    routes.add('workspace-bootstrap', [
      'POST',
      ({ url }) => Boolean(workspaceRoute(url.pathname, 'bootstrap')),
      'service-token',
      async ({ request, response, url, requestCorrelationId, handleErrors }) => {
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
            const bootstrapWorkspaceId = workspaceRoute(url.pathname, 'bootstrap')!;
            const context = p1Identity(
              request,
              bootstrapWorkspaceId,
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
      ({ url }) =>
        url.pathname === '/v1/e2e/credit-detail-fixture' &&
        e2eFixtureEnabled &&
        Boolean(e2eCreditDetailFixture),
      'service-token',
      async ({ request, response, url, requestCorrelationId, handleErrors }) => {
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
      ({ url }) =>
        url.pathname === '/v1/e2e/interrupt-expiry-fixture' &&
        e2eFixtureEnabled &&
        Boolean(e2eInterruptExpiryFixture),
      'service-token',
      async ({ request, response, url, requestCorrelationId, handleErrors }) => {
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
      ({ url }) =>
        url.pathname === '/v1/e2e/stalled-work-expiry-fixture' &&
        e2eFixtureEnabled &&
        Boolean(e2eStalledWorkExpiryFixture),
      'service-token',
      async ({ request, response, url, requestCorrelationId, handleErrors }) => {
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

    routes.add('e2e-prepare-terminal-rejection-fixture', [
      'POST',
      ({ url }) =>
        url.pathname === '/v1/e2e/prepare-terminal-rejection-fixture' &&
        e2eFixtureEnabled &&
        Boolean(e2ePrepareTerminalRejectionFixture),
      'service-token',
      async ({ request, response, url, requestCorrelationId, handleErrors }) => {
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
                'The prepare-terminal-rejection fixture is unavailable.',
                403,
              );
            }
            sendJson(
              response,
              200,
              await e2ePrepareTerminalRejectionFixture!.reject({
                workspaceId: context.workspaceId,
                workId: body.workId,
              }),
              requestCorrelationId,
            );
          },
          {
            code: 'INVALID_STATE',
            message: 'The E2E prepare-terminal-rejection fixture could not fail the work.',
            status: 400,
          },
        );
        return;
      },
    ]);

    routes.add('e2e-user-selected-skill-fixture', [
      'POST',
      ({ url }) =>
        url.pathname === '/v1/e2e/user-selected-skill-fixture' &&
        e2eFixtureEnabled &&
        Boolean(e2eUserSelectedSkillFixture),
      'service-token',
      async ({ request, response, url, requestCorrelationId, handleErrors }) => {
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
      ({ url }) =>
        url.pathname === '/v1/e2e/user-selected-skill-evidence' &&
        e2eFixtureEnabled &&
        Boolean(e2eUserSelectedSkillEvidence),
      'service-token',
      async ({ request, response, url, requestCorrelationId, handleErrors }) => {
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
      ({ url }) => url.pathname === '/public/plan-catalog' && Boolean(planCatalog),
      'service-token',
      async ({ request, response, url, requestCorrelationId, handleErrors }) => {
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

    routes.add('commerce-plan-catalog', [
      'GET',
      ({ url }) =>
        url.pathname === '/internal/commerce-plan-catalog' &&
        Boolean(planCatalog?.commerceView),
      'service-token',
      async ({ request, response, url, requestCorrelationId, handleErrors }) => {
        await handleErrors(
          async () => {
            sendJson(
              response,
              200,
              await planCatalog!.commerceView!(),
              requestCorrelationId
            );
          },
          {
            code: 'COMMERCE_PLAN_CATALOG_UNAVAILABLE',
            message: 'Commerce plan catalogue projection failed.',
            status: 500,
            unknownMessage: 'error',
          }
        );
        return;
      },
    ]);

    routes.add('pending-actions', [
      'GET',
      ({ url }) =>
        Boolean(pendingActions && workspaceRoute(url.pathname, 'p1/pending-actions')),
      'service-token',
      async ({ request, response, url, requestCorrelationId, handleErrors }) => {
        await handleErrors(
          async () => {
            const context = p1Identity(
              request,
              workspaceRoute(url.pathname, 'p1/pending-actions')!,
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
    routes.add('pending-interrupts-list', [
      'GET',
      ({ url }) =>
        Boolean(interruptProtocol && workspaceRoute(url.pathname, 'p1/pending-interrupts')),
      'service-token',
      async ({ request, response, url, requestCorrelationId, handleErrors }) => {
        await handleErrors(
          async () => {
            const context = p1Identity(
              request,
              workspaceRoute(url.pathname, 'p1/pending-interrupts')!,
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

    routes.add('pending-interrupts-resume', [
      'POST',
      ({ url }) =>
        Boolean(interruptProtocol && workspaceRoute(url.pathname, 'p1/interrupts/resume')),
      'service-token',
      async ({ request, response, url, requestCorrelationId, handleErrors }) => {
        await handleErrors(
          async () => {
            const context = p1Identity(
              request,
              workspaceRoute(url.pathname, 'p1/interrupts/resume')!,
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

    routes.add('composer-destination-map', [
      '*',
      ({ url }) =>
        Boolean(
          composerDestinationMapper &&
            workspaceRoute(url.pathname, 'p1/composer/destination-map')
        ),
      'service-token',
      async ({ request, response, url, requestCorrelationId, handleErrors }) => {
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
              workspaceRoute(url.pathname, 'p1/composer/destination-map')!,
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

    routes.add('composer-submissions', [
      '*',
      ({ url }) =>
        Boolean(composerSubmission && workspaceRoute(url.pathname, 'p1/composer/submissions')),
      'service-token',
      async ({ request, response, url, requestCorrelationId, handleErrors }) => {
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
              workspaceRoute(url.pathname, 'p1/composer/submissions')!,
              requestCorrelationId
            );
            authorizeContentCreation(context);
            const body = composerSubmissionBodySchema.parse(
              await readJson(request)
            );
            const result = await composerSubmission!.coordinator.accept({
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
      coordinator: composerSubmission?.coordinator,
      authorize(ctx, workspaceId) {
        const context = p1Identity(
          ctx.request,
          workspaceId,
          ctx.requestCorrelationId
        );
        authorizeContentCreation(context);
        return context;
      },
      readBody: (ctx) => readJson(ctx.request),
      respond: (ctx, status, payload) =>
        sendJson(ctx.response, status, payload, ctx.requestCorrelationId),
      handle: (ctx, command, fallback) => ctx.handleErrors(command, fallback),
    });
    routes.add('campaign-paid-work-start', [
      'POST',
      ({ url }) => {
        const campaignPaidWorkRoute = workspaceCampaignPaidWorkRoute(url.pathname);
        return Boolean(
          campaignPaidWorks &&
            campaignPaidWorkRoute &&
            !campaignPaidWorkRoute.campaignId
        );
      },
      'service-token',
      async ({ request, response, url, requestCorrelationId, handleErrors }) => {
        await handleErrors(
          async () => {
            const campaignPaidWorkRoute = workspaceCampaignPaidWorkRoute(url.pathname)!;
            const context = p1Identity(
              request,
              campaignPaidWorkRoute.workspaceId,
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
      ({ url }) =>
        Boolean(
          campaignPaidWorks &&
            workspaceCampaignPaidWorkRoute(url.pathname)?.campaignId
        ),
      'service-token',
      async ({ request, response, url, requestCorrelationId, handleErrors }) => {
        await handleErrors(
          async () => {
            const campaignPaidWorkRoute = workspaceCampaignPaidWorkRoute(url.pathname)!;
            const context = p1Identity(
              request,
              campaignPaidWorkRoute.workspaceId,
              requestCorrelationId
            );
            authorizeContentCreation(context);
            const result = await campaignPaidWorks!.advance(
              context.workspaceId,
              campaignPaidWorkRoute.campaignId!
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

    routes.add('composer-task-events', [
      '*',
      ({ url }) =>
        Boolean(composerSubmission && workspaceComposerTaskEventRoute(url.pathname)),
      'service-token',
      async ({ request, response, url, requestCorrelationId, handleErrors }) => {
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
            const composerTaskEventRoute = workspaceComposerTaskEventRoute(url.pathname)!;
            const context = p1Identity(
              request,
              composerTaskEventRoute.workspaceId,
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
              workflowId: composerTaskEventRoute.taskId,
              workspaceId: composerTaskEventRoute.workspaceId,
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

    routes.add('composer-content-package', [
      '*',
      ({ url }) =>
        Boolean(
          composerSubmission && workspaceComposerContentPackageRoute(url.pathname)
        ),
      'service-token',
      async ({ request, response, url, requestCorrelationId, handleErrors }) => {
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
            const composerContentPackageRoute =
              workspaceComposerContentPackageRoute(url.pathname)!;
            const context = p1Identity(
              request,
              composerContentPackageRoute.workspaceId,
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
              composerContentPackageRoute.packageId
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

    routes.add('agent-semantic-replay', [
      'GET',
      ({ url }) =>
        Boolean(
          agentSemanticEvents &&
            workspaceAgentSemanticRoute(url.pathname)?.kind === 'replay'
        ),
      'service-token',
      async ({ request, response, url, requestCorrelationId, handleErrors }) => {
        await handleErrors(
          async () => {
            const agentSemanticRoute = workspaceAgentSemanticRoute(url.pathname)!;
            const context = p1Identity(
              request,
              agentSemanticRoute.workspaceId,
              requestCorrelationId
            );
            authorizeP1Request(context, 'query', 'agent-session', 'get_thread');
            const session = await agentSemanticEvents!.resolveSession({
              workspaceId: context.workspaceId,
              threadId: agentSemanticRoute.threadId,
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
      ({ url }) =>
        Boolean(
          agentSemanticEvents &&
            workspaceAgentSemanticRoute(url.pathname)?.kind === 'events'
        ),
      'service-token',
      async ({ request, response, url, requestCorrelationId, handleErrors }) => {
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
            const agentSemanticRoute = workspaceAgentSemanticRoute(url.pathname)!;
            const context = p1Identity(
              request,
              agentSemanticRoute.workspaceId,
              requestCorrelationId
            );
            authorizeP1Request(context, 'query', 'agent-session', 'get_thread');
            const session = await agentSemanticEvents!.resolveSession({
              workspaceId: context.workspaceId,
              threadId: agentSemanticRoute.threadId,
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

    routes.add('harness-recommendation', [
      'GET',
      ({ url }) =>
        Boolean(harnessService && workspaceRoute(url.pathname, 'p1/harness/recommendation')),
      'service-token',
      async ({ request, response, url, requestCorrelationId, handleErrors }) => {
        await handleErrors(
          async () => {
            const harnessRecommendationWorkspaceId = workspaceRoute(
              url.pathname,
              'p1/harness/recommendation'
            )!;
            const context = p1Identity(
              request,
              harnessRecommendationWorkspaceId,
              requestCorrelationId
            );
            authorizeContentCreation(context);
            sendJson(
              response,
              200,
              await harnessService!.readTodayRecommendation(
                harnessRecommendationWorkspaceId
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

    routes.add('harness-product-metrics', [
      'POST',
      ({ url }) =>
        Boolean(
          harnessService &&
            workspaceHarnessTaskSuffixRoute(url.pathname, 'product-metrics')
        ),
      'service-token',
      async ({ request, response, url, requestCorrelationId, handleErrors }) => {
        await handleErrors(
          async () => {
            const harnessProductMetricMatch = workspaceHarnessTaskSuffixRoute(
              url.pathname,
              'product-metrics'
            )!;
            const workspaceId = harnessProductMetricMatch.workspaceId;
            const taskId = harnessProductMetricMatch.taskId;
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
      ({ url }) =>
        Boolean(harnessService && workspaceRoute(url.pathname, 'p1/harness/tasks')),
      'service-token',
      async ({ request, response, url, requestCorrelationId, handleErrors }) => {
        await handleErrors(
          async () => {
            const harnessTaskCollectionWorkspaceId = workspaceRoute(
              url.pathname,
              'p1/harness/tasks'
            )!;
            const context = p1Identity(
              request,
              harnessTaskCollectionWorkspaceId,
              requestCorrelationId
            );
            authorizeContentCreation(context);
            sendJson(
              response,
              200,
              await harnessService!.listActiveTasks(
                harnessTaskCollectionWorkspaceId
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
      ({ url }) => Boolean(workspaceRoute(url.pathname, 'p1/harness/tasks')),
      'service-token',
      async ({ request, response, url, requestCorrelationId, handleErrors }) => {
        await handleErrors(
          async () => {
            const context = p1Identity(
              request,
              workspaceRoute(url.pathname, 'p1/harness/tasks')!,
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
      ({ method, url }) =>
        Boolean(
          harnessService &&
            (method === 'GET' || method === 'POST') &&
            workspaceHarnessTaskSuffixRoute(url.pathname, 'interaction')
        ),
      'service-token',
      async ({ request, response, url, requestCorrelationId, handleErrors }) => {
        await handleErrors(
          async () => {
            const harnessInteractionMatch = workspaceHarnessTaskSuffixRoute(
              url.pathname,
              'interaction'
            )!;
            const workspaceId = harnessInteractionMatch.workspaceId;
            const taskId = harnessInteractionMatch.taskId;
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
      ({ method, url }) =>
        Boolean(
          harnessService &&
            (method === 'GET' || method === 'POST') &&
            workspaceHarnessTaskSuffixRoute(url.pathname, 'interaction/message')
        ),
      'service-token',
      async ({ request, response, url, requestCorrelationId, handleErrors }) => {
        await handleErrors(
          async () => {
            const harnessInteractionMessageMatch =
              workspaceHarnessTaskSuffixRoute(url.pathname, 'interaction/message')!;
            const workspaceId = harnessInteractionMessageMatch.workspaceId;
            const taskId = harnessInteractionMessageMatch.taskId;
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
      ({ url }) =>
        Boolean(
          harnessService &&
            workspaceHarnessTaskSuffixRoute(
              url.pathname,
              'interaction/(?:v2/)?renderer'
            )
        ),
      'service-token',
      async ({ request, response, url, requestCorrelationId, handleErrors }) => {
        await handleErrors(
          async () => {
            const harnessInteractionRendererMatch =
              workspaceHarnessTaskSuffixRoute(
                url.pathname,
                'interaction/(?:v2/)?renderer'
              )!;
            const workspaceId = harnessInteractionRendererMatch.workspaceId;
            const taskId = harnessInteractionRendererMatch.taskId;
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
      ({ url }) =>
        Boolean(
          harnessService &&
            workspaceHarnessTaskSuffixRoute(
              url.pathname,
              'interaction/(?:v2/)?editing'
            )
        ),
      'service-token',
      async ({ request, response, url, requestCorrelationId, handleErrors }) => {
        await handleErrors(
          async () => {
            const harnessInteractionEditingMatch =
              workspaceHarnessTaskSuffixRoute(
                url.pathname,
                'interaction/(?:v2/)?editing'
              )!;
            const workspaceId = harnessInteractionEditingMatch.workspaceId;
            const taskId = harnessInteractionEditingMatch.taskId;
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
      ({ method, url }) =>
        Boolean(
          harnessService &&
            (method === 'GET' || method === 'POST') &&
            workspaceHarnessTaskSuffixRoute(url.pathname, 'decision')
        ),
      'service-token',
      async ({ request, response, url, requestCorrelationId, handleErrors }) => {
        await handleErrors(
          async () => {
            const harnessDecisionMatch = workspaceHarnessTaskSuffixRoute(
              url.pathname,
              'decision'
            )!;
            const workspaceId = harnessDecisionMatch.workspaceId;
            const taskId = harnessDecisionMatch.taskId;
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
    routes.add('confirmation-create', [
      'POST',
      ({ url }) =>
        Boolean(
          executionConfirmation &&
            workspaceRoute(url.pathname, 'p1/confirmation-requests')
        ),
      'service-token',
      async ({ request, response, url, requestCorrelationId, handleErrors }) => {
        await handleErrors(
          async () => {
            const context = p1Identity(
              request,
              workspaceRoute(url.pathname, 'p1/confirmation-requests')!,
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
      ({ url }) =>
        Boolean(
          executionConfirmation &&
            workspaceRoute(url.pathname, 'p1/confirmation-requests')
        ),
      'service-token',
      async ({ request, response, url, requestCorrelationId, handleErrors }) => {
        await handleErrors(
          async () => {
            const context = p1Identity(
              request,
              workspaceRoute(url.pathname, 'p1/confirmation-requests')!,
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
      ({ url }) =>
        Boolean(
          executionConfirmation &&
            workspaceConfirmationActionRoute(url.pathname)?.action === 'decide'
        ),
      'service-token',
      async ({ request, response, url, requestCorrelationId, handleErrors }) => {
        await handleErrors(
          async () => {
            const confirmationActionMatch = workspaceConfirmationActionRoute(
              url.pathname
            )!;
            const workspaceId = confirmationActionMatch.workspaceId;
            const requestId = confirmationActionMatch.requestId;
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
      ({ url }) =>
        Boolean(
          executionConfirmation &&
            workspaceConfirmationActionRoute(url.pathname)?.action === 'expire'
        ),
      'service-token',
      async ({ request, response, url, requestCorrelationId, handleErrors }) => {
        await handleErrors(
          async () => {
            const confirmationActionMatch = workspaceConfirmationActionRoute(
              url.pathname
            )!;
            const workspaceId = confirmationActionMatch.workspaceId;
            const requestId = confirmationActionMatch.requestId;
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

    routes.add('workflow-events', [
      'GET',
      ({ url }) =>
        Boolean(workspaceWorkflowEventRoute(url.pathname) && workflowEvents),
      'service-token',
      async ({ request, response, url, requestCorrelationId, handleErrors }) => {
        await handleErrors(
          async () => {
            const workflowEventRoute = workspaceWorkflowEventRoute(url.pathname)!;
            const context = p1Identity(
              request,
              workflowEventRoute.workspaceId,
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
              workflowId: workflowEventRoute.workflowId,
              workspaceId: workflowEventRoute.workspaceId,
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

    routes.add('canvas-text-stream', [
      'POST',
      ({ url }) => Boolean(workspaceRoute(url.pathname, 'canvas/text/stream')),
      'service-token',
      async ({ response, requestCorrelationId }) => {
        sendError(
          response,
          410,
          {
            code: 'CANVAS_TEXT_STREAM_RETIRED',
            message:
              'Pro Studio canvas text streaming is retired; no live SSE, outbox, or provider effect remains.',
          },
          requestCorrelationId,
        );
      },
    ]);

    routes.add('assistant-stream', [
      'POST',
      ({ url }) => Boolean(workspaceRoute(url.pathname, 'p1/assistant/stream')),
      'service-token',
      async ({ request, response, url, requestCorrelationId, handleErrors }) => {
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
              workspaceRoute(url.pathname, 'p1/assistant/stream')!,
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
      ({ method, url }) =>
        (method === 'DELETE' || method === 'GET' || method === 'PUT') &&
        Boolean(assetReader && url.pathname.startsWith('/v1/assets/')),
      'service-token',
      async ({ request, response, url, requestCorrelationId, handleErrors }) => {
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

    const retireDiagnostic = async ({
      response,
      requestCorrelationId,
    }: CoreHttpRequestContext) => {
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
      ({ url }) => url.pathname === '/v1/diagnostics',
      'service-token',
      retireDiagnostic,
    ]);

    routes.add('product-state', [
      'GET',
      ({ url }) => Boolean(workspaceRoute(url.pathname, 'state') && productService),
      'service-token',
      async ({ request, response, url, requestCorrelationId, handleErrors }) => {
        await handleErrors(
          async () => {
            const state = await productService!.bootstrap(
              productIdentity(
                request,
                workspaceRoute(url.pathname, 'state')!,
                requestCorrelationId
              )
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

    routes.add('product-commands', [
      'POST',
      ({ url }) =>
        Boolean(workspaceRoute(url.pathname, 'commands') && productService),
      'service-token',
      async ({ request, response, url, requestCorrelationId, handleErrors }) => {
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
              workspaceRoute(url.pathname, 'commands')!,
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

    routes.add('p1-commands', [
      'POST',
      ({ url }) =>
        Boolean(workspaceRoute(url.pathname, 'p1/commands') && p1ApplicationService),
      'service-token',
      async ({ request, response, url, requestCorrelationId, handleErrors }) => {
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
              workspaceRoute(url.pathname, 'p1/commands')!,
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

    routes.add('p1-query', [
      'POST',
      ({ url }) =>
        Boolean(workspaceRoute(url.pathname, 'p1/query') && p1ApplicationService),
      'service-token',
      async ({ request, response, url, requestCorrelationId, handleErrors }) => {
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
              workspaceRoute(url.pathname, 'p1/query')!,
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
      ({ url }) => diagnosticRoute(url.pathname, 'events'),
      'service-token',
      retireDiagnostic,
    ]);

    routes.add('diagnostic-resume-retired', [
      'POST',
      ({ url }) => diagnosticRoute(url.pathname, 'resume'),
      'service-token',
      retireDiagnostic,
    ]);
  }
}
