import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  BILLING_UX_COPY,
  formatQuoteCostLabel,
  formatRefundDualState,
  formatShortfallLabel,
} from './billing-ux-copy.js';

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(here, '../../..');

test('the refund dual-state has one wording each way', () => {
  assert.equal(formatRefundDualState(true), '失败自动退回');
  assert.equal(formatRefundDualState(false), '该模型失败不退回');
  assert.equal(formatQuoteCostLabel(12), '本次约消耗 12 分');
  assert.equal(formatShortfallLabel(3), '还差 3 分');
});

function childSourceRoots(parent: string): string[] {
  return readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(parent, entry.name, 'src'))
    .filter((path) => existsSync(path));
}

const productionSourceRoots = [
  ...childSourceRoots(join(repositoryRoot, 'apps')),
  ...childSourceRoots(join(repositoryRoot, 'packages')),
  join(repositoryRoot, 'mkfast-template-main/src'),
];

function productionTypescriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    // paraglide is compiled output — thousands of files, none hand-written.
    if (entry.isDirectory()) {
      return entry.name === 'paraglide' ? [] : productionTypescriptFiles(path);
    }
    if (
      (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) ||
      entry.name.endsWith('.test.ts') ||
      entry.name.endsWith('.test.tsx')
    ) {
      return [];
    }
    return [path];
  });
}

/**
 * Comments are removed before matching. A doc comment quoting the wording to
 * say what a field holds — or a design note explaining where 「升级套餐」 went —
 * is prose *about* the copy, not a second copy. What this gate prevents is a
 * surface saying it.
 *
 * Quote-aware on purpose: a first pass skipped whole comment *lines*, which
 * missed continuation lines of a block comment, and any rule that keys on how a
 * line begins would keep missing them. Tracking string state costs a few lines
 * and removes the guessing.
 */
function stripComments(source: string): string {
  let out = '';
  let index = 0;
  let quote: string | null = null;
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (quote) {
      if (char === '\\') {
        index += 2;
        continue;
      }
      if (char === quote) quote = null;
      out += char;
      index += 1;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      out += char;
      index += 1;
      continue;
    }
    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      index += 2;
      while (
        index < source.length &&
        !(source[index] === '*' && source[index + 1] === '/')
      ) {
        index += 1;
      }
      index += 2;
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
}

function filesMatching(pattern: RegExp) {
  return productionSourceRoots
    .flatMap((root) => productionTypescriptFiles(root))
    .filter((path) => pattern.test(stripComments(readFileSync(path, 'utf8'))))
    .map((path) => relative(repositoryRoot, path))
    .sort();
}

function filesSaying(text: string) {
  return productionSourceRoots
    .flatMap((root) => productionTypescriptFiles(root))
    .filter((path) => stripComments(readFileSync(path, 'utf8')).includes(text))
    .map((path) => relative(repositoryRoot, path))
    .sort();
}

/**
 * The refund dual-state used to be written out in four places: this table, the
 * composer execution-confirm card, the workbench commit strip, and the living
 * plan. They agreed only because someone had read all four, and nothing would
 * have failed if a fifth surface had picked a fifth wording.
 *
 * Every string in the table is checked, not just the two that had drifted, so a
 * surface that starts hand-writing 「还差 N 分」 fails here the first time.
 */
test('the merchant-facing billing words are said in exactly one file', () => {
  const literals = [
    BILLING_UX_COPY.refundOn,
    BILLING_UX_COPY.refundOff,
    BILLING_UX_COPY.buyBooster,
    BILLING_UX_COPY.upgradePlan,
    BILLING_UX_COPY.missingQuote,
    BILLING_UX_COPY.invalidQuote,
    '本次约消耗',
    '还差 ',
  ];
  for (const literal of literals) {
    assert.deepEqual(
      filesSaying(literal),
      ['packages/contracts/src/billing-ux-copy.ts'],
      `${literal} must only be written in the shared copy table`
    );
  }
});

/**
 * The lens labels are the same disease one directory over: four files declared
 * `Record<CreationLensId, string>` with the same three words in it. A gate on
 * the words themselves would be wrong here — DeliveryZipKind,
 * TemplateCatalogCategory, ObjectWorkspaceCarrier and ComposerDeliverableKind
 * all legitimately say '文案' or '图文' about something else. So the gate is on
 * the shape instead: only one place may declare a map keyed by the lens enum.
 */
const LENS_LABEL_MAP =
  /:\s*Record<\s*(?:CreationLensId|\(typeof creationLensIds\)\[number\])\s*,\s*string\s*>\s*=\s*\{/u;

/**
 * Two entries, and the second one is a question rather than an exception.
 * admin-creation-experience-control.tsx builds the same map from paraglide
 * messages, and zh.json gives them the same three words — so the repo says
 * these labels two ways at once: fixed Chinese constants for merchant surfaces,
 * i18n for the admin console. Either answer could be the right one; having both
 * is what makes it a second truth. Collapsing it means choosing (move merchant
 * vocabulary into i18n, or drop the admin console's), which is a product call,
 * so it is listed here rather than decided here.
 */
test('the lens label map is declared in two places, both known', () => {
  assert.deepEqual(filesMatching(LENS_LABEL_MAP), [
    'mkfast-template-main/src/p1/admin-creation-experience-control.tsx',
    'packages/contracts/src/creation-experience.ts',
  ]);
});
