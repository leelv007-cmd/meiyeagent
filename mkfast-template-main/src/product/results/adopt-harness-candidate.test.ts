import assert from 'node:assert/strict';
import test from 'node:test';

import type { PublicContentPackage } from '@meiye/contracts';

import { P1RequestError } from '@/p1/client';
import {
  CONTENT_PACKAGE_REVISION_CONFLICT,
  adoptHarnessCandidateOnLatestRevision,
} from '@/product/results/adopt-harness-candidate';

function packageAtRevision(revision: number) {
  return { id: 'pkg-1', revision } as unknown as PublicContentPackage;
}

function conflict(expectedRevision: number, currentRevision: number) {
  return new P1RequestError(
    `ContentPackage revision changed from ${expectedRevision} to ${currentRevision}. Refresh and retry.`,
    CONTENT_PACKAGE_REVISION_CONFLICT,
    { currentRevision, expectedRevision },
    409
  );
}

function harness(options: { readRevisions: number[]; writeRevision: number }) {
  const reads: string[] = [];
  const writes: Array<{
    idempotencyKey: string;
    payload: Record<string, unknown>;
  }> = [];
  let refreshes = 0;
  const remaining = [...options.readRevisions];
  return {
    dependencies: {
      command: async (
        _action: string,
        payload: Record<string, unknown>,
        idempotencyKey: string
      ) => {
        writes.push({ idempotencyKey, payload });
        const expected = payload.expectedRevision as number;
        if (expected !== options.writeRevision) {
          throw conflict(expected, options.writeRevision);
        }
        return packageAtRevision(options.writeRevision + 1);
      },
      readPackage: async (packageId: string) => {
        reads.push(packageId);
        return packageAtRevision(remaining.shift() ?? 0);
      },
      refresh: async () => {
        refreshes += 1;
      },
    },
    reads,
    refreshCount: () => refreshes,
    writes,
  };
}

test('adoption spends a revision read in the command turn, not the render-time projection', async () => {
  // The workbench auto-prepares the publish handoff the moment the package
  // reads delivered, so the revision the page rendered with is already dead.
  const { dependencies, reads, writes } = harness({
    readRevisions: [2],
    writeRevision: 2,
  });
  const adopted = await adoptHarnessCandidateOnLatestRevision(
    { candidateId: 'c01', packageId: 'pkg-1' },
    dependencies
  );
  assert.deepEqual(reads, ['pkg-1']);
  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.payload.expectedRevision, 2);
  assert.equal(adopted.revision, 3);
});

test('a revision conflict refreshes once and retries on the revision it just read', async () => {
  // Core answers 409 CONTENT_PACKAGE_REVISION_CONFLICT with "Refresh and
  // retry."; the retry must carry a new idempotency key or it would replay the
  // losing attempt.
  const { dependencies, refreshCount, writes } = harness({
    readRevisions: [1, 2],
    writeRevision: 2,
  });
  const adopted = await adoptHarnessCandidateOnLatestRevision(
    { candidateId: 'c01', packageId: 'pkg-1' },
    dependencies
  );
  assert.equal(refreshCount(), 1);
  assert.deepEqual(
    writes.map(({ payload }) => payload.expectedRevision),
    [1, 2]
  );
  assert.notEqual(writes[0]?.idempotencyKey, writes[1]?.idempotencyKey);
  assert.equal(adopted.revision, 3);
});

test('a second conflict is a real disagreement and reaches the merchant', async () => {
  const { dependencies, writes } = harness({
    readRevisions: [1, 1],
    writeRevision: 3,
  });
  await assert.rejects(
    adoptHarnessCandidateOnLatestRevision(
      { candidateId: 'c01', packageId: 'pkg-1' },
      dependencies
    ),
    (error: unknown) =>
      error instanceof P1RequestError &&
      error.code === CONTENT_PACKAGE_REVISION_CONFLICT
  );
  assert.equal(writes.length, 2);
});

test('an unrelated command failure is not retried', async () => {
  let writeCount = 0;
  await assert.rejects(
    adoptHarnessCandidateOnLatestRevision(
      { candidateId: 'c01', packageId: 'pkg-1' },
      {
        command: async () => {
          writeCount += 1;
          throw new P1RequestError(
            'The Harness candidate was not found in this ContentPackage.',
            'HARNESS_CANDIDATE_NOT_FOUND',
            undefined,
            404
          );
        },
        readPackage: async () => packageAtRevision(2),
        refresh: async () => {
          assert.fail('a non-conflict failure must not refresh');
        },
      }
    ),
    (error: unknown) =>
      error instanceof P1RequestError &&
      error.code === 'HARNESS_CANDIDATE_NOT_FOUND'
  );
  assert.equal(writeCount, 1);
});
