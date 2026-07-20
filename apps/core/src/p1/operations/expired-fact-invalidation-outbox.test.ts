import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ExpiredFactInvalidationWorker,
  type ExpiredFactInvalidationClaim,
  type ExpiredFactInvalidationOutboxRepository,
} from './expired-fact-invalidation-outbox.js';

test('one failed expiration retries without blocking the rest of the claimed batch', async () => {
  let now = new Date('2026-07-19T08:00:00.000Z');
  const repository = new MemoryExpirationOutbox([
    claim('fact-a', 1),
    claim('fact-b', 1),
    claim('fact-c', 1),
  ]);
  const dispatched: string[] = [];
  let failFactB = true;
  const worker = new ExpiredFactInvalidationWorker(
    repository,
    {
      async invalidateExpiredFact(input) {
        dispatched.push(input.factId);
        if (input.factId === 'fact-b' && failFactB) {
          failFactB = false;
          throw new Error('temporary sink outage');
        }
      },
    },
    {
      batchSize: 10,
      clock: () => now,
      claimToken: () => `claim-${now.getTime()}`,
      retryDelayMs: 1_000,
    },
  );

  assert.deepEqual(await worker.runOnce('worker-a'), {
    claimed: 3,
    deadLettered: 0,
    delivered: 2,
    lost: 0,
    retried: 1,
    superseded: 0,
  });
  assert.deepEqual(dispatched, ['fact-a', 'fact-b', 'fact-c']);

  now = new Date('2026-07-19T08:00:01.000Z');
  assert.deepEqual(await worker.runOnce('worker-a'), {
    claimed: 1,
    deadLettered: 0,
    delivered: 1,
    lost: 0,
    retried: 0,
    superseded: 0,
  });
  assert.deepEqual(dispatched, ['fact-a', 'fact-b', 'fact-c', 'fact-b']);
});

test('an expired revision superseded before claim reaches no invalidation sink', async () => {
  const repository = new MemoryExpirationOutbox([
    { ...claim('fact-a', 1), currentRevision: 2 },
  ]);
  const dispatched: string[] = [];
  const worker = new ExpiredFactInvalidationWorker(repository, {
    async invalidateExpiredFact(input) {
      dispatched.push(input.factId);
    },
  });

  assert.deepEqual(await worker.runOnce('worker-a'), {
    claimed: 1,
    deadLettered: 0,
    delivered: 0,
    lost: 0,
    retried: 0,
    superseded: 1,
  });
  assert.deepEqual(dispatched, []);
  assert.equal(repository.status('fact-a'), 'superseded');
});

test('repeated expiration failure becomes a durable dead letter at the attempt limit', async () => {
  let now = new Date('2026-07-19T08:00:00.000Z');
  const repository = new MemoryExpirationOutbox([claim('fact-a', 1)]);
  const worker = new ExpiredFactInvalidationWorker(
    repository,
    {
      async invalidateExpiredFact() {
        throw new Error('permanent sink outage');
      },
    },
    {
      clock: () => now,
      claimToken: () => `claim-${now.getTime()}`,
      maxAttempts: 2,
      retryDelayMs: 1_000,
    },
  );

  assert.equal((await worker.runOnce('worker-a')).retried, 1);
  now = new Date('2026-07-19T08:00:01.000Z');
  const terminal = await worker.runOnce('worker-a');

  assert.equal(terminal.deadLettered, 1);
  assert.equal(terminal.retried, 0);
  assert.equal(repository.status('fact-a'), 'dead_letter');
});

function claim(
  factId: string,
  revision: number,
): ExpiredFactInvalidationClaim {
  return {
    attemptCount: 0,
    claimToken: '',
    currentRevision: revision,
    expiresAt: '2026-07-19T07:59:00.000Z',
    factId,
    revision,
    workspaceId: 'workspace-a',
  };
}

class MemoryExpirationOutbox
  implements ExpiredFactInvalidationOutboxRepository
{
  private readonly entries = new Map<
    string,
    ExpiredFactInvalidationClaim & {
      nextAttemptAt: Date;
      status:
        | 'pending'
        | 'claimed'
        | 'retry'
        | 'delivered'
        | 'dead_letter'
        | 'superseded';
    }
  >();

  constructor(claims: readonly ExpiredFactInvalidationClaim[]) {
    for (const item of claims) {
      this.entries.set(item.factId, {
        ...item,
        nextAttemptAt: new Date(0),
        status: 'pending',
      });
    }
  }

  status(factId: string) {
    return this.entries.get(factId)?.status;
  }

  async claimBatch(input: {
    claimToken: string;
    leaseMs: number;
    limit: number;
    now: Date;
    workerId: string;
  }) {
    return [...this.entries.values()]
      .filter(
        (entry) =>
          ['pending', 'retry'].includes(entry.status) &&
          entry.nextAttemptAt <= input.now,
      )
      .slice(0, input.limit)
      .map((entry) => {
        entry.status = 'claimed';
        entry.claimToken = input.claimToken;
        entry.attemptCount += 1;
        return structuredClone(entry);
      });
  }

  async markDelivered(input: { claimToken: string; factId: string }) {
    return this.settle(input, 'delivered');
  }

  async markFailed(input: {
    claimToken: string;
    deadLetter: boolean;
    error: string;
    factId: string;
    retryAt: Date;
  }) {
    const entry = this.entries.get(input.factId);
    if (entry && !input.deadLetter) entry.nextAttemptAt = input.retryAt;
    return this.settle(input, input.deadLetter ? 'dead_letter' : 'retry');
  }

  async markSuperseded(input: { claimToken: string; factId: string }) {
    return this.settle(input, 'superseded');
  }

  private settle(
    input: { claimToken: string; factId: string },
    status: 'delivered' | 'retry' | 'dead_letter' | 'superseded',
  ) {
    const entry = this.entries.get(input.factId);
    if (entry?.status !== 'claimed' || entry.claimToken !== input.claimToken) {
      return false;
    }
    entry.status = status;
    return true;
  }
}
