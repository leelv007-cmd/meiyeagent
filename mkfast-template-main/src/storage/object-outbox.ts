import { and, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { sharedAssetObjectLockKey } from '@meiye/contracts';
import { getDb } from '@/db';
import { storageObjectOutbox, userFiles } from '@/db/app.schema';
import { deleteFile, deleteSharedAsset, inspectSharedAsset } from './index';
import {
  processStorageDeleteJob,
  type StorageDeleteIntent,
  type StorageDeleteJob,
} from './object-lifecycle';
import { decideSharedAssetCleanup } from './shared-asset-receipt';

const READY_STATUSES = ['pending', 'retry'] as const;
const CLAIM_LEASE_MS = 60_000;

function outboxId(): string {
  return `storage-delete-${crypto.randomUUID()}`;
}

export async function enqueueStorageDelete(
  intent: StorageDeleteIntent
): Promise<StorageDeleteJob> {
  const database = getDb();
  const id = outboxId();
  const [created] = await database
    .insert(storageObjectOutbox)
    .values({ id, ...intent })
    .onConflictDoNothing()
    .returning();
  if (created) return { id: created.id, ...intent };
  if (!intent.userFileId) {
    throw new Error('Storage delete recovery could not be persisted');
  }
  const [existing] = await database
    .select()
    .from(storageObjectOutbox)
    .where(eq(storageObjectOutbox.userFileId, intent.userFileId))
    .limit(1);
  if (!existing) throw new Error('Storage delete recovery could not be found');
  return {
    id: existing.id,
    objectKey: existing.objectKey,
    receiptStorageRevision: existing.receiptStorageRevision ?? undefined,
    reason: existing.reason,
    userFileId: existing.userFileId ?? undefined,
    userId: existing.userId,
    workspaceId: existing.workspaceId,
  };
}

export async function tombstoneUserFile(input: {
  id: string;
  userId: string;
}): Promise<StorageDeleteJob> {
  const database = getDb();
  return database.transaction(async (transaction) => {
    const [file] = await transaction
      .select({
        id: userFiles.id,
        r2Key: userFiles.r2Key,
        storageRevision: userFiles.storageRevision,
        workspaceId: userFiles.workspaceId,
      })
      .from(userFiles)
      .where(
        and(
          eq(userFiles.id, input.id),
          eq(userFiles.userId, input.userId),
          isNull(userFiles.deletedAt)
        )
      )
      .limit(1);
    if (!file) throw new Error('File not found');

    const now = new Date();
    const id = outboxId();
    await transaction
      .update(userFiles)
      .set({ deletedAt: now, updatedAt: now })
      .where(eq(userFiles.id, file.id));
    await transaction.insert(storageObjectOutbox).values({
      id,
      objectKey: file.r2Key,
      receiptStorageRevision: file.storageRevision ?? undefined,
      reason: 'user_delete',
      userFileId: file.id,
      userId: input.userId,
      workspaceId: file.workspaceId,
    });
    return {
      id,
      objectKey: file.r2Key,
      receiptStorageRevision: file.storageRevision ?? undefined,
      reason: 'user_delete',
      userFileId: file.id,
      userId: input.userId,
      workspaceId: file.workspaceId,
    };
  });
}

async function claimStorageDeleteJob(
  id: string
): Promise<(StorageDeleteJob & { claimToken: string }) | undefined> {
  const database = getDb();
  const now = new Date();
  const claimToken = crypto.randomUUID();
  const [claimed] = await database
    .update(storageObjectOutbox)
    .set({
      claimToken,
      leaseExpiresAt: new Date(now.getTime() + CLAIM_LEASE_MS),
      status: 'processing',
      updatedAt: now,
    })
    .where(
      and(
        eq(storageObjectOutbox.id, id),
        lte(storageObjectOutbox.availableAt, now),
        or(
          inArray(storageObjectOutbox.status, [...READY_STATUSES]),
          and(
            eq(storageObjectOutbox.status, 'processing'),
            or(
              isNull(storageObjectOutbox.leaseExpiresAt),
              lte(storageObjectOutbox.leaseExpiresAt, now)
            )
          )
        )
      )
    )
    .returning();
  if (!claimed) return undefined;
  return {
    claimToken,
    id: claimed.id,
    objectKey: claimed.objectKey,
    receiptStorageRevision: claimed.receiptStorageRevision ?? undefined,
    reason: claimed.reason,
    userFileId: claimed.userFileId ?? undefined,
    userId: claimed.userId,
    workspaceId: claimed.workspaceId,
  };
}

async function completeStorageDeleteJob(
  job: StorageDeleteJob & { claimToken: string }
): Promise<void> {
  const database = getDb();
  await database.transaction(async (transaction) => {
    if (job.reason === 'user_delete' && job.userFileId) {
      await transaction
        .delete(userFiles)
        .where(
          and(
            eq(userFiles.id, job.userFileId),
            eq(userFiles.userId, job.userId)
          )
        );
    }
    const now = new Date();
    const [completed] = await transaction
      .update(storageObjectOutbox)
      .set({
        claimToken: null,
        completedAt: now,
        lastErrorCode: null,
        leaseExpiresAt: null,
        status: 'completed',
        updatedAt: now,
      })
      .where(
        and(
          eq(storageObjectOutbox.id, job.id),
          eq(storageObjectOutbox.claimToken, job.claimToken)
        )
      )
      .returning({ id: storageObjectOutbox.id });
    if (!completed) throw new Error('Storage delete claim was lost');
  });
}

async function retryStorageDeleteJob(
  job: StorageDeleteJob & { claimToken: string },
  errorCode: string
): Promise<void> {
  const database = getDb();
  const [current] = await database
    .select({ attemptCount: storageObjectOutbox.attemptCount })
    .from(storageObjectOutbox)
    .where(eq(storageObjectOutbox.id, job.id))
    .limit(1);
  const attemptCount = (current?.attemptCount ?? 0) + 1;
  const delayMs = Math.min(60 * 60 * 1000, 2 ** attemptCount * 1000);
  const now = new Date();
  await database
    .update(storageObjectOutbox)
    .set({
      attemptCount: sql`${storageObjectOutbox.attemptCount} + 1`,
      availableAt: new Date(now.getTime() + delayMs),
      claimToken: null,
      lastErrorCode: errorCode,
      leaseExpiresAt: null,
      status: 'retry',
      updatedAt: now,
    })
    .where(
      and(
        eq(storageObjectOutbox.id, job.id),
        eq(storageObjectOutbox.claimToken, job.claimToken)
      )
    );
}

export async function processStorageDeleteById(id: string): Promise<void> {
  const claimed = await claimStorageDeleteJob(id);
  if (!claimed) return;
  if (claimed.receiptStorageRevision) {
    await processSharedAssetDeleteClaim(claimed);
    return;
  }
  const database = getDb();
  await processStorageDeleteJob(claimed, {
    complete: () => completeStorageDeleteJob(claimed),
    deleteObject: deleteFile,
    isStillReferenced: async (job) => {
      const [reference] = await database
        .select({ id: userFiles.id })
        .from(userFiles)
        .where(
          and(eq(userFiles.r2Key, job.objectKey), isNull(userFiles.deletedAt))
        )
        .limit(1);
      return Boolean(reference);
    },
    retry: (_job, errorCode) => retryStorageDeleteJob(claimed, errorCode),
  });
}

/**
 * The transaction lock covers the final reference probe, durable deleting
 * state, and R2 deletion. Product registration takes the same object lock.
 */
async function processSharedAssetDeleteClaim(
  job: StorageDeleteJob & { claimToken: string }
): Promise<void> {
  const database = getDb();
  try {
    await database.transaction(async (transaction) => {
      const lockKey = sharedAssetObjectLockKey(job.workspaceId, job.objectKey);
      await transaction.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`
      );
      let state = await inspectSharedAsset(job.objectKey);
      let decision = decideSharedAssetCleanup(
        state,
        job.receiptStorageRevision!
      );
      if (decision === 'preserve') {
        await markSharedAssetRegistrationRecovered(
          transaction,
          job,
          state.receipt!.storageRevision
        );
        return;
      }
      if (decision === 'unknown') {
        throw new Error(
          'Shared asset object is present without a durable receipt.'
        );
      }
      await transaction.execute(sql`
        INSERT INTO storage_object_cleanup_claims
          (workspace_id, object_key, status, receipt_storage_revision,
           delete_attempt_count, claimed_at, updated_at, last_error)
        VALUES (
          ${job.workspaceId}, ${job.objectKey}, 'deleting',
          ${job.receiptStorageRevision}, 1, now(), now(), NULL
        )
        ON CONFLICT (workspace_id, object_key) DO UPDATE
          SET status = 'deleting',
              receipt_storage_revision = EXCLUDED.receipt_storage_revision,
              delete_attempt_count = storage_object_cleanup_claims.delete_attempt_count + 1,
              claimed_at = now(),
              updated_at = now(),
              last_error = NULL
      `);
      // Re-read after the durable deleting claim. A concurrent re-upload that
      // reached its sidecar between the first read and this claim owns the
      // object when its generation differs from this outbox job.
      state = await inspectSharedAsset(job.objectKey);
      decision = decideSharedAssetCleanup(state, job.receiptStorageRevision!);
      if (decision === 'preserve') {
        await markSharedAssetRegistrationRecovered(
          transaction,
          job,
          state.receipt!.storageRevision
        );
        return;
      }
      if (decision === 'unknown') {
        throw new Error(
          'Shared asset object is present without a durable receipt.'
        );
      }
      if (decision === 'deleted') {
        await transaction.execute(sql`
          UPDATE storage_object_cleanup_claims
             SET status = 'deleted', updated_at = now(), last_error = NULL
           WHERE workspace_id = ${job.workspaceId}
             AND object_key = ${job.objectKey}
        `);
        return;
      }
      const [reference] = await transaction
        .select({ id: userFiles.id })
        .from(userFiles)
        .where(
          and(
            eq(userFiles.workspaceId, job.workspaceId),
            eq(userFiles.r2Key, job.objectKey),
            isNull(userFiles.deletedAt)
          )
        )
        .limit(1);
      if (reference) {
        await transaction.execute(sql`
          UPDATE storage_object_cleanup_claims
             SET status = 'referenced', updated_at = now(), last_error = NULL
           WHERE workspace_id = ${job.workspaceId}
             AND object_key = ${job.objectKey}
        `);
        return;
      }

      await deleteSharedAsset(job.objectKey);
      state = await inspectSharedAsset(job.objectKey);
      if (
        decideSharedAssetCleanup(state, job.receiptStorageRevision!) !==
        'deleted'
      ) {
        throw new Error(
          'Shared asset deletion did not remove its object and receipt together.'
        );
      }
      await transaction.execute(sql`
        UPDATE storage_object_cleanup_claims
           SET status = 'deleted', updated_at = now(), last_error = NULL
         WHERE workspace_id = ${job.workspaceId}
           AND object_key = ${job.objectKey}
      `);
    });
  } catch (error) {
    await markSharedAssetDeleteFailed(job, error).catch(() => undefined);
    await retryStorageDeleteJob(job, 'OBJECT_DELETE_FAILED');
    return;
  }
  try {
    await completeStorageDeleteJob(job);
  } catch {
    // The object delete and its durable claim have already committed. Retrying
    // the outbox must preserve `deleted`, so a later registration observes the
    // correct object generation instead of a synthetic delete failure.
    await retryStorageDeleteJob(job, 'OBJECT_DELETE_FAILED');
  }
}

async function markSharedAssetDeleteFailed(
  job: StorageDeleteJob & { claimToken: string },
  error: unknown
) {
  const database = getDb();
  const message =
    error instanceof Error
      ? error.message.slice(0, 512)
      : 'Unknown delete error.';
  await database.transaction(async (transaction) => {
    const lockKey = sharedAssetObjectLockKey(job.workspaceId, job.objectKey);
    await transaction.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`
    );
    await transaction.execute(sql`
      INSERT INTO storage_object_cleanup_claims
        (workspace_id, object_key, status, receipt_storage_revision,
         delete_attempt_count, claimed_at, updated_at, last_error)
      VALUES (
        ${job.workspaceId}, ${job.objectKey}, 'delete_failed',
        ${job.receiptStorageRevision}, 1, now(), now(), ${message}
      )
      ON CONFLICT (workspace_id, object_key) DO UPDATE
        SET status = 'delete_failed',
            receipt_storage_revision = EXCLUDED.receipt_storage_revision,
            updated_at = now(),
            last_error = EXCLUDED.last_error
      WHERE storage_object_cleanup_claims.receipt_storage_revision IS NULL
         OR storage_object_cleanup_claims.receipt_storage_revision = EXCLUDED.receipt_storage_revision
    `);
  });
}

async function markSharedAssetRegistrationRecovered(
  transaction: {
    execute(query: ReturnType<typeof sql>): Promise<unknown>;
  },
  job: StorageDeleteJob & { claimToken: string },
  storageRevision: string
) {
  await transaction.execute(sql`
    INSERT INTO storage_object_cleanup_claims
      (workspace_id, object_key, status, receipt_storage_revision,
       delete_attempt_count, claimed_at, updated_at, last_error)
    VALUES (
      ${job.workspaceId}, ${job.objectKey}, 'registration_recovered',
      ${storageRevision}, 0, now(), now(), NULL
    )
    ON CONFLICT (workspace_id, object_key) DO UPDATE
      SET status = 'registration_recovered',
          receipt_storage_revision = EXCLUDED.receipt_storage_revision,
          updated_at = now(),
          last_error = NULL
  `);
}

export async function processStorageObjectOutbox(limit = 25): Promise<void> {
  const database = getDb();
  const now = new Date();
  const candidates = await database
    .select({ id: storageObjectOutbox.id })
    .from(storageObjectOutbox)
    .where(
      and(
        lte(storageObjectOutbox.availableAt, now),
        or(
          inArray(storageObjectOutbox.status, [...READY_STATUSES]),
          and(
            eq(storageObjectOutbox.status, 'processing'),
            or(
              isNull(storageObjectOutbox.leaseExpiresAt),
              lte(storageObjectOutbox.leaseExpiresAt, now)
            )
          )
        )
      )
    )
    .limit(Math.min(Math.max(limit, 1), 100));
  await Promise.all(
    candidates.map((candidate) => processStorageDeleteById(candidate.id))
  );
}
