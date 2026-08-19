/**
 * Spec A / #366 — Postgres acceptance for transactional set-role.
 *
 * Driver executes with TEST_DATABASE_URL after migrations (incl. 0024).
 * Lane does not run PG-backed tests.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { eq, or } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import {
  applyPlatformRoleChange,
  LAST_ADMIN_REQUIRED_CODE,
  PLATFORM_ROLE_ADMIN,
  PLATFORM_ROLE_USER,
  PlatformRoleChangeError,
} from './admin-set-role';
import * as appSchema from '../db/app.schema';
import * as authSchema from '../db/auth.schema';

const connectionString = process.env.TEST_DATABASE_URL;

const schema = { ...authSchema, ...appSchema };

function errorChainText(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  while (current) {
    parts.push(String(current));
    current = (current as { cause?: unknown }).cause;
  }
  return parts.join('\n');
}

async function withDb(
  run: (db: ReturnType<typeof drizzle<typeof schema>>) => Promise<void>
) {
  const client = postgres(connectionString!, { max: 1, prepare: false });
  const db = drizzle(client, { schema });
  try {
    await run(db);
  } finally {
    await client.end({ timeout: 5 });
  }
}

function userRow(input: {
  id: string;
  email: string;
  role: string | null;
  name?: string;
}) {
  const now = new Date();
  return {
    id: input.id,
    name: input.name ?? input.email,
    email: input.email,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
    role: input.role,
    banned: false,
  };
}

function sessionRow(input: { id: string; userId: string; token: string }) {
  const now = new Date();
  return {
    id: input.id,
    expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    token: input.token,
    createdAt: now,
    updatedAt: now,
    userId: input.userId,
  };
}

const CLEANUP_ANCHOR_ID = 'admin-set-role-pg-cleanup-anchor';

async function ensureCleanupAnchor(
  db: ReturnType<typeof drizzle<typeof schema>>
) {
  const existingAdmin = await db
    .select({ id: authSchema.user.id })
    .from(authSchema.user)
    .where(eq(authSchema.user.role, PLATFORM_ROLE_ADMIN))
    .limit(1);
  if (existingAdmin.length > 0) return false;

  await db
    .insert(authSchema.user)
    .values(
      userRow({
        id: CLEANUP_ANCHOR_ID,
        email: 'admin-set-role-pg-cleanup-anchor@example.test',
        role: PLATFORM_ROLE_ADMIN,
      })
    )
    .onConflictDoNothing({ target: authSchema.user.id });
  await db
    .update(authSchema.user)
    .set({ role: PLATFORM_ROLE_ADMIN, updatedAt: new Date() })
    .where(eq(authSchema.user.id, CLEANUP_ANCHOR_ID));
  return true;
}

test(
  'promote/demote, last-admin refuse, session revoke, audit five fields, immutability, atomic rollback',
  {
    skip: connectionString ? false : 'TEST_DATABASE_URL is not configured',
  },
  async () => {
    await withDb(async (db) => {
      const suffix = randomUUID().slice(0, 8);
      const actorId = `role-actor-${suffix}`;
      const subjectId = `role-subject-${suffix}`;
      const thirdAdminId = `role-third-${suffix}`;

      // A fresh migrated database has no seeded platform admin. Keep one
      // stable test-only anchor so cleanup can demote the actor without
      // weakening the database-level last-admin guard.
      const cleanupAnchorCreated = await ensureCleanupAnchor(db);

      await db.insert(authSchema.user).values([
        userRow({
          id: actorId,
          email: `actor-${suffix}@example.test`,
          role: PLATFORM_ROLE_ADMIN,
        }),
        userRow({
          id: subjectId,
          email: `subject-${suffix}@example.test`,
          role: PLATFORM_ROLE_USER,
        }),
        userRow({
          id: thirdAdminId,
          email: `third-${suffix}@example.test`,
          role: PLATFORM_ROLE_ADMIN,
        }),
      ]);

      // Last-admin refusal counts admins globally; shared/template databases
      // carry seeded admins, so park them for the duration of this test
      // (after inserting test admins: a DB-level last_platform_admin_guard
      // trigger refuses demoting the final admin).
      const preexistingAdmins = await db
        .select({ id: authSchema.user.id })
        .from(authSchema.user)
        .where(eq(authSchema.user.role, PLATFORM_ROLE_ADMIN));
      const ownIds = new Set([actorId, subjectId, thirdAdminId]);
      const parkedAdminIds = preexistingAdmins
        .map((row) => row.id)
        .filter((id) => !ownIds.has(id));
      if (parkedAdminIds.length > 0) {
        await db
          .update(authSchema.user)
          .set({ role: PLATFORM_ROLE_USER })
          .where(or(...parkedAdminIds.map((id) => eq(authSchema.user.id, id))));
      }

      await db.insert(authSchema.session).values([
        sessionRow({
          id: `sess-a-${suffix}`,
          userId: subjectId,
          token: `tok-a-${suffix}`,
        }),
        sessionRow({
          id: `sess-b-${suffix}`,
          userId: subjectId,
          token: `tok-b-${suffix}`,
        }),
        sessionRow({
          id: `sess-actor-${suffix}`,
          userId: actorId,
          token: `tok-actor-${suffix}`,
        }),
      ]);

      try {
        // Promote merchant → admin: audit + session delete for subject only.
        const promote = await applyPlatformRoleChange(db, {
          actorUserId: actorId,
          subjectUserId: subjectId,
          toRole: PLATFORM_ROLE_ADMIN,
          reason: 'promote trusted peer',
        });

        assert.equal(promote.toRole, PLATFORM_ROLE_ADMIN);
        assert.equal(promote.fromRole, PLATFORM_ROLE_USER);
        assert.equal(promote.sessionsDeleted, 2);

        const subjectAfterPromote = await db
          .select({ role: authSchema.user.role })
          .from(authSchema.user)
          .where(eq(authSchema.user.id, subjectId))
          .limit(1);
        assert.equal(subjectAfterPromote[0]?.role, PLATFORM_ROLE_ADMIN);

        const subjectSessions = await db
          .select({ id: authSchema.session.id })
          .from(authSchema.session)
          .where(eq(authSchema.session.userId, subjectId));
        assert.equal(subjectSessions.length, 0);

        const actorSessions = await db
          .select({ id: authSchema.session.id })
          .from(authSchema.session)
          .where(eq(authSchema.session.userId, actorId));
        assert.equal(actorSessions.length, 1);

        const audits = await db
          .select()
          .from(appSchema.adminRoleChangeAudit)
          .where(eq(appSchema.adminRoleChangeAudit.id, promote.auditId));
        assert.equal(audits.length, 1);
        assert.equal(audits[0]?.actorUserId, actorId);
        assert.equal(audits[0]?.subjectUserId, subjectId);
        assert.equal(audits[0]?.fromRole, PLATFORM_ROLE_USER);
        assert.equal(audits[0]?.toRole, PLATFORM_ROLE_ADMIN);
        assert.equal(audits[0]?.reason, 'promote trusted peer');

        // Audit is immutable: UPDATE and DELETE must fail.
        await assert.rejects(
          async () => {
            await db
              .update(appSchema.adminRoleChangeAudit)
              .set({ reason: 'tamper' })
              .where(eq(appSchema.adminRoleChangeAudit.id, promote.auditId));
          },
          (error: unknown) => {
            assert.match(
              errorChainText(error),
              /ADMIN_ROLE_CHANGE_AUDIT_IMMUTABLE/u
            );
            return true;
          }
        );
        await assert.rejects(
          async () => {
            await db
              .delete(appSchema.adminRoleChangeAudit)
              .where(eq(appSchema.adminRoleChangeAudit.id, promote.auditId));
          },
          (error: unknown) => {
            assert.match(
              errorChainText(error),
              /ADMIN_ROLE_CHANGE_AUDIT_IMMUTABLE/u
            );
            return true;
          }
        );

        // Demote subject back to merchant while another admin remains.
        await db.insert(authSchema.session).values(
          sessionRow({
            id: `sess-d-${suffix}`,
            userId: subjectId,
            token: `tok-d-${suffix}`,
          })
        );
        const demote = await applyPlatformRoleChange(db, {
          actorUserId: actorId,
          subjectUserId: subjectId,
          toRole: PLATFORM_ROLE_USER,
          reason: 'return to merchant',
        });
        assert.equal(demote.toRole, PLATFORM_ROLE_USER);
        assert.equal(demote.fromRole, PLATFORM_ROLE_ADMIN);
        const demoteAudits = await db
          .select()
          .from(appSchema.adminRoleChangeAudit)
          .where(eq(appSchema.adminRoleChangeAudit.id, demote.auditId));
        assert.equal(demoteAudits[0]?.actorUserId, actorId);
        assert.equal(demoteAudits[0]?.subjectUserId, subjectId);
        assert.equal(demoteAudits[0]?.fromRole, PLATFORM_ROLE_ADMIN);
        assert.equal(demoteAudits[0]?.toRole, PLATFORM_ROLE_USER);
        assert.equal(demoteAudits[0]?.reason, 'return to merchant');

        // Last-admin refusal: leave only one admin (actor), demote actor.
        await db
          .update(authSchema.user)
          .set({ role: PLATFORM_ROLE_USER })
          .where(eq(authSchema.user.id, thirdAdminId));

        await assert.rejects(
          () =>
            applyPlatformRoleChange(db, {
              actorUserId: actorId,
              subjectUserId: actorId,
              toRole: PLATFORM_ROLE_USER,
              reason: 'self demote last',
            }),
          (error: unknown) => {
            assert.ok(error instanceof PlatformRoleChangeError);
            assert.equal(error.code, LAST_ADMIN_REQUIRED_CODE);
            return true;
          }
        );

        const actorStillAdmin = await db
          .select({ role: authSchema.user.role })
          .from(authSchema.user)
          .where(eq(authSchema.user.id, actorId))
          .limit(1);
        assert.equal(actorStillAdmin[0]?.role, PLATFORM_ROLE_ADMIN);

        // Atomic rollback: role update + session delete must not stick when
        // the transaction throws before commit.
        await db.insert(authSchema.session).values(
          sessionRow({
            id: `sess-e-${suffix}`,
            userId: subjectId,
            token: `tok-e-${suffix}`,
          })
        );

        let partialSteps = 0;
        await assert.rejects(async () => {
          await db.transaction(async (tx) => {
            partialSteps += 1;
            await tx
              .update(authSchema.user)
              .set({ role: PLATFORM_ROLE_ADMIN })
              .where(eq(authSchema.user.id, subjectId));
            partialSteps += 1;
            await tx
              .delete(authSchema.session)
              .where(eq(authSchema.session.userId, subjectId));
            partialSteps += 1;
            throw new Error('forced-rollback');
          });
        });

        const rolledBackUser = await db
          .select({ role: authSchema.user.role })
          .from(authSchema.user)
          .where(eq(authSchema.user.id, subjectId))
          .limit(1);
        assert.equal(rolledBackUser[0]?.role, PLATFORM_ROLE_USER);
        const rolledBackSessions = await db
          .select({ id: authSchema.session.id })
          .from(authSchema.session)
          .where(eq(authSchema.session.userId, subjectId));
        assert.equal(rolledBackSessions.length, 1);
        assert.ok(partialSteps >= 2);
      } finally {
        // Audit rows are immutable but store principal ids as text, not FKs.
        // Restore an admin first, then remove every random test user/session.
        if (parkedAdminIds.length > 0) {
          await db
            .update(authSchema.user)
            .set({ role: PLATFORM_ROLE_ADMIN })
            .where(
              or(...parkedAdminIds.map((id) => eq(authSchema.user.id, id)))
            );
        }
        await db
          .delete(authSchema.session)
          .where(
            or(
              eq(authSchema.session.userId, actorId),
              eq(authSchema.session.userId, subjectId),
              eq(authSchema.session.userId, thirdAdminId)
            )
          );
        await db
          .delete(authSchema.user)
          .where(
            or(
              eq(authSchema.user.id, actorId),
              eq(authSchema.user.id, subjectId),
              eq(authSchema.user.id, thirdAdminId)
            )
          );

        const retainedRandomUsers = await db
          .select({ id: authSchema.user.id })
          .from(authSchema.user)
          .where(
            or(
              eq(authSchema.user.id, actorId),
              eq(authSchema.user.id, subjectId),
              eq(authSchema.user.id, thirdAdminId)
            )
          );
        assert.equal(retainedRandomUsers.length, 0);

        const retainedSessions = await db
          .select({ id: authSchema.session.id })
          .from(authSchema.session)
          .where(
            or(
              eq(authSchema.session.userId, actorId),
              eq(authSchema.session.userId, subjectId),
              eq(authSchema.session.userId, thirdAdminId)
            )
          );
        assert.equal(retainedSessions.length, 0);

        if (cleanupAnchorCreated) {
          const cleanupAnchors = await db
            .select({
              email: authSchema.user.email,
              id: authSchema.user.id,
              role: authSchema.user.role,
            })
            .from(authSchema.user)
            .where(eq(authSchema.user.id, CLEANUP_ANCHOR_ID));
          assert.deepEqual(cleanupAnchors, [
            {
              email: 'admin-set-role-pg-cleanup-anchor@example.test',
              id: CLEANUP_ANCHOR_ID,
              role: PLATFORM_ROLE_ADMIN,
            },
          ]);
        }
      }
    });
  }
);
