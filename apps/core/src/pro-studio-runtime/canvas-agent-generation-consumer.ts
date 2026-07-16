import { randomUUID } from 'node:crypto';

import type {
  AgentGenerationAttemptEvent,
  AgentGenerationOutboxItem,
  CanvasAgentContext,
  CanvasAgentRepository,
} from './canvas-agent.js';

const DEFAULT_CLAIM_LEASE_MS = 60_000;

export interface CanvasAgentCanonicalGenerationInput {
  capabilityRevision: string;
  dispatchRevision: string;
  idempotencyKey: string;
  inputAssets: AgentGenerationOutboxItem['inputAssets'];
  localJobId: string;
  operation: AgentGenerationOutboxItem['operation'];
  projectId: string;
  prompt: string;
  quotaQuote: AgentGenerationOutboxItem['quotaQuote'];
  revisionId: string;
}

export interface CanvasAgentCanonicalGenerationQuote {
  capabilityRevision: string;
  costMicros: number;
  dispatchRevision: string;
  generationCount: number;
  quoteId: string;
  quotaQuoteId: string;
  quotaQuoteRevision: string;
}

export interface CanvasAgentGenerationReadSetValidationInput {
  assetGrantRevisions: Record<string, string>;
  assetVersions: Record<string, string>;
  inputAssets: AgentGenerationOutboxItem['inputAssets'];
  projectId: string;
}

export interface CanvasAgentGenerationReadSetValidationResult {
  assetGrantRevisions: Record<string, string>;
  assetVersions: Record<string, string>;
}

export class CanonicalGenerationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly options: { retryable: boolean },
  ) {
    super(message);
  }
}

export interface CanvasAgentCanonicalGenerationPort {
  validateReadSet(
    context: CanvasAgentContext,
    input: CanvasAgentGenerationReadSetValidationInput,
  ): Promise<CanvasAgentGenerationReadSetValidationResult>;
  quote(
    context: CanvasAgentContext,
    input: CanvasAgentCanonicalGenerationInput,
  ): Promise<CanvasAgentCanonicalGenerationQuote>;
  submit(
    context: CanvasAgentContext,
    input: CanvasAgentCanonicalGenerationInput & { quoteId: string },
  ): Promise<{ jobId: string }>;
}

export class CanvasAgentGenerationConsumerError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class CanvasAgentGenerationConsumer {
  private readonly claimLeaseMs: number;
  private readonly claimToken: () => string;
  private readonly clock: () => Date;
  private readonly maxAttempts: number;
  private readonly retryDelayMs: number;

  constructor(
    private readonly repository: CanvasAgentRepository,
    private readonly generation: CanvasAgentCanonicalGenerationPort,
    options: {
      claimLeaseMs?: number;
      claimToken?: () => string;
      clock?: () => Date;
      maxAttempts?: number;
      retryDelayMs?: number;
    } = {},
  ) {
    this.claimLeaseMs = options.claimLeaseMs ?? DEFAULT_CLAIM_LEASE_MS;
    this.claimToken = options.claimToken ?? randomUUID;
    this.clock = options.clock ?? (() => new Date());
    this.maxAttempts = options.maxAttempts ?? 3;
    this.retryDelayMs = options.retryDelayMs ?? 5_000;
  }

  async runOnce(workspaceId: string) {
    requireText(workspaceId, 'workspaceId');
    const claim = await this.claimNext(workspaceId);
    if (!claim) return { status: 'idle' as const };

    try {
      validateOutboxFacts(claim.item, workspaceId);
      const context = {
        correlationId: `agent-generation:${claim.item.id}`,
        userId: requireText(claim.item.userId, 'userId'),
        workspaceId,
      };
      const currentReadSet = await this.generation.validateReadSet(context, {
        assetGrantRevisions: structuredClone(claim.item.assetGrantRevisions),
        assetVersions: structuredClone(claim.item.assetVersions),
        inputAssets: structuredClone(claim.item.inputAssets),
        projectId: claim.item.projectId,
      });
      assertAssetReadSetCurrent(claim.item, currentReadSet);
      const input: CanvasAgentCanonicalGenerationInput = {
        capabilityRevision: claim.item.capabilityRevision,
        dispatchRevision: claim.item.dispatchRevision,
        idempotencyKey: claim.item.idempotencyKey,
        inputAssets: structuredClone(claim.item.inputAssets),
        localJobId: claim.item.idempotencyKey,
        operation: claim.item.operation,
        projectId: claim.item.projectId,
        prompt: claim.item.prompt,
        quotaQuote: structuredClone(claim.item.quotaQuote),
        revisionId: claim.item.revisionId,
      };
      const quote = await this.generation.quote(context, input);
      assertQuoteAuthority(claim.item, quote);
      await this.reserveBatchBudget(
        workspaceId,
        claim.item.id,
        claim.token,
        quote,
      );
      const job = await this.generation.submit(context, {
        ...input,
        quoteId: quote.quoteId,
      });
      requireText(job.jobId, 'jobId');
      await this.complete(workspaceId, claim.item.id, claim.token, job.jobId);
      return {
        canonicalJobId: job.jobId,
        outboxId: claim.item.id,
        status: 'submitted' as const,
      };
    } catch (error) {
      if (error instanceof CanonicalGenerationError) {
        if (error.options.retryable && claim.item.attemptCount < this.maxAttempts) {
          await this.scheduleRetry(
            workspaceId,
            claim.item.id,
            claim.token,
            claim.item.attemptCount,
            error.code,
          );
        } else {
          await this.fail(
            workspaceId,
            claim.item.id,
            claim.token,
            error.code,
            error.options.retryable,
          );
        }
      } else if (
        error instanceof CanvasAgentGenerationConsumerError &&
        error.code !== 'AGENT_GENERATION_CLAIM_LOST'
      ) {
        await this.fail(
          workspaceId,
          claim.item.id,
          claim.token,
          error.code,
          false,
        );
      } else if (!(error instanceof CanvasAgentGenerationConsumerError)) {
        await this.fail(
          workspaceId,
          claim.item.id,
          claim.token,
          'AGENT_GENERATION_UNCLASSIFIED_FAILURE',
          false,
        );
      }
      throw error;
    }
  }

