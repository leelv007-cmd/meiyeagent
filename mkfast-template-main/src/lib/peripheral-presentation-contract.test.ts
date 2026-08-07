import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import { PUBLIC_PLAN_CREDIT_SEED } from '@meiye/contracts';
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
  // Credit-matrix plan labels live in the content module (extracted from the
  // page shell); the route only keeps page chrome + subtitle keys.
  const pricingContent = readSource(
    'src/components/pricing/credit-pricing-content.tsx'
  );
  // The plan-name map moved down into the model module when /contact started
  // reading it (a merchant who asks to be told when a plan opens should see
  // that plan named back to her). The Paraglide rule follows the labels.
  const pricingModel = readSource(
    'src/components/pricing/credit-pricing-model.ts'
  );
  const sidebarLayout = readSource('src/components/layout/sidebar-layout.tsx');
  const sidebar = readSource('src/components/ui/sidebar.tsx');

  assert.doesNotMatch(pricing, /[\u3400-\u9fff]/);
  assert.doesNotMatch(pricingContent, /[\u3400-\u9fff]/);
  assert.doesNotMatch(pricingModel, /[\u3400-\u9fff]/);
  assert.match(pricingModel, /\bpricing_output_[a-z0-9_]+\b/);
  assert.match(pricing, /from ['"]@\/locale\/paraglide\/messages['"]/);
  assert.match(pricingContent, /from ['"]@\/locale\/paraglide\/messages['"]/);
  assert.match(pricingModel, /from ['"]@\/locale\/paraglide\/messages['"]/);
  assert.doesNotMatch(sidebarLayout, />Loading\.\.\.</);
  assert.doesNotMatch(sidebar, />Sidebar</);
  assert.doesNotMatch(sidebar, /Displays the mobile sidebar\./);
  assert.doesNotMatch(sidebar, /["']Toggle Sidebar["']/);
});

test('pricing stays readable without checkout and every public pricing CTA reaches it', async () => {
  // #310 moved plan markup into CreditPricingContent; PricingPage reads
  // Route.useLoaderData() off the real file route, so a synthetic router no
  // longer renders. Drive the content module directly for the unauthenticated
  // "readable without checkout" case.
  const [
    { Pricing: LandingPricing },
    { Footer: LandingFooter },
    { CreditPricingContent },
  ] = await Promise.all([
    import('../components/landing/pricing'),
    import('../components/landing/footer'),
    import('../components/pricing/credit-pricing-content'),
  ]);

  const catalogFixture = {
    addOns: [],
    plans: [...PUBLIC_PLAN_CREDIT_SEED],
  };
  const pricingHtml = renderToStaticMarkup(
    createElement(CreditPricingContent, {
      catalog: catalogFixture,
      isAuthenticated: false,
    })
  );
  assert.ok(pricingHtml.length > 0, 'pricing content must render markup');
  // Credit-matrix page (D-172 / #310): public upgrade CTAs deep-link here.
  assert.match(pricingHtml, /id="subscription-plans"/u);
  // baseLocale is zh; plan h3 labels are 起步 / 成长 / 专业.
  assert.match(pricingHtml, />起步</u);
  assert.match(pricingHtml, />成长</u);
  assert.match(pricingHtml, />专业</u);
  // Hero credits: testid attribute closes then the bare number, then a suffix span.
  // Verified shape: data-testid="pricing-credits-starter">500<span class="ml-1 ...
  assert.match(pricingHtml, /data-testid="pricing-credits-starter">500<span/u);
  assert.match(pricingHtml, /data-testid="pricing-credits-growth">1300<span/u);
  assert.match(pricingHtml, /data-testid="pricing-credits-pro">2800<span/u);

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
  // The landing surface keeps /pricing reachable and register-first CTAs live.
  //
  // Until 2026-08-05 this asserted two registration links, a disabled
  // 敬请期待 non-link, and the literal 升级中级套餐 label — all three were
  // per-tier facts of the landing's own three cards, and the user's de-tiering
  // ruling retired the cards. The successors say the same thing about a page
  // with one offer: the catalog stays reachable, registration stays reachable,
  // and nothing on the block pretends to be a control that does not work.
  assert.ok((ctaHtml.match(/href="\/pricing"/g) ?? []).length >= 1);
  assert.ok((ctaHtml.match(/href="\/auth\/register"/g) ?? []).length >= 1);
  assert.doesNotMatch(ctaHtml, /aria-disabled="true"/u);

  // The user's own launch-special badge renders, and the tier names it used to
  // sit on do not.
  assert.match(ctaHtml, />上线特惠</u);
  for (const tier of ['初级', '中级', '终身版']) {
    assert.doesNotMatch(
      ctaHtml,
      new RegExp(tier, 'u'),
      `landing names ${tier}`
    );
  }

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
    // Plan-name keys moved here with the credit-matrix extract (#310), then
    // down into the model module when /contact began naming plans too.
    'src/components/pricing/credit-pricing-content.tsx',
    'src/components/pricing/credit-pricing-model.ts',
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
