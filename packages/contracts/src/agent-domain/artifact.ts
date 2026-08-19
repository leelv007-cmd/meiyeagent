/**
 * Agent-domain: Artifact protocol (V3.1 §5.5 / §27.5, V31-15).
 */

import { z } from 'zod';

import {
  identifierSchema,
  nonEmptyTrimmedStringSchema,
} from '../identifiers.js';
import { positiveRevisionSchema, revisionNumberSchema } from './internal.js';

// ─── 6b. Artifact protocol (V3.1 §5.5 / §27.5, V31-15) ───────────────────────
//
// Wire = discriminated union snapshot|delta. Payload of semantic event
// `artifact.revised`. Patch schemas are controlled by artifactType (not unknown).
// Reconciliation: same artifactId in-place; same revision idempotent; skip
// revision → needs_snapshot; ready content never silent-overwritten (derived).

export const ARTIFACT_UPDATE_SCHEMA_VERSION = 'artifact-update/v1' as const;

export const artifactTypeSchema = z.enum([
  'plan',
  'copy',
  'note',
  'image',
  'video',
  'publish',
]);
export type ArtifactType = z.infer<typeof artifactTypeSchema>;

export const artifactStatusSchema = z.enum([
  'skeleton',
  'partial',
  'ready',
  'failed',
]);
export type ArtifactStatus = z.infer<typeof artifactStatusSchema>;

export const artifactMediaStageSchema = z.enum([
  'pending',
  'generating',
  'ready',
  'failed',
]);

/** Note page: skeleton → copy → image status (V3.1 §5.5). */
export const notePageStateSchema = z
  .object({
    pageIndex: z.number().int().nonnegative().max(50),
    stage: z.enum(['skeleton', 'copy', 'image']),
    title: nonEmptyTrimmedStringSchema.max(500).optional(),
    body: z.string().max(8_000).optional(),
    imageStatus: artifactMediaStageSchema.optional(),
    imageRef: nonEmptyTrimmedStringSchema.max(500).optional(),
  })
  .strict();
export type NotePageState = z.infer<typeof notePageStateSchema>;

/** Video scene: storyboard / keyframe only (V3.1 §5.5; V31-37 path A / V31-60). */
export const videoSceneStateSchema = z
  .object({
    sceneIndex: z.number().int().nonnegative().max(200),
    storyboard: z.string().max(4_000).optional(),
    keyframeStatus: artifactMediaStageSchema.optional(),
    keyframeRef: nonEmptyTrimmedStringSchema.max(500).optional(),
  })
  .strict();
export type VideoSceneState = z.infer<typeof videoSceneStateSchema>;

export const copyBlockStateSchema = z
  .object({
    blockId: identifierSchema,
    role: z.enum(['title', 'body', 'topic', 'cta', 'other']),
    text: z.string().max(8_000).optional(),
    status: z.enum(['skeleton', 'partial', 'ready', 'failed']).optional(),
  })
  .strict();
export type CopyBlockState = z.infer<typeof copyBlockStateSchema>;

export const planSectionStateSchema = z
  .object({
    sectionId: identifierSchema,
    title: nonEmptyTrimmedStringSchema.max(500).optional(),
    body: z.string().max(8_000).optional(),
    status: z.enum(['skeleton', 'partial', 'ready', 'failed']).optional(),
  })
  .strict();
export type PlanSectionState = z.infer<typeof planSectionStateSchema>;

export const publishItemStateSchema = z
  .object({
    itemId: identifierSchema,
    label: nonEmptyTrimmedStringSchema.max(200),
    ready: z.boolean(),
  })
  .strict();
export type PublishItemState = z.infer<typeof publishItemStateSchema>;

export const noteArtifactFullSchema = z
  .object({
    pages: z.array(notePageStateSchema).max(50),
  })
  .strict();

export const videoArtifactFullSchema = z
  .object({
    scenes: z.array(videoSceneStateSchema).max(200),
    title: nonEmptyTrimmedStringSchema.max(500).optional(),
  })
  .strict();

