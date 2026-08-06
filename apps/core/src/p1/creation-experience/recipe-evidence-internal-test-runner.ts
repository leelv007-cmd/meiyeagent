/**
 * Server-side internal-test evidence issuance (Spec I #395).
 *
 * Runs only on non-production tenants/environments. Executes one real creation
 * for the Recipe revision (injectable for tests), maps the outcome to EvalRun
 * v1, then issues a recipe_internal_test receipt via the shared issuer.
 *
 * Studio-side label 'internal-test' remains a server-owned field on
 * studioRelease; clients never submit it.
 */

import { evalRunSchema, type EvalRun } from '../../contracts/index.js';
import { P1DomainError } from '../foundation/domain.js';
import {
  issueRecipeEvidenceReceipt,
  type IssueRecipeEvidenceResult,
  type RecipeEvidenceIssuerDeps,
} from './recipe-evidence-issuer.js';

export const RECIPE_INTERNAL_TEST_SUITE_ID = 'recipe-internal-test' as const;
export const RECIPE_INTERNAL_TEST_SUITE_REVISION =
  'recipe-internal-test@1' as const;
export const RECIPE_INTERNAL_TEST_SCORER_REVISION =
  'recipe-internal-test-scorer@1' as const;

/** Studio-side label constraint retained on the receipt path (server-owned). */
export const RECIPE_INTERNAL_TEST_LABEL = 'internal-test' as const;

export interface RecipeInternalTestSubject {
  recipeId: string;
  recipeRevision: number;
  promptRevisionRef: string;
}

/**
 * Outcome of one real creation under the Recipe revision.
 * Callers supply a production creation adapter; tests inject fixtures.
 */
export interface RecipeInternalTestCreationOutcome {
  runId: string;
  passed: boolean;
  reason: string;
  /** ISO createdAt for the EvalRun. */
  createdAt?: string;
  mode?: EvalRun['mode'];
}

export type RecipeInternalTestCreationExecutor = (input: {
  subject: RecipeInternalTestSubject;
}) => Promise<RecipeInternalTestCreationOutcome>;

export interface RunAndIssueRecipeInternalTestEvidenceInput {
  subject: RecipeInternalTestSubject;
  executeCreation: RecipeInternalTestCreationExecutor;
  /** Defaults to process.env; production APP_ENV is rejected. */
  env?: Record<string, string | undefined>;
  now?: () => string;
}

/**
 * Non-production guard: internal-test real creation must never hit production.
 */
export function assertNonProductionTenantForInternalTest(
  env: Record<string, string | undefined> = process.env,
): void {
  const appEnv = (env.APP_ENV ?? env.NODE_ENV ?? '').trim().toLowerCase();
  if (appEnv === 'production') {
    throw new P1DomainError(
      'FORBIDDEN',
      '内测证据签发仅允许在非生产租户执行（APP_ENV 不能为 production）。',
    );
  }
}

export function isNonProductionTenantEnv(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const appEnv = (env.APP_ENV ?? env.NODE_ENV ?? '').trim().toLowerCase();
  return appEnv !== 'production';
}

/**
 * Execute one internal creation on a non-production tenant, persist EvalRun,
 * and issue a recipe_internal_test receipt through the shared issuer.
 */
export async function runAndIssueRecipeInternalTestEvidence(
  deps: RecipeEvidenceIssuerDeps,
  input: RunAndIssueRecipeInternalTestEvidenceInput,
): Promise<IssueRecipeEvidenceResult & { label: typeof RECIPE_INTERNAL_TEST_LABEL }> {
  assertNonProductionTenantForInternalTest(input.env ?? process.env);

  const outcome = await input.executeCreation({ subject: input.subject });
  const createdAt =
    outcome.createdAt ?? input.now?.() ?? deps.now?.() ?? new Date().toISOString();
  const run = buildInternalTestEvalRun({
    subject: input.subject,
    outcome: { ...outcome, createdAt },
  });

  const issued = await issueRecipeEvidenceReceipt(
    {
      evalRunRegistry: deps.evalRunRegistry,
      receiptRegistry: deps.receiptRegistry,
      now: input.now ?? deps.now,
    },
    {
      run,
      evidenceKind: 'recipe_internal_test',
      recipeId: input.subject.recipeId,
      recipeRevision: input.subject.recipeRevision,
      promptRevisionRef: input.subject.promptRevisionRef,
    },
  );

  return {
    ...issued,
    label: RECIPE_INTERNAL_TEST_LABEL,
  };
}

export function buildInternalTestEvalRun(input: {
  subject: RecipeInternalTestSubject;
  outcome: RecipeInternalTestCreationOutcome & { createdAt: string };
}): EvalRun {
  return evalRunSchema.parse({
    schemaVersion: 'eval-run/v1',
    runId: input.outcome.runId,
    suiteId: RECIPE_INTERNAL_TEST_SUITE_ID,
    suiteRevision: RECIPE_INTERNAL_TEST_SUITE_REVISION,
    mode: input.outcome.mode ?? 'recorded_fixture',
    createdAt: input.outcome.createdAt,
    passed: input.outcome.passed,
    results: [
      {
        caseId: 'internal-test-creation-once',
        gateId: 'recipe_internal_test',
        promptRevision: input.subject.promptRevisionRef,
        scorerRevision: RECIPE_INTERNAL_TEST_SCORER_REVISION,
        passed: input.outcome.passed,
        reason: input.outcome.reason,
        memoryDiff: null,
      },
    ],
  });
}
