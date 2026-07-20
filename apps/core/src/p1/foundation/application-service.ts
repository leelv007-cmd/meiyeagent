import { createHash } from 'node:crypto';
import type { P1Module } from '@meiye/contracts';
import type {
  P1Context,
  AppendUsageEventInput,
  GenerationJob,
  OwnedAsset,
  ProviderAttempt,
  ProviderCostEvent,
  RecordRelationFactInput,
  RelationFact,
  UsageEvent,
  UsageProjection,
  UsageResource,
  RouteSnapshot,
} from './domain.js';
import { P1DomainError } from './domain.js';
import type {
  FoundationRepository,
  FoundationStore,
  P1OperationModule,
} from './ports.js';
import {
  PermissionDeniedError,
  type PermissionAuthorizerPort,
} from '../capability-permission/port.js';

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stable(item)])
    );
  }
  return value;
}

function payloadHash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

type WriteOwner = 'legacy' | 'frozen' | 'p1';

const NEW_P1_SIDE_EFFECTS = new Set([
  'advanced-canvas:adopt_advanced_canvas_output',
  'asset-memory:confirm_asset_intake_fact',
  'asset-memory:confirm_preference',
  'asset-memory:confirm_reusable_asset',
  'asset-memory:correct_asset_intake_fact',
  'asset-memory:create_reuse_task',
  'asset-memory:deactivate_series',
  'asset-memory:propose_preference',
  'asset-memory:propose_reusable_asset',
  'asset-memory:prepare_assisted_price_intake',
  'asset-memory:record_asset_intake_batch',
  'asset-memory:record_preference_signal',
  'asset-memory:reject_asset_intake_candidate',
  'asset-memory:revoke_preference',
  'entitlements:auto_top_up',
  'entitlements:checkout_add_on',
  'entitlements:checkout_plan',
  'integrations:activate_douyin_capability',
  'integrations:confirm_feishu_intent',
  'integrations:create_connection',
  'integrations:execute_feishu_intent',
  'integrations:publish_feishu_tool',
  'integrations:refresh_douyin_oauth',
  'integrations:rotate_credential',
  'integrations:submit_douyin_publish',
  'integrations:submit_strict_byok',
  'integrations:sync_feishu_tools',
  'integrations:sync_publish_feishu_tools',
  'integrations:verify_feishu_connection',
  'job-runtime:schedule_recurring',
  'job-runtime:submit',
  'marketing-identity:register_marketing_identity',
  'marketing-identity:transition_marketing_identity',
  'model-supply:catalog_enable',
  'model-supply:catalog_publish',
  'model-supply:catalog_retire',
  'model-supply:catalog_rollback',
  'model-supply:prompt_revision_rollback',
  'model-supply:quality_evaluation_run',
  'model-supply:submit_generation',
  'model-supply:video_workflow_confirm',
  'operations:admin_enable_template_version',
  'operations:admin_publish_template_version',
  'operations:admin_retire_template',
  'operations:run_trigger',
  'operations:start_canvas_image',
  'operations:submit_creative_work',
  'operations:retry_creative_job',
  'operations:reroll_creative_job',
  'operations:quality_retry_creative_job',
]);

export interface GenerationOpeningEntitlement {
  id: string;
  amount: number;
  reason: string;
}

export interface ProviderOutcomeSettlement {
  attemptId: string;
  acceptance: Exclude<ProviderAttempt['acceptance'], 'pending'>;
  providerTaskRef?: string;
  providerCost: Omit<
    ProviderCostEvent,
    'workspaceId' | 'actorId' | 'correlationId' | 'createdAt'
  >;
  result: Record<string, unknown>;
  outcome:
    | {
        status: 'completed';
        asset?: Omit<OwnedAsset, 'workspaceId' | 'createdAt'>;
      }
    | { status: 'retryable_rejection'; reason: string }
    | { status: 'failed'; reason: string }
    | { status: 'unknown'; reason: string };
}

export class P1ApplicationService {
  private readonly operations: Map<string, P1OperationModule>;
  private readonly moduleCommandHeartbeatMs: number;
  private readonly authorizer?: PermissionAuthorizerPort;

  constructor(
    private readonly repository: FoundationRepository,
    options: {
      operations?: P1OperationModule[];
      moduleCommandHeartbeatMs?: number;
      /**
       * K1 PermissionAuthorizerPort (Z2-WIRING). When present, executeModule /
       * queryModule enforce the same default-deny registry as HTTP authorize.
       */
      authorizer?: PermissionAuthorizerPort;
      writeOwnershipReader?: (
        workspaceId: string
      ) => Promise<WriteOwner | null>;
    } = {}
  ) {
    this.operations = new Map();
    this.moduleCommandHeartbeatMs = options.moduleCommandHeartbeatMs ?? 60_000;
    this.authorizer = options.authorizer;
    this.writeOwnershipReader = options.writeOwnershipReader;
    for (const operation of options.operations ?? []) {
      if (this.operations.has(operation.name)) {
        throw new P1DomainError('INVALID_STATE', `Operation ${operation.name} is already registered.`);
      }
      this.operations.set(operation.name, operation);
    }
  }

  private readonly writeOwnershipReader?: (
    workspaceId: string
  ) => Promise<WriteOwner | null>;

  private authorizeModuleAction(
    context: P1Context,
    kind: 'command' | 'query',
    name: string,
    input: Record<string, unknown>
  ) {
    if (!this.authorizer) return;
    const action = typeof input.action === 'string' ? input.action : '';
    try {
      this.authorizer.authorize({
        actor: context.actor,
        kind,
        module: name as P1Module,
        action,
      });
    } catch (error) {
      if (error instanceof PermissionDeniedError) {
        throw new P1DomainError('FORBIDDEN', error.message);
      }
      throw error;
    }
  }

