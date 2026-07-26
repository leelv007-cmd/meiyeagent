import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Children,
  isValidElement,
  type ComponentType,
  type ReactElement,
  type ReactNode,
} from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { MarketingIdentityAsset } from '@meiye/contracts';

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

const { MarketingIdentityManager } = await import(
  '@/product/marketing-identity-manager'
);
// T33 / #227: management moved to /dashboard/identity; the asset page keeps the
// summary and the way in, so the wizard assertions follow the surface.
const { MarketingIdentityPage } = await import(
  '@/product/marketing-identity-page'
);
const { CanonicalHistoryNavigation } = await import(
  '@/product/canonical-history-page'
);
const { marketingIdentitiesQuery } = await import(
  '@/product/marketing-identity-queries'
);
const { Route: assetsFileRoute } = await import('./assets');
const AssetLibraryPage = assetsFileRoute.options.component;

function containsComponent(node: ReactNode, component: ComponentType): boolean {
  if (!isValidElement(node)) return false;
  if (node.type === component) return true;
  const element = node as ReactElement<{ children?: ReactNode }>;
  return Children.toArray(element.props.children).some((child) =>
    containsComponent(child, component)
  );
}

test('asset library route exposes identity management on the asset page', () => {
  assert.equal(typeof AssetLibraryPage, 'function');
  assert.equal(
    containsComponent(AssetLibraryPage!({}), MarketingIdentityManager),
    true
  );
});

test('the asset page identity summary stays a styled card with a way in', () => {
  // The asset page carries no heroui-glass stylesheet link (T32 owns that file
  // and it stays byte-identical), so this summary has to survive on global
  // primitives: a porcelain card, and an entry styled like a button.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <MarketingIdentityManager />
    </QueryClientProvider>
  );

  assert.match(html, /<section[^>]*class="[^"]*\bmeiye-porcelain\b/u);
  const entry = html.match(/<a class="([^"]*)" href="\/dashboard\/identity">/u);
  assert.ok(entry, 'identity entry link must point at /dashboard/identity');
  assert.match(entry[1]!, /\binline-flex\b/u);
  assert.doesNotMatch(html, /class="[^"]*\bwidget(__|")/u);
});

test('identity registration starts as one generated question instead of a field form', () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <MarketingIdentityPage />
    </QueryClientProvider>
  );

  assert.match(html, /这次要登记品牌身份，还是个人 IP/u);
  assert.doesNotMatch(html, /<form/u);
  assert.doesNotMatch(html, /name="displayName"/u);
  assert.match(html, /aria-live="polite"/u);
  assert.match(html, /aria-atomic="true"/u);
  assert.match(
    html,
    /id="marketing-identity-question-region-kind"[^>]*tabindex="-1"/u
  );
  assert.doesNotMatch(html, /身份资产/u);
});

test('identity cards show merchant status without raw code or primary version', () => {
  const queryClient = new QueryClient();
  const identity = {
    allowedPlatforms: ['xiaohongshu'],
    allowedScenes: ['brand_personal_ip'],
    brandClaims: ['专业护理'],
    createdAt: '2026-07-19T00:00:00.000Z',
    createdBy: 'owner-a',
    departureHandling: '撤回后停止新生成',
    displayName: '青禾美业',
    effectiveFrom: '2026-07-19T00:00:00.000Z',
    expiresAt: null,
    expressionSamples: ['先了解需求'],
    forbiddenClaims: [],
    identityId: 'identity-a',
    kind: 'brand',
    owner: '青禾品牌中心',
    professionalBoundaries: ['不做医疗承诺'],
    seriesAnchors: [],
    sourceRef: 'brand-guideline-a',
    status: 'active',
    version: 3,
    visualPrinciples: [],
    workspaceId: 'workspace-a',
  } satisfies MarketingIdentityAsset;
  queryClient.setQueryData(marketingIdentitiesQuery.queryKey, [identity]);

  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <MarketingIdentityPage />
    </QueryClientProvider>
  );

  assert.match(html, /生效中/u);
  assert.doesNotMatch(html, />active</u);
  assert.doesNotMatch(html, /V3/u);
});

test('asset library does not expose legacy history navigation', () => {
  assert.equal(
    renderToStaticMarkup(<CanonicalHistoryNavigation mode="assets" />),
    ''
  );
});

test('merchant surfaces hide works/jobs/sessions history projection nav', () => {
  for (const mode of ['works', 'jobs', 'sessions'] as const) {
    assert.equal(
      renderToStaticMarkup(<CanonicalHistoryNavigation mode={mode} />),
      '',
      `${mode} must not expose object-model history nav`
    );
  }
  const recent = renderToStaticMarkup(
    <CanonicalHistoryNavigation mode="recent" />
  );
  assert.match(recent, /dashboard\/recent|dashboard\/search/u);
  assert.doesNotMatch(recent, /dashboard\/works|dashboard\/jobs/u);
});
