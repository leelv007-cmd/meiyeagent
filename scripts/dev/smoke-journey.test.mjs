import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REGISTER_GIFT_CREDITS,
  availableCreditsFromProjection,
  confirmationReached,
  cookieHeader,
  mergeCookies,
  parseSetCookieHeaders,
  stableJsonHash,
} from './smoke-journey.mjs';

test('cookie jar keeps session cookies from Set-Cookie', () => {
  const headers = {
    getSetCookie: () => [
      'better-auth.session_token=abc; Path=/; HttpOnly',
      'other=xyz; Path=/',
    ],
  };
  const cookies = parseSetCookieHeaders(headers);
  assert.equal(cookies.get('better-auth.session_token'), 'abc');
  assert.equal(
    cookieHeader(mergeCookies(new Map(), cookies)),
    'better-auth.session_token=abc; other=xyz',
  );
});

test('available credits read the merchant projection', () => {
  assert.equal(
    availableCreditsFromProjection({
      data: { credits: { availableCredits: REGISTER_GIFT_CREDITS } },
    }),
    100,
  );
  assert.equal(availableCreditsFromProjection({}), null);
});

test('confirmation detector recognizes execution confirmation payloads', () => {
  assert.equal(
    confirmationReached({ kind: 'execution_confirmation', requestId: 'req-1' }),
    true,
  );
  assert.equal(
    confirmationReached({
      data: {
        makeReady: true,
        task: { id: 'task-1' },
        usageReservation: { id: 'usage-1' },
        work: { id: 'work-1' },
      },
    }),
    true,
  );
  assert.equal(confirmationReached({ status: 'ok' }), false);
});

test('quote identity hash is order-independent', () => {
  assert.equal(
    stableJsonHash({ b: 1, a: 2 }),
    stableJsonHash({ a: 2, b: 1 }),
  );
});
