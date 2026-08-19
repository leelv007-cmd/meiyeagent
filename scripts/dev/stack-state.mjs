import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { chmod, open, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_JOB_QUEUE_PREFIX,
  connectionIdentity,
} from './runtime-fingerprint.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Non-secret runtime identity for the active `pnpm dev` stack. */
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
    ownerToken = randomUUID(),
    readyAt,
    startedAt = new Date().toISOString(),
    status = 'ready',
  } = {},
) {
  if (!profile?.DATABASE_URL) {
    throw new Error('Stack state requires DATABASE_URL from the runtime profile.');
  }
  const business = connectionIdentity(profile.DATABASE_URL);
  const dbos = connectionIdentity(profile.HARNESS_DBOS_SYSTEM_DATABASE_URL);
  return {
    APP_ENV: profile.APP_ENV ? String(profile.APP_ENV) : undefined,
    CORE_PORT: String(profile.CORE_PORT ?? '4100'),
    DATABASE_FINGERPRINT: business.fingerprint,
    DATABASE_HOST: business.host,
    DATABASE_PORT: business.port,
    HARNESS_DBOS_SYSTEM_DATABASE_FINGERPRINT: dbos.fingerprint,
    HARNESS_DBOS_SYSTEM_DATABASE_HOST: dbos.host,
    HARNESS_DBOS_SYSTEM_DATABASE_PORT: dbos.port,
    JOB_QUEUE_PREFIX: String(
      profile.JOB_QUEUE_PREFIX ?? DEFAULT_JOB_QUEUE_PREFIX,
    ),
    MODEL_EXECUTION_MODE: profile.MODEL_EXECUTION_MODE
      ? String(profile.MODEL_EXECUTION_MODE)
      : undefined,
    PORT: String(profile.PORT ?? '3000'),
    ownerToken,
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
    ownerPid,
    ownerToken,
    readyAt,
    startedAt,
    status = 'ready',
  } = {},
) {
  await mkdir(dirname(path), { recursive: true });
  if (!ownerToken) {
    const payload = createStackStatePayload(profile, {
      pid,
      readyAt,
      startedAt,
      status,
    });
    const handle = await open(path, 'wx', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    } finally {
      await handle.close();
    }
    return payload;
  }

  const current = await readStackState(path, { allowStarting: true });
  if (current.ownerToken !== ownerToken || current.pid !== ownerPid) {
    throw new Error(
      'Cannot update stack state because the stack state owner changed.',
    );
  }
  const payload = createStackStatePayload(profile, {
    ownerToken,
    pid: ownerPid ?? pid,
    readyAt,
    startedAt,
    status,
  });
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
  const ownerToken = randomUUID();
  const payload = createStackStatePayload(profile, { ownerToken, pid, status });
  await mkdir(dirname(path), { recursive: true });
  let handle;
  try {
    handle = await open(path, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    return { claimed: true, ownerToken, payload };
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'EEXIST') {
      return {
        claimed: false,
        ownerToken: undefined,
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

  if (
    !parsed ||
    typeof parsed.DATABASE_FINGERPRINT !== 'string' ||
    !parsed.DATABASE_FINGERPRINT ||
    typeof parsed.ownerToken !== 'string' ||
    !parsed.ownerToken
  ) {
    throw new Error(
      'no running stack found (stack state is missing its runtime fingerprint or owner)',
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

export async function clearStackState(
  path = DEFAULT_STACK_STATE_PATH,
  { ownerPid, ownerToken } = {},
) {
  if (!ownerToken || !Number.isInteger(ownerPid)) {
    throw new Error('A stack state owner is required before clearing state.');
  }
  let current;
  try {
    current = await readStackState(path, { allowStarting: true });
  } catch (error) {
    if (error instanceof Error && error.message.includes('no running stack')) {
      return false;
    }
    throw error;
  }
  if (current.ownerToken !== ownerToken || current.pid !== ownerPid) {
    return false;
  }
  await rm(path, { force: true });
  return true;
}

export function clearStackStateSync(
  path = DEFAULT_STACK_STATE_PATH,
  { ownerPid, ownerToken } = {},
) {
  if (!ownerToken || !Number.isInteger(ownerPid)) return false;
  try {
    const current = JSON.parse(readFileSync(path, 'utf8'));
    if (current.ownerToken !== ownerToken || current.pid !== ownerPid) {
      return false;
    }
    rmSync(path, { force: true });
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return false;
    }
    return false;
  }
}
