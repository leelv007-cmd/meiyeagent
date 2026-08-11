import type { BuildProductQuoteInput, ProductQuoteSnapshot } from '@meiye/contracts';
import type { Pool, PoolClient } from 'pg';

import type { PostgresMarketingPlanStore } from '../agent-session/postgres-plan-store.js';
import type { PlanCompiler } from '../agent-session/plan-compiler.js';
import { P1DomainError } from '../foundation/domain.js';
import type { ExecutionPlanCompileFreeze } from '../harness/execution-plan-admission.js';
import type { HarnessWorkflowInput } from '../harness/task-admission.js';
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
  }>;
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
  ) {}

  async rebuildInTransaction(input: {
    client: PoolClient;
    workspaceId: string;
    source: CreationSubmissionRecord;
    sourceRequest: HarnessWorkflowInput;
    successor: { taskId: string; createdAt: string };
    staleFence: RepricedPaidExecutionSuccessorRequest['staleFence'];
  }): Promise<{ quote: ProductQuoteSnapshot; freeze: ExecutionPlanCompileFreeze }> {
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
		if (staleFence.diffFields.includes('contextDrifted')) {
			throw new P1DomainError(
				'INVALID_STATE',
				'Price-drift successor requires a transaction-aware current context-bundle builder.',
			);
		}
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
			factRevisionRefs: staleFence.observedFactRevisionRefs,
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
    };
  }
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