export const copyArtifactFullSchema = z
  .object({
    blocks: z.array(copyBlockStateSchema).max(50),
  })
  .strict();

export const planArtifactFullSchema = z
  .object({
    sections: z.array(planSectionStateSchema).max(50),
  })
  .strict();

export const imageArtifactFullSchema = z
  .object({
    imageStatus: artifactMediaStageSchema,
    imageRef: nonEmptyTrimmedStringSchema.max(500).optional(),
    caption: z.string().max(2_000).optional(),
  })
  .strict();

export const publishArtifactFullSchema = z
  .object({
    items: z.array(publishItemStateSchema).max(50),
  })
  .strict();

export const artifactFullBodySchema = z.union([
  noteArtifactFullSchema,
  videoArtifactFullSchema,
  copyArtifactFullSchema,
  planArtifactFullSchema,
  imageArtifactFullSchema,
  publishArtifactFullSchema,
]);
export type ArtifactFullBody = z.infer<typeof artifactFullBodySchema>;

/** Partial page upsert keyed by pageIndex. */
export const notePagePatchSchema = notePageStateSchema
  .partial()
  .required({ pageIndex: true })
  .strict();

export const noteArtifactPatchSchema = z
  .object({
    pages: z.array(notePagePatchSchema).min(1).max(50).optional(),
  })
  .strict();

export const videoScenePatchSchema = videoSceneStateSchema
  .partial()
  .required({ sceneIndex: true })
  .strict();

export const videoArtifactPatchSchema = z
  .object({
    scenes: z.array(videoScenePatchSchema).min(1).max(200).optional(),
    title: nonEmptyTrimmedStringSchema.max(500).optional(),
  })
  .strict();

export const copyArtifactPatchSchema = z
  .object({
    blocks: z.array(copyBlockStateSchema).min(1).max(50).optional(),
  })
  .strict();

export const planArtifactPatchSchema = z
  .object({
    sections: z.array(planSectionStateSchema).min(1).max(50).optional(),
  })
  .strict();

export const imageArtifactPatchSchema = z
  .object({
    imageStatus: artifactMediaStageSchema.optional(),
    imageRef: nonEmptyTrimmedStringSchema.max(500).optional(),
    caption: z.string().max(2_000).optional(),
  })
  .strict();

export const publishArtifactPatchSchema = z
  .object({
    items: z.array(publishItemStateSchema).min(1).max(50).optional(),
  })
  .strict();

export const artifactPatchBodySchema = z.union([
  noteArtifactPatchSchema,
  videoArtifactPatchSchema,
  copyArtifactPatchSchema,
  planArtifactPatchSchema,
  imageArtifactPatchSchema,
  publishArtifactPatchSchema,
]);
export type ArtifactPatchBody = z.infer<typeof artifactPatchBodySchema>;

const artifactUpdateSharedFields = {
  schemaVersion: z.literal(ARTIFACT_UPDATE_SCHEMA_VERSION),
  artifactId: identifierSchema,
  artifactType: artifactTypeSchema,
  /** Monotonic per artifactId; same value re-apply is idempotent. */
  revision: positiveRevisionSchema,
  status: artifactStatusSchema,
  summary: nonEmptyTrimmedStringSchema.max(500).optional(),
  /**
   * When advancing past a ready head, producer must set parentRevision to the
   * ready revision (derived version). Missing parentRevision = silent overwrite
   * and is rejected by applyArtifactUpdate.
   */
  parentRevision: positiveRevisionSchema.optional(),
};

function fullMatchesType(
  artifactType: ArtifactType,
  full: ArtifactFullBody,
): boolean {
  switch (artifactType) {
    case 'note':
      return 'pages' in full && !('scenes' in full) && !('blocks' in full);
    case 'video':
      return 'scenes' in full;
    case 'copy':
      return 'blocks' in full && !('pages' in full);
    case 'plan':
      return 'sections' in full;
    case 'image':
      return 'imageStatus' in full && !('pages' in full) && !('scenes' in full);
    case 'publish':
      return 'items' in full;
    default: {
      const _exhaustive: never = artifactType;
      void _exhaustive;
      return false;
    }
  }
}