  private claimNext(workspaceId: string) {
    const now = this.clock();
    const token = this.claimToken();
    return this.repository.transact(workspaceId, (state) => {
      const item = state.outbox.find((candidate) => {
        if (candidate.status === 'pending') return true;
        if (candidate.status === 'retry') {
          const availableAt = Date.parse(candidate.availableAt);
          return Number.isFinite(availableAt) && availableAt <= now.getTime();
        }
        if (candidate.status !== 'claimed' || !candidate.claimedAt) return false;
        const claimedAt = Date.parse(candidate.claimedAt);
        return (
          Number.isFinite(claimedAt) &&
          now.getTime() - claimedAt > this.claimLeaseMs
        );
      });
      if (!item) return null;
      if (item.status === 'claimed' && item.claimedAt) {
        appendAttemptEvent(item, {
          attemptNo: item.attemptCount,
          backoffMs: 0,
          errorCode: 'AGENT_GENERATION_CLAIM_EXPIRED',
          maxAttempts: this.maxAttempts,
          outcome: 'retry',
          retryable: true,
          startedAt: item.claimedAt,
        });
      }
      item.status = 'claimed';
      item.attemptCount = (item.attemptCount ?? 0) + 1;
      item.claimToken = token;
      item.claimedAt = now.toISOString();
      return { item: structuredClone(item), token };
    });
  }

  private complete(
    workspaceId: string,
    id: string,
    claimToken: string,
    canonicalJobId: string,
  ) {
    return this.repository.transact(workspaceId, (state) => {
      const item = state.outbox.find((candidate) => candidate.id === id);
      if (
        !item ||
        item.status !== 'claimed' ||
        item.claimToken !== claimToken
      ) {
        throw new CanvasAgentGenerationConsumerError(
          'AGENT_GENERATION_CLAIM_LOST',
          'Agent generation claim is no longer active.',
        );
      }
      item.status = 'submitted';
      item.canonicalJobId = canonicalJobId;
      appendAttemptEvent(item, {
        attemptNo: item.attemptCount,
        backoffMs: 0,
        maxAttempts: this.maxAttempts,
        outcome: 'submitted',
        retryable: false,
        startedAt: requireText(item.claimedAt, 'claimedAt'),
      });
      delete item.claimToken;
      delete item.claimedAt;
      delete item.lastErrorCode;
    });
  }

