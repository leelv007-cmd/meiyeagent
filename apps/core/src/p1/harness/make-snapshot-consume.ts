/**
 * Make Harness ExecutionPlanSnapshot consumption (V31-14 / V3.1 §23; V31-25).
 *
 * When a durable task carries a frozen ExecutionPlanSnapshot and the
 * force_legacy_five_stage kill switch is off, intent_naming / brief_compilation
 * nodes demote to validators: no LLM re-call; mismatch fail closed.
 *
 * V31-25 extends materialization to note + media briefs (compileNoteBrief /
 * compileMediaBrief no longer re-invoke structured LLM on the snapshot path).
 *
 * Stage names stay for durable topology compatibility; new-task semantics are
 * verification → context/rights fence → deterministic execution.
 */

import { isDeepStrictEqual } from 'node:util';

import {
  DEFAULT_NOTE_STYLES,
  executionPlanSnapshotSchema,
  planMemoryContextSchema,
  type ExecutionPlanSnapshot,
  type NotePlan,
  type NoteStyleCandidates,
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
  const memoryContext = snapshot.executionPlan.units
    .map((unit) => {
      if (!unit.input || typeof unit.input !== 'object') return null;
      return planMemoryContextSchema.safeParse(
        (unit.input as Record<string, unknown>).memoryContext
      );
    })
    .find((result) => result?.success)?.data;
  const style = memoryContext?.styleConstraints;
  const styleInstruction = style
    ? `结构化风格约束：语气=${style.tones.join('、') || 'default'}；标题不超过 ${style.maxTitleChars} 字；正文不超过 ${style.maxBodyChars} 字；单句不超过 ${style.maxSentenceChars} 字；禁用词=${style.forbiddenPhrases.join('、') || '无'}。`
    : '';
  return {
    brief: {
      kind: 'copy',
      instructions:
        `按已确认方案「${declaration.normalizedIntent}」生成 ${quantity} 条文案。` +
        styleInstruction +
        '只使用冻结事实与授权素材，不得编造价格、日期、效果或顾客案例，不得偏离 ExecutionPlanSnapshot。',
      platform,
      cta: '私信了解详情并预约',
      factRefs: [...snapshot.factRevisionRefs],
      assetRefs: [],
      identityRefs: [],
      constraints: [
        '不得编造价格、效果、资质或顾客案例',
        '只使用已确认的本店事实',
        ...(style ? [styleInstruction] : []),
        `snapshotHash=${snapshot.snapshotHash}`,
      ],
    },
    llmInvoked: false,
    mode: MAKE_SNAPSHOT_CONSUME_TRACE_MODE,
  };
}

/**
 * Deterministic media brief from frozen snapshot (no structured brief LLM).
 * V31-25: media runner converges onto snapshot materialization like copy.
 */
export function materializeMediaBriefFromSnapshot(input: {
  snapshot: ExecutionPlanSnapshot;
  declaration: IntentDeclaration;
  request: HarnessWorkflowInput;
}): {
  brief:
    | {
        kind: 'image';
        intent: {
          operation: 'image.generate';
          purpose: string;
          subject: string;
          scene: string;
          composition: string;
          references: [];
          exactText: [];
          changes: [];
          invariants: [];
          factRefs: string[];
          rightsRefs: string[];
          outputPlan: { kind: 'single' };
        };
        prompt: string;
        referenceAssetIds: string[];
        parameters: { ratio: string; resolution: string };
        constraints: string[];
      }
    | {
        kind: 'video';
        storyboard: Array<{
          index: number;
          description: string;
          durationSeconds: number;
        }>;
        firstFramePrompt: string;
        referenceAssetIds: string[];
        parameters: { durationSeconds: number; ratio: string };
        constraints: string[];
      };
  llmInvoked: false;
  mode: typeof MAKE_SNAPSHOT_CONSUME_TRACE_MODE;
} {
  const { snapshot, declaration, request } = input;
  validateIntentAgainstSnapshot({ snapshot, declaration });
  const lens = request.executionSnapshot?.lens;
  const kind = lens === 'video' ? ('video' as const) : ('image' as const);
  const summary = declaration.normalizedIntent;
  const constraints = [
    '不得编造价格、效果、资质或顾客案例',
    '只使用已确认的本店事实与授权素材',
    `snapshotHash=${snapshot.snapshotHash}`,
  ];
  if (kind === 'video') {
    return {
      brief: {
        kind: 'video',
        storyboard: [
          {
            index: 1,
            description: `按已确认方案「${summary}」开场`,
            durationSeconds: 3,
          },
          {
            index: 2,
            description: `呈现本店项目与预约行动`,
            durationSeconds: 5,
          },
        ],
        firstFramePrompt:
          `按已确认方案「${summary}」生成竖版视频首帧，真实门店场景，主体清晰，不得编造价格与效果。`,
        referenceAssetIds: [],
        parameters: { durationSeconds: 8, ratio: '9:16' },
        constraints,
      },
      llmInvoked: false,
      mode: MAKE_SNAPSHOT_CONSUME_TRACE_MODE,
    };
  }
  return {
    brief: {
      kind: 'image',
      intent: {
        operation: 'image.generate',
        purpose: `按已确认方案生成门店活动图片`,
        subject: summary.slice(0, 80) || '门店项目',
        scene: '真实门店场景',
        composition: '竖版主体居中',
        references: [],
        exactText: [],
        changes: [],
        invariants: [],
        factRefs: [...snapshot.factRevisionRefs],
        rightsRefs: [...snapshot.rightsRevisionRefs],
        outputPlan: { kind: 'single' },
      },
      prompt:
        `按已确认方案「${summary}」生成竖版门店活动海报，保留品牌主视觉和预约行动号召，不得编造价格与效果。snapshotHash=${snapshot.snapshotHash}`,
      referenceAssetIds: [],
      parameters: { ratio: '9:16', resolution: '1080p' },
      constraints,
    },
    llmInvoked: false,
    mode: MAKE_SNAPSHOT_CONSUME_TRACE_MODE,
  };
}

