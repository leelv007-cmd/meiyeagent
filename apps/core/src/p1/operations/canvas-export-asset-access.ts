import { createHash } from 'node:crypto';
import type { ContentPackage } from '@meiye/contracts';
import type {
  CanvasAssetRepository,
  CanvasOwnedAsset,
  CanvasOwnedAssetExportPolicy,
} from '../../pro-studio/canvas-asset-facade.js';
import type { ReferenceAssetResolverPort } from '../model-supply/reference-asset-resolver.js';
import {
  assertContentPackageExportAllowed,
  ContentPackageTransitionError,
  contentPackageReferencesAsset,
} from './content-package.js';
import type { ContentPackageExportAssetReader } from './content-package-export-adapter.js';
import type {
  ContentPackageAssetExportPolicyPort,
  ContentPackageRightsResolverPort,
} from './types.js';

export type CanvasExportAssetUnavailableCode =
  | 'ASSET_ACCESS_DENIED'
  | 'ASSET_EXPIRED'
  | 'ASSET_PRIVATE_RETRIEVAL_DENIED'
  | 'ASSET_RECEIPT_INVALID'
  | 'ASSET_REVOKED'
  | 'ASSET_STORAGE_UNAVAILABLE';

export type CanvasExportAssetAccessDecision =
  | {
      asset: {
        bytesBase64: string;
        contentType: string;
        fileName: string;
        id: string;
        receipt: { id: string; storageRevision?: string };
        sha256: string;
        sizeBytes: number;
        workspaceId: string;
      };
      kind: 'available';
    }
  | { code: CanvasExportAssetUnavailableCode; kind: 'unavailable' };

/**
 * Read-only Core port for Canvas ZIP assembly. Rights are decided from current
 * ContentPackage/Product facts and bytes are read only after their durable
 * receipt is checked; Canvas graph metadata is never an authority here.
 */
export interface CanvasExportAssetAccessPort {
  resolve(input: {
    assetId: string;
    contentPackages: ContentPackage[];
    workspaceId: string;
  }): Promise<CanvasExportAssetAccessDecision>;
}

interface OwnedAssetStorage {
  read(objectKey: string): Promise<{
    bytes: Uint8Array;
    contentType: string;
  }>;
  /**
   * Checks the durable object receipt without reading the media payload. This
   * is intentionally separate from the current export-policy fact: it only
   * proves that the Core asset record still names the same immutable object.
   */
  verifyCanvasAssetReceipt(input: {
    contentType: CanvasOwnedAsset['contentType'];
    objectKey: string;
    sha256: string;
    sizeBytes: number;
    workspaceId: string;
  }): Promise<boolean>;
}

interface OperationsCanvasExportAssetAccessOptions {
  canvasAssets: Pick<CanvasAssetRepository, 'get'>;
  clock?: () => Date;
  contentPackageAssets: ContentPackageExportAssetReader;
  contentPackageRights: ContentPackageRightsResolverPort;
  ownedAssetStorage: OwnedAssetStorage;
  productAssets: Pick<ReferenceAssetResolverPort, 'resolve'>;
  productPolicy?: ContentPackageAssetExportPolicyPort;
}

