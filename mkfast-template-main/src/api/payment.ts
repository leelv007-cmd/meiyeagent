import { getDb } from '@/db';
import { user } from '@/db/auth.schema';
import {
  resolveActiveWorkspace,
  resolveWorkspaceMembership,
} from '@/db/workspaces';
import { getLocale } from '@/lib/locale';
import { ensureVerifiedWorkspaceProvisioned } from '@/lib/auth/workspace-provisioning';
import { serverEnv } from '@/env/server';
import {
  findPlanByPlanId,
  findPlanByPriceId,
  findPriceInPlan,
} from '@/lib/price-plan';
import { Routes } from '@/lib/routes';
import { getCanonicalUrl } from '@/lib/urls';
import {
  authApiMiddleware,
  recentAuthApiMiddleware,
} from '@/middlewares/auth-middleware';
import {
  createCheckout,
  createCreditPackageCheckout,
  createCustomerPortal,
  readWaffoCreditPackageProductFacts,
} from '@/payment';
import {
  createCheckoutInputSchema,
  requireWaffoTestCheckoutAuthority,
  portalInputSchema,
  requireSellableCheckoutPrice,
  StripeNewCommerceRetiredError,
} from '@/payment/checkout-policy';
import { PostgresPlanCheckoutBindingStore } from '@/payment/plan-checkout-bindings';
import { PostgresCreditPackageCheckoutBindingStore } from '@/payment/credit-package-checkout-bindings';
import {
  classifyWaffoPlanChange,
  requireCheckoutWorkspaceBinding,
  WaffoCheckoutAlreadyActiveError,
  WaffoNextCycleChangeUnavailableError,
} from '@/payment/plan-commerce';
import {
  resolveWaffoCreditPackageProduct,
  snapshotWaffoCreditPackageAddOn,
} from '@/payment/waffo-credit-package-catalog';
import { fetchPublicPlanCatalog } from './plan-catalog';
import { websiteConfig } from '@/config/website';
import { createServerFn } from '@tanstack/react-start';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

const checkoutCatalog = { findPlanByPlanId, findPriceInPlan };
const checkoutInputSchema = createCheckoutInputSchema(checkoutCatalog);
const creditPackageCheckoutInputSchema = z
  .object({
    offerId: z.string().trim().min(1),
    workspaceId: z.string().min(1).optional(),
  })
  .strict();

