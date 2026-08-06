/**
 * Postgres put-once registry for recipe evidence receipts (Spec I #393).
 *
 * New table only — does not touch p1_skill_eval_runs or Skill write paths.
 * Index on (evidence_kind, recipe_id, recipe_revision) supports
 * "what evidence exists for the current revision" queries.
 */

import { isDeepStrictEqual } from 'node:util';

import type { Pool, PoolClient } from 'pg';

import { P1DomainError } from '../foundation/domain.js';
import {
  parseRecipeEvidenceReceipt,
  type ListRecipeEvidenceReceiptsFilter,
  type RecipeEvidenceReceiptRegistryPort,
} from './recipe-evidence-receipt-registry.js';
import type { RecipeEvidenceReceipt } from './recipe-evidence-ports.js';

type PayloadRow = { payload: RecipeEvidenceReceipt };

function clonePayload(row: PayloadRow | undefined): RecipeEvidenceReceipt | null {
  return row ? structuredClone(row.payload) : null;
}

export class PostgresRecipeEvidenceReceiptRegistry
  implements RecipeEvidenceReceiptRegistryPort
{
  constructor(private readonly pool: Pool) {}

  async migrate(client?: PoolClient): Promise<void> {
    await (client ?? this.pool).query(`
      CREATE TABLE IF NOT EXISTS p1_recipe_evidence_receipts (
        receipt_id text PRIMARY KEY,
        evidence_kind text NOT NULL CHECK (
          evidence_kind IN ('recipe_evaluation', 'recipe_internal_test')
        ),
        recipe_id text NOT NULL,
        recipe_revision bigint NOT NULL CHECK (recipe_revision > 0),
        payload jsonb NOT NULL,
        issued_at timestamptz NOT NULL,
        expires_at timestamptz NOT NULL
      );
      CREATE INDEX IF NOT EXISTS p1_recipe_evidence_receipts_revision_idx
        ON p1_recipe_evidence_receipts (
          evidence_kind,
          recipe_id,
          recipe_revision
        );
    `);
  }

  async putImmutable(
    receiptId: string,
    input: RecipeEvidenceReceipt,
  ): Promise<RecipeEvidenceReceipt> {
    const receipt = parseRecipeEvidenceReceipt(input);
    if (receipt.receiptId !== receiptId) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Recipe evidence receipt ID must match the immutable registry key.',
      );
    }
    const inserted = await this.pool.query<PayloadRow>(
      `INSERT INTO p1_recipe_evidence_receipts
         (receipt_id, evidence_kind, recipe_id, recipe_revision, payload, issued_at, expires_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz, $7::timestamptz)
       ON CONFLICT (receipt_id) DO NOTHING
       RETURNING payload`,
      [
        receipt.receiptId,
        receipt.evidenceKind,
        receipt.recipeId,
        receipt.recipeRevision,
        JSON.stringify(receipt),
        receipt.issuedAt,
        receipt.expiresAt,
      ],
    );
    if (inserted.rows[0]) {
      return structuredClone(receipt);
    }
    const existing = await this.pool.query<PayloadRow>(
      'SELECT payload FROM p1_recipe_evidence_receipts WHERE receipt_id = $1',
      [receiptId],
    );
    const stored = clonePayload(existing.rows[0]);
    if (stored && isDeepStrictEqual(stored, receipt)) {
      return structuredClone(receipt);
    }
    throw new P1DomainError(
      'IDEMPOTENCY_CONFLICT',
      'Recipe evidence receipt is already bound to different facts.',
    );
  }

  async get(receiptId: string): Promise<RecipeEvidenceReceipt | null> {
    const result = await this.pool.query<PayloadRow>(
      'SELECT payload FROM p1_recipe_evidence_receipts WHERE receipt_id = $1',
      [receiptId],
    );
    const payload = clonePayload(result.rows[0]);
    return payload ? parseRecipeEvidenceReceipt(payload) : null;
  }

  async listByRecipeRevision(
    filter: ListRecipeEvidenceReceiptsFilter,
  ): Promise<RecipeEvidenceReceipt[]> {
    const result = await this.pool.query<PayloadRow>(
      `SELECT payload
         FROM p1_recipe_evidence_receipts
        WHERE evidence_kind = $1
          AND recipe_id = $2
          AND recipe_revision = $3
        ORDER BY issued_at DESC, receipt_id ASC`,
      [filter.evidenceKind, filter.recipeId, filter.recipeRevision],
    );
    return result.rows.map((row) =>
      parseRecipeEvidenceReceipt(structuredClone(row.payload)),
    );
  }
}
