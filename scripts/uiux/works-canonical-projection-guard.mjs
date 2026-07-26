/**
 * 唯一投影静态断言 — T32 / #226 (ADR-0011 / D-127).
 *
 * The reshelled 作品 surface reads the canonical projection and nothing else.
 * Two things are asserted here rather than in a unit test, because both are
 * properties of the *file set* and both are what a later ticket would silently
 * break:
 *
 *  1. no `legacy_projection_*` reference and no import of a delete-after-reshell
 *     module anywhere under product/works or the works routes;
 *  2. the works routes point at the new surface — that is one half of T38's
 *     delete predicate (换壳全合入 ＋ 旧页零路由引用), so it must fail loudly if
 *     someone routes 作品 back through the old aggregate.
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
      const imported = /^\s*(?:import|export)[^'"]*['"]([^'"]+)['"]/u.exec(line);
      if (!imported) continue;
      const target = RETIRING_MODULES.find((module) =>
        imported[1].endsWith(`/${module}`)
      );
      if (target) {
        violations.push({
          line: index + 1,
          path: file.path,
          reason: `imports delete-after-reshell module "${target}"`,
        });
      }
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
