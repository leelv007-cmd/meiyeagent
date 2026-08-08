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

export type NotePagePlanLike = {
  pages: Array<{ id: string; order: number; textBlock?: { title?: string } }>;
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
 * Build the note runner page progress callback (progress + optional artifact.revised).
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
  };
}): NotePageProgressReporter {
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
      await emitNotePageArtifactProgress(input.artifactEmitter, {
        workspaceId: input.artifactContext.workspaceId,
        workflowId: input.artifactContext.workflowId,
        threadId: input.artifactContext.threadId,
        artifactId: input.artifactContext.artifactId,
        pageIndex,
        pageId: event.pageId,
        state: event.state,
        revision: input.artifactContext.nextRevision(),
        title: page?.textBlock?.title,
        occurredAt: input.artifactContext.now(),
      });
    }
  };
}
