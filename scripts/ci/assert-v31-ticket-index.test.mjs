import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  assertV31TicketIndex,
  checkTicketIndex,
  extractTicketFields,
  generateStatusTable,
  parseReadmeStatusTable,
} from './assert-v31-ticket-index.mjs';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const scriptPath = resolve(import.meta.dirname, 'assert-v31-ticket-index.mjs');

const HEAD_SHA = spawnSync('git', ['rev-parse', 'HEAD'], {
  cwd: repositoryRoot,
  encoding: 'utf8',
}).stdout.trim();

async function stageFixture(files) {
  const root = await mkdtemp(join(tmpdir(), 'meiye-v31-ticket-index-'));
  const ticketsDir = join(root, 'docs/tickets/v3.1');
  await mkdir(ticketsDir, { recursive: true });

  for (const [name, contents] of Object.entries(files)) {
    await writeFile(join(ticketsDir, name), contents, 'utf8');
  }

  return {
    root,
    ticketsDir,
    readmePath: join(ticketsDir, 'README.md'),
  };
}

test('extractTicketFields accepts bold Status form', () => {
  const fields = extractTicketFields(
    '# V31-01 — Sample\n\n**Status**: open — detail\n',
  );
  assert.equal(fields.status, 'open — detail');
  assert.equal(fields.form, 'bold');
  assert.equal(fields.title, 'Sample');
});

test('extractTicketFields accepts list-style Status (V31-43/44 form)', () => {
  const fields = extractTicketFields(
    '# V31-43 —— issue 255 race\n\n- Status: open\n- Owner: unassigned\n',
  );
  assert.equal(fields.status, 'open');
  assert.equal(fields.form, 'list');
  assert.equal(fields.title, 'issue 255 race');
});

test('extractTicketFields returns null when Status is absent', () => {
  const fields = extractTicketFields('# V31-99 — No status\n\nbody only\n');
  assert.equal(fields.status, null);
  assert.equal(fields.form, null);
});

test('parseReadmeStatusTable reads three-column rows', () => {
  const rows = parseReadmeStatusTable(`
| 票 | 标题 | Status（票面原文） |
|---|---|---|
| V31-01 | [Title](V31-01-x.md) | open |
| V31-02 | [Other](V31-02-y.md) | done (merged) |
`);
  assert.equal(rows.get('V31-01')?.status, 'open');
  assert.equal(rows.get('V31-02')?.status, 'done (merged)');
});

test('checkTicketIndex fails closed on status drift', () => {
  const { errors } = checkTicketIndex({
    tickets: [
      {
        id: 'V31-01',
        fileName: 'V31-01-a.md',
        status: 'open',
        form: 'bold',
        title: 'A',
      },
    ],
    readmeRows: new Map([
      ['V31-01', { status: 'done', titleCell: 'A', line: '| V31-01 | A | done |' }],
    ]),
  });
  assert.ok(errors.some((error) => error.includes('drifts from ticket')));
});

test('checkTicketIndex fails when a ticket is missing from README', () => {
  const { errors } = checkTicketIndex({
    tickets: [
      {
        id: 'V31-59',
        fileName: 'V31-59-x.md',
        status: 'open',
        form: 'bold',
        title: 'X',
      },
    ],
    readmeRows: new Map(),
  });
  assert.ok(errors.some((error) => error.includes('missing from README')));
});

test('checkTicketIndex fails when README lists an unknown ticket', () => {
  const { errors } = checkTicketIndex({
    tickets: [],
    readmeRows: new Map([
      ['V31-99', { status: 'open', titleCell: 'Ghost', line: '| V31-99 | Ghost | open |' }],
    ]),
  });
  assert.ok(errors.some((error) => error.includes('no matching V31-*.md')));
});

