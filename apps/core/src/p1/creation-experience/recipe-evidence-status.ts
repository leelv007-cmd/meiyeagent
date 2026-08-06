/**
 * Templates-facing presentation of per-revision recipe evidence (Spec I #397).
 *
 * Four operator-facing states for each gate:
 * - none: no receipt for this revision (or last run failed → not redeemable)
 * - expired: latest receipt past expiresAt
 * - prompt_mismatch: receipt prompt ≠ current compile-frozen Prompt
 * - ready: not expired, prompt matches, passed=true (redeemable shape)
 *
 * UI only displays status + receiptId + failed case details — never editable
 * pass-state controls. Status projection is pure; registry I/O lives in the
 * foundation query/command layer.
 */

import type { EvalRun } from '../../contracts/index.js';
import type {
  RecipeEvidenceKind,
  RecipeEvidenceReceipt,
} from './recipe-evidence-ports.js';

/** Four presentation states from Spec I management surface. */
export type RecipeEvidencePresentationStatus =
  | 'none'
  | 'expired'
  | 'prompt_mismatch'
  | 'ready';

export interface RecipeEvidenceFailedCase {
  caseId: string;
  reason: string;
}

export interface RecipeEvidenceGateView {
  evidenceKind: RecipeEvidenceKind;
  status: RecipeEvidencePresentationStatus;
  receiptId: string | null;
  runId: string | null;
  passed: boolean | null;
  expiresAt: string | null;
  promptRevisionRef: string | null;
  issuedAt: string | null;
  failedCases: RecipeEvidenceFailedCase[];
}

export interface ProjectRecipeEvidenceGateStatusInput {
  evidenceKind: RecipeEvidenceKind;
  /** Receipts already filtered to (kind, recipeId, revision), newest first. */
  receipts: readonly RecipeEvidenceReceipt[];
  /** Compile-frozen Prompt for this revision (compilation receipt wins). */
  currentPromptRevisionRef: string;
  /** EvalRun for the selected receipt, when available (failed cases). */
  evalRun?: EvalRun | null;
  now?: () => string | Date;
}

/**
 * Project one gate's four-state presentation from immutable receipt facts.
 */
export function projectRecipeEvidenceGateStatus(
  input: ProjectRecipeEvidenceGateStatusInput,
): RecipeEvidenceGateView {
  const empty = emptyGateView(input.evidenceKind);
  if (input.receipts.length === 0) {
    return empty;
  }

  const receipt = input.receipts[0]!;
  const currentPrompt = input.currentPromptRevisionRef.trim();
  const failedCases = failedCasesFromEvalRun(input.evalRun ?? null);
  const base = {
    evidenceKind: input.evidenceKind,
    receiptId: receipt.receiptId,
    runId: receipt.runId,
    passed: receipt.passed,
    expiresAt: receipt.expiresAt,
    promptRevisionRef: receipt.promptRevisionRef,
    issuedAt: receipt.issuedAt,
    failedCases,
  } satisfies Omit<RecipeEvidenceGateView, 'status'>;

  if (!currentPrompt || receipt.promptRevisionRef !== currentPrompt) {
    return { ...base, status: 'prompt_mismatch' };
  }

  if (isReceiptExpired(receipt.expiresAt, input.now)) {
    return { ...base, status: 'expired' };
  }

  if (receipt.passed === true) {
    return { ...base, status: 'ready' };
  }

  // Failed run for current prompt: not redeemable — present as none with
  // receiptId + failedCases so operators know what to fix.
  return { ...base, status: 'none' };
}

export function emptyGateView(
  evidenceKind: RecipeEvidenceKind,
): RecipeEvidenceGateView {
  return {
    evidenceKind,
    status: 'none',
    receiptId: null,
    runId: null,
    passed: null,
    expiresAt: null,
    promptRevisionRef: null,
    issuedAt: null,
    failedCases: [],
  };
}

export function failedCasesFromEvalRun(
  run: EvalRun | null | undefined,
): RecipeEvidenceFailedCase[] {
  if (!run) return [];
  return run.results
    .filter((result) => result.passed !== true)
    .map((result) => ({
      caseId: result.caseId,
      reason: result.reason,
    }));
}

export function isReceiptExpired(
  expiresAt: string,
  now?: () => string | Date,
): boolean {
  const expiresMs = Date.parse(expiresAt);
  if (Number.isNaN(expiresMs)) return true;
  return expiresMs <= resolveNowMs(now);
}

function resolveNowMs(now?: () => string | Date): number {
  if (!now) return Date.now();
  const value = now();
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}
