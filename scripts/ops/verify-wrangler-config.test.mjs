import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  HYPERDRIVE_PLACEHOLDER_ID,
  findWranglerConfigs,
  isHyperdrivePlaceholder,
  parseJsonc,
  verifyWranglerConfigs,
} from './verify-wrangler-config.mjs';

const repositoryRoot = resolve(import.meta.dirname, '../..');

test('the repository wrangler configs are structurally complete', () => {
  const result = verifyWranglerConfigs({ root: repositoryRoot });
  assert.deepEqual(result.structureIssues, []);
  assert.deepEqual(
    result.configs.map((entry) => entry.path),
    ['mkfast-template-main/wrangler.jsonc', 'mkfast-template-main/wrangler.quality.jsonc']
  );
  assert.equal(result.ok, true);
});

test('placeholders are reported, and only become failures under --require-real-resources', () => {
  const reported = verifyWranglerConfigs({ root: repositoryRoot });
  const ids = new Set(reported.placeholders.map((finding) => finding.id));
  assert.ok(ids.has('template_worker_name'));
  assert.ok(ids.has('demo_route_domain'));
  assert.ok(ids.has('hyperdrive_placeholder'));
  assert.ok(ids.has('template_bucket_name'));
  assert.equal(reported.ok, true, 'reporting placeholders must not fail the gate today');

  const strict = verifyWranglerConfigs({
    requireRealResources: true,
    root: repositoryRoot,
  });
  assert.equal(strict.ok, false);
  assert.deepEqual(strict.structureIssues, []);
});

test('core, worker, and canvas are never reported for missing wrangler configs', () => {
  const result = verifyWranglerConfigs({ root: repositoryRoot });
  assert.deepEqual(result.nonWorkerUnits, ['core', 'worker', 'canvas']);
  const found = findWranglerConfigs(repositoryRoot);
  assert.ok(found.every((path) => path.startsWith('mkfast-template-main/')));
  const blob = JSON.stringify(result);
  for (const unit of ['apps/core', 'apps/canvas']) {
    assert.ok(!blob.includes(unit), `${unit} must not appear in the report`);
  }
});

test('the Hyperdrive placeholder definition stays bound to the Core config-risk source', async () => {
  const source = await readFile(
    join(repositoryRoot, 'apps/core/src/p1/cloudflare-read/config-risk.ts'),
    'utf8'
  );
  assert.match(
    source,
    new RegExp(`HYPERDRIVE_PLACEHOLDER_ID\\s*=\\s*\n?\\s*'${HYPERDRIVE_PLACEHOLDER_ID}'`)
  );
  assert.equal(isHyperdrivePlaceholder(HYPERDRIVE_PLACEHOLDER_ID), true);
  assert.equal(isHyperdrivePlaceholder('00000000-0000-0000-0000-000000000000'), true);
  assert.equal(isHyperdrivePlaceholder(undefined), true);
  assert.equal(isHyperdrivePlaceholder('7f3d9a11-2b6c-4c2e-9f3a-1b2c3d4e5f60'), false);
});

test('JSONC comments, trailing commas, and URLs inside strings all parse', () => {
  const parsed = parseJsonc(`{
    // line comment
    "name": "unit", /* block comment */
    "url": "https://example.test/path", // trailing
    "list": [1, 2,],
  }`);
  assert.deepEqual(parsed, {
    list: [1, 2],
    name: 'unit',
    url: 'https://example.test/path',
  });
});

test('missing key positions, forbidden D1 bindings, and unparseable configs fail hard', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'meiye-wrangler-verify-'));
  await mkdir(join(directory, 'web'), { recursive: true });
  await writeFile(
    join(directory, 'web/wrangler.jsonc'),
    JSON.stringify({
      compatibility_date: 'yesterday',
      compatibility_flags: ['global_fetch_strictly_public'],
      d1_databases: [{ binding: 'DB', database_id: 'x' }],
      main: './src/server.ts',
      r2_buckets: [{ binding: 'BUCKET' }],
    })
  );
  await writeFile(join(directory, 'web/wrangler.broken.jsonc'), '{ "name": ');

  const result = verifyWranglerConfigs({ root: directory });
  const joined = result.structureIssues.join('\n');
  assert.equal(result.ok, false);
  assert.match(joined, /name is required/);
  assert.match(joined, /compatibility_date must be an ISO date/);
  assert.match(joined, /compatibility_flags must include nodejs_compat/);
  assert.match(joined, /hyperdrive binding is required/);
  assert.match(joined, /r2_buckets\[0\]\.bucket_name is required/);
  assert.match(joined, /d1_databases must not be declared/);
  assert.match(joined, /main entrypoint \.\/src\/server\.ts does not exist/);
  assert.match(joined, /wrangler\.broken\.jsonc: not parseable as JSONC/);
});

test('an empty tree reports the missing Web unit configuration', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'meiye-wrangler-empty-'));
  const result = verifyWranglerConfigs({ root: directory });
  assert.equal(result.ok, false);
  assert.deepEqual(result.structureIssues, [
    'no wrangler configuration was found for the Web unit',
  ]);
});
