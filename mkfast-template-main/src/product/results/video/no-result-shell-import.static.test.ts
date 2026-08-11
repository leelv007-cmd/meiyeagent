/**
 * #104 acceptance: Result Shell zero direct import (contract boundary).
 *
 * Video worksurface may import `@meiye/contracts` (result-center +
 * video-workflow public projection) and local video/* modules only.
 * It must not reach into Result Shell internals under product/results.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const VIDEO_DIR = fileURLToPath(new URL('.', import.meta.url));

/** Sibling Result Shell modules owned by WT-D1 — forbidden from video/**. */
const FORBIDDEN_RELATIVE_IMPORTS = [
  'result-shell-model',
  'result-command-adapter',
  'result-center-page',
  'result-token-stream',
  'result-return-restore',
  'result-target-wiring',
  'result-center-navigation',
  'result-center-route',
];

const FORBIDDEN_IMPORT_PATTERNS: Array<{ name: string; re: RegExp }> = [
  {
    name: 'relative parent result shell import',
    re: /from\s+['"]\.\.\/(result-shell-model|result-command-adapter|result-center-page|result-token-stream|result-return-restore|result-target-wiring|result-center-navigation)['"]/,
  },
  {
    name: 'alias product/results shell import',
    re: /from\s+['"]@\/product\/results\/(result-shell-model|result-command-adapter|result-center-page|result-token-stream|result-return-restore|result-target-wiring|result-center-navigation)['"]/,
  },
  {
    name: 'barrel re-export of shell internals',
    re: /from\s+['"]\.\.\/index['"]|from\s+['"]@\/product\/results['"]|from\s+['"]@\/product\/results\/index['"]/,
  },
  {
    name: 'core durable video workflow import',
    re: /from\s+['"]@meiye\/core/,
  },
];

function walkSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walkSourceFiles(full));
      continue;
    }
    if (!entry.endsWith('.ts') && !entry.endsWith('.tsx')) continue;
    // This static test documents forbidden patterns as data.
    if (entry === 'no-result-shell-import.static.test.ts') continue;
    out.push(full);
  }
  return out;
}

test('video worksurface source tree has no direct Result Shell imports', () => {
  const files = walkSourceFiles(VIDEO_DIR);
  assert.ok(files.length > 0, 'expected video worksurface source files');

  const violations: string[] = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const rel = relative(VIDEO_DIR, file);

    for (const pattern of FORBIDDEN_IMPORT_PATTERNS) {
      if (pattern.re.test(source)) {
        violations.push(`${rel}: ${pattern.name}`);
      }
    }

    // Extra explicit scan for any forbidden module name in import paths.
    for (const mod of FORBIDDEN_RELATIVE_IMPORTS) {
      const loose = new RegExp(`from\\s+['"][^'"]*${mod}['"]`);
      if (loose.test(source)) {
        violations.push(`${rel}: imports ${mod}`);
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Result Shell / core direct imports forbidden in video/**:\n${violations.join('\n')}`
  );
});

test('video worksurface model imports contracts only for cross-lane types', () => {
  const modelSource = readFileSync(
    join(VIDEO_DIR, 'video-worksurface-model.ts'),
    'utf8'
  );

  assert.match(modelSource, /from '@meiye\/contracts'/);
  assert.match(modelSource, /ResultActionId/);
  assert.match(modelSource, /ResultWorkspaceKind/);
  assert.match(modelSource, /VideoWorkflowPublicProjection/);
  assert.doesNotMatch(modelSource, /ResultCenterNavigation/);
  assert.doesNotMatch(modelSource, /resultCenterPath/);
  assert.doesNotMatch(modelSource, /ResultUncommittedEditKey/);

  // Document contracts-only ownership in module header.
  assert.match(modelSource, /Contracts-only boundary/i);
  assert.match(modelSource, /Does NOT import Result Shell internals/i);

  // Must not pull shell projection helpers.
  assert.equal(modelSource.includes('projectResultShell'), false);
  assert.equal(modelSource.includes('mobileVisibleActions'), false);
  assert.equal(modelSource.includes('createResultCommandAdapter'), false);
});
