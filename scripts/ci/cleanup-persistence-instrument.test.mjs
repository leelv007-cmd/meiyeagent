import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  cleanupInstrumentPair,
  hasExactOwnership,
  instrumentOwnershipComment,
  markInstrumentPairOwnership,
} from './cleanup-persistence-instrument.mjs';

const sha = 'a'.repeat(40);
const adminUrl = 'postgres://owner:secret@127.0.0.1:5432/postgres';
const provision = {
  schemaVersion: 'persistence-provision/v1',
  provisioner: 'provision-persistence-instrument/v1',
  commitSha: sha,
  provisionId: '12345678-1234-4abc-8def-1234567890ab',
  fresh: true,
  provisionedAt: '2026-08-20T12:00:00.000Z',
  databasePair: {
    business: 'to-be-filled',
    dbosSystem: 'to-be-filled',
  },
  databaseNames: {
    business: 'meiye_instrument_5678_1234_4abc_8def_1234567890ab_biz',
    dbosSystem: 'meiye_instrument_5678_1234_4abc_8def_1234567890ab_dbos',
  },
};

test('marks both newly provisioned databases with their exact ownership comment', () => {
  const calls = [];
  markInstrumentPairOwnership(
    { adminUrl, provision: provisionWithFingerprints() },
    {
      runStatement(url, statement) {
        calls.push({ url, statement });
        return { status: 0, stdout: '', stderr: '' };
      },
    }
  );

  assert.equal(calls.length, 1);
  assert.match(calls[0].statement, /COMMENT ON DATABASE/u);
  assert.match(calls[0].statement, /meiye-persistence-instrument\/v1/u);
  assert.doesNotMatch(calls[0].statement, /owner:secret/u);
});

test('ownership parser accepts PostgreSQL tabular output exactly', () => {
  const owned = provisionWithFingerprints();
  assert.equal(
    hasExactOwnership(
      `${owned.databaseNames.business}|${instrumentOwnershipComment(owned)}\n${owned.databaseNames.dbosSystem}|${instrumentOwnershipComment(owned)}\n`,
      {
        databaseNames: [
          owned.databaseNames.business,
          owned.databaseNames.dbosSystem,
        ],
        ownerComment: instrumentOwnershipComment(owned),
      }
    ),
    true
  );
});

test('owner-verified cleanup terminates connections, drops only the pair, and verifies absence', () => {
  const owned = provisionWithFingerprints();
  const calls = [];
  const result = cleanupInstrumentPair(
    { adminUrl, expectedSha: sha, provision: owned },
    {
      runStatement(_url, statement) {
        calls.push(statement);
        if (statement.includes('shobj_description')) {
          return {
            status: 0,
            stdout: `${owned.databaseNames.business}|${instrumentOwnershipComment(owned)}\n${owned.databaseNames.dbosSystem}|${instrumentOwnershipComment(owned)}\n`,
            stderr: '',
          };
        }
        return { status: 0, stdout: '', stderr: '' };
      },
    }
  );

  assert.deepEqual(result.databaseNames, owned.databaseNames);
  assert.equal(calls.filter((statement) => statement.includes('DROP DATABASE')).length, 2);
  assert.match(calls[1], /pg_terminate_backend/u);
  assert.match(calls.at(-1), /FROM pg_database/u);
});

test('a wrong or absent owner marker aborts before any destructive statement', () => {
  const owned = provisionWithFingerprints();
  const calls = [];
  assert.throws(
    () =>
      cleanupInstrumentPair(
        { adminUrl, expectedSha: sha, provision: owned },
        {
          runStatement(_url, statement) {
            calls.push(statement);
            if (statement.includes('shobj_description')) {
              return {
                status: 0,
                stdout: `${owned.databaseNames.business}|wrong-owner\n`,
                stderr: '',
              };
            }
            return { status: 0, stdout: '', stderr: '' };
          },
        }
      ),
    /owner marker/u
  );
  assert.equal(calls.some((statement) => statement.includes('DROP DATABASE')), false);
  assert.equal(
    calls.some((statement) => statement.includes('pg_terminate_backend')),
    false
  );
});

test('cleanup refuses a provision whose database names do not derive from its unique provision id', () => {
  const invalid = provisionWithFingerprints();
  invalid.databaseNames.business = 'meiye_test';
  assert.throws(
    () => cleanupInstrumentPair({ adminUrl, expectedSha: sha, provision: invalid }),
    /database names do not match/u
  );
});

function provisionWithFingerprints() {
  const copy = structuredClone(provision);
  copy.databasePair = {
    business: databaseFingerprint(copy.databaseNames.business),
    dbosSystem: databaseFingerprint(copy.databaseNames.dbosSystem),
  };
  return copy;
}

function databaseFingerprint(databaseName) {
  return createHash('sha256')
    .update(`postgres://127.0.0.1:5432/${databaseName}`)
    .digest('hex');
}
