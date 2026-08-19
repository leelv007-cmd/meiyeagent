import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  CURRENT,
  LEDGER_PATH,
  POLICY_PATH,
  STATUS_PATH,
  STATUS_SCHEMA,
  STALE,
  applyStatusHeader,
  parseStatusHeader,
  renderStatusHeader,
} from './project-status.mjs';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const cli = fileURLToPath(new URL('./project-status.mjs', import.meta.url));

function currentRecord(sha, extra = {}) {
  return {
    schema: STATUS_SCHEMA,
    label: CURRENT,
    generatedAt: '2026-08-20T00:00:00.000Z',
    head: sha,
    remote: null,
    remoteRef: null,
    remoteSha: null,
    dirty: false,
    baseline: sha,
    requiredRun: { sha, id: 'required-1', conclusion: 'success' },
    browserRun: { sha, id: 'browser-1', conclusion: 'success' },
    pgDbosEvidence: {
      sha,
      path: 'docs/ops/pg-dbos.json',
      conclusion: 'success',
    },
    ...extra,
  };
}

function statusMarkdown(record, title = 'Fixture status') {
  return `# ${title}（${record.label}）\n\n${renderStatusHeader(record)}\n`;
}

async function createRepo() {
  const directory = await mkdtemp(join(tmpdir(), 'meiye-wf01-status-'));
  runGit(directory, ['init', '--initial-branch=main']);
  runGit(directory, ['config', 'user.email', 'wf01-status@example.test']);
  runGit(directory, ['config', 'user.name', 'WF-01 Status']);
  runGit(directory, ['config', 'commit.gpgsign', 'false']);
  await mkdir(join(directory, 'docs/ops'), { recursive: true });
  await writeFile(join(directory, 'docs/ops/.keep'), 'keep\n');
  runGit(directory, ['add', 'docs/ops/.keep']);
  runGit(directory, ['commit', '-m', 'test: seed status fixture']);
  const sha = runGit(directory, ['rev-parse', 'HEAD']).stdout.trim();
  await writeStatusFiles(directory, currentRecord(sha));
  return { directory, sha };
}

async function writeStatusFiles(directory, record) {
  await writeFile(join(directory, STATUS_PATH), statusMarkdown(record));
  await writeFile(
    join(directory, LEDGER_PATH),
    statusMarkdown(record, 'Fixture ledger'),
  );
}

async function moveHead(directory) {
  await writeFile(join(directory, 'docs/ops/moved.txt'), 'head moved\n');
  runGit(directory, ['add', 'docs/ops/moved.txt']);
  runGit(directory, ['commit', '-m', 'test: change HEAD after CURRENT']);
  return runGit(directory, ['rev-parse', 'HEAD']).stdout.trim();
}

function runCli(directory, command) {
  return spawnSync(process.execPath, [cli, command], {
    cwd: directory,
    encoding: 'utf8',
  });
}

function runGit(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result;
}

test('changing HEAD after writing CURRENT makes the stale checker red', async () => {
  const repo = await createRepo();
  const green = runCli(repo.directory, 'check');
  assert.equal(green.status, 0, green.stderr);

  await moveHead(repo.directory);
  const red = runCli(repo.directory, 'check');
  assert.equal(red.status, 1, red.stdout);
  assert.match(red.stderr, /must not stay labeled CURRENT/u);
  assert.match(red.stderr, /HEAD moved/u);
  const report = JSON.parse(red.stdout);
  assert.equal(report.ok, false);
  assert.ok(
    report.documents.every((document) => document.label === CURRENT),
  );
});

