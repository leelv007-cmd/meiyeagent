import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPairedRuntimeProfile } from './runtime-profile.mjs';
import {
  DEFAULT_JOB_QUEUE_PREFIX,
  connectionIdentity,
} from './runtime-fingerprint.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const LOCK_RETRY_MS = 10;
const LOCK_TIMEOUT_MS = 2_000;
const UNOWNED_LOCK_GRACE_MS = 1_000;

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

function lockOwnerPath(lockPath) {
  return join(lockPath, 'owner.json');
}

async function publishLockOwner(lockPath, owner) {
  const temporaryPath = join(lockPath, `.owner-${owner.token}.tmp`);
  await writeFile(temporaryPath, `${JSON.stringify(owner)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await rename(temporaryPath, lockOwnerPath(lockPath));
}

async function inspectLock(lockPath) {
  const lockStat = await stat(lockPath);
  const ownerPath = lockStat.isDirectory()
    ? lockOwnerPath(lockPath)
    : lockPath;
  try {
    const owner = JSON.parse(await readFile(ownerPath, 'utf8'));
    if (!owner.token || !Number.isInteger(owner.pid)) {
      throw new Error('invalid owner metadata');
    }
    return {
      device: lockStat.dev,
      inode: lockStat.ino,
      owner,
      reclaimable: !processIsAlive(owner.pid),
      shape: lockStat.isDirectory() ? 'directory' : 'file',
    };
  } catch {
    return {
      device: lockStat.dev,
      inode: lockStat.ino,
      owner: undefined,
      reclaimable: Date.now() - lockStat.mtimeMs >= UNOWNED_LOCK_GRACE_MS,
      shape: lockStat.isDirectory() ? 'directory' : 'file',
    };
  }
}

async function reclaimLockWithFence(lockPath, expected) {
  if (expected.shape === 'directory' && !expected.owner) {
    await writeFile(join(lockPath, '.fence'), 'unowned-lock-fence\n', {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    }).catch((error) => {
      if (!error || typeof error !== 'object' || error.code !== 'EEXIST') {
        throw error;
      }
    });
  }

  try {
    const current = await inspectLock(lockPath);
    if (
      current.device !== expected.device ||
      current.inode !== expected.inode ||
      current.owner?.token !== expected.owner?.token ||
      (expected.owner ? !current.reclaimable : Boolean(current.owner))
    ) {
      return false;
    }
    const generation = [
      expected.device,
      expected.inode,
      expected.owner?.token ?? 'unowned',
    ].join('-');
    const quarantinePath = `${lockPath}.stale-${generation}`;
    try {
      await rename(lockPath, quarantinePath);
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        ['EEXIST', 'EISDIR', 'ENOENT', 'ENOTDIR', 'ENOTEMPTY'].includes(
          error.code,
        )
      ) {
        return true;
      }
      throw error;
    }
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return true;
    }
    throw error;
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
    try {
      await mkdir(lockPath, { mode: 0o700 });
      await publishLockOwner(lockPath, {
        createdAt: new Date().toISOString(),
        pid: process.pid,
        token,
      });
      return {
        async release() {
          try {
            const current = JSON.parse(
              await readFile(lockOwnerPath(lockPath), 'utf8'),
            );
            if (current.token === token) {
              await rm(lockPath, { force: true, recursive: true });
            }
          } catch {
            // A stale-lock recovery may already have removed it.
          }
        },
      };
    } catch (error) {
      if (!error || typeof error !== 'object' || error.code !== 'EEXIST') {
        throw error;
      }
      let reclaimed = false;
      try {
        const inspection = await inspectLock(lockPath);
        if (inspection.reclaimable) {
          reclaimed = await reclaimLockWithFence(lockPath, inspection);
        }
      } catch {
        // A concurrently reclaimed lock is retried below.
      }
      if (Date.now() >= deadline) {
        throw new Error('Timed out waiting for the stack state lock.');
      }
      await delay(LOCK_RETRY_MS);
      if (reclaimed) continue;
    }
  }
}

function acquireStackStateLockSync(path, timeoutMs = 500) {
  mkdirSync(dirname(path), { recursive: true });
  const lockPath = lockPathFor(path);
  const token = randomUUID();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      mkdirSync(lockPath, { mode: 0o700 });
      const ownerPath = lockOwnerPath(lockPath);
      const temporaryPath = join(lockPath, `.owner-${token}.tmp`);
      writeFileSync(
        temporaryPath,
        `${JSON.stringify({ createdAt: new Date().toISOString(), pid: process.pid, token })}\n`,
        { encoding: 'utf8', mode: 0o600 },
      );
      renameSync(temporaryPath, ownerPath);
      return () => {
        try {
          const current = JSON.parse(readFileSync(ownerPath, 'utf8'));
          if (current.token === token) {
            rmSync(lockPath, { force: true, recursive: true });
          }
        } catch {
          // The lock no longer belongs to this process.
        }
      };
    } catch (error) {
      if (!error || typeof error !== 'object' || error.code !== 'EEXIST') {
        return undefined;
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
    const departure = participantDeparture(current, { participantToken, pid });
    if (!departure) return false;
    if (!departure.payload) {
      rmSync(path, { force: true });
      return true;
    }
    writeStateFileSync(path, departure.payload);
    return true;
  } finally {
    release();
  }
}

function participantDeparture(current, { participantToken, pid }) {
  if (current.ownership !== 'participants') return undefined;
  const matched = (current.participants ?? []).some(
    (participant) =>
      participant.pid === pid && participant.token === participantToken,
  );
  if (!matched) return undefined;
  const participants = (current.participants ?? []).filter(
    (participant) =>
      !(participant.pid === pid && participant.token === participantToken) &&
      processIsAlive(participant.pid),
  );
  if (participants.length === 0) return { payload: undefined };
  const owner =
    participants.find(
      (participant) =>
        participant.pid === current.pid &&
        participant.token === current.ownerToken,
    ) ?? participants[0];
  return {
    payload: {
      ...current,
      ownerToken: owner.token,
      participants,
      pid: owner.pid,
    },
  };
}

export async function leaveStackStateParticipant(
  path = DEFAULT_STACK_STATE_PATH,
  { participantToken, pid = process.pid, timeoutMs = 30_000 } = {},
) {
  if (!participantToken) return false;
  const lock = await acquireStackStateLock(path, { timeoutMs });
  try {
    let current;
    try {
      current = await readStateFile(path);
    } catch (error) {
      if (error?.code === 'STACK_STATE_MISSING') return true;
      throw error;
    }
    const departure = participantDeparture(current, { participantToken, pid });
    if (!departure) return false;
    if (!departure.payload) {
      await rm(path, { force: true });
      return true;
    }
    await writeStateFile(path, departure.payload);
    return true;
  } finally {
    await lock.release();
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
