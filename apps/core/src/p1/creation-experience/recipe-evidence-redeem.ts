/**
 * Registry-backed redeem adapters for Recipe evaluation / internal-test gates
 * (Spec I #396).
 *
 * Replaces Spec D (#374) default-deny adapters. Redeem never trusts receipt
 * conclusions: it re-loads the receipt + EvalRun and re-validates in a fixed
 * order, returning a distinct operator-facing domain error at each step.
 *
 * Port SIGNATURES stay frozen in recipe-evidence-ports.ts.
 */

import { evalRunSchema, type EvalRun } from '../../contracts/index.js';
import type { EvalRunRegistryPort } from '../harness/eval-run-registry.js';
import { P1DomainError } from '../foundation/domain.js';
import { RECIPE_EVIDENCE_ISSUER_ID } from './recipe-evidence-issuer.js';
import type { RecipeEvidenceReceiptRegistryPort } from './recipe-evidence-receipt-registry.js';
import type {
  RecipeEvidenceKind,
  RecipeEvidenceReceipt,
  RecipeEvidenceRedeemInput,
  RecipeEvaluationEvidencePort,
  RecipeInternalTestEvidencePort,
} from './recipe-evidence-ports.js';

/** Stable tokens for tests + operator-facing Chinese messages. */
export const RECIPE_EVIDENCE_REDEEM_ERRORS = {
  RECEIPT_NOT_FOUND: {
    token: 'receipt-not-found',
    message:
      '证据回执不存在（receipt-not-found）。请使用服务端签发的有效回执，不要提交客户端构造的运行对象。',
  },
  KIND_MISMATCH: {
    token: 'evidence-kind-mismatch',
    message:
      '证据回执类型与当前门不匹配（evidence-kind-mismatch）。评测门只能兑付 recipe_evaluation，内测门只能兑付 recipe_internal_test。',
  },
  RECEIPT_EXPIRED: {
    token: 'receipt-expired',
    message:
      '证据回执已过期（receipt-expired）。请重新运行评测或内测并签发新回执后再过门。',
  },
  RECIPE_REVISION_MISMATCH: {
    token: 'recipe-revision-mismatch',
    message:
      '证据回执绑定的 Recipe revision 与当前 head 不一致（recipe-revision-mismatch）。旧 revision 的评测不能为新 head 背书。',
  },
  PROMPT_REVISION_MISMATCH: {
    token: 'prompt-revision-mismatch',
    message:
      '证据回执没有使用本次编译冻结的 Prompt 版本（prompt-revision-mismatch）。Prompt 已变更时必须重新评测。',
  },
  EVAL_RUN_MISSING: {
    token: 'eval-run-missing',
    message:
      '证据回执关联的评测运行不存在（eval-run-missing）。回执与运行注册表不同步，不能过门。',
  },
  EVAL_RUN_INVALID: {
    token: 'eval-run-invalid',
    message:
      '证据回执关联的评测运行无法按 EvalRun v1 解析（eval-run-invalid）。注册表中的运行事实损坏或合同不符。',
  },
  EVAL_RUN_FAILED: {
    token: 'eval-run-failed',
    message:
      '评测运行未通过（eval-run-failed）。注册表中的 EvalRun.passed 为假，不能过门。',
  },
  CASE_PROMPT_REVISION_MISMATCH: {
    token: 'case-prompt-revision-mismatch',
    message:
      '评测用例的 promptRevision 与编译冻结版本不一致（case-prompt-revision-mismatch）。每个 case 必须绑定同一 Prompt 版本。',
  },
  ISSUER_NOT_ALLOWED: {
    token: 'issuer-not-allowed',
    message:
      '证据回执签发者不在允许名单（issuer-not-allowed）。只接受服务端签发者写入的回执。',
  },
} as const;

export type RecipeEvidenceRedeemErrorKey =
  keyof typeof RECIPE_EVIDENCE_REDEEM_ERRORS;

export interface RegistryBackedRecipeEvidenceRedeemDeps {
  receiptRegistry: RecipeEvidenceReceiptRegistryPort;
  evalRunRegistry: EvalRunRegistryPort;
  /** Clock inject for expiry checks (ISO string or Date). */
  now?: () => string | Date;
  /**
   * Allowed issuer identities. Default is the server-owned issuer from #395.
   * Empty set denies every issuer.
   */
  allowedIssuerIds?: ReadonlySet<string>;
}

const DEFAULT_ALLOWED_ISSUERS: ReadonlySet<string> = new Set([
  RECIPE_EVIDENCE_ISSUER_ID,
]);

export function createRegistryBackedRecipeEvaluationEvidencePort(
  deps: RegistryBackedRecipeEvidenceRedeemDeps,
): RecipeEvaluationEvidencePort {
  return {
    async redeem(input) {
      return redeemEvidenceReceipt(deps, input, 'recipe_evaluation');
    },
  };
}

