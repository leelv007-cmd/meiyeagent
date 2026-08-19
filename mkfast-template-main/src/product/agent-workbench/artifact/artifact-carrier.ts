/**
 * copy|note|media carriers cover the four product paths (copy / note / image / video).
 * Plan and publish are workstream objects, not ContentPackage carriers.
 */

import type { ArtifactType } from '@meiye/contracts';

export type ArtifactContentCarrier = 'copy' | 'note' | 'media';

export function artifactContentCarrierOf(
  artifactType: ArtifactType
): ArtifactContentCarrier | null {
  switch (artifactType) {
    case 'copy':
      return 'copy';
    case 'note':
      return 'note';
    case 'image':
    case 'video':
      return 'media';
    case 'plan':
    case 'publish':
      return null;
    default: {
      const _exhaustive: never = artifactType;
      void _exhaustive;
      return null;
    }
  }
}
