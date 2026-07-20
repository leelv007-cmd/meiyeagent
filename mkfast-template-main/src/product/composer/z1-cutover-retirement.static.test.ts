/**
 * Z1 / #105 cutover static gates:
 * - T6 scene visual chips / named-preset contracts retired from runtime src
 * - dashboard home no longer mounts legacy workbench result bridge
 * - entries resolve to Result Center deep link
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const SRC_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PRODUCT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const DASHBOARD_INDEX = fileURLToPath(
  new URL('../../routes/dashboard/index.tsx', import.meta.url)
);

const FORBIDDEN_RUNTIME_TOKENS = [
  'Scene' + 'VisualButton',
  'NAMED_' + 'PRESET_CONTRACTS',
  'selectedPreset.internal' + 'Intent',
] as const;

function walkSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'docs') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walkSourceFiles(full));
      continue;
    }
    if (!entry.endsWith('.ts') && !entry.endsWith('.tsx')) continue;
    // Static tests may mention tokens as split data.
    if (entry.includes('.static.test.') || entry.includes('.test.')) continue;
    out.push(full);
  }
  return out;
}

test('runtime src has zero retired T6 tokens (scene visual / named preset / internal intent path)', () => {
  const files = walkSourceFiles(SRC_ROOT);
  assert.ok(files.length > 50, 'expected product+routes sources');

  const violations: string[] = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const token of FORBIDDEN_RUNTIME_TOKENS) {
      if (source.includes(token)) {
        violations.push(`${relative(SRC_ROOT, file)}: ${token}`);
      }
    }
  }

  assert.deepEqual(violations, [], violations.join('\n'));
});

test('dashboard index mounts ComposerHome and unhooks workId bridge to results', () => {
  const source = readFileSync(DASHBOARD_INDEX, 'utf8');
  assert.match(source, /ComposerHome/);
  assert.match(source, /\/dashboard\/results\/\$workId/);
  assert.doesNotMatch(source, /UnifiedCreationWorkbench/);
  assert.doesNotMatch(source, /MobileActionBook/);
  assert.match(source, /unhook|UNHOOKED|unhooked/i);
});

test('composer home submits to Result Center navigation helpers', () => {
  const home = readFileSync(
    join(PRODUCT_ROOT, 'composer/composer-home.tsx'),
    'utf8'
  );
  assert.match(home, /navigateAfterSubmitSuccess/);
  assert.match(home, /\/dashboard\/results\/\$workId/);
  assert.doesNotMatch(home, /selectedPreset\.internalIntent/);
  assert.doesNotMatch(home, /\?workId=/);
});
