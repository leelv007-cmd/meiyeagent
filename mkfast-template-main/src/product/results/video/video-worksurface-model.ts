/**
 * Video Result Worksurface pure model (WT-E / #104 / D-085 §7 / D-088).
 *
 * Player / cover / subtitles / storyboard candidates / per-shot adjust /
 * single-shot regen / full recompose / "使用此成片" adopt / mobile P0 /
 * Pro Studio refine handoff.
 *
 * Contracts-only boundary: imports `@meiye/contracts` result-center +
 * video-workflow public projection. Does NOT import Result Shell internals
 * (`result-shell-model`, command adapter, page, token stream, etc.).
 *
 * Projection only — no Result table / second history / product ledger.
 * Billable regen scopes reuse E2 video-regeneration confirm contract
 * (shot | full_compose); free subtitle asset edits never open usage.
 */

import type {
  ResultActionId,
  ResultCenterNavigation,
  ResultUncommittedEditKey,
  ResultWorkspaceKind,
  VideoShotSummary,
  VideoWorkflowPublicProjection,
  VideoWorkflowPublicStatus,
} from '@meiye/contracts';
import { resultCenterPath, resultCenterSearchParams } from '@meiye/contracts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const VIDEO_WORKSPACE_KIND: ResultWorkspaceKind = 'video';

/** Mirrors core `videoFreeActions` — never produce a generation fee. */
export const videoWorksurfaceFreeActions = [
  'poll',
  'recover',
  'download_supplier_task',
  'adopt_candidate',
  'deterministic_sort',
  'subtitle_text_edit',
  'cover_select',
  'subtitle_toggle',
  'play_control',
  'select_shot_candidate',
] as const;

export type VideoWorksurfaceFreeAction =
  (typeof videoWorksurfaceFreeActions)[number];

export const videoBillableScopes = ['shot', 'full_compose'] as const;
export type VideoBillableScope = (typeof videoBillableScopes)[number];

/** Independent asset vs burned into the composed media. */
export type VideoSubtitleMode = 'independent_asset' | 'burned_in';

export type VideoCoverSource = 'frame' | 'authorized_image';

export type VideoLoopPhase =
  | 'running'
  | 'candidate_ready'
  | 'adopted'
  | 'delivered'
  | 'failed';

// ---------------------------------------------------------------------------
// Domain shapes (local worksurface — not a second Result store)
// ---------------------------------------------------------------------------

export type VideoPlayerState = {
  playing: boolean;
  currentTimeSeconds: number;
  durationSeconds: number;
  fullscreen: boolean;
  /** Bound track when independent subtitle asset is present. */
  subtitleTrackUrl: string | null;
  hasTranscript: boolean;
};

export type VideoCoverState = {
  source: VideoCoverSource | null;
  assetId: string | null;
  frameTimeSeconds: number | null;
  posterUrl: string | null;
};

export type VideoSubtitleState = {
  mode: VideoSubtitleMode;
  assetId: string | null;
  text: string;
  enabled: boolean;
  transcript: string | null;
  /** Local uncommitted text proof (independent asset). */
  draftText: string | null;
};

export type VideoShotCandidate = {
  index: number;
  /** Canonical asset id when known; omitted for count-only public summaries. */
  assetId?: string;
  selected: boolean;
};

export type VideoStoryboardShot = {
  shotId: string;
  promptPreview?: string;
  candidatesPerShot: number;
  candidates: VideoShotCandidate[];
  selectedCandidateIndex?: number;
  /** Local order index after deterministic reorder. */
  order: number;
};

export type VideoComposedCandidate = {
  assetId: string;
  playableUrl: string;
  posterUrl?: string;
  durationSeconds: number;
};

export type VideoAdoptionState = {
  status: 'none' | 'candidate_ready' | 'adopted';
  contentPackageId: string | null;
  contentRevision: number | null;
  composedAssetId: string | null;
  adoptedAt: string | null;
};

export type VideoDeliveryState = {
  attempt:
    | 'none'
    | 'awaiting_approval'
    | 'delivering'
    | 'partial'
    | 'failed'
    | 'delivered';
};

export type VideoPendingQuote = {
  scope: VideoBillableScope;
  shotId?: string;
  /** Confirm-zone label (E2). */
  actionLabel: string;
  requiresConfirm: true;
  createsNewTaskAndIndependentQuote: true;
};

export type VideoUncommittedAdjustments = {
  coverDraft?: VideoCoverState;
  subtitleDraftText?: string;
  shotOrder?: string[];
  shotSelections?: Record<string, number>;
};

/**
 * Full worksurface snapshot assembled from public workflow projection +
 * local selection / uncommitted drafts. Not a durable Result entity.
 */
