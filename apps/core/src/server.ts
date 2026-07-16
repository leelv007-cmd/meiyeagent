import { randomUUID, timingSafeEqual } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import {
  p1ModuleRequestSchema,
  assistantStreamRequestSchema,
  copyStreamRequestSchema,
  hasProductCapability,
  productCommandSchema,
  requiredP1Capability,
  requiredProductCommandCapability,
  type ApiEnvelope,
  type ProductRole,
  type ProductCommand,
  type ProductContext,
} from '@meiye/contracts';
import type {
  DiagnosticIdentity,
  DiagnosticRepository,
} from './diagnostics/repository.js';
import {
  DomainError,
  type ProductApplicationService,
} from './product/product-service.js';
import {
  P1DomainError,
  type P1ApplicationService,
  type P1Context,
} from './p1/foundation/index.js';
import type { IntegrationApplicationService } from './p1/integrations/index.js';
import type { AiStreamingRunner } from './p1/model-supply/ai-sdk-runner.js';
import type { CustodyOwnedAssetContentType } from './p1/model-supply/index.js';
import {
  OperationsError,
  type OperationsApplicationService,
} from './p1/operations/application-service.js';

interface CoreServerDependencies {
  assetReader?: {
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
  executionModeGate?: { blocksNewSubmission(): Promise<boolean> };
  operationsService?: Pick<
    OperationsApplicationService,
    'getCreativeWorkbench' | 'startCreativeCopyStream'
  >;
  serviceToken: string;
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

interface ErrorPayload {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

function correlationId(request: IncomingMessage) {
  const value = request.headers['x-correlation-id'];
  return typeof value === 'string' && value.length > 0 ? value : randomUUID();
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

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function readJson(request: IncomingMessage) {
  const body = await readBody(request);
  if (body.byteLength === 0) return {};
  return JSON.parse(body.toString('utf8')) as Record<string, unknown>;
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
  const actorHeader = request.headers['x-core-actor'];
  const actor =
    actorHeader === 'payment' || actorHeader === 'worker'
      ? actorHeader
      : 'user';
  if (actor !== 'user') {
    return { actor, userId, workspaceId, correlationId: requestCorrelationId };
  }
  const roleHeader = request.headers['x-workspace-role'];
  const role: ProductRole | undefined =
    actorHeader === 'admin'
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
    actor,
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
    if (context.actor === 'payment' || context.actor === 'worker') return;
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
  const actorHeader = request.headers['x-core-actor'];
  const roleHeader = request.headers['x-workspace-role'];
  let actor: ProductRole | 'worker';
  if (actorHeader === 'admin' || actorHeader === 'worker') {
    actor = actorHeader;
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
  if (context.actor === 'worker') return;
  const required = requiredP1Capability(kind, module, action);
  if (!context.actor || !hasProductCapability(context.actor, required)) {
    throw new P1DomainError(
      'FORBIDDEN',
      'The current product role cannot perform this action.'
    );
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

export function createCoreServer({
  aiStreamingRunner,
  executionModeGate,
  assetReader,
  diagnosticRepository,
  douyinCallbackToken,
  productService,
  p1ApplicationService,
  integrationService,
  operationsService,
  serviceToken,
}: CoreServerDependencies) {
  return createServer(async (request, response) => {
    const requestCorrelationId = correlationId(request);
    const url = new URL(request.url ?? '/', 'http://core.local');

    if (request.method === 'GET' && url.pathname === '/health') {
      sendJson(
        response,
        200,
        { service: 'meiye-core', status: 'ok' },
        requestCorrelationId
      );
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

    if (request.headers['x-service-token'] !== serviceToken) {
      sendError(
        response,
        401,
        { code: 'UNAUTHORIZED_SERVICE', message: 'Invalid service identity.' },
        requestCorrelationId
      );
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
              ? new DomainError(error.code, error.message, 403)
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

    const copyStreamWorkspaceId = workspaceRoute(
      url.pathname,
      'p1/copy/stream'
    );
    if (request.method === 'POST' && copyStreamWorkspaceId) {
      try {
        if (!operationsService || !aiStreamingRunner) {
          throw new DomainError(
            'COPY_STREAM_UNAVAILABLE',
            'Streaming copy generation is unavailable in the current execution mode.',
            503
          );
        }
        const context = p1Identity(
          request,
          copyStreamWorkspaceId,
          requestCorrelationId
        );
        authorizeContentCreation(context);
        const parsed = copyStreamRequestSchema.safeParse(await readJson(request));
        if (
          !parsed.success ||
          parsed.data.catalogModelId !== parsed.data.contract.catalogModelId ||
          parsed.data.contract.operation !== 'copy.generate'
        ) {
          throw new DomainError(
            'INVALID_COPY_STREAM_REQUEST',
            'A fixed-model copy stream request is required.'
          );
        }
        const abortController = new AbortController();
        response.once('close', () => {
          if (!response.writableEnded) {
            abortController.abort(new Error('Client disconnected.'));
          }
        });
        const started = await operationsService.startCreativeCopyStream(
          context,
          parsed.data.workId,
          parsed.data.contract,
          parsed.data.submissionKey,
          abortController.signal
        );
        const settlement = started.completion.catch((error) => {
          console.error('[copy-stream] terminal settlement failed', {
            correlationId: requestCorrelationId,
            error: error instanceof Error ? error.name : 'unknown',
            workspaceId: context.workspaceId,
          });
          throw error;
        });
        await pipeWebResponse(
          started.response,
          response,
          requestCorrelationId,
          () => settlement.then(() => undefined)
        );
      } catch (error) {
        if (response.headersSent) return;
        const domainError =
          error instanceof DomainError
            ? error
            : error instanceof P1DomainError
              ? new DomainError(error.code, error.message, 403)
              : error instanceof OperationsError
                ? new DomainError(error.code, error.message, error.status)
              : new DomainError(
                  'COPY_STREAM_FAILED',
                  'The copy stream could not be started.',
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
      request.method === 'GET' &&
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
        const idempotencyKey = request.headers['idempotency-key'];
        if (typeof idempotencyKey !== 'string' || idempotencyKey.length === 0) {
          throw new DomainError(
            'IDEMPOTENCY_KEY_REQUIRED',
            'Idempotency key is required.'
          );
        }
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
        const idempotencyKey = request.headers['idempotency-key'];
        if (typeof idempotencyKey !== 'string' || idempotencyKey.length === 0) {
          throw new DomainError(
            'IDEMPOTENCY_KEY_REQUIRED',
            'Idempotency key is required.'
          );
        }
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
              : typeof error === 'object' &&
                  error &&
                  'code' in error &&
                  typeof error.code === 'string' &&
                  'status' in error &&
                  typeof error.status === 'number'
                ? new DomainError(
                    error.code,
                    'The P1 command could not be processed.',
                    error.status
                  )
                : new DomainError(
                    'INVALID_COMMAND',
                    'The P1 command could not be processed.'
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
