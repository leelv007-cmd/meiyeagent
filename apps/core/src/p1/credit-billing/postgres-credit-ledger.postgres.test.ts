import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';

import {
  PostgresProductBillingUsageReservation,
} from '../execution-spine/postgres-creation-submission-store.js';
import {
  createCreationExecutionSnapshot,
} from '../execution-spine/creation-execution-snapshot.js';
import type { CreationSubmissionRecord } from '../execution-spine/submission-coordinator.js';
import { DurableProductBillingService } from '../product-billing/durable-service.js';
import { ProductQuoteService } from '../product-billing/quote-service.js';
import { PostgresProductBillingRepository } from '../product-billing/postgres-repository.js';
import { HarnessProductBillingSettlementExecutor } from '../harness/product-billing-settlement.js';
import { CreditBillingService } from './credit-billing-service.js';
import { creditUsageOperationId } from './credit-ledger.js';
import { DEFAULT_CREDIT_PLAN_CATALOG } from './credit-plan-catalog.js';
import { MemoryCreditSubscriptionStore } from './credit-subscription-scheduler.js';
import { PostgresCreditLedger } from './postgres-credit-ledger.js';

const connectionString = process.env.TEST_DATABASE_URL;

test(
  'Postgres credit ledger cold-starts and serializes concurrent credit-priced reservations',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const fixture = await createFixture();
    const { billingRepository, creditLedger, pool, workspaceId } = fixture;
    const reservation = new PostgresProductBillingUsageReservation(
      pool,
      undefined,
      creditLedger,
    );
    const submissions = Array.from({ length: 4 }, (_, index) =>
      creditSubmission(workspaceId, `credit-reservation-${index}`),
    );

    try {
      await creditLedger.grant({
        id: 'cold-start-package',
        workspaceId,
        credits: 5,
        expirationDate: '2026-09-01T00:00:00.000Z',
        transactionType: 'PURCHASE_PACKAGE',
        sourceRef: 'cold-start-test',
        createdAt: '2026-08-01T00:00:00.000Z',
      });
      for (const submission of submissions) {
        const quote = await seedCreditQuote(
          billingRepository,
          workspaceId,
          submission.snapshot.quote.id,
          submission.task.id,
        );
        submission.snapshot = createSnapshot({
          quoteId: quote.quoteId,
          quoteRevision: quote.revision,
          submission,
          workspaceId,
        });
      }

      const results = await Promise.allSettled(
        submissions.map((submission) =>
          reserveInTransaction(reservation, pool, submission),
        ),
      );
      const fulfilled = results
        .map((result, index) => ({ result, submission: submissions[index]! }))
        .filter(
          (
            candidate,
          ): candidate is {
            result: PromiseFulfilledResult<void>;
            submission: CreationSubmissionRecord;
          } => candidate.result.status === 'fulfilled',
        );
      const rejected = results.filter(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );

      assert.equal(fulfilled.length, 2);
      assert.equal(rejected.length, 2);
      for (const result of rejected) {
        assert.match(
          String(result.reason),
          /Insufficient credits/u,
        );
      }

      const projection = await creditLedger.project(
        workspaceId,
        '2026-08-02T00:00:00.000Z',
      );
      assert.equal(projection.availableCredits, 1);
      assert.equal(projection.usedCredits, 4);
      const refunded = fulfilled[0]!.submission;
      const refundedQuote = await new DurableProductBillingService(
        billingRepository,
      ).getQuote(refunded.snapshot.quote.id, workspaceId);
      assert.ok(refundedQuote);
      const settlement = new HarnessProductBillingSettlementExecutor(
        new DurableProductBillingService(billingRepository),
        undefined,
        () => new Date('2026-08-02T00:00:00.000Z'),
        undefined,
        creditLedger,
      );
      const refundInput = {
        workspaceId,
        taskId: refunded.task.id,
        quoteId: refundedQuote.quoteId,
        quoteRevision: refundedQuote.revision,
      };
      await settlement.refund(refundInput);
      await settlement.refund(refundInput);
      assert.equal(
        (await billingRepository.getUsage(workspaceId, refunded.task.id))?.status,
        'refunded',
      );
      assert.equal(
        (await creditLedger.project(workspaceId, '2026-08-02T00:00:00.000Z'))
          .availableCredits,
        3,
      );
      assert.equal(
        (await creditLedger.listTransactions(workspaceId)).filter(
          (transaction) => transaction.transactionType === 'REFUND',
        ).length,
        1,
      );
      await creditLedger.grant({
        id: 'expired-package',
        workspaceId,
        credits: 3,
        expirationDate: '2026-08-03T00:00:00.000Z',
        transactionType: 'PURCHASE_PACKAGE',
        sourceRef: 'expired-projection-test',
        createdAt: '2026-08-01T00:00:00.000Z',
      });
      const afterExpiry = await creditLedger.project(
        workspaceId,
        '2026-08-04T00:00:00.000Z',
      );
      assert.equal(afterExpiry.availableCredits, 3);
      assert.equal(afterExpiry.expiredCredits, 3);
      assert.deepEqual(
        (await creditLedger.listTransactions(workspaceId))
          .filter((transaction) => transaction.transactionType === 'USAGE')
          .map((transaction) => transaction.operationId)
          .sort(),
        fulfilled
          .map(({ submission }) => creditUsageOperationId(submission.task.id))
          .sort(),
      );
      const usages = await Promise.all(
        submissions.map((submission) =>
          billingRepository.getUsage(workspaceId, submission.task.id),
        ),
      );
      assert.equal(usages.filter(Boolean).length, 2);
      assert.deepEqual(
        usages.filter(Boolean).map((usage) => usage?.reservedCredits),
        [2, 2],
      );
    } finally {
      await fixture.cleanup();
    }
  },
);

