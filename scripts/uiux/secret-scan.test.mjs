import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const secretScanPath = path.resolve(import.meta.dirname, 'secret-scan.mjs');

function git(rootDir, args) {
  const result = spawnSync('git', args, {
    cwd: rootDir,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
}

async function withRepository(run) {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'secret-scan-contract-'));
  try {
    git(rootDir, ['init', '--quiet']);
    await writeFile(
      path.join(rootDir, '.gitignore'),
      ['.env', '.env.*', '**/.env*', '!.env.example', '!**/.env.example', ''].join(
        '\n'
      )
    );
    git(rootDir, ['add', '.gitignore']);
    await run(rootDir);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
}

function runSecretScan(rootDir) {
  return spawnSync(process.execPath, [secretScanPath], {
    cwd: rootDir,
    encoding: 'utf8',
  });
}

test('tracked content with a secret-shaped key fails', async () => {
  await withRepository(async (rootDir) => {
    const secret = `sk-${'a'.repeat(32)}`;
    await writeFile(path.join(rootDir, 'tracked.md'), `API_KEY=${secret}\n`);
    git(rootDir, ['add', 'tracked.md']);

    const result = runSecretScan(rootDir);

    assert.equal(result.status, 1);
    assert.match(result.stdout, /"path": "tracked\.md"/);
    assert.match(result.stdout, /"rule": "api-key"/);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(secret));
  });
});

test('ignored environment content is informational and does not fail', async () => {
  await withRepository(async (rootDir) => {
    const secret = `sk-${'b'.repeat(32)}`;
    await writeFile(path.join(rootDir, '.env'), `API_KEY=${secret}\n`);

    const result = runSecretScan(rootDir);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /"status": "informational"/);
    assert.match(result.stdout, /"paths": \[\s*"\.env"/);
    assert.match(result.stdout, /"path": "\.env"/);
    assert.match(result.stdout, /"rule": "api-key"/);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(secret));
  });
});

test('an ignored environment path staged by force fails the index contract', async () => {
  await withRepository(async (rootDir) => {
    const nestedDir = path.join(rootDir, 'config');
    const secret = `sk-${'c'.repeat(32)}`;
    await mkdir(nestedDir);
    await writeFile(path.join(nestedDir, '.env.local'), `API_KEY=${secret}\n`);
    git(rootDir, ['add', '--force', 'config/.env.local']);

    const result = runSecretScan(rootDir);

    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /Ignored environment files must remain untracked and unstaged/
    );
    assert.match(result.stderr, /config\/\.env\.local/);
    assert.doesNotMatch(result.stderr, /"status": "informational"/);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(secret));
  });
});