export function createRegistryBackedRecipeInternalTestEvidencePort(
  deps: RegistryBackedRecipeEvidenceRedeemDeps,
): RecipeInternalTestEvidencePort {
  return {
    async redeem(input) {
      return redeemEvidenceReceipt(deps, input, 'recipe_internal_test');
    },
  };
}

export function createRegistryBackedRecipeEvidencePorts(
  deps: RegistryBackedRecipeEvidenceRedeemDeps,
): {
  evaluation: RecipeEvaluationEvidencePort;
  internalTest: RecipeInternalTestEvidencePort;
} {
  return {
    evaluation: createRegistryBackedRecipeEvaluationEvidencePort(deps),
    internalTest: createRegistryBackedRecipeInternalTestEvidencePort(deps),
  };
}

/**
 * Fixed redeem order (Spec I). Do not reorder steps — tests assert token uniqueness.
 */
export async function redeemEvidenceReceipt(
  deps: RegistryBackedRecipeEvidenceRedeemDeps,
  input: RecipeEvidenceRedeemInput,
  expectedKind: RecipeEvidenceKind,
): Promise<RecipeEvidenceReceipt> {
  const receiptId = requireReceiptId(input.evidenceReceiptId);

  // 1. Load receipt
  const stored = await deps.receiptRegistry.get(receiptId);
  if (!stored) {
    throw redeemError('RECEIPT_NOT_FOUND');
  }

  // 2. evidenceKind matches the gate
  if (stored.evidenceKind !== expectedKind) {
    throw redeemError('KIND_MISMATCH');
  }

  // 3. Not expired (strict: expiresAt must be after now)
  const nowMs = resolveNowMs(deps.now);
  const expiresMs = Date.parse(stored.expiresAt);
  if (Number.isNaN(expiresMs) || expiresMs <= nowMs) {
    throw redeemError('RECEIPT_EXPIRED');
  }

  // 4. recipeId / recipeRevision equals current head (from redeem input)
  if (
    stored.recipeId !== input.recipeId ||
    stored.recipeRevision !== input.recipeRevision
  ) {
    throw redeemError('RECIPE_REVISION_MISMATCH');
  }

  // 5. promptRevisionRef equals this compile freeze
  if (stored.promptRevisionRef !== input.promptRevisionRef) {
    throw redeemError('PROMPT_REVISION_MISMATCH');
  }

  // 6. Load EvalRun from registry and re-parse as eval-run/v1
  //    (never trust receipt.passed / suite copies)
  const rawRun = await deps.evalRunRegistry.get(stored.runId);
  if (!rawRun) {
    throw redeemError('EVAL_RUN_MISSING');
  }
  let run: EvalRun;
  try {
    run = evalRunSchema.parse(rawRun);
  } catch {
    throw redeemError('EVAL_RUN_INVALID');
  }

  // 7. passed must be true on the re-parsed EvalRun
  if (run.passed !== true) {
    throw redeemError('EVAL_RUN_FAILED');
  }

  // 8. Every case promptRevision must match the frozen compile prompt
  const frozenPrompt = input.promptRevisionRef.trim();
  for (const result of run.results) {
    if (result.promptRevision.trim() !== frozenPrompt) {
      throw redeemError('CASE_PROMPT_REVISION_MISMATCH');
    }
  }

  // 9. issuerId on allowlist
  const allowed = deps.allowedIssuerIds ?? DEFAULT_ALLOWED_ISSUERS;
  if (!allowed.has(stored.issuerId)) {
    throw redeemError('ISSUER_NOT_ALLOWED');
  }

  // Return receipt facts with suite/run identity re-stamped from registry EvalRun
  // so studioRelease writers never take client input or stale receipt copies.
  return {
    receiptId: stored.receiptId,
    evidenceKind: stored.evidenceKind,
    runId: run.runId,
    recipeId: stored.recipeId,
    recipeRevision: stored.recipeRevision,
    promptRevisionRef: stored.promptRevisionRef,
    suiteId: run.suiteId,
    suiteRevision: run.suiteRevision,
    mode: run.mode,
    // passed from registry re-check, not receipt copy
    passed: true,
    issuerId: stored.issuerId,
    issuedAt: stored.issuedAt,
    expiresAt: stored.expiresAt,
  };
}

export function redeemError(
  key: RecipeEvidenceRedeemErrorKey,
): P1DomainError {
  const entry = RECIPE_EVIDENCE_REDEEM_ERRORS[key];
  return new P1DomainError('INVALID_STATE', entry.message);
}

function requireReceiptId(value: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw redeemError('RECEIPT_NOT_FOUND');
  }
  return value.trim();
}

function resolveNowMs(now?: () => string | Date): number {
  if (!now) {
    return Date.now();
  }
  const value = now();
  if (value instanceof Date) {
    return value.getTime();
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return Date.now();
  }
  return parsed;
}
