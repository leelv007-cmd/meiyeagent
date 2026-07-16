import { createAuth } from '@/auth/auth';
import { getDb } from '@/db';
import { payment } from '@/db/app.schema';
import { resolveActiveWorkspace } from '@/db/workspaces';
import { findPlanByPriceId } from '@/lib/price-plan';
import { settleVerifiedProStudioPurchase } from '@/payment';
import { PostgresProStudioCommerceStore } from '@/payment/postgres-pro-studio-commerce';
import {
  createProStudioCheckout,
  resolveProStudioAddOnOffer,
} from '@/payment/pro-studio-commerce';
import { normalizeStripeVerifiedPaymentEvent } from '@/payment/verified-webhook-event';
import { createFileRoute } from '@tanstack/react-router';

const TEST_API_SECRET = 'mkfast-e2e-secret';
const FIXTURE_WEBHOOK_SECRET = 'mkfast-e2e-pro-studio-webhook-secret';

export const Route = createFileRoute('/api/e2e/pro-studio-payment')({
  server: {
    handlers: {
      POST: async ({ request }) => handleFixtureWebhook(request),
    },
  },
});

async function handleFixtureWebhook(request: Request) {
  if (
    import.meta.env.DEV !== true ||
    import.meta.env.MODE !== 'e2e' ||
    request.headers.get('x-e2e-secret') !== TEST_API_SECRET
  ) {
    return Response.json({ error: 'Not Found' }, { status: 404 });
  }
  const payload = await request.text();
  if (
    !(await hasValidSignature(
      payload,
      request.headers.get('x-e2e-webhook-signature')
    ))
  ) {
    return Response.json({ error: 'Invalid signature' }, { status: 401 });
  }
  const event = normalizeStripeVerifiedPaymentEvent(
    JSON.parse(payload) as unknown
  );
  if (!event) {
    return Response.json({ error: 'Invalid event' }, { status: 400 });
  }
  const current = await createAuth().api.getSession({
    headers: request.headers,
  });
  if (!current?.user?.id || !current.user.emailVerified) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const workspace = await resolveActiveWorkspace(current.user.id);
  if (!workspace || workspace.role !== 'owner') {
    return Response.json({ error: 'Owner required' }, { status: 403 });
  }
  const offer = resolveProStudioAddOnOffer(process.env, {
    findPlanByPriceId,
  });
  const db = getDb();
  const store = new PostgresProStudioCommerceStore(db);
  await createProStudioCheckout(
    {
      customerEmail: current.user.email,
      customerName: current.user.name,
      ownerSessionId: current.session.id,
      ownerUserId: current.user.id,
      workspaceId: workspace.id,
    },
    {
      offer,
      provider: {
        name: 'stripe',
        async createCheckout() {
          return {
            id: event.reference.id,
            url: 'https://fixture.invalid/pro-studio-checkout',
          };
        },
        async validateServerCatalogOffer(catalogOffer) {
          if (
            catalogOffer.offerId !== offer.offerId ||
            catalogOffer.price.priceId !== offer.price.priceId ||
            catalogOffer.price.amount !== offer.price.amount ||
            catalogOffer.price.currency !== offer.price.currency ||
            catalogOffer.price.type !== 'one_time'
          ) {
            throw new Error('Fixture catalog mismatch.');
          }
        },
      },
      store,
      urls: {
        cancelUrl: 'https://fixture.invalid/cancel',
        successUrl: 'https://fixture.invalid/success',
      },
    }
  );
  await db.insert(payment).values({
    createdAt: new Date(),
    customerId: `e2e-customer-${current.user.id}`,
    id: `e2e-payment-${event.providerEventId}`,
    interval: offer.price.interval,
    paid: true,
    priceId: offer.price.priceId,
    sessionId: event.reference.id,
    status: 'completed',
    type: offer.price.type,
    updatedAt: new Date(),
    userId: current.user.id,
  });
  const result = await settleVerifiedProStudioPurchase(event);
  return Response.json(result, {
    headers: { 'cache-control': 'no-store' },
    status: result.status === 'activated' ? 200 : 409,
  });
}

async function hasValidSignature(payload: string, signature: string | null) {
  if (!signature || !/^[a-f0-9]{64}$/u.test(signature)) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(FIXTURE_WEBHOOK_SECRET),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign']
  );
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  const actual = new Uint8Array(digest);
  const expected = Uint8Array.from(signature.match(/../gu) ?? [], (part) =>
    Number.parseInt(part, 16)
  );
  if (actual.byteLength !== expected.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < actual.byteLength; index += 1) {
    difference |= (actual[index] ?? 0) ^ (expected[index] ?? 0);
  }
  return difference === 0;
}
