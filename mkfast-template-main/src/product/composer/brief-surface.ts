/**
 * Conditional Brief surface model (C4 / #98, D-094 + D-088).
 *
 * Consumes contracts BriefTriggerProjection only — does not re-evaluate
 * server safety triggers. Compact summary; confirm seals exact revisions;
 * cancel returns to Composer without losing input.
 *
 * Evidence drawer is shown ONLY when projection.evidenceDrawer has real
 * entries (system_suggested / source_extracted facts that participate).
 * Video confirm zone is embedded when lens/trigger is video (per-second billing).
 */

import type {
  BriefBoundRevisions,
  BriefConfirmation,
  BriefEvidenceEntry,
  BriefSummaryFields,
  BriefTriggerConditionCode,
  BriefTriggerHit,
  BriefTriggerProjection,
  CreationLensId,
} from '@meiye/contracts';
import { briefTriggerConditionCodes } from '@meiye/contracts';

import {
  findForbiddenBrowserComposerKey,
  projectBrowserComposerPayload,
} from './browser-contract';
import type { ComposerQuoteView } from './quote-wiring';
import {
  buildVideoConfirmZone,
  type VideoConfirmZone,
} from './video-confirm-zone';

// ---------------------------------------------------------------------------
// Labels / copy (merchant-facing; no provider / prompt / route internals)
// ---------------------------------------------------------------------------

export const BRIEF_SURFACE_TITLE = '确认本次创作';
export const BRIEF_CONFIRM_LABEL = '确认并开始';
export const BRIEF_CANCEL_LABEL = '返回修改';
export const BRIEF_EVIDENCE_TITLE = '依据与来源';
export const BRIEF_TRIGGERS_TITLE = '需要确认的原因';
export const BRIEF_SUMMARY_TITLE = '本次摘要';

export const BRIEF_SUMMARY_FIELD_LABELS = {
  targetDeliverable: '目标成品',
  platforms: '平台',
  sourceRightsSummary: '来源与权利',
  keyFacts: '关键事实',
  modelAndSettings: '模型与设置',
  impactScope: '影响范围',
  estimatedCost: '预计费用',
  estimatedDuration: '预计时长',
  pendingItems: '待确认项',
} as const;

export type BriefSummaryFieldKey = keyof typeof BRIEF_SUMMARY_FIELD_LABELS;

/** Stable ordered list of the seven D-094 safety codes (for tests / UI). */
export const BRIEF_TRIGGER_CODES: readonly BriefTriggerConditionCode[] =
  briefTriggerConditionCodes;

// ---------------------------------------------------------------------------
// Surface state
// ---------------------------------------------------------------------------

export type BriefSurfacePhase = 'idle' | 'open' | 'confirmed' | 'cancelled';

/**
 * Opaque Composer input snapshot frozen when Brief opens.
 * Cancel restores this snapshot so Composer fields are never re-filled.
 */
export type ComposerInputSnapshot = {
  /** Free-form user text / intent. */
  userText: string;
  /** Opaque sources bag (ids / refs only). */
  sources: unknown[];
  /** Selected lens at open time. */
  lensId: CreationLensId | null;
  /** Draft revision id for identity. */
  draftRevisionId: string;
  /** Optional extra bag the host may restore (settings, tools, …). */
  hostState?: Record<string, unknown>;
};

export type BriefSurfaceState = {
  phase: BriefSurfacePhase;
  /** Live server projection driving the open Brief. */
  projection: BriefTriggerProjection | null;
  /** Composer input captured at open — cancel restores this. */
  composerSnapshot: ComposerInputSnapshot | null;
  /** Sealed confirmation after user confirms. */
  confirmation: BriefConfirmation | null;
  /** Video confirm accepted inside Brief (video path only). */
  videoConfirmAccepted: boolean;
};

export type BriefSummaryRow = {
  key: BriefSummaryFieldKey;
  label: string;
  value: string;
};

