import { createHash } from 'node:crypto';

import type { BuildProductQuoteInput } from '@meiye/contracts';

import type { ProductBillingApplicationPort } from '../product-billing/durable-service.js';

import type { CreditBillingLedgerPort } from './credit-billing-service.js';
import type { CreditGrantLot, CreditLotTransaction } from './credit-ledger.js';
import type { CreditSubscriptionStore } from './credit-subscription-scheduler.js';

const FIXTURE_PREFIX = 'e2e-credit-detail';
const FIXTURE_ACTOR = 'e2e-credit-detail-fixture';
const FIXTURE_CORRELATION = 'e2e-credit-detail-fixture';

type E2ECreditLedgerPort = Pick<
  CreditBillingLedgerPort,
  'grant' | 'listLots'
> & {
  listTransactions(
    workspaceId: string,
  ): readonly CreditLotTransaction[] | Promise<readonly CreditLotTransaction[]>;
  consume(input: {
    workspaceId: string;
    credits: number;
    transactionId: string;
    actorId: string;
    correlationId: string;
    createdAt: string;
  }): unknown | Promise<unknown>;
  refundUsageOperation(input: {
    workspaceId: string;
    usageOperationId: string;
    refundOperationId: string;
    actorId: string;
    correlationId: string;
    createdAt: string;
  }): unknown | Promise<unknown>;
};

export class E2ECreditDetailFixture {
  constructor(
    private readonly options: {
      clock?: () => Date;
      ledger: E2ECreditLedgerPort;
      productBilling: Pick<
        ProductBillingApplicationPort,
        'buildQuote' | 'confirm' | 'dispatch' | 'failAndRefund' | 'reserve' | 'settle'
      >;
      subscriptions: CreditSubscriptionStore;
    },
  ) {}

  async seed(input: { workspaceId: string }) {
    const ids = fixtureIds(input.workspaceId);
    const [lots, transactions, subscription] = await Promise.all([
      this.options.ledger.listLots(input.workspaceId),
      this.options.ledger.listTransactions(input.workspaceId),
      this.options.subscriptions.get(ids.subscriptionId),
    ]);
    if (fixtureComplete(lots, transactions, ids)) {
      return { ready: true } as const;
    }

    const now = subscription
      ? new Date(subscription.anchorAt)
      : (this.options.clock ?? (() => new Date()))();
    const createdAt = now.toISOString();
    const subscriptionEndsAt = addDays(now, 31).toISOString();

    await this.options.subscriptions.upsert({
      anchorAt: createdAt,
      id: ids.subscriptionId,
      interval: 'monthly',
      paidThroughCycle: 1,
      tier: 'starter',
      workspaceId: input.workspaceId,
    });
    await this.options.subscriptions.recordInitialPaidPeriod({
      at: createdAt,
      coverage: {
        creditsPerCycle: 500,
        interval: 'monthly',
        tier: 'starter',
      },
      coverageCycles: 1,
      periodStartsAt: createdAt,
      subscriptionId: ids.subscriptionId,
    });
    await this.grant({
      createdAt,
      credits: 500,
      expirationDate: subscriptionEndsAt,
      id: ids.subscriptionLotId,
      sourceRef: ids.subscriptionId,
      transactionType: 'SUBSCRIPTION_RENEWAL',
      workspaceId: input.workspaceId,
    });
    await this.grant({
      createdAt: '2020-01-01T00:00:00.000Z',
      credits: 50,
      expirationDate: '2020-01-02T00:00:00.000Z',
      id: ids.lotId('expired'),
      sourceRef: ids.prefix,
      transactionType: 'PURCHASE_PACKAGE',
      workspaceId: input.workspaceId,
    });
    await this.grant({
      createdAt,
      credits: 2,
      expirationDate: addDays(now, 1).toISOString(),
      id: ids.lotId('reserved'),
      sourceRef: ids.prefix,
      transactionType: 'PURCHASE_PACKAGE',
      workspaceId: input.workspaceId,
    });
    await this.grant({
      createdAt,
      credits: 3,
      expirationDate: addDays(now, 2).toISOString(),
      id: ids.lotId('settled'),
      sourceRef: ids.prefix,
      transactionType: 'PURCHASE_PACKAGE',
      workspaceId: input.workspaceId,
    });
    await this.grant({
      createdAt,
      credits: 4,
      expirationDate: addDays(now, 4).toISOString(),
      id: ids.lotId('credited-refund'),
      sourceRef: ids.prefix,
      transactionType: 'PURCHASE_PACKAGE',
      workspaceId: input.workspaceId,
    });
    await this.grant({
      createdAt,
      credits: 5,
      expirationDate: addDays(now, 3).toISOString(),
      id: ids.lotId('expired-refund'),
      sourceRef: ids.prefix,
      transactionType: 'PURCHASE_PACKAGE',
      workspaceId: input.workspaceId,
    });

    await this.reserve(input.workspaceId, ids.taskId('reserved'), 2, createdAt, ids);
    await this.settle(input.workspaceId, ids.taskId('settled'), 3, createdAt, ids);
    await this.refund(
      input.workspaceId,
      ids.taskId('expired-refund'),
      5,
      createdAt,
      addDays(now, 5).toISOString(),
      ids,
    );
    await this.refund(
      input.workspaceId,
      ids.taskId('credited-refund'),
      4,
      createdAt,
      createdAt,
      ids,
    );

    return { ready: true } as const;
  }

