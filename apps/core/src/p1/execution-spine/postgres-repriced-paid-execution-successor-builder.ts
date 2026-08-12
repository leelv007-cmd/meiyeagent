import type { BuildProductQuoteInput, ProductQuoteSnapshot } from '@meiye/contracts';
import type { Pool, PoolClient } from 'pg';

import type { PostgresMarketingPlanStore } from '../agent-session/postgres-plan-store.js';
import type { PlanCompiler } from '../agent-session/plan-compiler.js';
import { P1DomainError } from '../foundation/domain.js';
import type { ExecutionPlanCompileFreeze } from '../harness/execution-plan-admission.js';
import { createAuthoritativeFactHeadResolver } from '../harness/execution-plan-live-facts.js';
import type { HarnessWorkflowInput } from '../harness/task-admission.js';
import type { MarketingIdentityRepository } from '../operations/marketing-identity.js';
import type { StoreFactLedger } from '../operations/store-fact-ledger.js';
import { DurableProductBillingService } from '../product-billing/durable-service.js';
import { PostgresProductBillingRepository } from '../product-billing/postgres-repository.js';

import type {
  CreationSubmissionRecord,
  RepricedPaidExecutionSuccessorRequest,
} from './submission-coordinator.js';

/**
 * Server-only rebuild of a price-drift successor. Its sole quote source is
 * the current ProductQuote row locked by the caller's PostgreSQL transaction;
 * it never accepts plan, quote, credit, or reservation facts from a browser.
 */
export interface RepricedPaidExecutionSuccessorBuilder {
  rebuildInTransaction(input: {
    client: PoolClient;
    workspaceId: string;
    source: CreationSubmissionRecord;
    sourceRequest: HarnessWorkflowInput;
    successor: {
      taskId: string;
      createdAt: string;
    };
    staleFence: RepricedPaidExecutionSuccessorRequest['staleFence'];
  }): Promise<{
    quote: ProductQuoteSnapshot;
    freeze: ExecutionPlanCompileFreeze;
    /**
     * Fact/context heads the successor freeze is baselined on. When the stale
     * fence carried `contextDrifted` these are re-read and verified inside the
     * caller's transaction (V31-63); otherwise they equal the predecessor's
     * still-current frozen refs.
     */
    factRevisionRefs: readonly string[];
  }>;
}

/**
 * Transaction-aware current context-head sources for the V31-63 rebuild.
 * `facts` must pin the workspace's fact heads on the successor transaction so
 * no fact revision can commit before the successor does. `identities` reads
 * the committed identity state; a change that lands after this read is caught
 * by the successor's own admission fence on its next start.
 */
export interface RepricedSuccessorContextHeadSources {
  facts: {
    pinWorkspaceFactHeadsInTransaction(
      client: PoolClient,
      workspaceId: string,
    ): Promise<Pick<StoreFactLedger, 'history' | 'listActive'>>;
  };
  identities?: Pick<MarketingIdentityRepository, 'listActive'>;
}

/**
 * The production authority seam used by the creation-submission transaction.
 * ProductQuote and MarketingPlan remain their own authoritative domains, but
 * their mutations run on the exact client supplied by the successor writer.
 */
