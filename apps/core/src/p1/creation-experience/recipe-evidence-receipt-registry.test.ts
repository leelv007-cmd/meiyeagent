import assert from 'node:assert/strict';
import test from 'node:test';

import { P1DomainError } from '../foundation/domain.js';
import { MemoryRecipeEvidenceReceiptRegistry } from './recipe-evidence-receipt-registry.js';
import type { RecipeEvidenceReceipt } from './recipe-evidence-ports.js';

function sampleReceipt(
  overrides: Partial<RecipeEvidenceReceipt> = {},
): RecipeEvidenceReceipt {
  return {
    receiptId: 'rcpt-eval-1',
    evidenceKind: 'recipe_evaluation',
    runId: 'eval-run-1',
    recipeId: 'recipe.demo',
    recipeRevision: 3,
    promptRevisionRef: 'prompt.demo@7',
    suiteId: 'recipe-governance',
    suiteRevision: 'recipe-governance@1',
    mode: 'recorded_fixture',
    passed: true,
    issuerId: 'system.recipe-eval-issuer',
    issuedAt: '2026-08-06T12:00:00.000Z',
    expiresAt: '2026-09-06T12:00:00.000Z',
    ...overrides,
  };
}

test('memory recipe evidence receipt registry is put-once and lists by revision', async () => {
  const registry = new MemoryRecipeEvidenceReceiptRegistry();
  const receipt = sampleReceipt();
  assert.deepEqual(
    await registry.putImmutable(receipt.receiptId, receipt),
    receipt,
  );
  assert.deepEqual(
    await registry.putImmutable(receipt.receiptId, receipt),
    receipt,
  );
  assert.deepEqual(await registry.get(receipt.receiptId), receipt);

  await assert.rejects(
    registry.putImmutable(receipt.receiptId, {
      ...receipt,
      runId: 'different-run',
    }),
    (error: unknown) =>
      error instanceof P1DomainError &&
      error.code === 'IDEMPOTENCY_CONFLICT',
  );

  const sibling = sampleReceipt({
    receiptId: 'rcpt-eval-2',
    runId: 'eval-run-2',
    issuedAt: '2026-08-06T13:00:00.000Z',
  });
  const otherRevision = sampleReceipt({
    receiptId: 'rcpt-eval-other-rev',
    recipeRevision: 4,
    runId: 'eval-run-other',
  });
  const otherKind = sampleReceipt({
    receiptId: 'rcpt-internal-1',
    evidenceKind: 'recipe_internal_test',
    runId: 'eval-run-internal',
  });
  await registry.putImmutable(sibling.receiptId, sibling);
  await registry.putImmutable(otherRevision.receiptId, otherRevision);
  await registry.putImmutable(otherKind.receiptId, otherKind);

  assert.deepEqual(
    await registry.listByRecipeRevision({
      evidenceKind: 'recipe_evaluation',
      recipeId: 'recipe.demo',
      recipeRevision: 3,
    }),
    [sibling, receipt],
  );
  assert.deepEqual(
    await registry.listByRecipeRevision({
      evidenceKind: 'recipe_internal_test',
      recipeId: 'recipe.demo',
      recipeRevision: 3,
    }),
    [otherKind],
  );
  assert.deepEqual(
    await registry.listByRecipeRevision({
      evidenceKind: 'recipe_evaluation',
      recipeId: 'recipe.demo',
      recipeRevision: 4,
    }),
    [otherRevision],
  );
});

test('memory recipe evidence receipt registry rejects receiptId mismatch', async () => {
  const registry = new MemoryRecipeEvidenceReceiptRegistry();
  await assert.rejects(
    registry.putImmutable('other-id', sampleReceipt()),
    (error: unknown) =>
      error instanceof P1DomainError && error.code === 'INVALID_STATE',
  );
});

test('memory recipe evidence receipt registry returns null for missing receipt', async () => {
  const registry = new MemoryRecipeEvidenceReceiptRegistry();
  assert.equal(await registry.get('missing'), null);
});
