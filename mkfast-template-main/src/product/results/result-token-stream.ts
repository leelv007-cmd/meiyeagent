/**
 * Result Center token-stream running-state projection
 * (ADR-0007 / D-042 / #99 / P1-B2 / #151).
 *
 * copy / image_text stream from the first usable token.
 * User-visible increments consume only workflow.token candidate/channel/sequence —
 * never simultaneously invent duplicates from poll snapshots.
 * Stage announcements live only in the a11y aggregate layer — they must not
 * replace token-stream intermediate state assertions.
 *
 * Pure helpers stay independent of React and locale modules so node:test
 * fixtures can execute them directly.
 */

import { harnessCopyStreamPhase } from '@/product/workbench-state-model';

export type ResultTokenStreamWorkspace =
  | 'copy'
  | 'image_text'
  | 'image'
  | 'video';

export type PartialCopyCandidate = {
  /** Stable candidate id when sourced from workflow.token. */
  candidateId?: string;
  body?: string;
  conversionHook?: string;
  title?: string;
};

/** One accepted workflow.token delta (P1-B2 exclusive stream source). */
export type WorkflowTokenDelta = {
  eventId: string;
  sequence: number;
  candidateId: string;
  channel: 'copy.title' | 'copy.body' | 'copy.cta';
  delta: string;
};

export type ResultTokenStreamCursor = {
  /** Highest accepted sequence (progress + token share one cursor). */
  sequence: number;
  /** Last accepted event id for Last-Event-ID reconnect. */
  lastEventId: string | null;
};

export type ResultTokenStreamInput = {
  workspaceKind: ResultTokenStreamWorkspace;
  progressState?: 'waiting' | 'running' | 'suspended' | 'success' | 'failed';
  /**
   * Exclusive user-visible partials (workflow.token reduce, or a single
   * structured stream that is already the sole source). Never merge with
   * a second poll-derived candidate list.
   */
  partialCandidates?: PartialCopyCandidate[];
  loading?: boolean;
  hasError?: boolean;
  interrupted?: boolean;
  /** Transport reconnecting — keep arrived text, show recover banner. */
  reconnecting?: boolean;
  completed?: boolean;
};

export type ResultTokenStreamSlot = {
  index: number;
  candidateId?: string;
  hasToken: boolean;
  title: string;
  body: string;
  conversionHook: string;
  /** Index 0 is the primary recommendation (document face). */
  role: 'primary' | 'alternative';
};

export type ResultTokenStreamProjection = {
  /** Whether this workspace uses token-level streaming at all. */
  tokenStreaming: boolean;
  /**
   * harnessCopyStreamPhase — drafting vs awaiting_confirmation vs completed.
   * Renderers key their streaming affordances off this, so a terminal run must
   * report `completed` even when the last poll snapshot still says running.
   */
  streamPhase: 'awaiting_confirmation' | 'completed' | 'drafting' | null;
  /** True once any candidate slot has a non-empty title/body/hook. */
  hasFirstToken: boolean;
  /** Intermediate slots for fixture / e2e assertions. */
  slots: ResultTokenStreamSlot[];
  /** Primary recommendation (document face) — always slot 0 when present. */
  primary: ResultTokenStreamSlot | null;
  /** Alternatives — collapsed by default in the document worksurface. */
  alternatives: ResultTokenStreamSlot[];
  /** Show the stream panel (running intermediate state). */
  showStreamPanel: boolean;
  /** True while SSE reconnects; arrived text must remain visible. */
  reconnecting: boolean;
  reconnectBanner: string | null;
  /**
   * A11y aggregate stage text only — tests must not treat this as a
   * substitute for token-stream intermediate assertions.
   */
  a11yStageAnnouncement: string | null;
  /**
   * Semantic-paragraph a11y text (throttled). Final complete is announced
   * exactly once via projectTokenStreamA11y.
   */
  a11ySemanticParagraph: string | null;
};

