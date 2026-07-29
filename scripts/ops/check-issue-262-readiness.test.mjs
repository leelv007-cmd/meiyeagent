import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const scriptPath = join(
  repositoryRoot,
  'scripts/ops/check-issue-262-readiness.mjs',
);

test('an unrelated commented main SHA cannot unlock issue 262', async () => {
  const fixture = await createFixtureRepository();
  const comments = {
    246: [
      laneComment(
        `交验记录：其他票已合入 ${fixture.mainSha}，node --test passed，exit 0。`,
      ),
    ],
    247: [],
    248: [
      laneComment(
        `交验记录：其他票已合入 ${fixture.mainSha}，node --test passed，exit 0。`,
      ),
    ],
    252: [
      laneComment(
        `交验记录：其他票已合入 ${fixture.mainSha}，node --test passed，exit 0。`,
      ),
    ],
  };

  const result = await runGate(fixture, comments);

  assert.equal(result.status, 3, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.implementationReady, false);
  assert.equal(report.closureReady, false);
  assert.equal(
    report.gates.find((gate) => gate.issue === 246)?.controllerMergeCommit,
    null,
  );
});

test('the controller record and exact semantic products unlock every gate', async () => {
  const fixture = await createFixtureRepository();
  const record = controllerComment(fixture.mainSha);
  const result = await runGate(fixture, {
    246: [record],
    247: [record],
    248: [record],
    252: [record],
  });

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(
    report.gates.map((gate) => gate.issue),
    [246, 247, 248],
  );
  assert.equal(report.implementationReady, true);
  assert.equal(report.closureReady, true);
});

test('a controller record cannot replace missing semantic products', async () => {
  const fixture = await createFixtureRepository({
    include246Evidence: false,
    includeGeneric246Markers: true,
  });
  const record = controllerComment(fixture.mainSha);
  const result = await runGate(fixture, {
    246: [record],
    247: [record],
    248: [record],
    252: [],
  });

  assert.equal(result.status, 3, result.stderr);
  const report = JSON.parse(result.stdout);
  const promptGate = report.gates.find((gate) => gate.issue === 246);
  assert.equal(promptGate.ready, false);
  assert.match(promptGate.missing.join('\n'), /lacks semantic evidence/);
  assert.equal(promptGate.controllerMergeCommit, fixture.mainSha);
});

test('the latest controller record is authoritative and cannot fall back', async () => {
  const fixture = await createFixtureRepository();
  const validRecord = controllerComment(fixture.mainSha);
  const supersedingRecord = {
    ...validRecord,
    body: '**主控亲验记录（fixture update）：尚未合入 main。**',
  };
  const result = await runGate(fixture, {
    246: [validRecord, supersedingRecord],
    247: [validRecord],
    248: [validRecord],
    252: [],
  });

  assert.equal(result.status, 3, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(
    report.gates.find((gate) => gate.issue === 246)?.controllerMergeCommit,
    null,
  );
  assert.equal(report.implementationReady, false);
});

test('a target-ticket dependency update unlocks only its named upstream slices', async () => {
  const fixture = await createFixtureRepository();
  const result = await runGate(fixture, {
    246: [],
    247: [],
    248: [],
    262: [
      controllerDependencyComment(
        `双上游齐了——#246 主体（${fixture.mainSha}）＋ #247 机制切片（${fixture.mainSha}）。#262 开工 GO。`,
      ),
    ],
  });

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.implementationReady, true);
  assert.equal(report.closureReady, false);
  assert.equal(
    report.gates.find((gate) => gate.issue === 246)?.controllerMergeCommit,
    fixture.mainSha,
  );
  assert.equal(
    report.gates.find((gate) => gate.issue === 247)?.controllerMergeCommit,
    fixture.mainSha,
  );
  assert.equal(
    report.gates.find((gate) => gate.issue === 248)?.controllerMergeCommit,
    null,
  );
});

test('a later controller note without merge status does not mask the dependency update', async () => {
  const fixture = await createFixtureRepository();
  const dependencyUpdate = {
    ...controllerDependencyComment(
      `双上游齐了——#246 主体（${fixture.mainSha}）＋ #247 机制切片（${fixture.mainSha}）。#262 开工 GO。`,
    ),
    createdAt: '2026-07-29T08:48:30Z',
  };
  const statusNote = {
    ...controllerComment(fixture.mainSha),
    body: `主控亲验记录（六格状态；证据基线 main@${fixture.mainSha}）：defined → ✔ 已合入。`,
    createdAt: '2026-07-29T08:48:58Z',
  };
  const result = await runGate(fixture, {
    246: [statusNote],
    247: [],
    248: [],
    262: [dependencyUpdate],
  });

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.implementationReady, true);
  assert.equal(
    report.gates.find((gate) => gate.issue === 246)?.controllerMergeCommit,
    fixture.mainSha,
  );
});

