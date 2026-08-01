/**
 * Viral adapt sourcing journey (#324 paste fallback + #328 OpenCLI gate).
 *
 * A verified live gate only proves that OpenCLI note + download worked once.
 * Per-device bridge readiness remains a separate, fail-closed condition.
 * Complete note URLs stay in this browser-only state. Raw note text and asset
 * ids leave this model only through the host-owned structured payload seam;
 * they are never composed into the merchant-visible Composer intent.
 */

export type ViralAdaptPhase = 'idle' | 'sourcing' | 'confirm' | 'ready';
export type ViralAdaptSourceTrack = 'opencli_link' | 'paste';

export type ViralOpenCliLiveGateView = {
  available: boolean;
  statusLabel: string;
};

export type ViralPasteDraft = {
  noteText: string;
  /** Real Composer asset ids that completed upload + rights attachment. */
  imageAssetIds: readonly string[];
};

export type ViralOpenCliAuthorizedAssetRef = {
  id: string;
  revision: string;
};

export type ViralOpenCliReadResult = {
  schemaVersion: 'viral-opencli-read/v1';
  noteText: string;
  /** Untrusted refs downloaded, imported, and authorized by the local host. */
  authorizedAssets: readonly ViralOpenCliAuthorizedAssetRef[];
};

export type ViralAdaptSourcePayload = {
  schemaVersion: 'viral-adapt-source/v1';
  track: ViralAdaptSourceTrack;
  noteText: string;
  /** Host-authorized ids only; never a URL or local filesystem path. */
  authorizedAssetIds: readonly string[];
};

export type ViralAdaptReadySource = {
  /** Safe for the merchant-visible Composer textarea. */
  merchantIntent: string;
  /** Hidden carrier for the signed Composer submission. */
  sourcePayload: ViralAdaptSourcePayload;
};

export type ViralOpenCliJourneyState = {
  /** A host bridge can disappear even after the one-time live gate is verified. */
  bridgeReady: boolean;
  /** Volatile browser-only input. Cleared immediately after a successful read. */
  noteUrl: string;
  status: 'bridge_absent' | 'idle' | 'reading' | 'ready' | 'error';
  errorCode: 'bridge_absent' | 'read_failed' | 'invalid_result' | null;
};
export type ViralAdaptConfirmView = {
  schemaVersion: 'viral-adapt-confirm/v1';
  sourceMethod: {
    track: ViralAdaptSourceTrack;
    label: string;
    detail: string;
  };
  opencliSlot: {
    available: boolean;
    label: string;
    statusLabel: string;
  };
  specs: ReadonlyArray<{ key: string; label: string; value: string }>;
};

export type ViralAdaptJourneyState = {
  phase: ViralAdaptPhase;
  sourceTrack: ViralAdaptSourceTrack;
  draft: ViralPasteDraft;
  liveGate: ViralOpenCliLiveGateView;
  opencli: ViralOpenCliJourneyState;
  confirm: ViralAdaptConfirmView | null;
  /** Safe for Composer lens / merchant-visible submission. */
  merchantIntent: string | null;
  /** Never write this field to textarea, logs, or product memory. */
  sourcePayload: ViralAdaptSourcePayload | null;
};

/** Helper remains fail-closed; production explicitly supplies verified evidence. */
export function defaultViralOpenCliLiveGate(
  evidencePresent = false
): ViralOpenCliLiveGateView {
  if (evidencePresent) {
    return {
      available: true,
      statusLabel: '已通过 live 核销，可用本机登录态读笔记',
    };
  }
  return {
    available: false,
    statusLabel: '暂不可用（OpenCLI live 门未核销）',
  };
}

export function createViralAdaptJourneyState(input?: {
  evidencePresent?: boolean;
  bridgeReady?: boolean;
}): ViralAdaptJourneyState {
  const liveGate = defaultViralOpenCliLiveGate(input?.evidencePresent === true);
  const bridgeReady = liveGate.available && input?.bridgeReady === true;
  return {
    phase: 'idle',
    sourceTrack: liveGate.available && bridgeReady ? 'opencli_link' : 'paste',
    draft: { noteText: '', imageAssetIds: [] },
    liveGate,
    opencli: {
      bridgeReady,
      noteUrl: '',
      status: bridgeReady ? 'idle' : 'bridge_absent',
      errorCode: bridgeReady ? null : 'bridge_absent',
    },
    confirm: null,
    merchantIntent: null,
    sourcePayload: null,
  };
}

