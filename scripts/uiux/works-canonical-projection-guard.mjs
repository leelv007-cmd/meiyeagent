/**
 * 唯一投影静态断言 — T32 / #226 (ADR-0011 / D-127).
 *
 * Asserted here rather than in a unit test because every one of these is a
 * property of the *file set*, and each is what a later ticket would silently
 * break. Exactly three claims, no more:
 *
 *  1. no `legacy_projection_*` reference anywhere under product/works or the
 *     works routes, and no module specifier that resolves to a
 *     delete-after-reshell module;
 *  2. every `operationsQuery` action the surface reads is on the canonical
 *     allowlist — this is what makes "reads the canonical projection" a checked
 *     claim rather than a comment;
 *  3. the works routes point at the new surface — one half of T38's delete
 *     predicate (换壳全合入 ＋ 旧页零路由引用), so it fails loudly if someone
 *     routes 作品 back through the old aggregate.
 *
 * Specifiers are matched against the whole file text, not line by line. A
 * line-anchored `^\s*import` test reads as if it covers imports and does not:
 * a multi-line `import {\n …\n} from '…'` puts the specifier on a line that
 * starts with `}`, and `await import('…')` never starts with `import` at all.
 * Both forms bind the module just as hard as the single-line form.
 *
 * The match is deliberately not comment-aware: naming a retiring module in a
 * `from '…'`-shaped string is a reference worth failing on, and rewording a
 * comment is cheaper than a guard that can be talked around.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKS_SURFACE_DIR = 'mkfast-template-main/src/product/works';
const WORKS_ROUTES = [
  'mkfast-template-main/src/routes/dashboard/works.tsx',
  'mkfast-template-main/src/routes/dashboard/works_/$workId.tsx',
];
const ROUTE_TREE = 'mkfast-template-main/src/routeTree.gen.ts';

/** Modules the 归桶矩阵 marks delete-after-reshell — the new面 must not bind them. */
const RETIRING_MODULES = [
  'canonical-asset-actions',
  'canonical-history-page',
  'canonical-media-gallery',
  'canonical-object-route-page',
  'canvas-work-page',
  'content-package-card',
  'content-package-detail',
  'creative-object-page',
  'legacy-content-package-projection',
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
      continue;
    }
    if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/**
 * Every way a module specifier can be bound: `from '…'` (single or multi-line
 * import/export), a bare side-effect `import '…'`, `import('…')` including the
 * split-across-lines form, and `require('…')`.
 */
const MODULE_SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"]([^'"\n]+)['"]/gu;

/** Canonical reads the 作品 surface is allowed to issue (唯一投影, ADR-0011). */
const CANONICAL_QUERY_ACTIONS = [
  'canonical_history',
  'content_packages',
  'export_receipts',
  'templates',
  'work',
];

const QUERY_ACTION = /\boperationsQuery\s*(?:<[^>]*>)?\s*\(\s*['"]([^'"]+)['"]/gu;

function lineOf(text, index) {
  return text.slice(0, index).split(/\r?\n/u).length;
}

export function findWorksProjectionViolations(files) {
  const violations = [];
  for (const file of files) {
    // The guard's own source names the forbidden strings as data.
    if (file.path.endsWith('works-canonical-projection-guard.mjs')) continue;
    for (const [index, line] of file.text.split(/\r?\n/u).entries()) {
      if (/legacy_projection_/u.test(line)) {
        violations.push({
          line: index + 1,
          path: file.path,
          reason: 'legacy_projection_* reference',
        });
      }
    }
    for (const match of file.text.matchAll(MODULE_SPECIFIER)) {
      const target = RETIRING_MODULES.find((module) =>
        match[1].endsWith(`/${module}`)
      );
      if (target) {
        violations.push({
          line: lineOf(file.text, match.index),
          path: file.path,
          reason: `binds delete-after-reshell module "${target}"`,
        });
      }
    }
    for (const match of file.text.matchAll(QUERY_ACTION)) {
      if (CANONICAL_QUERY_ACTIONS.includes(match[1])) continue;
      violations.push({
        line: lineOf(file.text, match.index),
        path: file.path,
        reason: `non-canonical operationsQuery action "${match[1]}"`,
      });
    }
  }
  return violations;
}

export function findWorksRouteViolations(routes, routeTree) {
  const violations = [];
  for (const route of routes) {
    if (!/from\s+['"]@\/product\/works['"]/u.test(route.text)) {
      violations.push({
        path: route.path,
        reason: 'works route must render the new 作品 surface (@/product/works)',
      });
    }
  }
  for (const path of ['/dashboard/works', '/dashboard/works_/$workId']) {
    if (!routeTree.includes(`'${path}'`)) {
      violations.push({
        path: ROUTE_TREE,
        reason: `route tree lost ${path}`,
      });
    }
  }
  return violations;
}

function read(path) {
  return { path, text: readFileSync(path, 'utf8') };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const surface = walk(WORKS_SURFACE_DIR).map(read);
  const routes = WORKS_ROUTES.map(read);
  const findings = [
    ...findWorksProjectionViolations([...surface, ...routes]),
    ...findWorksRouteViolations(routes, readFileSync(ROUTE_TREE, 'utf8')),
  ].map((finding) => ({
    ...finding,
    path: relative(process.cwd(), finding.path),
  }));
  process.stdout.write(
    `${JSON.stringify(
      { filesScanned: surface.length + routes.length, findings },
      null,
      2
    )}\n`
  );
  if (findings.length > 0) process.exitCode = 1;
}
