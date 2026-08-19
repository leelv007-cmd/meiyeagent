import { readdir, readFile } from 'node:fs/promises';
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
  let source;
  try {
    source = await readFile(entryPath, 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      throw new Error(
        `Development install is missing the patched Miniflare runtime. ${FROZEN_INSTALL_REMEDIATION}`,
      );
    }
    throw error;
  }
  if (
    !source.includes('MINIFLARE_WORKERD_V8_FLAGS') ||
    !source.includes('v8Flags:')
  ) {
    throw new Error(
      `Development install cannot pass heap flags to workerd. ${FROZEN_INSTALL_REMEDIATION}`,
    );
  }
}