async function createFixtureRepository(options = {}) {
  const {
    include246Evidence = true,
    includeGeneric246Markers = false,
  } = options;
  const directory = await mkdtemp(join(tmpdir(), 'meiye-issue-262-gate-'));
  await mkdir(join(directory, 'apps/core/src/p1/harness'), { recursive: true });
  await mkdir(join(directory, 'packages/contracts/src'), { recursive: true });
  await writeFile(
    join(directory, 'apps/core/src/p1/harness/task-admission.ts'),
    [
      ...(include246Evidence
        ? [
            'export interface HarnessPromptFallbackAuditPort {',
            "  eventType: 'langfuse_prompt_fallback';",
            '}',
          ]
        : []),
      'export interface HarnessExecutionBoundsResolver {}',
      'class HarnessExecutionBoundsAdmissionError {',
      "  readonly code = 'REQUIRED_EXECUTION_LIMIT_UNSET';",
      '}',
    ].join('\n'),
  );
  if (include246Evidence) {
    await writeFile(
      join(directory, 'apps/core/src/p1/harness/langfuse-prompts.ts'),
      [
        "export type LangfusePromptPolicy = 'pilot' | 'strict';",
        'export function assertLangfusePromptRuntimePolicy() {}',
      ].join('\n'),
    );
  }
  if (includeGeneric246Markers) {
    await writeFile(
      join(directory, 'apps/core/src/unrelated.ts'),
      [
        'export const promptRevisionRefs = {};',
        "export const fallbackReason = 'unrelated';",
      ].join('\n'),
    );
  }
  await writeFile(
    join(directory, 'packages/contracts/src/bounded-execution.ts'),
    [
      'export const boundedExecutionSnapshotSchema = {};',
      'export type BoundedExecutionSnapshot = unknown;',
      'export const boundedExecutionEventSchema = {};',
    ].join('\n'),
  );
  await writeFile(
    join(directory, 'packages/contracts/src/observability.ts'),
    [
      'export const observabilityAxesSchema = {',
      '  skillRevision: compositeRevisionSchema,',
      '  promptVersion: compositeRevisionSchema,',
      '  catalogRevision: z.string().trim().min(1),',
      '};',
    ].join('\n'),
  );
  runGit(directory, ['init', '--initial-branch=main']);
  runGit(directory, ['config', 'user.email', 'issue-262@example.test']);
  runGit(directory, ['config', 'user.name', 'Issue 262 Test']);
  runGit(directory, ['add', '.']);
  runGit(directory, ['commit', '-m', 'test: seed readiness fixture']);
  const mainSha = runGit(directory, ['rev-parse', 'main']).stdout.trim();
  const ghPath = join(directory, 'gh');
  await writeFile(
    ghPath,
    `#!/usr/bin/env node
import { readFileSync } from 'node:fs';
const fixtures = JSON.parse(readFileSync(process.env.ISSUE_262_TEST_FIXTURES, 'utf8'));
const issue = process.argv[process.argv.indexOf('view') + 1];
process.stdout.write(JSON.stringify(fixtures[issue]));
`,
  );
  await chmod(ghPath, 0o755);
  return { directory, ghPath, mainSha };
}

async function runGate(fixture, comments) {
  const fixturesPath = join(fixture.directory, 'issues.json');
  const normalizedComments = { 262: [], ...comments };
  const issues = Object.fromEntries(
    Object.entries(normalizedComments).map(([issue, issueComments]) => [
      issue,
      {
        comments: issueComments,
        state: 'OPEN',
        url: `https://example.test/issues/${issue}`,
      },
    ]),
  );
  await writeFile(fixturesPath, JSON.stringify(issues));
  return spawnSync(process.execPath, [scriptPath, '--json'], {
    cwd: fixture.directory,
    encoding: 'utf8',
    env: {
      ...process.env,
      ISSUE_262_BASE_REF: 'main',
      ISSUE_262_GITHUB_REPOSITORY: 'leelv007-cmd/meiyeweb-agent',
      ISSUE_262_TEST_FIXTURES: fixturesPath,
      PATH: `${fixture.directory}:${process.env.PATH ?? '/usr/bin:/bin'}`,
    },
  });
}

function laneComment(body) {
  return {
    author: { login: 'lane-worker' },
    authorAssociation: 'CONTRIBUTOR',
    body,
  };
}

function controllerComment(sha) {
  return {
    author: { login: 'leelv007-cmd' },
    authorAssociation: 'OWNER',
    body: `**主控亲验记录（fixture）：已合入 main@${sha}。**`,
  };
}

function controllerDependencyComment(body) {
  return {
    author: { login: 'leelv007-cmd' },
    authorAssociation: 'OWNER',
    body: `依赖更新（v4 编排）（fixture）：${body}`,
  };
}

function runGit(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result;
}
