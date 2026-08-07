import { readdirSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';

const JSON_MESSAGE_KEYS = ['auth_error_codes'] as const;

const REQUIRED_PRODUCT_KEYS = [
  'admin_navigation_audit',
  'admin_navigation_integrations',
  'admin_navigation_models',
  'admin_navigation_plans',
  'admin_navigation_redemptions',
  'admin_navigation_templates',
  'admin_navigation_users',
  'product_navigation_admin',
  'product_navigation_assets',
  'product_navigation_content',
  /** D-164④ + P2-13: 经验 (key still product_navigation_memory) must not vanish. */
  'product_navigation_memory',
  'product_navigation_settings',
  'product_navigation_store',
  'product_navigation_workbench',
  'settings_navigation_account',
  'settings_navigation_connections',
  'settings_navigation_models',
  'sidebar_user_account_settings',
  'sidebar_user_enter_admin',
  'sidebar_user_menu_aria',
] as const;

const RETIRED_NAVIGATION_KEYS = [
  'dashboard_sidebar_api_keys',
  'dashboard_sidebar_billing',
  'dashboard_sidebar_dashboard',
  'dashboard_sidebar_files',
  'dashboard_sidebar_notifications',
  'dashboard_sidebar_profile',
  'dashboard_sidebar_security',
  'dashboard_sidebar_settings',
  /** D-144: 线索台账整体退役真删，导航文案不得复活。 */
  'product_navigation_leads',
  'product_navigation_tasks',
] as const;

/**
 * Non-admin product shell sources remain an explicit list (merchant shell).
 * Admin surfaces use directory-default inclusion below (#427).
 */
const PRODUCT_SHELL_SOURCES_EXPLICIT = [
  'src/lib/uiux/navigation.ts',
  'src/lib/uiux/status.ts',
  'src/components/uiux/object-evidence.tsx',
  'src/components/layout/desktop-relay-page.tsx',
  'src/components/layout/sidebar-layout.tsx',
  'src/components/shared/logo.tsx',
  'src/config/sidebar-config.ts',
  'src/components/layout/sidebar-user.tsx',
  'src/p1/canvas-product-assets.ts',
  'src/p1/integration-settings-forms.ts',
  'src/p1/integration-settings.tsx',
  'src/p1/model-settings.tsx',
  'src/p1/operations-view-model.ts',
  'src/p1/redemption-card.tsx',
  'src/p1/settings-view-model.ts',
  'src/p1/use-integration-settings.ts',
  'src/product/async-task-center-model.ts',
  'src/product/async-task-center.tsx',
  'src/product/canonical-asset-actions.tsx',
  'src/product/canonical-history-model.ts',
  'src/product/canonical-history-page.tsx',
  'src/product/canonical-media-gallery.tsx',
  'src/product/canonical-object-route-page.tsx',
  'src/product/canvas-work-page.tsx',
  'src/product/composer-image-input.tsx',
  'src/product/composer/brief-surface.ts',
  'src/product/composer/brief-surface-panel.tsx',
  'src/product/creative-quote.ts',
  'src/product/creative-work-display.ts',
  'src/product/creation-catalog-model.ts',
  'src/product/creation-entry-model.ts',
  'src/product/creative-tool-availability.ts',
  'src/product/example-store-preview.tsx',
  'src/product/global-command-model.ts',
  'src/product/global-command-palette.tsx',
  'src/product/creative-object-page.tsx',
  'src/lib/uiux/duration-estimate.ts',
] as const;

/**
 * Admin surface directories: default-include all source files.
 * New files under these trees are scanned unless listed in EXEMPT.
 */
const ADMIN_SURFACE_DIRS = [
  'src/routes/admin',
  'src/components/admin',
] as const;

/**
 * Stock admin-surface CJK / mixed-track violators. Clear under #428.
 * Each entry is skipped by the product-shell CJK gate until migrated.
 */
const ADMIN_SURFACE_CJK_EXEMPT = new Set<string>([
  'src/components/admin/capability/capability-catalog-panel.tsx', // #428 清零
  'src/components/admin/capability/capability-detail-card.tsx', // #428 清零
  'src/components/admin/capability/capability-drilldown-banner.tsx', // #428 清零
  'src/components/admin/capability/capability-inventory-panorama.tsx', // #428 清零
  'src/components/admin/capability/capability-registry-panel.tsx', // #428 清零
  'src/components/admin/capability/capability-status-badge.tsx', // #428 清零
  'src/components/admin/capability/exception-home-panel.tsx', // #428 清零
  'src/components/admin/capability/metric-envelope-view.tsx', // #428 清零
  'src/components/admin/cloudflare/cloudflare-readonly-panel.tsx', // #428 清零
  'src/components/admin/entitlements/entitlement-status-panel.tsx', // #428 清零
  'src/components/admin/shared/icon-tile.tsx', // #428 清零
  'src/components/admin/shared/page-header.tsx', // #428 清零
  'src/components/admin/shared/setting-field.tsx', // #428 清零
  'src/components/admin/shared/use-route-sheet.ts', // #428 清零
  'src/components/admin/shell/admin-breadcrumbs.tsx', // #428 清零
  'src/components/admin/shell/admin-command-model.ts', // #428 清零
  'src/components/admin/shell/admin-notifications-model.ts', // #428 清零
  'src/components/admin/shell/admin-operations-todo-model.ts', // #428 清零
  'src/components/admin/shell/nav-active.ts', // #428 清零
  'src/components/admin/shell/page-crumb.tsx', // #428 清零
  'src/components/admin/shell/use-admin-ops-header-queries.ts', // #428 清零
  'src/components/admin/supply/supply-association-views-panel.tsx', // #428 清零
  'src/components/admin/supply/supply-audit-table.tsx', // #428 清零
  'src/components/admin/supply/supply-control-center-panel.tsx', // #428 清零
  'src/components/admin/supply/supply-credential-panel.tsx', // #428 清零
  'src/components/admin/supply/supply-governed-actions-panel.tsx', // #428 清零
  'src/components/admin/supply/supply-overview-panel.tsx', // #428 清零
  'src/components/admin/supply/supply-route-simulator-panel.tsx', // #428 清零
  'src/components/admin/supply/supply-run-table.tsx', // #428 清零
  'src/components/admin/supply/supply-task-drilldown.tsx', // #428 清零
  'src/components/admin/users/admin-create-user.ts', // #428 清零
  'src/components/admin/users/admin-users-content.tsx', // #428 清零
  'src/p1/admin-audit-filter-model.ts', // #428 清零
  'src/p1/admin-audit-timeline-model.ts', // #428 清零
  'src/p1/admin-capability-catalog-model.ts', // #428 清零
  'src/p1/admin-capability-catalog.tsx', // #428 清零
  'src/p1/admin-capability-registry-model.ts', // #428 清零
  'src/p1/admin-capability-registry.tsx', // #428 清零
  'src/p1/admin-cloudflare-control.tsx', // #428 清零
  'src/p1/admin-cloudflare-deep-link.ts', // #428 清零
  'src/p1/admin-cloudflare-presentation.ts', // #428 清零
  'src/p1/admin-cloudflare-probe.ts', // #428 清零
  'src/p1/admin-config-field-model.ts', // #428 清零
  'src/p1/admin-config-view-model.ts', // #428 清零
  'src/p1/admin-creation-experience-control.tsx', // #428 清零
  'src/p1/admin-entitlement-status-model.ts', // #428 清零
  'src/p1/admin-exception-home-model.ts', // #428 清零
  'src/p1/admin-exception-home.tsx', // #428 清零
  'src/p1/admin-feishu-view-model.ts', // #428 清零
  'src/p1/admin-operations-chart-model.ts', // #428 清零
  'src/p1/admin-payment-refund-review.tsx', // #428 清零
  'src/p1/admin-plan-reference-numbers-control.tsx', // #428 清零
  'src/p1/admin-provider-credential-control.tsx', // #428 清零
  'src/p1/admin-sensitive-words-control.tsx', // #428 清零
  'src/p1/admin-sensitive-words-gate-alert.tsx', // #428 清零
  'src/p1/admin-sensitive-words-gate.ts', // #428 清零
  'src/p1/admin-sensitive-words-model.ts', // #428 清零
  'src/p1/admin-skills-contract.ts', // #428 清零
  'src/p1/admin-skills-control.tsx', // #428 清零
  'src/p1/admin-supply-association-views-model.ts', // #428 清零
  'src/p1/admin-supply-control.tsx', // #428 清零
  'src/p1/admin-supply-credential-model.ts', // #428 清零
  'src/p1/admin-supply-fixture.ts', // #428 清零
  'src/p1/admin-supply-overview-model.ts', // #428 清零
  'src/p1/admin-supply-quick-actions-model.ts', // #428 清零
  'src/p1/admin-supply-route-simulator-model.ts', // #428 清零
  'src/p1/admin-supply-run-table-model.ts', // #428 清零
  'src/p1/admin-supply-task-drilldown-model.ts', // #428 清零
  'src/p1/admin-supply-types.ts', // #428 清零
  'src/p1/use-admin-supply-control.ts', // #428 清零
  'src/routes/admin/audit.tsx', // #428 清零
  'src/routes/admin/capabilities.tsx', // #428 清零
  'src/routes/admin/p1.tsx', // #428 清零
  'src/routes/admin/supply.tasks.$taskId.tsx', // #428 清零
  'src/routes/admin/supply.views.$viewId.tsx', // #428 清零
]);

function listTsSources(dir: string, webRoot: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const name of readdirSync(current)) {
      const full = join(current, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(name)) continue;
      if (name.endsWith('.test.ts') || name.endsWith('.test.tsx')) continue;
      if (name.endsWith('.interaction.test.tsx')) continue;
      out.push(relative(webRoot, full).split('\\').join('/'));
    }
  };
  walk(dir);
  return out;
}

