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

import * as m from '@/locale/paraglide/messages';

import {
  findForbiddenBrowserComposerKey,
  projectBrowserComposerPayload,
} from './browser-contract';
import { merchantDeliverableLabel } from './merchant-deliverable-label';
import type { ComposerQuoteView } from './quote-wiring';
import {
  buildVideoConfirmZone,
  type VideoConfirmZone,
} from './video-confirm-zone';

// ---------------------------------------------------------------------------
// Copy (merchant-facing; no provider / prompt / route internals)
// ---------------------------------------------------------------------------

function briefSummaryFieldLabels() {
  return {
    targetDeliverable: m.composer_brief_summary_target(),
    platforms: m.composer_brief_summary_platforms(),
    sourceRightsSummary: m.composer_brief_summary_source_rights(),
    keyFacts: m.composer_brief_summary_key_facts(),
    modelAndSettings: m.composer_brief_summary_model_settings(),
    impactScope: m.composer_brief_summary_impact_scope(),
    estimatedCost: m.composer_brief_summary_estimated_cost(),
    estimatedDuration: m.composer_brief_summary_estimated_duration(),
    pendingItems: m.composer_brief_summary_pending_items(),
  };
}

function briefTriggerReason(code: BriefTriggerConditionCode): string {
  const reasons: Record<BriefTriggerConditionCode, () => string> = {
    any_video: m.composer_brief_trigger_any_video,
    multi_deliverable_or_cross_platform:
      m.composer_brief_trigger_multi_deliverable,
    images_over_four: m.composer_brief_trigger_images_over_four,
    restricted_assets: m.composer_brief_trigger_restricted_assets,
    high_risk_fact_missing_or_conflict: m.composer_brief_trigger_high_risk_fact,
    quote_policy_threshold: m.composer_brief_trigger_quote_threshold,
    confirmation_invalid: m.composer_brief_trigger_confirmation_invalid,
  };
  return reasons[code]();
}

export function briefStaleQuoteNotice(): string {
  return m.composer_brief_stale_quote_notice();
}

export type BriefSummaryFieldKey = keyof ReturnType<
  typeof briefSummaryFieldLabels
>;

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
  /**
   * Set when the quote this Brief was built against is no longer the one the
   * merchant's current input produces. The card stays on screen — it is not
   * snatched away mid-read — but it stops being confirmable and says why.
   */
  staleNotice: string | null;
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
  summary: BriefSummaryFields | null | undefined,
  lensId?: CreationLensId | null
): BriefSummaryRow[] {
  if (!summary) return [];
  const rows: BriefSummaryRow[] = [];
  const labels = briefSummaryFieldLabels();

  const push = (key: BriefSummaryFieldKey, raw: string | null | undefined) => {
    const value = (raw ?? '').trim();
    if (!value) return;
    rows.push({
      key,
      label: labels[key],
      value,
    });
  };

  push(
    'targetDeliverable',
    summary.targetDeliverable
      ? merchantDeliverableLabel(summary.targetDeliverable, lensId)
      : null
  );
  if (summary.platforms && summary.platforms.length > 0) {
    push(
      'platforms',
      summary.platforms.join(m.composer_brief_list_separator())
    );
  }
  push('sourceRightsSummary', summary.sourceRightsSummary ?? null);
  if (summary.keyFacts && summary.keyFacts.length > 0) {
    push('keyFacts', summary.keyFacts.join(m.composer_brief_item_separator()));
  }
  push('modelAndSettings', summary.modelAndSettings ?? null);
  push('impactScope', summary.impactScope ?? null);
  push('estimatedCost', summary.estimatedCost ?? null);
  push('estimatedDuration', summary.estimatedDuration ?? null);
  if (summary.pendingItems && summary.pendingItems.length > 0) {
    push(
      'pendingItems',
      summary.pendingItems.join(m.composer_brief_item_separator())
    );
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
    /**
     * The host's `currentComposerQuoteView` came back empty while this Brief is
     * open — the merchant edited the intent (or the re-quote failed) after the
     * card was projected, so what it summarises no longer describes the run
     * they would get (#240 P1).
     */
    quoteStale?: boolean;
  }
): BriefSurfaceView {
  if (state.phase !== 'open' || !state.projection) {
    return {
      visible: false,
      title: m.composer_brief_title(),
      triggers: [],
      summaryRows: [],
      evidenceEntries: [],
      showEvidenceDrawer: false,
      videoConfirm: null,
      confirmLabel: m.composer_brief_confirm(),
      cancelLabel: m.composer_brief_cancel(),
      bindRevisions: null,
      requiresVideoConfirm: false,
      videoConfirmAccepted: state.videoConfirmAccepted,
      canConfirm: false,
      staleNotice: null,
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
          title: m.composer_brief_video_title(),
          requiresExplicitConfirm: true,
        }
    : null;

  const evidenceEntries = projectEvidenceForBrowser(projection.evidenceDrawer);
  const requiresVideoConfirm = Boolean(embeddedVideo?.requiresExplicitConfirm);

  return {
    visible: true,
    title: m.composer_brief_title(),
    triggers: projection.triggers.map((trigger) => ({
      ...trigger,
      reason: briefTriggerReason(trigger.code),
    })),
    summaryRows: buildBriefSummaryRows(projection.summary, lensId),
    evidenceEntries,
    showEvidenceDrawer: shouldShowEvidenceDrawer(evidenceEntries),
    videoConfirm: embeddedVideo,
    confirmLabel: m.composer_brief_confirm(),
    cancelLabel: m.composer_brief_cancel(),
    bindRevisions: { ...projection.bindRevisions },
    requiresVideoConfirm,
    videoConfirmAccepted: state.videoConfirmAccepted,
    // Was unconditionally true, which let a Brief built against a superseded
    // quote stay confirmable while the merchant kept typing (#240 P1).
    canConfirm: !options?.quoteStale,
    staleNotice: options?.quoteStale ? briefStaleQuoteNotice() : null,
    phase: state.phase,
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