function patchMatchesType(
  artifactType: ArtifactType,
  patch: ArtifactPatchBody,
): boolean {
  switch (artifactType) {
    case 'note':
      return 'pages' in patch || Object.keys(patch).length === 0;
    case 'video':
      return 'scenes' in patch || 'title' in patch || Object.keys(patch).length === 0;
    case 'copy':
      return 'blocks' in patch || Object.keys(patch).length === 0;
    case 'plan':
      return 'sections' in patch || Object.keys(patch).length === 0;
    case 'image':
      return (
        'imageStatus' in patch ||
        'imageRef' in patch ||
        'caption' in patch ||
        Object.keys(patch).length === 0
      );
    case 'publish':
      return 'items' in patch || Object.keys(patch).length === 0;
    default: {
      const _exhaustive: never = artifactType;
      void _exhaustive;
      return false;
    }
  }
}

export const artifactUpdateSnapshotSchema = z
  .object({
    ...artifactUpdateSharedFields,
    mode: z.literal('snapshot'),
    full: artifactFullBodySchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (!fullMatchesType(value.artifactType, value.full)) {
      context.addIssue({
        code: 'custom',
        message: `snapshot full body does not match artifactType=${value.artifactType}`,
        path: ['full'],
      });
    }
  });

export const artifactUpdateDeltaSchema = z
  .object({
    ...artifactUpdateSharedFields,
    mode: z.literal('delta'),
    /** Client head revision this delta expects; mismatch → needs_snapshot. */
    baseRevision: revisionNumberSchema,
    patch: artifactPatchBodySchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (!patchMatchesType(value.artifactType, value.patch)) {
      context.addIssue({
        code: 'custom',
        message: `delta patch does not match artifactType=${value.artifactType}`,
        path: ['patch'],
      });
    }
    if (value.baseRevision >= value.revision) {
      context.addIssue({
        code: 'custom',
        message: 'delta baseRevision must be < revision',
        path: ['baseRevision'],
      });
    }
  });

/** Discriminated wire union for ArtifactUpdate (MAJOR-08 / V31-15). */
export const artifactUpdateWireSchema = z.discriminatedUnion('mode', [
  artifactUpdateSnapshotSchema,
  artifactUpdateDeltaSchema,
]);
export type ArtifactUpdateWire = z.infer<typeof artifactUpdateWireSchema>;

/** Immutable ready/failed head kept for version browse. */
export type ArtifactVersionRecord = {
  revision: number;
  status: ArtifactStatus;
  body: ArtifactFullBody;
  summary?: string;
  parentRevision?: number;
};

/** Client/core projection after reconciliation (stable artifactId). */
export type ArtifactProjectionState = {
  artifactId: string;
  artifactType: ArtifactType;
  revision: number;
  status: ArtifactStatus;
  body: ArtifactFullBody;
  summary?: string;
  parentRevision?: number;
  /** Completed (ready/failed) heads retained for version 回看. */
  versionHistory: ArtifactVersionRecord[];
};

export type ApplyArtifactUpdateFailureReason =
  | 'needs_snapshot'
  | 'silent_overwrite'
  | 'type_mismatch'
  | 'invalid_patch';

export type ApplyArtifactUpdateResult =
  | { ok: true; state: ArtifactProjectionState; duplicate: boolean }
  | {
      ok: false;
      reason: ApplyArtifactUpdateFailureReason;
      detail?: string;
    };

function emptyBodyForType(artifactType: ArtifactType): ArtifactFullBody {
  switch (artifactType) {
    case 'note':
      return { pages: [] };
    case 'video':
      return { scenes: [] };
    case 'copy':
      return { blocks: [] };
    case 'plan':
      return { sections: [] };
    case 'image':
      return { imageStatus: 'pending' };
    case 'publish':
      return { items: [] };
    default: {
      const _exhaustive: never = artifactType;
      void _exhaustive;
      return { pages: [] };
    }
  }
}

