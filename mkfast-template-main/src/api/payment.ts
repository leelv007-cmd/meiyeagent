import { getDb } from '@/db';
import { payment } from '@/db/app.schema';
import { user } from '@/db/auth.schema';
import { resolveActiveWorkspace } from '@/db/workspaces';
import { getLocale } from '@/lib/locale';
import {
  findPlanByPlanId,
  findPlanByPriceId,
  findPriceInPlan,
  getAllPricePlans,
} from '@/lib/price-plan';
import { Routes } from '@/lib/routes';
import { getCanonicalUrl } from '@/lib/urls';
import {
  authApiMiddleware,
  recentAuthApiMiddleware,
} from '@/middlewares/auth-middleware';
import { projectCurrentPlan } from './payment-current-plan';
import { createCheckout, createCustomerPortal } from '@/payment';
import {
  createCheckoutInputSchema,
  portalInputSchema,
  requireSellableCheckoutPrice,
  StripeNewCommerceRetiredError,
} from '@/payment/checkout-policy';
import { PostgresPlanCheckoutBindingStore } from '@/payment/plan-checkout-bindings';
import { requireCheckoutWorkspaceBinding } from '@/payment/plan-commerce';
import type {
  PaymentStatus,
  PlanInterval,
  PricePlan,
  Subscription,
} from '@/payment/types';
import { PaymentScenes, PaymentTypes } from '@/payment/types';
import { websiteConfig } from '@/config/website';
import { createServerFn } from '@tanstack/react-start';
import { and, desc, eq, or } from 'drizzle-orm';
import { z } from 'zod';

const checkoutCatalog = { findPlanByPlanId, findPriceInPlan };
const checkoutInputSchema = createCheckoutInputSchema(checkoutCatalog);

export const createCheckoutSession = createServerFn({ method: 'POST' })
  .inputValidator(checkoutInputSchema)
  .middleware([authApiMiddleware])
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const provider = websiteConfig.payment?.provider;
    if (!provider) throw new Error('Payment provider is required.');
    if (provider === 'stripe') throw new StripeNewCommerceRetiredError();
    const { price, plan: pricePlan } = requireSellableCheckoutPrice(
      data,
      checkoutCatalog
    );
    const db = getDb();
    const [userRow] = await db
      .select({ email: user.email, name: user.name })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    if (!userRow?.email) throw new Error('User email not found');
    const { planId, metadata } = data;
    const priceId = price.priceId;
    const locale = getLocale();
    const billingUrl = getCanonicalUrl(Routes.SettingsBilling);
    const cancel = billingUrl;
    const success = billingUrl;

    // Tc-1: bind plan checkout to an owner workspace before provider session.
    const workspace =
      data.workspaceId != null
        ? { id: data.workspaceId }
        : await resolveActiveWorkspace(userId);
    if (!workspace)
      throw new Error('Workspace not found for checkout binding.');
    const bound = requireCheckoutWorkspaceBinding({
      userId,
      workspaceId: workspace.id,
    });
    const bindingStore = new PostgresPlanCheckoutBindingStore(db);
    const binding = await bindingStore.createOwnerBinding({
      provider,
      priceId,
      paymentType: price.type,
      interval: pricePlan.isLifetime ? 'lifetime' : (price.interval ?? null),
      workspaceId: bound.workspaceId,
      ownerUserId: bound.userId,
    });
    if (!binding) {
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

export const getCurrentPlan = createServerFn({ method: 'GET' })
  .middleware([authApiMiddleware])
  .handler(async ({ context }) => {
    const { userId } = context;
    const db = getDb();
    const plans = getAllPricePlans();
    const freePlan = plans.find((p) => p.isFree && !p.disabled) ?? null;
    const lifetimePlanIds = plans.filter((p) => p.isLifetime).map((p) => p.id);

    const payments = await db
      .select({
        id: payment.id,
        priceId: payment.priceId,
        customerId: payment.customerId,
        type: payment.type,
        status: payment.status,
        scene: payment.scene,
        interval: payment.interval,
        periodStart: payment.periodStart,
        periodEnd: payment.periodEnd,
        cancelAtPeriodEnd: payment.cancelAtPeriodEnd,
        trialStart: payment.trialStart,
        trialEnd: payment.trialEnd,
        createdAt: payment.createdAt,
      })
      .from(payment)
      .where(
        and(
          eq(payment.paid, true),
          eq(payment.userId, userId),
          or(
            and(
              eq(payment.type, PaymentTypes.ONE_TIME),
              eq(payment.scene, PaymentScenes.LIFETIME),
              eq(payment.status, 'completed')
            ),
            and(
              eq(payment.type, PaymentTypes.SUBSCRIPTION),
              or(eq(payment.status, 'active'), eq(payment.status, 'trialing'))
            )
          )
        )
      )
      .orderBy(desc(payment.createdAt));

    let userLifetimePlan: PricePlan | null = null;
    let activeSubscription: Subscription | null = null;

    for (const rec of payments) {
      if (
        rec.type === PaymentTypes.ONE_TIME &&
        rec.scene === PaymentScenes.LIFETIME &&
        rec.status === 'completed' &&
        !userLifetimePlan
      ) {
        const plan = findPlanByPriceId(rec.priceId);
        if (plan && lifetimePlanIds.includes(plan.id)) {
          userLifetimePlan = plan as PricePlan;
        }
      }
      if (
        !userLifetimePlan &&
        rec.type === PaymentTypes.SUBSCRIPTION &&
        (rec.status === 'active' || rec.status === 'trialing') &&
        !activeSubscription
      ) {
        activeSubscription = {
          id: rec.id,
          priceId: rec.priceId,
          customerId: rec.customerId,
          status: rec.status as PaymentStatus,
          type: rec.type as 'subscription',
          interval: rec.interval as PlanInterval | undefined,
          currentPeriodStart: rec.periodStart ?? undefined,
          currentPeriodEnd: rec.periodEnd ?? undefined,
          cancelAtPeriodEnd: rec.cancelAtPeriodEnd ?? false,
          trialStartDate: rec.trialStart ?? undefined,
          trialEndDate: rec.trialEnd ?? undefined,
          createdAt: rec.createdAt,
        };
      }
    }

    if (userLifetimePlan) {
      return {
        currentPlan: projectCurrentPlan(userLifetimePlan),
        subscription: null,
      };
    }
    if (activeSubscription) {
      const subscriptionPlan =
        plans.find((p) =>
          p.prices.some((pr) => pr.priceId === activeSubscription!.priceId)
        ) ?? null;
      return {
        currentPlan: projectCurrentPlan(subscriptionPlan),
        subscription: activeSubscription,
      };
    }
    return {
      currentPlan: projectCurrentPlan(freePlan),
      subscription: null,
    };
  });

const checkCompletionSchema = z.object({ sessionId: z.string().min(1) });

/**
 * Check payment completion by Stripe session ID.
 * Used by Stripe flow where the session ID is embedded in the redirect URL.
 */
export const checkPaymentCompletion = createServerFn({ method: 'GET' })
  .inputValidator(checkCompletionSchema)
  .middleware([authApiMiddleware])
  .handler(async ({ data, context }) => {
    const db = getDb();
    const [record] = await db
      .select()
      .from(payment)
      .where(
        and(
          eq(payment.sessionId, data.sessionId),
          eq(payment.userId, context.userId)
        )
      )
      .limit(1);
    return { isPaid: !!record?.paid };
  });
