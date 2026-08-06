/**
 * Server-side recipe evidence receipt issuance (Spec I #395).
 *
 * Single issuance function shared by:
 * 1. suite runner (recipe-governance) after a real Core-side run
 * 2. eval:import CLI when --recipe / --revision / --kind are explicit
 * 3. internal-test runner (non-production only)
 *
 * issuerId is server-owned and never accepted from callers.
 * Receipts go through the put-once registry from #393.
 */

import { createHash } from 'node:crypto';

import { evalRunSchema, type EvalRun } from '../../contracts/index.js';
import type { EvalRunRegistryPort } from '../harness/eval-run-registry.js';
import { P1DomainError } from '../foundation/domain.js';
import type {
  RecipeEvidenceKind,
  RecipeEvidenceReceipt,
} from './recipe-evidence-ports.js';
import {
  parseRecipeEvidenceReceipt,
  type RecipeEvidenceReceiptRegistryPort,
} from './recipe-evidence-receipt-registry.js';

/** Server-owned issuer identity — browser / CLI cannot supply this. */
export const RECIPE_EVIDENCE_ISSUER_ID = 'system.recipe-eval-issuer' as const;

/**
 * Default receipt validity (lifecycle spec seed: 30 days).
 * Auto-renewal scheduling is out of scope for #395; this is the issuance seed.
 */
export const RECIPE_EVIDENCE_VALIDITY_DAYS = 30 as const;

const EVIDENCE_KINDS = new Set<RecipeEvidenceKind>([
  'recipe_evaluation',
  'recipe_internal_test',
]);

export interface IssueRecipeEvidenceInput {
  run: EvalRun;
  evidenceKind: RecipeEvidenceKind;
  recipeId: string;
  recipeRevision: number;
  /**
   * Frozen compile Prompt for this Recipe revision. Every case in the EvalRun
   * must carry the same promptRevision; callers may omit this and let issuance
   * derive it from the run when cases are uniform.
   */
  promptRevisionRef?: string;
}

export interface RecipeEvidenceIssuerDeps {
  evalRunRegistry: EvalRunRegistryPort;
  receiptRegistry: RecipeEvidenceReceiptRegistryPort;
  /** Clock inject for deterministic tests / path-parity assertions. */
  now?: () => string;
}

export interface IssueRecipeEvidenceResult {
  run: EvalRun;
  receipt: RecipeEvidenceReceipt;
}

/**
 * Persist the EvalRun (put-once) then issue the binding receipt (put-once).
 * Both issuance paths MUST call this — do not reimplement receipt construction.
 */
export async function issueRecipeEvidenceReceipt(
  deps: RecipeEvidenceIssuerDeps,
  input: IssueRecipeEvidenceInput,
): Promise<IssueRecipeEvidenceResult> {
  const run = evalRunSchema.parse(input.run);
  const evidenceKind = requireEvidenceKind(input.evidenceKind);
  const recipeId = requireNonEmpty(input.recipeId, 'recipeId');
  const recipeRevision = requirePositiveRevision(input.recipeRevision);
  const promptRevisionRef = resolvePromptRevisionRef(
    run,
    input.promptRevisionRef,
  );

  const issuedAt = normalizeIssuedAt(deps.now?.() ?? new Date().toISOString());
  const expiresAt = addUtcDays(issuedAt, RECIPE_EVIDENCE_VALIDITY_DAYS);
  const receiptId = buildRecipeEvidenceReceiptId({
    evidenceKind,
    runId: run.runId,
    recipeId,
    recipeRevision,
  });

  const receipt = parseRecipeEvidenceReceipt({
    receiptId,
    evidenceKind,
    runId: run.runId,
    recipeId,
    recipeRevision,
    promptRevisionRef,
    suiteId: run.suiteId,
    suiteRevision: run.suiteRevision,
    mode: run.mode,
    passed: run.passed,
    issuerId: RECIPE_EVIDENCE_ISSUER_ID,
    issuedAt,
    expiresAt,
  });

  const storedRun = await deps.evalRunRegistry.putImmutable(run.runId, run);
  const storedReceipt = await deps.receiptRegistry.putImmutable(
    receipt.receiptId,
    receipt,
  );

  return {
    run: storedRun,
    receipt: storedReceipt,
  };
}

