import assert from 'node:assert/strict';
import test from 'node:test';

import { MemoryConfirmationAuthorityStore } from './execution-confirmation-authority-store.js';
import { ExecutionConfirmationError } from './execution-confirmation-store.js';

function authority(planRevision: number, snapshotHash: string, frozenAt: string) {
  return {
    workflowId: 'workflow-cas',
    workspaceId: 'ws-cas',
    planId: 'plan-cas',
    planRevision,
    snapshotHash,
    quoteRef: { id: `quote-${planRevision}`, revision: planRevision },
    rightsRevisionRefs: [`rights-${planRevision}`],
    factRevisionRefs: [`fact-${planRevision}`],
    frozenAt,
  };
}

test('memory authority CAS uses plan revision order and treats frozenAt as a fact', async () => {
  const store = new MemoryConfirmationAuthorityStore();
  const revision2 = authority(2, 'snapshot-2', '2026-08-09T08:00:00.000Z');
  await store.putCurrent(revision2);

  await assert.rejects(
    () => store.putCurrent(authority(1, 'snapshot-1', '2099-01-01T00:00:00.000Z')),
    (error: unknown) =>
      error instanceof ExecutionConfirmationError &&
      error.code === 'IDEMPOTENCY_CONFLICT',
  );
  assert.deepEqual(
    await store.putCurrent(authority(2, 'snapshot-2', '1999-01-01T00:00:00.000Z')),
    revision2,
  );
  await assert.rejects(
    () => store.putCurrent(authority(2, 'snapshot-other', revision2.frozenAt)),
    (error: unknown) =>
      error instanceof ExecutionConfirmationError &&
      error.code === 'IDEMPOTENCY_CONFLICT',
  );

  const concurrent = new MemoryConfirmationAuthorityStore();
  const [higher, lower] = await Promise.allSettled([
    concurrent.putCurrent(authority(4, 'snapshot-4', revision2.frozenAt)),
    concurrent.putCurrent(authority(3, 'snapshot-3', revision2.frozenAt)),
  ]);
  assert.equal(higher.status, 'fulfilled');
  assert.equal(lower.status, 'rejected');
  assert.equal(
    (await concurrent.getCurrentByWorkflowId('workflow-cas'))?.planRevision,
    4,
  );

  const inverse = new MemoryConfirmationAuthorityStore();
  await Promise.allSettled([
    inverse.putCurrent(authority(3, 'snapshot-3', revision2.frozenAt)),
    inverse.putCurrent(authority(4, 'snapshot-4', revision2.frozenAt)),
  ]);
  assert.equal(
    (await inverse.getCurrentByWorkflowId('workflow-cas'))?.planRevision,
    4,
  );
});
