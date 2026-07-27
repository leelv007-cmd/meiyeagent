import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { verifyHeroUiMirrorGitHead } from '../../../scripts/heroui-mirror-git-head.js';

function createMirrorRepository() {
  const directory = mkdtempSync(join(tmpdir(), 'heroui-mirror-head-'));
  execFileSync('git', ['init', '--quiet', directory]);
  writeFileSync(join(directory, 'package.json'), '{"name":"@ag-ui/pro"}\n');
  execFileSync('git', ['-C', directory, 'add', 'package.json']);
  execFileSync('git', [
    '-C',
    directory,
    '-c',
    'user.name=HeroUI Mirror Test',
    '-c',
    'user.email=heroui-mirror@example.test',
    'commit',
    '--quiet',
    '-m',
    'fixture',
  ]);
  return directory;
}

test('HeroUI mirror HEAD accepts the exact pinned commit or its unique prefix', () => {
  const mirror = createMirrorRepository();
  try {
    const head = execFileSync('git', ['-C', mirror, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();

    assert.equal(
      verifyHeroUiMirrorGitHead({
        mirror,
        pinnedCommit: head,
      }),
      head
    );
    assert.equal(
      verifyHeroUiMirrorGitHead({
        mirror,
        pinnedCommit: head.slice(0, 12),
      }),
      head
    );
  } finally {
    rmSync(mirror, { force: true, recursive: true });
  }
});

test('HeroUI mirror HEAD rejects a checkout that differs from the pin', () => {
  const mirror = createMirrorRepository();
  try {
    assert.throws(
      () =>
        verifyHeroUiMirrorGitHead({
          mirror,
          pinnedCommit: '000000000000',
        }),
      /does not match pinned commit 000000000000/
    );
  } finally {
    rmSync(mirror, { force: true, recursive: true });
  }
});
