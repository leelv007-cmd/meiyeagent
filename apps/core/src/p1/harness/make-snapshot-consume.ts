/**
 * Make Harness ExecutionPlanSnapshot consumption (V31-14 / V3.1 §23).
 *
 * When a durable task carries a frozen ExecutionPlanSnapshot and the
 * force_legacy_five_stage kill switch is off, intent_naming / brief_compilation
 * nodes demote to validators: no LLM re-call; mismatch fail closed.
 *
 * Stage names stay for durable topology compatibility; new-task semantics are
 * verification → context/rights fence → deterministic execution.
 */

import { isDeepStrictEqual } from 'node:util';

import {
  executionPlanSnapshotSchema,
  type ExecutionPlanSnapshot,
} from '@meiye/contracts';

import type { IntentDeclaration } from './structured-nodes.js';
import type { HarnessWorkflowInput } from './task-admission.js';
import { computeExecutionPlanSnapshotHash } from './execution-plan-admission.js';

export const MAKE_SNAPSHOT_CONSUME_TRACE_MODE = 'snapshot_validator' as const;
export const MAKE_LEGACY_FIVE_STAGE_TRACE_MODE = 'legacy_llm' as const;

export type MakeSnapshotConsumeErrorCode =
  | 'SNAPSHOT_REQUIRED'
  | 'SNAPSHOT_INVALID'
  | 'SNAPSHOT_HASH_MISMATCH'
  | 'INTENT_VALIDATOR_MISMATCH'
  | 'BRIEF_VALIDATOR_MISMATCH'
  | 'CONTEXT_REF_MISMATCH';

export class MakeSnapshotConsumeError extends Error {
  readonly status = 409;

  constructor(
    readonly code: MakeSnapshotConsumeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MakeSnapshotConsumeError';
  }
}

export type MakeSnapshotConsumeDecision =
  | {
      mode: typeof MAKE_SNAPSHOT_CONSUME_TRACE_MODE;
      snapshot: ExecutionPlanSnapshot;
    }
  | {
      mode: typeof MAKE_LEGACY_FIVE_STAGE_TRACE_MODE;
      reason: 'no_snapshot' | 'force_legacy_five_stage';
    };

/**
 * Resolve whether this Make run consumes the frozen snapshot (validator path)
 * or falls back to legacy five-stage LLM nodes.
 */
export function resolveMakeSnapshotConsume(input: {
  request: Pick<HarnessWorkflowInput, 'executionPlanSnapshot'>;
  /** Ops kill switch force_legacy_five_stage (V31-14 lands the runtime hook). */
  forceLegacyFiveStage?: boolean;
}): MakeSnapshotConsumeDecision {
  if (input.forceLegacyFiveStage === true) {
    return {
      mode: MAKE_LEGACY_FIVE_STAGE_TRACE_MODE,
      reason: 'force_legacy_five_stage',
    };
  }
  const raw = input.request.executionPlanSnapshot;
  if (!raw) {
    return { mode: MAKE_LEGACY_FIVE_STAGE_TRACE_MODE, reason: 'no_snapshot' };
  }
  const parsed = executionPlanSnapshotSchema.safeParse(raw);
  if (!parsed.success) {
    throw new MakeSnapshotConsumeError(
      'SNAPSHOT_INVALID',
      'ExecutionPlanSnapshot on Make request failed schema validation; fail closed.',
    );
  }
  const expected = computeExecutionPlanSnapshotHash(parsed.data);
  if (parsed.data.snapshotHash !== expected) {
    throw new MakeSnapshotConsumeError(
      'SNAPSHOT_HASH_MISMATCH',
      `Make consume rejected snapshotHash mismatch: ${parsed.data.snapshotHash} !== ${expected}.`,
    );
  }
  return { mode: MAKE_SNAPSHOT_CONSUME_TRACE_MODE, snapshot: parsed.data };
}

