import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  acquireLock,
  applyDirectoryDiff,
  diffDirectories,
  isPidAlive,
  readAliveDevHeartbeat,
  removeDevHeartbeat,
  writeDevHeartbeat,
} from './paraglide-sync';

async function makeTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

function exitedPid(): number {
  const child = spawnSync(process.execPath, ['-e', '']);
  assert.equal(child.status, 0);
  assert.ok(typeof child.pid === 'number');
  return child.pid;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

test('diffDirectories reports changed, added, and removed files', async () => {
  const stage = await makeTempDir('paraglide-stage-');
  const target = await makeTempDir('paraglide-target-');
  await writeFile(join(stage, 'same.js'), 'same');
  await writeFile(join(target, 'same.js'), 'same');
  await writeFile(join(stage, 'modified.js'), 'new content');
  await writeFile(join(target, 'modified.js'), 'old content');
  await mkdir(join(stage, 'nested'), { recursive: true });
  await writeFile(join(stage, 'nested', 'added.js'), 'added');
  await mkdir(join(target, 'legacy'), { recursive: true });
  await writeFile(join(target, 'legacy', 'removed.js'), 'removed');

  const diff = await diffDirectories(stage, target);
  assert.deepEqual(diff.changed, ['modified.js', 'nested/added.js']);
  assert.deepEqual(diff.removed, ['legacy/removed.js']);
});

test('diffDirectories on identical trees is empty', async () => {
  const stage = await makeTempDir('paraglide-stage-');
  const target = await makeTempDir('paraglide-target-');
  await mkdir(join(stage, 'messages'), { recursive: true });
  await mkdir(join(target, 'messages'), { recursive: true });
  await writeFile(join(stage, 'messages', 'en.js'), 'export {}');
  await writeFile(join(target, 'messages', 'en.js'), 'export {}');

  const diff = await diffDirectories(stage, target);
  assert.deepEqual(diff.changed, []);
  assert.deepEqual(diff.removed, []);
});

test('diffDirectories treats a missing target directory as all-new', async () => {
  const stage = await makeTempDir('paraglide-stage-');
  await writeFile(join(stage, 'runtime.js'), 'export {}');

  const diff = await diffDirectories(stage, join(stage, 'does-not-exist'));
  assert.deepEqual(diff.changed, ['runtime.js']);
  assert.deepEqual(diff.removed, []);
});

test('applyDirectoryDiff writes only the diff and keeps unchanged mtimes', async () => {
  const stage = await makeTempDir('paraglide-stage-');
  const target = await makeTempDir('paraglide-target-');
  await writeFile(join(stage, 'same.js'), 'same');
  await writeFile(join(target, 'same.js'), 'same');
  await writeFile(join(stage, 'modified.js'), 'new content');
  await writeFile(join(target, 'modified.js'), 'old content');
  await mkdir(join(stage, 'nested'), { recursive: true });
  await writeFile(join(stage, 'nested', 'added.js'), 'added');
  await mkdir(join(target, 'legacy'), { recursive: true });
  await writeFile(join(target, 'legacy', 'removed.js'), 'removed');
  const untouchedBefore = await stat(join(target, 'same.js'));

  const diff = await diffDirectories(stage, target);
  await applyDirectoryDiff(stage, target, diff);

  const untouchedAfter = await stat(join(target, 'same.js'));
  assert.equal(untouchedBefore.mtimeMs, untouchedAfter.mtimeMs);
  assert.equal(
    await readFile(join(target, 'modified.js'), 'utf8'),
    'new content'
  );
  assert.equal(
    await readFile(join(target, 'nested', 'added.js'), 'utf8'),
    'added'
  );
  assert.equal(await fileExists(join(target, 'legacy', 'removed.js')), false);
  // The emptied directory is pruned (structure-flip residue cleanup).
  assert.equal(await fileExists(join(target, 'legacy')), false);
  const followUp = await diffDirectories(stage, target);
  assert.deepEqual(followUp.changed, []);
  assert.deepEqual(followUp.removed, []);
});

test('acquireLock queues a second locker until release', async () => {
  const base = await makeTempDir('paraglide-lock-');
  const lockDir = join(base, '.paraglide.lock');
  const releaseFirst = await acquireLock(lockDir, { pollMs: 20 });
  let secondAcquired = false;
  const secondLocker = acquireLock(lockDir, {
    pollMs: 20,
    timeoutMs: 5_000,
  }).then((release) => {
    secondAcquired = true;
    return release;
  });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 120));
  assert.equal(secondAcquired, false);
  releaseFirst();
  const releaseSecond = await secondLocker;
  assert.equal(secondAcquired, true);
  releaseSecond();
});

test('acquireLock steals a lock whose owner pid is dead', async () => {
  const base = await makeTempDir('paraglide-lock-');
  const lockDir = join(base, '.paraglide.lock');
  await mkdir(lockDir);
  await writeFile(
    join(lockDir, 'owner.json'),
    JSON.stringify({ pid: exitedPid(), createdAt: Date.now() })
  );
  const release = await acquireLock(lockDir, { pollMs: 20, timeoutMs: 2_000 });
  release();
  assert.equal(await fileExists(lockDir), false);
});

test('acquireLock times out while a live owner holds the lock', async () => {
  const base = await makeTempDir('paraglide-lock-');
  const lockDir = join(base, '.paraglide.lock');
  const release = await acquireLock(lockDir, { pollMs: 20 });
  await assert.rejects(
    acquireLock(lockDir, { pollMs: 20, timeoutMs: 150 }),
    /timed out/
  );
  release();
});

test('readAliveDevHeartbeat validates pid liveness', async () => {
  const base = await makeTempDir('paraglide-heartbeat-');
  const heartbeat = join(base, '.paraglide-dev.json');

  writeDevHeartbeat(heartbeat, process.pid);
  const alive = readAliveDevHeartbeat(heartbeat);
  assert.equal(alive?.pid, process.pid);

  writeDevHeartbeat(heartbeat, exitedPid());
  assert.equal(readAliveDevHeartbeat(heartbeat), undefined);
  // Stale heartbeat is cleaned up so later runs skip the parse.
  assert.equal(await fileExists(heartbeat), false);

  assert.equal(readAliveDevHeartbeat(heartbeat), undefined);
});

test('removeDevHeartbeat only removes its own pid file', async () => {
  const base = await makeTempDir('paraglide-heartbeat-');
  const heartbeat = join(base, '.paraglide-dev.json');
  writeDevHeartbeat(heartbeat, process.pid);

  removeDevHeartbeat(heartbeat, process.pid + 1);
  assert.equal(await fileExists(heartbeat), true);

  removeDevHeartbeat(heartbeat, process.pid);
  assert.equal(await fileExists(heartbeat), false);
});

test('isPidAlive distinguishes live and exited pids', () => {
  assert.equal(isPidAlive(process.pid), true);
  assert.equal(isPidAlive(exitedPid()), false);
});
