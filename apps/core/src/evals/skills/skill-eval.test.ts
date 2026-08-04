import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { evalRunSchema } from '../../contracts/index.js';
import { SKILL_ACCEPTANCE_CASES } from './cases.js';
import { createRecordedSkillEvalRun } from './skill-artifact.js';

const artifactUrl = new URL(
  './skills.baseline.eval-run.json',
  import.meta.url,
);

test('Skill eval artifact pins a canonical Skill revision on every case', async () => {
  const run = evalRunSchema.parse(
    JSON.parse(await readFile(artifactUrl, 'utf8')),
  );
  const generated = createRecordedSkillEvalRun();

  assert.equal(run.suiteId, 'harness-skills');
  assert.equal(run.passed, true);
  assert.equal(run.results.length, SKILL_ACCEPTANCE_CASES.length);
  assert.ok(
    run.results.every(
      (result) =>
        result.skillRevisionRef === 'skill.daily-industry@1' &&
        result.passed,
    ),
  );
  assert.deepEqual(generated, run);
});

test('Skill acceptance eval turns red when the exact-revision gate is mutated open', () => {
  const mutated = createRecordedSkillEvalRun(() => null);

  assert.equal(mutated.passed, false);
  assert.equal(
    mutated.results.find(
      (result) => result.caseId === 'different-skill-eval-is-rejected',
    )?.passed,
    false,
  );
});
