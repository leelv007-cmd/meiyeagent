/**
 * Behavioural conformance suite for ConfirmationAuthorityStore adapters.
 *
 * The AUTHORITY_ADVANCED retry loop's correctness argument rests on the
 * store's revision/snapshot idempotency rules; until 2026-08-12 the memory
 * and PostgreSQL adapters had no shared suite, so every unit test of that
 * loop ran against an adapter whose locking and conflict semantics were
 * never compared with production's. Both adapters run these cases now
 * (model: agent-session-store-conformance.ts).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { ExecutionConfirmationError } from './execution-confirmation-store.js';
import type { ConfirmationTransactionClient } from './execution-confirmation-store.js';
import type {
  ConfirmationAuthorityStore,
  PendingConfirmationAuthority,
} from './execution-confirmation-authority-store.js';

export type ConfirmationAuthorityStoreFixture = {
  store: ConfirmationAuthorityStore;
  /** Runs `body` inside one transaction (PG: real client; memory: null client). */
  withTransaction: <T>(
    body: (client: ConfirmationTransactionClient) => Promise<T>,
  ) => Promise<T>;
  dispose: () => Promise<void>;
};

export type ConfirmationAuthorityConformanceInput = {
  label: string;
  /** Reason string skips the whole suite (environment-gated PostgreSQL runs). */
  skip?: string | false;
  createFixture: (
    caseName: string,
  ) => Promise<ConfirmationAuthorityStoreFixture>;
};

function authority(
  workflowId: string,
  overrides: Partial<PendingConfirmationAuthority> = {},
): PendingConfirmationAuthority {
  return {
    workflowId,
    workspaceId: 'ws-conformance',
    planId: 'plan-1',
    planRevision: 1,
    snapshotHash: 'hash-rev1',
    quoteRef: { id: 'quote-1', revision: 1 },
    rightsRevisionRefs: ['rights-1'],
    factRevisionRefs: ['fact-1'],
    frozenAt: '2026-08-12T00:00:00.000Z',
    ...overrides,
  };
}

export function runConfirmationAuthorityStoreConformance(
  input: ConfirmationAuthorityConformanceInput,
): void {
  const skip = input.skip ?? false;

  const conformanceTest = (
    name: string,
    body: (fixture: ConfirmationAuthorityStoreFixture) => Promise<void>,
  ) => {
    test(`${input.label}: ${name}`, { skip }, async () => {
      const fixture = await input.createFixture(name);
      try {
        await body(fixture);
      } finally {
        await fixture.dispose();
      }
    });
  };

  conformanceTest('round-trips the frozen authority', async ({ store }) => {
    const stored = await store.putCurrent(authority('wf-roundtrip'));
    assert.equal(stored.snapshotHash, 'hash-rev1');
    const read = await store.getCurrentByWorkflowId('wf-roundtrip');
    assert.deepEqual(read?.rightsRevisionRefs, ['rights-1']);
    assert.equal(await store.getCurrentByWorkflowId('wf-unknown'), null);
  });

  conformanceTest(
    'same revision and snapshot is idempotent',
    async ({ store }) => {
      await store.putCurrent(authority('wf-idem'));
      const again = await store.putCurrent(authority('wf-idem'));
      assert.equal(again.workflowId, 'wf-idem');
      assert.equal(again.planRevision, 1);
    },
  );

  conformanceTest(
    'same revision with a different snapshot fails closed',
    async ({ store }) => {
      await store.putCurrent(authority('wf-snap'));
      await assert.rejects(
        store.putCurrent(authority('wf-snap', { snapshotHash: 'hash-other' })),
        (error: unknown) =>
          error instanceof ExecutionConfirmationError &&
          error.code === 'IDEMPOTENCY_CONFLICT',
      );
    },
  );

  conformanceTest(
    'an older revision never overwrites a newer frozen plan',
    async ({ store }) => {
      await store.putCurrent(
        authority('wf-rev', { planRevision: 3, snapshotHash: 'hash-rev3' }),
      );
      await assert.rejects(
        store.putCurrent(
          authority('wf-rev', { planRevision: 2, snapshotHash: 'hash-rev2' }),
        ),
        (error: unknown) =>
          error instanceof ExecutionConfirmationError &&
          error.code === 'IDEMPOTENCY_CONFLICT',
      );
      const current = await store.getCurrentByWorkflowId('wf-rev');
      assert.equal(current?.planRevision, 3);
      assert.equal(current?.snapshotHash, 'hash-rev3');
    },
  );

  conformanceTest('a newer revision replaces the frozen plan', async ({ store }) => {
    await store.putCurrent(authority('wf-adv'));
    const advanced = await store.putCurrent(
      authority('wf-adv', { planRevision: 2, snapshotHash: 'hash-rev2' }),
    );
    assert.equal(advanced.planRevision, 2);
    const current = await store.getCurrentByWorkflowId('wf-adv');
    assert.equal(current?.snapshotHash, 'hash-rev2');
  });

  conformanceTest(
    'a workflow id never crosses workspaces',
    async ({ store }) => {
      await store.putCurrent(authority('wf-tenant'));
      await assert.rejects(
        store.putCurrent(
          authority('wf-tenant', {
            workspaceId: 'ws-other',
            planRevision: 9,
            snapshotHash: 'hash-other',
          }),
        ),
        (error: unknown) =>
          error instanceof ExecutionConfirmationError &&
          error.code === 'NOT_FOUND',
      );
    },
  );

  conformanceTest(
    'clearCurrent only removes the matching snapshot',
    async ({ store }) => {
      await store.putCurrent(authority('wf-clear'));
      await store.clearCurrent('wf-clear', 'hash-stale');
      assert.ok(await store.getCurrentByWorkflowId('wf-clear'));
      await store.clearCurrent('wf-clear', 'hash-rev1');
      assert.equal(await store.getCurrentByWorkflowId('wf-clear'), null);
    },
  );

  conformanceTest(
    'transactional read sees the transactional write',
    async ({ store, withTransaction }) => {
      await withTransaction(async (client) => {
        await store.putCurrentInTransaction(client, authority('wf-tx'));
        const inTx = await store.getCurrentByWorkflowIdInTransaction(
          client,
          'wf-tx',
          true,
        );
        assert.equal(inTx?.snapshotHash, 'hash-rev1');
      });
      const committed = await store.getCurrentByWorkflowId('wf-tx');
      assert.equal(committed?.planRevision, 1);
    },
  );
}
