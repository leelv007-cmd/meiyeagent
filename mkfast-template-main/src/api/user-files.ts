import { getDb } from '@/db';
import { userFiles } from '@/db/app.schema';
import { authApiMiddleware } from '@/middlewares/auth-middleware';
import {
  processStorageDeleteById,
  tombstoneUserFile,
} from '@/storage/object-outbox';
import { createServerFn } from '@tanstack/react-start';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

const listSchema = z.object({
  pageIndex: z.number().int().min(0),
  pageSize: z.number().int().min(1).max(100),
});

export const listUserFiles = createServerFn({ method: 'GET' })
  .inputValidator(listSchema)
  .middleware([authApiMiddleware])
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const pageIndex = data.pageIndex;
    const pageSize = data.pageSize;
    const db = getDb();
    const where = and(
      eq(userFiles.userId, userId),
      isNull(userFiles.deletedAt)
    );

    const [totalRow] = await db
      .select({ count: count() })
      .from(userFiles)
      .where(where);
    const total = totalRow?.count ?? 0;

    const items = await db
      .select()
      .from(userFiles)
      .where(where)
      .orderBy(desc(userFiles.createdAt))
      .limit(pageSize)
      .offset(pageIndex * pageSize);

    return { items, total };
  });

const deleteSchema = z.object({ id: z.string() });

export const deleteUserFile = createServerFn({ method: 'POST' })
  .inputValidator(deleteSchema)
  .middleware([authApiMiddleware])
  .handler(async ({ data, context }) => {
    const job = await tombstoneUserFile({
      id: data.id,
      userId: context.userId,
    });
    await processStorageDeleteById(job.id);
    return { status: 'accepted' as const };
  });
