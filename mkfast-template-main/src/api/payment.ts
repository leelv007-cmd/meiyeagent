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
  requireWaffoTestCheckoutAuthority,
  portalInputSchema,
  StripeNewCommerceRetiredError,
} from '@/payment/checkout-policy';
import {
  evaluateCommerceReadiness,
  executeCommerceReadyAddOnCheckout,
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
import { snapshotWaffoCreditPackageAddOn } from '@/payment/waffo-credit-package-catalog';
import { websiteConfig } from '@/config/website';
import { createServerFn, createServerOnlyFn } from '@tanstack/react-start';
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

const loadPaymentRuntime = createServerOnlyFn(async () => {
  const [database, payment, commerceReadiness] = await Promise.all([
    import('@/db'),
    import('@/payment'),
    import('./commerce-readiness.server'),
  ]);
  return {
    ...database,
    ...payment,
    ...commerceReadiness,
  };
});

export const createCheckoutSession = createServerFn({ method: 'POST' })
  .inputValidator(checkoutInputSchema)
  .middleware([authApiMiddleware])
  .handler(async ({ data, context }) => {
    const { getDb, createCheckout, productionCommerceReadinessPorts } =
      await loadPaymentRuntime();
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
          commerceAuthority: {
            amountMicros: selection.amountMicros,
            billingPeriod: selection.cycle === 'yearly' ? 'yearly' : 'monthly',
            credits: selection.credits,
            currency: selection.currency,
            paymentMappingRevision: selection.paymentMappingRevision,
            period: selection.cycle,
            planRevision: selection.planRevision,
            tier: selection.planId,
          },
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
    const {
      getDb,
      createCreditPackageCheckout,
      productionCommerceReadinessPorts,
    } = await loadPaymentRuntime();
    const { userId } = context;
    if (websiteConfig.payment?.provider !== 'waffo') {
      throw new Error('Credit package checkout requires Waffo.');
    }
    requireWaffoTestCheckoutAuthority(serverEnv.WAFFO_ENVIRONMENT);
    return executeCommerceReadyAddOnCheckout(
      { offerId: data.offerId },
      productionCommerceReadinessPorts(),
      async (selection) => {
        const productId = selection.productId;
        const skuSnapshot = snapshotWaffoCreditPackageAddOn({
          amountMicros: selection.amountMicros,
          credits: selection.credits,
          currency: selection.currency,
          expireDays: selection.expireDays,
          id: selection.offerId,
        });
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
          throw new Error(
            'Credit package checkout requires workspace ownership.'
          );
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
      }
    );
  });

export const createCustomerPortalSession = createServerFn({ method: 'POST' })
  .inputValidator(portalInputSchema)
  .middleware([recentAuthApiMiddleware])
  .handler(async ({ data, context }) => {
    const { getDb, createCustomerPortal, productionCommerceReadinessPorts } =
      await loadPaymentRuntime();
    const { userId } = context;
    if (websiteConfig.payment?.provider === 'stripe') {
      throw new StripeNewCommerceRetiredError();
    }
    const readiness = await evaluateCommerceReadiness(
      productionCommerceReadinessPorts(),
      'portal'
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
