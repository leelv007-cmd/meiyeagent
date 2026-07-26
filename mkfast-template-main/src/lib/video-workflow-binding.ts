/**
 * Which canonical video run belongs to a Result page (T37-R2 / #231).
 *
 * Two owners write two different fields, and the read side has to know both:
 *
 *  - `storedJob` (`apps/core/src/p1/model-supply/video-workflow-canonical-postgres.ts`)
 *    persists `videoWorkflowId` on every canonical write, and never persists
 *    `providerJobId`. Because a canonical write replaces the whole job payload,
 *    a reader that knows only `providerJobId` loses the run on the first shot
 *    edit — measured before this existed: one edit, one reload, no storyboard.
 *  - Historical *originating* Jobs — written by the pre-ContentPackage creation
 *    path and never touched by the canonical store — carry only
 *    `providerJobId`, prefixed `video-workflow-`. That is how the binding used
 *    to work, and those rows must keep resolving.
 *
 * So: prefer the field the canonical owner writes, fall back to the historical
 * one. Neither write shape moves; only the read learns which owner to ask.
 *
 * Extracted from the route so the three shapes below are covered by a test that
 * actually runs, rather than only by a browser journey.
 */

/**
 * The job shape this resolution needs. `videoWorkflowId` is not on
 * `CreativeJob` in `@meiye/contracts` — the canonical store writes it into the
 * same payload — so it is accepted here as an optional field rather than
 * widened across the shared type.
 */
export type VideoWorkflowBindingJob = {
  providerJobId?: string | undefined;
  videoWorkflowId?: string | undefined;
};

/** Historical originating Jobs name their workflow through this prefix. */
const LEGACY_WORKFLOW_PREFIX = 'video-workflow-';

export function resolveVideoWorkflowBinding(
  job: VideoWorkflowBindingJob | null | undefined
): string | undefined {
  if (job?.videoWorkflowId) return job.videoWorkflowId;
  if (job?.providerJobId?.startsWith(LEGACY_WORKFLOW_PREFIX)) {
    return job.providerJobId;
  }
  return undefined;
}