function mergeNotePages(
  current: NotePageState[],
  patches: Array<z.infer<typeof notePagePatchSchema>>,
): NotePageState[] {
  const byIndex = new Map<number, NotePageState>();
  for (const page of current) {
    byIndex.set(page.pageIndex, page);
  }
  for (const patch of patches) {
    const prev = byIndex.get(patch.pageIndex);
    const next: NotePageState = {
      pageIndex: patch.pageIndex,
      stage: patch.stage ?? prev?.stage ?? 'skeleton',
      title: patch.title ?? prev?.title,
      body: patch.body ?? prev?.body,
      imageStatus: patch.imageStatus ?? prev?.imageStatus,
      imageRef: patch.imageRef ?? prev?.imageRef,
    };
    byIndex.set(patch.pageIndex, notePageStateSchema.parse(next));
  }
  return [...byIndex.values()].sort((a, b) => a.pageIndex - b.pageIndex);
}

function mergeVideoScenes(
  current: VideoSceneState[],
  patches: Array<z.infer<typeof videoScenePatchSchema>>,
): VideoSceneState[] {
  const byIndex = new Map<number, VideoSceneState>();
  for (const scene of current) {
    byIndex.set(scene.sceneIndex, scene);
  }
  for (const patch of patches) {
    const prev = byIndex.get(patch.sceneIndex);
    const next: VideoSceneState = {
      sceneIndex: patch.sceneIndex,
      storyboard: patch.storyboard ?? prev?.storyboard,
      keyframeStatus: patch.keyframeStatus ?? prev?.keyframeStatus,
      keyframeRef: patch.keyframeRef ?? prev?.keyframeRef,
    };
    byIndex.set(patch.sceneIndex, videoSceneStateSchema.parse(next));
  }
  return [...byIndex.values()].sort((a, b) => a.sceneIndex - b.sceneIndex);
}

function mergeCopyBlocks(
  current: CopyBlockState[],
  patches: CopyBlockState[],
): CopyBlockState[] {
  const byId = new Map<string, CopyBlockState>();
  for (const block of current) {
    byId.set(block.blockId, block);
  }
  for (const patch of patches) {
    const prev = byId.get(patch.blockId);
    byId.set(
      patch.blockId,
      copyBlockStateSchema.parse({
        blockId: patch.blockId,
        role: patch.role ?? prev?.role ?? 'other',
        text: patch.text ?? prev?.text,
        status: patch.status ?? prev?.status,
      }),
    );
  }
  return [...byId.values()];
}

function mergePlanSections(
  current: PlanSectionState[],
  patches: PlanSectionState[],
): PlanSectionState[] {
  const byId = new Map<string, PlanSectionState>();
  for (const section of current) {
    byId.set(section.sectionId, section);
  }
  for (const patch of patches) {
    const prev = byId.get(patch.sectionId);
    byId.set(
      patch.sectionId,
      planSectionStateSchema.parse({
        sectionId: patch.sectionId,
        title: patch.title ?? prev?.title,
        body: patch.body ?? prev?.body,
        status: patch.status ?? prev?.status,
      }),
    );
  }
  return [...byId.values()];
}

function mergePublishItems(
  current: PublishItemState[],
  patches: PublishItemState[],
): PublishItemState[] {
  const byId = new Map<string, PublishItemState>();
  for (const item of current) {
    byId.set(item.itemId, item);
  }
  for (const patch of patches) {
    byId.set(patch.itemId, publishItemStateSchema.parse(patch));
  }
  return [...byId.values()];
}