export class OperationsCanvasExportAssetAccessService
  implements CanvasExportAssetAccessPort
{
  private readonly clock: () => Date;

  constructor(private readonly options: OperationsCanvasExportAssetAccessOptions) {
    this.clock = options.clock ?? (() => new Date());
  }

  async resolve(input: {
    assetId: string;
    contentPackages: ContentPackage[];
    workspaceId: string;
  }): Promise<CanvasExportAssetAccessDecision> {
    if (!input.assetId.trim() || !input.workspaceId.trim()) {
      return unavailable('ASSET_ACCESS_DENIED');
    }
    const packages = input.contentPackages.filter((contentPackage) =>
      contentPackageReferencesAsset(contentPackage, input.assetId)
    );
    const packagePolicy = await this.contentPackagePolicy(
      input.workspaceId,
      input.assetId,
      packages
    );
    if (packagePolicy) return packagePolicy;

    const packageOwnedAsset = packages
      .flatMap((contentPackage) => contentPackage.generated.ownedAssets ?? [])
      .find((asset) => asset.id === input.assetId);
    if (packageOwnedAsset) {
      return this.readContentPackageAsset(input);
    }

    const canvasAsset = await this.options.canvasAssets.get(
      input.workspaceId,
      input.assetId
    );
    if (canvasAsset) {
      const canvasPolicy = await this.canvasOwnedAssetPolicy(
        input.workspaceId,
        canvasAsset,
        new Set()
      );
      if (canvasPolicy) return canvasPolicy;
      return this.readCanvasOwnedAsset(input.workspaceId, canvasAsset);
    }

    const productPolicy = await this.requireProductExportPolicy(
      input.workspaceId,
      input.assetId
    );
    if (productPolicy) return productPolicy;

    if (packages.length > 0) {
      return this.readContentPackageAsset(input);
    }
    return this.readProductAsset(input.workspaceId, input.assetId);
  }

  private async contentPackagePolicy(
    workspaceId: string,
    assetId: string,
    packages: ContentPackage[]
  ): Promise<CanvasExportAssetAccessDecision | undefined> {
    if (packages.some((contentPackage) => contentPackage.rights.state === 'revoked')) {
      return unavailable('ASSET_REVOKED');
    }
    try {
      for (const contentPackage of packages) {
        assertContentPackageExportAllowed(contentPackage);
      }
    } catch (error) {
      if (error instanceof ContentPackageTransitionError) {
        return unavailable('ASSET_ACCESS_DENIED');
      }
      throw error;
    }
    if (packages.length === 0) return undefined;

    const packageOwnedAsset = packages.some((contentPackage) =>
      contentPackage.generated.ownedAssets?.some((asset) => asset.id === assetId)
    );
    const sourceAssetIds = [
      ...new Set(
        packages.flatMap((contentPackage) => contentPackage.source.assetIds)
      ),
    ];
    const liveRights = await this.options.contentPackageRights.resolve({
      assetIds: sourceAssetIds,
      workspaceId,
    });
    for (const unauthorizedAssetId of liveRights.unauthorizedAssetIds) {
      const sourcePolicy = await this.requireProductExportPolicy(
        workspaceId,
        unauthorizedAssetId
      );
      if (sourcePolicy) return sourcePolicy;
      return unavailable('ASSET_ACCESS_DENIED');
    }
    if (!packageOwnedAsset) {
      return this.requireProductExportPolicy(workspaceId, assetId);
    }
    return undefined;
  }

  private async canvasOwnedAssetPolicy(
    workspaceId: string,
    asset: CanvasOwnedAsset,
    seen: Set<string>
  ): Promise<CanvasExportAssetAccessDecision | undefined> {
    if (asset.workspaceId !== workspaceId) return unavailable('ASSET_ACCESS_DENIED');
    if (seen.has(asset.id)) return unavailable('ASSET_ACCESS_DENIED');
    seen.add(asset.id);
    if (asset.source.kind === 'product_asset') {
      return this.requireProductExportPolicy(
        workspaceId,
        asset.source.sourceAssetId
      );
    }
    const ownPolicy = this.currentOwnedAssetPolicy(workspaceId, asset);
    if (ownPolicy) return ownPolicy;
    if (asset.source.kind === 'local_canvas_derivative') {
      const parent = await this.options.canvasAssets.get(
        workspaceId,
        asset.source.parentAssetId
      );
      if (!parent) return unavailable('ASSET_ACCESS_DENIED');
      return this.canvasOwnedAssetPolicy(workspaceId, parent, seen);
    }
    if (asset.source.kind === 'local_import') return undefined;
    if (
      asset.source.kind === 'generation_job' &&
      typeof asset.source.jobId === 'string' &&
      asset.source.jobId.trim()
    ) {
      return undefined;
    }
    return unavailable('ASSET_ACCESS_DENIED');
  }

  /**
   * A Canvas receipt proves the bytes only. This policy fact is re-read for
   * every export, and a derivative must pass both its own fact and every
   * parent fact before Core reads any object bytes.
   */
  private currentOwnedAssetPolicy(
    workspaceId: string,
    asset: CanvasOwnedAsset
  ): CanvasExportAssetAccessDecision | undefined {
    const policy = asset.exportPolicy;
    if (!validOwnedAssetPolicy(policy, workspaceId, asset.workspaceId)) {
      return unavailable('ASSET_ACCESS_DENIED');
    }
    if (policy.revokedAt !== null) return unavailable('ASSET_REVOKED');
    if (!policy.exportAllowed) return unavailable('ASSET_ACCESS_DENIED');
    if (!policy.privateRetrievalAllowed) {
      return unavailable('ASSET_PRIVATE_RETRIEVAL_DENIED');
    }
    if (
      policy.expiresAt !== null &&
      Date.parse(policy.expiresAt) <= this.clock().getTime()
    ) {
      return unavailable('ASSET_EXPIRED');
    }
    return undefined;
  }

  private async requireProductExportPolicy(
    workspaceId: string,
    assetId: string
  ): Promise<CanvasExportAssetAccessDecision | undefined> {
    const policy = await this.options.productPolicy?.resolveExportPolicy({
      assetId,
      workspaceId,
    });
    if (!policy || policy.kind === 'unknown') {
      return unavailable('ASSET_ACCESS_DENIED');
    }
    return policy.kind === 'unavailable'
      ? unavailable(policyUnavailableCode(policy.reason))
      : undefined;
  }

  private async readContentPackageAsset(input: {
    assetId: string;
    workspaceId: string;
  }): Promise<CanvasExportAssetAccessDecision> {
    try {
      const { asset, bytes } = await this.options.contentPackageAssets.readOwnedAsset(
        input
      );
      if (
        asset.id !== input.assetId ||
        !validReceipt(asset, bytes) ||
        !asset.contentType.trim()
      ) {
        return unavailable('ASSET_RECEIPT_INVALID');
      }
      return available({
        bytes,
        contentType: asset.contentType,
        fileName: fileName(asset.id, asset.contentType),
        id: asset.id,
        receipt: { id: asset.id },
        sha256: asset.sha256,
        sizeBytes: asset.sizeBytes,
        workspaceId: input.workspaceId,
      });
    } catch {
      return unavailable('ASSET_STORAGE_UNAVAILABLE');
    }
  }

  private async readCanvasOwnedAsset(
    workspaceId: string,
    asset: CanvasOwnedAsset
  ): Promise<CanvasExportAssetAccessDecision> {
    if (
      asset.workspaceId !== workspaceId
    ) {
      return unavailable('ASSET_ACCESS_DENIED');
    }
    if (
      !asset.objectKey.startsWith(`${workspaceId}/`) ||
      !validReceipt(asset)
    ) {
      return unavailable('ASSET_RECEIPT_INVALID');
    }
    try {
      const receiptValid = await this.options.ownedAssetStorage.verifyCanvasAssetReceipt({
        contentType: asset.contentType,
        objectKey: asset.objectKey,
        sha256: asset.sha256,
        sizeBytes: asset.sizeBytes,
        workspaceId,
      });
      if (!receiptValid) return unavailable('ASSET_RECEIPT_INVALID');
    } catch {
      return unavailable('ASSET_RECEIPT_INVALID');
    }
    try {
      const stored = await this.options.ownedAssetStorage.read(asset.objectKey);
      if (
        stored.contentType !== asset.contentType ||
        !validReceipt(asset, stored.bytes)
      ) {
        return unavailable('ASSET_RECEIPT_INVALID');
      }
      return available({
        bytes: stored.bytes,
        contentType: stored.contentType,
        fileName: asset.fileName,
        id: asset.id,
        receipt: { id: asset.id },
        sha256: asset.sha256,
        sizeBytes: asset.sizeBytes,
        workspaceId,
      });
    } catch {
      return unavailable('ASSET_STORAGE_UNAVAILABLE');
    }
  }

  private async readProductAsset(
    workspaceId: string,
    assetId: string
  ): Promise<CanvasExportAssetAccessDecision> {
    try {
      const [resolved] = await this.options.productAssets.resolve(workspaceId, [
        assetId,
      ]);
      if (!resolved || resolved.kind !== 'resolved') {
        return unavailable(referenceUnavailableCode(resolved?.kind === 'failure' ? resolved.reason : undefined));
      }
      if (!validReceipt({ sha256: resolved.sha256, sizeBytes: resolved.bytes.byteLength }, resolved.bytes)) {
        return unavailable('ASSET_RECEIPT_INVALID');
      }
      return available({
        bytes: resolved.bytes,
        contentType: resolved.contentType,
        fileName: fileName(resolved.assetId, resolved.contentType),
        id: resolved.assetId,
        receipt: { id: resolved.assetId },
        sha256: resolved.sha256,
        sizeBytes: resolved.bytes.byteLength,
        workspaceId,
      });
    } catch {
      return unavailable('ASSET_STORAGE_UNAVAILABLE');
    }
  }
}

