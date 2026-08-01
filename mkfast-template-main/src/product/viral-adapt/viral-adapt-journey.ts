/**
 * Viral adapt journey — paste-track first (#324 / P2-12).
 *
 * chip → sourcing card (paste / upload; OpenCLI reserved) → confirm card
 * (explicit source method) → ready submit intent for the note path.
 *
 * Marker string must stay byte-identical to core `VIRAL_ADAPT_SOURCE_MARKER`
 * (`apps/core/src/p1/harness/viral-adapt.ts`).
 */

export const VIRAL_ADAPT_SOURCE_MARKER = '[viral_adapt_source:paste]' as const;

export type ViralAdaptPhase = 'idle' | 'sourcing' | 'confirm' | 'ready';

export type ViralOpenCliLiveGateView = {
  available: boolean;
  statusLabel: string;
};

export type ViralPasteDraft = {
  noteText: string;
  /** Real Composer asset ids that completed upload + rights attachment. */
  imageAssetIds: readonly string[];
};

export type ViralAdaptConfirmView = {
  schemaVersion: 'viral-adapt-confirm/v1';
  sourceMethod: {
    track: 'paste';
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
  draft: ViralPasteDraft;
  liveGate: ViralOpenCliLiveGateView;
  confirm: ViralAdaptConfirmView | null;
  /** Intent text ready for Composer lens / submission. */
  submitIntent: string | null;
};

/** Default live gate: closed until #328 verifies OpenCLI. */
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
}): ViralAdaptJourneyState {
  return {
    phase: 'idle',
    draft: { noteText: '', imageAssetIds: [] },
    liveGate: defaultViralOpenCliLiveGate(input?.evidencePresent === true),
    confirm: null,
    submitIntent: null,
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
    submitIntent: null,
  };
}

export function updateViralPasteDraft(
  state: ViralAdaptJourneyState,
  patch: Partial<ViralPasteDraft>
): ViralAdaptJourneyState {
  if (state.phase !== 'sourcing' && state.phase !== 'confirm') {
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
    submitIntent: null,
  };
}

export function canAdvanceViralSourcing(draft: ViralPasteDraft): boolean {
  return draft.noteText.trim().length > 0;
}

/** OpenCLI track is selectable only when live gate is open. */
export function isViralOpenCliTrackEnabled(
  liveGate: ViralOpenCliLiveGateView
): boolean {
  return liveGate.available;
}

export function projectViralAdaptConfirmView(input: {
  draft: ViralPasteDraft;
  liveGate: ViralOpenCliLiveGateView;
  pageBound?: number;
  aspectRatio?: string;
}): ViralAdaptConfirmView {
  const noteText = input.draft.noteText.trim();
  const imageCount = input.draft.imageAssetIds.length;
  const hasImages = imageCount > 0;
  const sourceLabel = hasImages ? '粘贴笔记文字 + 上传图片' : '粘贴笔记文字';
  return {
    schemaVersion: 'viral-adapt-confirm/v1',
    sourceMethod: {
      track: 'paste',
      label: sourceLabel,
      detail: [
        `已粘贴 ${noteText.length} 字`,
        hasImages ? `已上传 ${imageCount} 张参考图` : '未上传参考图',
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
  if (!canAdvanceViralSourcing(state.draft)) {
    return { error: 'empty_note_text' };
  }
  const confirm = projectViralAdaptConfirmView({
    draft: state.draft,
    liveGate: state.liveGate,
  });
  return {
    ...state,
    phase: 'confirm',
    confirm,
    submitIntent: null,
  };
}

export function composeViralAdaptSubmitIntent(draft: ViralPasteDraft): string {
  const noteText = draft.noteText.replace(/\r\n/gu, '\n').trim();
  const images =
    draft.imageAssetIds.length > 0
      ? `\n参考图资产：${draft.imageAssetIds.join(', ')}`
      : '';
  return [
    VIRAL_ADAPT_SOURCE_MARKER,
    '请按本店项目仿写复刻以下爆款笔记（取材=商家粘贴，非链接自动读取）：',
    noteText,
    images,
  ]
    .filter((line) => line.length > 0)
    .join('\n');
}

export function confirmViralAdaptJourney(
  state: ViralAdaptJourneyState
): ViralAdaptJourneyState | { error: 'not_in_confirm' | 'empty_note_text' } {
  if (state.phase !== 'confirm' || !state.confirm) {
    return { error: 'not_in_confirm' };
  }
  if (!canAdvanceViralSourcing(state.draft)) {
    return { error: 'empty_note_text' };
  }
  return {
    ...state,
    phase: 'ready',
    submitIntent: composeViralAdaptSubmitIntent(state.draft),
  };
}

export function cancelViralAdaptJourney(
  state: ViralAdaptJourneyState
): ViralAdaptJourneyState {
  return createViralAdaptJourneyState({
    evidencePresent: state.liveGate.available,
  });
}

export function isViralAdaptRecipeIntent(intent: string): boolean {
  return /复刻|爆款/u.test(intent) && /粘贴|参考/u.test(intent);
}
