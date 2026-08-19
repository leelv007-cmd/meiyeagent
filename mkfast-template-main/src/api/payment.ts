import { getDb } from '@/db';
import { user } from '@/db/auth.schema';
import {
  resolveActiveWorkspace,
  resolveWorkspaceMembership,
} from '@/db/workspaces';
import { getLocale } from '@/lib/locale';
import { ensureVerifiedWorkspaceProvisioned } from '@/lib/auth/workspace-provisioning';
import { serverEnv } from '@/env/server';
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
  requireWaffoTestCheckoutAuthority,
  portalInputSchema,
  StripeNewCommerceRetiredError,
} from '@/payment/checkout-policy';
import {
  evaluateCommerceReadiness,
  executeCommerceReadyPlanCheckout,
} from '@/payment/commerce-readiness';
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
import { productionCommerceReadinessPorts } from './commerce-readiness';
import { websiteConfig } from '@/config/website';
import { createServerFn } from '@tanstack/react-start';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

const checkoutInputSchema = z
  .object({
    cycle: z.enum(['single_month', 'monthly', 'yearly']),
    metadata: z.record(z.string(), z.string()).optional(),
    planId: z.enum(['starter', 'growth', 'pro']),
    workspaceId: z.string().min(1).optional(),
  })
  .strict();
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
    requireWaffoTestCheckoutAuthority(serverEnv.WAFFO_ENVIRONMENT);
    return executeCommerceReadyPlanCheckout(
      { cycle: data.cycle, planId: data.planId },
      productionCommerceReadinessPorts(),
      async (selection) => {
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
        const priceId = selection.productId;
        const requestedInterval = selection.cycle;
        const locale = getLocale();
        const billingUrl = getCanonicalUrl(Routes.SettingsBilling);

        // Tc-1: bind plan checkout to an owner workspace before provider session.
        const workspace =
          data.workspaceId != null
            ? await resolveWorkspaceMembership(userId, data.workspaceId)
            : await resolveActiveWorkspace(userId);
        if (!workspace || workspace.role !== 'owner') {
          throw new Error('Workspace not found for checkout binding.');
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
        const bindingStore = new PostgresPlanCheckoutBindingStore(db);
        let replacesSubscriptionId: string | null = null;
        await bindingStore.releaseStaleWaffoBindings({
          ownerUserId: bound.userId,
          workspaceId: bound.workspaceId,
        });
        const current = await bindingStore.findCurrentWaffoSubscription({
          ownerUserId: bound.userId,
          workspaceId: bound.workspaceId,
        });
        const currentPlan = current
          ? selection.mappedProducts.find(
              (mapped) => mapped.paymentProductId === current.priceId
            )
          : null;
        if (current && !currentPlan) {
          throw new Error(
            'Current Waffo subscription is absent from the Core payment mapping.'
          );
        }
        const decision = classifyWaffoPlanChange({
          current: current
            ? {
                planId: currentPlan?.tier ?? '',
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
        const binding = await bindingStore.createOwnerBinding({
          provider,
          priceId,
          paymentType: 'subscription',
          interval: requestedInterval,
          workspaceId: bound.workspaceId,
          ownerUserId: bound.userId,
          replacesSubscriptionId,
        });
        if (!binding) {
          // The unique in-flight index absorbs a concurrent duplicate insert;
          // losing that race is a duplicate checkout, not a membership failure.
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
          throw new Error(
            'Plan checkout requires workspace owner membership for binding.'
          );
        }

        const checkoutMetadata = {
          ...metadata,
          commercePaymentMappingRevision: String(
            selection.paymentMappingRevision
          ),
          commercePlanRevision: selection.planRevision,
          userId,
          userName: userRow.name ?? '',
          workspaceId: bound.workspaceId,
          planCheckoutBindingId: binding.id,
        };

        try {
          const result = await createCheckout({
            commerceAuthority: {
              currency: selection.currency,
              paymentMappingRevision: selection.paymentMappingRevision,
              planRevision: selection.planRevision,
            },
            planId,
            priceId,
            customerEmail: userRow.email,
            successUrl: billingUrl,
            cancelUrl: billingUrl,
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
      }
    );
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
    const readiness = await evaluateCommerceReadiness(
      productionCommerceReadinessPorts()
    );
    if (!readiness.addOnCheckoutReady) {
      throw new Error('Commerce is not ready for credit package checkout.');
    }
    const productId = resolveWaffoCreditPackageProduct(
      data.offerId,
      serverEnv.WAFFO_CREDIT_PACKAGE_PRODUCT_MAPPING
    );
    const governedCatalog = readiness.catalog;
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
    const readiness = await evaluateCommerceReadiness(
      productionCommerceReadinessPorts()
    );
    if (!readiness.portalReady) {
      throw new Error('Commerce is not ready for customer portal access.');
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
