/**
 * Shared helpers for the locale:compile concurrency fix (#266).
 *
 * Five writers race for src/locale/paraglide (CLI compile, vite dev plugin,
 * e2e precompile, plus the gates that prefix them). These helpers give the
 * CLI side:
 * - write-if-changed directory sync (stage → outdir, per-file diff),
 * - a mkdir-based mutex with stale-lock recovery,
 * - a dev-server heartbeat file with pid-liveness validation.
 */
import {
  type Dirent,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rm,
  rmdir,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const WEB_ROOT = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '..',
  '..'
);

/** Paraglide compiler output consumed by app code and the gates. */
export const PARAGLIDE_OUTDIR = join(WEB_ROOT, 'src', 'locale', 'paraglide');
/** mkdir-based mutex serializing CLI compiles (gitignored). */
export const PARAGLIDE_LOCK_DIR = join(
  WEB_ROOT,
  'src',
  'locale',
  '.paraglide.lock'
);
/** Heartbeat dropped by `vite dev` so compiles can detect a live server. */
export const DEV_HEARTBEAT_FILE = join(
  WEB_ROOT,
  'src',
  'locale',
  '.paraglide-dev.json'
);
/** Scratch root for staged compiles (never read across runs). */
export const STAGE_ROOT_DIR = join(
  WEB_ROOT,
  'node_modules',
  '.cache',
  'paraglide-stage'
);

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

async function listFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(current: string, prefix: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if (prefix === '' && errorCode(error) === 'ENOENT') {
        return;
      }
      throw error;
    }
    for (const entry of entries) {
      const relativePath =
        prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(join(current, entry.name), relativePath);
      } else if (entry.isFile()) {
        files.push(relativePath);
      }
    }
  }
  await walk(root, '');
  return files.sort();
}

export interface DirectoryDiff {
  /** Present in stage but missing from or different in the target. */
  changed: string[];
  /** Present in the target but absent from stage. */
  removed: string[];
}

export async function diffDirectories(
  stageDir: string,
  targetDir: string
): Promise<DirectoryDiff> {
  const [stageFiles, targetFiles] = await Promise.all([
    listFiles(stageDir),
    listFiles(targetDir),
  ]);
  const targetSet = new Set(targetFiles);
  const changed: string[] = [];
  for (const relativePath of stageFiles) {
    if (!targetSet.has(relativePath)) {
      changed.push(relativePath);
      continue;
    }
    const [staged, current] = await Promise.all([
      readFile(join(stageDir, relativePath)),
      readFile(join(targetDir, relativePath)),
    ]);
    if (!staged.equals(current)) {
      changed.push(relativePath);
    }
  }
  const stageSet = new Set(stageFiles);
  const removed = targetFiles.filter(
    (relativePath) => !stageSet.has(relativePath)
  );
  return { changed, removed };
}

async function pruneEmptyDirectories(dir: string): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const child = join(dir, entry.name);
    await pruneEmptyDirectories(child);
    try {
      const remaining = await readdir(child);
      if (remaining.length === 0) {
        await rmdir(child);
      }
    } catch {
      // Best effort: a concurrent writer re-populating the directory wins.
    }
  }
}

/**
 * Write-if-changed sync: copies `diff.changed` from stage into the target,
 * unlinks `diff.removed`, prunes emptied directories. Files outside the diff
 * are never touched, so their mtimes stay stable.
 */
export async function applyDirectoryDiff(
  stageDir: string,
  targetDir: string,
  diff: DirectoryDiff
): Promise<void> {
  for (const relativePath of diff.changed) {
    const targetPath = join(targetDir, relativePath);
    await mkdir(dirname(targetPath), { recursive: true });
    await copyFile(join(stageDir, relativePath), targetPath);
  }
  for (const relativePath of diff.removed) {
    await rm(join(targetDir, relativePath), { force: true });
  }
  await pruneEmptyDirectories(targetDir);
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === 'EPERM';
  }
}

export interface DevHeartbeat {
  pid: number;
  startedAt: number;
}

