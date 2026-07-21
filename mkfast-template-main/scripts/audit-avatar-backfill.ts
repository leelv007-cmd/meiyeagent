import { spawn } from 'node:child_process';
import postgres from 'postgres';
import {
  buildLegacyAvatarBackfillPlan,
  executeLegacyAvatarBackfillPlan,
  type LegacyAvatarBackfillRecord,
  type LegacyAvatarUser,
  parseAvatarBackfillArguments,
} from '../src/storage/avatar-backfill';
import { AVATAR_MAX_FILE_SIZE } from '../src/storage/upload-policy';

interface AvatarUserRow {
  image: string;
  updated_at: Date;
  user_id: string;
  workspace_ids: string[];
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be configured.`);
  return value;
}

function databaseConnectionString(): string {
  return (
    process.env.DATABASE_URL?.trim() ||
    requiredEnvironment('HYPERDRIVE_CONNECTION_STRING')
  );
}

function readRemoteObject(
  bucket: string,
  key: string
): Promise<Uint8Array | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'pnpm',
      [
        'exec',
        'wrangler',
        'r2',
        'object',
        'get',
        `${bucket}/${key}`,
        '--remote',
        '--pipe',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    const output: Buffer[] = [];
    const errors: Buffer[] = [];
    let outputBytes = 0;
    let exceededLimit = false;

    child.stdout.on('data', (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > AVATAR_MAX_FILE_SIZE) {
        exceededLimit = true;
        child.kill('SIGTERM');
        return;
      }
      output.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (Buffer.concat(errors).byteLength < 16 * 1024) errors.push(chunk);
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (exceededLimit) {
        reject(new Error('R2 object exceeds the current avatar size policy'));
        return;
      }
      if (code === 0) {
        resolve(new Uint8Array(Buffer.concat(output)));
        return;
      }
      const message = Buffer.concat(errors).toString('utf8');
      if (/NoSuchKey|not found|does not exist/iu.test(message)) {
        resolve(null);
        return;
      }
      reject(new Error('Wrangler could not inspect the R2 object'));
    });
  });
}

async function insertIfStillEligible(
  sql: postgres.Sql,
  record: LegacyAvatarBackfillRecord
): Promise<boolean> {
  return sql.begin(async (transaction) => {
    await transaction.unsafe('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    await transaction`SELECT pg_advisory_xact_lock(hashtextextended(${record.r2Key}, 0))`;
    const [currentUser] = await transaction<
      Array<{ image: string | null; updated_at: Date }>
    >`SELECT "image", "updated_at"
      FROM "user"
      WHERE "id" = ${record.userId}
      FOR UPDATE`;
    if (!currentUser || currentUser.image !== record.image) return false;

    const memberships = await transaction<Array<{ workspace_id: string }>>`
      SELECT "workspace_id"
      FROM "workspace_memberships"
      WHERE "user_id" = ${record.userId}
      ORDER BY "workspace_id"
    `;
    if (
      memberships.length !== 1 ||
      memberships[0]?.workspace_id !== record.workspaceId
    ) {
      return false;
    }

    const duplicateReferences = await transaction<Array<{ id: string }>>`
      SELECT "id"
      FROM "user"
      WHERE "image" = ${record.image}
      ORDER BY "id"
      LIMIT 2
    `;
    if (
      duplicateReferences.length !== 1 ||
      duplicateReferences[0]?.id !== record.userId
    ) {
      return false;
    }

    const existing = await transaction<Array<{ id: string }>>`
      SELECT "id"
      FROM "user_files"
      WHERE "r2_key" = ${record.r2Key}
      LIMIT 1
    `;
    if (existing.length > 0) return false;

    await transaction`
      INSERT INTO "user_files" (
        "id", "user_id", "workspace_id", "filename", "original_name",
        "content_type", "size", "r2_key", "purpose", "is_public",
        "description", "created_at", "updated_at"
      ) VALUES (
        ${record.id}, ${record.userId}, ${record.workspaceId},
        ${record.filename}, ${record.originalName}, ${record.contentType},
        ${record.size}, ${record.r2Key}, ${record.purpose}, ${record.isPublic},
        ${record.description}, ${record.createdAt}, ${record.createdAt}
      )
    `;
    return true;
  });
}

async function main(): Promise<void> {
  const options = parseAvatarBackfillArguments(process.argv.slice(2));
  const baseUrl = requiredEnvironment('VITE_BASE_URL');
  const bucket = requiredEnvironment('AVATAR_BACKFILL_R2_BUCKET');
  const sql = postgres(databaseConnectionString(), { max: 1, prepare: false });

  try {
    const { existingKeys, users } = await sql.begin(async (transaction) => {
      await transaction.unsafe('SET TRANSACTION READ ONLY');
      const rows = await transaction<AvatarUserRow[]>`
        SELECT
          u."id" AS "user_id",
          u."image",
          u."updated_at",
          COALESCE(
            array_agg(wm."workspace_id" ORDER BY wm."workspace_id")
              FILTER (WHERE wm."workspace_id" IS NOT NULL),
            ARRAY[]::text[]
          ) AS "workspace_ids"
        FROM "user" u
        LEFT JOIN "workspace_memberships" wm ON wm."user_id" = u."id"
        WHERE u."image" IS NOT NULL AND u."image" <> ''
        GROUP BY u."id", u."image", u."updated_at"
        ORDER BY u."id"
      `;
      const managed = await transaction<Array<{ r2_key: string }>>`
        SELECT "r2_key" FROM "user_files" ORDER BY "r2_key"
      `;
      return {
        existingKeys: new Set(managed.map((row) => row.r2_key)),
        users: rows.map(
          (row): LegacyAvatarUser => ({
            image: row.image,
            updatedAt: row.updated_at,
            userId: row.user_id,
            workspaceIds: row.workspace_ids,
          })
        ),
      };
    });

    const plan = await buildLegacyAvatarBackfillPlan(
      { baseUrl, existingKeys, users },
      (key) => readRemoteObject(bucket, key)
    );
    const execution = await executeLegacyAvatarBackfillPlan(
      plan,
      options.apply,
      (record) => insertIfStillEligible(sql, record)
    );
    process.stdout.write(
      `${JSON.stringify(
        {
          counts: {
            alreadyManaged: plan.alreadyManaged,
            ambiguous: plan.ambiguous.length,
            eligible: plan.eligible.length,
            external: plan.external.length,
            missing: plan.missing.length,
          },
          execution,
          records: {
            ambiguous: plan.ambiguous,
            eligible: plan.eligible.map((record) => ({
              r2Key: record.r2Key,
              userId: record.userId,
              workspaceId: record.workspaceId,
            })),
            external: plan.external,
            missing: plan.missing,
          },
        },
        null,
        2
      )}\n`
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'Avatar backfill audit failed.'}\n`
  );
  process.exitCode = 1;
});
