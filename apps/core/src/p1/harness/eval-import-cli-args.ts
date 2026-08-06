/**
 * Argument parsing for `pnpm eval:import`.
 *
 * Without recipe flags the CLI only imports the EvalRun (historical behaviour).
 * With --recipe / --revision / --kind all present, it also issues a receipt.
 */

import type { RecipeEvidenceKind } from '../creation-experience/recipe-evidence-ports.js';

export interface EvalImportCliArgs {
  artifactPath: string;
  /** Present only when all three recipe flags were supplied. */
  issue?: {
    recipeId: string;
    recipeRevision: number;
    evidenceKind: RecipeEvidenceKind;
  };
}

const EVIDENCE_KINDS = new Set<RecipeEvidenceKind>([
  'recipe_evaluation',
  'recipe_internal_test',
]);

export const EVAL_IMPORT_USAGE =
  'Usage: pnpm eval:import <artifact.json> [--recipe <id> --revision <n> --kind <recipe_evaluation|recipe_internal_test>]';

/**
 * Parse argv after the node/tsx entry (process.argv.slice(2)).
 * Rejects unknown flags and partial recipe flag sets.
 */
export function parseEvalImportCliArgs(argv: readonly string[]): EvalImportCliArgs {
  if (argv.length === 0) {
    throw new Error(EVAL_IMPORT_USAGE);
  }

  let artifactPath: string | undefined;
  let recipeId: string | undefined;
  let revisionRaw: string | undefined;
  let kindRaw: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    if (token === '--recipe') {
      recipeId = requireFlagValue(argv, i, '--recipe');
      i += 1;
      continue;
    }
    if (token === '--revision') {
      revisionRaw = requireFlagValue(argv, i, '--revision');
      i += 1;
      continue;
    }
    if (token === '--kind') {
      kindRaw = requireFlagValue(argv, i, '--kind');
      i += 1;
      continue;
    }
    if (token === '--issuer' || token === '--issuerId' || token === '--issuer-id') {
      throw new Error(
        'issuerId is server-owned and cannot be passed to eval:import.',
      );
    }
    if (token.startsWith('-')) {
      throw new Error(`Unknown eval:import flag: ${token}. ${EVAL_IMPORT_USAGE}`);
    }
    if (artifactPath !== undefined) {
      throw new Error(
        `Unexpected extra argument: ${token}. ${EVAL_IMPORT_USAGE}`,
      );
    }
    artifactPath = token;
  }

  if (!artifactPath) {
    throw new Error(EVAL_IMPORT_USAGE);
  }

  const hasAnyIssueFlag =
    recipeId !== undefined || revisionRaw !== undefined || kindRaw !== undefined;
  if (!hasAnyIssueFlag) {
    return { artifactPath };
  }

  if (
    recipeId === undefined ||
    revisionRaw === undefined ||
    kindRaw === undefined
  ) {
    throw new Error(
      `Issuing a recipe evidence receipt requires --recipe, --revision, and --kind together. ${EVAL_IMPORT_USAGE}`,
    );
  }

  const recipeRevision = Number(revisionRaw);
  if (!Number.isInteger(recipeRevision) || recipeRevision < 1) {
    throw new Error('--revision must be a positive integer.');
  }
  if (!EVIDENCE_KINDS.has(kindRaw as RecipeEvidenceKind)) {
    throw new Error(
      '--kind must be recipe_evaluation or recipe_internal_test.',
    );
  }
  if (!recipeId.trim()) {
    throw new Error('--recipe must be a non-empty recipe id.');
  }

  return {
    artifactPath,
    issue: {
      recipeId: recipeId.trim(),
      recipeRevision,
      evidenceKind: kindRaw as RecipeEvidenceKind,
    },
  };
}

function requireFlagValue(
  argv: readonly string[],
  flagIndex: number,
  flag: string,
): string {
  const value = argv[flagIndex + 1];
  if (value === undefined || value.startsWith('-')) {
    throw new Error(`Missing value for ${flag}. ${EVAL_IMPORT_USAGE}`);
  }
  return value;
}