export type BriefSurfaceView = {
  visible: boolean;
  title: string;
  triggers: BriefTriggerHit[];
  summaryRows: BriefSummaryRow[];
  /** Empty → host MUST NOT render the evidence drawer. */
  evidenceEntries: BriefEvidenceEntry[];
  showEvidenceDrawer: boolean;
  videoConfirm: VideoConfirmZone | null;
  confirmLabel: string;
  cancelLabel: string;
  bindRevisions: BriefBoundRevisions | null;
  requiresVideoConfirm: boolean;
  videoConfirmAccepted: boolean;
  canConfirm: boolean;
  phase: BriefSurfacePhase;
};

export type SubmitPathDecision =
  | {
      path: 'direct_submit';
      reason: 'no_brief_required';
    }
  | {
      path: 'open_brief';
      reason: 'brief_required';
      projection: BriefTriggerProjection;
    }
  | {
      path: 'already_confirmed';
      reason: 'confirmation_valid';
      confirmation: BriefConfirmation;
    }
  | {
      path: 'blocked_quota';
      reason: 'quota_exhausted';
    };

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** True only when there is at least one real evidence entry. */
export function shouldShowEvidenceDrawer(
  entries: BriefEvidenceEntry[] | null | undefined
): boolean {
  return Array.isArray(entries) && entries.length > 0;
}

/**
 * Build merchant-facing summary rows from projection.summary.
 * Skips empty values — never re-asks Composer fields.
 */
export function buildBriefSummaryRows(
  summary: BriefSummaryFields | null | undefined
): BriefSummaryRow[] {
  if (!summary) return [];
  const rows: BriefSummaryRow[] = [];

  const push = (key: BriefSummaryFieldKey, raw: string | null | undefined) => {
    const value = (raw ?? '').trim();
    if (!value) return;
    rows.push({
      key,
      label: BRIEF_SUMMARY_FIELD_LABELS[key],
      value,
    });
  };

  push('targetDeliverable', summary.targetDeliverable ?? null);
  if (summary.platforms && summary.platforms.length > 0) {
    push('platforms', summary.platforms.join('、'));
  }
  push('sourceRightsSummary', summary.sourceRightsSummary ?? null);
  if (summary.keyFacts && summary.keyFacts.length > 0) {
    push('keyFacts', summary.keyFacts.join('；'));
  }
  push('modelAndSettings', summary.modelAndSettings ?? null);
  push('impactScope', summary.impactScope ?? null);
  push('estimatedCost', summary.estimatedCost ?? null);
  push('estimatedDuration', summary.estimatedDuration ?? null);
  if (summary.pendingItems && summary.pendingItems.length > 0) {
    push('pendingItems', summary.pendingItems.join('；'));
  }

  return rows;
}

/**
 * Strip evidence entries of any forbidden browser keys and drop empty shells.
 * Never exposes Provider / hidden prompt / internal route fields.
 */
export function projectEvidenceForBrowser(
  entries: BriefEvidenceEntry[] | null | undefined
): BriefEvidenceEntry[] {
  if (!entries || entries.length === 0) return [];
  const out: BriefEvidenceEntry[] = [];
  for (const entry of entries) {
    const sourceName = (entry.sourceName ?? '').trim();
    const sourceType = (entry.sourceType ?? '').trim();
    const factKind = (entry.factKind ?? '').trim();
    if (!sourceName || !sourceType || !factKind) continue;

    const cleaned = projectBrowserComposerPayload({
      sourceName,
      sourceType,
      factKind,
      ...(entry.factSummary ? { factSummary: entry.factSummary } : {}),
      ...(entry.appliedLocation
        ? { appliedLocation: entry.appliedLocation }
        : {}),
      ...(entry.updatedAt ? { updatedAt: entry.updatedAt } : {}),
      ...(entry.freshness ? { freshness: entry.freshness } : {}),
      ...(entry.rightsStatus ? { rightsStatus: entry.rightsStatus } : {}),
      ...(entry.uncertaintyOrConflict
        ? { uncertaintyOrConflict: entry.uncertaintyOrConflict }
        : {}),
      ...(entry.pendingConfirmation != null
        ? { pendingConfirmation: entry.pendingConfirmation }
        : {}),
    }) as unknown as BriefEvidenceEntry;

    if (findForbiddenBrowserComposerKey(cleaned) != null) continue;
    out.push(cleaned);
  }
  return out;
}