function isAdminP1Source(rel: string): boolean {
  if (!rel.startsWith('src/p1/')) return false;
  const base = rel.slice('src/p1/'.length);
  return (
    base.startsWith('admin-') ||
    base.startsWith('use-admin-') ||
    base.includes('admin-')
  );
}

function listAdminSurfaceSources(webRoot: string): string[] {
  const files = new Set<string>();
  for (const dir of ADMIN_SURFACE_DIRS) {
    for (const rel of listTsSources(resolve(webRoot, dir), webRoot)) {
      files.add(rel);
    }
  }
  for (const rel of listTsSources(resolve(webRoot, 'src/p1'), webRoot)) {
    if (isAdminP1Source(rel)) files.add(rel);
  }
  return [...files].filter((rel) => !ADMIN_SURFACE_CJK_EXEMPT.has(rel)).sort();
}

function collectProductShellSources(webRoot: string): string[] {
  const files = new Set<string>(PRODUCT_SHELL_SOURCES_EXPLICIT);
  for (const rel of listAdminSurfaceSources(webRoot)) {
    files.add(rel);
  }
  return [...files].sort();
}

async function readMessages(locale: 'en' | 'zh') {
  const raw = await readFile(`project.inlang/messages/${locale}.json`, 'utf8');
  return JSON.parse(raw) as Record<string, string>;
}