export type VideoWorksurfaceState = {
  workId: string;
  workflowId: string;
  workflowRevision: number;
  workflowStatus: VideoWorkflowPublicStatus;
  catalogModelId: string;
  storyboardRevision: string;
  storyboardVersion: number;
  baseRevisionId: string;
  surfaceVersion: string;
  contentId?: string;
  versionId?: string;
  selectedObjectId?: string;
  player: VideoPlayerState;
  cover: VideoCoverState;
  subtitle: VideoSubtitleState;
  storyboard: VideoStoryboardShot[];
  composedCandidate: VideoComposedCandidate | null;
  adoption: VideoAdoptionState;
  delivery: VideoDeliveryState;
  pendingQuote: VideoPendingQuote | null;
  uncommitted: VideoUncommittedAdjustments;
  loopPhase: VideoLoopPhase;
};

// ---------------------------------------------------------------------------
// Fee classification
// ---------------------------------------------------------------------------

export type VideoFreeEditFeeDecision = {
  fee: 'none';
  freeAction: VideoWorksurfaceFreeAction;
  createsProductUsage: false;
  requiresFullRecomposeQuote: false;
};

export type VideoBillableEditFeeDecision = {
  fee: 'billable';
  scope: VideoBillableScope;
  freeAction: null;
  createsProductUsage: true;
  requiresFullRecomposeQuote: boolean;
  actionLabel: string;
  reason: string;
};

export type VideoEditFeeDecision =
  | VideoFreeEditFeeDecision
  | VideoBillableEditFeeDecision;

export function classifyCoverSelect(): VideoEditFeeDecision {
  return {
    fee: 'none',
    freeAction: 'cover_select',
    createsProductUsage: false,
    requiresFullRecomposeQuote: false,
  };
}

export function classifyPlayControl(): VideoEditFeeDecision {
  return {
    fee: 'none',
    freeAction: 'play_control',
    createsProductUsage: false,
    requiresFullRecomposeQuote: false,
  };
}

export function classifyShotCandidateSelect(): VideoEditFeeDecision {
  return {
    fee: 'none',
    freeAction: 'select_shot_candidate',
    createsProductUsage: false,
    requiresFullRecomposeQuote: false,
  };
}

export function classifyDeterministicSort(): VideoEditFeeDecision {
  return {
    fee: 'none',
    freeAction: 'deterministic_sort',
    createsProductUsage: false,
    requiresFullRecomposeQuote: false,
  };
}

export function classifyAdoptCandidate(): VideoEditFeeDecision {
  return {
    fee: 'none',
    freeAction: 'adopt_candidate',
    createsProductUsage: false,
    requiresFullRecomposeQuote: false,
  };
}

/**
 * Independent subtitle asset text / toggle / style-on-asset: free.
 * Burned-in subtitle change requires full recompose + independent quote.
 */
export function classifySubtitleEdit(input: {
  mode: 'independent_asset';
  change: 'text' | 'toggle' | 'style' | 'replace_asset';
}): VideoFreeEditFeeDecision;
export function classifySubtitleEdit(input: {
  mode: 'burned_in';
  change: 'text' | 'toggle' | 'style' | 'replace_asset';
}): VideoBillableEditFeeDecision;
export function classifySubtitleEdit(input: {
  mode: VideoSubtitleMode;
  change: 'text' | 'toggle' | 'style' | 'replace_asset';
}): VideoEditFeeDecision;
export function classifySubtitleEdit(input: {
  mode: VideoSubtitleMode;
  change: 'text' | 'toggle' | 'style' | 'replace_asset';
}): VideoEditFeeDecision {
  if (input.mode === 'independent_asset') {
    // Pure asset edit — no media re-encode, no generation fee (D-088 §1 / #104).
    return {
      fee: 'none',
      freeAction:
        input.change === 'toggle' ? 'subtitle_toggle' : 'subtitle_text_edit',
      createsProductUsage: false,
      requiresFullRecomposeQuote: false,
    };
  }

  // Burned-in: any text/style change needs media re-render → full_compose quote.
  return {
    fee: 'billable',
    scope: 'full_compose',
    freeAction: null,
    createsProductUsage: true,
    requiresFullRecomposeQuote: true,
    actionLabel: '重新合成整段',
    reason: '烧录字幕改动需要媒体重渲染，须走整段重新合成并独立报价',
  };
}

export function classifyShotRegen(
  shotId: string
): VideoBillableEditFeeDecision {
  if (!shotId.trim()) {
    throw new Error('classifyShotRegen requires shotId');
  }
  return {
    fee: 'billable',
    scope: 'shot',
    freeAction: null,
    createsProductUsage: true,
    requiresFullRecomposeQuote: false,
    actionLabel: '重新生成此镜头',
    reason: '单镜重生成是新的独立计费生成任务',
  };
}