export const createCheckoutSession = createServerFn({ method: 'POST' })
  .inputValidator(checkoutInputSchema)
  .middleware([authApiMiddleware])
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const provider = websiteConfig.payment?.provider;
    if (!provider) throw new Error('Payment provider is required.');
    if (provider === 'stripe') throw new StripeNewCommerceRetiredError();
    if (provider === 'waffo') {
      requireWaffoTestCheckoutAuthority(serverEnv.WAFFO_ENVIRONMENT);
    }
    const { price, plan: pricePlan } = requireSellableCheckoutPrice(
      data,
      checkoutCatalog
    );
    const db = getDb();
    const [userRow] = await db
      .select({
        email: user.email,
        emailVerified: user.emailVerified,
        name: user.name,
      })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    if (!userRow?.email || userRow.emailVerified !== true) {
      throw new Error('Verified user identity is required for checkout.');
    }
    const { planId, metadata } = data;
    const priceId = price.priceId;
    const locale = getLocale();
    const billingUrl = getCanonicalUrl(Routes.SettingsBilling);
    const cancel = billingUrl;
    const success = billingUrl;

    // Tc-1: bind plan checkout to an owner workspace before provider session.
    const workspace =
      data.workspaceId != null
        ? await resolveWorkspaceMembership(userId, data.workspaceId)
        : await resolveActiveWorkspace(userId);
    if (!workspace || workspace.role !== 'owner')
      throw new Error('Workspace not found for checkout binding.');
    await ensureVerifiedWorkspaceProvisioned({
      coreServiceToken: serverEnv.CORE_SERVICE_TOKEN,
      coreServiceUrl: serverEnv.CORE_SERVICE_URL,
      database: db,
      ownerUserId: userId,
      workspaceId: workspace.id,
    });
    const bound = requireCheckoutWorkspaceBinding({
      userId,
      workspaceId: workspace.id,
    });
    const bindingStore = new PostgresPlanCheckoutBindingStore(db);
    const requestedInterval = pricePlan.isLifetime
      ? null
      : (pricePlan.prices.find((candidate) => candidate.priceId === priceId)
          ?.interval ?? null);
    let replacesSubscriptionId: string | null = null;
    if (provider === 'waffo' && requestedInterval) {
      await bindingStore.releaseStaleWaffoBindings({
        ownerUserId: bound.userId,
        workspaceId: bound.workspaceId,
      });
      const current = await bindingStore.findCurrentWaffoSubscription({
        ownerUserId: bound.userId,
        workspaceId: bound.workspaceId,
      });
      const currentPlan = current ? findPlanByPriceId(current.priceId) : null;
      const decision = classifyWaffoPlanChange({
        current: current
          ? {
              planId: currentPlan?.id ?? '',
              interval: current.interval,
            }
          : null,
        requested: { planId, interval: requestedInterval },
      });
      if (decision === 'defer_next_cycle' && current) {
        await bindingStore.recordWaffoSubscriptionChange({
          effectiveAt:
            current.periodEnd instanceof Date
              ? current.periodEnd.toISOString()
              : (current.periodEnd ?? new Date().toISOString()),
          ownerUserId: bound.userId,
          subscriptionId: current.subscriptionId,
          targetInterval: requestedInterval,
          targetPriceId: priceId,
          workspaceId: bound.workspaceId,
        });
        throw new WaffoNextCycleChangeUnavailableError();
      }
      if (decision === 'duplicate') {
        throw new WaffoCheckoutAlreadyActiveError();
      }
      if (decision === 'upgrade') {
        replacesSubscriptionId = current?.subscriptionId ?? null;
      }
      if (
        await bindingStore.hasPendingWaffoBinding({
          interval: requestedInterval,
          ownerUserId: bound.userId,
          priceId,
          replacesSubscriptionId,
          workspaceId: bound.workspaceId,
        })
      ) {
        throw new WaffoCheckoutAlreadyActiveError();
      }
    }
    const binding = await bindingStore.createOwnerBinding({
      provider,
      priceId,
      paymentType: price.type,
      interval: pricePlan.isLifetime ? 'lifetime' : requestedInterval,
      workspaceId: bound.workspaceId,
      ownerUserId: bound.userId,
      replacesSubscriptionId,
    });
    if (!binding) {
      // The unique in-flight index absorbs a concurrent duplicate insert;
      // losing that race is a duplicate checkout, not a membership failure.
      if (
        provider === 'waffo' &&
        (await bindingStore.hasPendingWaffoBinding({
          interval: pricePlan.isLifetime ? null : requestedInterval,
          ownerUserId: bound.userId,
          priceId,
          replacesSubscriptionId,
          workspaceId: bound.workspaceId,
        }))
      ) {
        throw new WaffoCheckoutAlreadyActiveError();
      }
      throw new Error(
        'Plan checkout requires workspace owner membership for binding.'
      );
    }

    const checkoutMetadata = {
      ...metadata,
      userId,
      userName: userRow.name ?? '',
      workspaceId: bound.workspaceId,
      planCheckoutBindingId: binding.id,
    };

    try {
      const result = await createCheckout({
        planId,
        priceId,
        customerEmail: userRow.email,
        successUrl: success,
        cancelUrl: cancel,
        metadata: checkoutMetadata,
        locale,
      });
      await bindingStore.attachProviderCheckout({
        bindingId: binding.id,
        providerCheckoutId: result.id,
      });
      return { url: result.url, id: result.id };
    } catch (error) {
      await bindingStore.markCheckoutFailed(binding.id);
      throw error;
    }
  });