test('ancestor required-run green cannot be copied onto the current SHA', async () => {
  const repo = await createRepo();
  const ancestor = repo.sha;
  const head = await moveHead(repo.directory);
  await writeStatusFiles(
    repo.directory,
    currentRecord(head, {
      requiredRun: {
        sha: ancestor,
        id: 'required-1',
        conclusion: 'success',
      },
      browserRun: { sha: head, id: 'browser-1', conclusion: 'success' },
      pgDbosEvidence: {
        sha: head,
        path: 'docs/ops/pg-dbos.json',
        conclusion: 'success',
      },
    }),
  );
  const red = runCli(repo.directory, 'check');
  assert.equal(red.status, 1, red.stdout);
  assert.match(red.stderr, /requiredRun copies ancestor CI green onto current SHA/u);
  assert.doesNotMatch(red.stderr, /browserRun copies ancestor/u);
});

test('write keeps ancestor evidence SHA and refuses CURRENT after HEAD moves', async () => {
  const repo = await createRepo();
  const ancestor = repo.sha;
  await moveHead(repo.directory);
  const written = runCli(repo.directory, 'write');
  assert.equal(written.status, 0, written.stderr);
  const disk = parseStatusHeader(
    await readFile(join(repo.directory, STATUS_PATH), 'utf8'),
  );
  assert.equal(disk.label, STALE);
  assert.equal(disk.requiredRun.sha, ancestor);
  assert.notEqual(disk.head, ancestor);
  assert.equal(disk.baseline, ancestor);
  const check = runCli(repo.directory, 'check');
  assert.equal(check.status, 0, check.stderr);
});

test('STALE is required when baseline is not an ancestor of HEAD', async () => {
  const repo = await createRepo();
  runGit(repo.directory, ['checkout', '--orphan', 'divergent']);
  runGit(repo.directory, ['commit', '--allow-empty', '-m', 'test: orphan SHA']);
  const orphan = runGit(repo.directory, ['rev-parse', 'HEAD']).stdout.trim();
  runGit(repo.directory, ['checkout', 'main']);
  const head = runGit(repo.directory, ['rev-parse', 'HEAD']).stdout.trim();
  await writeStatusFiles(
    repo.directory,
    currentRecord(head, { baseline: orphan }),
  );
  const red = runCli(repo.directory, 'check');
  assert.equal(red.status, 1, red.stdout);
  assert.match(red.stderr, /is not an ancestor of HEAD/u);
  assert.match(red.stderr, /must not stay labeled CURRENT/u);

  await writeStatusFiles(
    repo.directory,
    currentRecord(head, { label: STALE, baseline: orphan }),
  );
  const honest = runCli(repo.directory, 'check');
  assert.equal(honest.status, 0, honest.stderr);
});

test('a missing header is a checker failure', async () => {
  const repo = await createRepo();
  await writeFile(
    join(repo.directory, STATUS_PATH),
    '# Fixture status（CURRENT）\n\nno machine header\n',
  );
  const red = runCli(repo.directory, 'check');
  assert.equal(red.status, 1, red.stdout);
  assert.match(red.stderr, /missing project-status-json header/u);
});

test('committed status documents stay honest and point at durable policy', async () => {
  const check = runCli(repositoryRoot, 'check');
  assert.equal(check.status, 0, check.stderr);
  const report = JSON.parse(check.stdout);
  assert.equal(report.ok, true);
  assert.deepEqual(
    report.documents.map((document) => document.path),
    [STATUS_PATH, LEDGER_PATH],
  );
  const policy = await readFile(join(repositoryRoot, POLICY_PATH), 'utf8');
  assert.match(policy, /CURRENT/u);
  assert.match(policy, /STALE/u);
  assert.match(policy, /SHA-scoped/u);
});

test('applyStatusHeader relabels H1 and never leaves a CURRENT fence', () => {
  const sha = 'a'.repeat(40);
  const markdown = applyStatusHeader(
    statusMarkdown(currentRecord(sha)),
    currentRecord(sha, { label: STALE }),
  );
  assert.match(markdown, /^# Fixture status（STALE）/u);
  assert.equal(parseStatusHeader(markdown).label, STALE);
  assert.doesNotMatch(markdown, /（CURRENT）/u);
});
