/**
 * recipe-governance eval suite identity (Spec I / #394).
 *
 * suiteRevision is the sole content-version pin for this suite. Any change to
 * case surface (ids, generation rules, or scorer binding) must bump it.
 */

export const RECIPE_GOVERNANCE_SUITE_ID = 'recipe-governance' as const;

/** Bump when suite cases, generation rules, or scorer bindings change. */
export const RECIPE_GOVERNANCE_SUITE_REVISION = 'recipe-governance@1' as const;

export const RECIPE_GOVERNANCE_RECORDED_RUN_ID =
  'recipe-governance-recorded-v1' as const;

export const RECIPE_GOVERNANCE_CREATED_AT = '2026-08-06T12:00:00.000Z' as const;

/** Scorer revisions reused from the platform suites — do not invent new standards. */
export const RECIPE_GOVERNANCE_REDLINE_SCORER_REVISION =
  'visible-copy-redlines-v2' as const;
export const RECIPE_GOVERNANCE_FACT_SATISFACTION_SCORER_REVISION =
  'fact-satisfaction-v1' as const;