  private reserveBatchBudget(
    workspaceId: string,
    id: string,
    claimToken: string,
    quote: CanvasAgentCanonicalGenerationQuote,
  ) {
    return this.repository.transact(workspaceId, (state) => {
      const item = state.outbox.find((candidate) => candidate.id === id);
      if (
        !item ||
        item.status !== 'claimed' ||
        item.claimToken !== claimToken
      ) {
        throw new CanvasAgentGenerationConsumerError(
          'AGENT_GENERATION_CLAIM_LOST',
          'Agent generation claim is no longer active.',
        );
      }
      const batch = (state.generationBatches ?? []).find(
        (candidate) => candidate.id === item.batchId,
      );
      if (!batch) {
        throw new CanvasAgentGenerationConsumerError(
          'AGENT_GENERATION_BATCH_MISSING',
          'Agent generation batch budget was not found.',
        );
      }
      const existing = batch.reservations.find(
        (reservation) => reservation.outboxId === id,
      );
      if (existing) {
        if (
          existing.quoteId !== quote.quoteId ||
          existing.costMicros !== quote.costMicros ||
          existing.generationCount !== quote.generationCount
        ) {
          throw new CanvasAgentGenerationConsumerError(
            'AGENT_GENERATION_QUOTE_CHANGED',
            'Canonical generation quote changed during retry.',
          );
        }
        return;
      }
      const reservedCost = batch.reservations.reduce(
        (total, reservation) => total + reservation.costMicros,
        0,
      );
      const reservedCount = batch.reservations.reduce(
        (total, reservation) => total + reservation.generationCount,
        0,
      );
      if (
        reservedCost + quote.costMicros > batch.maxCostMicros ||
        reservedCount + quote.generationCount > batch.maxGenerationCount
      ) {
        throw new CanvasAgentGenerationConsumerError(
          'AGENT_GENERATION_BATCH_LIMIT_EXCEEDED',
          'Canonical generation quote exceeds the shared Agent batch budget.',
        );
      }
      batch.reservations.push({
        costMicros: quote.costMicros,
        generationCount: quote.generationCount,
        outboxId: id,
        quoteId: quote.quoteId,
      });
    });
  }

  private fail(
    workspaceId: string,
    id: string,
    claimToken: string,
    errorCode: string,
    retryable: boolean,
  ) {
    return this.repository.transact(workspaceId, (state) => {
      const item = state.outbox.find((candidate) => candidate.id === id);
      if (
        !item ||
        item.status !== 'claimed' ||
        item.claimToken !== claimToken
      ) {
        return;
      }
      item.status = 'failed';
      item.failureCode = errorCode;
      item.lastErrorCode = errorCode;
      appendAttemptEvent(item, {
        attemptNo: item.attemptCount,
        backoffMs: 0,
        errorCode,
        maxAttempts: this.maxAttempts,
        outcome: 'failed',
        retryable,
        startedAt: requireText(item.claimedAt, 'claimedAt'),
      });
      delete item.claimToken;
      delete item.claimedAt;
      if (!state.auditEvents.some((event) => event.id === `agent-generation-audit-${id}`)) {
        state.auditEvents.push({
          correlationId: `agent-generation:${id}`,
          createdAt: this.clock().toISOString(),
          errorCode,
          id: `agent-generation-audit-${id}`,
          outcome: 'error',
          projectId: item.projectId,
          userId: item.userId,
          workspaceId,
        });
      }
    });
  }

  private scheduleRetry(
    workspaceId: string,
    id: string,
    claimToken: string,
    attemptCount: number,
    errorCode: string,
  ) {
    return this.repository.transact(workspaceId, (state) => {
      const item = state.outbox.find((candidate) => candidate.id === id);
      if (
        !item ||
        item.status !== 'claimed' ||
        item.claimToken !== claimToken
      ) {
        return;
      }
      item.status = 'retry';
      const backoffMs =
        this.retryDelayMs * 2 ** Math.max(0, attemptCount - 1);
      item.availableAt = new Date(
        this.clock().getTime() + backoffMs,
      ).toISOString();
      item.lastErrorCode = errorCode;
      appendAttemptEvent(item, {
        attemptNo: item.attemptCount,
        backoffMs,
        errorCode,
        maxAttempts: this.maxAttempts,
        outcome: 'retry',
        retryable: true,
        startedAt: requireText(item.claimedAt, 'claimedAt'),
      });
      delete item.claimToken;
      delete item.claimedAt;
    });
  }
}