export function writeDevHeartbeat(
  file: string,
  pid: number = process.pid
): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ pid, startedAt: Date.now() })}\n`);
}

/** Removes the heartbeat only when `pid` still owns it (restart-safe). */
export function removeDevHeartbeat(
  file: string,
  pid: number = process.pid
): void {
  try {
    const owner = JSON.parse(readFileSync(file, 'utf8')) as DevHeartbeat;
    if (owner.pid !== pid) {
      return;
    }
    rmSync(file, { force: true });
  } catch {
    // Best effort: missing or foreign file is fine.
  }
}

/**
 * Returns the heartbeat when its pid is still alive; stale files (dead pid,
 * unparsable content) are cleaned up and reported as "no dev server".
 */
export function readAliveDevHeartbeat(file: string): DevHeartbeat | undefined {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
  let parsed: Partial<DevHeartbeat> | undefined;
  try {
    parsed = JSON.parse(raw) as Partial<DevHeartbeat>;
  } catch {
    parsed = undefined;
  }
  if (typeof parsed?.pid === 'number' && isPidAlive(parsed.pid)) {
    return { pid: parsed.pid, startedAt: parsed.startedAt ?? 0 };
  }
  try {
    rmSync(file, { force: true });
  } catch {
    // Best effort.
  }
  return undefined;
}

export interface LockOptions {
  timeoutMs?: number;
  pollMs?: number;
  staleMs?: number;
}

const DEFAULT_LOCK_TIMEOUT_MS = 180_000;
const DEFAULT_LOCK_POLL_MS = 250;
const DEFAULT_LOCK_STALE_MS = 600_000;

interface LockOwner {
  pid?: number;
  createdAt?: number;
}

function isLockStale(lockDir: string, staleMs: number): boolean {
  let owner: LockOwner | undefined;
  try {
    owner = JSON.parse(
      readFileSync(join(lockDir, 'owner.json'), 'utf8')
    ) as LockOwner;
  } catch {
    owner = undefined;
  }
  if (typeof owner?.pid === 'number' && !isPidAlive(owner.pid)) {
    return true;
  }
  let birth = owner?.createdAt;
  if (birth === undefined) {
    try {
      birth = statSync(lockDir).mtimeMs;
    } catch {
      // Lock vanished between attempts; not stale, just retry.
      return false;
    }
  }
  return Date.now() - birth > staleMs;
}

function stealLock(lockDir: string): void {
  // Atomic rename so only one waiter wins the steal; losers just retry.
  const trash = `${lockDir}.stale-${process.pid}-${Date.now()}`;
  try {
    renameSync(lockDir, trash);
  } catch {
    return;
  }
  rmSync(trash, { recursive: true, force: true });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

/**
 * mkdir-based mutex. Queues (polls) while another holder is alive, steals
 * locks whose owner pid is dead or older than `staleMs`, and errors after
 * `timeoutMs`. Returns a release function.
 */
export async function acquireLock(
  lockDir: string,
  options: LockOptions = {}
): Promise<() => void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const pollMs = options.pollMs ?? DEFAULT_LOCK_POLL_MS;
  const staleMs = options.staleMs ?? DEFAULT_LOCK_STALE_MS;
  const startedAt = Date.now();
  for (;;) {
    try {
      mkdirSync(lockDir);
      writeFileSync(
        join(lockDir, 'owner.json'),
        `${JSON.stringify({ pid: process.pid, createdAt: Date.now() })}\n`
      );
      let released = false;
      return () => {
        if (released) {
          return;
        }
        released = true;
        rmSync(lockDir, { recursive: true, force: true });
      };
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') {
        throw error;
      }
    }
    if (isLockStale(lockDir, staleMs)) {
      stealLock(lockDir);
      continue;
    }
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(
        `[locale:compile] timed out after ${timeoutMs}ms waiting for ` +
          `${lockDir}; another locale compile appears stuck. Remove the ` +
          'directory manually if no compile is running.'
      );
    }
    await delay(pollMs);
  }
}
