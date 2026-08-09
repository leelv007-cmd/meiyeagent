/**
 * V31-15 Controlled Surface registrations for Artifact rail (V3.1 §28.4).
 * Import this module for side-effect registration before mounting Artifact UI.
 */

import { registerAgentSurface } from '../controlled-surface-registry';

export const ARTIFACT_SURFACE_KEYS = [
  'artifact_canvas',
  'artifact_note',
  'artifact_video',
  'artifact_copy',
  'artifact_plan',
  'artifact_image',
  'artifact_publish',
] as const;

export type ArtifactSurfaceKey = (typeof ARTIFACT_SURFACE_KEYS)[number];

const SHARED_ARTIFACT_PROPS = [
  'artifactId',
  'artifactType',
  'revision',
  'status',
  'summary',
  'parentRevision',
  'viewingRevision',
  'streamOffset',
] as const;

let registered = false;

/** Idempotent: safe to call from module load and tests. */
export function registerArtifactSurfaces(): void {
  if (registered) return;
  registered = true;

  registerAgentSurface('artifact_canvas', {
    allowedPropKeys: [
      'artifactId',
      'artifactCount',
      'viewport',
      'selectedArtifactId',
    ],
  });

  registerAgentSurface('artifact_note', {
    allowedPropKeys: [...SHARED_ARTIFACT_PROPS, 'pageCount', 'pages'],
  });

  registerAgentSurface('artifact_video', {
    allowedPropKeys: [
      ...SHARED_ARTIFACT_PROPS,
      'sceneCount',
      'scenes',
      'title',
    ],
  });

  registerAgentSurface('artifact_copy', {
    allowedPropKeys: [...SHARED_ARTIFACT_PROPS, 'blockCount', 'blocks'],
  });

  registerAgentSurface('artifact_plan', {
    allowedPropKeys: [...SHARED_ARTIFACT_PROPS, 'sectionCount', 'sections'],
  });

  registerAgentSurface('artifact_image', {
    allowedPropKeys: [
      ...SHARED_ARTIFACT_PROPS,
      'imageStatus',
      'imageRef',
      'caption',
    ],
  });

  registerAgentSurface('artifact_publish', {
    allowedPropKeys: [...SHARED_ARTIFACT_PROPS, 'itemCount', 'items'],
  });
}

/** Test seam: allow re-register after registry reset. */
export function __resetArtifactSurfaceRegistrationForTests(): void {
  registered = false;
}

// Production side-effect: register when the artifact module is imported.
registerArtifactSurfaces();
