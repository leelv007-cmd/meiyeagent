/**
 * Recipe evidence receipt registry Postgres parity (#393).
 * Driver executes with TEST_DATABASE_URL; skipped without it.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { Pool } from 'pg';

import { P1DomainError } from '../foundation/domain.js';
import { PostgresRecipeEvidenceReceiptRegistry } from './postgres-recipe-evidence-receipt-registry.js';
import type { RecipeEvidenceReceipt } from './recipe-evidence-ports.js';

const connectionString = process.env.TEST_DATABASE_URL;

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

test(
  'Postgres recipe evidence receipt registry matches memory put-once and revision index query',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const suffix = randomUUID();
    const registry = new PostgresRecipeEvidenceReceiptRegistry(pool);
    await registry.migrate();

    const recipeId = `recipe.pg-evidence.${suffix}`;
    const receiptIds = {
      eval1: `rcpt-pg-${suffix}-1`,
      eval2: `rcpt-pg-${suffix}-2`,
      otherRev: `rcpt-pg-${suffix}-other-rev`,
      internal: `rcpt-pg-${suffix}-internal`,
    };

    try {
      const receipt = sampleReceipt({
        receiptId: receiptIds.eval1,
        recipeId,
        runId: `eval-run-1-${suffix}`,
      });
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
          runId: `different-run-${suffix}`,
        }),
        (error: unknown) =>
          error instanceof P1DomainError &&
          error.code === 'IDEMPOTENCY_CONFLICT',
      );

      const sibling = sampleReceipt({
        receiptId: receiptIds.eval2,
        recipeId,
        runId: `eval-run-2-${suffix}`,
        issuedAt: '2026-08-06T13:00:00.000Z',
      });
      const otherRevision = sampleReceipt({
        receiptId: receiptIds.otherRev,
        recipeId,
        recipeRevision: 4,
        runId: `eval-run-other-${suffix}`,
      });
      const otherKind = sampleReceipt({
        receiptId: receiptIds.internal,
        evidenceKind: 'recipe_internal_test',
        recipeId,
        runId: `eval-run-internal-${suffix}`,
      });
      await registry.putImmutable(sibling.receiptId, sibling);
      await registry.putImmutable(otherRevision.receiptId, otherRevision);
      await registry.putImmutable(otherKind.receiptId, otherKind);

      assert.deepEqual(
        await registry.listByRecipeRevision({
          evidenceKind: 'recipe_evaluation',
          recipeId,
          recipeRevision: 3,
        }),
        [sibling, receipt],
      );
      assert.deepEqual(
        await registry.listByRecipeRevision({
          evidenceKind: 'recipe_internal_test',
          recipeId,
          recipeRevision: 3,
        }),
        [otherKind],
      );
      assert.deepEqual(
        await registry.listByRecipeRevision({
          evidenceKind: 'recipe_evaluation',
          recipeId,
          recipeRevision: 4,
        }),
        [otherRevision],
      );

      const restarted = new PostgresRecipeEvidenceReceiptRegistry(pool);
      await restarted.migrate();
      assert.deepEqual(await restarted.get(receipt.receiptId), receipt);
      assert.deepEqual(
        await restarted.putImmutable(receipt.receiptId, receipt),
        receipt,
      );
    } finally {
      await pool.query(
        'DELETE FROM p1_recipe_evidence_receipts WHERE receipt_id = ANY($1::text[])',
        [Object.values(receiptIds)],
      );
      await pool.end();
    }
  },
);

test(
  'Postgres recipe evidence receipt registry creates revision index',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const registry = new PostgresRecipeEvidenceReceiptRegistry(pool);
    await registry.migrate();
    try {
      const index = await pool.query<{ indexname: string }>(
        `SELECT indexname
           FROM pg_indexes
          WHERE tablename = 'p1_recipe_evidence_receipts'
            AND indexname = 'p1_recipe_evidence_receipts_revision_idx'`,
      );
      assert.equal(index.rows.length, 1);
    } finally {
      await pool.end();
    }
  },
);
