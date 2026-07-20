import { createHash } from 'node:crypto';

const AGENT_IDEMPOTENCY_LEASE_MS = 5 * 60_000;

export interface CanvasAgentContext {
  userId: string;
  workspaceId: string;
  correlationId: string;
}

export interface CanvasNode {
  id: string;
  kind: 'text' | 'image' | 'video' | 'audio' | 'config';
  data: Record<string, unknown>;
}

export interface CanvasEdge {
  id: string;
  from: string;
  to: string;
}

export type CanvasAgentGenerationOperation =
  | 'image.generate'
  | 'image.edit'
  | 'text.respond'
  | 'video.generate'
  | 'audio.speech'
  | 'audio.sfx';

export interface CanvasAgentGenerationInputAsset {
  assetId: string;
  role: 'reference_image' | 'reference_video' | 'reference_audio' | 'mask';
}

export type CanvasAgentOperation =
  | { tool: 'read_canvas' }
  | { tool: 'create_node'; node: CanvasNode }
  | {
      tool: 'update_node';
      nodeId: string;
      patch: Record<string, unknown>;
    }
  | { tool: 'delete_node'; nodeId: string }
  | { tool: 'connect_nodes'; from: string; to: string }
  | { tool: 'disconnect_nodes'; from: string; to: string }
  | {
      tool: 'run_generation';
      operation: CanvasAgentGenerationOperation;
      prompt: string;
      inputAssets: CanvasAgentGenerationInputAsset[];
    };

export interface CanvasAgentGraph {
  workspaceId: string;
  projectId: string;
  revision: number;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  assetVersions: Record<string, string>;
}

export interface CanvasAgentAuthorizationReadSet {
  role: 'owner' | 'operator' | 'reviewer';
  roleRevision: string;
  quotaQuote: {
    id: string;
    revision: string;
    operationHash: string;
    maxCostMicros: number;
    maxGenerationCount: number;
  };
  operationCapabilityRevisions: Record<string, string>;
  assetGrantRevisions: Record<string, string>;
}

export interface CanvasAgentAuthorizationRequest {
  userId: string;
  workspaceId: string;
  projectId: string;
  baseRevision: number;
  operationHash: string;
  operations: CanvasAgentOperation[];
  tools: CanvasAgentOperation['tool'][];
  assetIds: string[];
  maxCostMicros: number;
  maxGenerationCount: number;
}

export interface CanvasAgentAuthorizationPort {
  resolve(
    input: CanvasAgentAuthorizationRequest,
  ): Promise<CanvasAgentAuthorizationReadSet>;
}

export interface CanvasAgentTransactionDatabase {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Row[] }>;
}

export interface CanvasAgentTransactionalAuthorizationPort {
  resolveInTransaction(
    database: CanvasAgentTransactionDatabase,
    input: CanvasAgentAuthorizationRequest,
  ): Promise<CanvasAgentAuthorizationReadSet>;
}

export interface CanvasAgentTransactionContext {
  resolveAuthorization(
    input: CanvasAgentAuthorizationRequest,
  ): Promise<CanvasAgentAuthorizationReadSet>;
}

export interface CanvasAgentReadSet {
  assetVersions: Record<string, string>;
  authorization: CanvasAgentAuthorizationReadSet;
}

export interface AgentPlanDiff {
  tool: CanvasAgentOperation['tool'];
  summary: string;
  before: unknown;
  after: unknown;
}

export interface AgentPlan {
  id: string;
  workspaceId: string;
  userId: string;
  sessionId: string;
  projectId: string;
  baseRevision: number;
  operations: CanvasAgentOperation[];
  operationHash: string;
  readSet: CanvasAgentReadSet;
  diff: AgentPlanDiff[];
  affectedAssetIds: string[];
  maxCostMicros: number;
  maxGenerationCount: number;
  createdAt: string;
}

export interface AgentConfirmation {
  id: string;
  planId: string;
  workspaceId: string;
  userId: string;
  sessionId: string;
  projectId: string;
  baseRevision: number;
  operationHash: string;
  readSet: AgentPlan['readSet'];
  maxCostMicros: number;
  maxGenerationCount: number;
  nonce: string;
  expiresAt: string;
  usedAt?: string;
}

export interface AgentAuditEvent {
  id: string;
  workspaceId: string;
  userId: string;
  projectId: string;
  correlationId: string;
  outcome: 'executed' | 'changed' | 'error';
  operationIndex?: number;
  tool?: CanvasAgentOperation['tool'];
  operationHash?: string;
  errorCode?: string;
  createdAt: string;
}

export interface AgentGenerationAttemptEvent {
  attemptNo: number;
  backoffMs: number;
  errorCode?: string;
  maxAttempts: number;
  outcome: 'submitted' | 'retry' | 'failed';
  retryable: boolean;
  startedAt: string;
}

export interface AgentGenerationOutboxItem {
  attemptCount: number;
  attemptEvents: AgentGenerationAttemptEvent[];
  assetGrantRevisions: Record<string, string>;
  assetVersions: Record<string, string>;
  availableAt: string;
  batchId: string;
  dispatchRevision: string;
  id: string;
  idempotencyKey: string;
  inputAssets: CanvasAgentGenerationInputAsset[];
  userId: string;
  workspaceId: string;
  projectId: string;
  revisionId: string;
  operation: Extract<CanvasAgentOperation, { tool: 'run_generation' }>['operation'];
  prompt: string;
  quotaQuote: {
    id: string;
    revision: string;
  };
  capabilityRevision: string;
  status: 'pending' | 'claimed' | 'retry' | 'submitted' | 'failed';
  claimToken?: string;
  claimedAt?: string;
  canonicalJobId?: string;
  failureCode?: string;
  lastErrorCode?: string;
  createdAt: string;
}

export interface AgentGenerationBatchBudget {
  id: string;
  maxCostMicros: number;
  maxGenerationCount: number;
  reservations: Array<{
    costMicros: number;
    generationCount: number;
    outboxId: string;
    quoteId: string;
  }>;
}

export interface CanvasAgentWorkspaceState {
  graphs: CanvasAgentGraph[];
  plans: AgentPlan[];
  confirmations: AgentConfirmation[];
  auditEvents: AgentAuditEvent[];
  outbox: AgentGenerationOutboxItem[];
  generationBatches: AgentGenerationBatchBudget[];
  idempotencyReceipts?: Array<{
    action: 'plan' | 'confirm' | 'apply';
    idempotencyKey: string;
    payloadHash: string;
    status?: 'pending' | 'completed';
    claimToken?: string;
    claimedAt?: string;
    result?: unknown;
  }>;
}

