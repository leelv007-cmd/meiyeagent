/**
 * Immutable recipe evaluation / internal-test evidence receipt registry (Spec I #393).
 *
 * Receipts bind a real EvalRun to a specific Recipe revision + frozen Prompt.
 * Put-once: same receiptId + same facts → idempotent success; different facts →
 * IDEMPOTENCY_CONFLICT. EvalRun facts stay in the shared EvalRun registry;
 * receipts are a separate binding assertion.
 */

import { isDeepStrictEqual } from 'node:util';

import { P1DomainError } from '../foundation/domain.js';
import type {
  RecipeEvidenceKind,
  RecipeEvidenceMode,
  RecipeEvidenceReceipt,
} from './recipe-evidence-ports.js';

export interface ListRecipeEvidenceReceiptsFilter {
  evidenceKind: RecipeEvidenceKind;
  recipeId: string;
  recipeRevision: number;
}

/**
 * Shared receipt store used by issuers (#394+) and redeem adapters (#396).
 * creation-experience reads via this port.
 */
export interface RecipeEvidenceReceiptRegistryPort {
  putImmutable(
    receiptId: string,
    receipt: RecipeEvidenceReceipt,
  ): Promise<RecipeEvidenceReceipt>;
  get(receiptId: string): Promise<RecipeEvidenceReceipt | null>;
  /** Index-backed query: evidence for a concrete revision. */
  listByRecipeRevision(
    filter: ListRecipeEvidenceReceiptsFilter,
  ): Promise<RecipeEvidenceReceipt[]>;
}

const EVIDENCE_KINDS = new Set<RecipeEvidenceKind>([
  'recipe_evaluation',
  'recipe_internal_test',
]);

const EVIDENCE_MODES = new Set<RecipeEvidenceMode>([
  'recorded_fixture',
  'live_red_team',
]);

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new P1DomainError(
      'INVALID_STATE',
      `Recipe evidence receipt ${field} is required.`,
    );
  }
  return value.trim();
}

/**
 * Normalize and validate the frozen 13-field receipt shape from recipe-evidence-ports.
 */
export function parseRecipeEvidenceReceipt(
  input: RecipeEvidenceReceipt,
): RecipeEvidenceReceipt {
  const receiptId = requireNonEmptyString(input.receiptId, 'receiptId');
  const evidenceKind = input.evidenceKind;
  if (!EVIDENCE_KINDS.has(evidenceKind)) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Recipe evidence receipt evidenceKind is invalid.',
    );
  }
  const mode = input.mode;
  if (!EVIDENCE_MODES.has(mode)) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Recipe evidence receipt mode is invalid.',
    );
  }
  if (
    typeof input.recipeRevision !== 'number' ||
    !Number.isInteger(input.recipeRevision) ||
    input.recipeRevision < 1
  ) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Recipe evidence receipt recipeRevision must be a positive integer.',
    );
  }
  if (typeof input.passed !== 'boolean') {
    throw new P1DomainError(
      'INVALID_STATE',
      'Recipe evidence receipt passed must be a boolean.',
    );
  }
  const issuedAt = requireNonEmptyString(input.issuedAt, 'issuedAt');
  const expiresAt = requireNonEmptyString(input.expiresAt, 'expiresAt');
  if (Number.isNaN(Date.parse(issuedAt)) || Number.isNaN(Date.parse(expiresAt))) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Recipe evidence receipt issuedAt/expiresAt must be ISO datetimes.',
    );
  }

  return {
    receiptId,
    evidenceKind,
    runId: requireNonEmptyString(input.runId, 'runId'),
    recipeId: requireNonEmptyString(input.recipeId, 'recipeId'),
    recipeRevision: input.recipeRevision,
    promptRevisionRef: requireNonEmptyString(
      input.promptRevisionRef,
      'promptRevisionRef',
    ),
    suiteId: requireNonEmptyString(input.suiteId, 'suiteId'),
    suiteRevision: requireNonEmptyString(input.suiteRevision, 'suiteRevision'),
    mode,
    passed: input.passed,
    issuerId: requireNonEmptyString(input.issuerId, 'issuerId'),
    issuedAt,
    expiresAt,
  };
}

function compareReceiptsForList(
  left: RecipeEvidenceReceipt,
  right: RecipeEvidenceReceipt,
): number {
  const byIssued = right.issuedAt.localeCompare(left.issuedAt);
  if (byIssued !== 0) return byIssued;
  return left.receiptId.localeCompare(right.receiptId);
}

export class MemoryRecipeEvidenceReceiptRegistry
  implements RecipeEvidenceReceiptRegistryPort
{
  private readonly receipts = new Map<string, RecipeEvidenceReceipt>();

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
    const existing = this.receipts.get(receiptId);
    if (existing) {
      if (isDeepStrictEqual(existing, receipt)) {
        return structuredClone(existing);
      }
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        'Recipe evidence receipt is already bound to different facts.',
      );
    }
    this.receipts.set(receiptId, structuredClone(receipt));
    return structuredClone(receipt);
  }

  async get(receiptId: string): Promise<RecipeEvidenceReceipt | null> {
    const value = this.receipts.get(receiptId);
    return value ? structuredClone(value) : null;
  }

  async listByRecipeRevision(
    filter: ListRecipeEvidenceReceiptsFilter,
  ): Promise<RecipeEvidenceReceipt[]> {
    return [...this.receipts.values()]
      .filter(
        (receipt) =>
          receipt.evidenceKind === filter.evidenceKind &&
          receipt.recipeId === filter.recipeId &&
          receipt.recipeRevision === filter.recipeRevision,
      )
      .sort(compareReceiptsForList)
      .map((receipt) => structuredClone(receipt));
  }
}
