import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  access,
  mkdtemp,
  rename,
  rm,
  readFile,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
);
const gitignorePath = path.join(
  rootDir,
  'mkfast-template-main/project.inlang/.gitignore'
);
const inlangProjectDir = path.dirname(gitignorePath);
const generatedProjectPaths = ['.meta.json', 'README.md', 'cache'];

test('locale compilation preserves the tracked Inlang gitignore', async () => {
  const before = await readFile(gitignorePath);
  const backupDir = await mkdtemp(path.join(tmpdir(), 'inlang-project-'));
  const backedUpPaths = [];

  for (const relativePath of generatedProjectPaths) {
    const source = path.join(inlangProjectDir, relativePath);
    try {
      await access(source);
      await rename(source, path.join(backupDir, relativePath));
      backedUpPaths.push(relativePath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  try {
    execFileSync(
      'pnpm',
      ['--filter', '@meiye/web', 'locale:compile'],
      { cwd: rootDir, stdio: 'pipe' }
    );
    assert.deepEqual(await readFile(gitignorePath), before);
  } finally {
    await writeFile(gitignorePath, before);
    for (const relativePath of generatedProjectPaths) {
      await rm(path.join(inlangProjectDir, relativePath), {
        force: true,
        recursive: true,
      });
    }
    for (const relativePath of backedUpPaths) {
      await rename(
        path.join(backupDir, relativePath),
        path.join(inlangProjectDir, relativePath)
      );
    }
    await rm(backupDir, { force: true, recursive: true });
  }
});