export function classifyFullRecompose(): VideoBillableEditFeeDecision {
  return {
    fee: 'billable',
    scope: 'full_compose',
    freeAction: null,
    createsProductUsage: true,
    requiresFullRecomposeQuote: true,
    actionLabel: '重新合成整段',
    reason: '整段重新合成是新的独立计费生成任务',
  };
}

// ---------------------------------------------------------------------------
// Fixture + builders
// ---------------------------------------------------------------------------

export type BuildVideoWorksurfaceInput = {
  workId: string;
  workflow: VideoWorkflowPublicProjection;
  baseRevisionId: string;
  surfaceVersion?: string;
  contentId?: string;
  versionId?: string;
  selectedObjectId?: string;
  composedCandidate?: VideoComposedCandidate | null;
  subtitleMode?: VideoSubtitleMode;
  subtitleText?: string;
  subtitleAssetId?: string;
  subtitleEnabled?: boolean;
  transcript?: string | null;
  cover?: Partial<VideoCoverState>;
  adoption?: Partial<VideoAdoptionState>;
  delivery?: Partial<VideoDeliveryState>;
  uncommitted?: VideoUncommittedAdjustments;
};

function shotsFromPublic(shots: VideoShotSummary[]): VideoStoryboardShot[] {
  return shots.map((shot, order) => {
    const selected = shot.selectedCandidateIndex;
    // Public projection only exposes candidateCount — never fabricate asset ids.
    // Slots exist for display / index selection; assetId stays optional.
    const candidateCount = Math.max(shot.candidateCount, 0);
    const candidates: VideoShotCandidate[] = Array.from(
      { length: candidateCount },
      (_, index) => ({
        index,
        selected: selected === index,
      })
    );
    return {
      shotId: shot.shotId,
      ...(shot.promptPreview ? { promptPreview: shot.promptPreview } : {}),
      candidatesPerShot: shot.candidatesPerShot,
      candidates,
      ...(selected !== undefined ? { selectedCandidateIndex: selected } : {}),
      order,
    };
  });
}

function deriveLoopPhase(input: {
  workflowStatus: VideoWorkflowPublicStatus;
  adoption: VideoAdoptionState;
  delivery: VideoDeliveryState;
  hasComposedCandidate: boolean;
}): VideoLoopPhase {
  if (input.delivery.attempt === 'delivered') return 'delivered';
  if (input.adoption.status === 'adopted') return 'adopted';
  if (input.workflowStatus === 'failed') return 'failed';
  if (
    input.workflowStatus === 'running' ||
    input.workflowStatus === 'draft' ||
    input.workflowStatus === 'cancel_requested'
  ) {
    return 'running';
  }
  if (
    input.hasComposedCandidate ||
    input.adoption.status === 'candidate_ready' ||
    input.workflowStatus === 'completed' ||
    input.workflowStatus === 'awaiting_quality_review'
  ) {
    return 'candidate_ready';
  }
  return 'running';
}

/** Build worksurface state from public projection + local facts. */
export function buildVideoWorksurfaceState(
  input: BuildVideoWorksurfaceInput
): VideoWorksurfaceState {
  if (!input.workId.trim()) {
    throw new Error('VideoWorksurface requires non-empty workId');
  }

  const subtitleMode = input.subtitleMode ?? 'independent_asset';
  const subtitleText = input.subtitleText ?? input.workflow.subtitleText ?? '';
  const adoption: VideoAdoptionState = {
    status: 'none',
    contentPackageId: null,
    contentRevision: null,
    composedAssetId: null,
    adoptedAt: null,
    ...input.adoption,
  };
  const delivery: VideoDeliveryState = {
    attempt: 'none',
    ...input.delivery,
  };
  const composed = input.composedCandidate ?? null;
  const duration = composed?.durationSeconds ?? 0;

  const state: VideoWorksurfaceState = {
    workId: input.workId,
    workflowId: input.workflow.workflowId,
    workflowRevision: input.workflow.revision,
    workflowStatus: input.workflow.status,
    catalogModelId: input.workflow.catalogModelId,
    storyboardRevision: input.workflow.storyboardRevision,
    storyboardVersion: input.workflow.storyboardVersion,
    baseRevisionId: input.baseRevisionId,
    surfaceVersion: input.surfaceVersion ?? 'video-worksurface-v1',
    ...(input.contentId ? { contentId: input.contentId } : {}),
    ...(input.versionId ? { versionId: input.versionId } : {}),
    ...(input.selectedObjectId
      ? { selectedObjectId: input.selectedObjectId }
      : {}),
    player: {
      playing: false,
      currentTimeSeconds: 0,
      durationSeconds: duration,
      fullscreen: false,
      subtitleTrackUrl:
        subtitleMode === 'independent_asset' && input.subtitleAssetId
          ? `/v1/assets/${input.subtitleAssetId}`
          : null,
      hasTranscript: Boolean(input.transcript?.trim()),
    },
    cover: {
      source: input.cover?.source ?? null,
      assetId: input.cover?.assetId ?? null,
      frameTimeSeconds: input.cover?.frameTimeSeconds ?? null,
      posterUrl: input.cover?.posterUrl ?? composed?.posterUrl ?? null,
    },
    subtitle: {
      mode: subtitleMode,
      assetId: input.subtitleAssetId ?? null,
      text: subtitleText,
      enabled: input.subtitleEnabled ?? true,
      transcript: input.transcript ?? null,
      draftText: null,
    },
    storyboard: shotsFromPublic(input.workflow.shots),
    composedCandidate: composed,
    adoption,
    delivery,
    pendingQuote: null,
    uncommitted: input.uncommitted ?? {},
    loopPhase: 'running',
  };

  state.loopPhase = deriveLoopPhase({
    workflowStatus: state.workflowStatus,
    adoption: state.adoption,
    delivery: state.delivery,
    hasComposedCandidate: Boolean(state.composedCandidate),
  });

  return state;
}

