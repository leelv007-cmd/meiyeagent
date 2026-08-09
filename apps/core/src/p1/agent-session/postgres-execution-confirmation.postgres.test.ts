/**
 * V31-11 Postgres A3 seam: concurrent createRequest never over-debits.
 * Skips when TEST_DATABASE_URL is unset (local rule).
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';

import { agentExecutionConfirmationRequestSchema } from '@meiye/contracts';

import { PostgresCreditLedger } from '../credit-billing/postgres-credit-ledger.js';
import { PgBossJobPort } from '../job-runtime/pg-boss-job-port.js';
import { ConfirmationAuthorityAssembler } from './execution-confirmation-authority.js';
import { ExecutionConfirmationService } from './execution-confirmation-service.js';
import { PostgresConfirmationAuthorityStore } from './execution-confirmation-authority-store.js';
import {
  CONFIRMATION_EXPIRY_JOB_KIND,
  createConfirmationExpiryJobHandler,
  registerConfirmationExpirySchedule,
} from './execution-confirmation-expiry-job.js';
import {
  confirmationCreditPortFromPostgresLedger,
  PostgresExecutionConfirmationMigration,
} from './postgres-execution-confirmation-store.js';
import {
  ExecutionConfirmationError,
  type ConfirmationRequestProjectionFacts,
} from './execution-confirmation-store.js';

const connectionString = process.env.TEST_DATABASE_URL;

test(
  'pending confirmation authority survives a Postgres store restart and advances on live drift',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const fixture = await createFixture();
    try {
      const store = new PostgresConfirmationAuthorityStore(fixture.pool);
      await store.migrate();
      const first = {
        workflowId: 'workflow-authority',
        workspaceId: fixture.workspaceId,
        planId: 'plan-authority',
        planRevision: 1,
        snapshotHash: 'snapshot-authority-1',
        quoteRef: { id: 'quote-authority', revision: 1 },
        rightsRevisionRefs: ['rights-1'],
        factRevisionRefs: ['fact-1'],
        frozenAt: '2026-08-09T08:00:00.000Z',
      };
      await store.putCurrent(first);
      const restarted = new PostgresConfirmationAuthorityStore(fixture.pool);
      assert.deepEqual(
        await restarted.getCurrentByWorkflowId(first.workflowId),
        first,
      );
      const drifted = {
        ...first,
        planRevision: 2,
        snapshotHash: 'snapshot-authority-2',
        frozenAt: '2026-08-09T08:01:00.000Z',
      };
      await restarted.putCurrent(drifted);
      assert.deepEqual(
        await restarted.getCurrentByWorkflowId(first.workflowId),
        drifted,
      );
      await assert.rejects(
        () =>
          restarted.putCurrent({
            ...first,
            frozenAt: '2099-01-01T00:00:00.000Z',
          }),
        (error: unknown) =>
          error instanceof ExecutionConfirmationError &&
          error.code === 'IDEMPOTENCY_CONFLICT',
      );
      assert.deepEqual(
        await restarted.putCurrent({
          ...drifted,
          frozenAt: '1999-01-01T00:00:00.000Z',
        }),
        drifted,
      );
      await assert.rejects(
        () =>
          restarted.putCurrent({
            ...drifted,
            snapshotHash: 'snapshot-authority-conflict',
          }),
        (error: unknown) =>
          error instanceof ExecutionConfirmationError &&
          error.code === 'IDEMPOTENCY_CONFLICT',
      );

      const concurrentWorkflowId = 'workflow-authority-concurrent';
      const sameMillisecond = '2026-08-09T08:02:00.000Z';
      const [higher, lower] = await Promise.allSettled([
        restarted.putCurrent({
          ...first,
          workflowId: concurrentWorkflowId,
          planRevision: 4,
          snapshotHash: 'snapshot-authority-4',
          frozenAt: sameMillisecond,
        }),
        restarted.putCurrent({
          ...first,
          workflowId: concurrentWorkflowId,
          planRevision: 3,
          snapshotHash: 'snapshot-authority-3',
          frozenAt: sameMillisecond,
        }),
      ]);
      assert.equal(higher.status, 'fulfilled');
      assert.equal(lower.status, 'rejected');
      assert.equal(
        (await restarted.getCurrentByWorkflowId(concurrentWorkflowId))
          ?.planRevision,
        4,
      );

      const inverseWorkflowId = 'workflow-authority-concurrent-inverse';
      await Promise.allSettled([
        restarted.putCurrent({
          ...first,
          workflowId: inverseWorkflowId,
          planRevision: 3,
          snapshotHash: 'snapshot-authority-inverse-3',
          frozenAt: sameMillisecond,
        }),
        restarted.putCurrent({
          ...first,
          workflowId: inverseWorkflowId,
          planRevision: 4,
          snapshotHash: 'snapshot-authority-inverse-4',
          frozenAt: sameMillisecond,
        }),
      ]);
      assert.equal(
        (await restarted.getCurrentByWorkflowId(inverseWorkflowId))
          ?.planRevision,
        4,
      );
    } finally {
      await fixture.cleanup();
    }
  },
);

test(
  'Postgres confirmation create serializes concurrent reserves without over-debit (A3)',
  {
    skip: connectionString ? false : 'TEST_DATABASE_URL is not configured',
  },
  async () => {
    const fixture = await createFixture();
    const { service, creditLedger, workspaceId, cleanup } = fixture;
    try {
      await creditLedger.grant({
        id: 'confirm-pkg',
        workspaceId,
        credits: 5,
        expirationDate: '2026-09-01T00:00:00.000Z',
        transactionType: 'PURCHASE_PACKAGE',
        sourceRef: 'confirm-a3',
        createdAt: '2026-08-01T00:00:00.000Z',
      });

      const createdAt = '2026-08-08T12:00:00.000Z';
      const holdExpiresAt = '2026-08-09T12:00:00.000Z';
      const attempts = Array.from({ length: 4 }, (_, index) =>
        service.createRequest({
          requestId: `req-a3-${index}`,
          workspaceId,
          planId: `plan-a3-${index}`,
          planRevision: 1,
          snapshotHash: `snap-a3-${index}`,
          quoteRef: { id: `quote-a3-${index}`, revision: 1 },
          reservationIdempotencyKey: `reserve-a3-${index}`,
          createdAt,
          holdExpiresAt,
          actorId: 'merchant-a3',
          creditCost: 3,
          failureRefundsCredits: true,
        }),
      );
      const results = await Promise.allSettled(attempts);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      assert.equal(fulfilled.length, 1);
      assert.equal(rejected.length, 3);

      const projection = await creditLedger.project(workspaceId, createdAt);
      assert.equal(projection.availableCredits, 2);
      assert.equal(projection.usedCredits, 3);

      const winner = (
        fulfilled[0] as PromiseFulfilledResult<
          Awaited<ReturnType<ExecutionConfirmationService['createRequest']>>
        >
      ).value;
      const expired = await service.expireHold({
        requestId: winner.stored.request.requestId,
        workspaceId,
        now: '2026-08-09T12:00:01.000Z',
      });
      assert.equal(expired.refundedCredits, 3);
      assert.match(expired.merchantMessage, /退回/);
      assert.equal(
        (await creditLedger.project(workspaceId, '2026-08-09T12:00:01.000Z'))
          .availableCredits,
        5,
      );
    } finally {
      await cleanup();
    }
  },
);

test(
  'Postgres authority terminal classification never reserves after confirmed or unreconciled decided',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const fixture = await createFixture();
    const authorityStore = new PostgresConfirmationAuthorityStore(fixture.pool);
    try {
      await authorityStore.migrate();
      await fixture.creditLedger.grant({
        id: 'confirm-terminal-balance',
        workspaceId: fixture.workspaceId,
        credits: 20,
        expirationDate: '2026-09-01T00:00:00.000Z',
        transactionType: 'PURCHASE_PACKAGE',
        sourceRef: 'confirm-terminal-balance',
        createdAt: '2026-08-01T00:00:00.000Z',
      });
      let now = '2026-08-09T09:00:00.000Z';
      const assembler = new ConfirmationAuthorityAssembler(
        fixture.service,
        authorityStore,
        {
          getQuote(quoteId) {
            return {
              quoteId,
              revision: 1,
              taskId: `task:${quoteId}`,
              creditCost: 6,
              failureRefundsCredits: true,
            } as never;
          },
        },
        { clock: () => new Date(now) },
      );
      const putAuthority = (workflowId: string) =>
        authorityStore.putCurrent({
          workflowId,
          workspaceId: fixture.workspaceId,
          planId: `plan:${workflowId}`,
          planRevision: 1,
          snapshotHash: `snapshot:${workflowId}`,
          quoteRef: { id: `quote:${workflowId}`, revision: 1 },
          rightsRevisionRefs: [],
          factRevisionRefs: [],
          frozenAt: now,
        });
      const command = (workflowId: string) => ({
        actorId: 'merchant-terminal',
        workspaceId: fixture.workspaceId,
        workflowId,
      });

      await putAuthority('workflow-confirmed');
      const confirmed = await assembler.createRequest(command('workflow-confirmed'));
      await fixture.service.decide({
        decisionId: 'decision-confirmed-pg',
        requestId: confirmed.stored.request.requestId,
        workspaceId: fixture.workspaceId,
        actorId: 'merchant-terminal',
        decision: 'confirmed',
        decidedAt: now,
      });
      now = '2026-08-09T09:01:00.000Z';
      const confirmedReplay = await assembler.createRequest(
        command('workflow-confirmed'),
      );
      assert.equal(
        confirmedReplay.stored.request.requestId,
        confirmed.stored.request.requestId,
      );
      assert.equal(
        (await fixture.creditLedger.project(fixture.workspaceId, now))
          .availableCredits,
        14,
      );

      await putAuthority('workflow-unreconciled');
      const unreconciled = await assembler.createRequest(
        command('workflow-unreconciled'),
      );
      await fixture.requestStore.markStatus({
        requestId: unreconciled.stored.request.requestId,
        status: 'decided',
        expectedStatus: 'pending',
      });
      await assert.rejects(
        () => assembler.createRequest(command('workflow-unreconciled')),
        (error: unknown) =>
          error instanceof ExecutionConfirmationError &&
          error.code === 'INVALID_STATE',
      );
      assert.equal(
        (await fixture.creditLedger.project(fixture.workspaceId, now))
          .availableCredits,
        8,
      );
      await fixture.service.decide({
        decisionId: 'decision-reconciled-rejected-pg',
        requestId: unreconciled.stored.request.requestId,
        workspaceId: fixture.workspaceId,
        actorId: 'merchant-terminal',
        decision: 'rejected',
        decidedAt: now,
      });
      assert.equal(
        (await fixture.creditLedger.project(fixture.workspaceId, now))
          .availableCredits,
        14,
      );

      const rejectedSuccessor = await assembler.createRequest(
        command('workflow-unreconciled'),
      );
      await fixture.service.expireHold({
        requestId: rejectedSuccessor.stored.request.requestId,
        workspaceId: fixture.workspaceId,
        now: '2026-08-12T09:00:00.000Z',
      });
      now = '2026-08-12T09:01:00.000Z';
      const expiredSuccessor = await assembler.createRequest(
        command('workflow-unreconciled'),
      );
      assert.notEqual(
        expiredSuccessor.stored.request.requestId,
        rejectedSuccessor.stored.request.requestId,
      );
      await fixture.service.expireHold({
        requestId: rejectedSuccessor.stored.request.requestId,
        workspaceId: fixture.workspaceId,
        now: '2026-08-12T09:02:00.000Z',
      });
      assert.equal(
        (await fixture.creditLedger.project(fixture.workspaceId, now))
          .availableCredits,
        8,
      );
    } finally {
      await fixture.cleanup();
    }
  },
);

test(
  'savePendingWithClient joins the caller transaction: rollback removes both the request row and the reserve (P1-b)',
  {
    skip: connectionString ? false : 'TEST_DATABASE_URL is not configured',
  },
  async () => {
    const fixture = await createFixture();
    const { creditLedger, requestStore, workspaceId, cleanup } = fixture;
    try {
      await creditLedger.grant({
        id: 'confirm-pkg-p1b',
        workspaceId,
        credits: 5,
        expirationDate: '2026-09-01T00:00:00.000Z',
        transactionType: 'PURCHASE_PACKAGE',
        sourceRef: 'confirm-p1b',
        createdAt: '2026-08-01T00:00:00.000Z',
      });

      const createdAt = '2026-08-08T12:00:00.000Z';
      const client = await fixture.pool.connect();
      try {
        await client.query('BEGIN');
        await creditLedger.consumeWithClient(client, {
          workspaceId,
          credits: 3,
          transactionId: 'reserve-p1b',
          actorId: 'merchant-p1b',
          correlationId: 'confirmation:req-p1b',
          createdAt,
        });
        await requestStore.savePendingWithClient(client, {
          request: agentExecutionConfirmationRequestSchema.parse({
            schemaVersion: 'agent-execution-confirmation-request/v1',
            requestId: 'req-p1b',
            workspaceId,
            planId: 'plan-p1b',
            planRevision: 1,
            snapshotHash: 'snap-p1b',
            quoteRef: { id: 'quote-p1b', revision: 1 },
            reservationIdempotencyKey: 'reserve-p1b',
            createdAt,
            holdExpiresAt: '2026-08-09T12:00:00.000Z',
            status: 'pending',
          }),
          projection: {
            reservedCredits: 3,
            failureRefundsCredits: true,
            rightsSummary: null,
            factSummary: null,
          } satisfies ConfirmationRequestProjectionFacts,
        });
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }

      // The row insert went through the same transaction as the reserve:
      // a rollback must leave neither an orphan request row nor a deduction.
      assert.equal(await requestStore.getById('req-p1b'), null);
      const projection = await creditLedger.project(workspaceId, createdAt);
      assert.equal(projection.availableCredits, 5);
      assert.equal(projection.usedCredits, 0);
    } finally {
      await cleanup();
    }
  },
);

test(
  'createRequest with insufficient balance leaves no orphan request row (A3)',
  {
    skip: connectionString ? false : 'TEST_DATABASE_URL is not configured',
  },
  async () => {
    const fixture = await createFixture();
    const { service, creditLedger, workspaceId, cleanup } = fixture;
    try {
      await creditLedger.grant({
        id: 'confirm-pkg-short',
        workspaceId,
        credits: 2,
        expirationDate: '2026-09-01T00:00:00.000Z',
        transactionType: 'PURCHASE_PACKAGE',
        sourceRef: 'confirm-short',
        createdAt: '2026-08-01T00:00:00.000Z',
      });

      await assert.rejects(
        () =>
          service.createRequest({
            requestId: 'req-short',
            workspaceId,
            planId: 'plan-short',
            planRevision: 1,
            snapshotHash: 'snap-short',
            quoteRef: { id: 'quote-short', revision: 1 },
            reservationIdempotencyKey: 'reserve-short',
            createdAt: '2026-08-08T12:00:00.000Z',
            holdExpiresAt: '2026-08-09T12:00:00.000Z',
            actorId: 'merchant-short',
            creditCost: 5,
            failureRefundsCredits: true,
          }),
        /Insufficient credits/i,
      );
      assert.equal(await service.getRequest('req-short'), null);
      const projection = await creditLedger.project(
        workspaceId,
        '2026-08-08T12:00:00.000Z',
      );
      assert.equal(projection.availableCredits, 2);
      assert.equal(projection.usedCredits, 0);
    } finally {
      await cleanup();
    }
  },
);

test(
  'createRequest same requestId re-entry never double-consumes (idempotent)',
  {
    skip: connectionString ? false : 'TEST_DATABASE_URL is not configured',
  },
  async () => {
    const fixture = await createFixture();
    const { service, creditLedger, workspaceId, cleanup } = fixture;
    try {
      await creditLedger.grant({
        id: 'confirm-pkg-replay',
        workspaceId,
        credits: 10,
        expirationDate: '2026-09-01T00:00:00.000Z',
        transactionType: 'PURCHASE_PACKAGE',
        sourceRef: 'confirm-replay',
        createdAt: '2026-08-01T00:00:00.000Z',
      });

      const createdAt = '2026-08-08T12:00:00.000Z';
      const input = {
        requestId: 'req-replay',
        workspaceId,
        planId: 'plan-replay',
        planRevision: 1,
        snapshotHash: 'snap-replay',
        quoteRef: { id: 'quote-replay', revision: 1 },
        reservationIdempotencyKey: 'reserve-replay',
        createdAt,
        holdExpiresAt: '2026-08-09T12:00:00.000Z',
        actorId: 'merchant-replay',
        creditCost: 3,
        failureRefundsCredits: true,
      };
      const first = await service.createRequest(input);
      const replay = await service.createRequest(input);
      assert.equal(replay.stored.request.requestId, first.stored.request.requestId);
      assert.equal(replay.reservedCredits, 3);
      const projection = await creditLedger.project(workspaceId, createdAt);
      assert.equal(projection.availableCredits, 7);
      assert.equal(projection.usedCredits, 3);
    } finally {
      await cleanup();
    }
  },
);

test(
  'decision command rolls back and replays exactly once after a crash following decision append',
  {
    skip: connectionString ? false : 'TEST_DATABASE_URL is not configured',
  },
  async () => {
    const fixture = await createFixture();
    const {
      service,
      creditLedger,
      decisionStore,
      requestStore,
      workspaceId,
      cleanup,
    } = fixture;
    try {
      await seedRejectedConfirmation(fixture, 'append');
      const originalAppend = decisionStore.appendWithClient.bind(decisionStore);
      let crash = true;
      decisionStore.appendWithClient = async (client, decision) => {
        const appended = await originalAppend(client, decision);
        if (crash) {
          crash = false;
          throw new Error('injected crash after decision append');
        }
        return appended;
      };
      const command = rejectedDecision(workspaceId, 'append');

      await assert.rejects(() => service.decide(command), /injected crash/);
      assert.equal(await decisionStore.getByRequestId(command.requestId), null);
      assert.equal(
        (await requestStore.getByWorkspaceId(workspaceId, command.requestId))
          ?.request.status,
        'pending',
      );
      assert.equal(
        (await creditLedger.project(workspaceId, command.decidedAt))
          .availableCredits,
        6,
      );

      const replay = await service.decide(command);
      assert.equal(replay.request.status, 'decided');
      assert.equal(replay.refundedCredits, 4);
      assert.equal(
        (await creditLedger.project(workspaceId, command.decidedAt))
          .availableCredits,
        10,
      );
    } finally {
      await cleanup();
    }
  },
);

test(
  'decision command rolls back and replays exactly once after a crash following status transition',
  {
    skip: connectionString ? false : 'TEST_DATABASE_URL is not configured',
  },
  async () => {
    const fixture = await createFixture();
    const {
      service,
      creditLedger,
      decisionStore,
      requestStore,
      workspaceId,
      cleanup,
    } = fixture;
    try {
      await seedRejectedConfirmation(fixture, 'status');
      const originalMark =
        requestStore.markStatusForWorkspaceWithClient.bind(requestStore);
      let crash = true;
      requestStore.markStatusForWorkspaceWithClient = async (client, input) => {
        const updated = await originalMark(client, input);
        if (crash) {
          crash = false;
          throw new Error('injected crash after status transition');
        }
        return updated;
      };
      const command = rejectedDecision(workspaceId, 'status');

      await assert.rejects(() => service.decide(command), /injected crash/);
      assert.equal(
        (await requestStore.getByWorkspaceId(workspaceId, command.requestId))
          ?.request.status,
        'pending',
      );
      assert.equal(
        (await creditLedger.project(workspaceId, command.decidedAt))
          .availableCredits,
        6,
      );

      const replay = await service.decide(command);
      assert.equal(replay.request.status, 'decided');
      assert.equal(replay.refundedCredits, 4);
      assert.equal(
        (await creditLedger.project(workspaceId, command.decidedAt))
          .availableCredits,
        10,
      );
    } finally {
      await cleanup();
    }
  },
);

test(
  'create transaction uses only client-aware balance and request reads',
  {
    skip: connectionString ? false : 'TEST_DATABASE_URL is not configured',
  },
  async () => {
    const fixture = await createFixture();
    const { service, creditLedger, requestStore, workspaceId, cleanup } =
      fixture;
    try {
      await creditLedger.grant({
        id: 'confirm-pkg-client-only',
        workspaceId,
        credits: 10,
        expirationDate: '2026-09-01T00:00:00.000Z',
        transactionType: 'PURCHASE_PACKAGE',
        sourceRef: 'confirm-client-only',
        createdAt: '2026-08-01T00:00:00.000Z',
      });
      creditLedger.project = async () => {
        throw new Error('pool project forbidden inside transaction');
      };
      requestStore.getById = async () => {
        throw new Error('pool request read forbidden inside transaction');
      };

      const created = await service.createRequest({
        requestId: 'req-client-only',
        workspaceId,
        planId: 'plan-client-only',
        planRevision: 1,
        snapshotHash: 'snap-client-only',
        quoteRef: { id: 'quote-client-only', revision: 1 },
        reservationIdempotencyKey: 'reserve-client-only',
        createdAt: '2026-08-08T12:00:00.000Z',
        holdExpiresAt: '2026-08-09T12:00:00.000Z',
        actorId: 'merchant-client-only',
        creditCost: 4,
        failureRefundsCredits: true,
      });
      assert.equal(created.reservedCredits, 4);
    } finally {
      await cleanup();
    }
  },
);

test(
  'savePending conflict resolves through the caller client without a pool read',
  {
    skip: connectionString ? false : 'TEST_DATABASE_URL is not configured',
  },
  async () => {
    const fixture = await createFixture();
    const { requestStore, workspaceId, cleanup } = fixture;
    const client = await fixture.pool.connect();
    try {
      const input = {
        request: agentExecutionConfirmationRequestSchema.parse({
          schemaVersion: 'agent-execution-confirmation-request/v1',
          requestId: 'req-conflict-client',
          workspaceId,
          planId: 'plan-conflict-client',
          planRevision: 1,
          snapshotHash: 'snap-conflict-client',
          quoteRef: { id: 'quote-conflict-client', revision: 1 },
          reservationIdempotencyKey: 'reserve-conflict-client',
          createdAt: '2026-08-08T12:00:00.000Z',
          holdExpiresAt: '2026-08-09T12:00:00.000Z',
          status: 'pending',
        }),
        projection: {
          reservedCredits: 0,
          failureRefundsCredits: true,
          rightsSummary: null,
          factSummary: null,
        } satisfies ConfirmationRequestProjectionFacts,
      };
      await requestStore.savePending(input);
      requestStore.getById = async () => {
        throw new Error('pool conflict read forbidden');
      };
      await client.query('BEGIN');
      const replay = await requestStore.savePendingWithClient(client, input);
      await client.query('COMMIT');
      assert.equal(replay.request.requestId, input.request.requestId);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
      await cleanup();
    }
  },
);

test(
  'pg-boss expiry owner survives restart and refunds a due hold exactly once',
  {
    skip: connectionString ? false : 'TEST_DATABASE_URL is not configured',
  },
  async () => {
    const fixture = await createFixture();
    const {
      service,
      creditLedger,
      decisionStore,
      requestStore,
      workspaceId,
      cleanup,
    } = fixture;
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const bossSchema = `confirm_boss_${suffix}`;
    const queuePrefix = `confirm-${suffix}`;
    let runtime: PgBossJobPort | undefined;
    let worker: { stop(): Promise<void> } | undefined;
    try {
      await creditLedger.grant({
        id: 'confirm-pkg-sweeper',
        workspaceId,
        credits: 10,
        expirationDate: '2026-09-01T00:00:00.000Z',
        transactionType: 'PURCHASE_PACKAGE',
        sourceRef: 'confirm-sweeper',
        createdAt: '2026-08-01T00:00:00.000Z',
      });
      await service.createRequest({
        requestId: 'req-sweeper',
        workspaceId,
        planId: 'plan-sweeper',
        planRevision: 1,
        snapshotHash: 'snap-sweeper',
        quoteRef: { id: 'quote-sweeper', revision: 1 },
        reservationIdempotencyKey: 'reserve-sweeper',
        createdAt: '2026-08-08T12:00:00.000Z',
        holdExpiresAt: '2026-08-09T08:00:00.000Z',
        actorId: 'merchant-sweeper',
        creditCost: 4,
        failureRefundsCredits: true,
      });
      runtime = PgBossJobPort.connect({
        connection: { connectionString, schema: bossSchema },
        queuePrefix,
        clock: () => new Date('2026-08-09T12:00:01.000Z'),
      });
      await registerConfirmationExpirySchedule(runtime);
      assert.equal((await runtime.listRecurring()).length, 1);
      await runtime.enqueue({
        jobId: 'confirmation-expiry-after-restart-1',
        workspaceId: '__system__',
        kind: CONFIRMATION_EXPIRY_JOB_KIND,
        payload: {},
      });
      await runtime.stop();

      const restartedService = new ExecutionConfirmationService(
        requestStore,
        decisionStore,
        confirmationCreditPortFromPostgresLedger(creditLedger),
      );
      runtime = PgBossJobPort.connect({
        connection: { connectionString, schema: bossSchema },
        queuePrefix,
        clock: () => new Date('2026-08-09T12:00:01.000Z'),
      });
      worker = await runtime.startWorker(
        createConfirmationExpiryJobHandler(restartedService),
      );
      await waitForConfirmation(async () => {
        const stored = await requestStore.getByWorkspaceId(
          workspaceId,
          'req-sweeper',
        );
        return stored?.request.status === 'expired' ? stored : null;
      });
      await worker.stop();
      worker = undefined;
      await runtime.stop();

      const secondRestartedService = new ExecutionConfirmationService(
        requestStore,
        decisionStore,
        confirmationCreditPortFromPostgresLedger(creditLedger),
      );
      runtime = PgBossJobPort.connect({
        connection: { connectionString, schema: bossSchema },
        queuePrefix,
        clock: () => new Date('2026-08-09T13:00:00.000Z'),
      });
      await runtime.enqueue({
        jobId: 'confirmation-expiry-after-restart-2',
        workspaceId: '__system__',
        kind: CONFIRMATION_EXPIRY_JOB_KIND,
        payload: {},
      });
      worker = await runtime.startWorker(
        createConfirmationExpiryJobHandler(secondRestartedService),
      );
      await waitForConfirmation(async () => {
        const inspection = await runtime?.inspect(
          '__system__',
          'confirmation-expiry-after-restart-2',
        );
        return inspection?.status === 'completed' ? inspection : null;
      });
      assert.equal(
        (await requestStore.getByWorkspaceId(workspaceId, 'req-sweeper'))
          ?.request.status,
        'expired',
      );
      assert.equal(
        (
          await creditLedger.project(
            workspaceId,
            '2026-08-09T13:00:00.000Z',
          )
        ).availableCredits,
        10,
      );
      const refund = (await creditLedger.listTransactions(workspaceId)).find(
        (row) => row.transactionType === 'REFUND',
      );
      assert.equal(refund?.actorId, 'system:confirmation-expiry-sweeper');
      assert.equal(
        (await creditLedger.listTransactions(workspaceId)).filter(
          (row) => row.transactionType === 'REFUND',
        ).length,
        1,
      );
    } finally {
      await worker?.stop().catch(() => undefined);
      await runtime?.stop().catch(() => undefined);
      const cleanupPool = new Pool({ connectionString });
      await cleanupPool
        .query(`DROP SCHEMA IF EXISTS "${bossSchema}" CASCADE`)
        .catch(() => undefined);
      await cleanupPool.end();
      await cleanup();
    }
  },
);

test(
  'request unique decision conflict maps to DECISION_IMMUTABLE instead of leaking pg 23505',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const { cleanup, service, creditLedger, workspaceId } = await createFixture();
    try {
      await creditLedger.grant({
        id: 'decision-request-unique-lot',
        workspaceId,
        credits: 10,
        expirationDate: '2026-09-01T00:00:00.000Z',
        transactionType: 'PURCHASE_PACKAGE',
        sourceRef: 'decision-request-unique',
        createdAt: '2026-08-01T00:00:00.000Z',
      });
      await service.createRequest({
        requestId: 'req-decision-request-unique',
        workspaceId,
        planId: 'plan-decision-request-unique',
        planRevision: 1,
        snapshotHash: 'snapshot-decision-request-unique',
        quoteRef: { id: 'quote-decision-request-unique', revision: 1 },
        reservationIdempotencyKey: 'reserve-decision-request-unique',
        createdAt: '2026-08-09T12:00:00.000Z',
        holdExpiresAt: '2026-08-10T12:00:00.000Z',
        actorId: 'merchant-1',
        creditCost: 1,
        failureRefundsCredits: true,
      });
      await service.decide({
        decisionId: 'decision-request-unique-1',
        requestId: 'req-decision-request-unique',
        workspaceId,
        actorId: 'merchant-1',
        decision: 'confirmed',
        decidedAt: '2026-08-09T12:10:00.000Z',
      });
      await assert.rejects(
        () => service.decide({
          decisionId: 'decision-request-unique-2',
          requestId: 'req-decision-request-unique',
          workspaceId,
          actorId: 'merchant-1',
          decision: 'confirmed',
          decidedAt: '2026-08-09T12:11:00.000Z',
        }),
        (error: unknown) =>
          error instanceof ExecutionConfirmationError &&
          error.code === 'DECISION_IMMUTABLE',
      );
    } finally {
      await cleanup();
    }
  },
);

function rejectedDecision(workspaceId: string, suffix: string) {
  return {
    decisionId: `dec-crash-${suffix}`,
    requestId: `req-crash-${suffix}`,
    workspaceId,
    actorId: 'merchant-crash',
    decision: 'rejected' as const,
    decidedAt: '2026-08-08T13:00:00.000Z',
  };
}

async function seedRejectedConfirmation(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  suffix: string,
) {
  await fixture.creditLedger.grant({
    id: `confirm-pkg-crash-${suffix}`,
    workspaceId: fixture.workspaceId,
    credits: 10,
    expirationDate: '2026-09-01T00:00:00.000Z',
    transactionType: 'PURCHASE_PACKAGE',
    sourceRef: `confirm-crash-${suffix}`,
    createdAt: '2026-08-01T00:00:00.000Z',
  });
  await fixture.service.createRequest({
    requestId: `req-crash-${suffix}`,
    workspaceId: fixture.workspaceId,
    planId: `plan-crash-${suffix}`,
    planRevision: 1,
    snapshotHash: `snap-crash-${suffix}`,
    quoteRef: { id: `quote-crash-${suffix}`, revision: 1 },
    reservationIdempotencyKey: `reserve-crash-${suffix}`,
    createdAt: '2026-08-08T12:00:00.000Z',
    holdExpiresAt: '2026-08-09T12:00:00.000Z',
    actorId: 'merchant-crash',
    creditCost: 4,
    failureRefundsCredits: true,
  });
}

async function createFixture() {
  const schema = `confirm_${randomUUID().replaceAll('-', '')}`;
  const pool = new Pool({ connectionString });
  await pool.query(`CREATE SCHEMA ${schema}`);
  await pool.query(`SET search_path TO ${schema}`);
  // Re-bind search_path for subsequent connections from this pool.
  pool.on('connect', (client) => {
    void client.query(`SET search_path TO ${schema}`);
  });

  const workspaceId = `ws-confirm-${randomUUID()}`;
  await pool.query(`
    CREATE TABLE workspaces (
      id text PRIMARY KEY,
      name text NOT NULL
    )
  `);
  await pool.query(
    "INSERT INTO workspaces (id, name) VALUES ($1, 'Confirmation A3')",
    [workspaceId],
  );

  const creditLedger = new PostgresCreditLedger(pool);
  const migration = new PostgresExecutionConfirmationMigration(pool);
  const client = await pool.connect();
  try {
    await client.query(`SET search_path TO ${schema}`);
    await creditLedger.migrate(client);
    await migration.migrate(client);
  } finally {
    client.release();
  }

  const service = new ExecutionConfirmationService(
    migration.requestStore,
    migration.decisionStore,
    confirmationCreditPortFromPostgresLedger(creditLedger),
  );

  return {
    service,
    creditLedger,
    decisionStore: migration.decisionStore,
    requestStore: migration.requestStore,
    pool,
    workspaceId,
    async cleanup() {
      await pool.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => undefined);
      await pool.end();
    },
  };
}

async function waitForConfirmation<T>(
  read: () => Promise<T | null>,
  timeoutMs = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for confirmation job completion.');
}
