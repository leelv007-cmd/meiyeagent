import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = resolve(import.meta.dirname, 'issue-253-readiness.mjs');

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed (${result.status}):\n${result.stderr}`
    );
  }
  return result.stdout.trim();
}

async function createRepository() {
  const root = await mkdtemp(join(tmpdir(), 'issue-253-readiness-'));
  run('git', ['init', '-b', 'main'], root);
  run('git', ['config', 'user.email', 'fixture@example.test'], root);
  run('git', ['config', 'user.name', 'Fixture'], root);
  await writeFile(join(root, 'README.md'), 'fixture\n');
  run('git', ['add', 'README.md'], root);
  run('git', ['commit', '-m', 'chore: initialize fixture'], root);
  return root;
}

async function commitFile(root, path, content, message) {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content);
  run('git', ['add', path], root);
  run('git', ['commit', '-m', message], root);
  return run('git', ['rev-parse', 'HEAD'], root);
}

async function writeIssueFixtures(root, states = {}) {
  const fixtureDirectory = join(root, 'issue-fixtures');
  await mkdir(fixtureDirectory);
  for (const issue of [248, 261, 264]) {
    await writeFile(
      join(fixtureDirectory, `${issue}.json`),
      JSON.stringify({
        closedAt: states[issue] === 'CLOSED' ? '2026-07-29T00:00:00Z' : null,
        comments: [
          {
            author: { login: 'owner' },
            body: `latest diagnostic for #${issue}`,
            createdAt: '2026-07-29T00:00:00Z',
            url: `https://example.test/issues/${issue}#comment`,
          },
        ],
        number: issue,
        state: states[issue] ?? 'OPEN',
        title: `Issue ${issue}`,
        url: `https://example.test/issues/${issue}`,
      })
    );
  }
  return fixtureDirectory;
}

async function writeMarkers(root, commits) {
  const markerPath = join(root, 'markers.json');
  await writeFile(
    markerPath,
    JSON.stringify({
      dependencies: {
        '248': {
          acceptanceCommands: ['node --test path/to/issue-248.test.mjs'],
          commit: commits['248'],
          ownedPaths: ['apps/core/src/events/contract.ts'],
        },
        '261': {
          acceptanceCommands: ['pnpm --filter @meiye/web test:interaction'],
          commit: commits['261'],
          ownedPaths: ['mkfast-template-main/src/routes/dashboard.tsx'],
        },
        '264FE': {
          acceptanceCommands: [
            'pnpm --filter @meiye/web test:interaction -- video-worksurface',
          ],
          commit: commits['264FE'],
          ownedPaths: [
            'mkfast-template-main/src/components/video-controls.tsx',
          ],
        },
      },
    })
  );
  return markerPath;
}

function runReadiness(root, markerPath, fixtureDirectory, extraArgs = []) {
  return spawnSync(
    process.execPath,
    [
      script,
      '--repo',
      root,
      '--main',
      'main',
      '--markers',
      markerPath,
      '--issue-fixtures',
      fixtureDirectory,
      '--json',
      ...extraArgs,
    ],
    { encoding: 'utf8' }
  );
}

test('open issue state is diagnostic only when all explicit merge markers are proven', async () => {
  const root = await createRepository();
  const commits = {
    '248': await commitFile(
      root,
      'apps/core/src/events/contract.ts',
      'export const eventContract = true;\n',
      'feat(events): add issue 248 contract'
    ),
    '261': await commitFile(
      root,
      'mkfast-template-main/src/routes/dashboard.tsx',
      'export const dashboard = true;\n',
      'feat(web): implement issue 261 dashboard'
    ),
    '264FE': await commitFile(
      root,
      'mkfast-template-main/src/components/video-controls.tsx',
      'export const controlsRetired = true;\n',
      'fix(web): retire issue 264 video controls'
    ),
  };
  const markerPath = await writeMarkers(root, commits);
  const fixtureDirectory = await writeIssueFixtures(root);

  const result = runReadiness(root, markerPath, fixtureDirectory);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ready, true);
  assert.deepEqual(
    report.dependencies.map((dependency) => [
      dependency.id,
      dependency.git.status,
      dependency.issue.state,
    ]),
    [
      ['248', 'merged', 'OPEN'],
      ['261', 'merged', 'OPEN'],
      ['264FE', 'merged', 'OPEN'],
    ]
  );
  assert.match(
    report.dependencies[0].issue.latestComment.body,
    /latest diagnostic for #248/
  );
  assert.deepEqual(report.semanticRebase.commands, [
    'node --test path/to/issue-248.test.mjs',
    'pnpm --filter @meiye/web test:interaction',
    'pnpm --filter @meiye/web test:interaction -- video-worksurface',
  ]);
  assert.equal(report.semanticRebase.verification.length, 3);
  assert.match(
    report.semanticRebase.verification[0],
    /^git merge-base --is-ancestor [0-9a-f]{40} main$/
  );
});

