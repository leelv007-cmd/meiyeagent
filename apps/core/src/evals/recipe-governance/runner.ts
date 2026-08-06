/**
 * recipe-governance runner: assemble cases from a Recipe subject, score with
 * the existing redline + fact-satisfaction scorers, emit eval-run/v1.
 */

import {
  evalCaseResultSchema,
  evalRunSchema,
  type EvalCaseResult,
  type EvalRun,
} from '../../contracts/index.js';
import FactSatisfactionPromptfooProvider from '../fact-satisfaction/promptfoo-provider.js';
import { scoreFactSatisfactionOutput } from '../fact-satisfaction/promptfoo-scorer.js';
import { evaluateRedlineCase } from '../redlines/promptfoo-provider.js';
import {
  buildRecipeGovernanceCases,
  type RecipeGovernanceCase,
} from './cases.js';
import {
  FIXTURE_RECIPE_GOVERNANCE_SUBJECT,
  type RecipeGovernanceSubject,
} from './subject.js';
import {
  RECIPE_GOVERNANCE_CREATED_AT,
  RECIPE_GOVERNANCE_FACT_SATISFACTION_SCORER_REVISION,
  RECIPE_GOVERNANCE_RECORDED_RUN_ID,
  RECIPE_GOVERNANCE_REDLINE_SCORER_REVISION,
  RECIPE_GOVERNANCE_SUITE_ID,
  RECIPE_GOVERNANCE_SUITE_REVISION,
} from './suite.js';

export type RecipeGovernanceMode = EvalRun['mode'];

export interface RunRecipeGovernanceEvalOptions {
  subject?: RecipeGovernanceSubject;
  mode?: RecipeGovernanceMode;
  /** Override recorded runId (live issuers supply their own). */
  runId?: string;
  createdAt?: string;
  /**
   * Optional redline validator inject for negative tests only.
   * Production / recorded path leaves this unset.
   */
  redlineValidator?: Parameters<typeof evaluateRedlineCase>[1];
  /**
   * Optional fact-satisfaction expected override for negative tests.
   * When set, each fact-satisfaction case uses this expectation instead of
   * the frozen case vars (forces scorer mismatch).
   */
  factSatisfactionExpectedJsonOverride?: string;
}

export async function runRecipeGovernanceEval(
  options: RunRecipeGovernanceEvalOptions = {},
): Promise<EvalRun> {
  const subject = options.subject ?? FIXTURE_RECIPE_GOVERNANCE_SUBJECT;
  const mode = options.mode ?? 'recorded_fixture';
  if (mode === 'live_red_team') {
    // Live path is reserved for operator-triggered runs (#395+). Recorded
    // fixtures remain the only path this suite executes in CI.
    throw new Error(
      'recipe-governance live_red_team mode is not available in the recorded suite runner.',
    );
  }

  const cases = buildRecipeGovernanceCases(subject);
  const results: EvalCaseResult[] = [];
  for (const evalCase of cases) {
    results.push(await evaluateCase(evalCase, subject, options));
  }

  return evalRunSchema.parse({
    schemaVersion: 'eval-run/v1',
    runId: options.runId ?? RECIPE_GOVERNANCE_RECORDED_RUN_ID,
    suiteId: RECIPE_GOVERNANCE_SUITE_ID,
    suiteRevision: RECIPE_GOVERNANCE_SUITE_REVISION,
    mode,
    createdAt: options.createdAt ?? RECIPE_GOVERNANCE_CREATED_AT,
    passed: results.every((result) => result.passed),
    results,
  });
}

export function createRecordedRecipeGovernanceEvalRun(
  options: Omit<RunRecipeGovernanceEvalOptions, 'mode'> = {},
): Promise<EvalRun> {
  return runRecipeGovernanceEval({ ...options, mode: 'recorded_fixture' });
}

async function evaluateCase(
  evalCase: RecipeGovernanceCase,
  subject: RecipeGovernanceSubject,
  options: RunRecipeGovernanceEvalOptions,
): Promise<EvalCaseResult> {
  if (evalCase.kind === 'redline') {
    const scored = evaluateRedlineCase(
      evalCase.redline,
      options.redlineValidator,
    );
    // Spec I redeems against the Recipe's frozen prompt revision, not the
    // platform redline prompt pin. Scorer revision stays the redline scorer.
    return evalCaseResultSchema.parse({
      caseId: evalCase.caseId,
      gateId: scored.gateId,
      promptRevision: subject.promptRevisionRef,
      scorerRevision: RECIPE_GOVERNANCE_REDLINE_SCORER_REVISION,
      passed: scored.passed,
      reason: scored.reason,
      memoryDiff: null,
    });
  }

  const vars =
    options.factSatisfactionExpectedJsonOverride === undefined
      ? evalCase.vars
      : {
          ...evalCase.vars,
          expectedJson: options.factSatisfactionExpectedJsonOverride,
        };
  const provider = new FactSatisfactionPromptfooProvider();
  const response = await provider.callApi(evalCase.caseId, { vars });
  const score = scoreFactSatisfactionOutput(response.output, { vars });
  return evalCaseResultSchema.parse({
    caseId: evalCase.caseId,
    gateId: 'recipe_fact_satisfaction',
    promptRevision: subject.promptRevisionRef,
    scorerRevision: RECIPE_GOVERNANCE_FACT_SATISFACTION_SCORER_REVISION,
    passed: score.pass,
    reason: score.reason,
    memoryDiff: null,
  });
}
