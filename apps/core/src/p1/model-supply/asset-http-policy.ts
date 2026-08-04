export const MAX_CANVAS_ASSET_UPLOAD_BYTES = 25 * 1024 * 1024;

export interface AssetHttpPolicyPort {
  assertOwnedBy(input: {
    objectKey: string;
    workspaceId: string | string[] | undefined;
  }): void;
  readonly maxUploadBytes: number;
}

export function assertAssetOwnedBy(input: {
  objectKey: string;
  workspaceId: string | string[] | undefined;
}) {
  if (
    typeof input.workspaceId !== 'string' ||
    !input.objectKey.startsWith(`${input.workspaceId}/`)
  ) {
    throw new AssetWorkspaceForbiddenError();
  }
}

export class AssetWorkspaceForbiddenError extends Error {
  readonly code = 'ASSET_WORKSPACE_FORBIDDEN';
  readonly status = 403;

  constructor() {
    super('Asset does not belong to the active workspace.');
  }
}

export function assetHttpPolicyFor(
  storage: Partial<AssetHttpPolicyPort>
): AssetHttpPolicyPort {
  return {
    assertOwnedBy: storage.assertOwnedBy
      ? storage.assertOwnedBy.bind(storage)
      : assertAssetOwnedBy,
    maxUploadBytes: storage.maxUploadBytes ?? MAX_CANVAS_ASSET_UPLOAD_BYTES,
  };
}