function validateOutboxFacts(
  item: AgentGenerationOutboxItem,
  workspaceId: string,
) {
  if (item.workspaceId !== workspaceId) {
    throw new CanvasAgentGenerationConsumerError(
      'AGENT_GENERATION_CONTEXT_INVALID',
      'Agent generation outbox workspace does not match its partition.',
    );
  }
  requireText(item.dispatchRevision, 'dispatchRevision');
  requireText(item.id, 'id');
  requireText(item.idempotencyKey, 'idempotencyKey');
  requireText(item.projectId, 'projectId');
  requireText(item.prompt, 'prompt');
  requireText(item.revisionId, 'revisionId');
  requireText(item.batchId, 'batchId');
  requireText(item.capabilityRevision, 'capabilityRevision');
  requireText(item.quotaQuote?.id, 'quotaQuote.id');
  requireText(item.quotaQuote?.revision, 'quotaQuote.revision');
  if (
    !Number.isSafeInteger(item.attemptCount) ||
    item.attemptCount <= 0 ||
    Number.isNaN(Date.parse(item.availableAt))
  ) {
    throw new CanvasAgentGenerationConsumerError(
      'AGENT_GENERATION_LIMIT_INVALID',
      'Agent generation attempt facts are invalid.',
    );
  }
  if (!Array.isArray(item.inputAssets)) {
    throw new CanvasAgentGenerationConsumerError(
      'AGENT_GENERATION_INPUT_ROLE_MISSING',
      'Agent generation input Assets require confirmed roles.',
    );
  }
  if (!Array.isArray(item.attemptEvents)) {
    throw new CanvasAgentGenerationConsumerError(
      'AGENT_GENERATION_ATTEMPT_HISTORY_INVALID',
      'Agent generation attempt history is invalid.',
    );
  }
  const allowedRoles = new Set([
    'reference_image',
    'reference_video',
    'reference_audio',
    'mask',
  ]);
  const identities = new Set<string>();
  for (const asset of item.inputAssets) {
    const identity = `${asset?.role}:${asset?.assetId}`;
    if (
      !asset ||
      typeof asset.assetId !== 'string' ||
      !asset.assetId.trim() ||
      !allowedRoles.has(asset.role) ||
      identities.has(identity)
    ) {
      throw new CanvasAgentGenerationConsumerError(
        'AGENT_GENERATION_INPUT_ROLE_INVALID',
        'Agent generation input Asset roles are invalid.',
      );
    }
    identities.add(identity);
  }
  const assetIds = [...new Set(item.inputAssets.map((asset) => asset.assetId))].sort();
  validateFrozenRevisionMap(item.assetVersions, assetIds, 'assetVersions');
  validateFrozenRevisionMap(
    item.assetGrantRevisions,
    assetIds,
    'assetGrantRevisions',
  );
}

function assertAssetReadSetCurrent(
  item: AgentGenerationOutboxItem,
  current: CanvasAgentGenerationReadSetValidationResult,
) {
  if (
    !sameRevisionMap(current?.assetVersions, item.assetVersions) ||
    !sameRevisionMap(
      current?.assetGrantRevisions,
      item.assetGrantRevisions,
    )
  ) {
    throw new CanvasAgentGenerationConsumerError(
      'AGENT_GENERATION_ASSET_READ_SET_CHANGED',
      'Generation Asset authority changed after Agent confirmation.',
    );
  }
}

function validateFrozenRevisionMap(
  revisions: Record<string, string> | undefined,
  assetIds: string[],
  field: string,
) {
  if (
    !revisions ||
    Array.isArray(revisions) ||
    Object.keys(revisions).sort().join('\u0000') !== assetIds.join('\u0000') ||
    Object.values(revisions).some(
      (revision) => typeof revision !== 'string' || !revision.trim(),
    )
  ) {
    throw new CanvasAgentGenerationConsumerError(
      'AGENT_GENERATION_ASSET_READ_SET_INVALID',
      `Agent generation ${field} is invalid.`,
    );
  }
}

function sameRevisionMap(
  current: Record<string, string> | undefined,
  frozen: Record<string, string>,
) {
  if (!current || Array.isArray(current)) return false;
  const currentEntries = Object.entries(current).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const frozenEntries = Object.entries(frozen).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return JSON.stringify(currentEntries) === JSON.stringify(frozenEntries);
}

function appendAttemptEvent(
  item: AgentGenerationOutboxItem,
  event: AgentGenerationAttemptEvent,
) {
  const events = (item.attemptEvents ??= []);
  if (events.some((candidate) => candidate.attemptNo === event.attemptNo)) {
    throw new CanvasAgentGenerationConsumerError(
      'AGENT_GENERATION_ATTEMPT_HISTORY_INVALID',
      'Agent generation attempt already has a terminal event.',
    );
  }
  events.push(structuredClone(event));
}

function assertQuoteAuthority(
  item: AgentGenerationOutboxItem,
  quote: CanvasAgentCanonicalGenerationQuote,
) {
  if (
    quote.capabilityRevision !== item.capabilityRevision ||
    quote.dispatchRevision !== item.dispatchRevision ||
    quote.quotaQuoteId !== item.quotaQuote.id ||
    quote.quotaQuoteRevision !== item.quotaQuote.revision
  ) {
    throw new CanvasAgentGenerationConsumerError(
      'AGENT_GENERATION_REVISION_CHANGED',
      'Canonical generation authority changed after Agent confirmation.',
    );
  }
  if (
    !quote.quoteId?.trim() ||
    !Number.isSafeInteger(quote.costMicros) ||
    quote.costMicros < 0 ||
    !Number.isSafeInteger(quote.generationCount) ||
    quote.generationCount <= 0
  ) {
    throw new CanvasAgentGenerationConsumerError(
      'AGENT_GENERATION_QUOTE_INVALID',
      'Canonical generation quote is invalid.',
    );
  }
}

function requireText(value: string | undefined, field: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new CanvasAgentGenerationConsumerError(
      'AGENT_GENERATION_CONTEXT_INVALID',
      `${field} is required for Agent generation.`,
    );
  }
  return value;
}
