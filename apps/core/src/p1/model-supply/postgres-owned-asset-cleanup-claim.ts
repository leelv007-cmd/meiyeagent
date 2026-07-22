import type { Pool } from 'pg';
import { sharedAssetObjectLockKey } from '@meiye/contracts';
import type {
  AssetStorageReceipt,
  OwnedAssetRegistrationFailureRecord,
  S3CompatibleAssetStorage,
} from './s3-asset-storage.js';

type ClaimStatus = 'delete_failed' | 'deleted' | 'deleting' | 'referenced' | 'registration_recovered';

interface Queryable {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rowCount: number | null; rows: T[] }>;
}

export interface ObjectReferenceVerifier {
  isReferenced(input: {
    assetId: string;
    receipt: AssetStorageReceipt;
    workspaceId: string;
  }): Promise<boolean>;
}

export type OwnedAssetCleanupClaimOutcome = 'deleted' | 'failed' | 'referenced';

/**
 * Holds one PostgreSQL session advisory lock across a persisted deleting claim,
 * the final reference probe, and the object delete. Registration writes take
 * the same key in their database transaction.
 */
export class PostgresOwnedAssetCleanupClaimCoordinator {
  constructor(
    private readonly pool: Pool,
    private readonly storage: S3CompatibleAssetStorage,
    private readonly references: ObjectReferenceVerifier,
  ) {}

  async cleanup(
    failure: OwnedAssetRegistrationFailureRecord,
  ): Promise<OwnedAssetCleanupClaimOutcome> {
    const client = await this.pool.connect();
    const lockKey = sharedAssetObjectLockKey(
      failure.workspaceId,
      failure.objectKey,
    );
    let locked = false;
    let claimPersisted = false;
    let transactionOpen = false;
    try {
      await client.query('SELECT pg_advisory_lock(hashtext($1))', [lockKey]);
      locked = true;

      await client.query('BEGIN');
      transactionOpen = true;
      await writeDeletingClaim(client, failure);
      await client.query('COMMIT');
      transactionOpen = false;
      claimPersisted = true;

      if (!failure.storageRevision) {
        await updateClaim(
          client,
          failure,
          'delete_failed',
          null,
          new Error('Shared asset cleanup has no receipt storage revision.'),
        );
        return 'failed';
      }

      // A writer that began before the session lock may have completed its
      // receipt after the failure was recorded. The sidecar generation is the
      // fencing token: a different generation belongs to that writer.
      const state = await this.storage.inspectSharedObject(failure.objectKey);
      const receipt = state.receipt;
      if (!receipt) {
        if (!state.objectExists) {
          await updateClaim(client, failure, 'deleted', failure.storageRevision);
          return 'deleted';
        }
        await updateClaim(
          client,
          failure,
          'delete_failed',
          failure.storageRevision,
          new Error('Shared asset object is present without a durable receipt.'),
        );
        return 'failed';
      }
      if (receipt.storageRevision !== failure.storageRevision) {
        if (!state.objectExists) {
          await updateClaim(
            client,
            failure,
            'delete_failed',
            receipt.storageRevision,
            new Error('Shared asset receipt has no matching object generation.'),
          );
          return 'failed';
        }
        await this.storage.readReceipt(failure.objectKey);
        await updateClaim(
          client,
          failure,
          'registration_recovered',
          receipt.storageRevision,
        );
        return 'referenced';
      }
      if (state.objectExists) {
        // Refuse to use a sidecar-only proof to delete a corrupt object.
        await this.storage.readReceipt(failure.objectKey);
      }
      if (await this.references.isReferenced({
        assetId: failure.assetId,
        receipt,
        workspaceId: failure.workspaceId,
      })) {
        await updateClaim(client, failure, 'referenced', receipt.storageRevision);
        return 'referenced';
      }
      await this.storage.deleteSharedObject(failure.objectKey);
      const afterDelete = await this.storage.inspectSharedObject(failure.objectKey);
      if (afterDelete.objectExists || afterDelete.receipt) {
        throw new Error('Shared asset deletion did not remove its object and receipt together.');
      }
      await updateClaim(
        client,
        failure,
        'deleted',
        receipt.storageRevision,
      );
      return 'deleted';
    } catch (error) {
      if (transactionOpen) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // The durable failure record remains replayable even if rollback
          // confirmation is unavailable.
        }
      }
      try {
        const state = await this.storage.inspectSharedObject(failure.objectKey);
        if (!state.objectExists && !state.receipt) {
          if (claimPersisted) {
            await updateClaim(
              client,
              failure,
              'deleted',
              failure.storageRevision ?? null,
            );
          }
          return 'deleted';
        }
        if (claimPersisted) {
          await updateClaim(
            client,
            failure,
            'delete_failed',
            state.receipt?.storageRevision ?? failure.storageRevision ?? null,
            error,
          );
        }
      } catch {
        // Do not mask the original failed delete. The unresolved S3 lifecycle
        // record is the replay ledger when claim-state persistence is down.
      }
      return 'failed';
    } finally {
      if (locked) {
        await client.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey]);
      }
      client.release();
    }
  }

}

