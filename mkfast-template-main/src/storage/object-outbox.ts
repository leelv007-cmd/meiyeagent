import { and, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { storageObjectOutbox, userFiles } from '@/db/app.schema';
import { deleteFile } from './index';
import {
  processStorageDeleteJob,
  type StorageDeleteIntent,
  type StorageDeleteJob,
} from './object-lifecycle';

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
      reason: 'user_delete',
      userFileId: file.id,
      userId: input.userId,
      workspaceId: file.workspaceId,
    });
    return {
      id,
      objectKey: file.r2Key,
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
  await processStorageDeleteJob(claimed, {
    complete: () => completeStorageDeleteJob(claimed),
    deleteObject: deleteFile,
    retry: (_job, errorCode) => retryStorageDeleteJob(claimed, errorCode),
  });
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
