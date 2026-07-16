import assert from 'node:assert/strict';
import test from 'node:test';
import { ProStudioCommerceError } from '@/payment/pro-studio-commerce';
import { handleProStudioCheckoutRequest } from './-checkout-handler';

const identity = {
  sessionId: 'session-1',
  userEmail: 'owner@example.test',
  userId: 'owner-1',
  userName: 'Owner',
};

test('dedicated checkout route accepts no browser payment facts and redirects an authenticated owner', async () => {
  let startedWith: unknown;
  const response = await handleProStudioCheckoutRequest(
    new Request('https://app.example/api/pro-studio/checkout', {
      body: 'workspaceId=forged&priceId=forged&paymentId=forged',
      method: 'POST',
    }),
    {
      async authenticate() {
        return identity;
      },
      async resolveWorkspace() {
        return { id: 'workspace-server' };
      },
      async start(input) {
        startedWith = input;
        return 'https://pay.example/checkout-1';
      },
    }
  );

  assert.equal(response.status, 303);
  assert.equal(
    response.headers.get('location'),
    'https://pay.example/checkout-1'
  );
  assert.deepEqual(startedWith, {
    ...identity,
    workspaceId: 'workspace-server',
  });
});

test('dedicated checkout route fails closed for anonymous, non-owner and unavailable commerce', async () => {
  const request = new Request('https://app.example/api/pro-studio/checkout', {
    method: 'POST',
  });
  const anonymous = await handleProStudioCheckoutRequest(request, {
    async authenticate() {
      return null;
    },
    async resolveWorkspace() {
      throw new Error('must not resolve');
    },
    async start() {
      throw new Error('must not start');
    },
  });
  assert.equal(anonymous.status, 401);

  for (const [code, status] of [
    ['OWNER_REQUIRED', 403],
    ['CHECKOUT_UNAVAILABLE', 503],
    ['ACTIVATION_PENDING', 409],
    ['ALREADY_PURCHASED', 409],
  ] as const) {
    const response = await handleProStudioCheckoutRequest(request, {
      async authenticate() {
        return identity;
      },
      async resolveWorkspace() {
        return { id: 'workspace-1' };
      },
      async start() {
        throw new ProStudioCommerceError(code, 'rejected');
      },
    });
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: code });
  }
});
