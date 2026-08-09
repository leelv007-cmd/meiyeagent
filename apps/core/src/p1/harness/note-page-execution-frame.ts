/**
 * Note page-level execution frame (symbol anchor).
 *
 * Migrated out of workflow-core note runner for V31-14 / V3.1 §22.4 so the
 * page progress callback and order label stay greppable after runner convergence.
 *
 * Grep anchors: notePageOrderLabel, createNotePageProgressReporter.
 */

import {
  emitNotePageArtifactProgress,
  type ArtifactProgressEmitterPort,
} from './artifact-progress-emitter.js';
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
    now: () => string;
	/** Number of pages targeted by this execution (may be a local regeneration subset). */
	terminalUnitCount?: number;
	/** Ready revision of the source artifact continued by this execution. */
	parentRevision?: number;
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
  let readyRevision: number | undefined = input.artifactContext?.parentRevision;
	let derivedParentRevision: number | undefined = input.artifactContext?.parentRevision;

  return async (event) => {
    const order = notePageOrderLabel(input.plan, event.pageId);
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
        }
        if (!skeletonEmitted.has(event.pageId)) {
          skeletonEmitted.add(event.pageId);
          await emitNotePageArtifactProgress(input.artifactEmitter, {
            ...base,
            stage: 'skeleton',
            state: 'running',
            revision: input.artifactContext.nextRevision(),
            ...(derivedParentRevision !== undefined
              ? { parentRevision: derivedParentRevision }
              : {}),
          });
          derivedParentRevision = undefined;
        }
        if (!copyEmitted.has(event.pageId)) {
          copyEmitted.add(event.pageId);
          await emitNotePageArtifactProgress(input.artifactEmitter, {
            ...base,
            stage: 'copy',
            state: 'success',
            body: page?.textBlock?.body,
            revision: input.artifactContext.nextRevision(),
          });
        }
      }
      if (event.state === 'success') completedPages.add(event.pageId);
		const terminalUnitCount = input.artifactContext.terminalUnitCount ?? unitIds.length;
		const terminal = completedPages.size >= terminalUnitCount;
      const revision = input.artifactContext.nextRevision();
      await emitNotePageArtifactProgress(input.artifactEmitter, {
        ...base,
        stage: 'image',
        state: event.state,
        revision,
        ...(terminal ? { status: 'ready' as const } : {}),
        ...(derivedParentRevision !== undefined
          ? { parentRevision: derivedParentRevision }
          : {}),
      });
      derivedParentRevision = undefined;
      if (terminal) readyRevision = revision;
    }

    // V31-16: unit completion boundary — steer inserts after current page unit.
    if (event.state === 'success' && steeringTracker) {
      await steeringTracker.onPageSuccess(event.pageId);
    }
  };
}
