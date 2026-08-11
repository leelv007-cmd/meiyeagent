/**
 * V31-33 / V31-41 focused unit tests: recovery fairness signal + prepare
 * terminal attempt budget (no PG required).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CreationSubmissionCoordinator,
  PREPARE_FAILURE_TERMINAL_ATTEMPTS,
  PREPARE_TERMINAL_REFUND_MAX_ATTEMPTS,
  PrepareTerminalRejectionError,
  type CreationSubmissionHarnessStarter,
  type CreationSubmissionRecord,
  type CreationSubmissionStore,
} from './submission-coordinator.js';

function submission(
  workspaceId: string,
  id: string,
): CreationSubmissionRecord {
  return {
    snapshot: {
      id,
      workspaceId,
    },
  } as unknown as CreationSubmissionRecord;
}

function makeCoordinator(input: {
  store: CreationSubmissionStore;
  harness: CreationSubmissionHarnessStarter;
  agentPlanning?: { prepare: (input: unknown) => Promise<unknown> };
}) {
  return new CreationSubmissionCoordinator(
    input.store,
    input.harness,
    {
      createId: (prefix) => `${prefix}-x`,
      now: () => '2026-08-11T00:00:00.000Z',
    },
    {
      async admit() {
        throw new Error('admit unused in recovery tests');
      },
    },
    undefined,
    input.agentPlanning as never,
  );
}

function recoveryStore(
  overrides: Partial<CreationSubmissionStore>,
): CreationSubmissionStore {
  const unavailable = async (): Promise<never> => {
    throw new Error("recovery test store method was not configured");
  };
  return {
    readReceipt: unavailable,
    claim: unavailable,
    persistAgentPlanning: unavailable,
    claimHarnessStart: unavailable,
    markHarnessStartDispatched: unavailable,
    completeHarnessStart: unavailable,
    releaseHarnessStart: unavailable,
    failHarnessStart: unavailable,
    listRecoverableHarnessStarts: unavailable,
    ...overrides,
  };
}

test('V31-33 listRecoverableHarnessStarts is invoked with the sweep limit', async () => {
  const calls: Array<{ limit: number; perWorkspaceLimit?: number }> = [];
  const store = recoveryStore({
    async listRecoverableHarnessStarts(input: {
      limit: number;
      perWorkspaceLimit?: number;
    }) {
      calls.push(input);
      return [];
    },
    async claimHarnessStart() {
      return { kind: 'started' as const };
    },
  });

  const coordinator = makeCoordinator({
    store,
    harness: {
      async start() {},
    } as CreationSubmissionHarnessStarter,
  });

  await coordinator.recoverPendingStarts(40);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.limit, 40);
});

test('V31-41 prepare permanent failure terminalizes and refunds once', async () => {
  const attemptsById = new Map<string, number>();
  const terminalized: string[] = [];
  const refunds: string[] = [];
  const completedRefunds: string[] = [];
  const row = submission('ws-a', 'sub-permanent');

  const store = recoveryStore({
    async listRecoverableHarnessStarts() {
      return [{ submission: structuredClone(row) }];
    },
    async recordPrepareFailure(input: {
      submissionId: string;
      terminal: boolean;
      skipAttemptIncrement?: boolean;
    }) {
      const prev = attemptsById.get(input.submissionId) ?? 0;
      const attempts = input.skipAttemptIncrement ? prev : prev + 1;
      attemptsById.set(input.submissionId, attempts);
      if (input.terminal) {
        terminalized.push(input.submissionId);
        return { attempts, terminalized: true };
      }
      return { attempts, terminalized: false };
    },
    async claimHarnessStart() {
      return { kind: 'started' as const };
    },
    async claimPrepareTerminalRefunds() {
      return [{ leaseId: 'refund-lease-sub-permanent', submission: structuredClone(row) }];
    },
    async completePrepareTerminalRefund(input: { submissionId: string }) {
      completedRefunds.push(input.submissionId);
      return true;
    },
    async recordPrepareTerminalRefundFailure() {
      throw new Error('refund callback should not fail in this test');
    },
  });

  const coordinator = makeCoordinator({
    store,
    harness: {
      async start() {
        throw new Error('start must not run after prepare fails');
      },
      async classifyPrepareFailure() {
        return 'terminal_rejection';
      },
    } as CreationSubmissionHarnessStarter,
    agentPlanning: {
      async prepare() {
        throw new Error('payload permanently illegal');
      },
    },
  });

  const outcome = await coordinator.recoverPendingStarts(10, {
    onPrepareTerminalRefund: async (s) => {
      refunds.push(s.snapshot.id);
    },
  });

  assert.equal(outcome.attempted, 1);
  assert.equal(outcome.failed, 1);
  assert.equal(outcome.started, 0);
  assert.deepEqual(terminalized, ['sub-permanent']);
  assert.deepEqual(refunds, ['sub-permanent']);
  assert.deepEqual(completedRefunds, ['sub-permanent']);
  assert.equal(attemptsById.get('sub-permanent'), 1);
  assert.ok(
    outcome.failureDetails?.some(
      (d) => d.submissionId === 'sub-permanent' && d.terminal === true,
    ),
  );
});

test('V31-41 refund callback failure is durably scheduled instead of swallowed', async () => {
  const row = submission('ws-refund', 'sub-refund-retry');
  const failures: Array<{
    workspaceId: string;
    submissionId: string;
    leaseId: string;
    reason: string;
    maxAttempts: number;
  }> = [];
  const store = recoveryStore({
    async listRecoverableHarnessStarts() {
      return [];
    },
    async claimPrepareTerminalRefunds() {
      return [{ leaseId: 'refund-lease-retry', submission: structuredClone(row) }];
    },
    async completePrepareTerminalRefund() {
      throw new Error('completion must not run after a refund error');
    },
    async recordPrepareTerminalRefundFailure(input: {
      workspaceId: string;
      submissionId: string;
      leaseId: string;
      reason: string;
      maxAttempts: number;
    }) {
      failures.push(input);
      return { attempts: 1, state: 'retry_scheduled' as const };
    },
  });
  const coordinator = makeCoordinator({
    store,
    harness: { async start() {} } as CreationSubmissionHarnessStarter,
  });

  const outcome = await coordinator.recoverPendingStarts(5, {
    onPrepareTerminalRefund: async () => {
      throw new Error('billing callback unavailable');
    },
  });

  assert.equal(outcome.attempted, 0);
  assert.equal(outcome.failed, 1);
  assert.deepEqual(failures, [
    {
      workspaceId: 'ws-refund',
      submissionId: 'sub-refund-retry',
      leaseId: 'refund-lease-retry',
      reason: 'billing callback unavailable',
      maxAttempts: PREPARE_TERMINAL_REFUND_MAX_ATTEMPTS,
    },
  ]);
  assert.deepEqual(outcome.failureDetails, [
    {
      workspaceId: 'ws-refund',
      submissionId: 'sub-refund-retry',
      reason: 'billing callback unavailable',
      terminal: false,
    },
  ]);
});

test('V31-41 prepare retry budget forces terminal after max attempts', async () => {
  const attemptsById = new Map<string, number>([
    ['sub-budget', PREPARE_FAILURE_TERMINAL_ATTEMPTS - 1],
  ]);
  let terminalCalls = 0;
  const row = submission('ws-b', 'sub-budget');

  const store = recoveryStore({
    async listRecoverableHarnessStarts() {
      return [{ submission: structuredClone(row) }];
    },
    async recordPrepareFailure(input: {
      submissionId: string;
      terminal: boolean;
      skipAttemptIncrement?: boolean;
    }) {
      const prev = attemptsById.get(input.submissionId) ?? 0;
      const attempts = input.skipAttemptIncrement ? prev : prev + 1;
      attemptsById.set(input.submissionId, attempts);
      if (input.terminal) {
        terminalCalls += 1;
        return { attempts, terminalized: true };
      }
      return { attempts, terminalized: false };
    },
    async claimHarnessStart() {
      return { kind: 'started' as const };
    },
  });

  const coordinator = makeCoordinator({
    store,
    harness: {
      async start() {},
      async classifyPrepareFailure() {
        return 'retry';
      },
    } as CreationSubmissionHarnessStarter,
    agentPlanning: {
      async prepare() {
        throw new Error('provider timeout');
      },
    },
  });

  const outcome = await coordinator.recoverPendingStarts(5);
  assert.equal(outcome.failed, 1);
  assert.equal(terminalCalls, 1);
  assert.equal(attemptsById.get('sub-budget'), PREPARE_FAILURE_TERMINAL_ATTEMPTS);
});

test('V31-41 default prepare disposition never terminalizes from error text', async () => {
  const terminalInputs: boolean[] = [];
  const row = submission('ws-default', 'sub-default-retry');
  const store = recoveryStore({
    async listRecoverableHarnessStarts() {
      return [{ submission: structuredClone(row) }];
    },
    async recordPrepareFailure(input: { terminal: boolean }) {
      terminalInputs.push(input.terminal);
      return { attempts: 1, terminalized: false };
    },
    async claimHarnessStart() {
      return { kind: 'started' as const };
    },
  });
  const coordinator = makeCoordinator({
    store,
    harness: { async start() {} } as CreationSubmissionHarnessStarter,
    agentPlanning: {
      async prepare() {
        throw new Error('missing its authoritative freeze and invalid_state schema');
      },
    },
  });

  const outcome = await coordinator.recoverPendingStarts(5);

  assert.deepEqual(terminalInputs, [false]);
  assert.equal(outcome.failureDetails?.[0]?.terminal, false);
});

test('V31-41 typed prepare terminal rejection is terminal without a text classifier', async () => {
  const terminalInputs: boolean[] = [];
  const row = submission('ws-typed', 'sub-typed-terminal');
  const store = recoveryStore({
    async listRecoverableHarnessStarts() {
      return [{ submission: structuredClone(row) }];
    },
    async recordPrepareFailure(input: { terminal: boolean }) {
      terminalInputs.push(input.terminal);
      return { attempts: 1, terminalized: input.terminal };
    },
    async claimHarnessStart() {
      return { kind: 'started' as const };
    },
  });
  const coordinator = makeCoordinator({
    store,
    harness: { async start() {} } as CreationSubmissionHarnessStarter,
    agentPlanning: {
      async prepare() {
        throw new PrepareTerminalRejectionError('authoritative plan unavailable');
      },
    },
  });

  const outcome = await coordinator.recoverPendingStarts(5);

  assert.deepEqual(terminalInputs, [true]);
  assert.equal(outcome.failureDetails?.[0]?.terminal, true);
});
