/**
 * Supply control center route + five-view reachability (J4).
 * Memory-router / pure SSR style; shared wiring untouched.
 *
 * Avoid rendering AdminRoutePage (locale compile dependency) — same pattern
 * as capabilities/exception-home route tests that SSR control bodies.
 */
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'cloudflare:workers') {
      return {
        shortCircuit: true,
        url: 'data:text/javascript,export const env = {}',
      };
    }
    return nextResolve(specifier, context);
  },
});

const supplyRoute = await import('./supply');
const viewsRoute = await import('./supply.views.$viewId');
const tasksRoute = await import('./supply.tasks.$taskId');
const {
  ASSOCIATION_VIEW_IDS,
  ASSOCIATION_VIEW_PATHS,
  listAssociationViewReachability,
} = await import('@/p1/admin-supply-association-views-model');
const {
  AdminSupplyAssociationView,
  AdminSupplyControl,
  AdminSupplyTaskDrilldown,
} = await import('@/p1/admin-supply-control');
const { buildDefaultSupplyControlSnapshot } = await import(
  '@/p1/admin-supply-fixture'
);
const {
  parseRunTableUrlState,
  querySupplyRunTable,
  serializeRunTableUrlState,
} = await import('@/p1/admin-supply-run-table-model');
const { admin_supply_supply_overview_30000464, admin_supply_task_page_title } =
  await import('@/locale/paraglide/messages');
const { readFileSync } = await import('node:fs');
const { resolve } = await import('node:path');

test('admin supply route module exports Route and page components', () => {
  assert.equal(typeof supplyRoute.Route.options.component, 'function');
  assert.ok(supplyRoute.Route, 'createFileRoute Route export required for Z2');
  assert.equal(typeof viewsRoute.Route.options.component, 'function');
  assert.ok(viewsRoute.Route);
  assert.equal(typeof tasksRoute.Route.options.component, 'function');
  assert.ok(tasksRoute.Route);
});

test('supply control center body includes overview + run table + entitlements', () => {
  const html = renderToStaticMarkup(
    <AdminSupplyControl snapshot={buildDefaultSupplyControlSnapshot()} />
  );
  assert.match(html, /data-testid="supply-control-center-panel"/);
  assert.match(html, /data-testid="supply-overview-panel"/);
  assert.match(html, /data-testid="supply-run-table"/);
  assert.match(html, /data-testid="entitlement-status-panel"/);
  assert.match(html, /data-external-gateway-deeplink-only="true"/);
  assert.match(html, /data-testid="supply-association-index"/);
  assert.match(
    html,
    new RegExp(
      admin_supply_supply_overview_30000464().replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&'
      )
    )
  );
  assert.doesNotMatch(html, /audio=10|copy=100|image=20|video=5/u);
});

test('supply task page title uses Paraglide messages', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/routes/admin/supply.tasks.$taskId.tsx'),
    'utf8'
  );
  assert.match(source, /admin_supply_task_page_title\(/);
  assert.match(source, /admin_supply_task_page_description\(\)/);
  assert.ok(
    admin_supply_task_page_title({ taskId: 'task-1' }).includes('task-1')
  );
});

test('five association view routes are reachable and render forward+reverse', () => {
  const reachability = listAssociationViewReachability();
  assert.equal(reachability.length, 5);

  for (const viewId of ASSOCIATION_VIEW_IDS) {
    assert.equal(
      ASSOCIATION_VIEW_PATHS[viewId],
      `/admin/supply/views/${viewId}`
    );
    assert.equal(typeof viewsRoute.Route.options.component, 'function');

    const pageHtml = renderToStaticMarkup(
      <AdminSupplyAssociationView
        snapshot={buildDefaultSupplyControlSnapshot()}
        viewId={viewId}
      />
    );
    assert.match(pageHtml, /data-testid="supply-association-views-panel"/);
    assert.match(pageHtml, new RegExp(`data-view-id="${viewId}"`));
    assert.match(pageHtml, /data-direction="forward"/);
    assert.match(pageHtml, /data-direction="reverse"/);
    assert.match(
      pageHtml,
      new RegExp(
        `href="${ASSOCIATION_VIEW_PATHS[viewId].replace(/\//g, '\\/')}"`
      )
    );

    // Nav links cover all five from each page.
    for (const other of ASSOCIATION_VIEW_IDS) {
      assert.match(pageHtml, new RegExp(`data-view-id="${other}"`));
    }
  }
});

