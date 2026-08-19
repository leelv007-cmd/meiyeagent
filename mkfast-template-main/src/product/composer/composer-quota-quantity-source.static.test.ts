/**
 * S3 P0-1 — the pre-check and the bill count the same deliverables.
 *
 * The server bills off the *signed* deliverable quantity
 * (`server-quote-authority.ts` → `submission.deliverable.quantity`). The
 * front-end pre-check once read `lensState.draft.settings.quantity` instead,
 * which is only the lens default until the merchant dirties the field — so an
 * image_set recipe declaring 4 against an untouched draft of 1 pre-checked one
 * image and billed four.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  callArgumentObjects,
  identifiers,
  literals,
  parseProductionSource,
  parseSourceText,
  propertyAccesses,
  propertyValues,
  variableInitializerAccesses,
} from '../../test-support/ast-boundary';

const composerHome = parseProductionSource(
  new URL('./composer-home.tsx', import.meta.url)
);
const quoteAuthority = parseProductionSource(
  new URL(
    '../../../../apps/core/src/p1/product-billing/server-quote-authority.ts',
    import.meta.url
  )
);

test('pre-fix draft-setting quantity fails the signed-quantity boundary', () => {
  const preFix = parseSourceText(
    'pre-fix.ts',
    'composerQuotaRequirements({ quantity: lensState.draft.settings.quantity });'
  );
  assert.equal(
    callArgumentObjects(preFix, 'composerQuotaRequirements')[0]?.quantity,
    'lensState.draft.settings.quantity'
  );
});

test('the quantity is derived once, from the recipe unless the merchant edited it', () => {
  const accesses = variableInitializerAccesses(
    composerHome,
    'submissionQuantity'
  );
  assert.ok(accesses.includes('lensState.draft.fieldMeta.quantity?.dirty'));
  assert.ok(accesses.includes('lensState.draft.settings.quantity'));
  assert.ok(accesses.includes('submissionRecipe?.delivery.quantity'));
});

test('the signed deliverable carries that derived quantity', () => {
  assert.ok(
    propertyValues(composerHome, 'quantity').includes('submissionQuantity')
  );
});

test('the quota pre-check counts the same value the signature carries', () => {
  const call = callArgumentObjects(
    composerHome,
    'composerQuotaRequirements'
  )[0];
  assert.ok(
    call,
    'composer-home must still pre-check through composerQuotaRequirements'
  );
  assert.equal(call.quantity, 'submissionQuantity');
  assert.notEqual(call.quantity, 'lensState.draft.settings.quantity');
});

test('the server bills off the signed deliverable quantity', () => {
  assert.ok(
    propertyAccesses(quoteAuthority).includes(
      'input.submission?.deliverable.quantity'
    )
  );
  assert.ok(
    literals(quoteAuthority).includes(
      'quantity must match the signed deliverable quantity.'
    )
  );
  assert.ok(identifiers(quoteAuthority).has('quantity'));
});