/**
 * Recorded fixture for unit / e2e (真机 fixture 档) closed-loop tests.
 * No live Provider — pure projection data.
 */
export function videoWorksurfaceFixture(
  overrides: Partial<BuildVideoWorksurfaceInput> = {}
): VideoWorksurfaceState {
  const workflow: VideoWorkflowPublicProjection = {
    workflowId: 'wf-video-fixture-1',
    workId: 'work-video-1',
    status: 'completed',
    storyboardVersion: 1,
    storyboardRevision: 'sb-rev-1',
    catalogModelId: 'seedance-2',
    confirmed: true,
    shots: [
      {
        shotId: 'shot-opening',
        promptPreview: '开场门店亮相',
        candidatesPerShot: 2,
        selectedCandidateIndex: 0,
        candidateCount: 2,
      },
      {
        shotId: 'shot-service',
        promptPreview: '项目演示',
        candidatesPerShot: 2,
        selectedCandidateIndex: 1,
        candidateCount: 2,
      },
      {
        shotId: 'shot-cta',
        promptPreview: '行动号召',
        candidatesPerShot: 1,
        selectedCandidateIndex: 0,
        candidateCount: 1,
      },
    ],
    revision: 3,
    updatedAt: '2026-07-20T12:00:00.000Z',
    ...((overrides.workflow as Partial<VideoWorkflowPublicProjection>) ?? {}),
  };

  return buildVideoWorksurfaceState({
    workId: overrides.workId ?? 'work-video-1',
    workflow,
    baseRevisionId: overrides.baseRevisionId ?? 'rev-cp-2',
    surfaceVersion: overrides.surfaceVersion ?? 'video-worksurface-v1',
    contentId: overrides.contentId ?? 'cp-video-1',
    versionId: overrides.versionId ?? 'rev-cp-2',
    selectedObjectId: overrides.selectedObjectId ?? 'composed-asset-1',
    composedCandidate:
      overrides.composedCandidate === undefined
        ? {
            assetId: 'composed-asset-1',
            playableUrl: '/v1/assets/composed-asset-1',
            posterUrl: '/seed/video/video-poster-vertical.webp',
            durationSeconds: 24,
          }
        : overrides.composedCandidate,
    subtitleMode: overrides.subtitleMode ?? 'independent_asset',
    subtitleText: overrides.subtitleText ?? '欢迎到店体验 · 夏季护理套餐',
    subtitleAssetId: overrides.subtitleAssetId ?? 'sub-asset-1',
    subtitleEnabled: overrides.subtitleEnabled ?? true,
    transcript:
      overrides.transcript === undefined
        ? '欢迎到店体验 · 夏季护理套餐'
        : overrides.transcript,
    cover: overrides.cover,
    adoption: overrides.adoption ?? { status: 'candidate_ready' },
    delivery: overrides.delivery,
    uncommitted: overrides.uncommitted,
  });
}

// ---------------------------------------------------------------------------
// Player / cover / subtitle mutations (pure)
// ---------------------------------------------------------------------------

export function togglePlay(
  state: VideoWorksurfaceState
): VideoWorksurfaceState {
  classifyPlayControl(); // fee assert side-document
  return {
    ...state,
    player: { ...state.player, playing: !state.player.playing },
  };
}

export function seekPlayer(
  state: VideoWorksurfaceState,
  timeSeconds: number
): VideoWorksurfaceState {
  const clamped = Math.max(
    0,
    Math.min(timeSeconds, state.player.durationSeconds)
  );
  return {
    ...state,
    player: { ...state.player, currentTimeSeconds: clamped },
  };
}

export function setFullscreen(
  state: VideoWorksurfaceState,
  fullscreen: boolean
): VideoWorksurfaceState {
  return {
    ...state,
    player: { ...state.player, fullscreen },
  };
}

