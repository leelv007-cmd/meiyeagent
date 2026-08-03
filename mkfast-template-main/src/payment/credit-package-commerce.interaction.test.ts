import { describe, expect, it, vi } from 'vitest';
import {
  creditPackageSettlementIntentFromEvent,
  settleVerifiedCreditPackagePurchase,
  type CreditPackageCheckoutBindingFacts,
} from './credit-package-commerce';
import type { VerifiedPaymentWebhookEvent } from './types';

const binding: CreditPackageCheckoutBindingFacts = {
  id: 'cpb_001',
  offerId: 'credits-300',
  ownerUserId: 'user_001',
  productId: 'PROD_CREDITS_300',
  workspaceId: 'workspace_001',
};

const completedOrder = {
  amount: '161.00',
  buyerIdentity: binding.ownerUserId,
  currency: 'HKD',
  eventType: 'credit_package.completed',
  packageCheckoutBindingId: binding.id,
  provider: 'waffo',
  providerDeliveryId: 'waffo-delivery-001',
  providerEventId: 'waffo-payment-001',
  reference: { id: 'waffo-order-001', kind: 'order' },
  scene: 'credit_package',
} satisfies VerifiedPaymentWebhookEvent;

describe('credit package commerce', () => {
  it('maps a bound Waffo one-time order to the Core add-on grant contract', async () => {
    const intent = creditPackageSettlementIntentFromEvent(
      completedOrder,
      binding
    );

    expect(intent).toEqual({
      offerId: 'credits-300',
      ownerUserId: 'user_001',
      paymentEventId: 'waffo:order:waffo-order-001',
      workspaceId: 'workspace_001',
    });

    const grantAddOn = vi.fn();
    await expect(
      settleVerifiedCreditPackagePurchase(completedOrder, {
        grantAddOn,
        claimSettlement: vi.fn().mockResolvedValue({
          binding,
          claimToken: 'claim-001',
          status: 'claimed',
        }),
        completeSettlement: vi.fn(),
        validateBinding: vi.fn(),
      })
    ).resolves.toEqual(intent);
    expect(grantAddOn).toHaveBeenCalledExactlyOnceWith(intent);
  });

  it('checkpoints the binding only after the idempotent Core grant succeeds', async () => {
    const order: string[] = [];
    const grantAddOn = vi.fn(async () => {
      order.push('grant');
    });
    const completeSettlement = vi.fn(async () => {
      order.push('checkpoint');
    });
    const ports = {
      grantAddOn,
      claimSettlement: vi.fn().mockResolvedValue({
        binding,
        claimToken: 'claim-001',
        status: 'claimed',
      }),
      completeSettlement,
      validateBinding: vi.fn(),
    };

    await settleVerifiedCreditPackagePurchase(completedOrder, ports);

    expect(completeSettlement).toHaveBeenCalledExactlyOnceWith({
      bindingId: binding.id,
      claimToken: 'claim-001',
    });
    expect(order).toEqual(['grant', 'checkpoint']);
  });

  it('uses the provider order as the canonical grant key and does not re-grant a settled order', async () => {
    const claimSettlement = vi
      .fn()
      .mockResolvedValueOnce({
        binding,
        claimToken: 'claim-001',
        status: 'claimed',
      })
      .mockResolvedValueOnce({ binding, status: 'duplicate' });
    const completeSettlement = vi.fn();
    const grantAddOn = vi.fn();
    const ports = {
      claimSettlement,
      completeSettlement,
      grantAddOn,
      validateBinding: vi.fn(),
    };

    const first = await settleVerifiedCreditPackagePurchase(
      completedOrder,
      ports
    );
    const replay = await settleVerifiedCreditPackagePurchase(
      {
        ...completedOrder,
        providerDeliveryId: 'waffo-delivery-replayed',
        providerEventId: 'waffo-payment-replayed',
      },
      ports
    );

    expect(first).toEqual({
      offerId: 'credits-300',
      ownerUserId: 'user_001',
      paymentEventId: 'waffo:order:waffo-order-001',
      workspaceId: 'workspace_001',
    });
    expect(replay).toEqual(first);
    expect(grantAddOn).toHaveBeenCalledExactlyOnceWith(first);
    expect(completeSettlement).toHaveBeenCalledExactlyOnceWith({
      bindingId: 'cpb_001',
      claimToken: 'claim-001',
    });
  });

  it('does not grant an order whose signed package facts fail catalog validation', async () => {
    const validateBinding = vi.fn(() => {
      throw new Error('credit package amount does not match the Test catalog');
    });
    const grantAddOn = vi.fn();
    const completeSettlement = vi.fn();

    await expect(
      settleVerifiedCreditPackagePurchase(completedOrder, {
        claimSettlement: vi.fn().mockResolvedValue({
          binding,
          claimToken: 'claim-invalid-catalog',
          status: 'claimed',
        }),
        completeSettlement,
        grantAddOn,
        validateBinding,
      } as never)
    ).rejects.toThrow('does not match the Test catalog');

    expect(validateBinding).toHaveBeenCalledExactlyOnceWith(
      completedOrder,
      binding
    );
    expect(grantAddOn).not.toHaveBeenCalled();
    expect(completeSettlement).not.toHaveBeenCalled();
  });

  it('does not route subscription lifecycle events through add-on settlement', async () => {
    const subscriptionEvent = {
      ...completedOrder,
      eventType: 'subscription.renewed',
      reference: { id: 'waffo-order-001', kind: 'subscription' },
    } as VerifiedPaymentWebhookEvent;
    const claimSettlement = vi.fn();
    const grantAddOn = vi.fn();

    await expect(
      settleVerifiedCreditPackagePurchase(subscriptionEvent, {
        grantAddOn,
        claimSettlement,
        completeSettlement: vi.fn(),
        validateBinding: vi.fn(),
      })
    ).resolves.toBeNull();
    expect(claimSettlement).not.toHaveBeenCalled();
    expect(grantAddOn).not.toHaveBeenCalled();
  });

  it('leaves an unbound one-time order pending for durable retry', async () => {
    const grantAddOn = vi.fn();
    await expect(
      settleVerifiedCreditPackagePurchase(completedOrder, {
        grantAddOn,
        claimSettlement: vi.fn().mockResolvedValue(null),
        completeSettlement: vi.fn(),
        validateBinding: vi.fn(),
      })
    ).resolves.toBeNull();
    expect(grantAddOn).not.toHaveBeenCalled();
  });
});
