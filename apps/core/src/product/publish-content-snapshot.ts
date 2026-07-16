import { createHash } from 'node:crypto';
import type { ProductState } from '@meiye/contracts';
import type {
  PublishableContentSnapshot,
  PublishContentSnapshotPort,
} from '../p1/integrations/contracts.js';
import type { ProductRepository } from './repository.js';

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stable(item)])
    );
  }
  return value;
}

function revision(value: unknown) {
  return createHash('sha256')
    .update(JSON.stringify(stable(value)))
    .digest('hex');
}

function snapshots(state: ProductState): PublishableContentSnapshot[] {
  return state.handoffPackages.flatMap((handoff) => {
    if (
      handoff.platform !== 'douyin' ||
      handoff.status !== 'ready' ||
      !handoff.artifactId
    ) {
      return [];
    }
    const artifact = state.videoArtifacts.find(
      (candidate) =>
        candidate.id === handoff.artifactId &&
        candidate.status === 'completed' &&
        candidate.contentType === 'video/mp4'
    );
    if (!artifact) return [];
    const contentVersionExists = state.contents.some((content) =>
      content.variants.some((variant) =>
        variant.versions.some(
          (version) => version.id === handoff.contentVersionId
        )
      )
    );
    if (!contentVersionExists) return [];
    const snapshotRevision = revision({
      artifact: {
        contentType: artifact.contentType,
        fileSha256: artifact.fileSha256,
        fileSizeBytes: artifact.fileSizeBytes,
        id: artifact.id,
        objectKey: artifact.objectKey,
        storageEtag: artifact.storageEtag,
      },
      handoff: {
        artifactId: handoff.artifactId,
        assetIds: handoff.assetIds ?? [],
        body: handoff.body,
        complianceResultId: handoff.complianceResultId,
        contentId: handoff.contentId,
        contentVersionId: handoff.contentVersionId,
        conversionText: handoff.conversionText,
        id: handoff.id,
        platform: handoff.platform,
        status: handoff.status,
        title: handoff.title,
        topics: handoff.topics,
        version: handoff.version,
      },
    });
    return [
      {
        artifactId: artifact.id,
        contentId: handoff.contentId,
        contentVersionId: handoff.contentVersionId,
        createdAt: handoff.createdAt,
        id: handoff.id,
        platform: 'douyin' as const,
        revision: snapshotRevision,
        source: 'product_handoff' as const,
        title: handoff.title,
      },
    ];
  });
}

export class ProductPublishContentSnapshotPort
  implements PublishContentSnapshotPort
{
  constructor(private readonly repository: ProductRepository) {}

  async list(workspaceId: string) {
    const state = await this.repository.load(workspaceId);
    if (!state) return [];
    return snapshots(state).sort(
      (left, right) =>
        right.createdAt.localeCompare(left.createdAt) ||
        left.id.localeCompare(right.id)
    );
  }

  async resolve(workspaceId: string, snapshotId: string) {
    return (await this.list(workspaceId)).find(
      (snapshot) => snapshot.id === snapshotId
    );
  }
}
