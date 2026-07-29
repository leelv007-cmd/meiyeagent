#!/usr/bin/env node
/**
 * Brand exposure scan for #265 (decision anchor D-152②).
 *
 * The product-facing name is being unified onto the brand name
 * 「丽客美页 LIKEPAGE」. This script is the machine-readable form of the
 * ticket's 盘点清单 requirement — it re-derives the inventory instead of
 * freezing it into a document that rots while other lanes keep shipping copy.
 *
 * Two modes, deliberately separated (same shape as verify-wrangler-config.mjs):
 *
 *   1. Report (default) — enumerate every legacy-name occurrence, split into
 *      对外 (user-visible copy) and 工程内部 (test guards, comments). Always
 *      exits 0. This is what runs *before* the rename: it is the inventory.
 *   2. Check (`--check`) — any surviving 对外 occurrence is a hard failure.
 *
 * Switch condition: `--check` is red until the rename actually lands, so it is
 * NOT wired into the `test` script yet. Wire it in the same commit that replaces
 * the strings; from then on it guards against re-introduction by the in-flight
 * lanes (#264FE / #261 / #253FE add user-facing copy and are the realistic
 * source of regression). This is D-156 in mechanical form — 靠票面/判据记账,
 * 不靠记忆.
 *
 * Boundary (D-152①): engineering-internal identifiers — package names,
 * directory names, code symbols — are not 对外 exposure and are never renamed.
 * `docs/` and `references/` are historical decision records and are excluded
 * wholesale; the legacy name is *supposed* to survive there.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** Product names retired by D-152②. Order is report order. */
export const LEGACY_BRAND_NAMES = [
  '美业内容簿',
  '美业内容中台',
  '美业管理模式',
  'Beauty Content Desk',
  'Beauty admin mode',
];

/** The name every 对外 occurrence resolves to. EN pages take the Latin form. */
export const BRAND_ZH = '丽客美页 LIKEPAGE';
export const BRAND_EN = 'LIKEPAGE';

/**
 * Never walked. `references/` mirrors third-party repos; `docs/` holds the
 * decision records the rename is derived from; paraglide output is generated
 * from the message sources this script already reads.
 */
const SKIP_DIRS = new Set([
  '.git',
  '.scratch',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'docs',
  'node_modules',
  'output',
  'paraglide',
  'references',
  'test-results',
]);

const SKIP_FILES = new Set(['pnpm-lock.yaml', 'skills-lock.json']);

/** This file names the retired brands to look for; scanning it finds itself. */
const SELF_PATH = fileURLToPath(import.meta.url);

/** Text extensions worth reading. Binary/asset files carry no copy. */
const SCANNED_EXTENSIONS = new Set([
  '.css',
  '.html',
  '.json',
  '.jsonc',
  '.md',
  '.mdx',
  '.mjs',
  '.svg',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
]);

/**
 * 工程内部: occurrences that must change with the rename but are not user
 * exposure — test allow-lists asserting on the old copy, and source comments.
 * They are reported so the rename commit stays complete, but they never fail
 * `--check`, because failing on them would make the guard red for reasons that
 * have nothing to do with what a merchant sees.
 */
function classify(relPath, line) {
  if (/(^|\/)tests?\//u.test(relPath) || /\.test\.[cm]?[jt]sx?$/u.test(relPath)) {
    return 'internal';
  }
  if (/^\s*(\/\/|\/\*|\*|#)/u.test(line)) return 'internal';
  return 'external';
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      yield* walk(full);
      continue;
    }
    if (SKIP_FILES.has(entry) || full === SELF_PATH) continue;
    const dot = entry.lastIndexOf('.');
    if (dot < 0 || !SCANNED_EXTENSIONS.has(entry.slice(dot))) continue;
    yield full;
  }
}

export function scan(root = REPO_ROOT) {
  const findings = [];
  for (const file of walk(root)) {
    const relPath = relative(root, file);
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      for (const name of LEGACY_BRAND_NAMES) {
        if (!line.includes(name)) continue;
        findings.push({
          file: relPath,
          line: index + 1,
          name,
          kind: classify(relPath, line),
          text: line.trim().slice(0, 160),
        });
      }
    });
  }
  return findings.sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line
  );
}

function report(findings, { check }) {
  const external = findings.filter((f) => f.kind === 'external');
  const internal = findings.filter((f) => f.kind === 'internal');

  const print = (title, rows) => {
    console.log(`\n## ${title} (${rows.length})`);
    if (rows.length === 0) {
      console.log('  none');
      return;
    }
    for (const row of rows) {
      console.log(`  ${row.file}:${row.line}  「${row.name}」`);
      console.log(`      ${row.text}`);
    }
  };

  console.log(`# brand exposure scan — legacy names → ${BRAND_ZH} / ${BRAND_EN}`);
  print('对外（user-visible copy）', external);
  print('工程内部（test guards, comments）', internal);

  if (!check) {
    console.log(
      `\nreport mode: ${findings.length} occurrence(s). Re-run with --check once the rename has landed.`
    );
    return 0;
  }
  if (external.length > 0) {
    console.log(
      `\nFAIL: ${external.length} 对外 occurrence(s) still carry a retired product name.`
    );
    return 1;
  }
  console.log('\nOK: no 对外 occurrence of a retired product name.');
  return 0;
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) {
  const check = process.argv.includes('--check');
  process.exit(report(scan(), { check }));
}