export function createEmptyCanvasAgentState(): CanvasAgentWorkspaceState {
  return {
    graphs: [],
    plans: [],
    confirmations: [],
    auditEvents: [],
    outbox: [],
    generationBatches: [],
    idempotencyReceipts: [],
  };
}

export class CanvasAgentError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: {
      confirmationId?: string;
      projectId?: string;
    },
  ) {
    super(message);
  }
}

export interface CanvasAgentRepository {
  readGraph(workspaceId: string, projectId: string): Promise<CanvasAgentGraph | null>;
  savePlan(workspaceId: string, plan: AgentPlan): Promise<void>;
  readPlan(workspaceId: string, planId: string): Promise<AgentPlan | null>;
  readConfirmation(
    workspaceId: string,
    confirmationId: string,
  ): Promise<AgentConfirmation | null>;
  listConfirmations(workspaceId: string): Promise<AgentConfirmation[]>;
  saveConfirmation(
    workspaceId: string,
    confirmation: AgentConfirmation,
  ): Promise<void>;
  transact<T>(
    workspaceId: string,
    action: (
      state: CanvasAgentWorkspaceState,
      transaction?: CanvasAgentTransactionContext,
    ) => T | Promise<T>,
  ): Promise<T>;
  appendAudit(workspaceId: string, event: AgentAuditEvent): Promise<void>;
}

export class MemoryCanvasAgentRepository implements CanvasAgentRepository {
  private readonly states = new Map<string, CanvasAgentWorkspaceState>();
  private readonly transactionTails = new Map<string, Promise<void>>();

  constructor(graphs: CanvasAgentGraph[] = []) {
    for (const graph of graphs) {
      this.state(graph.workspaceId).graphs.push(structuredClone(graph));
    }
  }

  async readGraph(workspaceId: string, projectId: string) {
    const graph = this.state(workspaceId).graphs.find(
      (candidate) => candidate.projectId === projectId,
    );
    return graph ? structuredClone(graph) : null;
  }

  async savePlan(workspaceId: string, plan: AgentPlan) {
    const state = this.state(workspaceId);
    if (!state.plans.some((candidate) => candidate.id === plan.id)) {
      state.plans.push(structuredClone(plan));
    }
  }

  async readPlan(workspaceId: string, planId: string) {
    const plan = this.state(workspaceId).plans.find(
      (candidate) => candidate.id === planId,
    );
    return plan ? structuredClone(plan) : null;
  }

  async readConfirmation(workspaceId: string, confirmationId: string) {
    const confirmation = this.state(workspaceId).confirmations.find(
      (candidate) => candidate.id === confirmationId,
    );
    return confirmation ? structuredClone(confirmation) : null;
  }

  async listConfirmations(workspaceId: string) {
    return structuredClone(this.state(workspaceId).confirmations);
  }

  async saveConfirmation(
    workspaceId: string,
    confirmation: AgentConfirmation,
  ) {
    const state = this.state(workspaceId);
    if (!state.confirmations.some((candidate) => candidate.id === confirmation.id)) {
      state.confirmations.push(structuredClone(confirmation));
    }
  }

  async transact<T>(
    workspaceId: string,
    action: (
      state: CanvasAgentWorkspaceState,
      transaction?: CanvasAgentTransactionContext,
    ) => T | Promise<T>,
  ) {
    const previous = this.transactionTails.get(workspaceId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.transactionTails.set(workspaceId, tail);
    await previous;
    try {
      const draft = structuredClone(this.state(workspaceId));
      const result = await action(draft);
      this.states.set(workspaceId, draft);
      return structuredClone(result);
    } finally {
      release();
      if (this.transactionTails.get(workspaceId) === tail) {
        this.transactionTails.delete(workspaceId);
      }
    }
  }

  async appendAudit(workspaceId: string, event: AgentAuditEvent) {
    this.state(workspaceId).auditEvents.push(structuredClone(event));
  }

  snapshot(workspaceId: string) {
    return structuredClone(this.state(workspaceId));
  }

  private state(workspaceId: string) {
    let state = this.states.get(workspaceId);
    if (!state) {
      state = createEmptyCanvasAgentState();
      this.states.set(workspaceId, state);
    }
    return state;
  }
}

export interface CanvasAgentPlannerPort {
  plan(input: {
    context: CanvasAgentContext;
    intent: string;
    graph: CanvasAgentGraph;
  }): Promise<CanvasAgentOperation[]>;
}

export class CanvasAgentApplicationService {
  constructor(
    private readonly repository: CanvasAgentRepository,
    private readonly dependencies: {
      planner: CanvasAgentPlannerPort;
      authorization?: CanvasAgentAuthorizationPort;
      accessAudit?: {
        recordAccessDenied(event: {
          actorId: string;
          createdAt?: string;
          objectId: string;
          objectKind: 'confirmation';
          projectId?: string;
          workspaceId: string;
        }): Promise<void>;
      };
      clock?: () => Date;
      generationOutbox?: {
        revisions: Partial<Record<CanvasAgentGenerationOperation, string>>;
      };
      nonce?: () => string;
    },
  ) {}

