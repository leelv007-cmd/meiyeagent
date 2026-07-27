import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { PRODUCT_THEME_COLOR } from '@/config/theme';
import { Route as manifestRoute } from '@/routes/manifest[.]json';
import { LOCALIZED_PATHS } from './locale';
import { Routes } from './routes';

const retiredPublicPaths = [
  '/about',
  '/ai',
  '/changelog',
  '/roadmap',
  '/waitlist',
];

test('retired starter and AI bypass paths are absent from public navigation contracts', () => {
  const routeValues = Object.values(Routes);
  for (const path of retiredPublicPaths) {
    assert.equal(
      routeValues.some((value) => value.startsWith(path)),
      false
    );
    assert.equal(LOCALIZED_PATHS.has(path), false);
  }
});

test('retired starter and AI bypass route modules are removed', () => {
  const routes = resolve(process.cwd(), 'src/routes/(pages)');
  for (const file of [
    'about.tsx',
    'ai.tsx',
    'changelog.tsx',
    'roadmap.tsx',
    'waitlist.tsx',
  ]) {
    assert.equal(existsSync(resolve(routes, file)), false, file);
  }
});

test('the unused starter dashboard data-table demo is removed', () => {
  assert.equal(
    existsSync(
      resolve(process.cwd(), 'src/components/dashboard/data-table.tsx')
    ),
    false
  );
});