test('task drilldown route body renders information completeness contract', () => {
  const html = renderToStaticMarkup(
    <AdminSupplyTaskDrilldown
      snapshot={buildDefaultSupplyControlSnapshot()}
      taskId="task-image-002"
    />
  );
  assert.match(html, /data-testid="supply-task-drilldown"/);
  assert.match(html, /data-testid="supply-task-summary-cards"/);
  assert.match(html, /data-testid="supply-latency-segment"/);
  assert.match(html, /data-testid="supply-timeline-event"/);
  assert.match(html, /data-durable="true"/);
  assert.match(html, /data-testid="supply-task-error"/);
  assert.match(html, /data-folded-default="true"/);
  assert.equal(typeof tasksRoute.Route.options.component, 'function');
});

/**
 * #426 restyle residual: the task page header already shows
 * 「供应任务 · {taskId}」 + the summary blurb; the drilldown body must not
 * restate a near-duplicate title/description pair.
 */
test('task drilldown panel does not repeat the page header title', () => {
  const html = renderToStaticMarkup(
    <AdminSupplyTaskDrilldown
      snapshot={buildDefaultSupplyControlSnapshot()}
      taskId="task-image-002"
    />
  );
  assert.match(html, /data-testid="supply-task-drilldown"/);
  assert.doesNotMatch(html, /任务下钻 ·/);
  assert.doesNotMatch(
    html,
    /摘要卡 \/ 延迟分段 \/ 持久化时间戳时间线 \/ 错误徽章折叠 \/ 产物预览/
  );
  // Body projections remain.
  assert.match(html, /data-testid="supply-task-summary-cards"/);
  assert.match(html, /data-testid="supply-task-timeline"/);
});

test('run table URL state sync preserves shareable filter contract on control', () => {
  const state = parseRunTableUrlState(
    new URLSearchParams(
      'operation=copy.generate&status=succeeded&page=1&sort=startedAt&dir=desc'
    )
  );
  const snapshot = buildDefaultSupplyControlSnapshot();
  const serverPage = querySupplyRunTable(snapshot.runs, state);
  snapshot.runPage = {
    query: serverPage.state,
    total: serverPage.total,
    totalPages: serverPage.totalPages,
    rows: serverPage.rows,
    facets: serverPage.facets,
  };
  const html = renderToStaticMarkup(<AdminSupplyControl snapshot={snapshot} />);
  assert.match(html, /data-testid="supply-run-table-share-link"/);
  // Defaults omitted from serialization — operation/status must remain.
  assert.match(html, /operation=copy.generate/);
  assert.match(html, /status=succeeded/);

  // Round-trip stability for route-level URL contract.
  const again = parseRunTableUrlState(serializeRunTableUrlState(state));
  assert.equal(again.operation, 'copy.generate');
  assert.equal(again.status, 'succeeded');
});

test('association view control is import-stable for all five ids', () => {
  for (const viewId of ASSOCIATION_VIEW_IDS) {
    const html = renderToStaticMarkup(
      <AdminSupplyAssociationView
        snapshot={buildDefaultSupplyControlSnapshot()}
        viewId={viewId}
      />
    );
    assert.match(html, /data-testid="supply-association-projection"/);
  }
});

/**
 * #387 restyle residual: the page header already shows
 * 「五关联视图 · {viewId}」; the panel body must not repeat that same title.
 */
test('association view panel does not repeat the page header title', () => {
  for (const viewId of ASSOCIATION_VIEW_IDS) {
    const html = renderToStaticMarkup(
      <AdminSupplyAssociationView
        snapshot={buildDefaultSupplyControlSnapshot()}
        viewId={viewId}
      />
    );
    assert.match(html, /data-testid="supply-association-views-panel"/);
    assert.doesNotMatch(html, /五关联视图 ·/);
    // Nav and projections remain.
    assert.match(html, /data-testid="supply-association-nav"/);
    assert.match(html, /data-testid="supply-association-projection"/);
  }
});
