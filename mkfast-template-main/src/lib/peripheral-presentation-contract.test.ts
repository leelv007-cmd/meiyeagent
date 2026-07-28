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
    'src/components/admin/users/user-detail-viewer.tsx',
  ];

  for (const file of clientFiles) {
    assert.doesNotMatch(readSource(file), /(?:err|error)\.message/, file);
  }

  const contactApi = readSource('src/api/contact.ts');
  assert.doesNotMatch(
    contactApi,
    /error\s+instanceof\s+Error\s*\?\s*error\.message/
  );

  const locale = readSource('src/lib/locale.ts');
  assert.doesNotMatch(locale, /\?\?\s*message\s*\?\?/);
});

test('merchant-facing integration labels do not fall back to internal ids', () => {
  const integrations = readSource('src/p1/integration-settings.tsx');

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

  assert.doesNotMatch(pricing, /[\u3400-\u9fff]/);
  assert.match(pricing, /\bpricing_output_[a-z0-9_]+\b/);
  assert.match(pricing, /from ['"]@\/locale\/paraglide\/messages['"]/);
  assert.doesNotMatch(sidebarLayout, />Loading\.\.\.</);
  assert.doesNotMatch(sidebar, />Sidebar</);
  assert.doesNotMatch(sidebar, /Displays the mobile sidebar\./);
  assert.doesNotMatch(sidebar, /["']Toggle Sidebar["']/);
});

test('pricing stays readable without checkout and every public pricing CTA reaches it', async () => {
  const [
    { Pricing: LandingPricing },
    { Footer: LandingFooter },
    { Route: pricingRoute },
    { PLAN_CATALOG_SEED },
  ] = await Promise.all([
    import('../components/landing/pricing'),
    import('../components/landing/footer'),
    import('../routes/(pages)/pricing'),
    import('../api/plan-catalog'),
  ]);

  const PricingPage = pricingRoute.options.component;
  assert.ok(PricingPage);
  // The page reads its quotas from the entitlement catalogue (D-143), so it
  // renders through a router that serves the seed rather than standalone.
  const pricingRootRoute = createRootRoute({ component: Outlet });
  const pricingPageRoute = createRoute({
    component: PricingPage,
    getParentRoute: () => pricingRootRoute,
    loader: () => PLAN_CATALOG_SEED,
    path: '/pricing',
  });
  const pricingRouter = createRouter({
    history: createMemoryHistory({ initialEntries: ['/pricing'] }),
    routeTree: pricingRootRoute.addChildren([pricingPageRoute]),
  });
  await pricingRouter.load();
  const pricingHtml = renderToStaticMarkup(
    createElement(RouterProvider, { router: pricingRouter })
  );
  assert.match(pricingHtml, /id="output-plan-heading"/u);
  // D-123 档位命名: 初级 / 中级 / 高级.
  assert.match(pricingHtml, />初级</u);
  assert.match(pricingHtml, />中级</u);
  assert.match(pricingHtml, />高级</u);
  // D-123 文案 seed per tier, straight off the catalogue projection.
  assert.match(pricingHtml, />100 条</u);
  assert.match(pricingHtml, />300 条</u);
  assert.match(pricingHtml, />600 条</u);

  const rootRoute = createRootRoute({ component: Outlet });
  const publicPageRoute = createRoute({
    component: () =>
      createElement(
        Fragment,
        null,
        createElement(LandingPricing),
        createElement(LandingFooter)
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
  // The landing surface keeps /pricing reachable and register-first CTAs live;
  // the lifetime tier stays a disabled non-link.
  assert.ok((ctaHtml.match(/href="\/pricing"/g) ?? []).length >= 1);
  assert.ok((ctaHtml.match(/href="\/auth\/register"/g) ?? []).length >= 2);
  assert.match(ctaHtml, /aria-disabled="true"/u);
  assert.match(ctaHtml, />敬请期待</u);
  assert.doesNotMatch(ctaHtml, /<a[^>]*>[^<]*敬请期待/u);

  // The user's own pricing wording renders: the launch-special badge and an
  // upgrade CTA that reaches registration.
  assert.match(ctaHtml, />上线特惠</u);
  assert.match(
    ctaHtml,
    /<a[^>]*href="\/auth\/register"[^>]*>升级中级套餐<\/a>/u
  );

  // T36 / D-124: the badge stands on the footnote's disclosure, so the rendered
  // landing still has to say online payment is not open and credits come from a
  // redemption code — it may not contradict /pricing's own projection.
  assert.match(ctaHtml, /线上支付未开放/u);
  assert.match(ctaHtml, /兑换码/u);
  assert.doesNotMatch(ctaHtml, /立即(?:购买|订阅|升级)/u);
  assert.doesNotMatch(pricingHtml, /上线特惠/u);
});

test('peripheral Paraglide handoff records every new key in both languages', () => {
  const sourceFiles = [
    'src/p1/integration-settings.tsx',
    'src/p1/settings-view-model.ts',
    'src/components/ui/sidebar.tsx',
    'src/routes/(pages)/pricing.tsx',
  ];
  const enMessages = JSON.parse(
    readSource('project.inlang/messages/en.json')
  ) as Record<string, string>;
  const zhMessages = JSON.parse(
    readSource('project.inlang/messages/zh.json')
  ) as Record<string, string>;
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
    assert.ok(zhMessages[key]?.trim(), `${key}: zh`);
    assert.ok(enMessages[key]?.trim(), `${key}: en`);
  }
});
