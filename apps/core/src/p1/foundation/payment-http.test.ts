import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { createCoreServer } from '../../server.js';
import { P1ApplicationService } from './application-service.js';
import {
  ProductEntitlementApplicationService,
  RecordedAutoTopUpPaymentPort,
} from './entitlement-service.js';
import { ProductEntitlementFoundationModule } from './entitlement-module.js';
import { MemoryFoundationRepository } from './memory-repository.js';
import type {
  CreditBillingService,
  CreditPaymentSettlementInput,
} from '../credit-billing/credit-billing-service.js';

test('payment_grant preserves Waffo catalog intervals over HTTP', async (t) => {
  const repository = new MemoryFoundationRepository();
  repository.grantOwner('workspace-payment', 'owner-payment');
  const clock = () => new Date('2026-08-03T00:00:00.000Z');
  const entitlements = new ProductEntitlementApplicationService(
    repository,
    new RecordedAutoTopUpPaymentPort(),
    clock,
  );
  const received: CreditPaymentSettlementInput[] = [];
  const creditBilling = {
    async settlePayment(
      _context: unknown,
      input: CreditPaymentSettlementInput,
    ) {
      received.push(input);
      return null;
    },
  } as unknown as CreditBillingService;
  const server = createCoreServer({
    p1ApplicationService: new P1ApplicationService(repository, {
      operations: [
        new ProductEntitlementFoundationModule(entitlements, clock, {
          creditBilling,
        }),
      ],
    }),
    serviceToken: 'test-service-token',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());

  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}/v1/workspaces/workspace-payment/p1`;
  const intervals = ['single_month', 'monthly', 'yearly'] as const;

  for (const interval of intervals) {
    const response = await fetch(`${base}/commands`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': `waffo:${interval}`,
        'x-core-actor': 'payment',
        'x-correlation-id': `waffo-${interval}`,
        'x-service-token': 'test-service-token',
        'x-user-id': 'payment-service',
        'x-workspace-id': 'workspace-payment',
      },
      body: JSON.stringify({
        action: 'payment_grant',
        module: 'entitlements',
        payload: {
          interval,
          lifecycle: 'renew',
          paymentEventId: `waffo:${interval}`,
          paymentProductId: `PROD_${interval.toUpperCase()}`,
          paymentProvider: 'waffo',
          periodStartsAt: '2026-08-03T00:00:00.000Z',
          subscriptionId: `ORD_${interval}`,
        },
      }),
    });
    assert.equal(response.status, 200);
  }

  assert.deepEqual(
    received.map((input) => input.interval),
    intervals,
  );

  const paymentQueryDenied = await fetch(`${base}/query`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-core-actor': 'payment',
      'x-correlation-id': 'payment-query',
      'x-service-token': 'test-service-token',
      'x-user-id': 'payment-service',
      'x-workspace-id': 'workspace-payment',
    },
    body: JSON.stringify({
      action: 'projection',
      module: 'entitlements',
      payload: {},
    }),
  });
  assert.equal(paymentQueryDenied.status, 403);

  const ownerGrantDenied = await fetch(`${base}/commands`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': 'owner-forged-payment',
      'x-core-actor': 'owner',
      'x-correlation-id': 'owner-forged-payment',
      'x-service-token': 'test-service-token',
      'x-user-id': 'owner-payment',
      'x-workspace-id': 'workspace-payment',
      'x-workspace-role': 'owner',
    },
    body: JSON.stringify({
      action: 'payment_grant',
      module: 'entitlements',
      payload: {
        interval: 'monthly',
        lifecycle: 'renew',
        paymentEventId: 'waffo:owner-forged-payment',
        paymentProductId: 'PROD_MONTHLY',
        paymentProvider: 'waffo',
        periodStartsAt: '2026-08-03T00:00:00.000Z',
        subscriptionId: 'ORD_owner-forged-payment',
      },
    }),
  });
  assert.equal(ownerGrantDenied.status, 403);
});