export function sourceHasCjkOutsideComments(source: string, fileName: string) {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  let found = false;

  function visit(node: ts.Node) {
    if (found) return;
    let childCount = 0;
    ts.forEachChild(node, (child) => {
      childCount += 1;
      visit(child);
    });
    if (
      childCount === 0 &&
      node !== sourceFile &&
      !(ts.isJsxExpression(node) && !node.expression) &&
      /[\u3400-\u9fff]/u.test(node.getText(sourceFile))
    ) {
      found = true;
    }
  }

  visit(sourceFile);
  return found;
}

const en = await readMessages('en');
const zh = await readMessages('zh');
const enKeys = Object.keys(en).sort();
const zhKeys = Object.keys(zh).sort();

const missingInZh = enKeys.filter((key) => !zhKeys.includes(key));
const missingInEn = zhKeys.filter((key) => !enKeys.includes(key));
const emptyValues = [...enKeys, ...zhKeys].filter((key, index, keys) => {
  if (keys.indexOf(key) !== index) return false;
  return en[key] === '' || zh[key] === '';
});
const missingProductKeys = REQUIRED_PRODUCT_KEYS.filter(
  (key) => !en[key] || !zh[key]
);
const retiredNavigationKeys = RETIRED_NAVIGATION_KEYS.filter(
  (key) => key in en || key in zh
);
const settings = JSON.parse(
  await readFile('project.inlang/settings.json', 'utf8')
) as { baseLocale?: string; locales?: string[] };
const configErrors = [
  ...(settings.baseLocale === 'zh' ? [] : ['baseLocale must be zh']),
  ...(settings.locales?.includes('en') && settings.locales.includes('zh')
    ? []
    : ['locales must include en and zh']),
];
const productShellSources = collectProductShellSources(process.cwd());
const mixedTrackFiles = (
  await Promise.all(
    productShellSources.map(async (file) => ({
      file,
      source: await readFile(file, 'utf8'),
    }))
  )
).flatMap(({ file, source }) =>
  source.includes('@/locale/paraglide/messages') &&
  !sourceHasCjkOutsideComments(source, file)
    ? []
    : [file]
);

for (const key of JSON_MESSAGE_KEYS) {
  for (const [locale, messages] of [
    ['en', en],
    ['zh', zh],
  ] as const) {
    try {
      JSON.parse(messages[key] ?? '');
    } catch {
      throw new Error(`${locale}.${key} is not valid JSON`);
    }
  }
}

if (
  missingInZh.length ||
  missingInEn.length ||
  emptyValues.length ||
  missingProductKeys.length ||
  retiredNavigationKeys.length ||
  configErrors.length ||
  mixedTrackFiles.length
) {
  console.error(
    JSON.stringify(
      {
        missingInZh,
        missingInEn,
        emptyValues,
        missingProductKeys,
        retiredNavigationKeys,
        configErrors,
        mixedTrackFiles,
      },
      null,
      2
    )
  );
  process.exit(1);
}

console.log(`Locale keys OK (${enKeys.length} keys)`);