/** First non-empty title/body/hook counts as the first usable draft token. */
export function candidateHasToken(candidate?: PartialCopyCandidate | null) {
  if (!candidate) return false;
  return Boolean(
    candidate.title?.trim() ||
      candidate.body?.trim() ||
      candidate.conversionHook?.trim()
  );
}

export function copyCandidateSlots(value?: {
  candidates?: PartialCopyCandidate[];
}): [PartialCopyCandidate, PartialCopyCandidate, PartialCopyCandidate] {
  return [0, 1, 2].map((index) => value?.candidates?.[index] ?? {}) as [
    PartialCopyCandidate,
    PartialCopyCandidate,
    PartialCopyCandidate,
  ];
}

function isTokenStreamWorkspace(
  kind: ResultTokenStreamWorkspace
): kind is 'copy' | 'image_text' {
  return kind === 'copy' || kind === 'image_text';
}

function emptyCursor(): ResultTokenStreamCursor {
  return { sequence: -1, lastEventId: null };
}

/**
 * Accept a workflow.token delta when sequence advances (Last-Event-ID replay
 * of the same or older sequence is rejected). Event id is recorded for
 * reconnect headers.
 */
export function acceptWorkflowTokenDelta(
  cursor: ResultTokenStreamCursor | undefined,
  token: WorkflowTokenDelta
): {
  accepted: boolean;
  cursor: ResultTokenStreamCursor;
} {
  const current = cursor ?? emptyCursor();
  if (token.sequence <= current.sequence) {
    return { accepted: false, cursor: current };
  }
  return {
    accepted: true,
    cursor: {
      sequence: token.sequence,
      lastEventId: token.eventId,
    },
  };
}

/**
 * Reduce exclusive workflow.token deltas into candidate drafts.
 * candidate/channel/sequence are the only identity keys — never invent
 * parallel candidates from a poll snapshot.
 */
export function reduceExclusiveWorkflowTokens(
  current: PartialCopyCandidate[],
  token: WorkflowTokenDelta
): PartialCopyCandidate[] {
  const field = {
    'copy.body': 'body',
    'copy.cta': 'conversionHook',
    'copy.title': 'title',
  }[token.channel] as 'body' | 'conversionHook' | 'title';
  const existing = current.find(
    (item) => item.candidateId === token.candidateId
  );
  const candidate: PartialCopyCandidate = existing ?? {
    candidateId: token.candidateId,
    body: '',
    conversionHook: '',
    title: '',
  };
  const updated: PartialCopyCandidate = {
    ...candidate,
    candidateId: token.candidateId,
    [field]: `${candidate[field] ?? ''}${token.delta}`,
  };
  if (existing) {
    return current.map((item) =>
      item.candidateId === token.candidateId ? updated : item
    );
  }
  return [...current, updated];
}

/**
 * Reconnect projection: preserve already-arrived candidates, surface banner,
 * and expose Last-Event-ID for the transport layer.
 */
export function projectTokenStreamReconnect(input: {
  arrivedCandidates: PartialCopyCandidate[];
  cursor: ResultTokenStreamCursor | undefined;
  reconnecting: boolean;
}): {
  candidates: PartialCopyCandidate[];
  lastEventId: string | null;
  reconnectBanner: string | null;
  cleared: false;
} {
  return {
    candidates: input.arrivedCandidates.map((c) => ({ ...c })),
    lastEventId: input.cursor?.lastEventId ?? null,
    reconnectBanner: input.reconnecting ? '正在恢复连接' : null,
    cleared: false,
  };
}

/**
 * Calibrate streamed display text against the terminal ContentPackage revision.
 * When the package is ready, package fields win; stream text is kept only as
 * intermediate evidence and must not diverge after terminal success.
 */
