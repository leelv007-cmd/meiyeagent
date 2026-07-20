import type { VisualAdoptionRoleAction } from '@meiye/contracts';

/**
 * Target of a role action: first package creation vs OCC revise of an adopted package.
 */
export type VisualAdoptionTarget =
  | { mode: 'first_adopt' }
  | {
      mode: 'revise';
      baseVersionId: string;
      currentOrderedVisualAssetIds: string[];
      expectedRevision: number;
      packageId: string;
    };

/**
 * All server write paths compile into one command family:
 * first_adopt | revise_content_package_visuals.
 * Local working-selection actions never hit the server write chain.
 */
export type CompiledVisualAdoptionCommand =
  | {
      family: 'first_adopt';
      orderedVisualAssetIds: string[];
      roleAction: Exclude<VisualAdoptionRoleAction['kind'], 'add_to_set'>;
    }
  | {
      family: 'revise_content_package_visuals';
      baseVersionId: string;
      expectedRevision: number;
      orderedVisualAssetIds: string[];
      packageId: string;
      roleAction: Exclude<VisualAdoptionRoleAction['kind'], 'add_to_set'>;
    }
  | {
      family: 'local_working_selection';
      assetId: string;
      roleAction: 'add_to_set';
    };

function orderedIdsForAction(
  action: Exclude<VisualAdoptionRoleAction, { kind: 'add_to_set' }>,
  currentOrdered: string[],
): string[] {
  switch (action.kind) {
    case 'adopt_one':
      return [action.assetId];
    case 'set_primary':
    case 'set_cover': {
      // image_text: index 0 is cover/primary — no separate Cover entity.
      const rest = currentOrdered.filter((id) => id !== action.assetId);
      return [action.assetId, ...rest];
    }
    case 'adopt_set':
    case 'replace_set':
      return [...action.assetIds];
  }
}

/**
 * Compile a role-facing action into the unified visual-adoption write chain.
 * add_to_set stays local; all other actions produce first_adopt or revise.
 */
export function compileVisualAdoptionRoleAction(
  action: VisualAdoptionRoleAction,
  target: VisualAdoptionTarget,
): CompiledVisualAdoptionCommand {
  if (action.kind === 'add_to_set') {
    return {
      assetId: action.assetId,
      family: 'local_working_selection',
      roleAction: 'add_to_set',
    };
  }

  const currentOrdered =
    target.mode === 'revise' ? target.currentOrderedVisualAssetIds : [];
  const orderedVisualAssetIds = orderedIdsForAction(action, currentOrdered);

  if (target.mode === 'first_adopt') {
    return {
      family: 'first_adopt',
      orderedVisualAssetIds,
      roleAction: action.kind,
    };
  }

  return {
    baseVersionId: target.baseVersionId,
    expectedRevision: target.expectedRevision,
    family: 'revise_content_package_visuals',
    orderedVisualAssetIds,
    packageId: target.packageId,
    roleAction: action.kind,
  };
}

/** Server write command family names used by visual adoption. */
export const VISUAL_ADOPTION_WRITE_FAMILIES = [
  'first_adopt',
  'revise_content_package_visuals',
] as const;