/** Start from Idle recipe chip 「爆款复刻」. */
export function startViralAdaptJourney(
  state: ViralAdaptJourneyState
): ViralAdaptJourneyState {
  return {
    ...state,
    phase: 'sourcing',
    confirm: null,
    merchantIntent: null,
    sourcePayload: null,
  };
}

function emptyDraft(): ViralPasteDraft {
  return { noteText: '', imageAssetIds: [] };
}

export function selectViralAdaptSourceTrack(
  state: ViralAdaptJourneyState,
  requestedTrack: ViralAdaptSourceTrack
): ViralAdaptJourneyState {
  const sourceTrack =
    requestedTrack === 'opencli_link' && !state.liveGate.available
      ? 'paste'
      : requestedTrack;
  if (sourceTrack === state.sourceTrack) return state;
  return {
    ...state,
    sourceTrack,
    draft: emptyDraft(),
    opencli: {
      ...state.opencli,
      noteUrl: '',
      status: state.opencli.bridgeReady ? 'idle' : 'bridge_absent',
      errorCode: state.opencli.bridgeReady ? null : 'bridge_absent',
    },
    confirm: null,
    merchantIntent: null,
    sourcePayload: null,
  };
}

export function setViralOpenCliBridgeReady(
  state: ViralAdaptJourneyState,
  bridgeReady: boolean
): ViralAdaptJourneyState {
  const effectiveReady = state.liveGate.available && bridgeReady;
  const sourceTrack =
    effectiveReady && state.phase === 'idle'
      ? 'opencli_link'
      : !effectiveReady && state.sourceTrack === 'opencli_link'
        ? 'paste'
        : state.sourceTrack;
  const sourceChanged = sourceTrack !== state.sourceTrack;
  if (
    state.opencli.bridgeReady === effectiveReady &&
    state.opencli.status !== 'error' &&
    !sourceChanged
  ) {
    return state;
  }
  return {
    ...state,
    sourceTrack,
    ...(sourceChanged
      ? {
          draft: emptyDraft(),
          confirm: null,
          merchantIntent: null,
          sourcePayload: null,
        }
      : {}),
    opencli: {
      ...state.opencli,
      bridgeReady: effectiveReady,
      ...(sourceChanged ? { noteUrl: '' } : {}),
      status: effectiveReady ? 'idle' : 'bridge_absent',
      errorCode: effectiveReady ? null : 'bridge_absent',
    },
  };
}

export function updateViralOpenCliLink(
  state: ViralAdaptJourneyState,
  noteUrl: string
): ViralAdaptJourneyState {
  if (state.phase !== 'sourcing' || state.sourceTrack !== 'opencli_link') {
    return state;
  }
  return {
    ...state,
    draft: emptyDraft(),
    opencli: {
      ...state.opencli,
      noteUrl,
      status: state.opencli.bridgeReady ? 'idle' : 'bridge_absent',
      errorCode: state.opencli.bridgeReady ? null : 'bridge_absent',
    },
    confirm: null,
    merchantIntent: null,
    sourcePayload: null,
  };
}

export function isValidViralOpenCliNoteUrl(noteUrl: string): boolean {
  try {
    const parsed = new URL(noteUrl.trim());
    const xhsHost =
      parsed.hostname === 'xiaohongshu.com' ||
      parsed.hostname.endsWith('.xiaohongshu.com');
    return (
      parsed.protocol === 'https:' &&
      xhsHost &&
      parsed.pathname !== '/' &&
      parsed.pathname.length > 1
    );
  } catch {
    return false;
  }
}

