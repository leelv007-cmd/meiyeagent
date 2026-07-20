import assert from 'node:assert/strict';
import test from 'node:test';
import { CONTEXT_SOURCE_REVISION_KEYS } from '@meiye/contracts';
import {
  ContextBundleRevisionConflictError,
  MemoryContextBundleRepository,
} from './context-bundle-repository.js';
import { compileContextBundle } from './context-compiler.js';

const sourceRevisions = Object.fromEntries(
  CONTEXT_SOURCE_REVISION_KEYS.map((key) => [key, 1]),
);

function compiled(revisionOverrides: Record<string, number> = {}) {
  return compileContextBundle({
    workspaceId: 'workspace-a',
    taskId: 'task-a',
    sourceRevisions: { ...sourceRevisions, ...revisionOverrides } as never,
    contributions: [],
  });
}

test('freezing and recompiling append immutable bundle revisions and one event', async () => {
  const repository = new MemoryContextBundleRepository();
  const first = await repository.freeze({
    workspaceId: 'workspace-a',
    bundleId: 'bundle-a',
    compiled: compiled(),
    expectedRevision: 0,
    frozenAt: '2026-07-18T01:00:00.000Z',
    frozenBy: 'owner-a',
    idempotencyKey: 'freeze-1',
    reason: 'initial compile',
  });
  const second = await repository.freeze({
    workspaceId: 'workspace-a',
    bundleId: 'bundle-a',
    compiled: compiled({ facts: 2 }),
    expectedRevision: 1,
    frozenAt: '2026-07-18T02:00:00.000Z',
    frozenBy: 'owner-a',
    idempotencyKey: 'freeze-2',
    reason: 'price fact changed',
  });

  assert.equal(first.revision, 1);
  assert.equal(second.revision, 2);
  assert.equal(second.previousRevision, 1);
  assert.equal(first.sourceRevisions.facts, 1);
  assert.equal(second.sourceRevisions.facts, 2);
  assert.deepEqual(
    (await repository.history('workspace-a', 'bundle-a')).map(
      (bundle) => bundle.revision,
    ),
    [1, 2],
  );
  const events = await repository.listRecompileEvents(
    'workspace-a',
    'bundle-a',
  );
  assert.equal(events.length, 1);
  assert.deepEqual(events[0]?.changedSources, ['facts']);
});

test('freeze is replay-safe and rejects stale or unfenced recompiles', async () => {
  const repository = new MemoryContextBundleRepository();
  const command = {
    workspaceId: 'workspace-a',
    bundleId: 'bundle-a',
    compiled: compiled(),
    expectedRevision: 0,
    frozenAt: '2026-07-18T01:00:00.000Z',
    frozenBy: 'owner-a',
    idempotencyKey: 'freeze-1',
    reason: 'initial compile',
  };
  const first = await repository.freeze(command);
  assert.deepEqual(await repository.freeze(command), first);
  await assert.rejects(
    repository.freeze({
      ...command,
      idempotencyKey: 'freeze-stale',
    }),
    ContextBundleRevisionConflictError,
  );
  await assert.rejects(
    repository.freeze({
      ...command,
      expectedRevision: 1,
      idempotencyKey: 'freeze-without-fence-change',
    }),
    /source revision change/,
  );
});
