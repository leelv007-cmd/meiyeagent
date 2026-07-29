import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  isIssue255SharedE2eLockHeld,
  resolveIssue255RepositoryRoot,
} from './issue-255-safe-provision.mjs';

const provisioner = fileURLToPath(
  new URL('./issue-255-safe-provision.mjs', import.meta.url),
);

test('issue 255 provisioner rejects the legacy unconditional cleanup mode', () => {
  const hiddenPassword = 'issue-255-test-password';
  const result = spawnSync(process.execPath, [provisioner, '--cleanup'], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      TEST_DATABASE_URL:
        `postgresql://issue255:${hiddenPassword}@127.0.0.1:1/meiye_issue255`,
      TEST_DBOS_SYSTEM_DATABASE_URL:
        `postgresql://issue255:${hiddenPassword}@127.0.0.1:1/meiye_issue255_dbos`,
    },
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Usage:/u);
  assert.doesNotMatch(result.stdout, new RegExp(hiddenPassword, 'u'));
  assert.doesNotMatch(result.stderr, new RegExp(hiddenPassword, 'u'));
});

test('issue 255 provisioner validates both fixed database targets before inspection', () => {
  const hiddenPassword = 'issue-255-test-password';
  const result = spawnSync(process.execPath, [provisioner, '--inspect'], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      TEST_DATABASE_URL:
        `postgresql://issue255:${hiddenPassword}@127.0.0.1:1/meiye_issue255`,
      TEST_DBOS_SYSTEM_DATABASE_URL:
        `postgresql://issue255:${hiddenPassword}@127.0.0.1:1/postgres`,
    },
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /cleanup refused an unexpected database name/u,
  );
  assert.doesNotMatch(result.stdout, new RegExp(hiddenPassword, 'u'));
  assert.doesNotMatch(result.stderr, new RegExp(hiddenPassword, 'u'));
});

test('issue 255 reset inspection is fail-closed and never exposes connection values', () => {
  const hiddenPassword = 'issue-255-test-password';
  const result = spawnSync(process.execPath, [provisioner, '--inspect'], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      TEST_DATABASE_URL:
        `postgresql://issue255:${hiddenPassword}@127.0.0.1:1/meiye_issue255`,
      TEST_DBOS_SYSTEM_DATABASE_URL:
        `postgresql://issue255:${hiddenPassword}@127.0.0.1:1/meiye_issue255_dbos`,
    },
  });

  assert.equal(result.status, 0);
  const inspection = JSON.parse(result.stdout);
  assert.deepEqual(inspection, {
    authorizationCount: null,
    businessDatabaseReachable: false,
    collectorProcessCount: 0,
    collectorStopped: true,
    dbosDatabaseReachable: false,
    inspectionComplete: false,
    issue255ProviderCostCount: null,
    liveOperationalFactCount: null,
    ownerCount: null,
    ownerOnlyDurableFact: false,
    receiptCount: null,
    resetSafe: false,
    submittedOrNonClaimedReceiptCount: null,
  });
  assert.doesNotMatch(result.stdout, new RegExp(hiddenPassword, 'u'));
  assert.doesNotMatch(result.stderr, new RegExp(hiddenPassword, 'u'));
});

test('issue 255 conditional cleanup refuses to mutate outside the shared lock', () => {
  const hiddenPassword = 'issue-255-test-password';
  const result = spawnSync(
    process.execPath,
    [provisioner, '--cleanup-if-safe'],
    {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        TEST_DATABASE_URL:
          `postgresql://issue255:${hiddenPassword}@127.0.0.1:1/meiye_issue255`,
        TEST_DBOS_SYSTEM_DATABASE_URL:
          `postgresql://issue255:${hiddenPassword}@127.0.0.1:1/meiye_issue255_dbos`,
      },
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requires the shared e2e lock/u);
  assert.doesNotMatch(result.stdout, new RegExp(hiddenPassword, 'u'));
  assert.doesNotMatch(result.stderr, new RegExp(hiddenPassword, 'u'));
});

test('issue 255 provisioner resolves its repository instead of a developer lane', () => {
  assert.equal(
    resolveIssue255RepositoryRoot({
      moduleUrl:
        'file:///tmp/portable-repo/scripts/ci/issue-255-safe-provision.mjs',
    }),
    '/tmp/portable-repo',
  );
  assert.equal(
    resolveIssue255RepositoryRoot({
      moduleUrl: 'data:text/javascript;base64,',
      repositoryRoot: '/tmp/verified-repo',
    }),
    '/tmp/verified-repo',
  );
  assert.throws(
    () =>
      resolveIssue255RepositoryRoot({
        moduleUrl: 'data:text/javascript;base64,',
      }),
    /repository root is required/u,
  );
});

test('issue 255 mutation recognizes only the shared lock owner ancestry', () => {
  const parents = new Map([
    [300, 200],
    [200, 100],
    [100, 1],
  ]);
  const parentPidFor = (pid) => parents.get(pid) ?? null;

  assert.equal(
    isIssue255SharedE2eLockHeld({
      currentPid: 300,
      lockContents: 'pid 200 in /tmp/portable-repo',
      parentPidFor,
    }),
    true,
  );
  assert.equal(
    isIssue255SharedE2eLockHeld({
      currentPid: 300,
      lockContents: 'pid 999 in /tmp/other-repo',
      parentPidFor,
    }),
    false,
  );
  assert.equal(
    isIssue255SharedE2eLockHeld({
      currentPid: 300,
      lockContents: 'untrusted lock contents',
      parentPidFor,
    }),
    false,
  );
});
