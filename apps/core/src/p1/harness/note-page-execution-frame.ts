/**
 * Note page-level execution frame (symbol anchor).
 *
 * Migrated out of workflow-core note runner for V31-14 / V3.1 §22.4 so the
 * page progress callback and order label stay greppable after runner convergence.
 *
 * Grep anchors: notePageOrderLabel, createNotePageProgressReporter.
 */

import {
  buildNotePageArtifactUpdate,
  emitNotePageArtifactProgress,
  toArtifactRevisedCandidate,
  type ArtifactProgressEmitterPort,
  type NotePageProgressArtifactInput,
} from './artifact-progress-emitter.js';
import type { ArtifactUpdateWire } from '@meiye/contracts';
import type { MakeSteeringBoundaryPort } from './make-steering-boundary.js';
import { createNotePageSteeringBoundaryTracker } from './make-steering-boundary.js';

export type NotePagePlanLike = {
  pages: Array<{
    id: string;
    order: number;
    textBlock?: { title?: string; body?: string };
  }>;
};

/**
 * Stable page order label for merchant progress copy.
 * Symbol-anchored — V3.1 §22.4 note page frame.
 */
export function notePageOrderLabel(
  plan: NotePagePlanLike,
  pageId: string,
): string {
  return String(plan.pages.find(({ id }) => id === pageId)?.order ?? pageId);
}

export type NotePageProgressEvent = {
  pageId: string;
  /** Frozen source page mapped by the subset runner after execution planning. */
  sourcePageId?: string;
  /**
   * 1-based order of the frozen source page. Subset regeneration iterates the
   * frozen source plan, whose page ids are absent from the plan compiled this
   * run, so page identity cannot be looked up in `input.plan` — without this
   * every delta collapses onto pageIndex 0 (V31-15).
   */
  sourcePageOrder?: number;
  state: 'running' | 'success';
};

export type NotePageProgressFrameEvent = {
  stage: 'execution_selection';
  state: 'running' | 'success';
  pageId: string;
  message: string;
};

export type NotePageProgressReporter = (
  event: NotePageProgressEvent,
) => Promise<void>;

/**
 * Build the note runner page progress callback (progress + optional artifact.revised
 * + V31-16 Make steering dual-queue unit boundary on page success).
 */
