import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = resolve(import.meta.dirname, 'assert-production-audit.mjs');

async function run({
  vulnerabilities,
  advisories = {},
  waivers = [],
  date = '2026-07-25',
}) {
  const directory = await mkdtemp(join(tmpdir(), 'meiye-audit-'));
  const auditPath = join(directory, 'audit.json');
  const waiverPath = join(directory, 'waivers.json');
  await writeFile(
    auditPath,
    JSON.stringify({ advisories, metadata: { vulnerabilities } })
  );
  await writeFile(
    waiverPath,
    JSON.stringify({ schemaVersion: 1, waivers })
  );
  return spawnSync(process.execPath, [script, auditPath, waiverPath], {
    encoding: 'utf8',
    env: { ...process.env, PRODUCTION_AUDIT_DATE: date },
  });
}

test('accepts an audit with no high or critical production vulnerabilities', async () => {
  const result = await run({
    vulnerabilities: { critical: 0, high: 0, low: 2, moderate: 3 },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /critical=0 high=0 moderate=3 low=2/);
  assert.match(result.stdout, /waived=0 unwaived=0/);
});

test('blocks a release when high or critical production vulnerabilities remain', async () => {
  const result = await run({
    vulnerabilities: { critical: 1, high: 2, low: 0, moderate: 0 },
    advisories: {
      123: {
        severity: 'critical',
        module_name: 'example-package',
        github_advisory_id: 'GHSA-aaaa-bbbb-cccc',
        recommendation: 'Upgrade to 2.0.0',
        findings: [
          {
            version: '1.0.0',
            paths: ['workspace>parent>example-package'],
          },
        ],
      },
    },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /critical=1 high=2/);
  assert.match(
    result.stderr,
    /critical example-package@1\.0\.0 GHSA-aaaa-bbbb-cccc: Upgrade to 2\.0\.0; path=workspace>parent>example-package/
  );
});

test('accepts a blocking advisory with an active formal waiver', async () => {
  const result = await run({
    vulnerabilities: { critical: 0, high: 1, low: 0, moderate: 0 },
    advisories: {
      123: {
        severity: 'high',
        module_name: 'example-package',
        github_advisory_id: 'GHSA-aaaa-bbbb-cccc',
        findings: [{ version: '1.0.0', paths: ['example-package'] }],
      },
    },
    waivers: [
      {
        advisoryId: 'GHSA-aaaa-bbbb-cccc',
        reason: 'The vulnerable entry point is not reachable in production.',
        expiresOn: '2026-08-25',
      },
    ],
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /waived=1 unwaived=0/);
});

test('rejects an expired waiver', async () => {
  const result = await run({
    vulnerabilities: { critical: 0, high: 1, low: 0, moderate: 0 },
    advisories: {
      123: {
        severity: 'high',
        module_name: 'example-package',
        github_advisory_id: 'GHSA-aaaa-bbbb-cccc',
      },
    },
    waivers: [
      {
        advisoryId: 'GHSA-aaaa-bbbb-cccc',
        reason: 'Temporary compatibility exception.',
        expiresOn: '2026-07-24',
      },
    ],
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /expired on 2026-07-24/);
});

test('rejects a waiver with an impossible calendar date', async () => {
  const result = await run({
    vulnerabilities: { critical: 0, high: 0, low: 0, moderate: 0 },
    waivers: [
      {
        advisoryId: 'GHSA-aaaa-bbbb-cccc',
        reason: 'Temporary compatibility exception.',
        expiresOn: '2026-02-31',
      },
    ],
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /invalid expiresOn date/);
});

test('fails closed when the audit result cannot be parsed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'meiye-audit-invalid-'));
  const auditPath = join(directory, 'audit.json');
  const waiverPath = join(directory, 'waivers.json');
  await writeFile(auditPath, 'not-json');
  await writeFile(waiverPath, JSON.stringify({ schemaVersion: 1, waivers: [] }));
  const result = spawnSync(
    process.execPath,
    [script, auditPath, waiverPath],
    { encoding: 'utf8' }
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unable to verify production dependency audit/);
});

test('fails closed when the waiver manifest is malformed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'meiye-audit-invalid-'));
  const auditPath = join(directory, 'audit.json');
  const waiverPath = join(directory, 'waivers.json');
  await writeFile(
    auditPath,
    JSON.stringify({
      advisories: {},
      metadata: {
        vulnerabilities: { critical: 0, high: 0, low: 0, moderate: 0 },
      },
    })
  );
  await writeFile(waiverPath, JSON.stringify({ waivers: [] }));
  const result = spawnSync(
    process.execPath,
    [script, auditPath, waiverPath],
    { encoding: 'utf8' }
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /schemaVersion=1/);
});
