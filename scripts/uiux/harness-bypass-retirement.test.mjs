import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const PRODUCTION_PREFIXES = [
  'apps/core/src/',
  'mkfast-template-main/src/',
  'packages/contracts/src/',
];

const FORBIDDEN_PRODUCTION_PATTERNS = [
  ['retired copy stream route', /p1\/copy\/stream/u],
  ['retired Operations copy stream entry', /\bstartCreativeCopyStream\b/u],
  ['retired internal copy stream entry', /\bstartCopyStream\b/u],
  ['dead structured candidate scorer', /\bStructuredCandidateScorer\b/u],
  ['dead candidate scorer port', /\bCandidateScorer\b/u],
  ['dead copy scoring rubric', /\bCOPY_SCORING_RUBRIC\b/u],
  ['dead copy scoring schema', /\bharness_copy_score_v1\b/u],
  ['disconnected output compiler table', /\bOUTPUT_COMPILER_CONTRACTS\b/u],
  ['disconnected output compiler accessor', /\boutputCompilerContract\b/u],
  ['retired structured stream source', /\bstructuredStreamCandidates\b/u],
  ['retired structured stream discriminator', /['"]structured_stream['"]/u],
];

function productionSources() {
  return execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .filter((path) =>
      PRODUCTION_PREFIXES.some((prefix) => path.startsWith(prefix))
    )
    .filter((path) => /\.(?:ts|tsx)$/u.test(path))
    .filter((path) => !/\.test\.(?:ts|tsx)$/u.test(path))
    .filter((path) => existsSync(path));
}

function lineOf(source, index) {
  return source.slice(0, index).split(/\r?\n/u).length;
}

function retiredHarnessFindings() {
  return productionSources().flatMap((path) => {
    const source = readFileSync(path, 'utf8');
    return FORBIDDEN_PRODUCTION_PATTERNS.flatMap(([reason, pattern]) => {
      const match = pattern.exec(source);
      return match
        ? [{ line: lineOf(source, match.index), path, reason }]
        : [];
    });
  });
}

test('D-118 keeps retired copy-stream and dead scorer/compiler seams out of production', () => {
  assert.deepEqual(retiredHarnessFindings(), []);
});
