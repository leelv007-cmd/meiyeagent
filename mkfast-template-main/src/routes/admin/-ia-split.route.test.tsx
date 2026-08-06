/**
 * Spec G / #388 — IA split: refund review + sensitive-words remount.
 * Source-level route/nav assertions (no browser, no PG).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  ADMIN_NAV_GROUPS,
  ADMIN_SIDEBAR_ITEMS,
} from '@/config/sidebar-config';
import { Routes } from '@/lib/routes';

const here = dirname(fileURLToPath(import.meta.url));

function readAdminRoute(name: string) {
  return readFileSync(resolve(here, name), 'utf8');
}

test('Spec G / #388: refund review mounts on commerce page, not audit', () => {
  const refund = readAdminRoute('refund-review.tsx');
  const audit = readAdminRoute('audit.tsx');

  assert.match(
    refund,
    /import \{ AdminPaymentRefundReview \} from '@\/p1\/admin-payment-refund-review'/
  );
  assert.match(refund, /<AdminPaymentRefundReview \/>/);
  assert.equal(Routes.AdminRefundReview, '/admin/refund-review');

  assert.doesNotMatch(audit, /AdminPaymentRefundReview/);
  assert.doesNotMatch(audit, /admin-payment-refund-review/);
});

test('Spec G / #388: sensitive-words CRUD mounts on governance page, not templates', () => {
  const sensitive = readAdminRoute('sensitive-words.tsx');
  const templates = readAdminRoute('templates.tsx');

  assert.match(
    sensitive,
    /import \{ AdminSensitiveWordsControl \} from '@\/p1\/admin-sensitive-words-control'/
  );
  assert.match(sensitive, /<AdminSensitiveWordsControl \/>/);
  assert.equal(Routes.AdminSensitiveWords, '/admin/sensitive-words');

  assert.doesNotMatch(templates, /AdminSensitiveWordsControl/);
  assert.doesNotMatch(templates, /admin-sensitive-words-control/);
});

test('Spec G / #388: #384 gate alert remains on audit (not the CRUD control)', () => {
  const audit = readAdminRoute('audit.tsx');
  assert.match(
    audit,
    /import \{ AdminSensitiveWordsGateAlert \} from '@\/p1\/admin-sensitive-words-gate-alert'/
  );
  assert.match(audit, /<AdminSensitiveWordsGateAlert \/>/);
  assert.doesNotMatch(audit, /AdminSensitiveWordsControl/);
});

test('Spec G / #388: six-domain nav places refund under commerce, sensitive-words under ops-governance', () => {
  const byId = new Map(
    ADMIN_SIDEBAR_ITEMS.map((item) => [item.id, item] as const)
  );

  const refund = byId.get('refund-review');
  assert.ok(refund);
  assert.equal(refund.href, Routes.AdminRefundReview);

  const sensitive = byId.get('sensitive-words');
  assert.ok(sensitive);
  assert.equal(sensitive.href, Routes.AdminSensitiveWords);

  const commerce = ADMIN_NAV_GROUPS.find((g) => g.id === 'account-commerce');
  assert.ok(commerce);
  assert.ok(
    commerce.items.some(
      (item) =>
        item.id === 'refund-review' && item.href === Routes.AdminRefundReview
    )
  );
  assert.equal(
    commerce.items.some((item) => item.id === 'sensitive-words'),
    false
  );

  const ops = ADMIN_NAV_GROUPS.find((g) => g.id === 'ops-governance');
  assert.ok(ops);
  assert.ok(
    ops.items.some(
      (item) =>
        item.id === 'sensitive-words' &&
        item.href === Routes.AdminSensitiveWords
    )
  );
  assert.equal(
    ops.items.some((item) => item.id === 'refund-review'),
    false
  );

  const content = ADMIN_NAV_GROUPS.find((g) => g.id === 'content-assets');
  assert.ok(content);
  assert.equal(
    content.items.some((item) => item.id === 'sensitive-words'),
    false
  );
});

test('Spec G / #388: old pages no longer own the remounted write controls in routeTree', () => {
  const tree = readFileSync(resolve(here, '../../routeTree.gen.ts'), 'utf8');
  assert.match(tree, /\/admin\/refund-review/);
  assert.match(tree, /\/admin\/sensitive-words/);
  assert.match(tree, /AdminRefundReviewRoute/);
  assert.match(tree, /AdminSensitiveWordsRoute/);
});
