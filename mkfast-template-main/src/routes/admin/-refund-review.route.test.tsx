/**
 * #424: refund-review page header is the sole title surface; the panel must
 * not repeat title/description (same residual pattern as #387 association views).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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

const { admin_refund_review_description, admin_refund_review_title } =
  await import('@/locale/paraglide/messages');
const { overwriteGetLocale } = await import('@/locale/paraglide/runtime');
const { AdminPaymentRefundReview } = await import(
  '@/p1/admin-payment-refund-review'
);

const panelSource = readFileSync(
  resolve(process.cwd(), 'src/p1/admin-payment-refund-review.tsx'),
  'utf8'
);
const routeSource = readFileSync(
  resolve(process.cwd(), 'src/routes/admin/refund-review.tsx'),
  'utf8'
);

test('refund-review route owns page title/description via Paraglide', () => {
  assert.match(routeSource, /admin_refund_review_title\(\)/);
  assert.match(routeSource, /admin_refund_review_description\(\)/);
  assert.match(routeSource, /@\/locale\/paraglide\/messages/);
  assert.match(routeSource, /AdminPaymentRefundReview/);
});

/**
 * #424: page header already shows title/description; panel body must not
 * repeat those same strings (FrameTitle/FrameDescription removed).
 */
test('refund review panel does not repeat the page header title', () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <AdminPaymentRefundReview />
    </QueryClientProvider>
  );

  assert.match(html, /data-testid="admin-payment-refund-review"/);

  for (const locale of ['zh', 'en'] as const) {
    overwriteGetLocale(() => locale);
    const title = admin_refund_review_title();
    const description = admin_refund_review_description();
    assert.doesNotMatch(
      html,
      new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    );
    assert.doesNotMatch(
      html,
      new RegExp(description.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    );
  }
  overwriteGetLocale(() => 'zh');
});

test('refund review panel source has no hardcoded English chrome copy', () => {
  assert.doesNotMatch(panelSource, /Payment refund review/);
  assert.doesNotMatch(
    panelSource,
    /Review provider refund facts without changing customer credits/
  );
  assert.doesNotMatch(panelSource, /No refund reviews\./);
  assert.doesNotMatch(panelSource, /Refund reviews could not be loaded/);
  assert.doesNotMatch(panelSource, /Resolve review/);
  assert.doesNotMatch(panelSource, /Resolution note/);
  assert.doesNotMatch(panelSource, /Provider facts/);
  assert.doesNotMatch(panelSource, /Unknown resolution time/);
  assert.doesNotMatch(panelSource, /Refund review resolved/);
  assert.doesNotMatch(panelSource, /Refund review could not be resolved/);
  assert.doesNotMatch(panelSource, /Loading\.\.\./);
  // Title surface is page-only; panel must not reintroduce FrameTitle.
  assert.doesNotMatch(panelSource, /FrameTitle|FrameDescription|FrameHeader/);
  assert.match(panelSource, /admin_refund_review_/);
  assert.match(panelSource, /@\/locale\/paraglide\/messages/);
});