function available(input: {
  bytes: Uint8Array;
  contentType: string;
  fileName: string;
  id: string;
  receipt: { id: string; storageRevision?: string };
  sha256: string;
  sizeBytes: number;
  workspaceId: string;
}): CanvasExportAssetAccessDecision {
  return {
    asset: {
      bytesBase64: Buffer.from(input.bytes).toString('base64'),
      contentType: input.contentType,
      fileName: input.fileName,
      id: input.id,
      receipt: input.receipt,
      sha256: input.sha256,
      sizeBytes: input.sizeBytes,
      workspaceId: input.workspaceId,
    },
    kind: 'available',
  };
}

function unavailable(code: CanvasExportAssetUnavailableCode): CanvasExportAssetAccessDecision {
  return { code, kind: 'unavailable' };
}

function policyUnavailableCode(
  reason: Extract<
    Awaited<ReturnType<ContentPackageAssetExportPolicyPort['resolveExportPolicy']>>,
    { kind: 'unavailable' }
  >['reason']
): CanvasExportAssetUnavailableCode {
  switch (reason) {
    case 'expired':
      return 'ASSET_EXPIRED';
    case 'private_retrieval_denied':
      return 'ASSET_PRIVATE_RETRIEVAL_DENIED';
    case 'revoked':
      return 'ASSET_REVOKED';
    default:
      return 'ASSET_ACCESS_DENIED';
  }
}