function applyPatchToBody(
  artifactType: ArtifactType,
  body: ArtifactFullBody,
  patch: ArtifactPatchBody,
): ArtifactFullBody | null {
  if (!patchMatchesType(artifactType, patch)) {
    return null;
  }
  switch (artifactType) {
    case 'note': {
      const current = 'pages' in body ? body.pages : [];
      const pages =
        'pages' in patch && patch.pages
          ? mergeNotePages(current, patch.pages)
          : current;
      return noteArtifactFullSchema.parse({ pages });
    }
    case 'video': {
      const current = 'scenes' in body ? body.scenes : [];
      const scenes =
        'scenes' in patch && patch.scenes
          ? mergeVideoScenes(current, patch.scenes)
          : current;
      const title =
        'title' in patch && patch.title !== undefined
          ? patch.title
          : 'title' in body
            ? body.title
            : undefined;
      return videoArtifactFullSchema.parse({ scenes, title });
    }
    case 'copy': {
      const current = 'blocks' in body ? body.blocks : [];
      const blocks =
        'blocks' in patch && patch.blocks
          ? mergeCopyBlocks(current, patch.blocks)
          : current;
      return copyArtifactFullSchema.parse({ blocks });
    }
    case 'plan': {
      const current = 'sections' in body ? body.sections : [];
      const sections =
        'sections' in patch && patch.sections
          ? mergePlanSections(current, patch.sections)
          : current;
      return planArtifactFullSchema.parse({ sections });
    }
    case 'image': {
      const currentStatus =
        'imageStatus' in body ? body.imageStatus : ('pending' as const);
      const currentRef = 'imageRef' in body ? body.imageRef : undefined;
      const currentCaption = 'caption' in body ? body.caption : undefined;
      return imageArtifactFullSchema.parse({
        imageStatus:
          'imageStatus' in patch && patch.imageStatus
            ? patch.imageStatus
            : currentStatus,
        imageRef:
          'imageRef' in patch && patch.imageRef !== undefined
            ? patch.imageRef
            : currentRef,
        caption:
          'caption' in patch && patch.caption !== undefined
            ? patch.caption
            : currentCaption,
      });
    }
    case 'publish': {
      const current = 'items' in body ? body.items : [];
      const items =
        'items' in patch && patch.items
          ? mergePublishItems(current, patch.items)
          : current;
      return publishArtifactFullSchema.parse({ items });
    }
    default: {
      const _exhaustive: never = artifactType;
      void _exhaustive;
      return null;
    }
  }
}

function archiveIfTerminal(
  state: ArtifactProjectionState,
): ArtifactVersionRecord[] {
  if (state.status !== 'ready' && state.status !== 'failed') {
    return state.versionHistory;
  }
  const already = state.versionHistory.some(
    (entry) => entry.revision === state.revision,
  );
  if (already) return state.versionHistory;
  return [
    ...state.versionHistory,
    {
      revision: state.revision,
      status: state.status,
      body: structuredClone(state.body),
      summary: state.summary,
      parentRevision: state.parentRevision,
    },
  ];
}

/**
 * Pure Artifact reconciliation (V31-15).
 *
 * - same artifactId only (caller keys the map)
 * - same revision → idempotent (duplicate=true)
 * - cold delta with baseRevision=0 bootstraps from the typed empty body
 *   (producer cold-start marker; prevents infinite resync on first frame)
 * - cold delta with baseRevision>0 / baseRevision mismatch → needs_snapshot
 * - ready head advanced without parentRevision → silent_overwrite
 */