export function setCoverFromFrame(
  state: VideoWorksurfaceState,
  frameTimeSeconds: number
): { state: VideoWorksurfaceState; fee: VideoEditFeeDecision } {
  const fee = classifyCoverSelect();
  const nextCover: VideoCoverState = {
    source: 'frame',
    assetId: state.composedCandidate?.assetId ?? null,
    frameTimeSeconds,
    posterUrl: state.composedCandidate?.posterUrl ?? state.cover.posterUrl,
  };
  return {
    fee,
    state: {
      ...state,
      cover: nextCover,
      uncommitted: {
        ...state.uncommitted,
        coverDraft: nextCover,
      },
      selectedObjectId:
        state.composedCandidate?.assetId ?? state.selectedObjectId,
    },
  };
}

export function setCoverFromAuthorizedImage(
  state: VideoWorksurfaceState,
  assetId: string,
  posterUrl?: string
): { state: VideoWorksurfaceState; fee: VideoEditFeeDecision } {
  const fee = classifyCoverSelect();
  const nextCover: VideoCoverState = {
    source: 'authorized_image',
    assetId,
    frameTimeSeconds: null,
    posterUrl: posterUrl ?? `/v1/assets/${assetId}`,
  };
  return {
    fee,
    state: {
      ...state,
      cover: nextCover,
      uncommitted: {
        ...state.uncommitted,
        coverDraft: nextCover,
      },
      selectedObjectId: assetId,
    },
  };
}

/**
 * Independent subtitle asset text proof — free, no re-encode.
 * Burned-in mode refuses free path and returns a full_compose quote intent.
 */
export function editSubtitleText(
  state: VideoWorksurfaceState,
  nextText: string
): {
  state: VideoWorksurfaceState;
  fee: VideoEditFeeDecision;
  pendingQuote: VideoPendingQuote | null;
} {
  const fee = classifySubtitleEdit({
    mode: state.subtitle.mode,
    change: 'text',
  });

  if (fee.fee === 'billable') {
    const pendingQuote: VideoPendingQuote = {
      scope: 'full_compose',
      actionLabel: fee.actionLabel,
      requiresConfirm: true,
      createsNewTaskAndIndependentQuote: true,
    };
    return {
      fee,
      pendingQuote,
      state: {
        ...state,
        pendingQuote,
        // Do not apply burned-in text without recompose.
      },
    };
  }

  return {
    fee,
    pendingQuote: null,
    state: {
      ...state,
      subtitle: {
        ...state.subtitle,
        text: nextText,
        draftText: nextText,
      },
      uncommitted: {
        ...state.uncommitted,
        subtitleDraftText: nextText,
      },
      pendingQuote: null,
    },
  };
}

export function toggleSubtitleEnabled(state: VideoWorksurfaceState): {
  state: VideoWorksurfaceState;
  fee: VideoEditFeeDecision;
  pendingQuote: VideoPendingQuote | null;
} {
  const fee = classifySubtitleEdit({
    mode: state.subtitle.mode,
    change: 'toggle',
  });

  if (fee.fee === 'billable') {
    const pendingQuote: VideoPendingQuote = {
      scope: 'full_compose',
      actionLabel: fee.actionLabel,
      requiresConfirm: true,
      createsNewTaskAndIndependentQuote: true,
    };
    return {
      fee,
      pendingQuote,
      state: { ...state, pendingQuote },
    };
  }

  const enabled = !state.subtitle.enabled;
  return {
    fee,
    pendingQuote: null,
    state: {
      ...state,
      subtitle: { ...state.subtitle, enabled },
      player: {
        ...state.player,
        subtitleTrackUrl:
          enabled && state.subtitle.assetId
            ? `/v1/assets/${state.subtitle.assetId}`
            : null,
      },
      pendingQuote: null,
    },
  };
}

// ---------------------------------------------------------------------------
// Storyboard / regen / adopt / deliver
// ---------------------------------------------------------------------------

export function selectShotCandidate(
  state: VideoWorksurfaceState,
  shotId: string,
  candidateIndex: number
): { state: VideoWorksurfaceState; fee: VideoEditFeeDecision } {
  const fee = classifyShotCandidateSelect();
  const storyboard = state.storyboard.map((shot) => {
    if (shot.shotId !== shotId) return shot;
    return {
      ...shot,
      selectedCandidateIndex: candidateIndex,
      candidates: shot.candidates.map((c) => ({
        ...c,
        selected: c.index === candidateIndex,
      })),
    };
  });
  const selections = {
    ...(state.uncommitted.shotSelections ?? {}),
    [shotId]: candidateIndex,
  };
  return {
    fee,
    state: {
      ...state,
      storyboard,
      selectedObjectId: shotId,
      uncommitted: { ...state.uncommitted, shotSelections: selections },
    },
  };
}

