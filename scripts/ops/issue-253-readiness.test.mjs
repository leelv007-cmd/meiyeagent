import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = resolve(import.meta.dirname, 'issue-253-readiness.mjs');

function git(root, ...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

async function commit(root, path, text, message) {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), text);
  git(root, 'add', path);
  git(root, 'commit', '-m', message);
  return git(root, 'rev-parse', 'HEAD');
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'issue-253-ready-'));
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.email', 'fixture@example.test');
  git(root, 'config', 'user.name', 'Fixture');
  await writeFile(join(root, 'README.md'), 'fixture\n');
  git(root, 'add', 'README.md');
  git(root, 'commit', '-m', 'chore: initialize fixture');

  const commits = {
    '248': await commit(
      root,
      'apps/core/src/events.ts',
      'export const skillRevision = true;\n',
      'feat(events): add flat event contract'
    ),
    '264FE': await commit(
      root,
      'mkfast-template-main/src/video.tsx',
      'export const videoBillableScopes = [];\n',
      'fix(web): retire video editing'
    ),
    '261': await commit(
      root,
      'mkfast-template-main/src/dashboard.tsx',
      'export const dashboardSections = 3;\n',
      'feat(web): build dashboard sections'
    ),
  };
  await commit(
    root,
    'docs/ops/merge-ledger.md',
    [
      '# Merge ledger',
      '',
      '| main sha | 票 | 内容 |',
      '|---|---|---|',
      `| ${commits['248'].slice(0, 8)} | #248 | observability |`,
      `| ${commits['261'].slice(0, 8)} | #261 | dashboard |`,
      `| ${commits['264FE'].slice(0, 8)} | #264 | frontend retirement |`,
      '',
    ].join('\n'),
    'docs(ops): record dependency merges'
  );
  const markers = {
    dependencies: {
      '248': {
        acceptanceCommands: ['node --test issue-248.test.mjs'],
        commit: commits['248'],
        currentTreeChecks: [
          {
            contains: ['skillRevision'],
            path: 'apps/core/src/events.ts',
          },
        ],
        ownedPaths: ['apps/core/src/events.ts'],
      },
      '261': {
        acceptanceCommands: ['node --test issue-261.test.mjs'],
        commit: commits['261'],
        currentTreeChecks: [
          {
            contains: ['dashboardSections = 3'],
            path: 'mkfast-template-main/src/dashboard.tsx',
          },
        ],
        ownedPaths: ['mkfast-template-main/src/dashboard.tsx'],
      },
      '264FE': {
        acceptanceCommands: ['node --test issue-264-fe.test.mjs'],
        commit: commits['264FE'],
        currentTreeChecks: [
          {
            notContains: ["'shot'"],
            path: 'mkfast-template-main/src/video.tsx',
          },
        ],
        ownedPaths: ['mkfast-template-main/src/video.tsx'],
      },
    },
  };
  const markerPath = join(root, 'markers.json');
  await writeFile(markerPath, JSON.stringify(markers));
  const issues = join(root, 'issues');
  await mkdir(issues);
  for (const number of [253, 248, 261, 264]) {
    await writeFile(
      join(issues, `${number}.json`),
      JSON.stringify({
        comments: [{ body: `latest #${number}` }],
        number,
        state: 'OPEN',
        title: `Issue ${number}`,
        url: `https://example.test/${number}`,
      })
    );
  }
  return { commits, issues, markerPath, markers, root };
}

function check({ issues, markerPath, root }) {
  return spawnSync(
    process.execPath,
    [script, '--markers', markerPath, '--issue-fixtures', issues, '--json'],
    { cwd: root, encoding: 'utf8' }
  );
}

test('open issue states are diagnostic when current main proves every marker', async () => {
  const data = await fixture();
  const result = check(data);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ready, true);
  assert.equal(report.issues['253'].latestComment.body, 'latest #253');
  assert.deepEqual(
    report.dependencies.map(({ evidence }) => evidence.status),
    ['merged', 'merged', 'merged']
  );
  assert.equal(report.semanticRebase.commands.length, 3);
});

