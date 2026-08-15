import type { BuildProductQuoteInput, ProductQuoteSnapshot } from '@meiye/contracts';
import type { Pool, PoolClient } from 'pg';

import type { PostgresMarketingPlanStore } from '../agent-session/postgres-plan-store.js';
import type { PlanCompiler } from '../agent-session/plan-compiler.js';
import { P1DomainError } from '../foundation/domain.js';
import type { ExecutionPlanCompileFreeze } from '../harness/execution-plan-admission.js';
import {
  createAuthoritativeFactHeadResolver,
  createAuthoritativeRightsHeadResolver,
} from '../harness/execution-plan-live-facts.js';
import type { HarnessWorkflowInput } from '../harness/task-admission.js';
import type { MarketingIdentityRepository } from '../operations/marketing-identity.js';
import type { StoreFactLedger } from '../operations/store-fact-ledger.js';
import type { ContentPackageRightsResolverPort } from '../operations/types.js';
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
    /** Fact/context heads re-read and verified inside the caller transaction. */
    factRevisionRefs: readonly string[];
  }>;
}

/**
 * Transaction-aware current context-head sources for the V31-63 rebuild.
 * `facts` must pin the workspace's fact heads on the successor transaction so
 * no fact revision can commit before the successor does. `identities` and
 * `rights` pin their canonical writer locks and read on that same transaction.
 */
export interface RepricedSuccessorContextHeadSources {
  facts: {
    pinWorkspaceFactHeadsInTransaction(
      client: PoolClient,
      workspaceId: string,
    ): Promise<Pick<StoreFactLedger, 'history' | 'listActive'>>;
  };
  identities: {
    pinWorkspaceIdentityHeadsInTransaction(
      client: PoolClient,
      workspaceId: string,
    ): Promise<Pick<MarketingIdentityRepository, 'listActive'>>;
  };
  rights: {
    pinWorkspaceRightsHeadsInTransaction(
      client: PoolClient,
      workspaceId: string,
    ): Promise<
      Pick<ContentPackageRightsResolverPort, 'resolve' | 'resolveWithRevision'>
    >;
  };
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
    // The complete successor context is rebuilt from canonical heads pinned on
    // THIS transaction, even when only the quote diff triggered the gate. The
    // gate's observed refs are comparison fences, never persistence inputs.
    const currentContext = await this.rebuildCurrentContextInTransaction(
      input,
      {
        factRevisionRefs: pending.content.factRevisionRefs,
        rightsRevisionRefs: pending.content.rightsRevisionRefs,
      },
    );
    if (sourceFreeze.approvalBasis !== 'merchant_confirmed' || sourceFreeze.packageBilling) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Confirmed price-drift successor supports one durable primary carrier only.',
      );
    }

    const billingRepository = new PostgresProductBillingRepository(
      this.pool,
      input.client,
    );
    const billing = new DurableProductBillingService(
      billingRepository,
      () => new Date(input.successor.createdAt),
    );
    const current = await billingRepository.withTransaction(
      input.workspaceId,
      [
        `quote:${source.snapshot.quote.id}`,
        `task:${source.task.id}`,
      ],
      (transaction) =>
        transaction.getQuote(input.workspaceId, source.snapshot.quote.id),
    );
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
        rightsRevisionRefs: currentContext.rightsRevisionRefs,
        factRevisionRefs: currentContext.factRevisionRefs,
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
        rightsRevisionRefs: [...currentContext.rightsRevisionRefs],
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
  private async rebuildCurrentContextInTransaction(
    input: {
      client: PoolClient;
      workspaceId: string;
      sourceRequest: HarnessWorkflowInput;
      successor: { taskId: string; createdAt: string };
      staleFence: RepricedPaidExecutionSuccessorRequest['staleFence'];
    },
    frozen: {
      factRevisionRefs: readonly string[];
      rightsRevisionRefs: readonly string[];
    },
  ): Promise<{
    factRevisionRefs: readonly string[];
    rightsRevisionRefs: readonly string[];
  }> {
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
    const identities =
      await this.contextHeads.identities.pinWorkspaceIdentityHeadsInTransaction(
        input.client,
        input.workspaceId,
      );
    const rights = await this.contextHeads.rights.pinWorkspaceRightsHeadsInTransaction(
      input.client,
      input.workspaceId,
    );
    const resolveFactHeads = createAuthoritativeFactHeadResolver({
      facts,
      identities,
      request: input.sourceRequest,
      now: () => input.successor.createdAt,
    });
    const heads = await resolveFactHeads({
      workspaceId: input.workspaceId,
      factRevisionRefs: frozen.factRevisionRefs,
    });
    const headByFrozenRef = new Map(
      heads.map((head) => [head.frozenRevisionId ?? head.factRevisionId, head]),
    );
    const currentRefs: string[] = [];
    for (const ref of frozen.factRevisionRefs) {
      const head = headByFrozenRef.get(ref);
      if (!head) {
        throw new P1DomainError(
          'INVALID_STATE',
          `Price-drift successor cannot resolve a current context head for frozen ref ${ref}.`,
        );
      }
      if (
        head.factRevisionId.startsWith('identity:') &&
        head.factRevisionId.endsWith(':identity-head:missing')
      ) {
        throw new P1DomainError(
          'INVALID_STATE',
          `Price-drift successor cannot freeze a missing marketing identity for frozen ref ${ref}.`,
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
    const rightsHeads = await createAuthoritativeRightsHeadResolver({
      rights,
      request: input.sourceRequest,
    })({
      workspaceId: input.workspaceId,
      rightsRevisionRefs: frozen.rightsRevisionRefs,
    });
    const rightsHeadByFrozenRef = new Map(
      rightsHeads.map((head) => [head.frozenRevisionId ?? head.revisionId, head]),
    );
    const currentRightsRefs: string[] = [];
    for (const ref of frozen.rightsRevisionRefs) {
      const head = rightsHeadByFrozenRef.get(ref);
      if (!head || head.revoked) {
        throw new P1DomainError(
          'INVALID_STATE',
          `Price-drift successor cannot use revoked or unresolved rights for frozen ref ${ref}.`,
        );
      }
      currentRightsRefs.push(head.revisionId);
    }
    if (
      !sameRefSet(
        currentRightsRefs,
        input.staleFence.observedRightsRevisionRefs,
      )
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Rights heads moved again inside the successor transaction; the fence must re-evaluate before a successor can be built.',
      );
    }
    return {
      factRevisionRefs: currentRefs,
      rightsRevisionRefs: currentRightsRefs,
    };
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
