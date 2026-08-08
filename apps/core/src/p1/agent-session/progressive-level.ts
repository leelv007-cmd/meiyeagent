/**
 * Progressive Plan Level 0–3 classifier (V31-08 / V3.1 §3, A13, U1).
 *
 * Level 0: deterministic light edit — never enters Harness LLM loop.
 * Level 1: pure-copy simple generation — confirmation exempt (U1 permanent).
 * Level 2: complex creation → Living Plan path (classification only here).
 * Level 3: Campaign / multi-work goal (classification only; confirm granularity V31-11).
 *
 * A13 authority: confirmation gate = whether the operation triggers paid media
 * execution. Pure copy stays exempt. Kill switch may only tighten (force confirm),
 * never expand the exemption to paid media.
 */

export const PROGRESSIVE_TASK_LEVELS = [0, 1, 2, 3] as const;
export type ProgressiveTaskLevel = (typeof PROGRESSIVE_TASK_LEVELS)[number];

export const DELIVERABLE_CARRIERS = ['copy', 'note', 'media'] as const;
export type DeliverableCarrier = (typeof DELIVERABLE_CARRIERS)[number];

/** Resources that constitute paid media spend (aligns with workflow-core gate). */
export const PAID_MEDIA_RESOURCES = new Set([
  'image',
  'video',
  'audio',
  'image_generate',
  'image.edit',
  'image.generate',
  'image.reference_transform',
  'video.generate',
  'audio.speech',
  'audio.sfx',
]);

export type ProgressiveLevelInput = {
  merchantMessage: string;
  /** Declared deliverable carriers when known from plan/intent. */
  carriers?: readonly DeliverableCarrier[];
  /**
   * Explicit paid-media execution signal (A13). When true, never Level-1 exempt.
   * Prefer reservation/unit facts when available.
   */
  includesPaidMediaExecution?: boolean;
  /** Usage unit resource names from a reserved quote (A13 unit authority). */
  paidMediaUnitResources?: readonly string[];
  /**
   * Frozen lens when known. `copy` alone is pure-copy eligible;
   * note/media/image_text/video are paid-media paths.
   */
  lens?: 'copy' | 'note' | 'media' | 'image_text' | 'video';
  /**
   * Kill switch: when true, pure-copy confirmation exemption is disabled.
   * May only tighten confirmation boundary — never expand paid-media exemption.
   */
  forceConfirmationKillSwitch?: boolean;
};

export type ProgressiveLevelResult = {
  level: ProgressiveTaskLevel;
  reason: string;
  /** True only for pure copy with kill switch off (U1 / A13). */
  confirmationExempt: boolean;
  /** Snapshot basis hint for freeze path (U9); null when not applicable. */
  approvalBasis: 'policy_exempt_copy' | 'merchant_confirmed' | null;
  isPureCopy: boolean;
  /** Level 0 only: deterministic revise hint for the revise primitive. */
  deterministicEdit:
    | {
        kind:
          | 'delete_last_sentence'
          | 'typo_fix'
          | 'replace_phrase'
          | 'generic_light_edit';
        instruction: string;
      }
    | null;
};

const LEVEL0_PATTERNS: ReadonlyArray<{
  kind: NonNullable<ProgressiveLevelResult['deterministicEdit']>['kind'];
  re: RegExp;
}> = [
  {
    kind: 'delete_last_sentence',
    re: /删(除|掉)?\s*(最后|末尾|结尾)?\s*(一?句|那句|这句)|delete\s+(the\s+)?last\s+sentence/iu,
  },
  {
    kind: 'typo_fix',
    re: /(改|修)(一下)?(错别字|错字|笔误)|fix\s+typo/iu,
  },
  {
    kind: 'replace_phrase',
    re: /把.{1,40}(改成|换成|替换为).{1,40}|replace\s+.{1,40}\s+with\s+/iu,
  },
  {
    kind: 'generic_light_edit',
    re: /^(请)?(删|改|换|加|去|去掉|缩短|精简|润色一下).{0,40}$/u,
  },
];

const LEVEL3_PATTERNS =
  /(campaign|整月|每月|持续推|持续做|按周|每周|排期|长期运营|一整季|帮我持续)/iu;

const LEVEL2_PATTERNS =
  /(小红书|图文|笔记|多页|套图|封面|出图|生图|视频|短视频|拍摄|做一套|案例页|轮播)/iu;

const COPY_HINT_PATTERNS =
  /(文案|朋友圈|介绍|口播稿|标题|正文|话术|caption|copy|写一[条个首]|帮我写)/iu;

/**
 * A13 pure-copy judgment: zero paid-media execution.
 * Fail closed when unit resources exist and any is paid media.
 * Lens/carriers secondary; explicit includesPaidMediaExecution wins.
 */