export const createCreditPackageCheckoutSession = createServerFn({
  method: 'POST',
})
  .inputValidator(creditPackageCheckoutInputSchema)
  .middleware([authApiMiddleware])
  .handler(async ({ data, context }) => {
    const { userId } = context;
    if (websiteConfig.payment?.provider !== 'waffo') {
      throw new Error('Credit package checkout requires Waffo.');
    }
    requireWaffoTestCheckoutAuthority(serverEnv.WAFFO_ENVIRONMENT);
    const productId = resolveWaffoCreditPackageProduct(
      data.offerId,
      serverEnv.WAFFO_CREDIT_PACKAGE_PRODUCT_MAPPING
    );
    const governedCatalog = await fetchPublicPlanCatalog();
    const governedOffer = governedCatalog.addOns.find(
      (candidate) => candidate.id === data.offerId
    );
    if (!governedOffer) {
      throw new Error(
        'Core credit package catalog does not contain the requested SKU.'
      );
    }
    const skuSnapshot = snapshotWaffoCreditPackageAddOn(governedOffer);
    const productFacts = await readWaffoCreditPackageProductFacts(productId);
    if (
      productFacts.status !== 'active' ||
      productFacts.productId !== productId ||
      productFacts.currency !== skuSnapshot.currency ||
      productFacts.amount !== (skuSnapshot.amountMicros / 1_000_000).toFixed(2)
    ) {
      throw new Error(
        'Waffo Test product facts drift from the governed SKU snapshot.'
      );
    }
    const productMetadata =
      typeof productFacts.metadata === 'string'
        ? (JSON.parse(productFacts.metadata) as Record<string, unknown>)
        : productFacts.metadata;
    if (
      productMetadata?.commerceSku !== data.offerId ||
      productMetadata.credits !== skuSnapshot.credits ||
      productMetadata.expireDays !== skuSnapshot.expireDays
    ) {
      throw new Error(
        'Waffo Test product SKU metadata does not match the governed SKU.'
      );
    }
    const db = getDb();
    const [userRow] = await db
      .select({
        email: user.email,
        emailVerified: user.emailVerified,
      })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    if (!userRow?.email || userRow.emailVerified !== true) {
      throw new Error('Verified user identity is required for checkout.');
    }
    const workspace =
      data.workspaceId != null
        ? await resolveWorkspaceMembership(userId, data.workspaceId)
        : await resolveActiveWorkspace(userId);
    if (!workspace || workspace.role !== 'owner') {
      throw new Error('Workspace not found for credit package checkout.');
    }
    await ensureVerifiedWorkspaceProvisioned({
      coreServiceToken: serverEnv.CORE_SERVICE_TOKEN,
      coreServiceUrl: serverEnv.CORE_SERVICE_URL,
      database: db,
      ownerUserId: userId,
      workspaceId: workspace.id,
    });
    const bound = requireCheckoutWorkspaceBinding({
      userId,
      workspaceId: workspace.id,
    });
    const bindingStore = new PostgresCreditPackageCheckoutBindingStore(db);
    await bindingStore.releaseStaleWaffoBindings({
      ownerUserId: bound.userId,
      workspaceId: bound.workspaceId,
    });
    const binding = await bindingStore.createOwnerBinding({
      offerId: data.offerId,
      ownerUserId: bound.userId,
      productId,
      provider: 'waffo',
      workspaceId: bound.workspaceId,
      skuSnapshot,
    });
    if (!binding) {
      throw new Error('Credit package checkout requires workspace ownership.');
    }

    let providerCheckoutCreated = false;
    try {
      const result = await createCreditPackageCheckout({
        buyerEmail: userRow.email,
        buyerIdentity: bound.userId,
        currency: skuSnapshot.currency,
        packageCheckoutBindingId: binding.id,
        productId,
        successUrl: getCanonicalUrl(Routes.SettingsBilling),
      });
      providerCheckoutCreated = true;
      await bindingStore.attachProviderCheckout({
        bindingId: binding.id,
        providerCheckoutId: result.id,
      });
      return { id: result.id, url: result.url };
    } catch (error) {
      if (!providerCheckoutCreated) {
        await bindingStore.markCheckoutFailed(binding.id);
      }
      throw error;
    }
  });

export const createCustomerPortalSession = createServerFn({ method: 'POST' })
  .inputValidator(portalInputSchema)
  .middleware([recentAuthApiMiddleware])
  .handler(async ({ data, context }) => {
    const { userId } = context;
    if (websiteConfig.payment?.provider === 'stripe') {
      throw new StripeNewCommerceRetiredError();
    }
    const db = getDb();
    const [row] = await db
      .select({ customerId: user.customerId })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    if (!row?.customerId) {
      throw new Error('No customer found for user');
    }
    const locale = getLocale();
    const returnUrl = getCanonicalUrl(Routes.SettingsBilling);
    const result = await createCustomerPortal({
      customerId: row.customerId,
      returnUrl,
      locale: data.locale ?? locale,
    });
    return { url: result.url };
  });