/**
 * Decide submit path from a live projection + optional prior confirmation
 * + quota flag. Simple tasks with requiresBrief=false go direct.
 */
export function decideSubmitPath(input: {
  projection: BriefTriggerProjection | null | undefined;
  confirmation?: BriefConfirmation | null;
  quotaExhausted?: boolean;
  /**
   * Video lens / video_confirm_required gate — force Brief open so the
   * merchant cannot runCreate without an explicit price-and-duration accept.
   * When true and a projection is present, always returns open_brief with
   * requiresBrief:true (even if the server projection said otherwise).
   */
  videoConfirmRequired?: boolean;
}): SubmitPathDecision {
  if (input.quotaExhausted) {
    return { path: 'blocked_quota', reason: 'quota_exhausted' };
  }

  const projection = input.projection;

  // Video confirm must open Brief whenever a projection exists.
  // Missing projection is the caller's responsibility (hint + never runCreate).
  if (input.videoConfirmRequired && projection) {
    return {
      path: 'open_brief',
      reason: 'brief_required',
      projection: { ...projection, requiresBrief: true },
    };
  }

  if (!projection) {
    return { path: 'direct_submit', reason: 'no_brief_required' };
  }

  if (!projection.requiresBrief) {
    if (input.confirmation && projection.confirmationValid) {
      return {
        path: 'already_confirmed',
        reason: 'confirmation_valid',
        confirmation: input.confirmation,
      };
    }
    return { path: 'direct_submit', reason: 'no_brief_required' };
  }

  return {
    path: 'open_brief',
    reason: 'brief_required',
    projection,
  };
}

export function createBriefSurfaceState(): BriefSurfaceState {
  return {
    phase: 'idle',
    projection: null,
    composerSnapshot: null,
    confirmation: null,
    videoConfirmAccepted: false,
  };
}

/**
 * Open Brief from a server projection, freezing the current Composer input.
 * Host must pass the live snapshot so cancel can restore it.
 */
export function openBriefSurface(
  state: BriefSurfaceState,
  input: {
    projection: BriefTriggerProjection;
    composerSnapshot: ComposerInputSnapshot;
  }
): BriefSurfaceState {
  if (!input.projection.requiresBrief) {
    return state;
  }
  return {
    phase: 'open',
    projection: input.projection,
    composerSnapshot: {
      userText: input.composerSnapshot.userText,
      sources: [...input.composerSnapshot.sources],
      lensId: input.composerSnapshot.lensId,
      draftRevisionId: input.composerSnapshot.draftRevisionId,
      ...(input.composerSnapshot.hostState
        ? {
            hostState: projectBrowserComposerPayload(
              input.composerSnapshot.hostState
            ),
          }
        : {}),
    },
    confirmation: null,
    videoConfirmAccepted: false,
  };
}

/** Toggle / set video confirm acceptance inside the open Brief. */
export function setBriefVideoConfirmAccepted(
  state: BriefSurfaceState,
  accepted: boolean
): BriefSurfaceState {
  if (state.phase !== 'open') return state;
  return { ...state, videoConfirmAccepted: accepted };
}

/**
 * Confirm Brief — seals exact bindRevisions from the open projection.
 * On video paths the single Brief confirmation CTA is the explicit
 * price-and-duration acceptance, preserving the three-click C6 budget.
 */
