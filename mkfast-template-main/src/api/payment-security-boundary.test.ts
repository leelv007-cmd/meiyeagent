import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

test('billing portal requires recent authentication without stepping up checkout', async () => {
  const source = await readFile(
    resolve(process.cwd(), 'src/api/payment.ts'),
    'utf8'
  );

  assert.match(
    source,
    /createCheckoutSession[\s\S]*?\.middleware\(\[authApiMiddleware\]\)[\s\S]*?createCustomerPortalSession/u
  );
  assert.match(
    source,
    /createCustomerPortalSession[\s\S]*?\.middleware\(\[recentAuthApiMiddleware\]\)/u
  );
});

test('checkout bootstraps the verified Core workspace before creating a binding', async () => {
  const source = await readFile(
    resolve(process.cwd(), 'src/api/payment.ts'),
    'utf8'
  );

  assert.match(
    source,
    /ensureVerifiedWorkspaceProvisioned[\s\S]*?createOwnerBinding/u
  );
});

test('getCurrentPlan resolves subscriptions through the active workspace binding, never by user alone', async () => {
  const source = await readFile(
    resolve(process.cwd(), 'src/api/payment.ts'),
    'utf8'
  );

  const getCurrentPlanSource = source.slice(
    source.indexOf('export const getCurrentPlan')
  );
  assert.match(
    getCurrentPlanSource,
    /resolveActiveWorkspace\(userId\)[\s\S]*?workspace_binding\.workspace_id[\s\S]*?workspaceSubscriptionPredicate/u
  );
});

test('Waffo checkout requires Test server authority before catalog or binding work', async () => {
  const source = await readFile(
    resolve(process.cwd(), 'src/api/payment.ts'),
    'utf8'
  );

  assert.match(
    source,
    /provider === 'waffo'[\s\S]*?requireWaffoTestCheckoutAuthority\(serverEnv\.WAFFO_ENVIRONMENT\)[\s\S]*?requireSellableCheckoutPrice/u
  );
});

test('credit package checkout is Test-only and binds the owner workspace before Waffo checkout', async () => {
  const source = await readFile(
    resolve(process.cwd(), 'src/api/payment.ts'),
    'utf8'
  );

  assert.match(
    source,
    /createCreditPackageCheckoutSession[\s\S]*?requireWaffoTestCheckoutAuthority\(serverEnv\.WAFFO_ENVIRONMENT\)[\s\S]*?resolveWaffoCreditPackageProduct[\s\S]*?ensureVerifiedWorkspaceProvisioned[\s\S]*?createOwnerBinding[\s\S]*?createCreditPackageCheckout/u
  );
});

test('admin refund-review mounts the protected refund review consumer', async () => {
  // Spec G / #388: write workflow left the read-only audit page.
  const [routeSource, auditSource, apiSource] = await Promise.all([
    readFile(
      resolve(process.cwd(), 'src/routes/admin/refund-review.tsx'),
      'utf8'
    ),
    readFile(resolve(process.cwd(), 'src/routes/admin/audit.tsx'), 'utf8'),
    readFile(resolve(process.cwd(), 'src/api/payment-refunds.ts'), 'utf8'),
  ]);

  assert.match(
    routeSource,
    /import \{ AdminPaymentRefundReview \} from '@\/p1\/admin-payment-refund-review';[\s\S]*?<AdminPaymentRefundReview \/>/u
  );
  assert.doesNotMatch(
    auditSource,
    /AdminPaymentRefundReview/
  );
  assert.match(
    apiSource,
    /listPaymentRefundReviews[\s\S]*?method: 'GET'[\s\S]*?middleware\(\[adminApiMiddleware\]\)/u
  );
  assert.match(
    apiSource,
    /resolvePaymentRefund[\s\S]*?method: 'POST'[\s\S]*?middleware\(\[recentAdminApiMiddleware\]\)/u
  );
});
