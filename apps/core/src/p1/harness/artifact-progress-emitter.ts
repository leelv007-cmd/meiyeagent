/**
 * Make-side ArtifactUpdate producer (V31-14 producer half of V31-15).
 *
 * Emits artifact.revised semantic candidates when page/scene progress lands
 * during note/media execution. Payload is always artifact-update/v1 and must
 * parse with artifactUpdateWireSchema before projector ingest.
 */

import {
  ARTIFACT_UPDATE_SCHEMA_VERSION,
  artifactUpdateWireSchema,
  type ArtifactUpdateWire,
} from '@meiye/contracts';

import type { SemanticEventCandidate } from '../agent-semantic-events/semantic-event-store.js';

export type ArtifactProgressEmitterPort = {
  project(candidate: SemanticEventCandidate): Promise<unknown>;
};

export type NotePageProgressArtifactInput = {
  workspaceId: string;
  workflowId: string;
  threadId: string;
  artifactId: string;
  pageIndex: number;
  pageId: string;
  state: 'running' | 'success' | 'failed';
  revision: number;
  title?: string;
  occurredAt: string;
  correlationId?: string;
};

export type VideoSceneProgressArtifactInput = {
  workspaceId: string;
  workflowId: string;
  threadId: string;
  artifactId: string;
  sceneIndex: number;
  state: 'running' | 'success' | 'failed';
  revision: number;
  storyboard?: string;
  occurredAt: string;
  correlationId?: string;
};

function noteImageStatus(
  state: NotePageProgressArtifactInput['state'],
): 'generating' | 'ready' | 'failed' {
  if (state === 'running') return 'generating';
  if (state === 'success') return 'ready';
  return 'failed';
}

/**
 * Build a validated note page delta ArtifactUpdate (artifact-update/v1).
 */
export function buildNotePageArtifactUpdate(
  input: NotePageProgressArtifactInput,
): ArtifactUpdateWire {
  const status =
    input.state === 'failed'
      ? ('failed' as const)
      : input.state === 'success'
        ? ('partial' as const)
        : ('partial' as const);
  return artifactUpdateWireSchema.parse({
    schemaVersion: ARTIFACT_UPDATE_SCHEMA_VERSION,
    mode: 'delta',
    artifactId: input.artifactId,
    artifactType: 'note',
    revision: input.revision,
    status,
    baseRevision: Math.max(0, input.revision - 1),
    patch: {
      pages: [
        {
          pageIndex: input.pageIndex,
          stage: 'image',
          ...(input.title ? { title: input.title } : {}),
          imageStatus: noteImageStatus(input.state),
        },
      ],
    },
    summary: `note page ${input.pageIndex + 1} ${input.state}`,
  });
}

/**
 * Build a validated video scene delta ArtifactUpdate.
 */
export function buildVideoSceneArtifactUpdate(
  input: VideoSceneProgressArtifactInput,
): ArtifactUpdateWire {
  const keyframeStatus =
    input.state === 'running'
      ? ('generating' as const)
      : input.state === 'success'
        ? ('ready' as const)
        : ('failed' as const);
  return artifactUpdateWireSchema.parse({
    schemaVersion: ARTIFACT_UPDATE_SCHEMA_VERSION,
    mode: 'delta',
    artifactId: input.artifactId,
    artifactType: 'video',
    revision: input.revision,
    status: input.state === 'failed' ? 'failed' : 'partial',
    baseRevision: Math.max(0, input.revision - 1),
    patch: {
      scenes: [
        {
          sceneIndex: input.sceneIndex,
          ...(input.storyboard ? { storyboard: input.storyboard } : {}),
          keyframeStatus,
        },
      ],
    },
    summary: `video scene ${input.sceneIndex + 1} ${input.state}`,
  });
}

export function toArtifactRevisedCandidate(input: {
  workspaceId: string;
  workflowId: string;
  threadId: string;
  update: ArtifactUpdateWire;
  occurredAt: string;
  correlationId?: string;
}): SemanticEventCandidate {
  // Re-parse as fail-closed gate before projector ingest.
  const payload = artifactUpdateWireSchema.parse(input.update);
  return {
    eventId: `artifact.revised:${input.workflowId}:${payload.artifactId}:r${payload.revision}`,
    threadId: input.threadId,
    resourceId: input.workspaceId,
    contextRole: 'excluded',
    sourceDomain: 'make_harness.artifact',
    sourceEntityId: payload.artifactId,
    sourceRevision: String(payload.revision),
    correlationId: input.correlationId ?? input.workflowId,
    eventType: 'artifact.revised',
    payload,
    occurredAt: input.occurredAt,
  };
}

/**
 * Emit note page progress as artifact.revised (idempotent eventId).
 */
export async function emitNotePageArtifactProgress(
  emitter: ArtifactProgressEmitterPort | undefined,
  input: NotePageProgressArtifactInput,
): Promise<ArtifactUpdateWire | null> {
  if (!emitter) return null;
  const update = buildNotePageArtifactUpdate(input);
  await emitter.project(
    toArtifactRevisedCandidate({
      workspaceId: input.workspaceId,
      workflowId: input.workflowId,
      threadId: input.threadId,
      update,
      occurredAt: input.occurredAt,
      correlationId: input.correlationId,
    }),
  );
  return update;
}

/**
 * Emit video scene progress as artifact.revised.
 */
export async function emitVideoSceneArtifactProgress(
  emitter: ArtifactProgressEmitterPort | undefined,
  input: VideoSceneProgressArtifactInput,
): Promise<ArtifactUpdateWire | null> {
  if (!emitter) return null;
  const update = buildVideoSceneArtifactUpdate(input);
  await emitter.project(
    toArtifactRevisedCandidate({
      workspaceId: input.workspaceId,
      workflowId: input.workflowId,
      threadId: input.threadId,
      update,
      occurredAt: input.occurredAt,
      correlationId: input.correlationId,
    }),
  );
  return update;
}