  async plan(
    context: CanvasAgentContext,
    input: {
      sessionId: string;
      projectId: string;
      intent: string;
      maxCostMicros: number;
      maxGenerationCount: number;
      idempotencyKey?: string;
    },
  ) {
    requireText(input.sessionId, 'sessionId');
    requireText(input.projectId, 'projectId');
    requireText(input.intent, 'intent');
    requireLimit(input.maxCostMicros, 'maxCostMicros');
    requireLimit(input.maxGenerationCount, 'maxGenerationCount');
    this.requireAuthorization();
    const payloadHash = input.idempotencyKey
      ? agentIntentPayloadHash(context, input)
      : null;
    let claimToken: string | null = null;
    if (input.idempotencyKey && payloadHash) {
      const claim = await this.repository.transact(context.workspaceId, (state) =>
        beginAgentIntent<AgentPlan>(
          state,
          'plan',
          input.idempotencyKey as string,
          payloadHash,
          this.now(),
        ),
      );
      if (claim.status === 'replay') return claim.result;
      claimToken = claim.claimToken;
    }
    try {
      const graph = await this.repository.readGraph(
        context.workspaceId,
        input.projectId,
      );
      if (!graph) {
        throw new CanvasAgentError('PROJECT_NOT_FOUND', 'Canvas project was not found.');
      }
      const operations = structuredClone(
        await this.dependencies.planner.plan({ context, intent: input.intent, graph }),
      );
      validateOperations(operations);
      assertGenerationDispatchAvailable(
        operations,
        this.dependencies.generationOutbox,
      );
      const diff = resolveOperationDiffs(graph, operations);
      const affectedAssetIds = Object.keys(
        resolveReadSet(graph, operations).assetVersions,
      ).sort();
      const operationHash = planOperationHash(
        operations,
        diff,
        affectedAssetIds,
      );
      const readSet = await this.resolveReadSet(
        context,
        graph,
        operations,
        operationHash,
        input.maxCostMicros,
        input.maxGenerationCount,
      );
      const createdAt = this.now().toISOString();
      const plan: AgentPlan = {
        id: `agent-plan-${digest(
          canonical({
            workspaceId: context.workspaceId,
            userId: context.userId,
            sessionId: input.sessionId,
            projectId: input.projectId,
            revision: graph.revision,
            operationHash,
            createdAt,
          }),
        ).slice(0, 24)}`,
        workspaceId: context.workspaceId,
        userId: context.userId,
        sessionId: input.sessionId,
        projectId: input.projectId,
        baseRevision: graph.revision,
        operations,
        operationHash,
        readSet,
        diff,
        affectedAssetIds,
        maxCostMicros: input.maxCostMicros,
        maxGenerationCount: input.maxGenerationCount,
        createdAt,
      };
      if (!input.idempotencyKey || !payloadHash || !claimToken) {
        await this.repository.savePlan(context.workspaceId, plan);
        return structuredClone(plan);
      }
      return await this.repository.transact(context.workspaceId, (state) => {
        if (!state.plans.some((candidate) => candidate.id === plan.id)) {
          state.plans.push(structuredClone(plan));
        }
        completeAgentIntent(
          state,
          'plan',
          input.idempotencyKey as string,
          payloadHash,
          claimToken as string,
          plan,
        );
        return plan;
      });
    } catch (error) {
      if (input.idempotencyKey && payloadHash && claimToken) {
        await this.repository.transact(context.workspaceId, (state) => {
          abandonAgentIntent(
            state,
            'plan',
            input.idempotencyKey as string,
            payloadHash,
            claimToken as string,
          );
        });
      }
      throw error;
    }
  }

  async confirm(
    context: CanvasAgentContext,
    input: { sessionId: string; planId: string; idempotencyKey?: string },
  ) {
    const plan = await this.repository.readPlan(context.workspaceId, input.planId);
    if (
      !plan ||
      plan.userId !== context.userId ||
      plan.sessionId !== input.sessionId
    ) {
      throw new CanvasAgentError('PLAN_NOT_FOUND', 'Agent plan was not found.');
    }
    assertGenerationDispatchAvailable(
      plan.operations,
      this.dependencies.generationOutbox,
    );
    const graph = await this.repository.readGraph(
      context.workspaceId,
      plan.projectId,
    );
    if (!graph || graph.revision !== plan.baseRevision) {
      throw new CanvasAgentError(
        'REVISION_CONFLICT',
        'Canvas revision changed after planning.',
      );
    }
    await this.assertPlanReadSetCurrent(context, plan, graph, plan.readSet);
    // Confirmation-fatigue guard: limit batch confirmations per session window.
    const windowMs = 60_000;
    const maxConfirmationsPerWindow = 8;
    const windowStart = this.now().getTime() - windowMs;
    const recentConfirmations = (
      await this.repository.listConfirmations(context.workspaceId)
    ).filter(
      (candidate) =>
        candidate.sessionId === input.sessionId &&
        candidate.userId === context.userId &&
        Date.parse(candidate.expiresAt) - 5 * 60 * 1000 >= windowStart,
    );
    if (recentConfirmations.length >= maxConfirmationsPerWindow) {
      throw new CanvasAgentError(
        'CONFIRMATION_RATE_LIMITED',
        'Too many Agent confirmations in a short window; re-read the canvas and confirm deliberately.',
      );
    }
    const nonce = this.dependencies.nonce?.() ?? crypto.randomUUID();
    const expiresAt = new Date(this.now().getTime() + 5 * 60 * 1000).toISOString();
    const confirmation: AgentConfirmation = {
      id: `agent-confirmation-${digest(`${plan.id}:${nonce}`).slice(0, 24)}`,
      planId: plan.id,
      workspaceId: plan.workspaceId,
      userId: plan.userId,
      sessionId: plan.sessionId,
      projectId: plan.projectId,
      baseRevision: plan.baseRevision,
      operationHash: plan.operationHash,
      readSet: structuredClone(plan.readSet),
      maxCostMicros: plan.maxCostMicros,
      maxGenerationCount: plan.maxGenerationCount,
      nonce,
      expiresAt,
    };
    const result = {
      affectedAssetIds: [...plan.affectedAssetIds],
      credentialId: confirmation.id,
      expiresAt,
      diff: structuredClone(plan.diff),
      maxCostMicros: confirmation.maxCostMicros,
      maxGenerationCount: confirmation.maxGenerationCount,
    };
    if (!input.idempotencyKey) {
      await this.repository.saveConfirmation(context.workspaceId, confirmation);
      return result;
    }
    return this.repository.transact(context.workspaceId, (state) => {
      const payloadHash = agentIntentPayloadHash(context, input);
      const replay = replayAgentIntent<typeof result>(
        state,
        'confirm',
        input.idempotencyKey as string,
        payloadHash,
      );
      if (replay) return replay;
      if (!state.confirmations.some((candidate) => candidate.id === confirmation.id)) {
        state.confirmations.push(structuredClone(confirmation));
      }
      saveAgentIntent(
        state,
        'confirm',
        input.idempotencyKey as string,
        payloadHash,
        result,
      );
      return result;
    });
  }