/** Deterministic reorder — free, no generation fee. */
export function reorderShots(
  state: VideoWorksurfaceState,
  orderedShotIds: string[]
): { state: VideoWorksurfaceState; fee: VideoEditFeeDecision } {
  const fee = classifyDeterministicSort();
  const byId = new Map(state.storyboard.map((s) => [s.shotId, s]));
  if (
    orderedShotIds.length !== state.storyboard.length ||
    orderedShotIds.some((id) => !byId.has(id))
  ) {
    throw new Error('reorderShots requires a permutation of current shot ids');
  }
  const storyboard = orderedShotIds.map((id, order) => ({
    ...byId.get(id)!,
    order,
  }));
  return {
    fee,
    state: {
      ...state,
      storyboard,
      uncommitted: { ...state.uncommitted, shotOrder: orderedShotIds },
    },
  };
}

/** Request single-shot regen — opens billable shot quote (E2 confirm). */
export function requestShotRegen(
  state: VideoWorksurfaceState,
  shotId: string
): { state: VideoWorksurfaceState; fee: VideoBillableEditFeeDecision } {
  if (!state.storyboard.some((s) => s.shotId === shotId)) {
    throw new Error(`Unknown shotId: ${shotId}`);
  }
  const fee = classifyShotRegen(shotId);
  const pendingQuote: VideoPendingQuote = {
    scope: 'shot',
    shotId,
    actionLabel: fee.actionLabel,
    requiresConfirm: true,
    createsNewTaskAndIndependentQuote: true,
  };
  return {
    fee,
    state: {
      ...state,
      pendingQuote,
      selectedObjectId: shotId,
    },
  };
}

/** Request full recompose — opens billable full_compose quote (E2 confirm). */
export function requestFullRecompose(state: VideoWorksurfaceState): {
  state: VideoWorksurfaceState;
  fee: VideoBillableEditFeeDecision;
} {
  const fee = classifyFullRecompose();
  const pendingQuote: VideoPendingQuote = {
    scope: 'full_compose',
    actionLabel: fee.actionLabel,
    requiresConfirm: true,
    createsNewTaskAndIndependentQuote: true,
  };
  return {
    fee,
    state: { ...state, pendingQuote },
  };
}

/**
 * "使用此成片" — adopt composed candidate into ContentPackage revision.
 * Free action (no generation fee). Shot candidates alone cannot adopt.
 */
export function adoptComposedFilm(
  state: VideoWorksurfaceState,
  input: {
    contentPackageId: string;
    now?: string;
  }
): {
  state: VideoWorksurfaceState;
  fee: VideoEditFeeDecision;
  contentRevision: number;
} {
  const fee = classifyAdoptCandidate();
  if (!state.composedCandidate) {
    throw new Error('使用此成片 requires a composed candidate');
  }
  if (state.loopPhase === 'running') {
    throw new Error('Cannot adopt while run is still in progress');
  }

  const priorRevision = state.adoption.contentRevision ?? 0;
  const contentRevision = priorRevision + 1;
  const adoption: VideoAdoptionState = {
    status: 'adopted',
    contentPackageId: input.contentPackageId,
    contentRevision,
    composedAssetId: state.composedCandidate.assetId,
    adoptedAt: input.now ?? new Date().toISOString(),
  };

  return {
    fee,
    contentRevision,
    state: {
      ...state,
      adoption,
      contentId: input.contentPackageId,
      versionId: `rev-${contentRevision}`,
      baseRevisionId: `rev-${contentRevision}`,
      loopPhase: 'adopted',
      pendingQuote: null,
      // Clear uncommitted after successful adopt commit path.
      uncommitted: {},
    },
  };
}

/** Delivery capability entry after adopt — free shell action. */
export function markDelivered(
  state: VideoWorksurfaceState
): VideoWorksurfaceState {
  if (state.adoption.status !== 'adopted') {
    throw new Error('Deliver requires an adopted film');
  }
  return {
    ...state,
    delivery: { attempt: 'delivered' },
    loopPhase: 'delivered',
  };
}

export function markDeliveryInProgress(
  state: VideoWorksurfaceState
): VideoWorksurfaceState {
  if (state.adoption.status !== 'adopted') {
    throw new Error('Deliver requires an adopted film');
  }
  return {
    ...state,
    delivery: { attempt: 'delivering' },
  };
}

// ---------------------------------------------------------------------------
// Shared result actions (contracts ResultActionId — no shell import)
// ---------------------------------------------------------------------------

export type VideoWorksurfaceAction = {
  id: ResultActionId;
  role: 'primary' | 'secondary' | 'overflow';
  label: string;
  enabled: boolean;
};

/**
 * Project primary/secondary/overflow from loop phase using shared
 * ResultActionId semantics. Labels follow D-085 video column.
 */
