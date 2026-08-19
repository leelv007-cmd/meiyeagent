import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildEvidenceGuardReport,
  buildPersistenceCalibrationSelections,
  classifiedStaleSuites,
  collectStaleReasons,
  receiptEvidenceIssue,
  staleSuiteReason,
  suiteDirectory,
  writePersistenceCalibrationSelections,
} from './opt-in-test-evidence-guard.mjs';

const never = () => [];
const touchedOnce = () => ['abc123'];

test('a suite whose directory is unchanged since its baseline passes', () => {
  assert.equal(
    staleSuiteReason(
      'apps/core/src/p1/harness/interaction-service.postgres.test.ts',
      { status: 'green', verifiedAt: 'a'.repeat(40) },
      never
    ),
    null
  );
});

test('touching the directory invalidates even a green baseline', () => {
  const reason = staleSuiteReason(
    'apps/core/src/p1/harness/interaction-service.postgres.test.ts',
    { status: 'green', verifiedAt: 'a'.repeat(40) },
    touchedOnce
  );
  assert.match(reason, /has changed 1 time\(s\) since/u);
  assert.match(reason, /apps\/core\/src\/p1\/harness/u);
});

test('an unverified baseline still guards its directory', () => {
  // The whole point of recording 'unverified' rather than failing outright:
  // it stays quiet until someone actually touches the code.
  assert.equal(
    staleSuiteReason('a/b/x.postgres.test.ts', {
      status: 'unverified',
      verifiedAt: 'a'.repeat(40),
    }, never),
    null
  );
  assert.match(
    staleSuiteReason('a/b/x.postgres.test.ts', {
      status: 'unverified',
      verifiedAt: 'a'.repeat(40),
    }, touchedOnce),
    /needs? a real run|has changed/u
  );
});

test('a brand new suite with no evidence fails', () => {
  assert.match(
    staleSuiteReason('a/b/new.postgres.test.ts', undefined, never),
    /new opt-in suite with no recorded evidence/u
  );
});

test('a red without a ticket fails, because nobody owns it', () => {
  assert.match(
    staleSuiteReason(
      'a/b/x.postgres.test.ts',
      { status: 'known_red', verifiedAt: 'a'.repeat(40) },
      never
    ),
    /recorded red without a ticket/u
  );
  assert.equal(
    staleSuiteReason(
      'a/b/x.postgres.test.ts',
      { status: 'known_red', verifiedAt: 'a'.repeat(40), ticket: '#999' },
      never
    ),
    null
  );
});

test('evidence without a verifiedAt commit pins nothing', () => {
  assert.match(
    staleSuiteReason('a/b/x.postgres.test.ts', { status: 'green' }, never),
    /without a verifiedAt commit/u
  );
});

test('collectStaleReasons reports every stale suite, not just the first', () => {
  const evidence = { suites: {} };
  assert.equal(
    collectStaleReasons(
      ['a/b/one.postgres.test.ts', 'a/b/two.smoke.test.ts'],
      evidence,
      never
    ).length,
    2
  );
});

test('suiteDirectory drops only the file name', () => {
  assert.equal(
    suiteDirectory('apps/core/src/p1/harness/x.postgres.test.ts'),
    'apps/core/src/p1/harness'
  );
});

test('the ownership catalog separates blocking reruns from advisory telemetry', () => {
  const paths = [
    'apps/core/src/p1/harness/a.postgres.test.ts',
    'mkfast-template-main/src/payment/b.postgres.test.ts',
  ];
  const evidence = {
    suites: Object.fromEntries(
      paths.map((path) => [
        path,
        { status: 'green', verifiedAt: 'a'.repeat(40) },
      ])
    ),
  };
  const catalog = {
    entries: [
      catalogEntry(paths[0], 'blocking'),
      catalogEntry(paths[1], 'advisory', 'CI-01B'),
    ],
  };

  const stale = classifiedStaleSuites(paths, evidence, catalog, touchedOnce);
  const report = buildEvidenceGuardReport({
    catalog,
    evidence,
    stale,
    suitePaths: paths,
  });

  assert.deepEqual(
    stale.map(({ path, action, blocksMerge }) => [path, action, blocksMerge]),
    [
      [paths[0], 'real-rerun', true],
      [paths[1], 'advisory', false],
    ]
  );
  assert.deepEqual(report.summary, {
    advisory: 1,
    blocking: 1,
    instrument: 0,
    retired: 0,
    unowned: 0,
  });
  assert.equal(report.blocksMerge, true);
});

test('a known-red suite cannot masquerade as blocking even before its directory changes', () => {
  const path = 'apps/core/src/p1/harness/a.postgres.test.ts';
  const stale = classifiedStaleSuites(
    [path],
    {
      suites: {
        [path]: {
          status: 'known_red',
          ticket: 'V31-66',
          verifiedAt: 'a'.repeat(40),
        },
      },
    },
    { entries: [catalogEntry(path, 'blocking')] },
    never
  );

  assert.equal(stale.length, 1);
  assert.equal(stale[0].action, 'real-rerun');
  assert.equal(stale[0].blocksMerge, true);
  assert.match(stale[0].reason, /blocking.*known_red/u);
});

test('a verified baseline that is not a HEAD ancestor fails closed even when its directory is unchanged', () => {
  const path = 'apps/core/src/p1/harness/a.postgres.test.ts';
  const stale = classifiedStaleSuites(
    [path],
    {
      suites: {
        [path]: { status: 'green', verifiedAt: 'a'.repeat(40) },
      },
    },
    { entries: [catalogEntry(path, 'blocking')] },
    never,
    () => false
  );

  assert.equal(stale.length, 1);
  assert.equal(stale[0].blocksMerge, true);
  assert.match(stale[0].reason, /not an ancestor of HEAD/u);
});