  async apply(
    context: CanvasAgentContext,
    input: {
      sessionId: string;
      projectId: string;
      credentialId: string;
      expectedRevision: number;
      idempotencyKey?: string;
    },
  ) {
    try {
      await this.assertConfirmationReadSetCurrent(context, input);
      return await this.repository.transact(
        context.workspaceId,
        async (state, transaction) => {
          const idempotencyPayloadHash = input.idempotencyKey
            ? agentIntentPayloadHash(context, input)
            : null;
          if (input.idempotencyKey && idempotencyPayloadHash) {
            const replay = replayAgentIntent<{
              status: 'changed' | 'executed';
              revision: number;
            }>(state, 'apply', input.idempotencyKey, idempotencyPayloadHash);
            if (replay) return replay;
          }
          const graph = state.graphs.find(
            (candidate) => candidate.projectId === input.projectId,
          );
          const confirmation = state.confirmations.find(
            (candidate) => candidate.id === input.credentialId,
          );
          if (!graph || !confirmation) {
            throw new CanvasAgentError(
              'CONFIRMATION_NOT_FOUND',
              'Agent confirmation was not found.',
              { confirmationId: input.credentialId, projectId: input.projectId },
            );
          }
          if (
            confirmation.userId !== context.userId ||
            confirmation.sessionId !== input.sessionId ||
            confirmation.projectId !== input.projectId
          ) {
            throw new CanvasAgentError(
              'CONFIRMATION_NOT_FOUND',
              'Agent confirmation was not found.',
              { confirmationId: input.credentialId, projectId: input.projectId },
            );
          }
          if (confirmation.usedAt) {
            throw new CanvasAgentError(
              'CONFIRMATION_ALREADY_USED',
              'Agent confirmation has already been used.',
            );
          }
          if (new Date(confirmation.expiresAt).getTime() <= this.now().getTime()) {
            throw new CanvasAgentError(
              'CONFIRMATION_EXPIRED',
              'Agent confirmation has expired.',
            );
          }
          if (
            graph.revision !== input.expectedRevision ||
            confirmation.baseRevision !== input.expectedRevision
          ) {
            throw new CanvasAgentError(
              'REVISION_CONFLICT',
              'Canvas revision changed after confirmation.',
            );
          }
          const plan = state.plans.find(
            (candidate) => candidate.id === confirmation.planId,
          );
          if (
            !plan ||
            planOperationHash(
              plan.operations,
              plan.diff,
              plan.affectedAssetIds,
            ) !== confirmation.operationHash
          ) {
            throw new CanvasAgentError(
              'CONFIRMATION_INVALID',
              'Confirmed operations no longer match the plan.',
            );
          }
          assertGenerationDispatchAvailable(
            plan.operations,
            this.dependencies.generationOutbox,
          );
          if (
            canonical(resolveReadSet(graph, plan.operations).assetVersions) !==
            canonical(confirmation.readSet.assetVersions)
          ) {
            throw new CanvasAgentError(
              'READ_SET_CHANGED',
              'Canvas dependencies changed after confirmation.',
            );
          }
          await this.assertPlanReadSetCurrent(
            context,
            plan,
            graph,
            confirmation.readSet,
            transaction?.resolveAuthorization,
          );
          const operationOutcomes = plan.operations.map((operation) =>
            applyOperation(graph, operation) ? 'changed' as const : 'executed' as const,
          );
          const changed = operationOutcomes.includes('changed');
          const generationOperations = plan.operations.filter(
            (operation): operation is Extract<
              CanvasAgentOperation,
              { tool: 'run_generation' }
            > => operation.tool === 'run_generation',
          );
          if (changed || generationOperations.length > 0) graph.revision += 1;
          if (generationOperations.length > 0) {
            enqueueGenerationOperations(state, {
              assetGrantRevisions:
                confirmation.readSet.authorization.assetGrantRevisions,
              assetVersions: confirmation.readSet.assetVersions,
              capabilityRevisions:
                confirmation.readSet.authorization.operationCapabilityRevisions,
              dispatchRevisions:
                this.dependencies.generationOutbox?.revisions ?? {},
              generationOperations,
              maxCostMicros: confirmation.maxCostMicros,
              maxGenerationCount: confirmation.maxGenerationCount,
              now: this.now(),
              operationHash: confirmation.operationHash,
              projectId: input.projectId,
              quotaQuote: confirmation.readSet.authorization.quotaQuote,
              revision: graph.revision,
              userId: context.userId,
              workspaceId: context.workspaceId,
            });
          }
          confirmation.usedAt = this.now().toISOString();
          plan.operations.forEach((operation, operationIndex) => {
            state.auditEvents.push(
              auditEvent(
                context,
                input.projectId,
                operationOutcomes[operationIndex] as 'changed' | 'executed',
                this.now(),
                {
                  operationHash: confirmation.operationHash,
                  operationIndex,
                  tool: operation.tool,
                },
              ),
            );
          });
          const outcome = changed ? 'changed' : 'executed';
          const result = { status: outcome, revision: graph.revision };
          if (input.idempotencyKey && idempotencyPayloadHash) {
            saveAgentIntent(
              state,
              'apply',
              input.idempotencyKey,
              idempotencyPayloadHash,
              result,
            );
          }
          return result;
        },
      );
    } catch (error) {
      if (error instanceof CanvasAgentError) {
        await this.repository.appendAudit(
          context.workspaceId,
          auditEvent(context, input.projectId, 'error', this.now(), {
            errorCode: error.code,
          }),
        );
        if (error.code === 'CONFIRMATION_NOT_FOUND') {
          await this.dependencies.accessAudit?.recordAccessDenied({
            actorId: context.userId,
            objectId: error.details?.confirmationId ?? input.credentialId,
            objectKind: 'confirmation',
            projectId: error.details?.projectId ?? input.projectId,
            workspaceId: context.workspaceId,
          });
        }
      }
      throw error;
    }
  }

  private now() {
    return this.dependencies.clock?.() ?? new Date();
  }

  private async resolveReadSet(
    context: CanvasAgentContext,
    graph: CanvasAgentGraph,
    operations: CanvasAgentOperation[],
    operationHash: string,
    maxCostMicros: number,
    maxGenerationCount: number,
    authorizationResolver?: CanvasAgentTransactionContext['resolveAuthorization'],
  ): Promise<CanvasAgentReadSet> {
    const graphReadSet = resolveReadSet(graph, operations);
    const authorization = authorizationResolver
      ? { resolve: authorizationResolver }
      : this.requireAuthorization();
    const tools = [...new Set(operations.map((operation) => operation.tool))].sort();
    const resolved = await authorization.resolve({
      userId: context.userId,
      workspaceId: context.workspaceId,
      projectId: graph.projectId,
      baseRevision: graph.revision,
      operationHash,
      operations: structuredClone(operations),
      tools,
      assetIds: Object.keys(graphReadSet.assetVersions).sort(),
      maxCostMicros,
      maxGenerationCount,
    });
    validateAuthorizationReadSet(resolved, {
      capabilityKeys: authorizationCapabilityKeys(operations),
      operationHash,
      tools,
      assetIds: Object.keys(graphReadSet.assetVersions).sort(),
      maxCostMicros,
      maxGenerationCount,
    });
    return {
      assetVersions: graphReadSet.assetVersions,
      authorization: structuredClone(resolved),
    };
  }

