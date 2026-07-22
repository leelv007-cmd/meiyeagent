import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

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

test('the mobile primitive proof is unavailable in production', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/routes/pwa-proof.tsx'),
    'utf8'
  );

  assert.match(source, /import\.meta\.env\.PROD/);
  assert.match(source, /throw notFound\(\)/);
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
    'src/product/creation-shelf.tsx',
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
  'src/routes/dashboard/-content-library-surface.tsx',
  'src/routes/dashboard/store.tsx',
  'src/routes/dashboard/leads.tsx',
  'src/routes/dashboard/handoff/$token.tsx',
  'src/routes/dashboard/leads_/$leadId.tsx',
];

test('dashboard content, store, lead, and handoff routes use Paraglide at the render boundary', () => {
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
          /(?:\bm\.)?\b(dashboard_(?:content|store|lead|handoff)_[a-z0-9_]*)\b/g
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

test('lead detail renders readable localized facts without exposing internal content ids', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/routes/dashboard/leads_/$leadId.tsx'),
    'utf8'
  );

  assert.doesNotMatch(
    source,
    /\{lead\.(?:status|source|contentId|contentVersionId)\}/
  );
  assert.match(source, /leadStatusLabel\(lead\.status\)/);
  assert.match(source, /leadSourceLabel\(lead\.source\)/);
  assert.match(source, /dashboard_lead_detail_linked_content/);
});
