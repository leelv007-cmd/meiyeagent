import { pathToFileURL } from 'node:url';
import { hashPassword } from 'better-auth/crypto';
import postgres from 'postgres';
import {
  parseOfflinePasswordResetArguments,
  resetPasswordOffline,
  type OfflinePasswordResetRepository,
} from '../src/auth/offline-password-reset';

const MAX_STDIN_BYTES = 1024;

async function readPasswordFromStdin() {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > MAX_STDIN_BYTES)
      throw new Error('Password stdin is too large.');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks)
    .toString('utf8')
    .replace(/[\r\n]+$/u, '');
}

function databaseConnectionString() {
  const value =
    process.env.DATABASE_URL ?? process.env.HYPERDRIVE_CONNECTION_STRING;
  if (!value) {
    throw new Error(
      'DATABASE_URL or HYPERDRIVE_CONNECTION_STRING must be configured.'
    );
  }
  return value;
}

async function run() {
  const options = parseOfflinePasswordResetArguments(process.argv.slice(2));
  const password = await readPasswordFromStdin();
  const sql = postgres(databaseConnectionString(), { max: 1, prepare: false });
  const repository: OfflinePasswordResetRepository = {
    resetCredential: (input) =>
      sql.begin(async (transaction) => {
        const users = await transaction<
          Array<{ email: string; id: string }>
        >`SELECT "id", "email"
          FROM "user"
          WHERE LOWER("email") = LOWER(${input.email})
          LIMIT 2
          FOR UPDATE`;
        if (users.length !== 1) {
          throw new Error(
            users.length === 0
              ? 'Credential user was not found.'
              : 'Email matches more than one credential user.'
          );
        }
        const target = users[0]!;
        const accounts = await transaction<Array<{ id: string }>>`
          SELECT "id"
          FROM "account"
          WHERE "user_id" = ${target.id} AND "provider_id" = 'credential'
          FOR UPDATE
        `;
        if (accounts.length !== 1) {
          throw new Error(
            accounts.length === 0
              ? 'Credential account was not found for this user.'
              : 'More than one credential account exists for this user.'
          );
        }
        await transaction`
          UPDATE "account"
          SET "password" = ${input.passwordHash}, "updated_at" = NOW()
          WHERE "id" = ${accounts[0]!.id}
        `;
        const revoked = await transaction<Array<{ id: string }>>`
          DELETE FROM "session" WHERE "user_id" = ${target.id} RETURNING "id"
        `;
        return { revokedSessions: revoked.length, userId: target.id };
      }),
  };

  try {
    const result = await resetPasswordOffline(
      { email: options.email, password },
      { hashPassword, repository }
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  run().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Offline password reset failed.'}\n`
    );
    process.exitCode = 1;
  });
}