export function confirmBriefSurface(
  state: BriefSurfaceState,
  options?: { confirmedAt?: string }
):
  | { ok: true; state: BriefSurfaceState; confirmation: BriefConfirmation }
  | {
      ok: false;
      reason: 'not_open' | 'video_confirm_required';
      state: BriefSurfaceState;
    } {
  if (state.phase !== 'open' || !state.projection) {
    return { ok: false, reason: 'not_open', state };
  }

  const view = projectBriefSurfaceView(state, {
    lensId:
      state.composerSnapshot?.lensId ??
      state.projection.bindRevisions.lensId ??
      null,
    quote: null,
  });

  const confirmation: BriefConfirmation = {
    confirmedAt: options?.confirmedAt ?? new Date().toISOString(),
    boundRevisions: { ...state.projection.bindRevisions },
    triggerCodes: state.projection.triggers.map((t) => t.code),
  };

  return {
    ok: true,
    confirmation,
    state: {
      ...state,
      phase: 'confirmed',
      confirmation,
      videoConfirmAccepted:
        state.videoConfirmAccepted || view.requiresVideoConfirm,
    },
  };
}

/**
 * Cancel Brief — return to Composer with the frozen input snapshot.
 * Does NOT clear composerSnapshot so host can restore fields.
 */
export function cancelBriefSurface(state: BriefSurfaceState): {
  state: BriefSurfaceState;
  restored: ComposerInputSnapshot | null;
} {
  if (state.phase !== 'open') {
    return { state, restored: null };
  }
  const restored = state.composerSnapshot
    ? {
        userText: state.composerSnapshot.userText,
        sources: [...state.composerSnapshot.sources],
        lensId: state.composerSnapshot.lensId,
        draftRevisionId: state.composerSnapshot.draftRevisionId,
        ...(state.composerSnapshot.hostState
          ? { hostState: { ...state.composerSnapshot.hostState } }
          : {}),
      }
    : null;

  return {
    restored,
    state: {
      phase: 'cancelled',
      projection: null,
      composerSnapshot: restored,
      confirmation: null,
      videoConfirmAccepted: false,
    },
  };
}

/**
 * Project the open Brief into a render view.
 * When phase is not open, visible=false (host keeps Composer).
 */
export function projectBriefSurfaceView(
  state: BriefSurfaceState,
  options?: {
    lensId?: CreationLensId | null;
    quote?: ComposerQuoteView | null;
    amountFormatter?: (amount: number) => string;
  }
): BriefSurfaceView {
  if (state.phase !== 'open' || !state.projection) {
    return {
      visible: false,
      title: BRIEF_SURFACE_TITLE,
      triggers: [],
      summaryRows: [],
      evidenceEntries: [],
      showEvidenceDrawer: false,
      videoConfirm: null,
      confirmLabel: BRIEF_CONFIRM_LABEL,
      cancelLabel: BRIEF_CANCEL_LABEL,
      bindRevisions: null,
      requiresVideoConfirm: false,
      videoConfirmAccepted: state.videoConfirmAccepted,
      canConfirm: false,
      phase: state.phase,
    };
  }

  const projection = state.projection;
  const lensId =
    options?.lensId ??
    state.composerSnapshot?.lensId ??
    projection.bindRevisions.lensId ??
    null;

  const videoConfirm = buildVideoConfirmZone({
    lensId,
    quote: options?.quote ?? null,
    amountFormatter: options?.amountFormatter,
  });

  // Embed video confirm when any_video trigger fired OR lens is video.
  const hasVideoTrigger = projection.triggers.some(
    (t) => t.code === 'any_video'
  );
  const embedVideo = videoConfirm.visible || hasVideoTrigger;
  const embeddedVideo = embedVideo
    ? videoConfirm.visible
      ? videoConfirm
      : {
          ...videoConfirm,
          visible: true,
          title: videoConfirm.title || '确认视频生成',
          requiresExplicitConfirm: true,
        }
    : null;

  const evidenceEntries = projectEvidenceForBrowser(projection.evidenceDrawer);
  const requiresVideoConfirm = Boolean(embeddedVideo?.requiresExplicitConfirm);

  return {
    visible: true,
    title: BRIEF_SURFACE_TITLE,
    triggers: [...projection.triggers],
    summaryRows: buildBriefSummaryRows(projection.summary),
    evidenceEntries,
    showEvidenceDrawer: shouldShowEvidenceDrawer(evidenceEntries),
    videoConfirm: embeddedVideo,
    confirmLabel: BRIEF_CONFIRM_LABEL,
    cancelLabel: BRIEF_CANCEL_LABEL,
    bindRevisions: { ...projection.bindRevisions },
    requiresVideoConfirm,
    videoConfirmAccepted: state.videoConfirmAccepted,
    canConfirm: true,
    phase: state.phase,
  };
}

