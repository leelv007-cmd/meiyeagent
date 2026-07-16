import { createFileRoute } from '@tanstack/react-router';
import { eq, inArray, like, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { account, session, user } from '@/db/auth.schema';
import {
  payment,
  userFiles,
  workspaceMemberships,
  workspaces,
} from '@/db/app.schema';

const TEST_EMAIL_PATTERN = 'e2e-%@example.test';
const TEST_API_SECRET = 'mkfast-e2e-secret';

function assertE2EAccess(request: Request) {
  const requestSecret = request.headers.get('x-e2e-secret');
  const isLocalE2EMode =
    import.meta.env.DEV === true && import.meta.env.MODE === 'e2e';

  if (!isLocalE2EMode || requestSecret !== TEST_API_SECRET) {
    return Response.json({ error: 'Not Found' }, { status: 404 });
  }

  return null;
}

function isE2EEmail(email: string) {
  return email.startsWith('e2e-') && email.endsWith('@example.test');
}

async function cleanupE2ERuntime(
  db: ReturnType<typeof getDb>,
  workspaceIds: readonly string[]
) {
  await db.execute(sql`
    DELETE FROM pgboss.job AS jobs
    WHERE jobs.name = 'meiye-p1-jobs'
      AND jobs.state <> 'completed'
      AND NOT EXISTS (
        SELECT 1 FROM workspaces
        WHERE workspaces.id = jobs.data ->> 'workspaceId'
      )
  `);
  await db.execute(sql`
    DELETE FROM p1_job_tracer AS tracer
    WHERE tracer.status NOT IN ('completed', 'failed', 'cancelled')
      AND NOT EXISTS (
        SELECT 1 FROM workspaces
        WHERE workspaces.id = tracer.workspace_id
      )
  `);

  for (const table of [
    'model_quality_evaluation_cases',
    'model_quality_evaluation_runs',
    'model_revision_rollback_audits',
    'model_prompt_heads',
    'model_generation_jobs',
    'model_catalog_heads',
    'model_workspace_preferences',
    'model_user_preferences',
    'model_catalog_revisions',
    'model_quality_events',
    'model_video_workflows',
  ]) {
    await db.execute(sql`
      DELETE FROM ${sql.raw(table)} AS records
      WHERE NOT EXISTS (
        SELECT 1 FROM workspaces
        WHERE workspaces.id = records.workspace_id
      )
    `);
  }

  for (const workspaceId of workspaceIds) {
    await db.execute(sql`
      DELETE FROM pgboss.job
      WHERE name = 'meiye-p1-jobs'
        AND data ->> 'workspaceId' = ${workspaceId}
    `);
    await db.execute(sql`
      DELETE FROM p1_job_tracer WHERE workspace_id = ${workspaceId}
    `);
    for (const table of [
      'model_quality_evaluation_cases',
      'model_quality_evaluation_runs',
      'model_revision_rollback_audits',
      'model_prompt_heads',
      'model_generation_jobs',
      'model_catalog_heads',
      'model_workspace_preferences',
      'model_user_preferences',
      'model_catalog_revisions',
      'model_quality_events',
      'model_video_workflows',
    ]) {
      await db.execute(
        sql`DELETE FROM ${sql.raw(table)} WHERE workspace_id = ${workspaceId}`
      );
    }
  }
}

export const Route = createFileRoute('/api/e2e/users')({
  server: {
    handlers: {
      PATCH: async ({ request }) => {
        const accessError = assertE2EAccess(request);
        if (accessError) return accessError;

        const body = (await request.json()) as {
          email?: unknown;
          emailVerified?: unknown;
          role?: unknown;
        };
        const email = typeof body.email === 'string' ? body.email : '';

        if (!isE2EEmail(email)) {
          return Response.json(
            { error: 'Invalid test email' },
            { status: 400 }
          );
        }

        const updates: {
          emailVerified?: boolean;
          role?: string | null;
          updatedAt: Date;
        } = { updatedAt: new Date() };

        if (typeof body.emailVerified === 'boolean') {
          updates.emailVerified = body.emailVerified;
        }
        if (
          body.role === null ||
          body.role === 'admin' ||
          body.role === 'user'
        ) {
          updates.role = body.role === 'user' ? null : body.role;
        }

        const [updatedUser] = await getDb()
          .update(user)
          .set(updates)
          .where(eq(user.email, email))
          .returning({
            id: user.id,
            email: user.email,
            emailVerified: user.emailVerified,
            role: user.role,
          });

        if (!updatedUser) {
          return Response.json({ error: 'User not found' }, { status: 404 });
        }

        return Response.json({ user: updatedUser });
      },
      DELETE: async ({ request }) => {
        const accessError = assertE2EAccess(request);
        if (accessError) return accessError;

        const db = getDb();
        const rows = await db
          .select({ id: user.id, role: user.role })
          .from(user)
          .where(like(user.email, TEST_EMAIL_PATTERN));
        const platformAdmins = await db
          .select({ id: user.id })
          .from(user)
          .where(eq(user.role, 'admin'));
        const preservedAdminId =
          platformAdmins.find(
            (admin) => !rows.some((row) => row.id === admin.id)
          )?.id ?? rows.find((row) => row.role === 'admin')?.id;
        const userIds = rows
          .filter((row) => row.id !== preservedAdminId)
          .map((row) => row.id);

        if (userIds.length === 0) {
          await cleanupE2ERuntime(db, []);
          return Response.json({ deleted: 0 });
        }

        const membershipRows = await db
          .select({ workspaceId: workspaceMemberships.workspaceId })
          .from(workspaceMemberships)
          .where(inArray(workspaceMemberships.userId, userIds));
        const workspaceIds = [
          ...new Set(membershipRows.map((row) => row.workspaceId)),
        ];

        await cleanupE2ERuntime(db, workspaceIds);

        await db.delete(session).where(inArray(session.userId, userIds));
        await db.delete(account).where(inArray(account.userId, userIds));
        await db.delete(payment).where(inArray(payment.userId, userIds));
        await db.delete(userFiles).where(inArray(userFiles.userId, userIds));
        if (workspaceIds.length > 0) {
          for (const workspaceId of workspaceIds) {
            await db.execute(sql`
              DELETE FROM advanced_canvas_revisions
              WHERE workspace_id = ${workspaceId}
            `);
          }
          await db
            .delete(workspaces)
            .where(inArray(workspaces.id, workspaceIds));
        }
        await db.delete(user).where(inArray(user.id, userIds));

        return Response.json({ deleted: userIds.length });
      },
    },
  },
});