  private async assertConfirmationReadSetCurrent(
    context: CanvasAgentContext,
    input: {
      sessionId: string;
      projectId: string;
      credentialId: string;
      expectedRevision: number;
    },
  ) {
    const confirmation = await this.repository.readConfirmation(
      context.workspaceId,
      input.credentialId,
    );
    if (
      !confirmation ||
      confirmation.userId !== context.userId ||
      confirmation.sessionId !== input.sessionId ||
      confirmation.projectId !== input.projectId
    ) {
      throw new CanvasAgentError(
        'CONFIRMATION_NOT_FOUND',
        'Agent confirmation was not found.',
        { confirmationId: input.credentialId, projectId: input.projectId },
      );
    }
    if (confirmation.usedAt) return;
    const plan = await this.repository.readPlan(
      context.workspaceId,
      confirmation.planId,
    );
    const graph = await this.repository.readGraph(
      context.workspaceId,
      input.projectId,
    );
    if (!plan || !graph) {
      throw new CanvasAgentError(
        'CONFIRMATION_NOT_FOUND',
        'Agent confirmation was not found.',
      );
    }
    assertGenerationDispatchAvailable(
      plan.operations,
      this.dependencies.generationOutbox,
    );
    if (
      graph.revision !== input.expectedRevision ||
      confirmation.baseRevision !== input.expectedRevision
    ) {
      throw new CanvasAgentError(
        'REVISION_CONFLICT',
        'Canvas revision changed after confirmation.',
      );
    }
    await this.assertPlanReadSetCurrent(
      context,
      plan,
      graph,
      confirmation.readSet,
    );
  }

  private requireAuthorization() {
    const authorization = this.dependencies.authorization;
    if (!authorization) {
      throw new CanvasAgentError(
        'AGENT_AUTHORITY_UNAVAILABLE',
        'Canvas Agent authorization is unavailable.',
      );
    }
    return authorization;
  }

