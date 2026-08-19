import { randomUUID } from 'node:crypto';
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPairedRuntimeProfile } from './runtime-profile.mjs';
import {
  DEFAULT_JOB_QUEUE_PREFIX,
  connectionIdentity,
} from './runtime-fingerprint.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const LOCK_RETRY_MS = 10;
const LOCK_STALE_MS = 30_000;
const LOCK_TIMEOUT_MS = 2_000;

export const DEFAULT_STACK_STATE_PATH = resolve(
  repoRoot,
  'output/dev/stack-state.json',
);

const delay = (milliseconds) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

function lockPathFor(path) {
  return `${path}.lock`;
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function lockIsStale(raw) {
  try {
    const lock = JSON.parse(raw);
    return (
      !processIsAlive(lock.pid) ||
      Date.now() - Date.parse(lock.createdAt) > LOCK_STALE_MS
    );
  } catch {
    return true;
  }
}

export async function acquireStackStateLock(
  path = DEFAULT_STACK_STATE_PATH,
  { timeoutMs = LOCK_TIMEOUT_MS } = {},
) {
  await mkdir(dirname(path), { recursive: true });
  const lockPath = lockPathFor(path);
  const token = randomUUID();
  const deadline = Date.now() + timeoutMs;
  while (true) {
    let handle;
    try {
      handle = await open(lockPath, 'wx', 0o600);
      await handle.writeFile(
        `${JSON.stringify({ createdAt: new Date().toISOString(), pid: process.pid, token })}\n`,
        'utf8',
      );
      return {
        async release() {
          await handle.close();
          try {
            const current = JSON.parse(await readFile(lockPath, 'utf8'));
            if (current.token === token) await rm(lockPath, { force: true });
          } catch {
            // A stale-lock recovery may already have removed it.
          }
        },
      };
    } catch (error) {
      await handle?.close();
      if (!error || typeof error !== 'object' || error.code !== 'EEXIST') {
        throw error;
      }
      try {
        if (lockIsStale(await readFile(lockPath, 'utf8'))) {
          await rm(lockPath, { force: true });
          continue;
        }
      } catch {
        await rm(lockPath, { force: true });
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error('Timed out waiting for the stack state lock.');
      }
      await delay(LOCK_RETRY_MS);
    }
  }
}

function acquireStackStateLockSync(path, timeoutMs = 500) {
  mkdirSync(dirname(path), { recursive: true });
  const lockPath = lockPathFor(path);
  const token = randomUUID();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let descriptor;
    try {
      descriptor = openSync(lockPath, 'wx', 0o600);
      writeFileSync(
        descriptor,
        `${JSON.stringify({ createdAt: new Date().toISOString(), pid: process.pid, token })}\n`,
        'utf8',
      );
      return () => {
        closeSync(descriptor);
        try {
          const current = JSON.parse(readFileSync(lockPath, 'utf8'));
          if (current.token === token) rmSync(lockPath, { force: true });
        } catch {
          // The lock no longer belongs to this process.
        }
      };
    } catch (error) {
      if (descriptor !== undefined) closeSync(descriptor);
      if (!error || typeof error !== 'object' || error.code !== 'EEXIST') {
        return undefined;
      }
      try {
        if (lockIsStale(readFileSync(lockPath, 'utf8'))) {
          rmSync(lockPath, { force: true });
          continue;
        }
      } catch {
        rmSync(lockPath, { force: true });
        continue;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_RETRY_MS);
    }
  }
  return undefined;
}

export function stackStatePathFromEnv(env = process.env) {
  return env.MEIYE_STACK_STATE_PATH
    ? resolve(env.MEIYE_STACK_STATE_PATH)
    : DEFAULT_STACK_STATE_PATH;
}

export function createStackStatePayload(
  profile,
  {
    ownership = 'supervisor',
    ownerToken = randomUUID(),
    participants,
    pid = process.pid,
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
    ownership,
    ...(participants ? { participants } : {}),
    pid,
    ...(readyAt ? { readyAt } : {}),
    startedAt,
    status,
  };
}

async function readStateFile(path) {
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      const missing = new Error(
        'no running stack found (missing output/dev/stack-state.json; start with pnpm dev first)',
      );
      missing.code = 'STACK_STATE_MISSING';
      throw missing;
    }
    throw error;
  }
  try {
    return JSON.parse(raw);
  } catch {
    const invalid = new Error(
      'no running stack found (stack state file is not valid JSON)',
    );
    invalid.code = 'STACK_STATE_INVALID';
    throw invalid;
  }
}

async function writeStateFile(path, payload) {
  const temporaryPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, path);
}

function writeStateFileSync(path, payload) {
  const temporaryPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  renameSync(temporaryPath, path);
}

