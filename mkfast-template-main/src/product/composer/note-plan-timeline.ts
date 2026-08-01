/**
 * Multi-page note outline timeline — xhs-spec §4.1 / §8.2 P1-5 (#319).
 *
 * Pure model: per-page editable outline → batch image status → per-page
 * regenerate intent. Composer timeline only; Tiptap stays in the object
 * workspace (C12). Fixture/recorded paths drive status without live providers.
 */

import type { ImageTextNoteVersion, NotePlan } from '@meiye/contracts';

/** Per-page image generation surface status (product language). */
export const NOTE_PAGE_IMAGE_STATUSES = [
  'pending',
  'generating',
  'ready',
  'failed',
] as const;

export type NotePageImageStatus = (typeof NOTE_PAGE_IMAGE_STATUSES)[number];

export const NOTE_PAGE_IMAGE_STATUS_LABELS: Record<NotePageImageStatus, string> =
  {
    pending: '待配图',
    generating: '配图中',
    ready: '已配图',
    failed: '配图失败',
  };

export type NotePlanTimelinePage = {
  pageId: string;
  order: number;
  pageRole: string;
  pagePurpose: string;
  /** Editable outline title (maps to textBlock.title). */
  title: string;
  /** Editable outline body (maps to textBlock.body). */
  body: string;
  imageStatus: NotePageImageStatus;
  imageAssetId?: string;
  revision: number;
  /** True when merchant edited outline since last server projection. */
  outlineDirty: boolean;
  /** True while a per-page regenerate request is outstanding. */
  regenerateRequested: boolean;
};

export type NotePlanTimeline = {
  schema: 'note-plan-timeline/v1';
  themeAnchor: string;
  styleId?: string;
  styleName?: string;
  pages: NotePlanTimelinePage[];
};

export type NotePlanOutlineEdit = {
  pageId: string;
  title?: string;
  body?: string;
};

export type NotePlanCoverAndBody = {
  /** Cover page: pageRole cover, else first by order. */
  cover: NotePlanTimelinePage | null;
  /** Non-cover pages in order — the note body group. */
  bodyPages: NotePlanTimelinePage[];
};

/** Cover = pageRole cover; else order === 1. Body = the rest in order. */
export function notePlanCoverAndBody(
  timeline: NotePlanTimeline
): NotePlanCoverAndBody {
  const ordered = [...timeline.pages].sort((a, b) => a.order - b.order);
  const cover =
    ordered.find((page) => page.pageRole === 'cover') ?? ordered[0] ?? null;
  const bodyPages = ordered.filter((page) => page.pageId !== cover?.pageId);
  return { cover, bodyPages };
}

export function projectNotePlanTimelineFromPlan(
  plan: NotePlan,
  options?: {
    styleId?: string;
    styleName?: string;
    /** Default image status when asset id is absent. */
    defaultImageStatus?: NotePageImageStatus;
  }
): NotePlanTimeline {
  const defaultStatus = options?.defaultImageStatus ?? 'pending';
  return {
    schema: 'note-plan-timeline/v1',
    themeAnchor: plan.themeAnchor,
    ...(options?.styleId ? { styleId: options.styleId } : {}),
    ...(options?.styleName ? { styleName: options.styleName } : {}),
    pages: [...plan.pages]
      .sort((a, b) => a.order - b.order)
      .map((page) => ({
        pageId: page.id,
        order: page.order,
        pageRole: page.pageRole,
        pagePurpose: page.pagePurpose,
        title: page.textBlock.title,
        body: page.textBlock.body,
        imageStatus: page.imageAssetId ? 'ready' : defaultStatus,
        ...(page.imageAssetId ? { imageAssetId: page.imageAssetId } : {}),
        revision: page.revision,
        outlineDirty: false,
        regenerateRequested: false,
      })),
  };
}

export function projectNotePlanTimelineFromVersion(
  version: ImageTextNoteVersion,
  options?: { styleId?: string; styleName?: string }
): NotePlanTimeline {
  return projectNotePlanTimelineFromPlan(version.plan, {
    ...options,
    defaultImageStatus: 'pending',
  });
}