export function applyArtifactUpdate(
  current: ArtifactProjectionState | null,
  update: ArtifactUpdateWire,
): ApplyArtifactUpdateResult {
  if (current && current.artifactId !== update.artifactId) {
    return {
      ok: false,
      reason: 'type_mismatch',
      detail: 'artifactId mismatch',
    };
  }
  if (current && current.artifactType !== update.artifactType) {
    return {
      ok: false,
      reason: 'type_mismatch',
      detail: `artifactType ${current.artifactType} vs ${update.artifactType}`,
    };
  }

  // Same revision: idempotent (no silent body rewrite under same revision).
  if (current && update.revision === current.revision) {
    return { ok: true, state: current, duplicate: true };
  }

  // Stale update (lower revision): ignore as duplicate-no-op.
  if (current && update.revision < current.revision) {
    return { ok: true, state: current, duplicate: true };
  }

  // Ready content: advancing requires explicit derived lineage.
  if (
    current &&
    current.status === 'ready' &&
    update.revision > current.revision
  ) {
    if (update.parentRevision !== current.revision) {
      return {
        ok: false,
        reason: 'silent_overwrite',
        detail:
          'ready artifact requires parentRevision=current.revision for derived version',
      };
    }
  }

  if (update.mode === 'delta') {
    if (!current) {
      if (update.baseRevision !== 0) {
        return {
          ok: false,
          reason: 'needs_snapshot',
          detail: 'delta without local head',
        };
      }
      // Cold-start delta: baseRevision=0 is the producer's explicit bootstrap
      // marker for the first frame of a fresh artifact. Apply the patch onto
      // the typed empty body — the same projection a full replay would build
      // for the first event — so a cold client converges instead of looping
      // on needs_snapshot.
      const nextBody = applyPatchToBody(
        update.artifactType,
        emptyBodyForType(update.artifactType),
        update.patch,
      );
      if (!nextBody) {
        return {
          ok: false,
          reason: 'invalid_patch',
          detail: 'patch failed for artifactType',
        };
      }
      return {
        ok: true,
        duplicate: false,
        state: {
          artifactId: update.artifactId,
          artifactType: update.artifactType,
          revision: update.revision,
          status: update.status,
          body: nextBody,
          summary: update.summary,
          parentRevision: update.parentRevision,
          versionHistory: [],
        },
      };
    }
    if (update.baseRevision !== current.revision) {
      return {
        ok: false,
        reason: 'needs_snapshot',
        detail: `baseRevision ${update.baseRevision} != head ${current.revision}`,
      };
    }
    const nextBody = applyPatchToBody(
      update.artifactType,
      current.body,
      update.patch,
    );
    if (!nextBody) {
      return {
        ok: false,
        reason: 'invalid_patch',
        detail: 'patch failed for artifactType',
      };
    }
    const versionHistory = archiveIfTerminal(current);
    return {
      ok: true,
      duplicate: false,
      state: {
        artifactId: update.artifactId,
        artifactType: update.artifactType,
        revision: update.revision,
        status: update.status,
        body: nextBody,
        summary: update.summary ?? current.summary,
        parentRevision: update.parentRevision,
        versionHistory,
      },
    };
  }

  // snapshot
  if (!fullMatchesType(update.artifactType, update.full)) {
    return {
      ok: false,
      reason: 'type_mismatch',
      detail: 'snapshot full mismatch',
    };
  }
  const versionHistory = current ? archiveIfTerminal(current) : [];
  return {
    ok: true,
    duplicate: false,
    state: {
      artifactId: update.artifactId,
      artifactType: update.artifactType,
      revision: update.revision,
      status: update.status,
      body: structuredClone(update.full),
      summary: update.summary,
      parentRevision: update.parentRevision,
      versionHistory,
    },
  };
}

/** Helper for cold start skeleton without a wire event. */
export function createEmptyArtifactProjection(
  artifactId: string,
  artifactType: ArtifactType,
): ArtifactProjectionState {
  return {
    artifactId,
    artifactType,
    revision: 0,
    status: 'skeleton',
    body: emptyBodyForType(artifactType),
    versionHistory: [],
  };
}

/**
 * Stable-id uniqueness metric: duplicate object rate among a projection map.
 * Acceptance: must be 0 (one entry per artifactId).
 */
export function artifactDuplicateObjectRate(
  artifacts: Readonly<Record<string, ArtifactProjectionState>>,
): number {
  const ids = Object.values(artifacts).map((item) => item.artifactId);
  if (ids.length === 0) return 0;
  const unique = new Set(ids);
  // Map keyed by artifactId ⇒ unique.size === ids.length always when well-formed.
  // Also count key≠artifactId mismatches as duplicates for the gate.
  let mismatches = 0;
  for (const [key, value] of Object.entries(artifacts)) {
    if (key !== value.artifactId) mismatches += 1;
  }
  const idDupes = ids.length - unique.size;
  return (idDupes + mismatches) / ids.length;
}

