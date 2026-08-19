import { chmod, open, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Source of truth for the DATABASE_URL the running `pnpm dev` stack uses. */
export const DEFAULT_STACK_STATE_PATH = resolve(
  repoRoot,
  'output/dev/stack-state.json',
);

export function stackStatePathFromEnv(env = process.env) {
  return env.MEIYE_STACK_STATE_PATH
    ? resolve(env.MEIYE_STACK_STATE_PATH)
    : DEFAULT_STACK_STATE_PATH;
}

export function createStackStatePayload(
  profile,
  {
    pid = process.pid,
    readyAt,
    startedAt = new Date().toISOString(),
    status = 'ready',
  } = {},
) {
  if (!profile?.DATABASE_URL) {
    throw new Error('Stack state requires DATABASE_URL from the runtime profile.');
  }
  return {
    APP_ENV: profile.APP_ENV ? String(profile.APP_ENV) : undefined,
    CORE_PORT: String(profile.CORE_PORT ?? '4100'),
    DATABASE_URL: String(profile.DATABASE_URL),
    HARNESS_DBOS_SYSTEM_DATABASE_URL: profile.HARNESS_DBOS_SYSTEM_DATABASE_URL
      ? String(profile.HARNESS_DBOS_SYSTEM_DATABASE_URL)
      : undefined,
    JOB_QUEUE_PREFIX: String(profile.JOB_QUEUE_PREFIX ?? 'meiye-p1'),
    MODEL_EXECUTION_MODE: profile.MODEL_EXECUTION_MODE
      ? String(profile.MODEL_EXECUTION_MODE)
      : undefined,
    PORT: String(profile.PORT ?? '3000'),
    pid,
    ...(readyAt ? { readyAt } : {}),
    startedAt,
    status,
  };
}

export async function writeStackState(
  profile,
  {
    path = DEFAULT_STACK_STATE_PATH,
    pid = process.pid,
    readyAt,
    startedAt,
    status = 'ready',
  } = {},
) {
  const payload = createStackStatePayload(profile, {
    pid,
    readyAt,
    startedAt,
    status,
  });
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await chmod(path, 0o600);
  return payload;
}

/**
 * First writer wins. A later API/worker process must compare against the
 * claimed runtime fingerprint instead of overwriting it.
 */
export async function claimStackState(
  profile,
  { path = DEFAULT_STACK_STATE_PATH, pid = process.pid, status = 'starting' } = {},
) {
  const payload = createStackStatePayload(profile, { pid, status });
  await mkdir(dirname(path), { recursive: true });
  let handle;
  try {
    handle = await open(path, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    return { claimed: true, payload };
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'EEXIST') {
      return {
        claimed: false,
        payload: await readStackState(path, { allowStarting: true }),
      };
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

export async function readStackState(
  path = DEFAULT_STACK_STATE_PATH,
  { allowStarting = false } = {},
) {
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

  if (parsed.status === 'starting' && !allowStarting) {
    throw new Error(
      'no ready stack found (stack is starting; wait for Web and Core readiness)',
    );
  }

  if (parsed.status !== 'starting' && parsed.status !== 'ready') {
    throw new Error(
      'no running stack found (stack state has an invalid lifecycle status)',
    );
  }

  return parsed;
}

export async function clearStackState(path = DEFAULT_STACK_STATE_PATH) {
  await rm(path, { force: true });
}