test('fixture tree: bold + list Status match README (pass)', async () => {
  const { ticketsDir, readmePath } = await stageFixture({
    'V31-01-sample.md':
      '# V31-01 — Sample one\n\n**Status**: done (merged)\n' +
      `**Implementation state**: done\n` +
      `**Verification state**: verified\n` +
      `**Evidence SHA**: ${HEAD_SHA}\n` +
      `**Workflow Run**: https://github.com/example/repo/actions/runs/123\n` +
      `**Artifact Digest**: sha256:fixture\n`,
    'V31-43-list.md':
      '# V31-43 —— list style\n\n- Status: open\n- Owner: none\n',
    'README.md': `| 票 | 标题 | Status（票面原文） |
|---|---|---|
| V31-01 | [Sample one](V31-01-sample.md) | done (merged) |
| V31-43 | [list style](V31-43-list.md) | open |
`,
  });

  const result = await assertV31TicketIndex({ ticketsDir, readmePath });
  assert.deepEqual(result.errors, []);
  assert.equal(result.tickets.length, 2);
});

test('fixture tree: status drift fails closed via CLI', async () => {
  const { ticketsDir } = await stageFixture({
    'V31-01-sample.md':
      '# V31-01 — Sample one\n\n**Status**: open\n',
    'README.md': `| 票 | 标题 | Status（票面原文） |
|---|---|---|
| V31-01 | [Sample one](V31-01-sample.md) | done |
`,
  });

  // Run against a custom cwd by temporarily... the CLI always uses repo paths.
  // Exercise the exported API instead for the staged tree, and CLI against repo separately.
  const result = await assertV31TicketIndex({
    ticketsDir,
    readmePath: join(ticketsDir, 'README.md'),
  });
  assert.ok(result.errors.length > 0);
  assert.ok(result.errors.some((error) => error.includes('drifts from ticket')));
});

test('generateStatusTable emits ticket Status literally', () => {
  const table = generateStatusTable([
    {
      id: 'V31-01',
      fileName: 'V31-01-a.md',
      status: 'open | careful',
      title: 'Title',
    },
  ]);
  assert.match(table, /\| V31-01 \| \[Title\]\(V31-01-a\.md\) \| open \\| careful \|/);
});

test('repository ticket index currently matches (live gate)', async () => {
  const result = await assertV31TicketIndex({
    ticketsDir: join(repositoryRoot, 'docs/tickets/v3.1'),
    readmePath: join(repositoryRoot, 'docs/tickets/v3.1/README.md'),
  });
  assert.deepEqual(
    result.errors,
    [],
    result.errors.join('\n') || 'expected clean index',
  );
});

test('CLI --help exits 0', () => {
  const result = spawnSync(process.execPath, [scriptPath, '--help'], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ticket-index governance/);
});

test('completed ticket without Evidence SHA fails closed', () => {
  const { errors } = checkTicketIndex({
    tickets: [
      {
        id: 'V31-01',
        fileName: 'V31-01-a.md',
        status: 'done (merged)',
        form: 'bold',
        title: 'A',
        fields: {
          implementationState: 'done',
          verificationState: 'verified',
          evidenceSha: null,
          workflowRun: null,
          artifactDigest: null,
        },
      },
    ],
    readmeRows: new Map([
      ['V31-01', { status: 'done (merged)', titleCell: 'A', line: 'x' }],
    ]),
  });
  assert.ok(
    errors.some((error) => error.includes('no **Evidence SHA**')),
    errors.join('\n'),
  );
});

test('completed ticket without Workflow Run or Artifact Digest fails closed', () => {
  const { errors, warnings } = checkTicketIndex({
    tickets: [
      {
        id: 'V31-01',
        fileName: 'V31-01-a.md',
        status: 'completed',
        form: 'bold',
        title: 'A',
        fields: {
          implementationState: 'done',
          verificationState: 'verified',
          evidenceSha: HEAD_SHA,
          workflowRun: null,
          artifactDigest: null,
        },
      },
    ],
    readmeRows: new Map([
      ['V31-01', { status: 'completed', titleCell: 'A', line: 'x' }],
    ]),
  });
  assert.ok(
    errors.some((error) =>
      error.includes('missing **Workflow Run** / **Artifact Digest** provenance'),
    ),
    errors.join('\n'),
  );
  assert.deepEqual(warnings, []);
});

