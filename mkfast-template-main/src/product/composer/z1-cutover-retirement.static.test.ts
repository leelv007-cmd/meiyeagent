/**
 * Z1 / #105 cutover static gates:
 * - T6 scene visual chips / named-preset contracts retired from runtime src
 * - dashboard home no longer mounts legacy workbench result bridge
 * - entries resolve to Result Center deep link
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const SRC_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PRODUCT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const DASHBOARD_INDEX = fileURLToPath(
  new URL('../../routes/dashboard/index.tsx', import.meta.url)
);
const CONTENT_PACKAGE_DETAIL = fileURLToPath(
  new URL('../../p1/content-package-detail.tsx', import.meta.url)
);
const CONTENT_ROUTE = fileURLToPath(
  new URL('../../routes/dashboard/content.tsx', import.meta.url)
);
const DAY0_SPEC = fileURLToPath(
  new URL(
    '../../../tests/e2e/specs/uiux-day0-contract.spec.ts',
    import.meta.url
  )
);
const DAY0_FIXTURES = fileURLToPath(
  new URL('../../../tests/e2e/fixtures/user-activation.ts', import.meta.url)
);

const FORBIDDEN_RUNTIME_TOKENS = [
  'Scene' + 'VisualButton',
  'scene' + 'ChipGroups',
  'NAMED_' + 'PRESET_CONTRACTS',
  'internal' + 'Intent',
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

test('legacy desktop and mobile creation entry files are physically removed', () => {
  assert.equal(
    existsSync(join(PRODUCT_ROOT, 'unified-creation-workbench.tsx')),
    false
  );
  assert.equal(existsSync(join(PRODUCT_ROOT, 'mobile-action-book.tsx')), false);
});

test('composer home submits to Result Center navigation helpers', () => {
  const home = readFileSync(
    join(PRODUCT_ROOT, 'composer/composer-home.tsx'),
    'utf8'
  );
  assert.match(home, /navigateAfterSubmitSuccess/);
  assert.match(home, /\/dashboard\/results\/\$workId/);
  assert.doesNotMatch(home, /submit_creative_work/);
  assert.doesNotMatch(home, /create_creative_work/);
  assert.match(home, /data-testid="composer-grounding-blocker"/);
  assert.match(home, /to="\/dashboard\/store"/);
  assert.doesNotMatch(home, new RegExp('selectedPreset\\.internal' + 'Intent'));
  assert.doesNotMatch(home, /\?workId=/);
});

test('legacy ContentPackage detail is physically removed after reshell', () => {
  const route = readFileSync(CONTENT_ROUTE, 'utf8');
  const retiredProps = [
    'on' + 'Edit',
    'on' + 'Export',
    'on' + 'GenerateVariants',
    'on' + 'ApproveAndDeliver',
    'on' + 'RecordManualResult',
    'on' + 'RetryDelivery',
    'on' + 'RetryVariantCatalog',
    'on' + 'Reuse',
    'on' + 'Rollback',
  ];

  assert.equal(existsSync(CONTENT_PACKAGE_DETAIL), false);
  assert.doesNotMatch(route, /operationsCommand/u);
  for (const prop of retiredProps) {
    assert.doesNotMatch(route, new RegExp(`\\b${prop}=`, 'u'));
  }
});

test('runtime sources never produce the retired dashboard query bridge', () => {
  const violations = walkSourceFiles(SRC_ROOT).filter((file) =>
    /\/dashboard\/?\?workId=/u.test(readFileSync(file, 'utf8'))
  );
  assert.deepEqual(
    violations.map((file) => relative(SRC_ROOT, file)),
    [],
    violations.map((file) => relative(SRC_ROOT, file)).join('\n')
  );
});

test('Day-0 gate locates Composer lens/cards instead of retired workbench controls', () => {
  const source = `${readFileSync(DAY0_SPEC, 'utf8')}\n${readFileSync(
    DAY0_FIXTURES,
    'utf8'
  )}`;

  assert.match(source, /composerLensOption/);
  assert.match(source, /composerRecipeCard/);
  assert.match(source, /composer-lens-option-/);
  assert.match(source, /composer-recipe-card-/);
  assert.doesNotMatch(source, new RegExp('sceneTemplate' + 'Card'));
  assert.doesNotMatch(source, new RegExp('creationMode' + 'Chip'));
  assert.doesNotMatch(source, new RegExp('Scene' + 'VisualButton'));
  assert.doesNotMatch(source, new RegExp('CreationMode' + 'Picker'));
  assert.doesNotMatch(source, new RegExp('harness-primary-' + 'candidate'));
});