export class PostgresRepricedPaidExecutionSuccessorBuilder
  implements RepricedPaidExecutionSuccessorBuilder
{
  constructor(
    private readonly pool: Pool,
    private readonly plans: PostgresMarketingPlanStore,
    private readonly compiler: Pick<PlanCompiler, 'refreshLiveBindingsInTransaction'>,
    private readonly contextHeads?: RepricedSuccessorContextHeadSources,
  ) {}

  async rebuildInTransaction(input: {
    client: PoolClient;
    workspaceId: string;
    source: CreationSubmissionRecord;
    sourceRequest: HarnessWorkflowInput;
    successor: { taskId: string; createdAt: string };
    staleFence: RepricedPaidExecutionSuccessorRequest['staleFence'];
  }): Promise<{
    quote: ProductQuoteSnapshot;
    freeze: ExecutionPlanCompileFreeze;
    factRevisionRefs: readonly string[];
  }> {
    const { source, staleFence } = input;
    const sourceFreeze = source.executionPlanFreeze;
    const pending = input.sourceRequest.pendingExecutionPlanSnapshot;
    if (!sourceFreeze || !pending) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Confirmed price-drift successor requires a durable predecessor freeze and pending plan.',
      );
    }
    if (
      source.snapshot.quote.id !== staleFence.expectedQuoteRef.id ||
      String(source.snapshot.quote.revision) !== String(staleFence.expectedQuoteRef.revision) ||
      pending.snapshotHash !== staleFence.expectedSnapshotHash
    ) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        'Price-drift successor stale fence does not match the locked predecessor.',
      );
    }
    // §37.4-E: a store-fact price/date revision always marks contextDrifted.
    // The successor's fact baseline is then rebuilt from heads read on THIS
    // transaction client — never persisted from the gate's out-of-transaction
    // fence read (TOCTOU) and never from browser payload.
    const currentFactRevisionRefs = staleFence.diffFields.includes(
      'contextDrifted',
    )
      ? await this.rebuildCurrentContextRefsInTransaction(input, [
          ...pending.content.factRevisionRefs,
        ])
      : staleFence.observedFactRevisionRefs;
    if (sourceFreeze.approvalBasis !== 'merchant_confirmed' || sourceFreeze.packageBilling) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Confirmed price-drift successor supports one durable primary carrier only.',
      );
    }

    const billing = new DurableProductBillingService(
      new PostgresProductBillingRepository(this.pool, input.client),
      () => new Date(input.successor.createdAt),
    );
    const current = await billing.getQuote(source.snapshot.quote.id, input.workspaceId);
    if (
      !current ||
      current.taskId !== source.task.id ||
      current.lifecycleStatus !== 'reserved' ||
      current.packageContract ||
      current.revision !== staleFence.observedQuoteRevision
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Current ProductQuote cannot authoritatively rebuild this confirmed price-drift successor.',
      );
    }
    if (!Number.isSafeInteger(current.creditCost) || (current.creditCost ?? 0) <= 0) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Current ProductQuote must carry a positive authoritative credit cost.',
      );
    }

    const quote = await billing.buildQuote(
      rebindCurrentQuote({
        quote: current,
        workspaceId: input.workspaceId,
        taskId: input.successor.taskId,
      }),
    );
    const refreshed = await this.compiler.refreshLiveBindingsInTransaction(
      {
        planId: sourceFreeze.planId,
        expectedRevision: sourceFreeze.planRevision,
        quoteRef: { id: quote.quoteId, revision: quote.revision },
			rightsRevisionRefs: staleFence.observedRightsRevisionRefs,
			factRevisionRefs: currentFactRevisionRefs,
        workspaceId: input.workspaceId,
        now: input.successor.createdAt,
      },
      {
        append: (append) => this.plans.appendInTransaction(input.client, append),
        getRevision: (planId, revision) =>
          this.plans.getRevisionInTransaction(input.client, planId, revision),
        getLatest: (planId) =>
          this.plans.getLatestInTransaction(input.client, planId),
      },
    );
    const confirmed = await billing.confirm({
      workspaceId: input.workspaceId,
      quoteId: quote.quoteId,
      taskId: input.successor.taskId,
    });
    if (confirmed.revision !== quote.revision) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Price-drift successor quote changed while building its frozen plan.',
      );
    }
    return {
      quote: confirmed,
      freeze: {
        ...structuredClone(sourceFreeze),
        planRevision: refreshed.revision.revision,
        executionPlan: refreshed.executionPlan,
        deliverables: structuredClone(refreshed.revision.deliverables),
        quoteRef: { id: confirmed.quoteId, revision: confirmed.revision },
			rightsRevisionRefs: [...staleFence.observedRightsRevisionRefs],
      },
      factRevisionRefs: refreshed.factRevisionRefs,
    };
  }

  /**
   * Resolve every frozen context ref to its CURRENT head on the successor
   * transaction client, then require the result to equal what the gate's
   * fence observed. Missing heads fail closed (a source this freeze covers
   * can no longer answer); heads that moved again since the fence read fail
   * closed so the fence re-evaluates before any successor persists.
   */
  private async rebuildCurrentContextRefsInTransaction(
    input: {
      client: PoolClient;
      workspaceId: string;
      sourceRequest: HarnessWorkflowInput;
      successor: { taskId: string; createdAt: string };
      staleFence: RepricedPaidExecutionSuccessorRequest['staleFence'];
    },
    frozenFactRevisionRefs: readonly string[],
  ): Promise<readonly string[]> {
    if (!this.contextHeads) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Price-drift successor requires a transaction-aware current context-bundle builder.',
      );
    }
    const facts = await this.contextHeads.facts.pinWorkspaceFactHeadsInTransaction(
      input.client,
      input.workspaceId,
    );
    const resolveFactHeads = createAuthoritativeFactHeadResolver({
      facts,
      ...(this.contextHeads.identities
        ? { identities: this.contextHeads.identities }
        : {}),
      request: input.sourceRequest,
      now: () => input.successor.createdAt,
    });
    const heads = await resolveFactHeads({
      workspaceId: input.workspaceId,
      factRevisionRefs: frozenFactRevisionRefs,
    });
    const headByFrozenRef = new Map(
      heads.map((head) => [head.frozenRevisionId ?? head.factRevisionId, head]),
    );
    const currentRefs: string[] = [];
    for (const ref of frozenFactRevisionRefs) {
      const head = headByFrozenRef.get(ref);
      if (!head) {
        throw new P1DomainError(
          'INVALID_STATE',
          `Price-drift successor cannot resolve a current context head for frozen ref ${ref}.`,
        );
      }
      currentRefs.push(head.factRevisionId);
    }
    if (!sameRefSet(currentRefs, input.staleFence.observedFactRevisionRefs)) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Context heads moved again inside the successor transaction; the fence must re-evaluate before a successor can be built.',
      );
    }
    return currentRefs;
  }
}

function sameRefSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((value, index) => value === b[index]);
}

function rebindCurrentQuote(input: {
  quote: ProductQuoteSnapshot;
  workspaceId: string;
  taskId: string;
}): BuildProductQuoteInput {
  const quoteId = `quote-${input.taskId}`;
  const quote = input.quote;
  return {
    quoteId,
    catalogModelId: quote.catalogModelId,
    ...(quote.operation ? { operation: quote.operation } : {}),
    ...(quote.catalogModelRevision
      ? { catalogModelRevision: quote.catalogModelRevision }
      : {}),
    quotePolicyRevision: quote.quotePolicyRevision,
    ...(quote.submissionContractHash
      ? { submissionContractHash: quote.submissionContractHash }
      : {}),
    ...(quote.submissionPromptHash
      ? { submissionPromptHash: quote.submissionPromptHash }
      : {}),
    ...(quote.submissionReferenceAssetsHash
      ? { submissionReferenceAssetsHash: quote.submissionReferenceAssetsHash }
      : {}),
    ...(quote.submissionInputAssetsHash
      ? { submissionInputAssetsHash: quote.submissionInputAssetsHash }
      : {}),
    billingMode: quote.billingMode,
    creditCost: quote.creditCost,
    failureRefundsCredits: quote.failureRefundsCredits,
    ...(quote.debitUnits ? { debitUnits: structuredClone(quote.debitUnits) } : {}),
    ...(quote.outputCount ? { outputCount: quote.outputCount } : {}),
    ...(quote.outputLabel ? { outputLabel: quote.outputLabel } : {}),
    unitRate: quote.formula.unitRate,
    ...(quote.formula.currency ? { currency: quote.formula.currency } : {}),
    formulaExpression: quote.formula.expression,
    ...(quote.targetSeconds ? { targetSeconds: quote.targetSeconds } : {}),
    ...(quote.minChargeSeconds
      ? { minChargeSeconds: quote.minChargeSeconds }
      : {}),
    ...(quote.roundingStepSeconds
      ? { roundingStepSeconds: quote.roundingStepSeconds }
      : {}),
    ...(quote.routeSnapshotRef ? { routeSnapshotRef: quote.routeSnapshotRef } : {}),
    ...(quote.frozenCandidateDeploymentIds
      ? { frozenCandidateDeploymentIds: [...quote.frozenCandidateDeploymentIds] }
      : {}),
    workspaceId: input.workspaceId,
    taskId: input.taskId,
    ...(quote.authorizedCeiling !== undefined
      ? { authorizedCeiling: quote.authorizedCeiling }
      : {}),
    ...(quote.expiresAt ? { expiresAt: quote.expiresAt } : {}),
  };
}
