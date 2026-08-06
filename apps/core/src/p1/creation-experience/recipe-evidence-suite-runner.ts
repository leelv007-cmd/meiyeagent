/**
 * Server-side recipe-governance evaluation → EvalRun registry → receipt issue.
 *
 * Path 1 of Spec I #395. Shares issueRecipeEvidenceReceipt with eval:import.
 */

import {
  createRecordedRecipeGovernanceEvalRun,
  type RunRecipeGovernanceEvalOptions,
} from '../../evals/recipe-governance/runner.js';
import type { RecipeGovernanceSubject } from '../../evals/recipe-governance/subject.js';
import {
  issueRecipeEvidenceReceipt,
  type IssueRecipeEvidenceResult,
  type RecipeEvidenceIssuerDeps,
} from './recipe-evidence-issuer.js';

export interface RunAndIssueRecipeGovernanceEvidenceInput {
  subject: RecipeGovernanceSubject;
  /** Clock inject; must match import-path clock for path-parity tests. */
  now?: () => string;
  /** Optional suite runner overrides (runId, createdAt, negative injects). */
  runOptions?: Omit<RunRecipeGovernanceEvalOptions, 'subject' | 'mode'>;
}

/**
 * Assemble cases for the Recipe revision, run recipe-governance recorded suite,
 * put the EvalRun, then issue a recipe_evaluation receipt.
 */
export async function runAndIssueRecipeGovernanceEvidence(
  deps: RecipeEvidenceIssuerDeps,
  input: RunAndIssueRecipeGovernanceEvidenceInput,
): Promise<IssueRecipeEvidenceResult> {
  const run = await createRecordedRecipeGovernanceEvalRun({
    ...input.runOptions,
    subject: input.subject,
  });

  return issueRecipeEvidenceReceipt(
    {
      evalRunRegistry: deps.evalRunRegistry,
      receiptRegistry: deps.receiptRegistry,
      now: input.now ?? deps.now,
    },
    {
      run,
      evidenceKind: 'recipe_evaluation',
      recipeId: input.subject.recipeId,
      recipeRevision: input.subject.recipeRevision,
      promptRevisionRef: input.subject.promptRevisionRef,
    },
  );
}
