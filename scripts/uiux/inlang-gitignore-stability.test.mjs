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
const gitignoreRepoPath =
  'mkfast-template-main/project.inlang/.gitignore';
const inlangProjectDir = path.dirname(gitignorePath);
const generatedProjectPaths = ['.meta.json', 'README.md', 'cache'];

function git(args) {
  return execFileSync('git', args, {
    cwd: rootDir,
    encoding: 'utf8',
  });
}

test('web build leaves no tracked Inlang project changes', async () => {
  const before = await readFile(gitignorePath).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  const statusBefore = git([
    'status',
    '--porcelain',
    '--untracked-files=no',
    '--',
    'mkfast-template-main/project.inlang/',
  ]);
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
      ['--filter', '@meiye/web', 'build'],
      { cwd: rootDir, stdio: 'pipe' }
    );
    assert.equal(git(['ls-files', '--', gitignoreRepoPath]), '');
    assert.equal(
      git([
        'status',
        '--porcelain',
        '--untracked-files=no',
        '--',
        'mkfast-template-main/project.inlang/',
      ]),
      statusBefore
    );
  } finally {
    if (before) {
      await writeFile(gitignorePath, before);
    } else {
      await rm(gitignorePath, { force: true });
    }
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