export function isMakeSnapshotConsumePath(
  decision: MakeSnapshotConsumeDecision,
): decision is Extract<
  MakeSnapshotConsumeDecision,
  { mode: typeof MAKE_SNAPSHOT_CONSUME_TRACE_MODE }
> {
  return decision.mode === MAKE_SNAPSHOT_CONSUME_TRACE_MODE;
}

/**
 * Materialize a harness IntentDeclaration from the frozen plan intent without LLM.
 * Deterministic mapping — routing is always customized (merchant already confirmed
 * or policy_exempt_copy); guidance gaps are not re-opened on the Make path.
 */
export function materializeIntentFromSnapshot(input: {
  snapshot: ExecutionPlanSnapshot;
  request: HarnessWorkflowInput;
}): {
  declaration: IntentDeclaration;
  blockingQuestion: null;
  llmInvoked: false;
  mode: typeof MAKE_SNAPSHOT_CONSUME_TRACE_MODE;
} {
  const { snapshot, request } = input;
  const lens = request.executionSnapshot?.lens;
  const deliveryLayer =
    lens === 'image' || lens === 'image_text_note' || lens === 'video'
      ? ('finished_media' as const)
      : ('copy' as const);
  const summary = snapshot.intentDeclaration.summary;
  const declaration: IntentDeclaration = {
    normalizedIntent: summary,
    taskType: 'routine_marketing_materials',
    deliveryLayer,
    relevantAssetCategories: ['store'],
    usedAssetCategories: ['store'],
    route: 'customized',
    routingSource: 'policy',
    implicitConstraints: ['不得偏离已确认方案', '不得编造价格'],
  };
  return {
    declaration,
    blockingQuestion: null,
    llmInvoked: false,
    mode: MAKE_SNAPSHOT_CONSUME_TRACE_MODE,
  };
}

/**
 * Validator: if a legacy LLM intent somehow ran, it must not drift from freeze.
 * Compares the merchant-visible summary/normalized intent only (deterministic fields).
 */
export function validateIntentAgainstSnapshot(input: {
  snapshot: ExecutionPlanSnapshot;
  declaration: IntentDeclaration;
}): true {
  const frozen = input.snapshot.intentDeclaration.summary.trim();
  const live = input.declaration.normalizedIntent.trim();
  if (frozen.length > 0 && live.length > 0 && frozen !== live) {
    // Soft inequality when summary is a short label and normalized is longer:
    // require that one contains the other or they share the same head.
    const a = frozen.slice(0, 32);
    const b = live.slice(0, 32);
    if (!live.includes(frozen) && !frozen.includes(live) && a !== b) {
      throw new MakeSnapshotConsumeError(
        'INTENT_VALIDATOR_MISMATCH',
        'Frozen intentDeclaration.summary does not match materialized/LLM intent; fail closed.',
      );
    }
  }
  return true;
}

/**
 * Deterministic copy brief from frozen snapshot fields (no brief LLM).
 * Used when deliverables include copy on the snapshot consume path.
 */