test('a closed issue cannot replace a commit that is absent from local main', async () => {
  const root = await createRepository();
  const commits = {
    '248': await commitFile(
      root,
      'apps/core/src/events/contract.ts',
      'export const eventContract = true;\n',
      'feat(events): add issue 248 contract'
    ),
    '261': await commitFile(
      root,
      'mkfast-template-main/src/routes/dashboard.tsx',
      'export const dashboard = true;\n',
      'feat(web): implement issue 261 dashboard'
    ),
  };
  run('git', ['switch', '-c', 'unmerged-264'], root);
  commits['264FE'] = await commitFile(
    root,
    'mkfast-template-main/src/components/video-controls.tsx',
    'export const controlsRetired = true;\n',
    'fix(web): retire issue 264 video controls'
  );
  run('git', ['switch', 'main'], root);

  const markerPath = await writeMarkers(root, commits);
  const fixtureDirectory = await writeIssueFixtures(root, { 264: 'CLOSED' });
  const result = runReadiness(root, markerPath, fixtureDirectory);

  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ready, false);
  const dependency = report.dependencies.find((entry) => entry.id === '264FE');
  assert.equal(dependency.issue.state, 'CLOSED');
  assert.equal(dependency.git.status, 'not_merged');
  assert.match(dependency.gaps.join('\n'), /not an ancestor of local main/);
});

test('a docs-only frontend marker fails closed even when it is on main', async () => {
  const root = await createRepository();
  const commits = {
    '248': await commitFile(
      root,
      'apps/core/src/events/contract.ts',
      'export const eventContract = true;\n',
      'feat(events): add issue 248 contract'
    ),
    '261': await commitFile(
      root,
      'docs/issue-261.md',
      'design only\n',
      'docs: describe issue 261'
    ),
    '264FE': await commitFile(
      root,
      'mkfast-template-main/src/components/video-controls.tsx',
      'export const controlsRetired = true;\n',
      'fix(web): retire issue 264 video controls'
    ),
  };
  const markerPath = await writeMarkers(root, commits);
  const fixtureDirectory = await writeIssueFixtures(root);
  const result = runReadiness(root, markerPath, fixtureDirectory);

  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  const dependency = report.dependencies.find((entry) => entry.id === '261');
  assert.equal(dependency.git.status, 'scope_mismatch');
  assert.match(dependency.gaps.join('\n'), /does not change a required product path/);
});

test('missing acceptance commands fail closed before the first semantic rebase', async () => {
  const root = await createRepository();
  const commits = {
    '248': await commitFile(
      root,
      'apps/core/src/events/contract.ts',
      'export const eventContract = true;\n',
      'feat(events): add issue 248 contract'
    ),
    '261': await commitFile(
      root,
      'mkfast-template-main/src/routes/dashboard.tsx',
      'export const dashboard = true;\n',
      'feat(web): implement issue 261 dashboard'
    ),
    '264FE': await commitFile(
      root,
      'mkfast-template-main/src/components/video-controls.tsx',
      'export const controlsRetired = true;\n',
      'fix(web): retire issue 264 video controls'
    ),
  };
  const markerPath = await writeMarkers(root, commits);
  const marker = JSON.parse(
    await import('node:fs/promises').then(({ readFile }) =>
      readFile(markerPath, 'utf8')
    )
  );
  marker.dependencies['248'].acceptanceCommands = [];
  await writeFile(markerPath, JSON.stringify(marker));
  const fixtureDirectory = await writeIssueFixtures(root);
  const result = runReadiness(root, markerPath, fixtureDirectory);

  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  const dependency = report.dependencies.find((entry) => entry.id === '248');
  assert.equal(dependency.git.status, 'invalid_marker');
  assert.match(dependency.gaps.join('\n'), /acceptanceCommands/);
});