test(
  'Postgres r1 to r2 to r3 reprices refund each previous usage operation and reserve the final amount',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const fixture = await createFixture();
    const { billingRepository, creditLedger, pool, workspaceId } = fixture;
    const reservation = new PostgresProductBillingUsageReservation(
      pool,
      undefined,
      creditLedger,
    );
    const submission = creditSubmission(workspaceId, 'plan-reprice');
    try {
      await creditLedger.grant({
        id: 'plan-reprice-package',
        workspaceId,
        credits: 10,
        expirationDate: '2026-09-01T00:00:00.000Z',
        transactionType: 'PURCHASE_PACKAGE',
        sourceRef: 'plan-reprice-test',
        createdAt: '2026-08-01T00:00:00.000Z',
      });
      const previous = await seedCreditQuote(
        billingRepository,
        workspaceId,
        submission.snapshot.quote.id,
        submission.task.id,
      );
      submission.snapshot = createSnapshot({
        quoteId: previous.quoteId,
        quoteRevision: previous.revision,
        submission,
        workspaceId,
      });
      await reserveInTransaction(reservation, pool, submission);
      const frozenPrevious = await new DurableProductBillingService(
        billingRepository,
      ).getQuote(previous.quoteId, workspaceId);
      assert.ok(frozenPrevious);
      const successorInput = {
        billingMode: 'per_request' as const,
        catalogModelId: frozenPrevious.catalogModelId,
        catalogModelRevision: frozenPrevious.catalogModelRevision,
        creditCost: 4,
        failureRefundsCredits: frozenPrevious.failureRefundsCredits,
        frozenCandidateDeploymentIds:
          frozenPrevious.frozenCandidateDeploymentIds,
        operation: frozenPrevious.operation,
        outputCount: 4,
        quoteId: `${previous.quoteId}-r2`,
        quotePolicyRevision: frozenPrevious.quotePolicyRevision,
        routeSnapshotRef: frozenPrevious.routeSnapshotRef,
        submissionContractHash: frozenPrevious.submissionContractHash,
        submissionInputAssetsHash: frozenPrevious.submissionInputAssetsHash,
        submissionPromptHash: frozenPrevious.submissionPromptHash,
        submissionReferenceAssetsHash:
          frozenPrevious.submissionReferenceAssetsHash,
        unitRate: 4,
        workspaceId,
      };
      const successorPreview = new ProductQuoteService().buildQuote(successorInput);
      const expectedFreeze = {
        planId: 'plan-reprice',
        planRevision: 1,
        quoteRef: { id: previous.quoteId, revision: previous.revision },
      } as never;
      const freeze = {
        planId: 'plan-reprice',
        planRevision: 2,
        quoteRef: {
          id: successorPreview.quoteId,
          revision: successorPreview.revision,
        },
      } as never;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await reservation.reprice(client, {
          submission,
          expectedFreeze,
          previousQuoteRef: {
            id: previous.quoteId,
            revision: previous.revision,
          },
          freeze,
          successorQuote: successorInput,
          credits: 4,
        });
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }

      const thirdInput = {
        ...successorInput,
        creditCost: 3,
        outputCount: 3,
        quoteId: `${previous.quoteId}-r3`,
        unitRate: 3,
      };
      const thirdPreview = new ProductQuoteService().buildQuote(thirdInput);
      submission.snapshot = createSnapshot({
        quoteId: successorPreview.quoteId,
        quoteRevision: successorPreview.revision,
        submission,
        workspaceId,
      });
      submission.usageReservation.credits = 4;
      const thirdFreeze = {
        planId: 'plan-reprice',
        planRevision: 3,
        quoteRef: {
          id: thirdPreview.quoteId,
          revision: thirdPreview.revision,
        },
      } as never;
      const thirdClient = await pool.connect();
      try {
        await thirdClient.query('BEGIN');
        await reservation.reprice(thirdClient, {
          submission,
          expectedFreeze: freeze,
          previousQuoteRef: {
            id: successorPreview.quoteId,
            revision: successorPreview.revision,
          },
          freeze: thirdFreeze,
          successorQuote: thirdInput,
          credits: 3,
        });
        await thirdClient.query('COMMIT');
      } catch (error) {
        await thirdClient.query('ROLLBACK');
        throw error;
      } finally {
        thirdClient.release();
      }

      const billing = new DurableProductBillingService(billingRepository);
      const usage = await billing.getUsage(submission.task.id, workspaceId);
      const successor = await billing.getQuoteByTask(
        submission.task.id,
        workspaceId,
      );
      const released = await billing.getQuote(previous.quoteId, workspaceId);
      const releasedSecond = await billing.getQuote(
        successorPreview.quoteId,
        workspaceId,
      );
      const balance = await creditLedger.project(
        workspaceId,
        '2026-08-02T00:00:00.000Z',
      );
      assert.equal(usage?.quoteId, thirdPreview.quoteId);
      assert.equal(usage?.reservedCredits, 3);
      assert.equal(successor?.lifecycleStatus, 'reserved');
      assert.equal(released?.lifecycleStatus, 'refunded');
      assert.equal(releasedSecond?.lifecycleStatus, 'refunded');
      assert.equal(balance.usedCredits, 3);
      assert.equal(balance.refundedCredits, 6);
      assert.equal(balance.availableCredits, 7);
      const usageOperations = (await creditLedger.listTransactions(workspaceId))
        .filter((transaction) => transaction.transactionType === 'USAGE')
        .map((transaction) => transaction.operationId);
      assert.equal(usageOperations.length, 3);
      assert.equal(
        usageOperations.includes(
          submission.usageReservation.creditUsageOperationId ?? '',
        ),
        true,
      );
    } finally {
      await fixture.cleanup();
    }
  },
);