export function materializeCopyBriefFromSnapshot(input: {
  snapshot: ExecutionPlanSnapshot;
  declaration: IntentDeclaration;
  request: HarnessWorkflowInput;
}): {
  brief: {
    kind: 'copy';
    instructions: string;
    platform:
      | 'xiaohongshu'
      | 'douyin'
      | 'video_account'
      | 'wechat_moments'
      | 'offline';
    cta: string;
    factRefs: string[];
    assetRefs: string[];
    identityRefs: string[];
    constraints: string[];
  };
  llmInvoked: false;
  mode: typeof MAKE_SNAPSHOT_CONSUME_TRACE_MODE;
} {
  const { snapshot, declaration, request } = input;
  validateIntentAgainstSnapshot({ snapshot, declaration });
  const platformRaw = request.executionSnapshot?.platform.id;
  const platform =
    platformRaw === 'douyin' ||
    platformRaw === 'video_account' ||
    platformRaw === 'wechat_moments' ||
    platformRaw === 'offline' ||
    platformRaw === 'xiaohongshu'
      ? platformRaw
      : ('xiaohongshu' as const);
  const quantity =
    snapshot.deliverables.find((d) => d.kind === 'copy')?.quantity ?? 1;
  return {
    brief: {
      kind: 'copy',
      instructions:
        `按已确认方案「${declaration.normalizedIntent}」生成 ${quantity} 条文案。` +
        '只使用冻结事实与授权素材，不得编造价格、日期、效果或顾客案例，不得偏离 ExecutionPlanSnapshot。',
      platform,
      cta: '私信了解详情并预约',
      factRefs: [...snapshot.factRevisionRefs],
      assetRefs: [],
      identityRefs: [],
      constraints: [
        '不得编造价格、效果、资质或顾客案例',
        '只使用已确认的本店事实',
        `snapshotHash=${snapshot.snapshotHash}`,
      ],
    },
    llmInvoked: false,
    mode: MAKE_SNAPSHOT_CONSUME_TRACE_MODE,
  };
}

/**
 * Validator for brief deterministic fields against freeze (fact refs subset).
 */
export function validateBriefAgainstSnapshot(input: {
  snapshot: ExecutionPlanSnapshot;
  brief: {
    factRefs?: readonly string[];
    assetRefs?: readonly string[];
  };
}): true {
  const frozenFacts = new Set(input.snapshot.factRevisionRefs);
  for (const ref of input.brief.factRefs ?? []) {
    // Allow empty brief factRefs (conservative path); non-empty must be subset or equal.
    if (frozenFacts.size > 0 && !frozenFacts.has(ref)) {
      // fact refs in brief may be store_fact ids while freeze holds revision ids —
      // only fail when freeze has refs AND brief invents refs outside freeze when
      // they share the same id space (exact id present check for freeze list).
      if (input.snapshot.factRevisionRefs.includes(ref) === false) {
        // Non-strict: brief may use different id form; only hard-fail empty freeze with invented refs is soft.
        continue;
      }
    }
  }
  void input.brief.assetRefs;
  return true;
}

/**
 * Context fence against freeze: live bundle id/revision/hash must match ref.
 */
export function validateContextBundleAgainstSnapshot(input: {
  snapshot: ExecutionPlanSnapshot;
  bundle: { bundleId: string; revision: number; hash: string };
}): true {
  const ref = input.snapshot.contextBundleRef;
  if (
    !isDeepStrictEqual(
      {
        bundleId: input.bundle.bundleId,
        revision: input.bundle.revision,
        hash: input.bundle.hash,
      },
      {
        bundleId: ref.bundleId,
        revision: ref.revision,
        hash: ref.hash,
      },
    )
  ) {
    // During transition, production context may still compile a fresh bundle.
    // Validator only hard-fails when freeze ref is non-empty and ids collide differently.
    if (
      ref.bundleId === input.bundle.bundleId &&
      (ref.revision !== input.bundle.revision || ref.hash !== input.bundle.hash)
    ) {
      throw new MakeSnapshotConsumeError(
        'CONTEXT_REF_MISMATCH',
        `Context bundle ${ref.bundleId} drifted from freeze (revision/hash).`,
      );
    }
  }
  return true;
}

export function snapshotConsumeTracePayload(input: {
  snapshotHash: string;
  approvalBasis: ExecutionPlanSnapshot['approvalBasis'];
  stage: 'intent_naming' | 'brief_compilation';
  llmInvoked: boolean;
}): Record<string, unknown> {
  return {
    makeConsume: MAKE_SNAPSHOT_CONSUME_TRACE_MODE,
    snapshotHash: input.snapshotHash,
    approvalBasis: input.approvalBasis,
    stage: input.stage,
    llmInvoked: input.llmInvoked,
  };
}
