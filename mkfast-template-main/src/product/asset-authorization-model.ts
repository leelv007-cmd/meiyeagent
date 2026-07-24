import type { Asset, Platform, ProductCommand } from '@meiye/contracts';

type UpdateAssetMetadataCommand = Extract<
  ProductCommand,
  { type: 'update_asset_metadata' }
>;
type AuthorizeAssetCommand = Extract<
  ProductCommand,
  { type: 'authorize_asset' }
>;

export async function assetAuthorizationIdempotencyKey(
  command: AuthorizeAssetCommand
): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(command))
  );
  const fingerprint = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
  return `asset-authorize:${fingerprint}`;
}

export interface AssetAuthorizationDraft {
  assetId: string;
  category: NonNullable<Asset['category']>;
  consentScope: Asset['consentScope'];
  containsPerson: boolean;
  containsSensitiveData: boolean;
  minorStatus: Asset['minorStatus'];
  rightsEvidence?: string;
  rightsNoFixedExpiry?: boolean;
  rightsOwner: string;
  rightsPlatforms?: readonly Platform[];
  rightsValidUntil?: string;
  systemEvidence?: SystemEvidencePointerInput;
  tags: readonly string[];
}

export interface SystemEvidencePointerInput {
  context: 'asset-library' | 'composer';
  nonce: string;
}

export function systemInlineAuthEvidence(
  input: SystemEvidencePointerInput
): string {
  const nonce = input.nonce.trim();
  if (!nonce) throw new Error('System evidence requires a stable nonce.');
  return `system:inline-auth:${input.context}:${encodeURIComponent(nonce)}`;
}

export function assetAuthorizationCommands(
  draft: AssetAuthorizationDraft
): readonly [UpdateAssetMetadataCommand, AuthorizeAssetCommand] {
  const externalEvidence = draft.rightsEvidence?.trim();
  const rightsEvidence =
    externalEvidence ||
    (draft.consentScope !== 'internal_only' && draft.systemEvidence
      ? systemInlineAuthEvidence(draft.systemEvidence)
      : undefined);
  if (draft.consentScope !== 'internal_only' && !rightsEvidence) {
    throw new Error('Public authorization requires stable system evidence.');
  }
  return [
    {
      type: 'update_asset_metadata',
      assetId: draft.assetId,
      category: draft.category,
      tags: [...draft.tags],
      rightsOwner: draft.rightsOwner,
      containsPerson: draft.containsPerson,
      containsSensitiveData: draft.containsSensitiveData,
      minorStatus: draft.minorStatus,
    },
    {
      type: 'authorize_asset',
      assetId: draft.assetId,
      consentScope: draft.consentScope,
      rightsEvidence,
      rightsNoFixedExpiry: draft.rightsNoFixedExpiry,
      rightsPlatforms: draft.rightsPlatforms
        ? [...draft.rightsPlatforms]
        : undefined,
      rightsValidUntil: draft.rightsValidUntil,
    },
  ];
}

export async function executeAssetAuthorization<Result>(
  execute: (command: ProductCommand) => Promise<Result>,
  draft: AssetAuthorizationDraft
) {
  const [metadata, authorization] = assetAuthorizationCommands(draft);
  await execute(metadata);
  return execute(authorization);
}