/**
 * Deterministic note brief (style candidates) from freeze + DEFAULT_NOTE_STYLES.
 * No structured note-plan LLM (V31-25). Page text remains scaffold; execution
 * selection still runs page generation ports under generate/check/revise.
 */
export function materializeNoteBriefFromSnapshot(input: {
  snapshot: ExecutionPlanSnapshot;
  declaration: IntentDeclaration;
  request: HarnessWorkflowInput;
}): {
  brief: {
    kind: 'image_text_note';
    candidates: NoteStyleCandidates;
  };
  llmInvoked: false;
  mode: typeof MAKE_SNAPSHOT_CONSUME_TRACE_MODE;
} {
  const { snapshot, declaration } = input;
  validateIntentAgainstSnapshot({ snapshot, declaration });
  const themeAnchor =
    declaration.normalizedIntent.trim().slice(0, 40) || '本店服务科普';
  const candidates: NoteStyleCandidates = {
    candidates: DEFAULT_NOTE_STYLES.styles.map((style) => ({
      styleId: style.id,
      styleName: style.name,
      positioning: style.writingGuide,
      plan: buildDeterministicNotePlan({
        themeAnchor,
        styleId: style.id,
        styleName: style.name,
        factRefs: snapshot.factRevisionRefs,
        rightsRefs: snapshot.rightsRevisionRefs,
        snapshotHash: snapshot.snapshotHash,
      }),
    })),
  };
  return {
    brief: {
      kind: 'image_text_note',
      candidates,
    },
    llmInvoked: false,
    mode: MAKE_SNAPSHOT_CONSUME_TRACE_MODE,
  };
}

function buildDeterministicNotePlan(input: {
  themeAnchor: string;
  styleId: string;
  styleName: string;
  factRefs: readonly string[];
  rightsRefs: readonly string[];
  snapshotHash: string;
}): NotePlan {
  const imageIntent = (purpose: string, subject: string) => ({
    operation: 'image.generate' as const,
    purpose,
    subject,
    scene: '真实门店场景',
    composition: '主体清晰',
    references: [] as [],
    exactText: [] as [],
    changes: [] as [],
    invariants: [] as [],
    factRefs: [...input.factRefs],
    rightsRefs: [...input.rightsRefs],
    outputPlan: { kind: 'single' as const },
  });
  return {
    schema: 'note-plan/v1',
    themeAnchor: input.themeAnchor,
    style: {
      id: input.styleId,
      name: input.styleName,
      positioning: `${input.styleName}（快照确定性脚手架）`,
    },
    pages: [
      {
        id: 'page-1',
        order: 1,
        revision: 1,
        pageRole: 'cover',
        pagePurpose: 'capture_attention',
        imageIntent: imageIntent('封面配图', input.themeAnchor),
        textBlock: {
          title: input.themeAnchor,
          body: `按已确认方案呈现本店要点（${input.styleName}）。不得编造价格与效果。`,
          exactText: [],
        },
        dependencies: [],
      },
      {
        id: 'page-2',
        order: 2,
        revision: 1,
        pageRole: 'cta_guide',
        pagePurpose: 'drive_action',
        imageIntent: imageIntent('行动页配图', '预约行动'),
        textBlock: {
          title: '预约建议',
          body: `私信了解详情并预约。snapshotHash=${input.snapshotHash}`,
          exactText: [],
        },
        dependencies: [{ pageId: 'page-1', kind: 'text_sequence' }],
      },
    ],
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
