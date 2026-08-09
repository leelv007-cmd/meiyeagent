import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  bareCommandViolations,
  commandHead,
  gateFamilyViolations,
  REMEDIATION,
  splitCommandSegments,
} from './root-script-contract.mjs';

const repositoryRoot = resolve(import.meta.dirname, '../..');

async function rootScripts() {
  const manifest = JSON.parse(
    await readFile(join(repositoryRoot, 'package.json'), 'utf8')
  );
  return manifest.scripts ?? {};
}

/** Diagnostic note only — never part of a verdict. */
function describeBin(head) {
  const linked = existsSync(join(repositoryRoot, 'node_modules/.bin', head));
  return `root node_modules/.bin/${head} ${linked ? 'exists' : 'does not exist'}`;
}

test('every root script launches through node, pnpm or bash', async () => {
  const scripts = await rootScripts();
  assert.ok(
    Object.keys(scripts).length > 0,
    'the root manifest must declare scripts'
  );

  const violations = bareCommandViolations(scripts, describeBin);
  assert.deepEqual(
    violations,
    [],
    'A root script invokes a binary that is not resolvable from the root install.\n' +
      'The root workspace has no devDependencies, so a bare binary resolves only\n' +
      'from a global install: green locally, "command not found" in CI, and the\n' +
      `required root-quality job fails.\n${REMEDIATION}\n` +
      `Offenders:\n${violations.map((line) => `  - ${line}`).join('\n')}`
  );
});

test('root test keeps every script gate family in one unmaskable run', async () => {
  const scripts = await rootScripts();
  assert.deepEqual(
    gateFamilyViolations(scripts.test),
    [],
    'The root "test" script must stay two steps: recursive workspace tests, then\n' +
      'one node --test run over every script gate family. Anything chained in\n' +
      'between makes every family behind the failing link unreachable.'
  );
});

/**
 * Regression fixture: the exact shape `codex/v31-fix-artifacts` introduced.
 * `tsx` is not a root devDependency and is not linked into root
 * `node_modules/.bin`, so it resolved from a global install locally and would
 * have been `command not found` in CI. It was also spliced into the middle of
 * the `&&` chain, putting all five gate families behind it.
 */
const OFFENDING_SCRIPTS = {
  test:
    'pnpm -r --if-present test && pnpm run test:journeys && node --test ' +
    'scripts/dev/*.test.mjs scripts/uiux/*.test.mjs scripts/recovery/*.test.mjs ' +
    'scripts/ops/*.test.mjs scripts/polotno-retirement-gate.test.mjs',
  'test:journeys':
    'tsx --test tests/v31-artifact-composer-sse-workbench.journey.test.ts',
};

test('the contract rejects a bare binary root script', () => {
  const violations = bareCommandViolations(OFFENDING_SCRIPTS);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /"test:journeys": bare command "tsx"/u);
});

test('the contract rejects a command spliced ahead of the gate families', () => {
  const violations = gateFamilyViolations(OFFENDING_SCRIPTS.test);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /found 3/u);
  assert.match(violations[0], /pnpm run test:journeys/u);
});

test('the contract rejects a dropped or unregistered gate family', () => {
  const dropped = gateFamilyViolations(
    'pnpm -r --if-present test && node --test scripts/dev/*.test.mjs ' +
      'scripts/uiux/*.test.mjs scripts/recovery/*.test.mjs ' +
      'scripts/ops/*.test.mjs'
  );
  assert.deepEqual(dropped, [
    'gate families missing from the run: scripts/polotno-retirement-gate.test.mjs',
  ]);

  const smuggled = gateFamilyViolations(
    'pnpm -r --if-present test && node --test scripts/dev/*.test.mjs ' +
      'scripts/uiux/*.test.mjs scripts/recovery/*.test.mjs ' +
      'scripts/ops/*.test.mjs scripts/polotno-retirement-gate.test.mjs ' +
      'scripts/journeys/*.test.mjs'
  );
  assert.equal(smuggled.length, 1);
  assert.match(smuggled[0], /unregistered arguments/u);
  assert.match(smuggled[0], /scripts\/journeys\/\*\.test\.mjs/u);
});

test('the contract rejects a gate family hidden behind its own step', () => {
  const violations = gateFamilyViolations(
    'pnpm -r --if-present test && node --test scripts/dev/*.test.mjs && ' +
      'node --test scripts/uiux/*.test.mjs'
  );
  assert.equal(violations.length, 1);
  assert.match(violations[0], /found 3/u);
});

test('segment splitting keeps quoted regexes and env prefixes intact', () => {
  assert.deepEqual(
    splitCommandSegments(
      'pnpm -r --parallel --filter @meiye/web run "/^dev(:worker)?$/"'
    ),
    ['pnpm -r --parallel --filter @meiye/web run "/^dev(:worker)?$/"']
  );
  assert.deepEqual(splitCommandSegments('a && b || c ; d | e'), [
    'a',
    'b',
    'c',
    'd',
    'e',
  ]);
  assert.equal(commandHead('APP_ENV=development MODEL=recorded node x.mjs'), 'node');
  assert.equal(commandHead('tsx --test x.ts'), 'tsx');
});
