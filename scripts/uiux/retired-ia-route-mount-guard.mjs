/**
 * 旧 IA 生产路由零挂载 — T34 / #228 (D-127 退役批 1D 谓词的机器可判半边).
 *
 * The 归桶矩阵 gates the delete-after-reshell batch on 「换壳票组全部合入 ＋ 旧页零
 * 路由引用」. The first half is a merge fact; this file is the second half, so
 * T38 can read a checked answer instead of re-deriving one from grep.
 *
 * A direct-import scan over `src/routes/**` would answer the wrong question:
 * every retiring module here was reached *through* the old task page, not from
 * a route file. So the check walks the real module graph out of the route
 * entries and asserts none of the retiring modules is reachable at all.
 *
 * `operations-view-model` is deliberately NOT on the list. The 归桶矩阵 row names
 * it alongside these six, but it is a shared read model with live consumers —
 * works-light-edit-page (T32) types its templates against it — so its fate is
 * T38's to judge per-predicate, not this gate's to prejudge.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = 'mkfast-template-main/src';
const ROUTES_DIR = `${SRC}/routes`;

/**
 * 旧 IA 六件 (归桶矩阵 §3 + 票面「旧页→新面」对照). Named by module path suffix,
 * which is how an import binds them.
 */
export const RETIRED_IA_MODULES = [
  'p1/compact-week-strip',
  'p1/content-task-inbox',
  'p1/operations-route-model',
  'p1/retrieval-facets',
  'p1/weekly-operations',
  'product/operations-task-page',
];

const MODULE_SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"]([^'"\n]+)['"]/gu;

const SOURCE_EXTENSIONS = ['.ts', '.tsx'];

function isSource(path) {
  return SOURCE_EXTENSIONS.some((extension) => path.endsWith(extension));
}

function isTest(path) {
  return /\.(test|spec)\.tsx?$/u.test(path);
}

/**
 * Production route entries. Two kinds of file live under `src/routes` without
 * being routes: the tests beside them, and TanStack's `-` prefix, which marks a
 * file the router excludes from the tree. Counting either as an entry would
 * report a module as 「路由挂载」 when the only thing importing it is a page that
 * no route renders — exactly the claim this gate exists to get right.
 */
export function routeEntryFiles(dir = ROUTES_DIR) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...routeEntryFiles(full));
      continue;
    }
    if (isSource(full) && !isTest(full) && !entry.startsWith('-')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Resolve a specifier the way the app's bundler does — `@/x` is `src/x`, a
 * relative path is relative to the importer — and only inside src. Anything
 * that leaves src (a package, a virtual module) cannot reach a retiring module,
 * so it is not followed.
 */
export function resolveSpecifier(specifier, importer, { srcDir = SRC } = {}) {
  let base;
  if (specifier.startsWith('@/')) {
    base = join(srcDir, specifier.slice(2));
  } else if (specifier.startsWith('.')) {
    // Keep every node of the graph on one spelling, so a file reached both as
    // `@/product/x` and as `./x` is one entry rather than two.
    base = relative(process.cwd(), resolve(dirname(importer), specifier));
  } else {
    return undefined;
  }
  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...SOURCE_EXTENSIONS.map((extension) => join(base, `index${extension}`)),
  ];
  for (const candidate of candidates) {
    if (
      isSource(candidate) &&
      existsSync(candidate) &&
      statSync(candidate).isFile()
    ) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Every source file reachable from the route entries. `readFile` is injected so
 * the unit test can drive the walk over a fixture graph.
 */
export function reachableFromRoutes(entries, options = {}) {
  const {
    read = (path) => readFileSync(path, 'utf8'),
    resolveModule = resolveSpecifier,
    srcDir = SRC,
  } = options;
  const seen = new Set();
  const queue = [...entries];
  const importedBy = new Map();
  while (queue.length > 0) {
    const current = queue.pop();
    if (seen.has(current)) continue;
    seen.add(current);
    let text;
    try {
      text = read(current);
    } catch {
      continue;
    }
    for (const match of text.matchAll(MODULE_SPECIFIER)) {
      const target = resolveModule(match[1], current, { srcDir });
      if (!target) continue;
      if (!importedBy.has(target)) importedBy.set(target, current);
      if (!seen.has(target)) queue.push(target);
    }
  }
  return { importedBy, reachable: seen };
}

export function findRetiredIaMounts(
  graph,
  { modules = RETIRED_IA_MODULES, srcDir = SRC } = {}
) {
  const violations = [];
  for (const module of modules) {
    for (const extension of SOURCE_EXTENSIONS) {
      const path = join(srcDir, `${module}${extension}`);
      if (!graph.reachable.has(path)) continue;
      violations.push({
        importedBy: graph.importedBy.get(path),
        path,
        reason: `retired old-IA module is still reachable from a production route`,
      });
    }
  }
  return violations;
}

export function presentRetiredIaFiles({
  modules = RETIRED_IA_MODULES,
  srcDir = SRC,
} = {}) {
  return modules.flatMap((module) =>
    SOURCE_EXTENSIONS.map((extension) =>
      join(srcDir, `${module}${extension}`)
    ).filter((path) => existsSync(path))
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const entries = routeEntryFiles();
  const graph = reachableFromRoutes(entries);
  const findings = findRetiredIaMounts(graph).map((finding) => ({
    ...finding,
    importedBy: finding.importedBy
      ? relative(process.cwd(), finding.importedBy)
      : undefined,
    path: relative(process.cwd(), finding.path),
  }));
  process.stdout.write(
    `${JSON.stringify(
      {
        modulesChecked: RETIRED_IA_MODULES.length,
        retiredFilesPresent: presentRetiredIaFiles().map((path) =>
          relative(process.cwd(), path)
        ),
        routeEntries: entries.length,
        reachableFiles: graph.reachable.size,
        findings,
      },
      null,
      2
    )}\n`
  );
  if (findings.length > 0) process.exitCode = 1;
}
