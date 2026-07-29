/**
 * Video Result Worksurface pure model (WT-E / #104 / D-085 §7 / D-088).
 *
 * Player / received storyboard candidates / deterministic selection /
 * "使用此成片" adopt / mobile P0.
 *
 * Contracts-only boundary: imports `@meiye/contracts` result-center +
 * video-workflow public projection. Does NOT import Result Shell internals
 * (`result-shell-model`, command adapter, page, token stream, etc.).
 *
 * Projection only — no Result table / second history / product ledger.
 * D-133 makes this a receiver surface: no cover, subtitle editing, or
 * regeneration intent belongs in this model.
 */

import type {
  ResultActionId,
  ResultWorkspaceKind,
  VideoShotSummary,
  VideoWorkflowPublicProjection,
  VideoWorkflowPublicStatus,
} from '@meiye/contracts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const VIDEO_WORKSPACE_KIND: ResultWorkspaceKind = 'video';

/** Mirrors core `videoFreeActions` — never produce a generation fee. */
export const videoWorksurfaceFreeActions = [
  'poll',
  'recover',
  'download_supplier_task',
  'play_control',
  'adopt_candidate',
  'select_shot_candidate',
  'deterministic_sort',
] as const;

export type VideoWorksurfaceFreeAction =
  (typeof videoWorksurfaceFreeActions)[number];

export const videoBillableScopes = [] as const;
export type VideoBillableScope = (typeof videoBillableScopes)[number];

/** Independent asset vs burned into the composed media. */
export type VideoSubtitleMode = 'independent_asset' | 'burned_in';

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

export type VideoSubtitleState = {
  mode: VideoSubtitleMode;
  assetId: string | null;
  text: string;
  enabled: boolean;
  transcript: string | null;
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

export type VideoUncommittedAdjustments = {
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
  subtitle: VideoSubtitleState;
  storyboard: VideoStoryboardShot[];
  composedCandidate: VideoComposedCandidate | null;
  adoption: VideoAdoptionState;
  delivery: VideoDeliveryState;
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

export type VideoEditFeeDecision = VideoFreeEditFeeDecision;

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
 * Recover / poll / download the same supplier task never re-quotes or charges
 * (P1-B4 / #153). These are free operational actions on an existing attempt.
 */
export function classifySupplierTaskOps(
  action: 'poll' | 'recover' | 'download_supplier_task'
): VideoFreeEditFeeDecision {
  return {
    fee: 'none',
    freeAction: action,
    createsProductUsage: false,
    requiresFullRecomposeQuote: false,
  };
}

/**
 * Merchant-facing shot label — never expose raw shot UUID / provider slug /
 * internal phase in the Result worksurface (P1-B4 / #153).
 */
export function merchantShotLabel(input: {
  order: number;
  promptPreview?: string;
  shotId?: string;
}): string {
  const orderLabel = `镜头 ${input.order + 1}`;
  const preview = input.promptPreview?.trim();
  if (preview) {
    // Strip accidental UUID-looking tokens from prompt previews.
    const cleaned = preview
      .replace(
        /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
        ''
      )
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (cleaned) return `${orderLabel} · ${cleaned.slice(0, 24)}`;
  }
  return orderLabel;
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
    subtitle: {
      mode: subtitleMode,
      assetId: input.subtitleAssetId ?? null,
      text: subtitleText,
      enabled: input.subtitleEnabled ?? true,
      transcript: input.transcript ?? null,
    },
    storyboard: shotsFromPublic(input.workflow.shots),
    composedCandidate: composed,
    adoption,
    delivery,
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
    adoption: overrides.adoption ?? { status: 'candidate_ready' },
    delivery: overrides.delivery,
    uncommitted: overrides.uncommitted,
  });
}

// ---------------------------------------------------------------------------
// Player controls (pure)
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

// ---------------------------------------------------------------------------
// Storyboard selection / adopt / deliver
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
  // History / Run Detail stay contract ids only until P1 work surfaces exist.
  // Advertising them here would create clickable no-ops on merchant Result.
  const overflow: VideoWorksurfaceAction[] = [];

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
        primaryAction: null,
        secondaryActions: [],
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
        secondaryActions: [],
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
        secondaryActions: [],
        overflowActions: overflow,
      };
    case 'delivered':
      return {
        primaryAction: null,
        secondaryActions: [],
        overflowActions: overflow,
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

export type VideoMobileP0ActionId = 'play' | ResultActionId;

export type VideoMobileP0Action = {
  id: VideoMobileP0ActionId;
  label: string;
  enabled: boolean;
  /** Shared result action vs media-local control. */
  kind: 'media' | 'result';
};

/**
 * Mobile P0: playback + shared result actions.
 * Video editing stays absent on every viewport (D-133).
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