/**
 * Fixture helper for unit tests: build a minimal projection that fires
 * exactly the given trigger codes (or none).
 */
export function fixtureBriefProjection(input: {
  requiresBrief: boolean;
  triggerCodes?: BriefTriggerConditionCode[];
  evidenceDrawer?: BriefEvidenceEntry[];
  summary?: BriefSummaryFields;
  bindRevisions?: Partial<BriefBoundRevisions>;
  confirmationInvalid?: boolean;
  confirmationValid?: boolean;
  lensId?: CreationLensId | null;
}): BriefTriggerProjection {
  const codes = input.triggerCodes ?? [];
  const reasons: Record<BriefTriggerConditionCode, string> = {
    any_video: '本次包含视频生成，需确认成品、时长与费用',
    multi_deliverable_or_cross_platform: '多交付物或跨平台组合，需确认范围',
    images_over_four: '图片数量超过 4 张，需确认套图与费用',
    restricted_assets: '使用了顾客案例、前后对比或评价等受限素材，需确认权利',
    high_risk_fact_missing_or_conflict:
      '价格、期限、效果或资质等关键事实缺失或冲突',
    quote_policy_threshold: '预计费用达到额外确认门槛',
    confirmation_invalid: '草稿、模板、模型、报价或来源已变化，需重新确认',
  };

  const draftRevisionId =
    input.bindRevisions?.draftRevisionId ?? 'draft-rev-fixture';

  return {
    requiresBrief: input.requiresBrief,
    triggers: codes.map((code) => ({ code, reason: reasons[code] })),
    bindRevisions: {
      draftRevisionId,
      recipeRevisionId: input.bindRevisions?.recipeRevisionId ?? null,
      modelRevisionId: input.bindRevisions?.modelRevisionId ?? null,
      quoteRevisionId: input.bindRevisions?.quoteRevisionId ?? null,
      sourceRevisionId: input.bindRevisions?.sourceRevisionId ?? null,
      surfaceRevisionId: input.bindRevisions?.surfaceRevisionId ?? null,
      lensId: input.bindRevisions?.lensId ?? input.lensId ?? null,
    },
    confirmationInvalid: input.confirmationInvalid ?? false,
    confirmationValid: input.confirmationValid ?? false,
    evidenceDrawer: input.evidenceDrawer ?? [],
    summary: input.summary ?? {
      targetDeliverable: input.requiresBrief ? '测试成品' : null,
      platforms: input.requiresBrief ? ['小红书'] : undefined,
      sourceRightsSummary: input.requiresBrief ? '本店素材·已授权' : null,
      keyFacts: input.requiresBrief ? ['活动价 99'] : undefined,
      modelAndSettings: input.requiresBrief ? '默认模型' : null,
      impactScope: input.requiresBrief ? '仅本次' : null,
      estimatedCost: input.requiresBrief ? '3 条' : null,
      estimatedDuration: input.requiresBrief ? '约 30 秒' : null,
      pendingItems: input.requiresBrief ? ['确认费用'] : undefined,
    },
  };
}

/** Snapshot helper for browser contract tests. */
export function serializeBriefSurfaceForBrowser(
  view: BriefSurfaceView
): string {
  const payload = projectBrowserComposerPayload({
    visible: view.visible,
    title: view.title,
    triggers: view.triggers,
    summaryRows: view.summaryRows,
    evidenceEntries: view.evidenceEntries,
    showEvidenceDrawer: view.showEvidenceDrawer,
    videoConfirm: view.videoConfirm,
    bindRevisions: view.bindRevisions,
  });
  return JSON.stringify(payload);
}
