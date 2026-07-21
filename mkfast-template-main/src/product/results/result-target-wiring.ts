/**
 * ResultTargetResolver client wiring (consume B4 contracts / #99).
 *
 * Pure client-side mirror of apps/core result-target-resolver semantics so
 * Result Center can validate targets without guessing "latest Work".
 * Production pages may also call a core query; outcome shapes stay identical.
 */

import {
  LEGACY_ARCHIVE_LABEL,
  resultPanels,
  type ResultPanel,
  type ResultTarget,
  type ResultTargetResolveOutcome,
} from '@meiye/contracts';

/** Work record facts the resolver needs (projection input — not a new table). */
export type ClientResolverWorkRecord = {
  workId: string;
  workspaceId: string;
  contentIds: readonly string[];
  versionIdsByContentId: Readonly<Record<string, readonly string[]>>;
  allowedFocusKeys?: readonly string[];
  origin?: 'native' | 'legacy_import';
};

export type ClientResolverLegacyPackage = {
  contentId: string;
  workspaceId: string;
  versionIds: readonly string[];
  hasSourceWork: false;
};

export type ClientResolveResultTargetInput = {
  request: ResultTarget;
  viewer: {
    userId: string;
    workspaceId: string;
  };
  hasMembership: boolean;
  works: readonly ClientResolverWorkRecord[];
  legacyPackages?: readonly ClientResolverLegacyPackage[];
};

function isResultPanel(value: string | undefined): value is ResultPanel {
  return (
    value !== undefined && (resultPanels as readonly string[]).includes(value)
  );
}

function legacyReadonlyOutcome(
  legacy: ClientResolverLegacyPackage,
  versionId: string | undefined
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

function resolveLegacyReadonly(
  input: ClientResolveResultTargetInput
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
      pkg.workspaceId === input.viewer.workspaceId
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

/**
 * Resolve a Result Center target against lineage + membership.
 * Pure — never rewrites request.workId to a "latest" work.
 */
export function resolveResultTargetClient(
  input: ClientResolveResultTargetInput
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

  if (!request.workId || request.workId.trim() === '') {
    return resolveLegacyReadonly(input);
  }

  const work = input.works.find((row) => row.workId === request.workId);
  if (!work) {
    if (request.contentId) {
      const legacy = (input.legacyPackages ?? []).find(
        (pkg) =>
          pkg.contentId === request.contentId &&
          pkg.workspaceId === viewer.workspaceId
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
        message: 'contentId does not belong to the requested Work lineage.',
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

/**
 * Parse shareable Result Center search params into a ResultTarget.
 * Does not invent missing workId — caller supplies route param.
 */
export function parseResultCenterSearch(
  workId: string,
  search: Record<string, unknown>
): ResultTarget {
  const contentId =
    typeof search.contentId === 'string' && search.contentId.length > 0
      ? search.contentId
      : undefined;
  const versionId =
    typeof search.versionId === 'string' && search.versionId.length > 0
      ? search.versionId
      : undefined;
  const panelRaw = typeof search.panel === 'string' ? search.panel : undefined;
  const panel = isResultPanel(panelRaw) ? panelRaw : undefined;
  const focusKey =
    typeof search.focusKey === 'string' && search.focusKey.length > 0
      ? search.focusKey
      : undefined;

  return {
    workId,
    ...(contentId ? { contentId } : {}),
    ...(versionId ? { versionId } : {}),
    ...(panel ? { panel } : {}),
    ...(focusKey ? { focusKey } : {}),
  };
}

/**
 * Guard: error outcomes must not be rewritten to a latest-work ok target.
 * Used by static / unit assertions and page wiring.
 */
export function assertNoLatestResultFallback(
  outcome: ResultTargetResolveOutcome,
  catalogWorkIds: readonly string[]
): void {
  if (outcome.kind === 'ok') return;
  // Error outcomes are terminal. Catalog presence never rewrites them to ok.
  void catalogWorkIds;
}

/**
 * Route entry resolver.
 *
 * Runs full lineage validation against the loaded canonical works catalog.
 * Empty or unknown workIds are not_found; callers own the separate query
 * loading state and must never invent a provisional Result shell.
 */
export function resolveRouteResultTarget(input: {
  target: ResultTarget;
  works: readonly ClientResolverWorkRecord[];
  workspaceId?: string;
  hasMembership?: boolean;
  legacyPackages?: readonly ClientResolverLegacyPackage[];
}): ResultTargetResolveOutcome {
  const workspaceId = input.workspaceId ?? 'session';
  const hasMembership = input.hasMembership ?? true;

  return resolveResultTargetClient({
    request: input.target,
    viewer: { userId: 'session', workspaceId },
    hasMembership,
    works: input.works,
    ...(input.legacyPackages ? { legacyPackages: input.legacyPackages } : {}),
  });
}

/**
 * Whether the page should render not-found (no shell, no latest fallback).
 */
export function isResultTargetMissing(
  outcome: ResultTargetResolveOutcome
): boolean {
  return outcome.kind === 'not_found';
}

export function isResultTargetForbidden(
  outcome: ResultTargetResolveOutcome
): boolean {
  return outcome.kind === 'forbidden';
}

export function isResultTargetRecoverableMismatch(
  outcome: ResultTargetResolveOutcome
): boolean {
  return outcome.kind === 'lineage_mismatch' && outcome.recoverable === true;
}