/** Called inside the same transaction that commits an OwnedAsset reference. */
export async function assertOwnedAssetRegistrationAllowed(
  database: Queryable,
  input: {
    objectKey: string;
    storageRevision?: string;
    workspaceId: string;
  },
) {
  const lockKey = sharedAssetObjectLockKey(input.workspaceId, input.objectKey);
  await database.query('SELECT pg_advisory_xact_lock(hashtext($1))', [lockKey]);
  const result = await database.query<{
    receipt_storage_revision: string | null;
    status: ClaimStatus;
  }>(
    `SELECT status, receipt_storage_revision
       FROM p1_owned_asset_cleanup_claims
      WHERE workspace_id = $1 AND object_key = $2
      FOR UPDATE`,
    [input.workspaceId, input.objectKey],
  );
  const claim = result.rows[0];
  if (!claim) return;
  if (claim.status === 'deleting') {
    throw new Error('Owned asset cleanup is in progress; retry registration.');
  }
  if (!input.storageRevision) {
    throw new Error('Owned asset registration requires a receipt storage revision.');
  }
  if (
    claim.status === 'deleted' &&
    claim.receipt_storage_revision === input.storageRevision
  ) {
    throw new Error('Owned asset was deleted during registration; retry upload.');
  }
  if (claim.status === 'delete_failed') {
    throw new Error('Owned asset cleanup is incomplete; retry upload after cleanup succeeds.');
  }
  if (claim.status === 'deleted') {
    await database.query(
      `UPDATE p1_owned_asset_cleanup_claims
          SET status = 'registration_recovered',
              receipt_storage_revision = $3,
              updated_at = now(),
              last_error = NULL
        WHERE workspace_id = $1 AND object_key = $2`,
      [input.workspaceId, input.objectKey, input.storageRevision],
    );
  }
}

async function writeDeletingClaim(
  database: Queryable,
  failure: OwnedAssetRegistrationFailureRecord,
) {
  await database.query(
    `INSERT INTO p1_owned_asset_cleanup_claims
       (workspace_id, object_key, failure_id, status, receipt_storage_revision,
        delete_attempt_count, claimed_at, updated_at)
     VALUES ($1, $2, $3, 'deleting', $4, 1, now(), now())
     ON CONFLICT (workspace_id, object_key) DO UPDATE
       SET failure_id = EXCLUDED.failure_id,
           status = 'deleting',
           receipt_storage_revision = EXCLUDED.receipt_storage_revision,
           delete_attempt_count = p1_owned_asset_cleanup_claims.delete_attempt_count + 1,
           claimed_at = now(),
           updated_at = now(),
           last_error = NULL`,
    [
      failure.workspaceId,
      failure.objectKey,
      failure.id,
      failure.storageRevision ?? null,
    ],
  );
}

async function updateClaim(
  database: Queryable,
  failure: OwnedAssetRegistrationFailureRecord,
  status: ClaimStatus,
  receiptStorageRevision: string | null,
  error?: unknown,
) {
  await database.query(
    `UPDATE p1_owned_asset_cleanup_claims
        SET status = $3,
            receipt_storage_revision = COALESCE($4, receipt_storage_revision),
            updated_at = now(),
            last_error = $5
      WHERE workspace_id = $1 AND object_key = $2`,
    [
      failure.workspaceId,
      failure.objectKey,
      status,
      receiptStorageRevision,
      error instanceof Error ? error.message.slice(0, 512) : null,
    ],
  );
}
