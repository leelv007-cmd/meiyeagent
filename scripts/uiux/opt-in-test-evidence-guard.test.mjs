import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectStaleReasons,
  staleSuiteReason,
  suiteDirectory,
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