  private async grant(input: {
    createdAt: string;
    credits: number;
    expirationDate: string;
    id: string;
    sourceRef: string;
    transactionType: 'PURCHASE_PACKAGE' | 'SUBSCRIPTION_RENEWAL';
    workspaceId: string;
  }) {
    await this.options.ledger.grant({
      actorId: FIXTURE_ACTOR,
      correlationId: FIXTURE_CORRELATION,
      createdAt: input.createdAt,
      credits: input.credits,
      expirationDate: input.expirationDate,
      grantIdempotencyKey: `grant:${input.id}`,
      id: input.id,
      sourceRef: input.sourceRef,
      transactionType: input.transactionType,
      workspaceId: input.workspaceId,
    });
  }

  private async reserve(
    workspaceId: string,
    taskId: string,
    credits: number,
    createdAt: string,
    ids: ReturnType<typeof fixtureIds>,
  ) {
    const quote = await this.buildQuote(workspaceId, taskId, credits, ids);
    await this.options.productBilling.confirm({ quoteId: quote.quoteId, taskId, workspaceId });
    await this.options.productBilling.reserve({ quoteId: quote.quoteId, units: [], workspaceId });
    await this.consume(workspaceId, taskId, credits, createdAt);
  }

  private async settle(
    workspaceId: string,
    taskId: string,
    credits: number,
    createdAt: string,
    ids: ReturnType<typeof fixtureIds>,
  ) {
    await this.reserve(workspaceId, taskId, credits, createdAt, ids);
    const quoteId = ids.quoteId(taskId);
    await this.options.productBilling.dispatch({
      attemptId: ids.attemptId(taskId),
      deploymentId: ids.prefix,
      quoteId,
      workspaceId,
    });
    await this.options.productBilling.settle({ quoteId, workspaceId });
  }

  private async refund(
    workspaceId: string,
    taskId: string,
    credits: number,
    createdAt: string,
    refundedAt: string,
    ids: ReturnType<typeof fixtureIds>,
  ) {
    await this.reserve(workspaceId, taskId, credits, createdAt, ids);
    const quoteId = ids.quoteId(taskId);
    await this.options.productBilling.failAndRefund({
      forceCreditRefund: true,
      quoteId,
      workspaceId,
    });
    await this.options.ledger.refundUsageOperation({
      actorId: FIXTURE_ACTOR,
      correlationId: FIXTURE_CORRELATION,
      createdAt: refundedAt,
      refundOperationId: `refund:${taskId}`,
      usageOperationId: `task:${taskId}`,
      workspaceId,
    });
  }

  private async consume(
    workspaceId: string,
    taskId: string,
    credits: number,
    createdAt: string,
  ) {
    await this.options.ledger.consume({
      actorId: FIXTURE_ACTOR,
      correlationId: FIXTURE_CORRELATION,
      createdAt,
      credits,
      transactionId: `task:${taskId}`,
      workspaceId,
    });
  }

  private async buildQuote(
    workspaceId: string,
    taskId: string,
    credits: number,
    ids: ReturnType<typeof fixtureIds>,
  ) {
    const input: BuildProductQuoteInput = {
      billingMode: 'per_request',
      catalogModelId: ids.prefix,
      catalogModelRevision: `${ids.prefix}@1`,
      creditCost: credits,
      currency: 'CNY',
      failureRefundsCredits: true,
      frozenCandidateDeploymentIds: [ids.prefix],
      outputCount: 1,
      outputLabel: 'E2E credit detail fixture',
      quoteId: ids.quoteId(taskId),
      quotePolicyRevision: 'quote.policy@1',
      routeSnapshotRef: ids.prefix,
      submissionContractHash: ids.prefix,
      taskId,
      unitRate: credits,
      workspaceId,
    };
    return this.options.productBilling.buildQuote(input);
  }
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1_000);
}

function fixtureIds(workspaceId: string) {
  const suffix = createHash('sha256')
    .update(workspaceId)
    .digest('hex')
    .slice(0, 16);
  const prefix = `${FIXTURE_PREFIX}-${suffix}`;
  return {
    attemptId: (taskId: string) => `${prefix}-attempt-${taskId}`,
    lotId: (name: string) => `${prefix}-${name}-lot`,
    prefix,
    quoteId: (taskId: string) => `${prefix}-quote-${taskId}`,
    subscriptionId: `${prefix}-subscription`,
    subscriptionLotId: `${prefix}-subscription-lot`,
    taskId: (name: string) => `${prefix}-${name}`,
  };
}

function fixtureComplete(
  lots: readonly CreditGrantLot[],
  transactions: readonly CreditLotTransaction[],
  ids: ReturnType<typeof fixtureIds>,
) {
  const lotIds = new Set(lots.map((lot) => lot.id));
  const usageOperations = new Set(
    transactions
      .filter((transaction) => transaction.transactionType === 'USAGE')
      .map((transaction) => transaction.operationId),
  );
  const refundOperations = new Set(
    transactions
      .filter((transaction) => transaction.transactionType === 'REFUND')
      .map((transaction) => transaction.operationId),
  );
  const expiredLot = transactions.some(
    (transaction) =>
      transaction.transactionType === 'EXPIRE' &&
      transaction.lotId === ids.lotId('expired'),
  );

  return (
    [
      ids.subscriptionLotId,
      ids.lotId('expired'),
      ids.lotId('reserved'),
      ids.lotId('settled'),
      ids.lotId('credited-refund'),
      ids.lotId('expired-refund'),
    ].every((id) => lotIds.has(id)) &&
    ['reserved', 'settled', 'credited-refund', 'expired-refund'].every((name) =>
      usageOperations.has(`consume:task:${ids.taskId(name)}`),
    ) &&
    ['credited-refund', 'expired-refund'].every((name) =>
      refundOperations.has(`refund:${ids.taskId(name)}`),
    ) &&
    expiredLot
  );
}
