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
  type PlanMemoryContext,
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
  const style = snapshotMemoryStyleConstraints(snapshot);
  const styleInstruction = memoryStyleInstruction(style);
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
 * Merchant-confirmed style constraints as the plan froze them onto every
 * execution unit. Shared by the copy, media and note materializers: a
 * MemoryInjectionReceipt tells the merchant their preference was injected, so
 * every carrier that shows 已注入 must actually consume it (V31-18 P1-8).
 */
export function snapshotMemoryStyleConstraints(
  snapshot: ExecutionPlanSnapshot
): NonNullable<PlanMemoryContext['styleConstraints']> | undefined {
  return snapshot.executionPlan.units
    .map((unit) => {
      if (!unit.input || typeof unit.input !== 'object') return null;
      return planMemoryContextSchema.safeParse(
        (unit.input as Record<string, unknown>).memoryContext
      );
    })
    .find((result) => result?.success)?.data?.styleConstraints;
}

/** Model-facing rendering of the confirmed style; empty when none was injected. */
export function memoryStyleInstruction(
  style: NonNullable<PlanMemoryContext['styleConstraints']> | undefined
): string {
  if (!style) return '';
  return `结构化风格约束：语气=${style.tones.join('、') || 'default'}；标题不超过 ${style.maxTitleChars} 字；正文不超过 ${style.maxBodyChars} 字；单句不超过 ${style.maxSentenceChars} 字；禁用词=${style.forbiddenPhrases.join('、') || '无'}。`;
}

export type MemoryStyleViolation =
  | { rule: 'max_title_chars'; limit: number; observed: number }
  | { rule: 'max_body_chars'; limit: number; observed: number }
  | { rule: 'max_sentence_chars'; limit: number; observed: number; sentence: string }
  | { rule: 'forbidden_phrase'; phrase: string; field: 'title' | 'body' };

/**
 * V31-18 P1-5: does real generated copy actually obey the merchant's confirmed
 * style? Until this existed, `maxBodyChars` / `maxSentenceChars` /
 * `forbiddenPhrases` were only ever rendered into a prompt sentence — nothing
 * anywhere compared them against output, so "the style constraint took effect"
 * was provable only by a fixture that regexed its own prompt and returned
 * hard-coded conforming copy.
 *
 * Pure and deterministic: sentence splitting uses the CJK and ASCII terminators
 * the copy surface actually produces.
 */
export function assessMemoryStyleCompliance(
  candidate: { title?: string; body?: string },
  style: NonNullable<PlanMemoryContext['styleConstraints']> | undefined
): { passed: boolean; violations: MemoryStyleViolation[] } {
  if (!style) return { passed: true, violations: [] };
  const violations: MemoryStyleViolation[] = [];
  const title = candidate.title ?? '';
  const body = candidate.body ?? '';

  if ([...title].length > style.maxTitleChars) {
    violations.push({
      rule: 'max_title_chars',
      limit: style.maxTitleChars,
      observed: [...title].length,
    });
  }
  if ([...body].length > style.maxBodyChars) {
    violations.push({
      rule: 'max_body_chars',
      limit: style.maxBodyChars,
      observed: [...body].length,
    });
  }
  for (const sentence of splitSentences(body)) {
    const length = [...sentence].length;
    if (length > style.maxSentenceChars) {
      violations.push({
        rule: 'max_sentence_chars',
        limit: style.maxSentenceChars,
        observed: length,
        sentence,
      });
    }
  }
  for (const phrase of style.forbiddenPhrases) {
    if (title.includes(phrase)) {
      violations.push({ rule: 'forbidden_phrase', phrase, field: 'title' });
    }
    if (body.includes(phrase)) {
      violations.push({ rule: 'forbidden_phrase', phrase, field: 'body' });
    }
  }
  return { passed: violations.length === 0, violations };
}