  private async assertPlanReadSetCurrent(
    context: CanvasAgentContext,
    plan: AgentPlan,
    graph: CanvasAgentGraph,
    expectedReadSet: CanvasAgentReadSet,
    authorizationResolver?: CanvasAgentTransactionContext['resolveAuthorization'],
  ) {
    let currentReadSet: CanvasAgentReadSet;
    try {
      currentReadSet = await this.resolveReadSet(
        context,
        graph,
        plan.operations,
        plan.operationHash,
        plan.maxCostMicros,
        plan.maxGenerationCount,
        authorizationResolver,
      );
    } catch (error) {
      if (
        error instanceof CanvasAgentError &&
        error.code !== 'AGENT_AUTHORITY_UNAVAILABLE' &&
        error.code !== 'REVISION_CONFLICT'
      ) {
        throw new CanvasAgentError(
          'READ_SET_CHANGED',
          'Canvas dependencies changed after confirmation.',
        );
      }
      throw error;
    }
    if (canonical(currentReadSet) !== canonical(expectedReadSet)) {
      throw new CanvasAgentError(
        'READ_SET_CHANGED',
        'Canvas dependencies changed after confirmation.',
      );
    }
  }
}

function validateAuthorizationReadSet(
  readSet: CanvasAgentAuthorizationReadSet,
  expected: {
    capabilityKeys: string[];
    operationHash: string;
    tools: CanvasAgentOperation['tool'][];
    assetIds: string[];
    maxCostMicros: number;
    maxGenerationCount: number;
  },
) {
  if (!['owner', 'operator', 'reviewer'].includes(readSet.role)) {
    throw new CanvasAgentError('AGENT_ROLE_FORBIDDEN', 'Canvas Agent role is not authorized.');
  }
  requireText(readSet.roleRevision, 'roleRevision');
  if (
    readSet.role === 'reviewer' &&
    expected.tools.some((tool) => tool !== 'read_canvas')
  ) {
    throw new CanvasAgentError(
      'AGENT_ROLE_FORBIDDEN',
      'Canvas Agent role cannot change this project.',
    );
  }
  const capabilityKeys = Object.keys(readSet.operationCapabilityRevisions).sort();
  if (canonical(capabilityKeys) !== canonical(expected.capabilityKeys)) {
    throw new CanvasAgentError(
      'AGENT_CAPABILITY_FORBIDDEN',
      'Canvas Agent operation capability is not authorized.',
    );
  }
  for (const revision of Object.values(readSet.operationCapabilityRevisions)) {
    requireText(revision, 'operationCapabilityRevision');
  }
  const assetGrantKeys = Object.keys(readSet.assetGrantRevisions).sort();
  if (canonical(assetGrantKeys) !== canonical(expected.assetIds)) {
    throw new CanvasAgentError(
      'AGENT_ASSET_FORBIDDEN',
      'Canvas Agent Asset grant is not authorized.',
    );
  }
  for (const revision of Object.values(readSet.assetGrantRevisions)) {
    requireText(revision, 'assetGrantRevision');
  }
  const quote = readSet.quotaQuote;
  if (
    !quote ||
    !quote.id?.trim() ||
    !quote.revision?.trim() ||
    quote.operationHash !== expected.operationHash ||
    quote.maxCostMicros !== expected.maxCostMicros ||
    quote.maxGenerationCount !== expected.maxGenerationCount
  ) {
    throw new CanvasAgentError(
      'AGENT_QUOTA_QUOTE_INVALID',
      'Canvas Agent quota quote does not match the plan.',
    );
  }
}

function replayAgentIntent<Result>(
  state: CanvasAgentWorkspaceState,
  action: 'plan' | 'confirm' | 'apply',
  idempotencyKey: string,
  payloadHash: string,
): Result | null {
  requireText(idempotencyKey, 'idempotencyKey');
  const receipt = (state.idempotencyReceipts ??= []).find(
    (candidate) =>
      candidate.action === action && candidate.idempotencyKey === idempotencyKey,
  );
  if (!receipt) return null;
  if (receipt.payloadHash !== payloadHash) {
    throw new CanvasAgentError(
      'IDEMPOTENCY_CONFLICT',
      'Agent idempotency key was reused with another payload.',
    );
  }
  if (receipt.status === 'pending') {
    throw new CanvasAgentError(
      'IDEMPOTENCY_IN_PROGRESS',
      'Another request with this Agent idempotency key is still in progress.',
    );
  }
  return structuredClone(receipt.result) as Result;
}

function beginAgentIntent<Result>(
  state: CanvasAgentWorkspaceState,
  action: 'plan' | 'confirm' | 'apply',
  idempotencyKey: string,
  payloadHash: string,
  now: Date,
):
  | { status: 'claimed'; claimToken: string }
  | { status: 'replay'; result: Result } {
  requireText(idempotencyKey, 'idempotencyKey');
  const receipts = (state.idempotencyReceipts ??= []);
  const existing = receipts.find(
    (candidate) =>
      candidate.action === action && candidate.idempotencyKey === idempotencyKey,
  );
  if (existing) {
    if (existing.payloadHash !== payloadHash) {
      throw new CanvasAgentError(
        'IDEMPOTENCY_CONFLICT',
        'Agent idempotency key was reused with another payload.',
      );
    }
    if (existing.status === 'pending') {
      const claimedAt = existing.claimedAt
        ? Date.parse(existing.claimedAt)
        : Number.NaN;
      if (
        Number.isFinite(claimedAt) &&
        now.getTime() - claimedAt <= AGENT_IDEMPOTENCY_LEASE_MS
      ) {
        throw new CanvasAgentError(
          'IDEMPOTENCY_IN_PROGRESS',
          'Another request with this Agent idempotency key is still in progress.',
        );
      }
      const claimToken = crypto.randomUUID();
      existing.claimToken = claimToken;
      existing.claimedAt = now.toISOString();
      delete existing.result;
      return { status: 'claimed', claimToken };
    }
    return { status: 'replay', result: structuredClone(existing.result) as Result };
  }
  const claimToken = crypto.randomUUID();
  receipts.push({
    action,
    claimToken,
    claimedAt: now.toISOString(),
    idempotencyKey,
    payloadHash,
    status: 'pending',
  });
  return { status: 'claimed', claimToken };
}

function completeAgentIntent(
  state: CanvasAgentWorkspaceState,
  action: 'plan' | 'confirm' | 'apply',
  idempotencyKey: string,
  payloadHash: string,
  claimToken: string,
  result: unknown,
) {
  const receipt = (state.idempotencyReceipts ?? []).find(
    (candidate) =>
      candidate.action === action && candidate.idempotencyKey === idempotencyKey,
  );
  if (
    !receipt ||
    receipt.payloadHash !== payloadHash ||
    receipt.status !== 'pending' ||
    receipt.claimToken !== claimToken
  ) {
    throw new CanvasAgentError(
      'IDEMPOTENCY_CLAIM_LOST',
      'Agent idempotency claim is no longer active.',
    );
  }
  receipt.status = 'completed';
  delete receipt.claimToken;
  delete receipt.claimedAt;
  receipt.result = structuredClone(result);
}

function abandonAgentIntent(
  state: CanvasAgentWorkspaceState,
  action: 'plan' | 'confirm' | 'apply',
  idempotencyKey: string,
  payloadHash: string,
  claimToken: string,
) {
  state.idempotencyReceipts = (state.idempotencyReceipts ?? []).filter(
    (candidate) =>
      candidate.action !== action ||
      candidate.idempotencyKey !== idempotencyKey ||
      candidate.payloadHash !== payloadHash ||
      candidate.status !== 'pending' ||
      candidate.claimToken !== claimToken,
  );
}

function agentIntentPayloadHash(
  context: CanvasAgentContext,
  input: unknown,
) {
  return digest(
    canonical({
      input,
      userId: context.userId,
      workspaceId: context.workspaceId,
    }),
  );
}

function saveAgentIntent(
  state: CanvasAgentWorkspaceState,
  action: 'plan' | 'confirm' | 'apply',
  idempotencyKey: string,
  payloadHash: string,
  result: unknown,
) {
  (state.idempotencyReceipts ??= []).push({
    action,
    idempotencyKey,
    payloadHash,
    status: 'completed',
    result: structuredClone(result),
  });
}

function validateOperations(operations: CanvasAgentOperation[]) {
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new CanvasAgentError('AGENT_PLAN_EMPTY', 'Agent plan is empty.');
  }
  const allowed = new Set([
    'read_canvas',
    'create_node',
    'update_node',
    'delete_node',
    'connect_nodes',
    'disconnect_nodes',
    'run_generation',
  ]);
  for (const operation of operations) {
    if (!operation || !allowed.has(operation.tool)) {
      throw new CanvasAgentError(
        'AGENT_TOOL_FORBIDDEN',
        'Agent proposed a tool outside the server allowlist.',
      );
    }
    switch (operation.tool) {
      case 'read_canvas':
        break;
      case 'create_node':
        validateNode(operation.node);
        break;
      case 'update_node':
        requireText(operation.nodeId, 'nodeId');
        requireRecord(operation.patch, 'patch');
        break;
      case 'delete_node':
        requireText(operation.nodeId, 'nodeId');
        break;
      case 'connect_nodes':
      case 'disconnect_nodes':
        requireText(operation.from, 'from');
        requireText(operation.to, 'to');
        break;
      case 'run_generation':
        if (
          ![
            'image.generate',
            'image.edit',
            'text.respond',
            'video.generate',
            'audio.speech',
            'audio.sfx',
          ].includes(operation.operation)
        ) {
          throw new CanvasAgentError(
            'GENERATION_OPERATION_FORBIDDEN',
            'Agent proposed an unknown generation operation.',
          );
        }
        requireText(operation.prompt, 'prompt');
        validateGenerationInputAssets(operation.inputAssets);
        break;
    }
  }
}

function assertGenerationDispatchAvailable(
  operations: CanvasAgentOperation[],
  outbox:
    | {
        revisions: Partial<Record<CanvasAgentGenerationOperation, string>>;
      }
    | undefined,
) {
  const unavailable = operations.some(
    (operation) =>
      operation.tool === 'run_generation' &&
      !outbox?.revisions[operation.operation]?.trim(),
  );
  if (unavailable) {
    throw new CanvasAgentError(
      'AGENT_GENERATION_UNAVAILABLE',
      'Canvas Agent generation is unavailable until canonical quote and submit dispatch are configured.',
    );
  }
}