test(
  'Postgres refunds cannot revive explicitly expired subscription lots',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const fixture = await createFixture();
    const { creditLedger, workspaceId } = fixture;
    const usageOperationId = creditUsageOperationId('task-explicit-expiry');
    try {
      await creditLedger.grant({
        id: 'subscription-explicit-expiry',
        workspaceId,
        credits: 5,
        expirationDate: null,
        transactionType: 'SUBSCRIPTION_RENEWAL',
        sourceRef: 'subscription-explicit-expiry',
        createdAt: '2026-08-01T00:00:00.000Z',
      });
      await creditLedger.consume({
        workspaceId,
        credits: 3,
        transactionId: usageOperationId,
        actorId: 'owner',
        correlationId: 'test',
        createdAt: '2026-08-02T00:00:00.000Z',
      });
      await creditLedger.expireSubscriptionLots({
        workspaceId,
        subscriptionId: 'subscription-explicit-expiry',
        actorId: 'system',
        correlationId: 'upgrade',
        createdAt: '2026-08-03T00:00:00.000Z',
      });

      const [refund] = await creditLedger.refundUsageOperation({
        workspaceId,
        usageOperationId,
        refundOperationId: 'refund:task-explicit-expiry',
        actorId: 'worker',
        correlationId: 'test',
        createdAt: '2026-08-04T00:00:00.000Z',
      });

      assert.equal(refund?.credited, false);
      assert.equal(
        (await creditLedger.project(workspaceId)).availableCredits,
        0,
      );
    } finally {
      await fixture.cleanup();
    }
  },
);