export function calibrateTerminalRevision(input: {
  streamed: PartialCopyCandidate | null | undefined;
  terminal: {
    title: string;
    body: string;
    conversionHook: string;
    revisionId: string;
  } | null;
}): {
  kind: 'streaming' | 'calibrated' | 'empty';
  title: string;
  body: string;
  conversionHook: string;
  revisionId: string | null;
  matched: boolean;
} {
  if (input.terminal) {
    const streamedTitle = input.streamed?.title?.trim() ?? '';
    const streamedBody = input.streamed?.body?.trim() ?? '';
    const streamedHook = input.streamed?.conversionHook?.trim() ?? '';
    const matched =
      (!streamedTitle || streamedTitle === input.terminal.title.trim()) &&
      (!streamedBody || streamedBody === input.terminal.body.trim()) &&
      (!streamedHook || streamedHook === input.terminal.conversionHook.trim());
    return {
      kind: 'calibrated',
      title: input.terminal.title,
      body: input.terminal.body,
      conversionHook: input.terminal.conversionHook,
      revisionId: input.terminal.revisionId,
      matched,
    };
  }
  if (input.streamed && candidateHasToken(input.streamed)) {
    return {
      kind: 'streaming',
      title: input.streamed.title?.trim() ?? '',
      body: input.streamed.body?.trim() ?? '',
      conversionHook: input.streamed.conversionHook?.trim() ?? '',
      revisionId: null,
      matched: true,
    };
  }
  return {
    kind: 'empty',
    title: '',
    body: '',
    conversionHook: '',
    revisionId: null,
    matched: true,
  };
}

/**
 * Semantic-paragraph a11y throttle. Emits at most one polite update per
 * paragraph boundary (。！？\n or 40+ new chars). Complete is announced once.
 */
export function projectTokenStreamA11y(input: {
  previousAnnounced: string | null;
  previousCompleteAnnounced: boolean;
  primaryBody: string;
  completed: boolean;
}): {
  announcement: string | null;
  nextAnnounced: string | null;
  completeAnnounced: boolean;
} {
  if (input.completed) {
    if (input.previousCompleteAnnounced) {
      return {
        announcement: null,
        nextAnnounced: input.previousAnnounced,
        completeAnnounced: true,
      };
    }
    return {
      announcement: '文案生成完成',
      nextAnnounced: input.previousAnnounced,
      completeAnnounced: true,
    };
  }
  const body = input.primaryBody.trim();
  if (!body) {
    return {
      announcement: null,
      nextAnnounced: input.previousAnnounced,
      completeAnnounced: false,
    };
  }
  const prev = input.previousAnnounced ?? '';
  if (body === prev) {
    return {
      announcement: null,
      nextAnnounced: prev,
      completeAnnounced: false,
    };
  }
  const boundary = /[。！？\n]/.test(body.slice(prev.length));
  const longEnough = body.length - prev.length >= 40;
  if (!boundary && !longEnough && prev.length > 0) {
    return {
      announcement: null,
      nextAnnounced: prev,
      completeAnnounced: false,
    };
  }
  // Announce the latest semantic paragraph tail, not every token.
  const parts = body.split(/(?<=[。！？\n])/u).filter((p) => p.trim());
  const last = parts.at(-1)?.trim() || body.slice(-40);
  return {
    announcement: last,
    nextAnnounced: body,
    completeAnnounced: false,
  };
}

/**
 * Project token-stream intermediate state for Result Center running phase.
 * Pure — fixtures drive partial candidates without React.
 */