  private async assertNewSideEffectAllowed(
    context: P1Context,
    name: string,
    input: Record<string, unknown>
  ) {
    const action = typeof input.action === 'string' ? input.action : undefined;
    if (!action || !NEW_P1_SIDE_EFFECTS.has(`${name}:${action}`)) return;
    const owner = await this.writeOwnershipReader?.(context.workspaceId);
    if (!owner || owner === 'p1') return;
    if (owner === 'frozen') {
      throw new P1DomainError(
        'COMMANDS_FROZEN',
        'New generation, publication, and external commands are frozen for the cutover window.'
      );
    }
    throw new P1DomainError(
      'P1_WRITE_DISABLED',
      'New commands are owned by the legacy product application service.'
    );
  }

  private async authorizeOwner(store: FoundationStore, context: P1Context) {
    if ((await store.getOwnerRole(context)) !== 'owner') {
      throw new P1DomainError('NOT_FOUND', 'Workspace resource was not found.');
    }
  }

  private async authorizeWorkspaceMember(
    store: FoundationStore,
    context: P1Context
  ) {
    // Trusted service actors skip role matching (payment = webhook plan grants).
    if (
      context.actor === 'admin' ||
      context.actor === 'worker' ||
      context.actor === 'payment'
    ) {
      return;
    }
    const role = await store.getWorkspaceRole(context);
    if (!role) {
      throw new P1DomainError('NOT_FOUND', 'Workspace resource was not found.');
    }
    if (context.actor && context.actor !== role) {
      throw new P1DomainError(
        'FORBIDDEN',
        'The supplied workspace role does not match the membership.'
      );
    }
  }

  async recordRelationFact(
    context: P1Context,
    input: RecordRelationFactInput,
    idempotencyKey: string
  ) {
    const result = await this.repository.executeIdempotent(
      context,
      idempotencyKey,
      payloadHash(input),
      async (store) => {
        await this.authorizeOwner(store, context);
        const fact: RelationFact = {
          ...input,
          workspaceId: context.workspaceId,
          actorId: context.userId,
          correlationId: context.correlationId,
          createdAt: new Date().toISOString(),
        };
        await store.insertRelationFact(fact);
        return fact;
      }
    );
    return result.value;
  }

  async getRelationFact(context: P1Context, factId: string) {
    await this.authorizeWorkspaceMember(this.repository, context);
    const fact = await this.repository.getRelationFact(context.workspaceId, factId);
    if (!fact) throw new P1DomainError('NOT_FOUND', 'Relation fact was not found.');
    return fact;
  }

  async appendUsageEvent(
    context: P1Context,
    input: AppendUsageEventInput,
    idempotencyKey: string
  ) {
    const result = await this.repository.executeIdempotent(
      context,
      idempotencyKey,
      payloadHash(input),
      async (store) => {
        await this.authorizeOwner(store, context);
        if (!Number.isFinite(input.amount) || input.amount === 0) {
          throw new P1DomainError('INVALID_STATE', 'Usage amount must be a finite non-zero number.');
        }
        if (input.action !== 'adjust' && input.amount < 0) {
          throw new P1DomainError('INVALID_STATE', 'Usage amount must be positive.');
        }

        const events = await store.listUsageEvents(context.workspaceId, input.resource);
        if (input.action === 'reserve') {
          if (!input.reservationId) {
            throw new P1DomainError('INVALID_STATE', 'A reservation id is required.');
          }
          if (events.some((event) => event.reservationId === input.reservationId)) {
            throw new P1DomainError('INVALID_STATE', 'Reservation already exists.');
          }
          const projection = projectUsage(events);
          if (projection.available < input.amount) {
            throw new P1DomainError(
              'INSUFFICIENT_ENTITLEMENT',
              'Insufficient product usage allowance.',
            );
          }
        }

        if (input.action === 'commit' || input.action === 'refund' || input.action === 'expire') {
          if (!input.reservationId) {
            throw new P1DomainError('INVALID_STATE', 'A reservation id is required.');
          }
          const reservation = events.find(
            (event) => event.action === 'reserve' && event.reservationId === input.reservationId
          );
          const amountMatches =
            input.action === 'commit'
              ? input.amount >= 0 && input.amount <= (reservation?.amount ?? -1)
              : reservation?.amount === input.amount;
          if (!reservation || !amountMatches) {
            throw new P1DomainError('INVALID_STATE', 'Reservation does not match the terminal event.');
          }
          const existingTerminal = events.find(
            (event) =>
              event.reservationId === input.reservationId &&
              (event.action === 'commit' || event.action === 'refund' || event.action === 'expire')
          );
          if (existingTerminal) {
            if (existingTerminal.action !== input.action) {
              throw new P1DomainError('INVALID_STATE', 'Reservation already has another terminal result.');
            }
            return existingTerminal;
          }
        }

        const event: UsageEvent = {
          ...input,
          workspaceId: context.workspaceId,
          actorId: context.userId,
          correlationId: context.correlationId,
          createdAt: new Date().toISOString(),
        };
        await store.appendUsageEvent(event);
        return event;
      }
    );
    return result.value;
  }

  async getUsageProjection(context: P1Context, resource: UsageResource): Promise<UsageProjection> {
    await this.authorizeWorkspaceMember(this.repository, context);
    return projectUsage(await this.repository.listUsageEvents(context.workspaceId, resource));
  }

