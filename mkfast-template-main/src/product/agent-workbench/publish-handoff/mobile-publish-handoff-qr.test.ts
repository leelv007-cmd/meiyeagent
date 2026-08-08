/**
 * QR payload resolution for MobilePublishHandoff.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveQrPayload } from './mobile-publish-handoff-qr';

test('resolveQrPayload keeps absolute URLs', () => {
  assert.equal(
    resolveQrPayload('https://app.example/dashboard/handoff/tok'),
    'https://app.example/dashboard/handoff/tok',
  );
});

test('resolveQrPayload absolutizes relative handoff paths', () => {
  assert.equal(
    resolveQrPayload('/dashboard/handoff/tok', 'https://shop.example'),
    'https://shop.example/dashboard/handoff/tok',
  );
});
