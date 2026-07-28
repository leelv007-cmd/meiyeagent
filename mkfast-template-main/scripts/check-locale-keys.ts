import { readFile } from 'node:fs/promises';
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

const PRODUCT_SHELL_SOURCES = [
  'src/lib/uiux/navigation.ts',
  'src/lib/uiux/status.ts',
  'src/components/uiux/object-evidence.tsx',
  'src/components/layout/desktop-relay-page.tsx',
  'src/components/layout/sidebar-layout.tsx',
  'src/components/shared/logo.tsx',
  'src/config/sidebar-config.ts',
  'src/components/layout/sidebar-user.tsx',
  'src/p1/admin-audit-control.tsx',
  'src/p1/admin-feishu-tool-control.tsx',
  'src/p1/admin-model-control.tsx',
  'src/p1/admin-view-model.ts',
  'src/p1/admin-operations-health.tsx',
  'src/p1/admin-plan-control.tsx',
  'src/p1/admin-redemption-control.tsx',
  'src/p1/admin-template-control.tsx',
  'src/p1/admin-template-forms.ts',
  'src/p1/canvas-product-assets.ts',
  'src/p1/integration-settings-forms.ts',
  'src/p1/integration-settings.tsx',
  'src/p1/model-settings.tsx',
  'src/p1/operations-view-model.ts',
  'src/p1/redemption-card.tsx',
  'src/p1/settings-view-model.ts',
  'src/p1/use-integration-settings.ts',
  'src/product/account-usage-panel.tsx',
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
const mixedTrackFiles = (
  await Promise.all(
    PRODUCT_SHELL_SOURCES.map(async (file) => ({
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
