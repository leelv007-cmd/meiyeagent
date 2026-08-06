/**
 * Recipe evaluation / internal-test evidence ports (Spec D #374 seam).
 *
 * Field list is fixed for Spec I (#393–#397) implementors — do not invent extra
 * receipt fields. Production redeem is registry-backed (#396); default-deny
 * remains the fail-closed fallback when registries are not wired.
 */

import { P1DomainError } from '../foundation/domain.js';

/** Matches Spec I evidenceKind vocabulary. */
export type RecipeEvidenceKind =
  | 'recipe_evaluation'
  | 'recipe_internal_test';

/** Matches eval-run/v1 mode vocabulary (Spec I). */
export type RecipeEvidenceMode = 'recorded_fixture' | 'live_red_team';

/**
 * Immutable evidence receipt contract (Spec I).
 * Spec I must implement against this exact field list.
 */
export interface RecipeEvidenceReceipt {
  receiptId: string;
  evidenceKind: RecipeEvidenceKind;
  runId: string;
  recipeId: string;
  recipeRevision: number;
  promptRevisionRef: string;
  suiteId: string;
  suiteRevision: string;
  mode: RecipeEvidenceMode;
  passed: boolean;
  issuerId: string;
  issuedAt: string;
  expiresAt: string;
}

export interface RecipeEvidenceRedeemInput {
  evidenceReceiptId: string;
  recipeId: string;
  recipeRevision: number;
  promptRevisionRef: string;
}

/**
 * Server-side evaluation evidence redeem port.
 * Browser only ever submits evidenceReceiptId; the port loads and re-validates.
 */
export interface RecipeEvaluationEvidencePort {
  redeem(input: RecipeEvidenceRedeemInput): Promise<RecipeEvidenceReceipt>;
}

/**
 * Server-side internal-test evidence redeem port.
 * Same receipt shape as evaluation; evidenceKind must be recipe_internal_test.
 */
export interface RecipeInternalTestEvidencePort {
  redeem(input: RecipeEvidenceRedeemInput): Promise<RecipeEvidenceReceipt>;
}

export const RECIPE_EVALUATION_EVIDENCE_UNAVAILABLE_MESSAGE =
  '评测证据回执不可用（evidence-unavailable）。当前 revision 没有服务端签发的有效评测回执，不能推进评测门。';

export const RECIPE_INTERNAL_TEST_EVIDENCE_UNAVAILABLE_MESSAGE =
  '内测证据回执不可用（evidence-unavailable）。当前 revision 没有服务端签发的有效内测回执，不能推进内测门。';

export function evidenceUnavailableError(
  kind: RecipeEvidenceKind,
): P1DomainError {
  return new P1DomainError(
    'INVALID_STATE',
    kind === 'recipe_evaluation'
      ? RECIPE_EVALUATION_EVIDENCE_UNAVAILABLE_MESSAGE
      : RECIPE_INTERNAL_TEST_EVIDENCE_UNAVAILABLE_MESSAGE,
  );
}

/** Production default: never advance without a Spec I issuer. */
export function createDefaultDenyRecipeEvaluationEvidencePort(): RecipeEvaluationEvidencePort {
  return {
    async redeem() {
      throw evidenceUnavailableError('recipe_evaluation');
    },
  };
}

/** Production default: never advance without a Spec I issuer. */
export function createDefaultDenyRecipeInternalTestEvidencePort(): RecipeInternalTestEvidencePort {
  return {
    async redeem() {
      throw evidenceUnavailableError('recipe_internal_test');
    },
  };
}

export interface PermittingRecipeEvidencePortOptions {
  now?: () => string;
  issuerId?: string;
  /** When set, only these receipt ids redeem; others throw evidence-unavailable. */
  allowReceiptIds?: ReadonlySet<string>;
  suiteId?: string;
  suiteRevision?: string;
  mode?: RecipeEvidenceMode;
  expiresAt?: string;
}

/**
 * Fixture / launch-seed only: redeem a non-empty receipt id into a passing
 * receipt bound to the redeem input. Production uses registry-backed redeem
 * (#396); do not wire this into the browser command path.
 */
export function createPermittingRecipeEvaluationEvidencePort(
  options: PermittingRecipeEvidencePortOptions = {},
): RecipeEvaluationEvidencePort {
  return createPermittingPort('recipe_evaluation', options);
}

export function createPermittingRecipeInternalTestEvidencePort(
  options: PermittingRecipeEvidencePortOptions = {},
): RecipeInternalTestEvidencePort {
  return createPermittingPort('recipe_internal_test', options);
}

export function createPermittingRecipeEvidencePorts(
  options: PermittingRecipeEvidencePortOptions = {},
): {
  evaluation: RecipeEvaluationEvidencePort;
  internalTest: RecipeInternalTestEvidencePort;
} {
  return {
    evaluation: createPermittingRecipeEvaluationEvidencePort(options),
    internalTest: createPermittingRecipeInternalTestEvidencePort(options),
  };
}

function createPermittingPort(
  evidenceKind: RecipeEvidenceKind,
  options: PermittingRecipeEvidencePortOptions,
): RecipeEvaluationEvidencePort & RecipeInternalTestEvidencePort {
  const now = options.now ?? (() => new Date().toISOString());
  const issuerId = options.issuerId ?? 'system.fixture-evidence';
  const suiteId =
    options.suiteId ??
    (evidenceKind === 'recipe_evaluation'
      ? 'recipe-fixture-evaluation'
      : 'recipe-fixture-internal-test');
  const suiteRevision = options.suiteRevision ?? `${suiteId}@1`;
  const mode = options.mode ?? 'recorded_fixture';
  const expiresAt = options.expiresAt ?? '9999-12-31T23:59:59.000Z';

  return {
    async redeem(input) {
      const receiptId = input.evidenceReceiptId.trim();
      if (!receiptId) {
        throw evidenceUnavailableError(evidenceKind);
      }
      if (
        options.allowReceiptIds &&
        !options.allowReceiptIds.has(receiptId)
      ) {
        throw evidenceUnavailableError(evidenceKind);
      }
      return {
        receiptId,
        evidenceKind,
        runId: receiptId,
        recipeId: input.recipeId,
        recipeRevision: input.recipeRevision,
        promptRevisionRef: input.promptRevisionRef,
        suiteId,
        suiteRevision,
        mode,
        passed: true,
        issuerId,
        issuedAt: now(),
        expiresAt,
      };
    },
  };
}