function applyOperations(
  graph: CanvasAgentGraph,
  operations: CanvasAgentOperation[],
) {
  let changed = false;
  for (const operation of operations) {
    changed = applyOperation(graph, operation) || changed;
  }
  return changed;
}

function applyOperation(
  graph: CanvasAgentGraph,
  operation: CanvasAgentOperation,
) {
  switch (operation.tool) {
      case 'read_canvas':
        return false;
      case 'create_node':
        if (graph.nodes.some((node) => node.id === operation.node.id)) {
          throw new CanvasAgentError('NODE_ALREADY_EXISTS', 'Canvas node already exists.');
        }
        graph.nodes.push(structuredClone(operation.node));
        return true;
      case 'update_node': {
        const node = requireNode(graph, operation.nodeId);
        node.data = { ...node.data, ...structuredClone(operation.patch) };
        return true;
      }
      case 'delete_node':
        requireNode(graph, operation.nodeId);
        graph.nodes = graph.nodes.filter((node) => node.id !== operation.nodeId);
        graph.edges = graph.edges.filter(
          (edge) => edge.from !== operation.nodeId && edge.to !== operation.nodeId,
        );
        return true;
      case 'connect_nodes':
        requireNode(graph, operation.from);
        requireNode(graph, operation.to);
        if (
          !graph.edges.some(
            (edge) => edge.from === operation.from && edge.to === operation.to,
          )
        ) {
          graph.edges.push({
            id: `edge-${digest(`${operation.from}:${operation.to}`).slice(0, 20)}`,
            from: operation.from,
            to: operation.to,
          });
          return true;
        }
        return false;
      case 'disconnect_nodes': {
        const before = graph.edges.length;
        graph.edges = graph.edges.filter(
          (edge) => edge.from !== operation.from || edge.to !== operation.to,
        );
        if (before === graph.edges.length) {
          throw new CanvasAgentError('EDGE_NOT_FOUND', 'Canvas edge was not found.');
        }
        return true;
      }
      case 'run_generation':
        return false;
  }
}

function enqueueGenerationOperations(
  state: CanvasAgentWorkspaceState,
  input: {
    assetGrantRevisions: Record<string, string>;
    assetVersions: Record<string, string>;
    capabilityRevisions: Record<string, string>;
    dispatchRevisions: Partial<Record<CanvasAgentGenerationOperation, string>>;
    generationOperations: Array<
      Extract<CanvasAgentOperation, { tool: 'run_generation' }>
    >;
    maxCostMicros: number;
    maxGenerationCount: number;
    now: Date;
    operationHash: string;
    projectId: string;
    quotaQuote: CanvasAgentAuthorizationReadSet['quotaQuote'];
    revision: number;
    userId: string;
    workspaceId: string;
  },
) {
  const revisionId = canvasAgentRevisionId({
    operationHash: input.operationHash,
    projectId: input.projectId,
    revision: input.revision,
    workspaceId: input.workspaceId,
  });
  const batchId = `agent-generation-batch-${digest(
    `${input.workspaceId}:${input.projectId}:${revisionId}:${input.operationHash}`,
  ).slice(0, 32)}`;
  const batches = (state.generationBatches ??= []);
  if (!batches.some((batch) => batch.id === batchId)) {
    batches.push({
      id: batchId,
      maxCostMicros: input.maxCostMicros,
      maxGenerationCount: input.maxGenerationCount,
      reservations: [],
    });
  }
  input.generationOperations.forEach((operation, index) => {
    const capabilityRevision =
      input.capabilityRevisions[generationCapabilityKey(operation.operation)];
    const dispatchRevision = input.dispatchRevisions[operation.operation];
    if (!capabilityRevision?.trim() || !dispatchRevision?.trim()) {
      throw new CanvasAgentError(
        'AGENT_GENERATION_UNAVAILABLE',
        'Canvas Agent generation revisions are unavailable.',
      );
    }
    const idempotencyKey = `agent-generation-${digest(
      `${input.operationHash}:${index}`,
    ).slice(0, 32)}`;
    const id = `agent-outbox-${digest(
      `${input.workspaceId}:${input.projectId}:${idempotencyKey}`,
    ).slice(0, 32)}`;
    if (state.outbox.some((item) => item.id === id)) return;
    state.outbox.push({
      attemptCount: 0,
      attemptEvents: [],
      assetGrantRevisions: structuredClone(input.assetGrantRevisions),
      assetVersions: structuredClone(input.assetVersions),
      availableAt: input.now.toISOString(),
      batchId,
      createdAt: input.now.toISOString(),
      dispatchRevision,
      id,
      idempotencyKey,
      inputAssets: structuredClone(operation.inputAssets),
      capabilityRevision,
      operation: operation.operation,
      projectId: input.projectId,
      prompt: operation.prompt,
      quotaQuote: {
        id: input.quotaQuote.id,
        revision: input.quotaQuote.revision,
      },
      revisionId,
      status: 'pending',
      userId: input.userId,
      workspaceId: input.workspaceId,
    });
  });
}

export function canvasAgentRevisionId(input: {
  operationHash: string;
  projectId: string;
  revision: number;
  workspaceId: string;
}) {
  return `agent-revision-${digest(canonical(input)).slice(0, 32)}`;
}

function resolveReadSet(
  graph: CanvasAgentGraph,
  operations: CanvasAgentOperation[],
) {
  const assetIds = new Set<string>();
  for (const operation of operations) {
    if (operation.tool === 'create_node') collectAssetIds(operation.node.data, assetIds);
    if (operation.tool === 'update_node') collectAssetIds(operation.patch, assetIds);
    if (operation.tool === 'run_generation') {
      for (const asset of operation.inputAssets) assetIds.add(asset.assetId);
    }
    if (
      operation.tool === 'update_node' ||
      operation.tool === 'delete_node'
    ) {
      const node = graph.nodes.find((candidate) => candidate.id === operation.nodeId);
      if (node) collectAssetIds(node.data, assetIds);
    }
  }
  for (const assetId of assetIds) {
    if (!graph.assetVersions[assetId]) {
      throw new CanvasAgentError(
        'ASSET_NOT_FOUND',
        'Agent plan references an Asset outside the current workspace.',
      );
    }
  }
  return {
    assetVersions: Object.fromEntries(
      [...assetIds]
        .sort()
        .map((assetId) => [assetId, graph.assetVersions[assetId] as string]),
    ),
  };
}

