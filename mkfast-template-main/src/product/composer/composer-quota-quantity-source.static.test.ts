/**
 * S3 P0-1 — the pre-check and the bill count the same deliverables.
 *
 * The server bills off the *signed* deliverable quantity
 * (`server-quote-authority.ts` → `submission.deliverable.quantity`). The
 * front-end pre-check once read `lensState.draft.settings.quantity` instead,
 * which is only the lens default until the merchant dirties the field — so an
 * image_set recipe declaring 4 against an untouched draft of 1 pre-checked one
 * image and billed four. A merchant holding 1-3 images was waved through to a
 * guaranteed rejection: the exact defect the two-bucket pre-check exists to
 * kill, wearing a different hat.
 *
 * A behavioural test cannot prove the *absence* of a second quantity
 * expression, so this is a static assertion 門 (testing decision 9): one
 * derived value, `submissionQuantity`, reaches both the signature and the
 * pre-check, and the server reads that same field back.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

function read(relativePath: string) {
  return readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    'utf8'
  );
}

const composerHome = read('./composer-home.tsx');
const quoteAuthority = read(
  '../../../../apps/core/src/p1/product-billing/server-quote-authority.ts'
);

/** The `composerQuotaRequirements({...})` argument object, braces included. */
function quotaRequirementsCall() {
  const start = composerHome.indexOf('composerQuotaRequirements({');
  assert.notEqual(
    start,
    -1,
    'composer-home must still pre-check through composerQuotaRequirements'
  );
  const end = composerHome.indexOf('})', start);
  return composerHome.slice(start, end);
}

test('the quantity is derived once, from the recipe unless the merchant edited it', () => {
  assert.match(
    composerHome,
    /const submissionQuantity =\s*\(lensState\.draft\.fieldMeta\.quantity\?\.dirty\s*\? lensState\.draft\.settings\.quantity\s*: submissionRecipe\?\.delivery\.quantity\)/u,
    'an untouched quantity belongs to the recipe, not to the lens default'
  );
});

test('the signed deliverable carries that derived quantity', () => {
  assert.match(
    composerHome,
    /deliverable: \{\s*kind: submissionDelivery\.deliverableKind,\s*quantity: submissionQuantity,/u
  );
});

test('the quota pre-check counts the same value the signature carries', () => {
  const call = quotaRequirementsCall();
  assert.match(
    call,
    /quantity: submissionQuantity,/u,
    'P0-1: pre-check from the signed quantity, not from the draft setting'
  );
  assert.doesNotMatch(
    call,
    /lensState\.draft\.settings\.quantity/u,
    'the draft setting is the lens default until dirtied — it is not what gets billed'
  );
});

test('the server bills off the signed deliverable quantity', () => {
  assert.match(
    quoteAuthority,
    /const quantity =\s*input\.submission\?\.deliverable\.quantity \?\? input\.quantity \?\? 1;/u,
    'the other end of the seam: if this moves, the mirror above must move with it'
  );
  // And it rejects any caller that tries to bill a different number than it signed.
  assert.match(
    quoteAuthority,
    /'quantity must match the signed deliverable quantity\.'/u
  );
});