test(
  'Postgres ledger feeds the nearest unexpired lot into the merchant balance',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const fixture = await createFixture();
    const { creditLedger, workspaceId } = fixture;
    const now = new Date('2026-08-05T00:00:00.000Z');
    const billing = new CreditBillingService(
      creditLedger,
      new MemoryCreditSubscriptionStore(),
      { async get() { return structuredClone(DEFAULT_CREDIT_PLAN_CATALOG); } },
      { async getPaymentMapping() { return null; } },
      () => now,
    );
    try {
      await creditLedger.grant({
        id: 'expired-package',
        workspaceId,
        credits: 99,
        expirationDate: '2026-08-04T00:00:00.000Z',
        transactionType: 'PURCHASE_PACKAGE',
        sourceRef: 'expired-package',
        createdAt: '2026-08-01T00:00:00.000Z',
      });
      await creditLedger.grant({
        id: 'later-package',
        workspaceId,
        credits: 30,
        expirationDate: '2026-08-20T00:00:00.000Z',
        transactionType: 'PURCHASE_PACKAGE',
        sourceRef: 'later-package',
        createdAt: '2026-08-01T00:00:00.000Z',
      });
      await creditLedger.grant({
        id: 'soonest-package',
        workspaceId,
        credits: 10,
        expirationDate: '2026-08-10T00:00:00.000Z',
        transactionType: 'PURCHASE_PACKAGE',
        sourceRef: 'soonest-package',
        createdAt: '2026-08-01T00:00:00.000Z',
      });

      const balance = await billing.balance(workspaceId);

      assert.equal(balance.availableCredits, 40);
      assert.deepEqual(balance.soonestExpiringLot, {
        remainingCredits: 10,
        expiresAt: '2026-08-10T00:00:00.000Z',
      });
    } finally {
      await fixture.cleanup();
    }
  },
);

test(
  'Postgres balance snapshot keeps available credits and nearest lot coherent',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const fixture = await createFixture();
    const { creditLedger, workspaceId } = fixture;
    const billing = new CreditBillingService(
      creditLedger,
      new MemoryCreditSubscriptionStore(),
      { async get() { return structuredClone(DEFAULT_CREDIT_PLAN_CATALOG); } },
      { async getPaymentMapping() { return null; } },
      () => new Date('2026-08-05T00:00:00.000Z'),
    );
    const grant = (id: string, credits: number, expirationDate: string) =>
      creditLedger.grant({
        id,
        workspaceId,
        credits,
        expirationDate,
        transactionType: 'PURCHASE_PACKAGE',
        sourceRef: id,
        createdAt: '2026-08-01T00:00:00.000Z',
      });

    try {
      await grant('empty', 4, '2026-08-09T00:00:00.000Z');
      await grant('same-expiry-b', 8, '2026-08-10T00:00:00.000Z');
      await grant('same-expiry-a', 7, '2026-08-10T00:00:00.000Z');
      await creditLedger.consume({
        workspaceId,
        credits: 4,
        transactionId: creditUsageOperationId('empty-lot'),
        actorId: 'owner',
        correlationId: 'test',
        createdAt: '2026-08-01T12:00:00.000Z',
      });
      await grant('expired', 9, '2026-08-02T00:00:00.000Z');

      assert.deepEqual(await billing.balance(workspaceId), {
        grantedCredits: 28,
        usedCredits: 4,
        refundedCredits: 0,
        expiredCredits: 9,
        availableCredits: 15,
        soonestExpiringLot: {
          remainingCredits: 7,
          expiresAt: '2026-08-10T00:00:00.000Z',
        },
      });
    } finally {
      await fixture.cleanup();
    }
  },
);

async function createFixture() {
  const schema = `credit_pg_${randomUUID().replaceAll('-', '')}`;
  const pool = new Pool({
    connectionString,
    options: `-c search_path=${schema},public`,
  });
  const workspaceId = `credit-workspace-${randomUUID()}`;
  const creditLedger = new PostgresCreditLedger(pool);
  const billingRepository = new PostgresProductBillingRepository(pool);

  await pool.query(`CREATE SCHEMA ${schema}`);
  await pool.query(`
    CREATE TABLE workspaces (
      id text PRIMARY KEY,
      name text NOT NULL
    )
  `);
  const client = await pool.connect();
  try {
    await creditLedger.migrate(client);
    await billingRepository.migrate(client);
  } finally {
    client.release();
  }
  await pool.query(
    "INSERT INTO workspaces (id, name) VALUES ($1, 'Credit ledger cold start')",
    [workspaceId],
  );

  return {
    billingRepository,
    creditLedger,
    pool,
    workspaceId,
    async cleanup() {
      await pool.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => undefined);
      await pool.end();
    },
  };
}