test('the manifest and the document head take their theme colour from one source', async () => {
  const handlers = manifestRoute.options.server?.handlers;
  assert.ok(handlers, 'the manifest route must declare server handlers');
  assert.ok(typeof handlers !== 'function');
  const get = handlers.GET;
  assert.ok(get, 'the manifest route must serve GET');
  // The handler ignores its router context, so an empty one is enough here;
  // building a real one would not make the manifest body any more real.
  type HandlerCtx = NonNullable<
    Parameters<NonNullable<typeof handlers.GET>>[0]
  >;
  const response = await get({} as HandlerCtx);
  assert.ok(response instanceof Response);
  const manifest = (await response.json()) as Record<string, unknown>;
  const read = (file: string) =>
    readFileSync(resolve(process.cwd(), file), 'utf8');
  const root = read('src/routes/__root.tsx');
  const manifestSource = read('src/routes/manifest[.]json.ts');

  // Same source, not merely the same value today. Both ends must reference the
  // shared constant: a literal that happens to match it right now is exactly
  // the drift the "keep in sync" comment failed to prevent, so each end is
  // checked for the reference AND for the absence of a restated hex literal.
  assert.equal(
    response.headers.get('Content-Type'),
    'application/manifest+json'
  );
  assert.equal(manifest.background_color, PRODUCT_THEME_COLOR);
  assert.equal(manifest.theme_color, PRODUCT_THEME_COLOR);
  assert.match(manifestSource, /background_color:\s*PRODUCT_THEME_COLOR,/u);
  assert.match(manifestSource, /theme_color:\s*PRODUCT_THEME_COLOR,/u);
  assert.doesNotMatch(manifestSource, /_color:\s*['"]#/u);
  assert.match(
    root,
    /\{\s*name:\s*'theme-color',\s*content:\s*PRODUCT_THEME_COLOR\s*\}/u
  );
  assert.doesNotMatch(root, /'theme-color',\s*content:\s*['"]#/u);
  // Referencing the identifier is not enough — a second module could export a
  // same-named constant and drift right back. Pin where __root imports it from,
  // so the shared source is the one both ends actually read.
  assert.match(
    root,
    /import\s*\{[^}]*\bPRODUCT_THEME_COLOR\b[^}]*\}\s*from\s*'@\/config\/theme'/u,
    '__root must take PRODUCT_THEME_COLOR from @/config/theme, the same module the manifest reads'
  );
  assert.match(root, /rel:\s*'manifest',\s*href:\s*'\/manifest\.json'/u);
});

test('published brand copy and website config contain no starter vendor residue', () => {
  const publishedFiles = [
    'project.inlang/messages/en.json',
    'project.inlang/messages/zh.json',
    'src/config/website.ts',
    'src/components/landing/landing-page.tsx',
    'src/components/landing/hero.tsx',
    'src/components/landing/pricing.tsx',
    'src/components/landing/footer.tsx',
    'src/components/layout/footer.tsx',
  ];
  const source = publishedFiles
    .map((file) => readFileSync(resolve(process.cwd(), file), 'utf8'))
    .join('\n');

  assert.doesNotMatch(
    source,
    /TanStarter|MkFast|MkSaaS|mksaas|Built with|Kraft|Nexus AI/i
  );
});

test('shared product shell copy uses the Chinese-first Paraglide track', () => {
  const settings = JSON.parse(
    readFileSync(resolve(process.cwd(), 'project.inlang/settings.json'), 'utf8')
  ) as { baseLocale?: string };
  const shellSources = [
    'src/lib/uiux/navigation.ts',
    'src/config/sidebar-config.ts',
    'src/components/layout/sidebar-user.tsx',
  ].map((file) => readFileSync(resolve(process.cwd(), file), 'utf8'));

  assert.equal(settings.baseLocale, 'zh');
  for (const source of shellSources) {
    assert.match(source, /@\/locale\/paraglide\/messages/);
    assert.doesNotMatch(source, /[\u3400-\u9fff]/);
  }
});

test('creation commands keep localized display strings out of persisted facts', () => {
  const sources = [
    'src/product/canvas-work-page.tsx',
    'src/product/composer/composer-home.tsx',
    'src/product/results/result-center-page.tsx',
  ].map((file) => readFileSync(resolve(process.cwd(), file), 'utf8'));
  const combined = sources.join('\n');

  for (const forbidden of [
    'm.creation_shelf_blank_canvas_name()',
    'm.creation_shelf_canvas_name(',
    'm.canvas_work_new_copy_name(',
    'm.workbench_store_owner()',
    'm.workbench_composer_input_tag()',
    'm.mobile_action_store_owner()',
  ]) {
    assert.doesNotMatch(
      combined,
      new RegExp(forbidden.replace(/[().]/g, '\\$&'))
    );
  }

  const canvasPage = readFileSync(
    resolve(process.cwd(), 'src/product/canvas-work-page.tsx'),
    'utf8'
  );
  assert.match(canvasPage, /const displayName = canvasName\(work\.name\)/);
  assert.doesNotMatch(canvasPage, /legacySystemName|templateViews/);
});

test('product controls consume the fixed touch target and readable type tokens', () => {
  const styles = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');
  const controls = [
    'src/components/ui/button.tsx',
    'src/components/ui/input.tsx',
    'src/components/ui/select.tsx',
    'src/components/layout/desktop-relay-page.tsx',
  ].map((file) => readFileSync(resolve(process.cwd(), file), 'utf8'));

  assert.match(styles, /--spacing-touch-target:\s*48px/);
  assert.match(styles, /html\s*\{[^}]*font-size:\s*16px/s);
  assert.match(styles, /Inter,\s*"HarmonyOS Sans",\s*MiSans,\s*"PingFang SC"/);
  for (const source of controls) {
    assert.match(source, /touch-target/);
  }
});

const localizedDashboardRoutes = [
  'src/routes/dashboard/store.tsx',
  'src/routes/dashboard/handoff/$token.tsx',
];

test('dashboard store and handoff routes use Paraglide at the render boundary', () => {
  for (const file of localizedDashboardRoutes) {
    const source = readFileSync(resolve(process.cwd(), file), 'utf8');
    const presentationSource = source
      .replaceAll('透亮猫眼', '')
      .replaceAll('猫眼', '')
      .replaceAll('不虚构价格与活动', '')
      .replaceAll('不承诺不可核验效果', '');

    assert.match(source, /@\/locale\/paraglide\/messages/, file);
    assert.doesNotMatch(presentationSource, /[\u3400-\u9fff]/, file);
  }
});

test('dashboard message handoff records every new localized key in both languages', () => {
  const sources = localizedDashboardRoutes.map((file) =>
    readFileSync(resolve(process.cwd(), file), 'utf8')
  );
  const manifest = JSON.parse(
    readFileSync(
      resolve(
        process.cwd(),
        '../.scratch/uiux-upgrade-b/i18n-dashboard-keys.json'
      ),
      'utf8'
    )
  ) as { messages: Record<string, { en: string; zh: string }> };
  const referencedKeys = new Set(
    sources.flatMap((source) =>
      Array.from(
        source.matchAll(
          /(?:\bm\.)?\b(dashboard_(?:content|store|handoff)_[a-z0-9_]*)\b/g
        ),
        (match) => match[1]
      )
    )
  );

  assert.ok(referencedKeys.size > 0);
  for (const key of referencedKeys) {
    assert.ok(manifest.messages[key]?.zh.trim(), `${key}: zh`);
    assert.ok(manifest.messages[key]?.en.trim(), `${key}: en`);
  }
});
