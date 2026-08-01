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
import { PostgresProductBillingRepository } from '../product-billing/postgres-repository.js';
import { HarnessProductBillingSettlementExecutor } from '../harness/product-billing-settlement.js';
import { creditUsageOperationId } from './credit-ledger.js';
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
