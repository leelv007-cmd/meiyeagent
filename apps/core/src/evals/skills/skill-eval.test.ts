import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { evalRunSchema } from '@meiye/contracts';

const artifactUrl = new URL(
  './skills.baseline.eval-run.json',
  import.meta.url,
);

test('Skill eval artifact pins a canonical Skill revision on every case', async () => {
  const run = evalRunSchema.parse(
    JSON.parse(await readFile(artifactUrl, 'utf8')),
  );

  assert.equal(run.suiteId, 'harness-skills');
  assert.equal(run.passed, true);
  assert.equal(run.results.length, 2);
  assert.ok(
    run.results.every(
      (result) =>
        result.skillRevisionRef === 'skill.daily-industry@1' &&
        result.passed,
    ),
  );
});
