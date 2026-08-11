/**
 * Whole-set adopt atomicity (D-087 / WT-D2 / #100).
 *
 * Consumes B1 visual-adoption contracts: adopt_set compiles to one
 * first_adopt / revise_content_package_visuals write with the full ordered
 * list. Partial success of a generation run may keep candidates for retry,
 * but MUST NOT partially adopt into ContentPackage.
 */

import type { VisualAdoptionRoleAction } from '@meiye/contracts';

import { toVisualAdoptionRoleAction } from './image-role-action-matrix';
import type { WorkingSelectionState } from './working-selection-reducer';
import { workingSelectionAdoptPayload } from './working-selection-reducer';

// ---------------------------------------------------------------------------
// Validation before submit
// ---------------------------------------------------------------------------

export type WholeSetAdoptRejectionCode =
  | 'EMPTY_SELECTION'
  | 'MISSING_ASSET'
  | 'DUPLICATE_ASSET'
  | 'RIGHTS_REVOKED'
  | 'NOT_PERSISTED'
  | 'REVISION_STALE'
  | 'PARTIAL_SET_FORBIDDEN';

export type WholeSetAdoptCandidate = {
  assetId: string;
  /** Durable object exists (not a temp provider URL). */
  persisted: boolean;
  /** Rights still grant use. */
  rightsOk: boolean;
  /** Optional: generation slot succeeded for this asset. */
  generationOk?: boolean;
};

export type WholeSetAdoptValidation =
  | {
      kind: 'ok';
      orderedAssetIds: string[];
      coverAssetId: string;
      roleAction: Extract<VisualAdoptionRoleAction, { kind: 'adopt_set' }>;
    }
  | {
      kind: 'rejected';
      code: WholeSetAdoptRejectionCode;
      message: string;
      /** Assets that failed checks — whole set still not written. */
      failedAssetIds: string[];
    };

/**
 * Validate the full working selection for atomic adopt_set.
 * Any single failure rejects the entire set — zero partial writes.
 */
export function validateWholeSetAdopt(input: {
  selection: WorkingSelectionState;
  candidates: readonly WholeSetAdoptCandidate[];
  /** Live package revision; must match selection.baseRevisionId when package exists. */
  currentRevisionId?: string;
  /** When true, baseRevisionId must equal currentRevisionId. */
  requireRevisionMatch?: boolean;
}): WholeSetAdoptValidation {
  const payload = workingSelectionAdoptPayload(input.selection);
  if (!payload || payload.assetIds.length === 0) {
    return {
      kind: 'rejected',
      code: 'EMPTY_SELECTION',
      message: '套图为空，无法采用。',
      failedAssetIds: [],
    };
  }

  if (new Set(payload.assetIds).size !== payload.assetIds.length) {
    return {
      kind: 'rejected',
      code: 'DUPLICATE_ASSET',
      message: '套图含重复图片，无法采用。',
      failedAssetIds: payload.assetIds.filter(
        (id, i, arr) => arr.indexOf(id) !== i
      ),
    };
  }

  if (
    input.requireRevisionMatch &&
    input.currentRevisionId !== undefined &&
    input.selection.baseRevisionId !== input.currentRevisionId
  ) {
    return {
      kind: 'rejected',
      code: 'REVISION_STALE',
      message: '内容版本已更新，请比较后重新确认套图。',
      failedAssetIds: [],
    };
  }

  const byId = new Map(input.candidates.map((c) => [c.assetId, c]));
  const failed: { id: string; code: WholeSetAdoptRejectionCode }[] = [];

  for (const assetId of payload.assetIds) {
    const candidate = byId.get(assetId);
    if (!candidate) {
      failed.push({ id: assetId, code: 'MISSING_ASSET' });
      continue;
    }
    if (!candidate.persisted) {
      failed.push({ id: assetId, code: 'NOT_PERSISTED' });
      continue;
    }
    if (!candidate.rightsOk) {
      failed.push({ id: assetId, code: 'RIGHTS_REVOKED' });
      continue;
    }
    if (candidate.generationOk === false) {
      failed.push({ id: assetId, code: 'PARTIAL_SET_FORBIDDEN' });
    }
  }

  if (failed.length > 0) {
    // Prefer the most specific first failure code for the rejection.
    const code = failed[0]!.code;
    return {
      kind: 'rejected',
      code,
      message:
        code === 'PARTIAL_SET_FORBIDDEN'
          ? '套图含未完成生成的图片，不得部分采用。请重试失败项后再采用整组。'
          : '套图中有图片不可用，整组采用已拒绝，未写入任何变更。',
      failedAssetIds: failed.map((f) => f.id),
    };
  }

  const roleAction = toVisualAdoptionRoleAction(
    'adopt_set',
    payload.assetIds[0]!,
    payload.assetIds
  );
  if (!roleAction || roleAction.kind !== 'adopt_set') {
    return {
      kind: 'rejected',
      code: 'EMPTY_SELECTION',
      message: '无法编译采用命令。',
      failedAssetIds: [],
    };
  }

  return {
    kind: 'ok',
    orderedAssetIds: payload.assetIds,
    coverAssetId: payload.coverAssetId ?? payload.assetIds[0]!,
    roleAction,
  };
}

