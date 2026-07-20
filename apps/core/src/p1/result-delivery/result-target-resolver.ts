/**
 * ResultTargetResolver (D-089 / D-091 / D-098 C4 / #94 / B4).
 *
 * Validates workId lineage and optional contentId/versionId/panel/focusKey.
 * Readonly legacy branch returns 历史档案 — never guesses latest Work.
 * Forbidden when unauthorized. Lineage mismatch is recoverable (not silent fallback).
 */

import {
  LEGACY_ARCHIVE_LABEL,
  resultPanels,
  type ResultPanel,
  type ResultTarget,
  type ResultTargetResolveOutcome,
} from '@meiye/contracts';

/** Work record facts the resolver needs (projection input — not a new table). */
export type ResolverWorkRecord = {
  workId: string;
  workspaceId: string;
  /**
   * ContentPackage ids owned by / produced from this Work.
   * Empty when the Work has no adopted content yet.
   */
  contentIds: readonly string[];
  /**
   * Immutable version ids keyed by contentId.
   * Missing contentId key → no versions known for that package.
   */
  versionIdsByContentId: Readonly<Record<string, readonly string[]>>;
  /**
   * focusKey values that belong to this Work (semantic, not DOM).
   * When undefined, any focusKey is accepted (panel-only validation).
   */
  allowedFocusKeys?: readonly string[];
  /** When true, Work is a legacy_import compatibility anchor (future write path). */
  origin?: 'native' | 'legacy_import';
};

/** Legacy ContentPackage without a resolvable source Work (D-091 first-ship). */
export type ResolverLegacyPackage = {
  contentId: string;
  workspaceId: string;
  versionIds: readonly string[];
  /** Explicit marker that no source Work exists. */
  hasSourceWork: false;
};

export type ResolveResultTargetInput = {
  request: ResultTarget;
  viewer: {
    userId: string;
    workspaceId: string;
  };
  /** Workspace membership check result for viewer.workspaceId. */
  hasMembership: boolean;
  /**
   * Works visible in the viewer workspace.
   * Resolver never picks "latest" when request.workId is missing/invalid.
   */
  works: readonly ResolverWorkRecord[];
  /**
   * Pre-lineage ContentPackages (no source Work).
   * Used only for the readonly 历史档案 branch.
   */
  legacyPackages?: readonly ResolverLegacyPackage[];
};

function isResultPanel(value: string | undefined): value is ResultPanel {
  return (
    value !== undefined &&
    (resultPanels as readonly string[]).includes(value)
  );
}

/**
 * Resolve a Result Center target against lineage + membership.
 * Pure function — callers supply already-loaded catalog facts.
 */