export function projectResultTokenStream(
  input: ResultTokenStreamInput
): ResultTokenStreamProjection {
  if (!isTokenStreamWorkspace(input.workspaceKind)) {
    // image / video: Job-level progress only (ADR-0010 long-task path).
    const running =
      input.progressState === 'running' ||
      input.progressState === 'waiting' ||
      input.progressState === 'suspended';
    return {
      tokenStreaming: false,
      streamPhase: null,
      hasFirstToken: false,
      slots: [],
      primary: null,
      alternatives: [],
      showStreamPanel: false,
      reconnecting: false,
      reconnectBanner: null,
      a11yStageAnnouncement: running
        ? input.progressState === 'suspended'
          ? '等待确认'
          : '任务进行中'
        : null,
      a11ySemanticParagraph: null,
    };
  }

  const completed = Boolean(input.completed);
  // The session can know it is delivered before the last poll snapshot lands,
  // so `completed` outranks progressState. Either route reaches the same
  // terminal phase; neither may leave the body claiming to still be arriving.
  const streamPhase = completed
    ? 'completed'
    : harnessCopyStreamPhase(input.progressState);
  const rawSlots = copyCandidateSlots({
    candidates: input.partialCandidates,
  });
  const slots: ResultTokenStreamSlot[] = rawSlots.map((candidate, index) => ({
    index,
    candidateId: candidate.candidateId,
    hasToken: candidateHasToken(candidate),
    title: candidate.title?.trim() ?? '',
    body: candidate.body?.trim() ?? '',
    conversionHook: candidate.conversionHook?.trim() ?? '',
    role: index === 0 ? 'primary' : 'alternative',
  }));
  const hasFirstToken = slots.some((slot) => slot.hasToken);
  const loading = Boolean(input.loading);
  const hasObject = Boolean(
    input.partialCandidates && input.partialCandidates.length > 0
  );
  const reconnecting = Boolean(input.reconnecting);
  const showStreamPanel =
    !completed &&
    (loading ||
      hasObject ||
      Boolean(input.hasError) ||
      Boolean(input.interrupted) ||
      reconnecting);

  // A11y aggregate only — never the sole progress signal for copy streaming.
  let a11yStageAnnouncement: string | null = null;
  if (showStreamPanel) {
    if (reconnecting) {
      a11yStageAnnouncement = '正在恢复连接';
    } else if (streamPhase === 'awaiting_confirmation') {
      a11yStageAnnouncement = '等待确认';
    } else if (hasFirstToken) {
      a11yStageAnnouncement = '正在生成内容';
    } else {
      a11yStageAnnouncement = '任务进行中';
    }
  }

  const primary = slots[0]?.hasToken ? slots[0] : null;
  const alternatives = slots.slice(1).filter((slot) => slot.hasToken);

  return {
    tokenStreaming: true,
    streamPhase,
    hasFirstToken,
    slots,
    primary,
    alternatives,
    showStreamPanel,
    reconnecting,
    reconnectBanner: reconnecting ? '正在恢复连接' : null,
    a11yStageAnnouncement,
    a11ySemanticParagraph: primary?.body || null,
  };
}

/**
 * Fixture helper: simulate a multi-chunk token stream for tests.
 * Each step is one partial object snapshot (as useObject would emit).
 */
export function tokenStreamFixtureSteps(): Array<{
  label: string;
  partialCandidates: PartialCopyCandidate[];
  expectHasFirstToken: boolean;
  expectSlotTokens: [boolean, boolean, boolean];
}> {
  return [
    {
      label: 'empty-before-first-token',
      partialCandidates: [],
      expectHasFirstToken: false,
      expectSlotTokens: [false, false, false],
    },
    {
      label: 'first-title-token',
      partialCandidates: [{ title: '夏日' }],
      expectHasFirstToken: true,
      expectSlotTokens: [true, false, false],
    },
    {
      label: 'body-continues',
      partialCandidates: [
        { title: '夏日美甲活动', body: '到店立减' },
        { title: '备选' },
      ],
      expectHasFirstToken: true,
      expectSlotTokens: [true, true, false],
    },
    {
      label: 'three-candidates-partial',
      partialCandidates: [
        {
          title: '夏日美甲活动',
          body: '到店立减 50',
          conversionHook: '私信领取',
        },
        { title: '备选 A', body: '限时' },
        { conversionHook: '到店' },
      ],
      expectHasFirstToken: true,
      expectSlotTokens: [true, true, true],
    },
  ];
}