test('completed ticket rejects each missing provenance field independently', () => {
  for (const [workflowRun, artifactDigest, missingField] of [
    [null, 'sha256:fixture', '**Workflow Run**'],
    ['run-123', null, '**Artifact Digest**'],
  ]) {
    const { errors } = checkTicketIndex({
      tickets: [
        {
          id: 'V31-01',
          fileName: 'V31-01-a.md',
          status: 'done',
          form: 'bold',
          title: 'A',
          fields: {
            implementationState: 'done',
            verificationState: 'verified',
            evidenceSha: HEAD_SHA,
            workflowRun,
            artifactDigest,
          },
        },
      ],
      readmeRows: new Map([
        ['V31-01', { status: 'done', titleCell: 'A', line: 'x' }],
      ]),
    });
    assert.ok(
      errors.some((error) => error.includes(`missing ${missingField} provenance`)),
      errors.join('\n'),
    );
  }
});

test('evidence-debt status does not claim completed provenance', () => {
  const { errors } = checkTicketIndex({
    tickets: [
      {
        id: 'V31-01',
        fileName: 'V31-01-a.md',
        status: 'evidence-debt (implementation landed; CI provenance pending)',
        form: 'bold',
        title: 'A',
        fields: {
          implementationState: 'done',
          verificationState: 'evidence-debt',
          evidenceSha: HEAD_SHA,
          workflowRun: null,
          artifactDigest: null,
        },
      },
    ],
    readmeRows: new Map([
      [
        'V31-01',
        {
          status: 'evidence-debt (implementation landed; CI provenance pending)',
          titleCell: 'A',
          line: 'x',
        },
      ],
    ]),
  });
  assert.deepEqual(errors, []);
});

test('Evidence SHA that is not a HEAD ancestor fails closed', () => {
  const { errors } = checkTicketIndex({
    tickets: [
      {
        id: 'V31-01',
        fileName: 'V31-01-a.md',
        status: 'done (merged)',
        form: 'bold',
        title: 'A',
        fields: {
          implementationState: 'done',
          verificationState: 'verified',
          evidenceSha: '1111111111111111111111111111111111111111',
          workflowRun: 'run-1',
          artifactDigest: 'sha256:abc',
        },
      },
    ],
    readmeRows: new Map([
      ['V31-01', { status: 'done (merged)', titleCell: 'A', line: 'x' }],
    ]),
  });
  assert.ok(
    errors.some((error) => error.includes('not an ancestor')),
    errors.join('\n'),
  );
});

test('ticket claiming "no push" whose Evidence SHA is reachable fails', () => {
  const { errors } = checkTicketIndex({
    tickets: [
      {
        id: 'V31-01',
        fileName: 'V31-01-a.md',
        status: 'implemented (local; no push)',
        form: 'bold',
        title: 'A',
        fields: {
          implementationState: 'implemented',
          verificationState: 'unverified',
          evidenceSha: HEAD_SHA,
          workflowRun: null,
          artifactDigest: null,
        },
      },
    ],
    readmeRows: new Map([
      [
        'V31-01',
        { status: 'implemented (local; no push)', titleCell: 'A', line: 'x' },
      ],
    ]),
  });
  assert.ok(
    errors.some((error) => error.includes('claims "no push"')),
    errors.join('\n'),
  );
});

test('open ticket without evidence fields passes (no provenance required)', () => {
  const { errors } = checkTicketIndex({
    tickets: [
      {
        id: 'V31-01',
        fileName: 'V31-01-a.md',
        status: 'open',
        form: 'bold',
        title: 'A',
        fields: {
          implementationState: 'open',
          verificationState: 'unverified',
          evidenceSha: null,
          workflowRun: null,
          artifactDigest: null,
        },
      },
    ],
    readmeRows: new Map([
      ['V31-01', { status: 'open', titleCell: 'A', line: 'x' }],
    ]),
  });
  assert.deepEqual(errors, []);
});
