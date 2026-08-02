import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Source of truth for the DATABASE_URL the running `pnpm dev` stack uses. */
export const DEFAULT_STACK_STATE_PATH = resolve(
  repoRoot,
  'output/dev/stack-state.json',
);

export function createStackStatePayload(profile, { pid = process.pid } = {}) {
  if (!profile?.DATABASE_URL) {
    throw new Error('Stack state requires DATABASE_URL from the runtime profile.');
  }
  return {
    CORE_PORT: String(profile.CORE_PORT ?? '4100'),
    DATABASE_URL: String(profile.DATABASE_URL),
    HARNESS_DBOS_SYSTEM_DATABASE_URL: profile.HARNESS_DBOS_SYSTEM_DATABASE_URL
      ? String(profile.HARNESS_DBOS_SYSTEM_DATABASE_URL)
      : undefined,
    PORT: String(profile.PORT ?? '3000'),
    pid,
    startedAt: new Date().toISOString(),
  };
}

export async function writeStackState(
  profile,
  { path = DEFAULT_STACK_STATE_PATH, pid = process.pid } = {},
) {
  const payload = createStackStatePayload(profile, { pid });
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return payload;
}

export async function readStackState(path = DEFAULT_STACK_STATE_PATH) {
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      throw new Error(
        'no running stack found (missing output/dev/stack-state.json; start with pnpm dev first)',
      );
    }
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      'no running stack found (stack state file is not valid JSON)',
    );
  }

  if (!parsed || typeof parsed.DATABASE_URL !== 'string' || !parsed.DATABASE_URL) {
    throw new Error(
      'no running stack found (stack state is missing DATABASE_URL)',
    );
  }

  return parsed;
}

export async function clearStackState(path = DEFAULT_STACK_STATE_PATH) {
  await rm(path, { force: true });
}