test('the guard makes documented retired evidence visible without treating it as a runnable suite', () => {
  const retiredPath = 'apps/core/src/p1/retired.postgres.test.ts';
  const report = buildEvidenceGuardReport({
    catalog: { entries: [] },
    evidence: {
      suites: {},
      retiredSuites: {
        [retiredPath]: {
          disposition: 'retired',
          decisionCommit: 'b'.repeat(40),
          reason: 'Removed with the retired product surface.',
        },
      },
    },
    stale: [],
    suitePaths: [],
  });

  assert.deepEqual(report.retired.map(({ path }) => path), [retiredPath]);
  assert.deepEqual(report.ledgerIssues, []);
  assert.equal(report.blocksMerge, false);
});

test('a retirement decision commit outside HEAD history fails the ledger', () => {
  const retiredPath = 'apps/core/src/p1/retired.postgres.test.ts';
  const report = buildEvidenceGuardReport({
    catalog: { entries: [] },
    evidence: {
      suites: {},
      retiredSuites: {
        [retiredPath]: {
          disposition: 'retired',
          decisionCommit: 'b'.repeat(40),
          reason: 'Removed with the retired product surface.',
        },
      },
    },
    isAncestor: () => false,
    stale: [],
    suitePaths: [],
  });

  assert.equal(report.ledgerIssues.length, 1);
  assert.match(report.ledgerIssues[0].reason, /not an ancestor of HEAD/u);
  assert.equal(report.blocksMerge, true);
});

test('an undocumented disappeared suite is a ledger error, not a silent removal', () => {
  const retiredPath = 'apps/core/src/p1/retired.postgres.test.ts';
  const report = buildEvidenceGuardReport({
    catalog: { entries: [] },
    evidence: {
      suites: {
        [retiredPath]: { status: 'green', verifiedAt: 'a'.repeat(40) },
      },
    },
    stale: [],
    suitePaths: [],
  });

  assert.equal(report.ledgerIssues.length, 1);
  assert.match(report.ledgerIssues[0].reason, /no retirement record/u);
  assert.equal(report.blocksMerge, true);
});

test('the guard writes machine-readable selections for each nonblocking and blocking batch', async () => {
  const stale = [
    {
      path: 'apps/core/src/p1/harness/a.postgres.test.ts',
      action: 'real-rerun',
      decision: 'blocking',
      blocksMerge: true,
    },
    {
      path: 'mkfast-template-main/src/payment/b.postgres.test.ts',
      action: 'advisory',
      decision: 'advisory',
      blocksMerge: false,
    },
    {
      path: 'mkfast-template-main/src/payment/c.postgres.test.ts',
      action: 'instrument',
      decision: 'instrument',
      blocksMerge: false,
    },
  ];
  const selections = buildPersistenceCalibrationSelections(stale);
  assert.deepEqual(
    selections.map(({ decision, paths }) => [decision, paths]),
    [
      ['blocking', ['apps/core/src/p1/harness/a.postgres.test.ts']],
      ['advisory', ['mkfast-template-main/src/payment/b.postgres.test.ts']],
      ['instrument', ['mkfast-template-main/src/payment/c.postgres.test.ts']],
    ]
  );

  const directory = await mkdtemp(path.join(tmpdir(), 'meiye-evidence-plan-'));
  await writePersistenceCalibrationSelections({
    directory,
    commitSha: 'c'.repeat(40),
    selections,
  });
  const blocking = JSON.parse(
    await readFile(path.join(directory, 'blocking.json'), 'utf8')
  );
  assert.deepEqual(blocking, {
    schemaVersion: 'persistence-selection/v1',
    commitSha: 'c'.repeat(40),
    decision: 'blocking',
    paths: ['apps/core/src/p1/harness/a.postgres.test.ts'],
  });
});

test('a receipt must bind the suite and its verified SHA before it strengthens ledger evidence', () => {
  const suitePath = 'apps/core/src/p1/harness/a.postgres.test.ts';
  const record = {
    receipt: 'docs/ops/persistence-calibrations/a.json',
    verifiedAt: 'a'.repeat(40),
  };
  const receipt = {
    schemaVersion: 'opt-in-persistence-calibration/v1',
    commitSha: 'a'.repeat(40),
    files: [
      {
        path: suitePath,
        counts: { pass: 1, fail: 0, skip: 0 },
        verdict: 'pass',
        artifact: { path: 'output/ci/a.tap', sha256: 'b'.repeat(64) },
      },
    ],
  };

  assert.equal(receiptEvidenceIssue(suitePath, record, receipt), null);
  assert.match(
    receiptEvidenceIssue(suitePath, record, {
      ...receipt,
      commitSha: 'c'.repeat(40),
    }),
    /does not match verifiedAt/u
  );
  assert.match(
    receiptEvidenceIssue(suitePath, record, {
      ...receipt,
      files: [],
    }),
    /does not contain/u
  );
  assert.match(
    receiptEvidenceIssue(suitePath, record, receipt, () => false),
    /not an ancestor of HEAD/u
  );
});

function catalogEntry(path, currentDecision, ticket) {
  return {
    path,
    kind: 'persistence',
    owner: 'persistence-owner',
    tier: currentDecision === 'blocking' ? 'required' : 'advisory',
    env: 'fresh-business-db+dbos-system-db',
    currentDecision,
    allowedSkip: false,
    artifact: 'output/ci/persistence/{basename}.tap',
    producer: 'scripts/ci/run-persistence-evidence-instrument.mjs',
    ...(ticket ? { ticket } : {}),
  };
}