function authorizationCapabilityKeys(operations: CanvasAgentOperation[]) {
  return [
    ...new Set(
      operations.map((operation) =>
        operation.tool === 'run_generation'
          ? generationCapabilityKey(operation.operation)
          : operation.tool,
      ),
    ),
  ].sort();
}

function generationCapabilityKey(operation: CanvasAgentGenerationOperation) {
  return `run_generation:${operation}`;
}

function validateGenerationInputAssets(value: unknown) {
  if (!Array.isArray(value)) {
    throw new CanvasAgentError(
      'GENERATION_INPUT_ASSET_INVALID',
      'Agent generation inputAssets must be an array.',
    );
  }
  const roles = new Set([
    'reference_image',
    'reference_video',
    'reference_audio',
    'mask',
  ]);
  const identities = new Set<string>();
  let maskCount = 0;
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new CanvasAgentError(
        'GENERATION_INPUT_ASSET_INVALID',
        'Agent generation input Asset is invalid.',
      );
    }
    const asset = candidate as Record<string, unknown>;
    const keys = Object.keys(asset).sort();
    const identity = `${asset.role}:${asset.assetId}`;
    if (
      canonical(keys) !== canonical(['assetId', 'role']) ||
      typeof asset.assetId !== 'string' ||
      !asset.assetId.trim() ||
      typeof asset.role !== 'string' ||
      !roles.has(asset.role) ||
      identities.has(identity)
    ) {
      throw new CanvasAgentError(
        'GENERATION_INPUT_ASSET_INVALID',
        'Agent generation input Asset role is invalid.',
      );
    }
    identities.add(identity);
    if (asset.role === 'mask') maskCount += 1;
  }
  if (maskCount > 1) {
    throw new CanvasAgentError(
      'GENERATION_INPUT_ASSET_INVALID',
      'Agent generation accepts at most one mask Asset.',
    );
  }
}

function collectAssetIds(value: unknown, target: Set<string>) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const nested of value) collectAssetIds(nested, target);
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (key === 'assetId' && typeof nested === 'string') target.add(nested);
    else collectAssetIds(nested, target);
  }
}

function operationSummary(operation: CanvasAgentOperation) {
  switch (operation.tool) {
    case 'read_canvas':
      return '读取当前画布';
    case 'create_node':
      return `新增 ${operation.node.kind} 节点 ${operation.node.id}`;
    case 'update_node':
      return `修改节点 ${operation.nodeId}`;
    case 'delete_node':
      return `删除节点 ${operation.nodeId}`;
    case 'connect_nodes':
      return `连接 ${operation.from} → ${operation.to}`;
    case 'disconnect_nodes':
      return `断开 ${operation.from} → ${operation.to}`;
    case 'run_generation':
      return `发起 ${operation.operation}`;
  }
}

function planOperationHash(
  operations: CanvasAgentOperation[],
  diff: AgentPlanDiff[],
  affectedAssetIds: string[],
) {
  return digest(canonical({ affectedAssetIds, diff, operations }));
}

function resolveOperationDiffs(
  graph: CanvasAgentGraph,
  operations: CanvasAgentOperation[],
) {
  const preview = structuredClone(graph);
  const diffs: AgentPlanDiff[] = [];
  for (const operation of operations) {
    const before = operationState(preview, operation);
    applyOperations(preview, [operation]);
    diffs.push({
      after: operationState(preview, operation),
      before,
      summary: operationSummary(operation),
      tool: operation.tool,
    });
  }
  return diffs;
}

function operationState(
  graph: CanvasAgentGraph,
  operation: CanvasAgentOperation,
): unknown {
  switch (operation.tool) {
    case 'read_canvas':
      return null;
    case 'create_node':
      return cloneOrNull(
        graph.nodes.find((node) => node.id === operation.node.id),
      );
    case 'update_node':
      return cloneOrNull(
        graph.nodes.find((node) => node.id === operation.nodeId),
      );
    case 'delete_node': {
      const node = graph.nodes.find((candidate) => candidate.id === operation.nodeId);
      if (!node) return null;
      return {
        edges: graph.edges
          .filter(
            (edge) => edge.from === operation.nodeId || edge.to === operation.nodeId,
          )
          .map((edge) => structuredClone(edge)),
        node: structuredClone(node),
      };
    }
    case 'connect_nodes':
    case 'disconnect_nodes':
      return cloneOrNull(
        graph.edges.find(
          (edge) => edge.from === operation.from && edge.to === operation.to,
        ),
      );
    case 'run_generation':
      return null;
  }
}

function cloneOrNull<Value>(value: Value | undefined) {
  return value === undefined ? null : structuredClone(value);
}

function validateNode(node: CanvasNode) {
  if (!node || !['text', 'image', 'video', 'audio', 'config'].includes(node.kind)) {
    throw new CanvasAgentError('NODE_INVALID', 'Canvas node kind is invalid.');
  }
  requireText(node.id, 'node.id');
  requireRecord(node.data, 'node.data');
}

function requireNode(graph: CanvasAgentGraph, nodeId: string) {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new CanvasAgentError('NODE_NOT_FOUND', 'Canvas node was not found.');
  return node;
}

function requireText(value: string, field: string) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new CanvasAgentError('INPUT_INVALID', `${field} is required.`);
  }
}

function requireLimit(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CanvasAgentError('INPUT_INVALID', `${field} is invalid.`);
  }
}

function requireRecord(value: unknown, field: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CanvasAgentError('INPUT_INVALID', `${field} must be an object.`);
  }
}

function auditEvent(
  context: CanvasAgentContext,
  projectId: string,
  outcome: AgentAuditEvent['outcome'],
  now: Date,
  details: Pick<
    AgentAuditEvent,
    'operationHash' | 'errorCode' | 'operationIndex' | 'tool'
  >,
): AgentAuditEvent {
  return {
    id: `agent-audit-${digest(
      canonical({
        workspaceId: context.workspaceId,
        projectId,
        correlationId: context.correlationId,
        outcome,
        ...details,
      }),
    ).slice(0, 24)}`,
    workspaceId: context.workspaceId,
    userId: context.userId,
    projectId,
    correlationId: context.correlationId,
    outcome,
    ...details,
    createdAt: now.toISOString(),
  };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