/**
 * Issue a receipt then optionally push observability (Langfuse). Observability
 * is never evidence authority: failures are recorded and do not roll back the
 * receipt or block later redeem (Spec I #396).
 */
export async function issueRecipeEvidenceReceiptWithObservability(
  deps: RecipeEvidenceIssuerDeps,
  input: IssueRecipeEvidenceInput,
  observability?: {
    push?: (issued: IssueRecipeEvidenceResult) => Promise<void>;
    onPushFailure?: (error: unknown) => void;
  },
): Promise<
  IssueRecipeEvidenceResult & {
    observabilityFailure: string | null;
  }
> {
  const issued = await issueRecipeEvidenceReceipt(deps, input);
  if (!observability?.push) {
    return { ...issued, observabilityFailure: null };
  }
  try {
    await observability.push(issued);
    return { ...issued, observabilityFailure: null };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    observability.onPushFailure?.(error);
    return { ...issued, observabilityFailure: message };
  }
}

export function buildRecipeEvidenceReceiptId(input: {
  evidenceKind: RecipeEvidenceKind;
  runId: string;
  recipeId: string;
  recipeRevision: number;
}): string {
  const seed = [
    'recipe-evidence-receipt',
    input.evidenceKind,
    input.runId,
    `${input.recipeId}@${input.recipeRevision}`,
  ].join(':');
  const digest = createHash('sha256').update(seed).digest('hex').slice(0, 32);
  return `rcpt_${digest}`;
}

export function derivePromptRevisionRefFromEvalRun(run: EvalRun): string {
  const revisions = [
    ...new Set(run.results.map((result) => result.promptRevision.trim())),
  ];
  if (revisions.length !== 1 || !revisions[0]) {
    throw new P1DomainError(
      'INVALID_STATE',
      '评测运行的 case promptRevision 必须一致且非空，才能签发 Recipe 证据回执。',
    );
  }
  return revisions[0];
}

function resolvePromptRevisionRef(
  run: EvalRun,
  explicit: string | undefined,
): string {
  const fromRun = derivePromptRevisionRefFromEvalRun(run);
  if (explicit === undefined) {
    return fromRun;
  }
  const trimmed = requireNonEmpty(explicit, 'promptRevisionRef');
  if (trimmed !== fromRun) {
    throw new P1DomainError(
      'INVALID_STATE',
      '签发参数中的 promptRevisionRef 与 EvalRun case 的 promptRevision 不一致。',
    );
  }
  return trimmed;
}

function requireEvidenceKind(value: unknown): RecipeEvidenceKind {
  if (typeof value !== 'string' || !EVIDENCE_KINDS.has(value as RecipeEvidenceKind)) {
    throw new P1DomainError(
      'INVALID_STATE',
      'evidenceKind 必须是 recipe_evaluation 或 recipe_internal_test。',
    );
  }
  return value as RecipeEvidenceKind;
}

function requireNonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new P1DomainError('INVALID_STATE', `${field} 不能为空。`);
  }
  return value.trim();
}

function requirePositiveRevision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new P1DomainError(
      'INVALID_STATE',
      'recipeRevision 必须是正整数。',
    );
  }
  return value;
}

function normalizeIssuedAt(value: string): string {
  const trimmed = value.trim();
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) {
    throw new P1DomainError(
      'INVALID_STATE',
      '签发时间必须是合法的 ISO 时间。',
    );
  }
  return new Date(parsed).toISOString();
}

export function addUtcDays(iso: string, days: number): string {
  const date = new Date(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}
