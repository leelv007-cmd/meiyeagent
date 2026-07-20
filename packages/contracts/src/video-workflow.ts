/**
 * Video workflow public cross-lane consumer contract (S1 / #87, E1 / #102).
 *
 * WT-E exclusive owner of evolution.
 *
 * This module is the **stable derived projection** for Composer / Result Center /
 * billing consumers. Canonical truth remains the existing generic Task/Job/
 * Asset records; `CanonicalVideoRun` is only their Core command assembly and
 * DurableVideoWorkflow is an internal execution/audit projection. Public payloads must never include Provider,
 * Credential, route internals, or owned asset blobs — only ids/status/summary.
 *
 * Core projection helper: `projectVideoWorkflowPublic` in
 * `apps/core/src/p1/model-supply/video-workflow-projection.ts`.
 * Do not import core durable types into web lanes.
 */

/** Opaque workflow identity shared across lanes. */
export type VideoWorkflowId = string;
export type VideoShotId = string;

/**
 * Public status union for consumers that only need lifecycle, not provider detail.
 * Aligns with durable status names; subset may grow under WT-E only.
 */
export type VideoWorkflowPublicStatus =
  | 'draft'
  | 'running'
  | 'awaiting_quality_review'
  | 'cancel_requested'
  | 'completed'
  | 'cancelled'
  | 'failed';

/** Minimal shot summary for result-center / composer projections. */
export interface VideoShotSummary {
  shotId: VideoShotId;
  promptPreview?: string;
  candidatesPerShot: number;
  selectedCandidateIndex?: number;
  candidateCount: number;
}

/** Public workflow projection — ids, status, shot summary only. */
export interface VideoWorkflowPublicProjection {
  workflowId: VideoWorkflowId;
  workId?: string;
  status: VideoWorkflowPublicStatus;
  storyboardVersion: number;
  storyboardRevision: string;
  catalogModelId: string;
  confirmed: boolean;
  shots: VideoShotSummary[];
  subtitleText?: string;
  failureCode?: string;
  revision: number;
  updatedAt: string;
}
