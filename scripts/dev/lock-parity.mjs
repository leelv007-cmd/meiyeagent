import { spawn } from 'node:child_process';
import { access, readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export const FROZEN_INSTALL_REMEDIATION =
  'Run pnpm install --frozen-lockfile manually, then retry pnpm dev.';

async function readLock(path) {
  try {
    return await readFile(path);
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      throw new Error(
        `Development install is missing its lock snapshot. ${FROZEN_INSTALL_REMEDIATION}`,
      );
    }
    throw error;
  }
}

export async function assertFrozenInstallParity({
  rootLockPath,
  virtualStoreLockPath,
}) {
  const [rootLock, virtualStoreLock] = await Promise.all([
    readLock(rootLockPath),
    readLock(virtualStoreLockPath),
  ]);
  if (!rootLock.equals(virtualStoreLock)) {
    throw new Error(
      `Development install is stale because its lock snapshot drifted. ${FROZEN_INSTALL_REMEDIATION}`,
    );
  }
}

async function resolveInstalledMiniflareEntry(virtualStoreDir) {
  let entries;
  try {
    entries = await readdir(virtualStoreDir);
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      throw new Error(
        `Development install is missing Miniflare. ${FROZEN_INSTALL_REMEDIATION}`,
      );
    }
    throw error;
  }
  const matches = entries.filter((entry) => entry.startsWith('miniflare@'));
  if (matches.length !== 1) {
    throw new Error(
      `Development install has no unambiguous Miniflare runtime. ${FROZEN_INSTALL_REMEDIATION}`,
    );
  }
  return join(
    virtualStoreDir,
    matches[0],
    'node_modules/miniflare/dist/src/index.js',
  );
}

export async function assertMiniflareWorkerdV8FlagsSupport({
  miniflareEntryPath,
  virtualStoreDir = resolve(repoRoot, 'node_modules/.pnpm'),
} = {}) {
  const entryPath =
    miniflareEntryPath ??
    (await resolveInstalledMiniflareEntry(virtualStoreDir));
  try {
    await access(entryPath);
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      throw new Error(
        `Development install is missing the patched Miniflare runtime. ${FROZEN_INSTALL_REMEDIATION}`,
      );
    }
    throw error;
  }

  const probeSource = `
    import { pathToFileURL } from 'node:url';
    const flag = '--meiye-workerd-v8-flags-behavior-probe';
    process.env.MINIFLARE_WORKERD_V8_FLAGS = flag;
    let runtime;
    try {
      runtime = await import(pathToFileURL(process.argv[1]));
    } catch {
      process.exit(2);
    }
    if (typeof runtime.Miniflare !== 'function') process.exit(3);
    const instance = new runtime.Miniflare({
      compatibilityDate: '2026-08-19',
      modules: true,
      script: 'export default { fetch() { return new Response("ok") } }',
    });
    try {
      await instance.ready;
      process.exitCode = 4;
    } catch (error) {
      const message = String(error);
      process.exitCode =
        message.includes('unrecognized V8 flag') && message.includes(flag) ? 0 : 5;
    } finally {
      await instance.dispose().catch(() => undefined);
    }
  `;
  const probeExit = await new Promise((resolveExit) => {
    const probe = spawn(
      process.execPath,
      ['--input-type=module', '-e', probeSource, entryPath],
      {
        detached: true,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const timeout = setTimeout(() => {
      try {
        process.kill(-probe.pid, 'SIGKILL');
      } catch {
        probe.kill('SIGKILL');
      }
      resolveExit(124);
    }, 5_000);
    probe.once('error', () => {
      clearTimeout(timeout);
      resolveExit(125);
    });
    probe.once('exit', (code) => {
      clearTimeout(timeout);
      resolveExit(code ?? 126);
    });
  });
  if (probeExit !== 0) {
    throw new Error(
      `Development install cannot pass heap flags to workerd. ${FROZEN_INSTALL_REMEDIATION}`,
    );
  }
}