function referenceUnavailableCode(
  reason: 'authorization_withdrawn' | 'not_found' | 'oversized' | 'rights_incomplete' | 'unreadable' | undefined
): CanvasExportAssetUnavailableCode {
  if (reason === 'authorization_withdrawn') return 'ASSET_REVOKED';
  if (reason === 'unreadable') return 'ASSET_STORAGE_UNAVAILABLE';
  return 'ASSET_ACCESS_DENIED';
}

function validReceipt(
  asset: { sha256: string; sizeBytes: number },
  bytes?: Uint8Array
) {
  if (
    !Number.isSafeInteger(asset.sizeBytes) ||
    asset.sizeBytes < 0 ||
    !/^[a-f0-9]{64}$/u.test(asset.sha256)
  ) {
    return false;
  }
  return !bytes || (
    bytes.byteLength === asset.sizeBytes &&
    createHash('sha256').update(bytes).digest('hex') === asset.sha256
  );
}

function validOwnedAssetPolicy(
  policy: CanvasOwnedAssetExportPolicy | undefined,
  requestedWorkspaceId: string,
  assetWorkspaceId: string
): policy is CanvasOwnedAssetExportPolicy {
  if (
    !policy ||
    policy.workspaceId !== requestedWorkspaceId ||
    policy.workspaceId !== assetWorkspaceId ||
    typeof policy.ownerId !== 'string' ||
    !policy.ownerId.trim() ||
    typeof policy.exportAllowed !== 'boolean' ||
    typeof policy.privateRetrievalAllowed !== 'boolean' ||
    !Number.isSafeInteger(policy.version) ||
    policy.version < 1 ||
    !validPolicyTimestamp(policy.updatedAt)
  ) {
    return false;
  }
  if (policy.expiresAt !== null && !validPolicyTimestamp(policy.expiresAt)) {
    return false;
  }
  return policy.revokedAt === null || validPolicyTimestamp(policy.revokedAt);
}

function validPolicyTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function fileName(assetId: string, contentType: string) {
  const extension =
    contentType === 'image/jpeg'
      ? 'jpg'
      : contentType === 'image/png'
        ? 'png'
        : contentType === 'image/webp'
          ? 'webp'
          : contentType === 'video/mp4'
            ? 'mp4'
            : contentType === 'audio/mpeg'
              ? 'mp3'
              : contentType === 'audio/wav'
                ? 'wav'
                : 'bin';
  return `${assetId}.${extension}`;
}
