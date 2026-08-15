import type { Asset, CommandResult, ProductCommand } from '@meiye/contracts';

import {
  asset_capture_already_registered,
  asset_capture_upload_failed,
  asset_capture_upload_not_retryable,
  composer_image_already_registered,
  composer_image_upload_failed,
  composer_image_upload_not_retryable,
} from '@/locale/paraglide/messages';
import { P1RequestError, p1ErrorCode } from '@/p1/client';
import { canonicalJsonString } from '@/p1/canonical-json';

type AddAssetCommand = Extract<ProductCommand, { type: 'add_asset' }>;
type AddAssetInput = AddAssetCommand['asset'];

export type AssetRegistrationSurface = 'composer' | 'library';

export type AssetRegistrationFailureKind =
  | 'already_registered'
  | 'not_retryable'
  | 'retryable';

export interface AssetRegistrationFailure {
  kind: AssetRegistrationFailureKind;
  message: string;
  outlet: 'library_picker' | 'asset_detail' | null;
  retryable: boolean;
}

export function workspaceAssetIdForContent(contentHash: string): string {
  return `asset-${contentHash.slice(0, 32)}`;
}

export function findWorkspaceAssetByObjectKey(
  assets: readonly Pick<Asset, 'id' | 'objectKey'>[] | undefined,
  objectKey: string
) {
  return assets?.find((asset) => asset.objectKey === objectKey);
}

export function assetRegistrationFacts(asset: AddAssetInput) {
  const { id: _id, ...facts } = asset;
  return facts;
}

export async function assetRegistrationIdempotencyKey(
  contentHash: string,
  asset: AddAssetInput
): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(
      canonicalJsonString({
        contentHash,
        ...assetRegistrationFacts(asset),
      })
    )
  );
  const fingerprint = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
  return `asset-register:${contentHash}:${fingerprint}`;
}

export function classifyAssetRegistrationFailure(
  error: unknown
): AssetRegistrationFailureKind {
  const code = p1ErrorCode(error);
  if (code === 'IDEMPOTENCY_CONFLICT') return 'already_registered';
  const status = error instanceof P1RequestError ? error.status : undefined;
  if (status !== undefined && status >= 400 && status < 500) {
    return 'not_retryable';
  }
  return 'retryable';
}

export function presentAssetRegistrationFailure(
  error: unknown,
  surface: AssetRegistrationSurface
): AssetRegistrationFailure {
  const kind = classifyAssetRegistrationFailure(error);
  if (kind === 'already_registered') {
    return {
      kind,
      message:
        surface === 'composer'
          ? composer_image_already_registered()
          : asset_capture_already_registered(),
      outlet: surface === 'composer' ? 'library_picker' : 'asset_detail',
      retryable: false,
    };
  }
  if (kind === 'not_retryable') {
    return {
      kind,
      message:
        surface === 'composer'
          ? composer_image_upload_not_retryable()
          : asset_capture_upload_not_retryable(),
      outlet: null,
      retryable: false,
    };
  }
  return {
    kind,
    message:
      surface === 'composer'
        ? composer_image_upload_failed()
        : asset_capture_upload_failed(),
    outlet: null,
    retryable: true,
  };
}

export async function registerWorkspaceAsset(input: {
  contentHash: string;
  execute: (
    command: ProductCommand,
    idempotencyKey?: string
  ) => Promise<CommandResult | undefined>;
  facts: Omit<AddAssetInput, 'id' | 'objectKey'>;
  objectKey: string;
  preferredAssetId?: string;
}): Promise<{ assetId: string }> {
  const asset: AddAssetInput = {
    id: input.preferredAssetId ?? workspaceAssetIdForContent(input.contentHash),
    objectKey: input.objectKey,
    ...input.facts,
  };
  const result = await input.execute(
    { type: 'add_asset', asset },
    await assetRegistrationIdempotencyKey(input.contentHash, asset)
  );
  const resolved = findWorkspaceAssetByObjectKey(
    result?.state.assets,
    input.objectKey
  );
  if (!resolved) {
    throw new Error('Asset registration did not produce a workspace asset.');
  }
  return { assetId: resolved.id };
}
