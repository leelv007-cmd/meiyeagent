/**
 * Static assert: Result Center introduces no Result table / status entity /
 * second history ledger (D-085 / D-089 / #99 acceptance).
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { RESULT_SHELL_PROJECTION_ONLY } from './result-shell-model';

const RESULTS_DIR = fileURLToPath(new URL('.', import.meta.url));

const FORBIDDEN_PATTERNS: Array<{ name: string; re: RegExp }> = [
  {
    name: 'CREATE TABLE result',
    re: /CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?[`"']?results?\b/i,
  },
  {
    name: 'Result entity class/store',
    re: /\b(class|interface)\s+Result(Entity|Record|Table|Store|Repository)\b/,
  },
  {
    name: 'second result history table',
    re: /\bresult[_-]?history\b/i,
  },
  {
    name: 'insert into results',
    re: /INSERT\s+INTO\s+[`"']?results?\b/i,
  },
  {
    name: 'new Result status enum store',
    re: /\bResultStatusEntity\b|\bpersistResultStatus\b|\bsaveResultHistory\b/,
  },
];

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walkTsFiles(full));
      continue;
    }
    if (
      entry.endsWith('.ts') ||
      entry.endsWith('.tsx')
    ) {
      // Skip this static test file itself (contains forbidden strings as data).
      if (entry === 'no-second-result-history.static.test.ts') continue;
      out.push(full);
    }
  }
  return out;
}

test('RESULT_SHELL_PROJECTION_ONLY marker is true', () => {
  assert.equal(RESULT_SHELL_PROJECTION_ONLY, true);
});

test('product/results source tree has no Result table / second history', () => {
  const files = walkTsFiles(RESULTS_DIR);
  assert.ok(files.length > 0, 'expected results source files');

  const violations: string[] = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.re.test(source)) {
        violations.push(
          `${relative(RESULTS_DIR, file)}: ${pattern.name}`,
        );
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Forbidden Result entity / history patterns:\n${violations.join('\n')}`,
  );
});

test('shell model module documents projection-only ownership', () => {
  const shellSource = readFileSync(
    join(RESULTS_DIR, 'result-shell-model.ts'),
    'utf8',
  );
  assert.match(shellSource, /Projection only/i);
  assert.match(shellSource, /no Result table/i);
  // Must compose existing sub-projections rather than invent stores.
  assert.match(shellSource, /harnessCandidateResultModel/);
  assert.match(shellSource, /harnessCopyStreamPhase/);
});

test('ContentPackageResults is not remapped as Result Shell', () => {
  const shellSource = readFileSync(
    join(RESULTS_DIR, 'result-shell-model.ts'),
    'utf8',
  );
  // Documentation must keep the semantic boundary.
  assert.match(shellSource, /ContentPackageResults/);
  assert.match(shellSource, /intentionally NOT/i);
});
