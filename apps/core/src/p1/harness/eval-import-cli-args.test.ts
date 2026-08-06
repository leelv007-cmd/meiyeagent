import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EVAL_IMPORT_USAGE,
  parseEvalImportCliArgs,
} from './eval-import-cli-args.js';

test('eval:import without recipe flags only returns the artifact path', () => {
  assert.deepEqual(parseEvalImportCliArgs(['artifact.json']), {
    artifactPath: 'artifact.json',
  });
  assert.deepEqual(
    parseEvalImportCliArgs(['path/to/redlines.baseline.eval-run.json']),
    { artifactPath: 'path/to/redlines.baseline.eval-run.json' },
  );
});

test('eval:import requires recipe, revision, and kind together for issuance', () => {
  assert.deepEqual(
    parseEvalImportCliArgs([
      'artifact.json',
      '--recipe',
      'recipe.demo',
      '--revision',
      '3',
      '--kind',
      'recipe_evaluation',
    ]),
    {
      artifactPath: 'artifact.json',
      issue: {
        recipeId: 'recipe.demo',
        recipeRevision: 3,
        evidenceKind: 'recipe_evaluation',
      },
    },
  );

  assert.throws(
    () =>
      parseEvalImportCliArgs([
        'artifact.json',
        '--recipe',
        'recipe.demo',
        '--revision',
        '3',
      ]),
    /requires --recipe, --revision, and --kind together/,
  );
  assert.throws(
    () => parseEvalImportCliArgs(['--recipe', 'recipe.demo']),
    new RegExp(EVAL_IMPORT_USAGE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  );
});

test('eval:import rejects external issuerId and unknown flags', () => {
  assert.throws(
    () =>
      parseEvalImportCliArgs([
        'artifact.json',
        '--recipe',
        'recipe.demo',
        '--revision',
        '1',
        '--kind',
        'recipe_evaluation',
        '--issuerId',
        'attacker',
      ]),
    /issuerId is server-owned/,
  );
  assert.throws(
    () => parseEvalImportCliArgs(['artifact.json', '--issuer', 'x']),
    /issuerId is server-owned/,
  );
  assert.throws(
    () => parseEvalImportCliArgs(['artifact.json', '--unknown', 'x']),
    /Unknown eval:import flag/,
  );
  assert.throws(
    () =>
      parseEvalImportCliArgs([
        'artifact.json',
        '--recipe',
        'recipe.demo',
        '--revision',
        '0',
        '--kind',
        'recipe_evaluation',
      ]),
    /positive integer/,
  );
  assert.throws(
    () =>
      parseEvalImportCliArgs([
        'artifact.json',
        '--recipe',
        'recipe.demo',
        '--revision',
        '1',
        '--kind',
        'not-a-kind',
      ]),
    /recipe_evaluation or recipe_internal_test/,
  );
});