export function projectVideoWorksurfaceActions(state: VideoWorksurfaceState): {
  primaryAction: VideoWorksurfaceAction | null;
  secondaryActions: VideoWorksurfaceAction[];
  overflowActions: VideoWorksurfaceAction[];
} {
  const overflow: VideoWorksurfaceAction[] = [
    {
      id: 'open_history',
      role: 'overflow',
      label: '版本与历史',
      enabled: true,
    },
    {
      id: 'open_run_detail',
      role: 'overflow',
      label: '运行详情',
      enabled: true,
    },
  ];

  switch (state.loopPhase) {
    case 'running':
      return {
        primaryAction: {
          id: 'leave_and_continue',
          role: 'primary',
          label: '离开并后台继续',
          enabled: true,
        },
        secondaryActions: [],
        overflowActions: [
          {
            id: 'cancel_run',
            role: 'overflow',
            label: '取消',
            enabled: true,
          },
          ...overflow,
        ],
      };
    case 'failed':
      return {
        primaryAction: {
          id: 'retry',
          role: 'primary',
          label: '重试',
          enabled: true,
        },
        secondaryActions: [
          {
            id: 'continue_adjust',
            role: 'secondary',
            label: '继续调整',
            enabled: true,
          },
        ],
        overflowActions: overflow,
      };
    case 'candidate_ready':
      return {
        primaryAction: {
          id: 'adopt_candidate',
          role: 'primary',
          label: '使用此成片',
          enabled: Boolean(state.composedCandidate),
        },
        secondaryActions: [
          {
            id: 'continue_adjust',
            role: 'secondary',
            label: '继续调整',
            enabled: true,
          },
          {
            id: 'deliver',
            role: 'secondary',
            label: '交付',
            enabled: true,
          },
        ],
        overflowActions: overflow,
      };
    case 'adopted':
      return {
        primaryAction: {
          id: 'deliver',
          role: 'primary',
          label: '交付',
          enabled: true,
        },
        secondaryActions: [
          {
            id: 'continue_adjust',
            role: 'secondary',
            label: '继续调整',
            enabled: true,
          },
          {
            id: 'create_from_this',
            role: 'secondary',
            label: '基于此再创作',
            enabled: true,
          },
        ],
        overflowActions: overflow,
      };
    case 'delivered':
      return {
        primaryAction: {
          id: 'create_from_this',
          role: 'primary',
          label: '基于此再创作',
          enabled: true,
        },
        secondaryActions: [
          {
            id: 'continue_adjust',
            role: 'secondary',
            label: '继续调整',
            enabled: true,
          },
          {
            id: 'open_history',
            role: 'secondary',
            label: '版本与历史',
            enabled: true,
          },
        ],
        overflowActions: [
          {
            id: 'open_run_detail',
            role: 'overflow',
            label: '运行详情',
            enabled: true,
          },
        ],
      };
    default: {
      const _exhaustive: never = state.loopPhase;
      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Mobile P0
// ---------------------------------------------------------------------------

export type VideoMobileP0ActionId =
  | 'play'
  | 'light_cover'
  | 'subtitle_proof'
  | ResultActionId;

export type VideoMobileP0Action = {
  id: VideoMobileP0ActionId;
  label: string;
  enabled: boolean;
  /** Shared result action vs media-local control. */
  kind: 'media' | 'result';
};

/**
 * Mobile P0: play / light cover / subtitle proof + shared result actions.
 * Must not collapse to "请到桌面继续" for these basics (D-085 §8).
 */
export function projectVideoMobileP0Actions(state: VideoWorksurfaceState): {
  mediaActions: VideoMobileP0Action[];
  primaryResult: VideoMobileP0Action | null;
  moreResult: VideoMobileP0Action[];
  /** Explicit negative: never require desktop for P0 media actions. */
  requiresDesktopContinue: false;
} {
  const mediaActions: VideoMobileP0Action[] = [
    {
      id: 'play',
      label: state.player.playing ? '暂停' : '播放',
      enabled: Boolean(state.composedCandidate),
      kind: 'media',
    },
    {
      id: 'light_cover',
      label: '设置封面',
      enabled: Boolean(state.composedCandidate),
      kind: 'media',
    },
    {
      id: 'subtitle_proof',
      label: '字幕校对',
      enabled:
        state.subtitle.mode === 'independent_asset' ||
        state.subtitle.mode === 'burned_in',
      kind: 'media',
    },
  ];

  const actions = projectVideoWorksurfaceActions(state);
  const primaryResult: VideoMobileP0Action | null = actions.primaryAction
    ? {
        id: actions.primaryAction.id,
        label: actions.primaryAction.label,
        enabled: actions.primaryAction.enabled,
        kind: 'result',
      }
    : null;

  const moreResult: VideoMobileP0Action[] = [
    ...actions.secondaryActions,
    ...actions.overflowActions,
  ].map((a) => ({
    id: a.id,
    label: a.label,
    enabled: a.enabled,
    kind: 'result' as const,
  }));

  return {
    mediaActions,
    primaryResult,
    moreResult,
    requiresDesktopContinue: false,
  };
}

// ---------------------------------------------------------------------------
// Pro Studio refine handoff
// ---------------------------------------------------------------------------

export type VideoProStudioRefineHandoff = {
  /** Canonical gate path — never deep-link past entitlement. */
  entryPath: '/pro-studio';
  /** Clicking entry does not create an empty canvas project. */
  createsEmptyProject: false;
  workId: string;
  contentId?: string;
  versionId?: string;
  selectedObjectId?: string;
  baseRevisionId: string;
  uncommittedEditKey: ResultUncommittedEditKey;
  /** Local uncommitted adjustments carried across refine. */
  uncommitted: VideoUncommittedAdjustments;
  /** Typed return navigation (result-center contract). */
  returnNavigation: ResultCenterNavigation;
  returnPath: string;
  returnSearch: Record<string, string>;
};

/**
 * Build Pro Studio refine entry context.
 * Preserves current revision / selection / uncommitted adjustments.
 */
export function buildVideoProStudioRefineHandoff(
  state: VideoWorksurfaceState,
  options?: { returnToDraftKey?: string; focusKey?: string }
): VideoProStudioRefineHandoff {
  const focusKey = options?.focusKey ?? state.selectedObjectId;
  const uncommittedEditKey: ResultUncommittedEditKey = {
    workspaceKind: VIDEO_WORKSPACE_KIND,
    workId: state.workId,
    baseRevisionId: state.baseRevisionId,
    surfaceVersion: state.surfaceVersion,
  };

  const returnNavigation: ResultCenterNavigation = {
    workId: state.workId,
    ...(options?.returnToDraftKey
      ? { returnToDraftKey: options.returnToDraftKey }
      : {}),
    ...(focusKey ? { focusKey } : {}),
  };

  const returnSearch = resultCenterSearchParams({
    ...(state.contentId ? { contentId: state.contentId } : {}),
    ...(state.versionId ? { versionId: state.versionId } : {}),
    panel: 'result',
    ...(focusKey ? { focusKey } : {}),
  });

  return {
    entryPath: '/pro-studio',
    createsEmptyProject: false,
    workId: state.workId,
    ...(state.contentId ? { contentId: state.contentId } : {}),
    ...(state.versionId ? { versionId: state.versionId } : {}),
    ...(state.selectedObjectId
      ? { selectedObjectId: state.selectedObjectId }
      : {}),
    baseRevisionId: state.baseRevisionId,
    uncommittedEditKey,
    uncommitted: structuredClone(state.uncommitted),
    returnNavigation,
    returnPath: resultCenterPath(state.workId),
    returnSearch,
  };
}

// ---------------------------------------------------------------------------
// Closed loop runner (fixture e2e)
// ---------------------------------------------------------------------------

export type VideoLoopStep = {
  step: string;
  phase: VideoLoopPhase;
  primaryActionId: ResultActionId | null;
  primaryActionLabel: string | null;
  contentRevision: number | null;
  deliveryAttempt: VideoDeliveryState['attempt'];
  createsProductUsage: boolean;
};

/**
 * candidate → adopt → deliver closed loop (fixture grade).
 * Asserts shared action ids and that adopt/deliver are free of gen fees.
 */
export function runCandidateAdoptDeliverLoop(
  initial: VideoWorksurfaceState = videoWorksurfaceFixture()
): {
  steps: VideoLoopStep[];
  final: VideoWorksurfaceState;
} {
  const steps: VideoLoopStep[] = [];

  let state = initial;
  const snap = (step: string, createsProductUsage: boolean) => {
    const actions = projectVideoWorksurfaceActions(state);
    steps.push({
      step,
      phase: state.loopPhase,
      primaryActionId: actions.primaryAction?.id ?? null,
      primaryActionLabel: actions.primaryAction?.label ?? null,
      contentRevision: state.adoption.contentRevision,
      deliveryAttempt: state.delivery.attempt,
      createsProductUsage,
    });
  };

  snap('candidate_ready', false);
  if (state.loopPhase !== 'candidate_ready') {
    throw new Error(
      `Loop expects candidate_ready start, got ${state.loopPhase}`
    );
  }

  const adopted = adoptComposedFilm(state, {
    contentPackageId: state.contentId ?? 'cp-video-1',
    now: '2026-07-20T12:05:00.000Z',
  });
  if (adopted.fee.createsProductUsage) {
    throw new Error('采用成片 must not create product usage');
  }
  state = adopted.state;
  snap('adopted', false);

  state = markDelivered(state);
  snap('delivered', false);

  return { steps, final: state };
}

/** Marker: worksurface is pure projection over contracts + local drafts. */
export const VIDEO_WORKSURFACE_PROJECTION_ONLY = true as const;