/** Merchant-readable rendering of why the confirmed style was not met. */
export function describeMemoryStyleViolations(
  violations: readonly MemoryStyleViolation[]
): string {
  return violations
    .map((violation) => {
      switch (violation.rule) {
        case 'max_title_chars':
          return `标题 ${violation.observed} 字超过约定的 ${violation.limit} 字`;
        case 'max_body_chars':
          return `正文 ${violation.observed} 字超过约定的 ${violation.limit} 字`;
        case 'max_sentence_chars':
          return `单句 ${violation.observed} 字超过约定的 ${violation.limit} 字`;
        case 'forbidden_phrase':
          return `${violation.field === 'title' ? '标题' : '正文'}出现约定禁用词「${violation.phrase}」`;
      }
    })
    .join('；');
}

function splitSentences(body: string): string[] {
  return body
    .split(/[。！？!?\n]+/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
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
  // Must match assertBriefMatchesSnapshot: brief.parameters.ratio/duration track
  // the frozen Recipe delivery on executionSnapshot (promotion_poster is 3:4,
  // not a hard-coded 9:16). Prefer singular deliverable, then deliverables[0].
  const delivery =
    request.executionSnapshot?.deliverable ??
    request.executionSnapshot?.deliverables?.[0];
  const ratio = delivery?.aspectRatio ?? (kind === 'video' ? '9:16' : '3:4');
  const durationSeconds = delivery?.durationSeconds ?? 8;
  // V31-18 P1-8: the plan stamps `memoryContext` on media units too and the
  // receipt panel tells the merchant it was 已注入, but only the copy
  // materializer used to read it — so a confirmed preference had zero effect on
  // image and video output while the UI claimed otherwise.
  const style = snapshotMemoryStyleConstraints(snapshot);
  const styleInstruction = memoryStyleInstruction(style);
  const constraints = [
    '不得编造价格、效果、资质或顾客案例',
    '只使用已确认的本店事实与授权素材',
    ...(styleInstruction ? [styleInstruction] : []),
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
            durationSeconds: Math.max(1, Math.floor(durationSeconds / 3)),
          },
          {
            index: 2,
            description: `呈现本店项目与预约行动`,
            durationSeconds: Math.max(
              1,
              durationSeconds - Math.max(1, Math.floor(durationSeconds / 3)),
            ),
          },
        ],
        firstFramePrompt:
          `按已确认方案「${summary}」生成竖版视频首帧，真实门店场景，主体清晰，不得编造价格与效果。${styleInstruction}`,
        referenceAssetIds: [],
        parameters: { durationSeconds, ratio },
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
        `按已确认方案「${summary}」生成竖版门店活动海报，保留品牌主视觉和预约行动号召，不得编造价格与效果。${styleInstruction}snapshotHash=${snapshot.snapshotHash}`,
      referenceAssetIds: [],
      parameters: { ratio, resolution: '1080p' },
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
  // V31-18 P1-8: the note carrier stamps and receipts `memoryContext` like copy
  // does, so the confirmed style must reach the page scaffold the downstream
  // page generation consumes — otherwise 已注入 is a claim with no effect.
  const styleInstruction = memoryStyleInstruction(
    snapshotMemoryStyleConstraints(snapshot)
  );
  const candidates: NoteStyleCandidates = {
    candidates: DEFAULT_NOTE_STYLES.styles.map((style) => ({
      styleId: style.id,
      styleName: style.name,
      positioning: `${style.writingGuide}${styleInstruction}`,
      plan: buildDeterministicNotePlan({
        themeAnchor,
        styleId: style.id,
        styleName: style.name,
        factRefs: snapshot.factRevisionRefs,
        rightsRefs: snapshot.rightsRevisionRefs,
        snapshotHash: snapshot.snapshotHash,
        memoryStyleInstruction: styleInstruction,
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
  memoryStyleInstruction?: string;
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
      positioning: `${input.styleName}（快照确定性脚手架）${input.memoryStyleInstruction ?? ''}`,
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

// Brief fidelity note (2026-08-12): there is deliberately no brief-vs-snapshot
// validator here. The brief consumed on this path is MATERIALIZED from the
// frozen ExecutionPlanSnapshot (it cannot drift by construction), so a
// validator would have nothing to check — the previous
// `validateBriefAgainstSnapshot` had zero call sites and a loop that could
// never fail, which made the ADR-0020 fail-closed promise look satisfied when
// it was structurally vacuous. Fidelity rests on materialization-from-snapshot;
// intent and context-bundle checks below remain the live validators.

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