/**
 * Batch status from harness stage progress (fixture/recorded OK).
 * Does not invent page text — only refreshes imageStatus on an existing timeline.
 */
export function applyBatchImageStatusFromHarnessStage(
  timeline: NotePlanTimeline,
  input: { stage: string; state: string }
): NotePlanTimeline {
  let nextStatus: NotePageImageStatus | null = null;
  if (input.stage === 'execution_selection') {
    if (input.state === 'running' || input.state === 'suspended') {
      nextStatus = 'generating';
    } else if (input.state === 'success') {
      nextStatus = 'ready';
    } else if (input.state === 'failed') {
      nextStatus = 'failed';
    }
  } else if (
    input.stage === 'brief_compilation' &&
    (input.state === 'success' || input.state === 'suspended')
  ) {
    nextStatus = 'pending';
  }
  if (!nextStatus) return timeline;
  return setAllNotePlanImageStatuses(timeline, nextStatus);
}

export function setAllNotePlanImageStatuses(
  timeline: NotePlanTimeline,
  status: NotePageImageStatus
): NotePlanTimeline {
  return {
    ...timeline,
    pages: timeline.pages.map((page) => ({
      ...page,
      imageStatus: status,
      // Ready from batch success clears in-flight regenerate flags.
      regenerateRequested:
        status === 'generating' ? page.regenerateRequested : false,
    })),
  };
}

export function editNotePlanPageOutline(
  timeline: NotePlanTimeline,
  edit: NotePlanOutlineEdit
): NotePlanTimeline {
  const index = timeline.pages.findIndex((page) => page.pageId === edit.pageId);
  if (index === -1) {
    throw new Error(`Unknown NotePlan page: ${edit.pageId}`);
  }
  const current = timeline.pages[index]!;
  const title = edit.title !== undefined ? edit.title : current.title;
  const body = edit.body !== undefined ? edit.body : current.body;
  if (title === current.title && body === current.body) return timeline;
  const pages = timeline.pages.slice();
  pages[index] = {
    ...current,
    title,
    body,
    outlineDirty: true,
  };
  return { ...timeline, pages };
}

/**
 * Merchant per-page regenerate intent. Marks the page generating and sets
 * regenerateRequested; production host binds merchant_request generation.
 */
export function requestNotePlanPageRegenerate(
  timeline: NotePlanTimeline,
  pageId: string
): NotePlanTimeline {
  const index = timeline.pages.findIndex((page) => page.pageId === pageId);
  if (index === -1) {
    throw new Error(`Unknown NotePlan page: ${pageId}`);
  }
  const pages = timeline.pages.slice();
  pages[index] = {
    ...pages[index]!,
    imageStatus: 'generating',
    regenerateRequested: true,
  };
  return { ...timeline, pages };
}

/** Fixture/recorded path: complete a regenerate with a new asset id. */
export function completeNotePlanPageRegenerate(
  timeline: NotePlanTimeline,
  input: { pageId: string; imageAssetId: string }
): NotePlanTimeline {
  const index = timeline.pages.findIndex(
    (page) => page.pageId === input.pageId
  );
  if (index === -1) {
    throw new Error(`Unknown NotePlan page: ${input.pageId}`);
  }
  const current = timeline.pages[index]!;
  const pages = timeline.pages.slice();
  pages[index] = {
    ...current,
    imageStatus: 'ready',
    imageAssetId: input.imageAssetId,
    revision: current.revision + 1,
    regenerateRequested: false,
  };
  return { ...timeline, pages };
}

/** At least one page has a dirty outline edit (P1-5 edit proof). */
export function notePlanTimelineHasOutlineEdit(
  timeline: NotePlanTimeline
): boolean {
  return timeline.pages.some((page) => page.outlineDirty);
}

/** True when any page shows a non-pending image status (status display proof). */
export function notePlanTimelineShowsImageStatus(
  timeline: NotePlanTimeline
): boolean {
  return timeline.pages.some((page) => page.imageStatus !== 'pending');
}