  async executeModule<TInput extends Record<string, unknown>, TOutput>(
    context: P1Context,
    name: string,
    input: TInput,
    idempotencyKey: string
  ): Promise<TOutput> {
    const operation = this.operations.get(name);
    if (!operation) throw new P1DomainError('INVALID_STATE', `Operation ${name} is not registered.`);
    await this.authorizeWorkspaceMember(this.repository, context);
    this.authorizeModuleAction(context, 'command', name, input);
    const commandHash = payloadHash({ name, input });
    const claim = await this.repository.claimModuleCommand<TOutput>(
      context,
      idempotencyKey,
      commandHash
    );
    if (claim.decision === 'replay') return claim.value;
    if (claim.decision === 'in_progress') {
      throw new P1DomainError(
        'INVALID_STATE',
        'The same module command is still in progress.'
      );
    }

    try {
      await this.assertNewSideEffectAllowed(context, name, input);
    } catch (error) {
      await this.repository
        .abandonModuleCommand(
          context,
          idempotencyKey,
          commandHash,
          claim.claimToken
        )
        .catch(() => undefined);
      throw error;
    }

    let heartbeatTail = Promise.resolve();
    const heartbeatTimer = setInterval(() => {
      heartbeatTail = heartbeatTail
        .then(() =>
          this.repository.renewModuleCommand(
            context,
            idempotencyKey,
            commandHash,
            claim.claimToken
          )
        )
        .catch(() => undefined);
    }, this.moduleCommandHeartbeatMs);
    heartbeatTimer.unref();
    const stopHeartbeat = async () => {
      clearInterval(heartbeatTimer);
      await heartbeatTail;
    };

    let value: TOutput;
    try {
      value = (await operation.execute({
        context,
        idempotencyKey,
        input,
        store: this.repository,
      })) as TOutput;
    } catch (error) {
      await stopHeartbeat();
      const status =
        error && typeof error === 'object' && 'status' in error
          ? Number(error.status)
          : undefined;
      const code =
        error && typeof error === 'object' && 'code' in error
          ? String(error.code)
          : undefined;
      const safeToRelease =
        (status !== undefined && status >= 400 && status < 500) ||
        code === 'NOT_FOUND' ||
        code === 'FORBIDDEN' ||
        code === 'INSUFFICIENT_ENTITLEMENT' ||
        code === 'IDEMPOTENCY_CONFLICT';
      if (safeToRelease) {
        await this.repository
          .abandonModuleCommand(
            context,
            idempotencyKey,
            commandHash,
            claim.claimToken
          )
          .catch(() => undefined);
      }
      throw error;
    }
    await stopHeartbeat();
    await this.repository.completeModuleCommand(
      context,
      idempotencyKey,
      commandHash,
      claim.claimToken,
      value
    );
    return value;
  }

  async queryModule<TInput extends Record<string, unknown>, TOutput>(
    context: P1Context,
    name: string,
    input: TInput
  ): Promise<TOutput> {
    const operation = this.operations.get(name);
    if (!operation?.query) {
      throw new P1DomainError(
        'INVALID_STATE',
        `Query module ${name} is not registered.`
      );
    }
    await this.authorizeWorkspaceMember(this.repository, context);
    this.authorizeModuleAction(context, 'query', name, input);
    return operation.query({
      context,
      input,
      store: this.repository,
    }) as Promise<TOutput>;
  }

  async startGeneration(
    context: P1Context,
    input: {
      jobId: string;
      operation: UsageResource;
      usageReservationId: string;
      routeSnapshot: Omit<RouteSnapshot, 'workspaceId' | 'createdAt'>;
    },
    idempotencyKey: string
  ) {
    const result = await this.repository.executeIdempotent(
      context,
      idempotencyKey,
      payloadHash(input),
      async (store) => {
        await this.authorizeOwner(store, context);
        validateRouteSnapshot(input.routeSnapshot);
        const usage = await store.listUsageEvents(context.workspaceId, input.operation);
        const reservation = usage.find(
          (event) => event.action === 'reserve' && event.reservationId === input.usageReservationId
        );
        const terminal = usage.find(
          (event) =>
            event.reservationId === input.usageReservationId &&
            (event.action === 'commit' || event.action === 'refund' || event.action === 'expire')
        );
        if (!reservation || terminal) {
          throw new P1DomainError('INVALID_STATE', 'An active usage reservation is required.');
        }
        const now = new Date().toISOString();
        const snapshot: RouteSnapshot = {
          ...input.routeSnapshot,
          workspaceId: context.workspaceId,
          createdAt: now,
        };
        const job: GenerationJob = {
          id: input.jobId,
          workspaceId: context.workspaceId,
          operation: input.operation,
          routeSnapshotId: snapshot.id,
          usageReservationId: input.usageReservationId,
          status: 'queued',
          createdBy: context.userId,
          correlationId: context.correlationId,
          createdAt: now,
          updatedAt: now,
        };
        await store.insertRouteSnapshot(snapshot);
        await store.insertGenerationJob(job);
        return job;
      }
    );
    return result.value;
  }

