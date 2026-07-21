import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = resolve(import.meta.dirname, 'assert-production-audit.mjs');

async function run(vulnerabilities, advisories = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'meiye-audit-'));
  const path = join(directory, 'audit.json');
  await writeFile(
    path,
    JSON.stringify({ advisories, metadata: { vulnerabilities } })
  );
  return spawnSync(process.execPath, [script, path], { encoding: 'utf8' });
}

test('accepts an audit with no high or critical production vulnerabilities', async () => {
  const result = await run({ critical: 0, high: 0, low: 2, moderate: 3 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /critical=0 high=0 moderate=3 low=2/);
});

test('blocks a release when high or critical production vulnerabilities remain', async () => {
  const result = await run(
    { critical: 1, high: 2, low: 0, moderate: 0 },
    {
      123: {
        severity: 'critical',
        module_name: 'example-package',
        github_advisory_id: 'GHSA-example',
        recommendation: 'Upgrade to 2.0.0',
        findings: [
          {
            version: '1.0.0',
            paths: ['workspace>parent>example-package'],
          },
        ],
      },
    }
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /critical=1 high=2/);
  assert.match(
    result.stderr,
    /critical example-package@1\.0\.0 GHSA-example: Upgrade to 2\.0\.0; path=workspace>parent>example-package/
  );
});

test('fails closed when the audit result cannot be parsed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'meiye-audit-invalid-'));
  const path = join(directory, 'audit.json');
  await writeFile(path, 'not-json');
  const result = spawnSync(process.execPath, [script, path], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unable to verify production dependency audit/);
});