export function beginViralOpenCliRead(state: ViralAdaptJourneyState):
  | ViralAdaptJourneyState
  | {
      error: 'gate_closed' | 'bridge_absent' | 'invalid_note_url';
    } {
  if (!state.liveGate.available || state.sourceTrack !== 'opencli_link') {
    return { error: 'gate_closed' };
  }
  if (!state.opencli.bridgeReady) return { error: 'bridge_absent' };
  if (!isValidViralOpenCliNoteUrl(state.opencli.noteUrl)) {
    return { error: 'invalid_note_url' };
  }
  return {
    ...state,
    draft: emptyDraft(),
    opencli: {
      ...state.opencli,
      status: 'reading',
      errorCode: null,
    },
    confirm: null,
    merchantIntent: null,
    sourcePayload: null,
  };
}

function hasAsciiControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

export function normalizeViralOpenCliAuthorizedAssets(
  assets: readonly ViralOpenCliAuthorizedAssetRef[]
): readonly ViralOpenCliAuthorizedAssetRef[] | null {
  if (assets.length > 50) return null;
  const normalized = new Map<string, ViralOpenCliAuthorizedAssetRef>();
  for (const asset of assets) {
    const id = asset.id.trim();
    const revision = asset.revision.trim();
    if (
      !id ||
      !revision ||
      id.length > 200 ||
      revision.length > 200 ||
      hasAsciiControlCharacter(id) ||
      hasAsciiControlCharacter(revision)
    ) {
      return null;
    }
    const previous = normalized.get(id);
    if (previous && previous.revision !== revision) return null;
    normalized.set(id, { id, revision });
  }
  return [...normalized.values()];
}

export function completeViralOpenCliRead(
  state: ViralAdaptJourneyState,
  result: ViralOpenCliReadResult
): ViralAdaptJourneyState | { error: 'invalid_bridge_result' } {
  const noteText = result.noteText.replace(/\r\n/gu, '\n').trim();
  const authorizedAssets = normalizeViralOpenCliAuthorizedAssets(
    result.authorizedAssets
  );
  if (
    state.sourceTrack !== 'opencli_link' ||
    state.opencli.status !== 'reading' ||
    result.schemaVersion !== 'viral-opencli-read/v1' ||
    noteText.length === 0 ||
    noteText.length > 4_000 ||
    authorizedAssets === null
  ) {
    return { error: 'invalid_bridge_result' };
  }
  return {
    ...state,
    draft: {
      noteText,
      imageAssetIds: authorizedAssets.map(({ id }) => id),
    },
    opencli: {
      ...state.opencli,
      noteUrl: '',
      status: 'ready',
      errorCode: null,
    },
  };
}

export function failViralOpenCliRead(
  state: ViralAdaptJourneyState,
  errorCode: 'bridge_absent' | 'read_failed' | 'invalid_result'
): ViralAdaptJourneyState {
  if (state.sourceTrack !== 'opencli_link') return state;
  return {
    ...state,
    draft: emptyDraft(),
    opencli: {
      ...state.opencli,
      bridgeReady:
        errorCode === 'bridge_absent' ? false : state.opencli.bridgeReady,
      status: errorCode === 'bridge_absent' ? 'bridge_absent' : 'error',
      errorCode,
    },
    confirm: null,
    merchantIntent: null,
    sourcePayload: null,
  };
}

export function updateViralPasteDraft(
  state: ViralAdaptJourneyState,
  patch: Partial<ViralPasteDraft>
): ViralAdaptJourneyState {
  if (
    state.sourceTrack !== 'paste' ||
    (state.phase !== 'sourcing' && state.phase !== 'confirm')
  ) {
    return state;
  }
  return {
    ...state,
    phase: 'sourcing',
    draft: {
      noteText:
        patch.noteText !== undefined ? patch.noteText : state.draft.noteText,
      imageAssetIds:
        patch.imageAssetIds !== undefined
          ? [...new Set(patch.imageAssetIds.filter(Boolean))]
          : state.draft.imageAssetIds,
    },
    confirm: null,
    merchantIntent: null,
    sourcePayload: null,
  };
}

export function canAdvanceViralSourcing(
  state: ViralAdaptJourneyState
): boolean {
  if (!state.draft.noteText.trim()) return false;
  return state.sourceTrack === 'paste' || state.opencli.status === 'ready';
}

/** OpenCLI track is selectable only when the one-time live gate is open. */
export function isViralOpenCliTrackEnabled(
  liveGate: ViralOpenCliLiveGateView
): boolean {
  return liveGate.available;
}