  /**
   * Persists every fact required to prove dispatch ownership in one transaction.
   * A replayed checkpoint is deliberately distinguishable so callers never
   * repeat an external side effect whose acceptance evidence may have been lost.
   */
  async preflightGenerationCheckpoint(
    context: P1Context,
    input: {
      routeSnapshot: Omit<RouteSnapshot, 'workspaceId' | 'createdAt'>;
      deploymentId: string;
    }
  ) {
    await this.authorizeOwner(this.repository, context);
    validateRouteSnapshot(input.routeSnapshot);
    if (
      !input.routeSnapshot.allowedCandidates.some(
        (candidate) => candidate.deploymentId === input.deploymentId
      )
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Deployment is outside the frozen route.'
      );
    }
  }

  async checkpointGenerationAttempt(
    context: P1Context,
    input: {
      jobId: string;
      operation: UsageResource;
      usageReservationId: string;
      usageAmount: number;
      openingEntitlement?: GenerationOpeningEntitlement;
      routeSnapshot: Omit<RouteSnapshot, 'workspaceId' | 'createdAt'>;
      attempt: { id: string; deploymentId: string };
    },
    idempotencyKey: string,
  ) {
    const {
      openingEntitlement: _currentOpeningEntitlement,
      ...checkpointIdentity
    } = input;
    const result = await this.repository.executeIdempotent(
      context,
      idempotencyKey,
      payloadHash(checkpointIdentity),
      async (store) => {
        await this.authorizeOwner(store, context);
        validateRouteSnapshot(input.routeSnapshot);
        if (!Number.isInteger(input.usageAmount) || input.usageAmount < 0) {
          throw new P1DomainError(
            'INVALID_STATE',
            'Generation usage amount must be a non-negative integer.',
          );
        }

        const usage = await store.listUsageEvents(
          context.workspaceId,
          input.operation,
        );
        if (
          usage.length === 0 &&
          input.openingEntitlement &&
          input.openingEntitlement.amount > 0
        ) {
          if (!Number.isInteger(input.openingEntitlement.amount)) {
            throw new P1DomainError(
              'INVALID_STATE',
              'Opening entitlement must be an integer.',
            );
          }
          await store.appendUsageEvent({
            id: input.openingEntitlement.id,
            workspaceId: context.workspaceId,
            resource: input.operation,
            action: 'adjust',
            amount: input.openingEntitlement.amount,
            reason: input.openingEntitlement.reason,
            actorId: context.userId,
            correlationId: context.correlationId,
            createdAt: new Date().toISOString(),
          });
          usage.push(
            ...(await store.listUsageEvents(context.workspaceId, input.operation)),
          );
        }
        const reservation = usage.find(
          (event) =>
            event.action === 'reserve' &&
            event.reservationId === input.usageReservationId,
        );
        const terminal = usage.find(
          (event) =>
            event.reservationId === input.usageReservationId &&
            (event.action === 'commit' ||
              event.action === 'refund' ||
              event.action === 'expire'),
        );
        if (terminal) {
          throw new P1DomainError(
            'INVALID_STATE',
            'Generation reservation is already terminal.',
          );
        }
        if (reservation && reservation.amount !== input.usageAmount) {
          throw new P1DomainError(
            'INVALID_STATE',
            'Generation reservation amount does not match.',
          );
        }
        if (!reservation) {
          const projection = projectUsage(usage);
          if (projection.available < input.usageAmount) {
            throw new P1DomainError(
              'INSUFFICIENT_ENTITLEMENT',
              'Insufficient product usage allowance.',
            );
          }
          await store.appendUsageEvent({
            id: `job:${input.jobId}:reserve`,
            workspaceId: context.workspaceId,
            resource: input.operation,
            action: 'reserve',
            amount: input.usageAmount,
            reservationId: input.usageReservationId,
            reason: 'generation_dispatch_checkpoint',
            actorId: context.userId,
            correlationId: context.correlationId,
            createdAt: new Date().toISOString(),
          });
        }

        const candidate = input.routeSnapshot.allowedCandidates.find(
          (item) => item.deploymentId === input.attempt.deploymentId,
        );
        if (!candidate) {
          throw new P1DomainError(
            'INVALID_STATE',
            'Deployment is outside the frozen route.',
          );
        }
        const timestamp = new Date().toISOString();
        const proposedSnapshot: RouteSnapshot = {
          ...input.routeSnapshot,
          workspaceId: context.workspaceId,
          createdAt: timestamp,
        };
        const existingSnapshot = await store.getRouteSnapshot(
          context.workspaceId,
          proposedSnapshot.id,
        );
        if (
          existingSnapshot &&
          !sameFrozenRoute(existingSnapshot, proposedSnapshot)
        ) {
          throw new P1DomainError(
            'INVALID_STATE',
            'RouteSnapshot id conflicts with different frozen routing facts.',
          );
        }
        const snapshot = existingSnapshot ?? proposedSnapshot;
        const job: GenerationJob = {
          id: input.jobId,
          workspaceId: context.workspaceId,
          operation: input.operation,
          routeSnapshotId: snapshot.id,
          usageReservationId: input.usageReservationId,
          status: 'running',
          createdBy: context.userId,
          correlationId: context.correlationId,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        const attempt: ProviderAttempt = {
          id: input.attempt.id,
          workspaceId: context.workspaceId,
          jobId: job.id,
          ordinal: 1,
          deploymentId: input.attempt.deploymentId,
          acceptance: 'pending',
          status: 'pending',
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        if (!existingSnapshot) await store.insertRouteSnapshot(snapshot);
        await store.insertGenerationJob(job);
        await store.insertProviderAttempt(attempt);
        return { job, attempt };
      },
    );
    return { ...result.value, replayed: result.replayed };
  }

  async startProviderAttempt(
    context: P1Context,
    input: { id: string; jobId: string; deploymentId: string },
    idempotencyKey: string
  ) {
    return (
      await this.checkpointProviderAttempt(context, input, idempotencyKey)
    ).attempt;
  }

  async checkpointProviderAttempt(
    context: P1Context,
    input: { id: string; jobId: string; deploymentId: string },
    idempotencyKey: string,
  ) {
    const result = await this.repository.executeIdempotent(
      context,
      idempotencyKey,
      payloadHash(input),
      async (store) => {
        await this.authorizeOwner(store, context);
        const job = await requireJob(store, context.workspaceId, input.jobId);
        if (job.status === 'completed' || job.status === 'cancelled' || job.status === 'failed') {
          throw new P1DomainError('INVALID_STATE', 'Generation job is terminal.');
        }
        const snapshot = await requireSnapshot(store, context.workspaceId, job.routeSnapshotId);
        const candidate = snapshot.allowedCandidates.find((item) => item.deploymentId === input.deploymentId);
        if (!candidate) throw new P1DomainError('INVALID_STATE', 'Deployment is outside the frozen route.');
        if (snapshot.selectionMode === 'fixed' && candidate.catalogModelId !== snapshot.requestedCatalogModelId) {
          throw new P1DomainError('INVALID_STATE', 'A fixed model cannot cross CatalogModel.');
        }
        const attempts = await store.listProviderAttempts(context.workspaceId, job.id);
        if (attempts.length >= 2) throw new P1DomainError('INVALID_STATE', 'Automatic attempt limit reached.');
        const previous = attempts.at(-1);
        if (previous && previous.acceptance !== 'rejected_before_accept') {
          throw new P1DomainError('INVALID_STATE', 'Accepted or unknown work must be recovered, not replayed.');
        }
        if (previous && !snapshot.fallbackConsent) {
          throw new P1DomainError('INVALID_STATE', 'The frozen route does not authorize fallback.');
        }
        const now = new Date().toISOString();
        const attempt: ProviderAttempt = {
          id: input.id,
          workspaceId: context.workspaceId,
          jobId: job.id,
          ordinal: attempts.length + 1,
          deploymentId: input.deploymentId,
          acceptance: 'pending',
          status: 'pending',
          createdAt: now,
          updatedAt: now,
        };
        await store.insertProviderAttempt(attempt);
        await store.updateGenerationJob({ ...job, status: 'running', updatedAt: now });
        return attempt;
      }
    );
    return { attempt: result.value, replayed: result.replayed };
  }

  async recordAttemptAcceptance(
    context: P1Context,
    input: {
      attemptId: string;
      acceptance: Exclude<ProviderAttempt['acceptance'], 'pending'>;
      providerTaskRef?: string;
    },
    idempotencyKey: string
  ) {
    const result = await this.repository.executeIdempotent(
      context,
      idempotencyKey,
      payloadHash(input),
      async (store) => {
        await this.authorizeOwner(store, context);
        const attempt = await store.getProviderAttempt(context.workspaceId, input.attemptId);
        if (!attempt) throw new P1DomainError('NOT_FOUND', 'Provider attempt was not found.');
        if (attempt.acceptance !== 'pending') {
          if (attempt.acceptance === input.acceptance && attempt.providerTaskRef === input.providerTaskRef) return attempt;
          throw new P1DomainError('INVALID_STATE', 'Provider acceptance evidence is immutable.');
        }
        const updated: ProviderAttempt = {
          ...attempt,
          acceptance: input.acceptance,
          providerTaskRef: input.providerTaskRef,
          status: input.acceptance === 'rejected_before_accept' ? 'failed' : 'submitted',
          updatedAt: new Date().toISOString(),
        };
        await store.updateProviderAttempt(updated);
        return updated;
      }
    );
    return result.value;
  }

  async appendProviderCost(
    context: P1Context,
    input: Omit<ProviderCostEvent, 'workspaceId' | 'actorId' | 'correlationId' | 'createdAt'>,
    idempotencyKey: string
  ) {
    const result = await this.repository.executeIdempotent(
      context,
      idempotencyKey,
      payloadHash(input),
      async (store) => {
        await this.authorizeOwner(store, context);
        if (!(await store.getProviderAttempt(context.workspaceId, input.attemptId))) {
          throw new P1DomainError('NOT_FOUND', 'Provider attempt was not found.');
        }
        validateProviderCostAmount(input);
        const event: ProviderCostEvent = {
          ...input,
          workspaceId: context.workspaceId,
          actorId: context.userId,
          correlationId: context.correlationId,
          createdAt: new Date().toISOString(),
        };
        await store.appendProviderCost(event);
        return event;
      }
    );
    return result.value;
  }

  /**
   * Records provider acceptance, cost, delivery evidence and Product Usage in
   * one commit. Provider Cost remains append-only even when Product Usage is
   * refunded after an accepted failure.
   */
  async settleProviderOutcome(
    context: P1Context,
    input: ProviderOutcomeSettlement,
    idempotencyKey: string,
  ) {
    const result = await this.repository.executeIdempotent(
      context,
      idempotencyKey,
      payloadHash(input),
      async (store) => {
        await this.authorizeOwner(store, context);
        const attempt = await store.getProviderAttempt(
          context.workspaceId,
          input.attemptId,
        );
        if (!attempt) {
          throw new P1DomainError('NOT_FOUND', 'Provider attempt was not found.');
        }
        const job = await requireJob(store, context.workspaceId, attempt.jobId);
        if (input.result.jobId !== job.id) {
          throw new P1DomainError(
            'INVALID_STATE',
            'Generation result does not belong to the checkpointed job.',
          );
        }
        assertMonotonicProviderOutcome(job, input.outcome.status);
        const taskReferenceConflicts =
          Boolean(attempt.providerTaskRef) &&
          Boolean(input.providerTaskRef) &&
          attempt.providerTaskRef !== input.providerTaskRef;
        const resolvesUnknownAcceptance =
          attempt.acceptance === 'acceptance_unknown' &&
          input.acceptance !== 'acceptance_unknown' &&
          !taskReferenceConflicts;
        const repeatsAcceptanceEvidence =
          attempt.acceptance === input.acceptance &&
          !taskReferenceConflicts;
        if (
          attempt.acceptance !== 'pending' &&
          !resolvesUnknownAcceptance &&
          !repeatsAcceptanceEvidence
        ) {
          throw new P1DomainError(
            'INVALID_STATE',
            'Provider acceptance evidence is immutable.',
          );
        }
        validateProviderCostAmount(input.providerCost);
        if (
          input.outcome.status === 'completed' &&
          input.acceptance !== 'accepted'
        ) {
          throw new P1DomainError(
            'INVALID_STATE',
            'Completed delivery requires accepted provider evidence.',
          );
        }
        if (
          input.outcome.status === 'unknown' &&
          input.acceptance === 'rejected_before_accept'
        ) {
          throw new P1DomainError(
            'INVALID_STATE',
            'A rejected request cannot have unknown delivery.',
          );
        }

        const timestamp = new Date().toISOString();
        await store.appendProviderCost({
          ...input.providerCost,
          workspaceId: context.workspaceId,
          actorId: context.userId,
          correlationId: context.correlationId,
          createdAt: timestamp,
        });

        let asset: OwnedAsset | undefined;
        if (input.outcome.status === 'completed') {
          const receipt = input.outcome.asset;
          if (job.operation !== 'copy' && !receipt) {
            throw new P1DomainError(
              'INVALID_STATE',
              'Media delivery requires an owned asset receipt.',
            );
          }
          if (receipt) {
            if (
              receipt.jobId !== job.id ||
              receipt.attemptId !== attempt.id ||
              !receipt.objectKey.startsWith(`${context.workspaceId}/`) ||
              !/^[a-f0-9]{64}$/i.test(receipt.sha256) ||
              receipt.sizeBytes <= 0
            ) {
              throw new P1DomainError(
                'INVALID_STATE',
                'A verified workspace-owned asset receipt is required.',
              );
            }
            asset = {
              ...receipt,
              workspaceId: context.workspaceId,
              createdAt: timestamp,
            };
            await store.insertOwnedAsset(asset);
          }
        }

        const updatedAttempt: ProviderAttempt = {
          ...attempt,
          acceptance: input.acceptance,
          ...(input.providerTaskRef
            ? { providerTaskRef: input.providerTaskRef }
            : {}),
          status:
            input.outcome.status === 'completed'
              ? 'completed'
              : input.outcome.status === 'failed' ||
                  input.outcome.status === 'retryable_rejection'
                ? 'failed'
                : 'submitted',
          updatedAt: timestamp,
        };
        await store.updateProviderAttempt(updatedAttempt);

        if (
          input.outcome.status !== 'unknown' &&
          input.outcome.status !== 'retryable_rejection'
        ) {
          await settleUsageReservation(
            store,
            context,
            job,
            input.outcome.status === 'completed' ? 'commit' : 'refund',
            input.outcome.status === 'completed'
              ? asset
                ? 'owned_asset_delivered'
                : 'copy_output_delivered'
              : input.outcome.reason,
            timestamp,
          );
        }
        const updatedJob: GenerationJob = {
          ...job,
          status:
            input.outcome.status === 'completed'
              ? 'completed'
              : input.outcome.status === 'failed'
                ? 'failed'
                : input.outcome.status === 'retryable_rejection'
                  ? 'running'
                : 'unknown',
          result: structuredClone(input.result),
          updatedAt: timestamp,
        };
        await store.updateGenerationJob(updatedJob);
        return { job: updatedJob, attempt: updatedAttempt, asset };
      },
    );
    return result.value;
  }

  async recordAssetReceipt(
    context: P1Context,
    input: Omit<OwnedAsset, 'workspaceId' | 'createdAt'>,
    idempotencyKey: string
  ) {
    const result = await this.repository.executeIdempotent(
      context,
      idempotencyKey,
      payloadHash(input),
      async (store) => {
        await this.authorizeOwner(store, context);
        const job = await requireJob(store, context.workspaceId, input.jobId);
        const attempt = await store.getProviderAttempt(context.workspaceId, input.attemptId);
        if (!attempt || attempt.jobId !== job.id || attempt.acceptance !== 'accepted') {
          throw new P1DomainError('INVALID_STATE', 'An accepted attempt is required for asset delivery.');
        }
        if (!input.objectKey.startsWith(`${context.workspaceId}/`) || !/^[a-f0-9]{64}$/i.test(input.sha256) || input.sizeBytes <= 0) {
          throw new P1DomainError('INVALID_STATE', 'A verified workspace-owned asset receipt is required.');
        }
        const now = new Date().toISOString();
        const asset: OwnedAsset = { ...input, workspaceId: context.workspaceId, createdAt: now };
        await store.insertOwnedAsset(asset);
        await store.updateProviderAttempt({ ...attempt, status: 'completed', updatedAt: now });
        await store.updateGenerationJob({ ...job, status: 'completed', updatedAt: now });
        const usage = await store.listUsageEvents(context.workspaceId, job.operation);
        const reservation = usage.find(
          (event) => event.action === 'reserve' && event.reservationId === job.usageReservationId
        );
        const terminal = usage.find(
          (event) => event.reservationId === job.usageReservationId &&
            (event.action === 'commit' || event.action === 'refund' || event.action === 'expire')
        );
        if (!reservation) throw new P1DomainError('INVALID_STATE', 'Usage reservation was not found.');
        if (!terminal) {
          await store.appendUsageEvent({
            id: `asset:${asset.id}:commit`,
            workspaceId: context.workspaceId,
            resource: job.operation,
            action: 'commit',
            amount: reservation.amount,
            reservationId: job.usageReservationId,
            reason: 'owned_asset_delivered',
            actorId: context.userId,
            correlationId: context.correlationId,
            createdAt: now,
          });
        } else if (terminal.action !== 'commit') {
          throw new P1DomainError('INVALID_STATE', 'Usage reservation was already released.');
        }
        return asset;
      }
    );
    return result.value;
  }

  async settleGenerationFailure(
    context: P1Context,
    input: { jobId: string; reason: string },
    idempotencyKey: string
  ) {
    const result = await this.repository.executeIdempotent(
      context,
      idempotencyKey,
      payloadHash(input),
      async (store) => {
        await this.authorizeOwner(store, context);
        const job = await requireJob(store, context.workspaceId, input.jobId);
        if (job.status === 'completed' || job.status === 'cancelled') {
          throw new P1DomainError('INVALID_STATE', 'A delivered or cancelled job cannot fail.');
        }
        const events = await store.listUsageEvents(context.workspaceId, job.operation);
        const reservation = events.find(
          (event) => event.action === 'reserve' && event.reservationId === job.usageReservationId
        );
        if (!reservation) throw new P1DomainError('INVALID_STATE', 'Usage reservation was not found.');
        const terminal = events.find(
          (event) => event.reservationId === job.usageReservationId &&
            (event.action === 'commit' || event.action === 'refund' || event.action === 'expire')
        );
        if (terminal && terminal.action !== 'refund') {
          throw new P1DomainError('INVALID_STATE', 'Usage reservation already has another terminal result.');
        }
        const now = new Date().toISOString();
        if (!terminal) {
          await store.appendUsageEvent({
            id: `job:${job.id}:refund`, workspaceId: context.workspaceId, resource: job.operation,
            action: 'refund', amount: reservation.amount, reservationId: job.usageReservationId,
            reason: input.reason, actorId: context.userId, correlationId: context.correlationId,
            createdAt: now,
          });
        }
        const failed = { ...job, status: 'failed' as const, updatedAt: now };
        await store.updateGenerationJob(failed);
        return failed;
      }
    );
    return result.value;
  }

  /**
   * Td-2: after a subtask commits usage, outer compose/label/validation failure
   * cannot refund the reservation (already terminal). Append an idempotent
   * compensate event to restore allowance.
   */
  async compensateCommittedUsage(
    context: P1Context,
    input: { jobId: string; reason: string },
    idempotencyKey: string
  ) {
    const result = await this.repository.executeIdempotent(
      context,
      idempotencyKey,
      payloadHash(input),
      async (store) => {
        await this.authorizeOwner(store, context);
        const job = await requireJob(store, context.workspaceId, input.jobId);
        const events = await store.listUsageEvents(
          context.workspaceId,
          job.operation
        );
        const reservation = events.find(
          (event) =>
            event.action === 'reserve' &&
            event.reservationId === job.usageReservationId
        );
        if (!reservation) {
          throw new P1DomainError(
            'INVALID_STATE',
            'Usage reservation was not found.'
          );
        }
        const terminal = events.find(
          (event) =>
            event.reservationId === job.usageReservationId &&
            (event.action === 'commit' ||
              event.action === 'refund' ||
              event.action === 'expire')
        );
        const now = new Date().toISOString();
        if (!terminal) {
          // Still reserved: normal refund path.
          await store.appendUsageEvent({
            id: `job:${job.id}:refund`,
            workspaceId: context.workspaceId,
            resource: job.operation,
            action: 'refund',
            amount: reservation.amount,
            reservationId: job.usageReservationId,
            reason: input.reason,
            actorId: context.userId,
            correlationId: context.correlationId,
            createdAt: now,
          });
          return { kind: 'refund' as const, amount: reservation.amount };
        }
        if (terminal.action === 'refund' || terminal.action === 'expire') {
          return { kind: 'already_released' as const, amount: 0 };
        }
        // Committed: compensate restores allowance (idempotent via key).
        const compensateId = `job:${job.id}:compensate:${input.reason}`;
        const existing = events.find((event) => event.id === compensateId);
        if (existing) {
          return { kind: 'compensate' as const, amount: existing.amount };
        }
        await store.appendUsageEvent({
          id: compensateId,
          workspaceId: context.workspaceId,
          resource: job.operation,
          action: 'compensate',
          amount: reservation.amount,
          reservationId: job.usageReservationId,
          reason: input.reason,
          actorId: context.userId,
          correlationId: context.correlationId,
          createdAt: now,
        });
        return { kind: 'compensate' as const, amount: reservation.amount };
      }
    );
    return result.value;
  }

  async activateCutover(
    context: P1Context,
    input: {
      id: string;
      sourceRevision: string;
      targetRevision: string;
      backupRef: string;
      dryRunDifferenceCount: number;
      inFlightDecision: 'legacy_drain' | 'new_owner_recovery' | 'manual';
    },
    idempotencyKey: string
  ) {
    const result = await this.repository.executeIdempotent(context, idempotencyKey, payloadHash(input), async (store) => {
      await this.authorizeOwner(store, context);
      if (!input.backupRef) throw new P1DomainError('INVALID_STATE', 'Backup evidence is required.');
      if (input.dryRunDifferenceCount !== 0) {
        throw new P1DomainError('INVALID_STATE', 'Cutover dry run still has differences.');
      }
      const now = new Date().toISOString();
      const record = {
        ...input, workspaceId: context.workspaceId, status: 'active' as const,
        futureWriteOwner: 'p1' as const, actorId: context.userId,
        correlationId: context.correlationId, createdAt: now, updatedAt: now,
      };
      await store.insertCutover(record);
      return record;
    });
    return result.value;
  }

  async rollbackFutureWrites(
    context: P1Context,
    input: { cutoverId: string; reason: string },
    idempotencyKey: string
  ) {
    const result = await this.repository.executeIdempotent(context, idempotencyKey, payloadHash(input), async (store) => {
      await this.authorizeOwner(store, context);
      const record = await store.getCutover(context.workspaceId, input.cutoverId);
      if (!record) throw new P1DomainError('NOT_FOUND', 'Cutover record was not found.');
      const rolledBack = {
        ...record, status: 'rolled_back' as const, futureWriteOwner: 'legacy' as const,
        rollbackReason: input.reason, updatedAt: new Date().toISOString(),
      };
      await store.updateCutover(rolledBack);
      return rolledBack;
    });
    return result.value;
  }

  async getGenerationJob(context: P1Context, jobId: string) {
    await this.authorizeOwner(this.repository, context);
    return requireJob(this.repository, context.workspaceId, jobId);
  }

  async getRouteSnapshot(context: P1Context, snapshotId: string) {
    await this.authorizeOwner(this.repository, context);
    return requireSnapshot(this.repository, context.workspaceId, snapshotId);
  }

  async getProviderAttempt(context: P1Context, attemptId: string) {
    await this.authorizeOwner(this.repository, context);
    const attempt = await this.repository.getProviderAttempt(
      context.workspaceId,
      attemptId,
    );
    if (!attempt) {
      throw new P1DomainError('NOT_FOUND', 'Provider attempt was not found.');
    }
    return attempt;
  }

  async getOwnedAsset(context: P1Context, assetId: string) {
    await this.authorizeOwner(this.repository, context);
    const asset = await this.repository.getOwnedAsset(
      context.workspaceId,
      assetId,
    );
    if (!asset) throw new P1DomainError('NOT_FOUND', 'Owned asset was not found.');
    return asset;
  }

  async listProviderCosts(context: P1Context, attemptId: string) {
    await this.authorizeOwner(this.repository, context);
    return this.repository.listProviderCosts(context.workspaceId, attemptId);
  }

  async listCommandAudits(context: P1Context) {
    await this.authorizeOwner(this.repository, context);
    return this.repository.listCommandAudits(context.workspaceId);
  }
}

function assertMonotonicProviderOutcome(
  job: GenerationJob,
  outcome: ProviderOutcomeSettlement['outcome']['status'],
) {
  if (
    job.status === 'completed' ||
    job.status === 'failed' ||
    job.status === 'cancelled'
  ) {
    throw new P1DomainError(
      'INVALID_STATE',
      'A terminal generation job cannot accept another provider settlement.',
    );
  }
  if (
    job.status === 'unknown' &&
    outcome !== 'completed' &&
    outcome !== 'failed'
  ) {
    throw new P1DomainError(
      'INVALID_STATE',
      'An unknown generation job can advance only to a terminal outcome.',
    );
  }
}

function validateRouteSnapshot(snapshot: Omit<RouteSnapshot, 'workspaceId' | 'createdAt'>) {
  if (snapshot.allowedCandidates.length === 0) {
    throw new P1DomainError('INVALID_STATE', 'A route snapshot needs at least one candidate.');
  }
  if (snapshot.dataClass !== 'public' && snapshot.allowedCandidates.some((item) => item.region !== 'cn')) {
    throw new P1DomainError('INVALID_STATE', 'Sensitive generation data cannot use a foreign deployment.');
  }
  if (snapshot.selectionMode === 'fixed' && snapshot.allowedCandidates.some(
    (item) => item.catalogModelId !== snapshot.requestedCatalogModelId
  )) {
    throw new P1DomainError('INVALID_STATE', 'A fixed route can only contain equivalent deployments.');
  }
}

async function requireJob(store: FoundationStore, workspaceId: string, jobId: string) {
  const job = await store.getGenerationJob(workspaceId, jobId);
  if (!job) throw new P1DomainError('NOT_FOUND', 'Generation job was not found.');
  return job;
}

async function requireSnapshot(store: FoundationStore, workspaceId: string, snapshotId: string) {
  const snapshot = await store.getRouteSnapshot(workspaceId, snapshotId);
  if (!snapshot) throw new P1DomainError('NOT_FOUND', 'Route snapshot was not found.');
  return snapshot;
}

function sameFrozenRoute(left: RouteSnapshot, right: RouteSnapshot) {
  const { createdAt: _leftCreatedAt, ...leftFacts } = left;
  const { createdAt: _rightCreatedAt, ...rightFacts } = right;
  return JSON.stringify(stable(leftFacts)) === JSON.stringify(stable(rightFacts));
}

async function settleUsageReservation(
  store: FoundationStore,
  context: P1Context,
  job: GenerationJob,
  action: 'commit' | 'refund',
  reason: string,
  createdAt: string,
) {
  const events = await store.listUsageEvents(context.workspaceId, job.operation);
  const reservation = events.find(
    (event) =>
      event.action === 'reserve' &&
      event.reservationId === job.usageReservationId,
  );
  if (!reservation) {
    throw new P1DomainError('INVALID_STATE', 'Usage reservation was not found.');
  }
  const terminal = events.find(
    (event) =>
      event.reservationId === job.usageReservationId &&
      (event.action === 'commit' ||
        event.action === 'refund' ||
        event.action === 'expire'),
  );
  if (terminal) {
    if (terminal.action !== action) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Usage reservation already has another terminal result.',
      );
    }
    return terminal;
  }
  const event: UsageEvent = {
    id: `job:${job.id}:${action}`,
    workspaceId: context.workspaceId,
    resource: job.operation,
    action,
    amount: reservation.amount,
    reservationId: job.usageReservationId,
    reason,
    actorId: context.userId,
    correlationId: context.correlationId,
    createdAt,
  };
  await store.appendUsageEvent(event);
  return event;
}

