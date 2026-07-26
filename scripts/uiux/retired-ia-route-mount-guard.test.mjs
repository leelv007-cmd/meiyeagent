import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import {
  RETIRED_IA_MODULES,
  findRetiredIaMounts,
  reachableFromRoutes,
  routeEntryFiles,
} from './retired-ia-route-mount-guard.mjs';

/**
 * The graph walk is what makes this gate mean anything: every retiring module
 * was reached *through* the old task page, never named by a route file. A
 * direct-import check would have reported零挂载 while the whole cluster was
 * still live.
 */
test('a retiring module reached through an intermediate module is a violation', () => {
  const files = {
    'src/routes/dashboard/tasks.tsx':
      "import { OperationsTaskPage } from '@/product/operations-task-page';",
    'src/product/operations-task-page.tsx':
      "import { ContentTaskInbox } from '@/p1/content-task-inbox';",
    'src/p1/content-task-inbox.tsx':
      "import { CompactWeekStrip } from './compact-week-strip';",
    'src/p1/compact-week-strip.tsx': 'export const CompactWeekStrip = () => null;',
  };
  const graph = reachableFromRoutes(['src/routes/dashboard/tasks.tsx'], {
    read: (path) => files[path] ?? '',
    resolveModule: (specifier, importer) => {
      const base = specifier.startsWith('@/')
        ? `src/${specifier.slice(2)}`
        : `${importer.slice(0, importer.lastIndexOf('/'))}/${specifier.slice(2)}`;
      return (
        [`${base}.ts`, `${base}.tsx`].find((candidate) => candidate in files) ??
        undefined
      );
    },
    srcDir: 'src',
  });

  assert.deepEqual(
    findRetiredIaMounts(graph, { srcDir: 'src' }).map(({ path }) => path),
    [
      'src/p1/compact-week-strip.tsx',
      'src/p1/content-task-inbox.tsx',
      'src/product/operations-task-page.tsx',
    ]
  );
});

test('a route that mounts none of them is clean', () => {
  const graph = reachableFromRoutes(['src/routes/dashboard/works.tsx'], {
    read: () => "import { WorksListPage } from '@/product/works';",
    resolveModule: () => undefined,
    srcDir: 'src',
  });
  assert.deepEqual(findRetiredIaMounts(graph, { srcDir: 'src' }), []);
});

test('the module list stays on the six the ticket retires, without the shared read model', () => {
  assert.deepEqual(RETIRED_IA_MODULES, [
    'p1/compact-week-strip',
    'p1/content-task-inbox',
    'p1/operations-route-model',
    'p1/retrieval-facets',
    'p1/weekly-operations',
    'product/operations-task-page',
  ]);
  assert.equal(
    RETIRED_IA_MODULES.includes('p1/operations-view-model'),
    false,
    'operations-view-model is a live shared read model, not part of this retirement'
  );
});

test('a `-` prefixed file under routes is not a route entry', () => {
  const entries = routeEntryFiles();
  assert.equal(
    entries.some((path) => path.split('/').pop().startsWith('-')),
    false
  );
  // The retired library surface lives at routes/dashboard/-content-library-surface.
  // TanStack excludes it from the tree, so counting it as an entry would report
  // its imports as route-mounted when no route renders it.
  assert.equal(
    entries.some((path) => path.includes('-content-library-surface')),
    false
  );
});

test('the walk reaches a real slice of the app, so a clean result is not an empty one', () => {
  const graph = reachableFromRoutes(routeEntryFiles());
  assert.ok(
    graph.reachable.size > 300,
    `expected the route graph to cover the app, walked ${graph.reachable.size} files`
  );
  // A module known to still be routed proves the walk finds what is there.
  assert.deepEqual(
    findRetiredIaMounts(graph, {
      modules: ['product/canonical-history-page'],
    }).map(({ path }) => path),
    ['mkfast-template-main/src/product/canonical-history-page.tsx']
  );
});

test('the repository currently mounts none of the retired old-IA modules', () => {
  const output = execFileSync(
    process.execPath,
    ['scripts/uiux/retired-ia-route-mount-guard.mjs'],
    { encoding: 'utf8' }
  );
  assert.deepEqual(JSON.parse(output).findings, []);
});