test('a closed issue cannot replace an unmerged marker commit', async () => {
  const data = await fixture();
  git(data.root, 'switch', '-c', 'unmerged');
  data.markers.dependencies['264FE'].commit = await commit(
    data.root,
    'mkfast-template-main/src/video-extra.tsx',
    'export const retired = true;\n',
    'fix(web): finish retirement'
  );
  data.markers.dependencies['264FE'].ownedPaths = [
    'mkfast-template-main/src/video-extra.tsx',
  ];
  data.markers.dependencies['264FE'].currentTreeChecks[0].path =
    'mkfast-template-main/src/video-extra.tsx';
  await writeFile(data.markerPath, JSON.stringify(data.markers));
  git(data.root, 'switch', 'main');

  const result = check(data);
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.dependencies[2].evidence.status, 'not_merged');
});

test('a reverted semantic outcome fails even while its marker remains in main', async () => {
  const data = await fixture();
  await writeFile(
    join(data.root, 'mkfast-template-main/src/video.tsx'),
    "export const videoBillableScopes = ['shot'];\n"
  );
  git(data.root, 'add', 'mkfast-template-main/src/video.tsx');
  git(data.root, 'commit', '-m', 'revert: restore old video scope');

  const result = check(data);
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.dependencies[2].evidence.status, 'current_tree_mismatch');
  assert.match(report.gaps.join('\n'), /must not contain/);
});

test('missing semantic rebase commands fail closed', async () => {
  const data = await fixture();
  data.markers.dependencies['248'].acceptanceCommands = ['   '];
  data.markers.dependencies['248'].currentTreeChecks[0].contains = [''];
  await writeFile(data.markerPath, JSON.stringify(data.markers));
  const result = check(data);
  assert.equal(result.status, 1);
  assert.equal(
    JSON.parse(result.stdout).dependencies[0].evidence.status,
    'invalid_marker'
  );
});

test('a semantic check cannot use an unrelated path', async () => {
  const data = await fixture();
  data.markers.dependencies['264FE'].currentTreeChecks = [
    {
      exists: false,
      path: 'mkfast-template-main/src/unrelated.ts',
    },
  ];
  await writeFile(data.markerPath, JSON.stringify(data.markers));
  const result = check(data);
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stdout).gaps.join('\n'), /cover ownedPaths/);
});

test('an ancestor marker absent from the merge ledger fails closed', async () => {
  const data = await fixture();
  await commit(
    data.root,
    'docs/ops/merge-ledger.md',
    [
      '# Merge ledger',
      '',
      '| main sha | 票 | 内容 |',
      '|---|---|---|',
      `| ${data.commits['248'].slice(0, 8)} | #248 | observability |`,
      `| ${data.commits['264FE'].slice(0, 8)} | #264 | frontend retirement |`,
      '',
    ].join('\n'),
    'docs(ops): remove invalid merge claim'
  );

  const result = check(data);
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stdout).gaps.join('\n'), /merge ledger.*#261/i);
});

test('frontend markers merged in reverse order fail closed', async () => {
  const data = await fixture();
  const videoCommit = await commit(
    data.root,
    'mkfast-template-main/src/video-order.tsx',
    'export const videoBillableScopes = [];\n',
    'fix(web): retire video editing too late'
  );
  data.markers.dependencies['264FE'] = {
    acceptanceCommands: ['node --test issue-264-fe.test.mjs'],
    commit: videoCommit,
    currentTreeChecks: [
      {
        notContains: ["'shot'"],
        path: 'mkfast-template-main/src/video-order.tsx',
      },
    ],
    ownedPaths: ['mkfast-template-main/src/video-order.tsx'],
  };
  await writeFile(data.markerPath, JSON.stringify(data.markers));
  await commit(
    data.root,
    'docs/ops/merge-ledger.md',
    [
      '# Merge ledger',
      '',
      '| main sha | 票 | 内容 |',
      '|---|---|---|',
      `| ${data.commits['248'].slice(0, 8)} | #248 | observability |`,
      `| ${data.commits['261'].slice(0, 8)} | #261 | dashboard |`,
      `| ${videoCommit.slice(0, 8)} | #264 | frontend retirement |`,
      '',
    ].join('\n'),
    'docs(ops): record reversed frontend merges'
  );

  const result = check(data);
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stdout).gaps.join('\n'), /264FE.*before.*261/i);
});
