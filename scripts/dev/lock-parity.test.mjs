import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  assertFrozenInstallParity,
  assertMiniflareWorkerdV8FlagsSupport,
} from './lock-parity.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const startStackScript = resolve(here, 'start-stack.mjs');

function runStartStack(env) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [startStackScript], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.on('exit', (code) => resolveRun({ code, output }));
  });
}

test('frozen install preflight accepts byte-identical lockfiles', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'meiye-lock-parity-match-'));
  const rootLockPath = join(directory, 'pnpm-lock.yaml');
  const virtualStoreLockPath = join(directory, 'node_modules/.pnpm/lock.yaml');
  try {
    await mkdir(join(directory, 'node_modules/.pnpm'), { recursive: true });
    await writeFile(rootLockPath, 'lockfileVersion: 9.0\n', 'utf8');
    await writeFile(virtualStoreLockPath, 'lockfileVersion: 9.0\n', 'utf8');
    await assert.doesNotReject(() =>
      assertFrozenInstallParity({ rootLockPath, virtualStoreLockPath }),
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('frozen install preflight rejects a missing virtual-store lock', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'meiye-lock-parity-missing-'));
  const rootLockPath = join(directory, 'pnpm-lock.yaml');
  const virtualStoreLockPath = join(directory, 'node_modules/.pnpm/lock.yaml');
  try {
    await writeFile(rootLockPath, 'lockfileVersion: 9.0\n', 'utf8');
    await assert.rejects(
      () => assertFrozenInstallParity({ rootLockPath, virtualStoreLockPath }),
      /pnpm install --frozen-lockfile/u,
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('frozen install preflight rejects drift without printing lock contents', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'meiye-lock-parity-drift-'));
  const rootLockPath = join(directory, 'pnpm-lock.yaml');
  const virtualStoreLockPath = join(directory, 'node_modules/.pnpm/lock.yaml');
  const secretMarker = 'postgres://operator:never-print@db.invalid/private';
  try {
    await mkdir(join(directory, 'node_modules/.pnpm'), { recursive: true });
    await writeFile(rootLockPath, `lockfileVersion: 9.0\n# ${secretMarker}\n`, 'utf8');
    await writeFile(virtualStoreLockPath, 'lockfileVersion: 8.0\n', 'utf8');
    await assert.rejects(
      () => assertFrozenInstallParity({ rootLockPath, virtualStoreLockPath }),
      (error) => {
        assert.match(error.message, /pnpm install --frozen-lockfile/u);
        assert.doesNotMatch(error.message, /never-print/u);
        return true;
      },
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('pnpm dev preflight rejects stale install before runtime profile or state mutation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'meiye-start-stack-stale-'));
  const rootLockPath = join(directory, 'pnpm-lock.yaml');
  const virtualStoreLockPath = join(directory, 'node_modules/.pnpm/lock.yaml');
  const statePath = join(directory, 'stack-state.json');
  const secretMarker = 'postgres://operator:never-print@db.invalid/private';
  try {
    await mkdir(join(directory, 'node_modules/.pnpm'), { recursive: true });
    await writeFile(rootLockPath, 'lockfileVersion: 9.0\n', 'utf8');
    await writeFile(virtualStoreLockPath, 'lockfileVersion: 8.0\n', 'utf8');
    const result = await runStartStack({
      DATABASE_URL: '',
      MEIYE_ROOT_LOCK_PATH: rootLockPath,
      MEIYE_STACK_STATE_PATH: statePath,
      MEIYE_VIRTUAL_STORE_LOCK_PATH: virtualStoreLockPath,
      SECRET_SENTINEL: secretMarker,
    });
    assert.notEqual(result.code, 0);
    assert.match(result.output, /pnpm install --frozen-lockfile/u);
    assert.doesNotMatch(result.output, /DATABASE_URL is required/u);
    assert.doesNotMatch(result.output, /never-print/u);
    await assert.rejects(() => readFile(statePath), { code: 'ENOENT' });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('current installed Miniflare consumes workerd V8 flags from the environment', async () => {
  await assert.doesNotReject(() => assertMiniflareWorkerdV8FlagsSupport());
});

test('Miniflare preflight rejects an install without the env-to-v8Flags bridge', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'meiye-miniflare-flags-'));
  const miniflareEntryPath = join(directory, 'index.js');
  try {
    await writeFile(
      miniflareEntryPath,
      [
        "export const marker = 'MINIFLARE_WORKERD_V8_FLAGS';",
        "export const sourceOnly = 'v8Flags:';",
      ].join('\n'),
      'utf8',
    );
    await assert.rejects(
      () => assertMiniflareWorkerdV8FlagsSupport({ miniflareEntryPath }),
      /pnpm install --frozen-lockfile/u,
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