export function projectViralAdaptConfirmView(input: {
  sourceTrack: ViralAdaptSourceTrack;
  draft: ViralPasteDraft;
  liveGate: ViralOpenCliLiveGateView;
  pageBound?: number;
  aspectRatio?: string;
}): ViralAdaptConfirmView {
  const noteText = input.draft.noteText.trim();
  const imageCount = input.draft.imageAssetIds.length;
  const hasImages = imageCount > 0;
  const isOpenCli = input.sourceTrack === 'opencli_link';
  const sourceLabel = isOpenCli
    ? hasImages
      ? '本机登录态读取 + 导入并授权参考图'
      : '本机登录态读取'
    : hasImages
      ? '粘贴笔记文字 + 上传图片'
      : '粘贴笔记文字';
  return {
    schemaVersion: 'viral-adapt-confirm/v1',
    sourceMethod: {
      track: input.sourceTrack,
      label: sourceLabel,
      detail: [
        isOpenCli
          ? `已读取 ${noteText.length} 字`
          : `已粘贴 ${noteText.length} 字`,
        hasImages ? `已授权 ${imageCount} 张参考图` : '未附加参考图',
      ].join('；'),
    },
    opencliSlot: {
      available: input.liveGate.available,
      label: '链接取材（OpenCLI 本机登录态）',
      statusLabel: input.liveGate.statusLabel,
    },
    specs: [
      { key: 'deliverable', label: '产出形态', value: '小红书笔记（note）' },
      { key: 'platform', label: '平台', value: '小红书' },
      {
        key: 'aspect',
        label: '比例',
        value: input.aspectRatio ?? '3:4',
      },
      {
        key: 'pages',
        label: '页数',
        value: `${input.pageBound ?? 3} 页`,
      },
      { key: 'source_track', label: '取材方式', value: sourceLabel },
    ],
  };
}

export function advanceViralSourcingToConfirm(
  state: ViralAdaptJourneyState
): ViralAdaptJourneyState | { error: 'empty_note_text' } {
  if (!canAdvanceViralSourcing(state)) {
    return { error: 'empty_note_text' };
  }
  const confirm = projectViralAdaptConfirmView({
    sourceTrack: state.sourceTrack,
    draft: state.draft,
    liveGate: state.liveGate,
  });
  return {
    ...state,
    phase: 'confirm',
    confirm,
    merchantIntent: null,
    sourcePayload: null,
  };
}

export function composeViralAdaptReadySource(input: {
  sourceTrack: ViralAdaptSourceTrack;
  draft: ViralPasteDraft;
}): ViralAdaptReadySource {
  const noteText = input.draft.noteText.replace(/\r\n/gu, '\n').trim();
  return {
    merchantIntent:
      '请为本店项目复刻一篇小红书爆款笔记，参考素材已由商家确认。',
    sourcePayload: {
      schemaVersion: 'viral-adapt-source/v1',
      track: input.sourceTrack,
      noteText,
      authorizedAssetIds: [...input.draft.imageAssetIds],
    },
  };
}

export function confirmViralAdaptJourney(
  state: ViralAdaptJourneyState
): ViralAdaptJourneyState | { error: 'not_in_confirm' | 'empty_note_text' } {
  if (state.phase !== 'confirm' || !state.confirm) {
    return { error: 'not_in_confirm' };
  }
  if (!canAdvanceViralSourcing(state)) {
    return { error: 'empty_note_text' };
  }
  const ready = composeViralAdaptReadySource({
    sourceTrack: state.sourceTrack,
    draft: state.draft,
  });
  return {
    ...state,
    phase: 'ready',
    merchantIntent: ready.merchantIntent,
    sourcePayload: ready.sourcePayload,
  };
}

export function cancelViralAdaptJourney(
  state: ViralAdaptJourneyState
): ViralAdaptJourneyState {
  return createViralAdaptJourneyState({
    evidencePresent: state.liveGate.available,
    bridgeReady: state.opencli.bridgeReady,
  });
}

export function isViralAdaptRecipeIntent(intent: string): boolean {
  return /复刻|爆款/u.test(intent) && /粘贴|参考/u.test(intent);
}
