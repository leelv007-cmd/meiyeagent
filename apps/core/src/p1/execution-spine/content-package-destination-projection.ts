import type {
  ComposerContentPackagePlatform,
  ComposerDistributionTarget,
} from '@meiye/contracts';
import type { Pool } from 'pg';

import { creationExecutionSnapshotSchema } from './creation-execution-snapshot.js';

export interface ContentPackageDestinationProjection {
  contentPackagePlatform: ComposerContentPackagePlatform;
  distributionTarget: ComposerDistributionTarget;
  packageId: string;
  snapshotId: string;
}

export interface ContentPackageDestinationProjectionPort {
  resolve(input: {
    references: ReadonlyArray<{ packageId: string; snapshotId: string }>;
    workspaceId: string;
  }): Promise<ContentPackageDestinationProjection[]>;
}

/**
 * Projects the signed destination from the immutable Composer submission.
 * The projection is deliberately read-only: compact ContentPackage payloads
 * keep their historical strict shape so an older Worker can read rows written
 * during a rolling deployment.
 */
export class PostgresContentPackageDestinationProjection
  implements ContentPackageDestinationProjectionPort
{
  constructor(private readonly pool: Pick<Pool, 'query'>) {}

  async resolve(input: {
    references: ReadonlyArray<{ packageId: string; snapshotId: string }>;
    workspaceId: string;
  }) {
    const requested = new Set(
      input.references.map(({ packageId, snapshotId }) =>
        JSON.stringify([packageId, snapshotId])
      )
    );
    if (requested.size === 0) return [];
    const packageIds = [
      ...new Set(input.references.map(({ packageId }) => packageId)),
    ];
    const snapshotIds = [
      ...new Set(input.references.map(({ snapshotId }) => snapshotId)),
    ];
    const result = await this.pool.query<{
      content_package_id: string;
      snapshot: unknown;
      snapshot_id: string;
    }>(
      `SELECT content_package_id, id AS snapshot_id,
              submission->'snapshot' AS snapshot
         FROM execution_spine.creation_submissions
        WHERE workspace_id = $1
          AND content_package_id = ANY($2::text[])
          AND id = ANY($3::text[])`,
      [input.workspaceId, packageIds, snapshotIds]
    );
    return result.rows.flatMap((row) => {
      if (
        !requested.has(
          JSON.stringify([row.content_package_id, row.snapshot_id])
        )
      ) {
        return [];
      }
      const snapshot = creationExecutionSnapshotSchema.safeParse(row.snapshot);
      if (
        !snapshot.success ||
        snapshot.data.id !== row.snapshot_id ||
        snapshot.data.workspaceId !== input.workspaceId ||
        snapshot.data.contentPackage.id !== row.content_package_id
      ) {
        return [];
      }
      return [
        {
          contentPackagePlatform: snapshot.data.contentPackagePlatform,
          distributionTarget: snapshot.data.distributionTarget,
          packageId: row.content_package_id,
          snapshotId: row.snapshot_id,
        },
      ];
    });
  }
}
