import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const repositoryRoot = resolve(import.meta.dirname, '../..');

test('merchant-language Promptfoo uses one pinned local and CI entry with a negative control', async () => {
  const packageJson = JSON.parse(
    await readFile(resolve(repositoryRoot, 'package.json'), 'utf8'),
  );
  const workflow = await readFile(
    resolve(repositoryRoot, '.github/workflows/core-quality.yml'),
    'utf8',
  );
  const runner = await readFile(
    resolve(repositoryRoot, 'scripts/evals/run-promptfoo.mjs'),
    'utf8',
  );
  assert.equal(
    packageJson.scripts['eval:merchant-language:promptfoo'],
    'node scripts/evals/run-promptfoo.mjs merchant-language',
  );
  assert.equal(
    packageJson.scripts['eval:merchant-language:promptfoo:control'],
    'node scripts/evals/run-promptfoo.mjs merchant-language --control',
  );
  assert.match(runner, /PROMPTFOO_VERSION = '0\.121\.19'/);
  assert.match(
    runner,
    /promptfooconfig\.\$\{suite\}\$\{control \? '\.assertion-control' : ''\}\.yaml/,
  );
  assert.match(workflow, /run: pnpm eval:merchant-language:promptfoo\b/);
  assert.match(
    workflow,
    /if pnpm eval:merchant-language:promptfoo:control; then/,
  );
  assert.doesNotMatch(
    workflow,
    /pnpm dlx promptfoo@0\.121\.19 eval\s+-c promptfooconfig\.merchant-language\.yaml/,
  );
});
