/**
 * Result Center token-stream running-state projection (ADR-0007 / D-042 / #99).
 *
 * copy / image_text stream from the first usable token.
 * Stage announcements live only in the a11y aggregate layer — they must not
 * replace token-stream intermediate state assertions.
 *
 * Pure helpers are inlined (not imported from copy-stream.tsx) so node:test
 * fixtures do not pull React / locale modules.
 */

import { harnessCopyStreamPhase } from '@/product/workbench-state-model';

export type ResultTokenStreamWorkspace =
  | 'copy'
  | 'image_text'
  | 'image'
  | 'video';

export type PartialCopyCandidate = {
  body?: string;
  conversionHook?: string;
  title?: string;
};

export type ResultTokenStreamInput = {
  workspaceKind: ResultTokenStreamWorkspace;
  progressState?: 'waiting' | 'running' | 'suspended' | 'success' | 'failed';
  /** Partial structured object from useObject / stream (copy path). */
  partialCandidates?: PartialCopyCandidate[];
  loading?: boolean;
  hasError?: boolean;
  interrupted?: boolean;
  completed?: boolean;
};

export type ResultTokenStreamSlot = {
  index: number;
  hasToken: boolean;
  title: string;
  body: string;
  conversionHook: string;
};

export type ResultTokenStreamProjection = {
  /** Whether this workspace uses token-level streaming at all. */
  tokenStreaming: boolean;
  /** harnessCopyStreamPhase — drafting vs awaiting_confirmation. */
  streamPhase: 'awaiting_confirmation' | 'drafting' | null;
  /** True once any candidate slot has a non-empty title/body/hook. */
  hasFirstToken: boolean;
  /** Intermediate slots for fixture / e2e assertions. */
  slots: ResultTokenStreamSlot[];
  /** Show the stream panel (running intermediate state). */
  showStreamPanel: boolean;
  /**
   * A11y aggregate stage text only — tests must not treat this as a
   * substitute for token-stream intermediate assertions.
   */
  a11yStageAnnouncement: string | null;
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
      showStreamPanel: false,
      a11yStageAnnouncement: running
        ? input.progressState === 'suspended'
          ? '等待确认'
          : '任务进行中'
        : null,
    };
  }

  const streamPhase = harnessCopyStreamPhase(input.progressState);
  const rawSlots = copyCandidateSlots({
    candidates: input.partialCandidates,
  });
  const slots: ResultTokenStreamSlot[] = rawSlots.map((candidate, index) => ({
    index,
    hasToken: candidateHasToken(candidate),
    title: candidate.title?.trim() ?? '',
    body: candidate.body?.trim() ?? '',
    conversionHook: candidate.conversionHook?.trim() ?? '',
  }));
  const hasFirstToken = slots.some((slot) => slot.hasToken);
  const completed = Boolean(input.completed);
  const loading = Boolean(input.loading);
  const hasObject = Boolean(
    input.partialCandidates && input.partialCandidates.length > 0
  );
  const showStreamPanel =
    !completed &&
    (loading ||
      hasObject ||
      Boolean(input.hasError) ||
      Boolean(input.interrupted));

  // A11y aggregate only — never the sole progress signal for copy streaming.
  let a11yStageAnnouncement: string | null = null;
  if (showStreamPanel) {
    if (streamPhase === 'awaiting_confirmation') {
      a11yStageAnnouncement = '等待确认';
    } else if (hasFirstToken) {
      a11yStageAnnouncement = '正在生成内容';
    } else {
      a11yStageAnnouncement = '任务进行中';
    }
  }

  return {
    tokenStreaming: true,
    streamPhase,
    hasFirstToken,
    slots,
    showStreamPanel,
    a11yStageAnnouncement,
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