export function projectUsage(events: UsageEvent[]): UsageProjection {
  const allowance = events
    .filter((event) => event.action === 'adjust' || event.action === 'compensate')
    .reduce((sum, event) => sum + event.amount, 0);
  const terminals = new Map(
    events
      .filter((event) =>
        event.action === 'commit' || event.action === 'refund' || event.action === 'expire'
      )
      .map((event) => [event.reservationId, event])
  );
  let reserved = 0;
  let committed = 0;
  let released = 0;
  for (const event of events) {
    if (event.action !== 'reserve' || !event.reservationId) continue;
    const terminal = terminals.get(event.reservationId);
    if (terminal?.action === 'commit') {
      committed += terminal.amount;
      released += Math.max(0, event.amount - terminal.amount);
    }
    else if (terminal?.action === 'refund' || terminal?.action === 'expire') {
      released += event.amount;
    }
    else if (!terminal) reserved += event.amount;
  }
  return {
    allowance,
    reserved,
    committed,
    released,
    available: Math.max(0, allowance - reserved - committed),
  };
}

function validateProviderCostAmount(
  cost: Pick<ProviderCostEvent, 'amountMicros' | 'billingStatus'>,
) {
  const billingStatus = cost.billingStatus ?? 'known';
  if (billingStatus === 'known') {
    if (!Number.isInteger(cost.amountMicros) || (cost.amountMicros ?? -1) < 0) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Known provider cost must be non-negative integer micros.',
      );
    }
    return;
  }
  if (cost.amountMicros !== null) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Externally billed or unknown provider cost must not fabricate an amount.',
    );
  }
}