async function reserveInTransaction(
  reservation: PostgresProductBillingUsageReservation,
  pool: Pool,
  submission: CreationSubmissionRecord,
) {
  const client = await pool.connect();
  let inTransaction = false;
  try {
    await client.query('BEGIN');
    inTransaction = true;
    await reservation.reserve(client, submission);
    await client.query('COMMIT');
    inTransaction = false;
  } catch (error) {
    if (inTransaction) await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function seedCreditQuote(
  repository: PostgresProductBillingRepository,
  workspaceId: string,
  quoteId: string,
  taskId: string,
) {
  const billing = new DurableProductBillingService(repository);
  await billing.buildQuote({
    billingMode: 'per_request',
    catalogModelId: 'copy-model-1',
    catalogModelRevision: 'catalog-r1',
    creditCost: 2,
    failureRefundsCredits: true,
    frozenCandidateDeploymentIds: ['copy-deployment-1'],
    quoteId,
    quotePolicyRevision: 'quote-policy-1',
    routeSnapshotRef: 'route-1',
    unitRate: 2,
    workspaceId,
  });
  return billing.confirm({ quoteId, taskId, workspaceId });
}

function creditSubmission(
  workspaceId: string,
  suffix: string,
): CreationSubmissionRecord {
  const taskId = `credit-task-${suffix}`;
  const submission: CreationSubmissionRecord = {
    contentPackage: { expectedRevision: 0, id: `credit-package-${suffix}` },
    snapshot: createSnapshot({
      quoteId: `credit-quote-${suffix}`,
      quoteRevision: 'quote-revision-placeholder',
      submission: {
        contentPackage: {
          expectedRevision: 0,
          id: `credit-package-${suffix}`,
        },
        task: { id: taskId },
        work: { id: `credit-work-${suffix}` },
      },
      workspaceId,
    }),
    task: { id: taskId },
    usageReservation: {
      id: `credit-usage-${suffix}`,
      credits: 2,
      units: [],
    },
    work: { id: `credit-work-${suffix}` },
  };
  return submission;
}

function createSnapshot(input: {
  quoteId: string;
  quoteRevision: string;
  submission: Pick<
    CreationSubmissionRecord,
    'contentPackage' | 'task' | 'work'
  >;
  workspaceId: string;
}) {
  return createCreationExecutionSnapshot(
    {
      actorId: 'owner-1',
      briefConfirmation: { id: 'brief-1', revision: 'brief-r1' },
      briefContext: { id: 'brief-context-1', revision: 1 },
      catalogModel: { id: 'copy-model-1', revision: 'catalog-r1' },
      contentModules: ['social_cover'],
      contentPackageId: input.submission.contentPackage.id,
      creationMode: 'customized',
      deliverables: [
        { id: 'copy-main', kind: 'copy', order: 1, quantity: 1 },
      ],
      expectedContentPackageRevision:
        input.submission.contentPackage.expectedRevision,
      idempotencyKey: `credit-submit-${input.submission.task.id}`,
      identity: { id: 'identity-1', revision: 'identity-r1' },
      intent: 'Write an appointment message.',
      lens: 'copy',
      modelPolicy: { id: 'policy-1', mode: 'fixed', revision: 'policy-r1' },
      platform: { id: 'douyin' },
      quote: { id: input.quoteId, revision: input.quoteRevision },
      recipe: { id: 'recipe-1', revision: 'recipe-r1' },
      rights: { revision: 'rights-r1', summary: 'authorized assets' },
      route: { id: 'route-1', revision: 'route-r1' },
      sources: { assets: [] },
      surface: { id: 'surface-1', revision: 'surface-r1' },
      taskId: input.submission.task.id,
      workId: input.submission.work.id,
      workspaceId: input.workspaceId,
    },
    '2026-08-01T00:00:00.000Z',
  );
}