export function createNotePageProgressReporter(input: {
  plan: NotePagePlanLike;
  reportProgress: (event: NotePageProgressFrameEvent) => Promise<void>;
  /** Optional V31-15 producer: emit artifact.revised on page progress. */
  artifactEmitter?: ArtifactProgressEmitterPort;
  artifactContext?: {
    workspaceId: string;
    workflowId: string;
    threadId: string;
    artifactId: string;
    /** Starting revision; increments per success event. */
    nextRevision: () => number;
    /**
     * Raise the allocator to a revision that actually landed. A memoised
     * emission never calls `nextRevision`, so without this the counter stays
     * where the crash left it and the next fresh emission re-uses a revision the
     * store already holds — the same collision the memo exists to prevent.
     */
    observeRevision?: (revision: number) => void;
    now: () => string;
	/** Frozen source page ids targeted by this execution. */
	targetSourceUnitIds?: readonly string[];
	/** Ready revision of the source artifact continued by this execution. */
	parentRevision?: number;
	/**
	 * Durable memo for one emission (V31-15 / F9). Both the revision number and
	 * the built payload are allocated inside it, so a DBOS re-execution replays
	 * the first attempt's revision byte for byte instead of minting the same
	 * number over freshly built content — which the projector keeps (first write
	 * wins) while the run believes its own version landed.
	 *
	 * The key is the page, the stage and which attempt at that pair this is —
	 * never the emission's position in the run. An ordinal key silently replays
	 * the wrong page's payload the moment a re-execution emits pages in another
	 * order: measured, that published one page twice and dropped the other with
	 * no error anywhere, because the replayed payloads matched what was stored.
	 * Keyed by page, a reordered re-execution replays the pages it already
	 * published and allocates fresh revisions for the rest.
	 *
	 * Absent means no durability: the counter is a plain in-process local, which
	 * is correct for a fixture run and for any caller with no durable runtime.
	 *
	 * What this memo does NOT do, measured: removing it leaves every re-execution
	 * test green. The brief is itself a durable step, so re-executed content is
	 * deterministic and the plain counter already produces a byte-identical
	 * chain — the memo has no independent failing test and buys nothing on the
	 * ordinary replay path. It is depth against a content source that one day
	 * stops being durable. The enforcement point is `assertProjectedReplayMatches`
	 * in the semantic event store: that guard, not this memo, is what turns a
	 * spliced artifact into a loud refusal. The keying above is the part of this
	 * memo that is load-bearing, and it does have its own failing test.
	 */
	runStep?: (
	  key: string,
	  operation: () => Promise<ArtifactUpdateWire>,
	) => Promise<ArtifactUpdateWire>;
  };
  /**
   * Optional V31-16: drain steer queue after each successful page unit.
   * When the last page succeeds, follow_up also drains (allUnitsTerminal).
   */
  makeSteeringBoundary?: MakeSteeringBoundaryPort;
  steeringContext?: {
    workspaceId: string;
    taskId: string;
  };
}): NotePageProgressReporter {
  const unitIds = input.plan.pages
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((page) => page.id);
  const steeringTracker =
    input.makeSteeringBoundary && input.steeringContext
      ? createNotePageSteeringBoundaryTracker({
          workspaceId: input.steeringContext.workspaceId,
          taskId: input.steeringContext.taskId,
          unitIds,
          boundary: input.makeSteeringBoundary,
        })
      : null;
  // V31-15: 骨架 → 文案 → 配图. skeleton/copy land once per page before the
  // page image generation; image running/success land per generation attempt.
  const skeletonEmitted = new Set<string>();
  const copyEmitted = new Set<string>();
  const completedPages = new Set<string>();
  const completedSourcePages = new Set<string>();
  let readyRevision: number | undefined = input.artifactContext?.parentRevision;
	let derivedParentRevision: number | undefined = input.artifactContext?.parentRevision;
  /** Attempts per page+stage, so the durable key never depends on run order. */
  const emissionAttempts = new Map<string, number>();

  /**
   * Emit one revision and answer with the revision that actually landed.
   *
   * With a durable memo the number and the payload are allocated together
   * inside it, and the returned revision comes from the memo rather than from
   * the local counter — otherwise a replay would leave the counter behind the
   * revisions already stored.
   */
  const emitRevision = async (
    unit: string,
    build: (revision: number) => NotePageProgressArtifactInput,
  ): Promise<number> => {
    const context = input.artifactContext;
    const emitter = input.artifactEmitter;
    if (!context || !emitter) return 0;
    if (!context.runStep) {
      const update = await emitNotePageArtifactProgress(
        emitter,
        build(context.nextRevision()),
      );
      const revision = update?.revision ?? 0;
      context.observeRevision?.(revision);
      return revision;
    }
    const attempt = (emissionAttempts.get(unit) ?? 0) + 1;
    emissionAttempts.set(unit, attempt);
    const update = await context.runStep(`${unit}:${attempt}`, async () =>
      buildNotePageArtifactUpdate(build(context.nextRevision())),
    );
    context.observeRevision?.(update.revision);
    await emitter.project(
      toArtifactRevisedCandidate({
        workspaceId: context.workspaceId,
        workflowId: context.workflowId,
        threadId: context.threadId,
        update,
        occurredAt: context.now(),
      }),
    );
    return update.revision;
  };

  return async (event) => {
    const order =
      event.sourcePageOrder !== undefined
        ? String(event.sourcePageOrder)
        : notePageOrderLabel(input.plan, event.pageId);
    await input.reportProgress({
      stage: 'execution_selection',
      state: event.state,
      pageId: event.pageId,
      message:
        event.state === 'running'
          ? `正在生成第 ${order} 页配图`
          : `第 ${order} 页配图已完成`,
    });

    if (input.artifactEmitter && input.artifactContext) {
      const parsed = Number.parseInt(order, 10);
      const pageIndex =
        Number.isFinite(parsed) && parsed > 0
          ? parsed - 1
          : Math.max(
              0,
              input.plan.pages.findIndex((p) => p.id === event.pageId),
            );
      const page = input.plan.pages.find((p) => p.id === event.pageId);
      const base = {
        workspaceId: input.artifactContext.workspaceId,
        workflowId: input.artifactContext.workflowId,
        threadId: input.artifactContext.threadId,
        artifactId: input.artifactContext.artifactId,
        pageIndex,
        pageId: event.pageId,
        title: page?.textBlock?.title,
        occurredAt: input.artifactContext.now(),
      };
      if (event.state === 'running') {
        if (readyRevision !== undefined) {
          derivedParentRevision = readyRevision;
          readyRevision = undefined;
          completedPages.clear();
		  completedSourcePages.clear();
        }
        if (!skeletonEmitted.has(event.pageId)) {
          skeletonEmitted.add(event.pageId);
          const parentRevision = derivedParentRevision;
          await emitRevision(`${event.pageId}:skeleton`, (revision) => ({
            ...base,
            stage: 'skeleton',
            state: 'running',
            revision,
            ...(parentRevision !== undefined ? { parentRevision } : {}),
          }));
          derivedParentRevision = undefined;
        }
        if (!copyEmitted.has(event.pageId)) {
          copyEmitted.add(event.pageId);
          await emitRevision(`${event.pageId}:copy`, (revision) => ({
            ...base,
            stage: 'copy',
            state: 'success',
            body: page?.textBlock?.body,
            revision,
          }));
        }
      }
      if (event.state === 'success') {
		completedPages.add(event.pageId);
		if (event.sourcePageId) completedSourcePages.add(event.sourcePageId);
	  }
		const terminal = input.artifactContext.targetSourceUnitIds
		  ? input.artifactContext.targetSourceUnitIds.every((sourcePageId) =>
			  completedSourcePages.has(sourcePageId),
			)
		  : unitIds.every((pageId) => completedPages.has(pageId));
      const parentRevision = derivedParentRevision;
      const revision = await emitRevision(
        `${event.pageId}:image:${event.state}`,
        (next) => ({
        ...base,
        stage: 'image',
        state: event.state,
        revision: next,
        ...(terminal ? { status: 'ready' as const } : {}),
        ...(parentRevision !== undefined ? { parentRevision } : {}),
        }),
      );
      derivedParentRevision = undefined;
      if (terminal) readyRevision = revision;
    }

    // V31-16: unit completion boundary — steer inserts after current page unit.
    if (event.state === 'success' && steeringTracker) {
      await steeringTracker.onPageSuccess(event.pageId);
    }
  };
}
