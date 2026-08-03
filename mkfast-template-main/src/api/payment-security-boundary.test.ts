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