export function resolveResultTarget(
  input: ResolveResultTargetInput,
): ResultTargetResolveOutcome {
  const { request, viewer, hasMembership } = input;

  if (!hasMembership) {
    return {
      kind: 'forbidden',
      code: 'FORBIDDEN',
      message: 'Viewer is not a member of the requested workspace.',
      requested: request,
    };
  }

  // Legacy readonly branch: no workId, contentId points at pre-lineage package.
  if (!request.workId || request.workId.trim() === '') {
    return resolveLegacyReadonly(input);
  }

  const work = input.works.find((row) => row.workId === request.workId);
  if (!work) {
    // contentId alone on a missing work must NOT fall back to latest work.
    // If contentId is a known legacy package, return 历史档案 instead of not_found.
    if (request.contentId) {
      const legacy = (input.legacyPackages ?? []).find(
        (pkg) =>
          pkg.contentId === request.contentId &&
          pkg.workspaceId === viewer.workspaceId,
      );
      if (legacy) {
        return legacyReadonlyOutcome(legacy, request.versionId);
      }
    }
    return {
      kind: 'not_found',
      code: 'NOT_FOUND',
      message: 'Work was not found for the requested workId.',
      requested: request,
    };
  }

  if (work.workspaceId !== viewer.workspaceId) {
    return {
      kind: 'forbidden',
      code: 'FORBIDDEN',
      message: 'Work does not belong to the viewer workspace.',
      requested: request,
    };
  }

  if (request.panel !== undefined && !isResultPanel(request.panel)) {
    return {
      kind: 'lineage_mismatch',
      code: 'LINEAGE_MISMATCH',
      recoverable: true,
      message: `Unknown panel "${String(request.panel)}".`,
      requested: request,
    };
  }

  if (request.contentId) {
    if (!work.contentIds.includes(request.contentId)) {
      return {
        kind: 'lineage_mismatch',
        code: 'LINEAGE_MISMATCH',
        recoverable: true,
        message:
          'contentId does not belong to the requested Work lineage.',
        requested: request,
      };
    }

    if (request.versionId) {
      const versions = work.versionIdsByContentId[request.contentId] ?? [];
      if (!versions.includes(request.versionId)) {
        return {
          kind: 'lineage_mismatch',
          code: 'LINEAGE_MISMATCH',
          recoverable: true,
          message:
            'versionId does not belong to the requested contentId lineage.',
          requested: request,
        };
      }
    }
  } else if (request.versionId) {
    // versionId without contentId cannot be validated against lineage.
    return {
      kind: 'lineage_mismatch',
      code: 'LINEAGE_MISMATCH',
      recoverable: true,
      message: 'versionId requires contentId for lineage validation.',
      requested: request,
    };
  }

  if (
    request.focusKey &&
    work.allowedFocusKeys &&
    !work.allowedFocusKeys.includes(request.focusKey)
  ) {
    return {
      kind: 'lineage_mismatch',
      code: 'LINEAGE_MISMATCH',
      recoverable: true,
      message: 'focusKey is not owned by the requested Work.',
      requested: request,
    };
  }

  return {
    kind: 'ok',
    target: {
      workId: work.workId,
      ...(request.contentId ? { contentId: request.contentId } : {}),
      ...(request.versionId ? { versionId: request.versionId } : {}),
      ...(request.panel ? { panel: request.panel } : {}),
      ...(request.focusKey ? { focusKey: request.focusKey } : {}),
    },
    mode: 'active',
    workspaceId: work.workspaceId,
  };
}

function resolveLegacyReadonly(
  input: ResolveResultTargetInput,
): ResultTargetResolveOutcome {
  const contentId = input.request.contentId;
  if (!contentId) {
    return {
      kind: 'not_found',
      code: 'NOT_FOUND',
      message:
        'Result target requires workId, or contentId for legacy archive.',
      requested: input.request,
    };
  }

  const legacy = (input.legacyPackages ?? []).find(
    (pkg) =>
      pkg.contentId === contentId &&
      pkg.workspaceId === input.viewer.workspaceId,
  );

  if (!legacy) {
    return {
      kind: 'not_found',
      code: 'NOT_FOUND',
      message: 'Legacy ContentPackage was not found.',
      requested: input.request,
    };
  }

  return legacyReadonlyOutcome(legacy, input.request.versionId);
}

function legacyReadonlyOutcome(
  legacy: ResolverLegacyPackage,
  versionId: string | undefined,
): ResultTargetResolveOutcome {
  if (versionId && !legacy.versionIds.includes(versionId)) {
    return {
      kind: 'lineage_mismatch',
      code: 'LINEAGE_MISMATCH',
      recoverable: true,
      message:
        'versionId does not belong to the legacy ContentPackage archive.',
      requested: {
        workId: '',
        contentId: legacy.contentId,
        versionId,
      },
    };
  }

  return {
    kind: 'legacy_readonly',
    contentId: legacy.contentId,
    archiveLabel: LEGACY_ARCHIVE_LABEL,
    workspaceId: legacy.workspaceId,
    ...(versionId ? { versionId } : {}),
  };
}