export async function writeStackState(
  profile,
  {
    ownerPid,
    ownerToken,
    path = DEFAULT_STACK_STATE_PATH,
    pid = process.pid,
    readyAt,
    startedAt,
    status = 'ready',
  } = {},
) {
  const lock = await acquireStackStateLock(path);
  try {
    if (!ownerToken) {
      try {
        await readStateFile(path);
        const error = new Error('Stack state already exists.');
        error.code = 'EEXIST';
        throw error;
      } catch (error) {
        if (error?.code !== 'STACK_STATE_MISSING') {
          throw error;
        }
      }
      const payload = createStackStatePayload(profile, {
        pid,
        readyAt,
        startedAt,
        status,
      });
      await writeStateFile(path, payload);
      return payload;
    }

    const current = await readStateFile(path);
    if (current.ownerToken !== ownerToken || current.pid !== ownerPid) {
      throw new Error(
        'Cannot update stack state because the stack state owner changed.',
      );
    }
    const payload = createStackStatePayload(profile, {
      ownership: current.ownership,
      ownerToken,
      participants: current.participants,
      pid: ownerPid,
      readyAt,
      startedAt,
      status,
    });
    await writeStateFile(path, payload);
    return payload;
  } finally {
    await lock.release();
  }
}

export async function claimStackState(
  profile,
  {
    ownership = 'supervisor',
    path = DEFAULT_STACK_STATE_PATH,
    pid = process.pid,
    status = 'starting',
  } = {},
) {
  const lock = await acquireStackStateLock(path);
  try {
    try {
      return {
        claimed: false,
        ownerToken: undefined,
        payload: await readStateFile(path),
      };
    } catch (error) {
      if (error?.code !== 'STACK_STATE_MISSING') {
        throw error;
      }
    }
    const ownerToken = randomUUID();
    const payload = createStackStatePayload(profile, {
      ownership,
      ownerToken,
      pid,
      status,
    });
    await writeStateFile(path, payload);
    return { claimed: true, ownerToken, payload };
  } finally {
    await lock.release();
  }
}

export async function joinStackStateParticipant(
  profile,
  { path = DEFAULT_STACK_STATE_PATH, pid = process.pid } = {},
) {
  const lock = await acquireStackStateLock(path);
  try {
    let current;
    try {
      current = await readStateFile(path);
    } catch (error) {
      if (error?.code !== 'STACK_STATE_MISSING') {
        throw error;
      }
    }

    if (current?.ownership === 'supervisor') {
      assertPairedRuntimeProfile(profile, current);
      return { expected: current, participantToken: undefined };
    }

    const liveParticipants = (current?.participants ?? []).filter((participant) =>
      processIsAlive(participant.pid),
    );
    if (current && liveParticipants.length > 0) {
      assertPairedRuntimeProfile(profile, current);
    }

    const existing = liveParticipants.find(
      (participant) => participant.pid === pid,
    );
    const participantToken = existing?.token ?? randomUUID();
    const participants = existing
      ? liveParticipants
      : [
          ...liveParticipants,
          {
            pid,
            registeredAt: new Date().toISOString(),
            token: participantToken,
          },
        ];
    const owner =
      participants.find(
        (participant) =>
          participant.pid === current?.pid &&
          participant.token === current?.ownerToken,
      ) ?? participants[0];
    const payload = createStackStatePayload(profile, {
      ownership: 'participants',
      ownerToken: owner.token,
      participants,
      pid: owner.pid,
      startedAt:
        liveParticipants.length > 0
          ? current.startedAt
          : new Date().toISOString(),
      status: 'starting',
    });
    await writeStateFile(path, payload);
    return { expected: payload, participantToken };
  } finally {
    await lock.release();
  }
}

export function leaveStackStateParticipantSync(
  path = DEFAULT_STACK_STATE_PATH,
  { participantToken, pid = process.pid } = {},
) {
  if (!participantToken) return false;
  const release = acquireStackStateLockSync(path);
  if (!release) return false;
  try {
    let current;
    try {
      current = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      return false;
    }
    if (current.ownership !== 'participants') return false;
    const participants = (current.participants ?? []).filter(
      (participant) =>
        !(participant.pid === pid && participant.token === participantToken) &&
        processIsAlive(participant.pid),
    );
    if (participants.length === 0) {
      rmSync(path, { force: true });
      return true;
    }
    const owner =
      participants.find(
        (participant) =>
          participant.pid === current.pid &&
          participant.token === current.ownerToken,
      ) ?? participants[0];
    writeStateFileSync(path, {
      ...current,
      ownerToken: owner.token,
      participants,
      pid: owner.pid,
    });
    return true;
  } finally {
    release();
  }
}

export async function readStackState(
  path = DEFAULT_STACK_STATE_PATH,
  { allowStarting = false } = {},
) {
  const parsed = await readStateFile(path);
  if (
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
  const lock = await acquireStackStateLock(path);
  try {
    let current;
    try {
      current = await readStateFile(path);
    } catch (error) {
      if (error?.code === 'STACK_STATE_MISSING') {
        return false;
      }
      throw error;
    }
    if (current.ownerToken !== ownerToken || current.pid !== ownerPid) {
      return false;
    }
    await rm(path, { force: true });
    return true;
  } finally {
    await lock.release();
  }
}