export function isPureCopyOperation(input: ProgressiveLevelInput): boolean {
  if (input.includesPaidMediaExecution === true) return false;

  const units = input.paidMediaUnitResources;
  if (units && units.length > 0) {
    if (units.some((resource) => PAID_MEDIA_RESOURCES.has(resource))) {
      return false;
    }
    // Non-empty units with no paid-media resources → copy-only reservation.
    return true;
  }

  if (input.lens) {
    if (input.lens === 'copy') return true;
    // note / media / legacy image_text / video are paid-media execution paths.
    return false;
  }

  const carriers = input.carriers ?? [];
  if (carriers.length > 0) {
    return carriers.every((carrier) => carrier === 'copy');
  }

  // No structured signal: infer from message — media keywords ⇒ not pure copy.
  if (LEVEL2_PATTERNS.test(input.merchantMessage)) return false;
  return true;
}

function matchLevel0(
  message: string,
): ProgressiveLevelResult['deterministicEdit'] {
  const trimmed = message.trim();
  // Long multi-goal messages are never Level 0.
  if (trimmed.length > 80) return null;
  for (const pattern of LEVEL0_PATTERNS) {
    if (pattern.re.test(trimmed)) {
      return { kind: pattern.kind, instruction: trimmed };
    }
  }
  return null;
}

/**
 * Classify Progressive Plan level for a merchant message + execution facts.
 * Deterministic — no LLM. Kill switch can only remove confirmationExempt.
 */
export function classifyProgressiveLevel(
  input: ProgressiveLevelInput,
): ProgressiveLevelResult {
  const pureCopy = isPureCopyOperation(input);
  const killSwitch = input.forceConfirmationKillSwitch === true;

  const level0 = matchLevel0(input.merchantMessage);
  if (level0) {
    // Level 0 is deterministic revise; still pure-copy safe when content is copy.
    // Confirmation N/A (no paid media path). Kill switch does not force LLM.
    return {
      level: 0,
      reason: `deterministic_edit:${level0.kind}`,
      confirmationExempt: true,
      approvalBasis: pureCopy ? 'policy_exempt_copy' : 'merchant_confirmed',
      isPureCopy: pureCopy,
      deterministicEdit: level0,
    };
  }

  if (LEVEL3_PATTERNS.test(input.merchantMessage)) {
    return {
      level: 3,
      reason: 'campaign_or_ongoing_goal',
      confirmationExempt: false,
      approvalBasis: pureCopy && !killSwitch ? 'policy_exempt_copy' : 'merchant_confirmed',
      isPureCopy: pureCopy,
      deterministicEdit: null,
    };
  }

  // Structured paid media or L2 message cues → Level 2 Living Plan path.
  if (!pureCopy || LEVEL2_PATTERNS.test(input.merchantMessage)) {
    return {
      level: 2,
      reason: pureCopy ? 'complex_copy_or_multi_deliverable' : 'paid_media_or_complex_creation',
      confirmationExempt: false,
      approvalBasis: 'merchant_confirmed',
      isPureCopy: pureCopy,
      deterministicEdit: null,
    };
  }

  // Pure copy simple generation → Level 1 (U1 permanent boundary).
  if (pureCopy && (COPY_HINT_PATTERNS.test(input.merchantMessage) || pureCopy)) {
    const confirmationExempt = !killSwitch;
    return {
      level: 1,
      reason: killSwitch
        ? 'pure_copy_but_kill_switch_forces_confirm'
        : 'pure_copy_simple_generation',
      confirmationExempt,
      approvalBasis: confirmationExempt
        ? 'policy_exempt_copy'
        : 'merchant_confirmed',
      isPureCopy: true,
      deterministicEdit: null,
    };
  }

  // Fallback: treat as L2 when unclear (fail toward safer Living Plan).
  return {
    level: 2,
    reason: 'unclassified_default_living_plan',
    confirmationExempt: false,
    approvalBasis: 'merchant_confirmed',
    isPureCopy: pureCopy,
    deterministicEdit: null,
  };
}

/**
 * Kill-switch safety: may only set confirmationExempt false for pure copy.
 * Never marks paid-media operations as exempt.
 */
export function applyConfirmationKillSwitch(
  result: ProgressiveLevelResult,
  forceConfirmation: boolean,
): ProgressiveLevelResult {
  if (!forceConfirmation) return result;
  if (!result.isPureCopy) {
    // Already non-exempt; refuse any attempt to expand.
    return {
      ...result,
      confirmationExempt: false,
      approvalBasis: 'merchant_confirmed',
    };
  }
  if (!result.confirmationExempt) return result;
  return {
    ...result,
    confirmationExempt: false,
    approvalBasis: 'merchant_confirmed',
    reason: `${result.reason}+kill_switch_tighten`,
  };
}
