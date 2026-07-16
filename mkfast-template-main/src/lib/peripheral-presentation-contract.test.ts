import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { createElement, Fragment } from 'react';
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

const readSource = (file: string) =>
  readFileSync(resolve(process.cwd(), file), 'utf8');

test('merchant-facing forms never render raw upstream error messages', () => {
  const clientFiles = [
    'src/components/contact/contact-form-card.tsx',
    'src/components/blocks/newsletter-card.tsx',
    'src/components/settings/notification/newsletter-form-card.tsx',
    'src/components/admin/users/user-detail-viewer.tsx',
  ];

  for (const file of clientFiles) {
    assert.doesNotMatch(readSource(file), /(?:err|error)\.message/, file);
  }

  const newsletterApi = readSource('src/api/newsletter.ts');
  assert.doesNotMatch(
    newsletterApi,
    /error\s+instanceof\s+Error\s*\?\s*error\.message/
  );

  const locale = readSource('src/lib/locale.ts');
  assert.doesNotMatch(locale, /\?\?\s*message\s*\?\?/);
});

test('merchant-facing integration labels do not fall back to internal ids', () => {
  const byok = readSource('src/p1/entitlement-byok-panels.tsx');
  const integrations = readSource('src/p1/integration-settings.tsx');

  assert.doesNotMatch(byok, /connection\.subject\s*\?\?\s*connection\.id/);
  assert.doesNotMatch(byok, /\{candidate\.id\}\s*·/);
  assert.doesNotMatch(byok, />\s*\{model\}\s*</);
  assert.doesNotMatch(
    integrations,
    /identity:\s*connection\.subject\s*\?\?\s*connection\.id/
  );
  assert.doesNotMatch(
    integrations,
    /integration_audit_connection\(\{\s*connectionId:\s*event\.connectionId/s
  );
});

test('pricing comparison and shared accessibility copy use Paraglide', () => {
  const pricing = readSource('src/routes/(pages)/pricing.tsx');
  const sidebarLayout = readSource('src/components/layout/sidebar-layout.tsx');
  const sidebar = readSource('src/components/ui/sidebar.tsx');
  const files = readSource('src/components/settings/files/files-table.tsx');

  assert.doesNotMatch(pricing, /[\u3400-\u9fff]/);
  assert.match(pricing, /\bpricing_output_[a-z0-9_]+\b/);
  assert.match(pricing, /from ['"]@\/locale\/paraglide\/messages['"]/);
  assert.doesNotMatch(sidebarLayout, />Loading\.\.\.</);
  assert.doesNotMatch(sidebar, />Sidebar</);
  assert.doesNotMatch(sidebar, /Displays the mobile sidebar\./);
  assert.doesNotMatch(sidebar, /["']Toggle Sidebar["']/);
  assert.doesNotMatch(files, /["']Public["']\s*:\s*["']Private["']/);
});

test('pricing stays readable without checkout and every public pricing CTA reaches it', async () => {
  const [
    { default: HeroSection },
    { default: CallToActionSection },
    { default: Integration2Section },
    { Route: pricingRoute },
  ] = await Promise.all([
    import('../components/blocks/hero'),
    import('../components/blocks/calltoaction'),
    import('../components/blocks/integration2'),
    import('../routes/(pages)/pricing'),
  ]);

  const PricingPage = pricingRoute.options.component;
  assert.ok(PricingPage);
  const pricingHtml = renderToStaticMarkup(createElement(PricingPage));
  assert.match(pricingHtml, /id="output-plan-heading"/u);
  assert.match(pricingHtml, />Starter</u);
  assert.match(pricingHtml, />Growth</u);
  assert.match(pricingHtml, />Pro</u);
  assert.match(pricingHtml, />30 条</u);
  assert.match(pricingHtml, />100 条</u);
  assert.match(pricingHtml, />300 条</u);

  const rootRoute = createRootRoute({ component: Outlet });
  const publicPageRoute = createRoute({
    component: () =>
      createElement(
        Fragment,
        null,
        createElement(HeroSection),
        createElement(CallToActionSection),
        createElement(Integration2Section)
      ),
    getParentRoute: () => rootRoute,
    path: '/',
  });
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ['/'] }),
    routeTree: rootRoute.addChildren([publicPageRoute]),
  });
  await router.load();

  const ctaHtml = renderToStaticMarkup(
    createElement(RouterProvider, { router })
  );
  assert.equal((ctaHtml.match(/href="\/pricing"/g) ?? []).length, 3);
});

test('peripheral Paraglide handoff records every new key in both languages', () => {
  const sourceFiles = [
    'src/p1/entitlement-byok-panels.tsx',
    'src/p1/integration-settings.tsx',
    'src/p1/settings-view-model.ts',
    'src/components/ui/sidebar.tsx',
    'src/components/settings/files/files-table.tsx',
    'src/routes/(pages)/pricing.tsx',
  ];
  const manifest = JSON.parse(
    readSource('../.scratch/uiux-upgrade-b/i18n-peripheral-keys.json')
  ) as { messages: Record<string, { en: string; zh: string }> };
  const referencedKeys = new Set(
    sourceFiles.flatMap((file) =>
      Array.from(
        readSource(file).matchAll(
          /(?:\bm\.)?\b((?:integration_byok_option_(?:connection|model|profile)|integration_audit_connection_name|p1_model_manufacturer|sidebar_(?:mobile|toggle)|settings_files_access|pricing_output)[a-z0-9_]*)\b/g
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