/**
 * Assert that a generation partial-success set is NOT adoptable.
 * Used by tests and UI guards: partial candidates may be viewed / retried,
 * but adopt_set validation must reject.
 */
export function assertNoPartialAdopt(input: {
  selection: WorkingSelectionState;
  /** Asset ids that succeeded generation. */
  succeededAssetIds: readonly string[];
  /** Asset ids that failed or are still running. */
  failedOrPendingAssetIds: readonly string[];
}): WholeSetAdoptValidation {
  const candidates: WholeSetAdoptCandidate[] = [
    ...input.succeededAssetIds.map((assetId) => ({
      assetId,
      persisted: true,
      rightsOk: true,
      generationOk: true,
    })),
    ...input.failedOrPendingAssetIds.map((assetId) => ({
      assetId,
      persisted: true,
      rightsOk: true,
      generationOk: false,
    })),
  ];
  return validateWholeSetAdopt({
    selection: input.selection,
    candidates,
  });
}

/**
 * Build the single atomic write command payload for OperationsVisualAdoptionPort.
 * Call only after validateWholeSetAdopt returns ok.
 */
export type WholeSetAdoptWriteCommand =
  | {
      family: 'first_adopt';
      orderedVisualAssetIds: string[];
      roleAction: 'adopt_set';
      workId: string;
      idempotencyKey: string;
    }
  | {
      family: 'revise_content_package_visuals';
      orderedVisualAssetIds: string[];
      roleAction: 'adopt_set';
      packageId: string;
      baseVersionId: string;
      expectedRevision: number;
      idempotencyKey: string;
    };

export function buildWholeSetAdoptWriteCommand(input: {
  orderedAssetIds: string[];
  workId: string;
  idempotencyKey: string;
  /** Present when package already exists. */
  package?: {
    packageId: string;
    baseVersionId: string;
    expectedRevision: number;
  };
}): WholeSetAdoptWriteCommand {
  if (input.package) {
    return {
      family: 'revise_content_package_visuals',
      orderedVisualAssetIds: [...input.orderedAssetIds],
      roleAction: 'adopt_set',
      packageId: input.package.packageId,
      baseVersionId: input.package.baseVersionId,
      expectedRevision: input.package.expectedRevision,
      idempotencyKey: input.idempotencyKey,
    };
  }
  return {
    family: 'first_adopt',
    orderedVisualAssetIds: [...input.orderedAssetIds],
    roleAction: 'adopt_set',
    workId: input.workId,
    idempotencyKey: input.idempotencyKey,
  };
}
