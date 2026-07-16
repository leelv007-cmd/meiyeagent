import { createAuth } from '@/auth/auth';
import { websiteConfig } from '@/config/website';
import { resolveActiveWorkspace } from '@/db/workspaces';
import { getDb } from '@/db';
import { getCanonicalUrl } from '@/lib/urls';
import { findPlanByPriceId } from '@/lib/price-plan';
import {
  ProStudioCommerceError,
  createProStudioCheckout,
  isProStudioPaymentProviderReady,
  resolveProStudioAddOnOffer,
} from '@/payment/pro-studio-commerce';
import { PostgresProStudioCommerceStore } from '@/payment/postgres-pro-studio-commerce';
import { getPaymentProvider } from '@/payment';
import type { PaymentProvider, PaymentProviderName } from '@/payment/types';
import { createFileRoute } from '@tanstack/react-router';
import {
  type CheckoutDependencies,
  handleProStudioCheckoutRequest,
} from './-checkout-handler';

export const Route = createFileRoute('/api/pro-studio/checkout')({
  server: {
    handlers: {
      POST: ({ request }) =>
        handleProStudioCheckoutRequest(request, defaultDependencies()),
    },
  },
});

function defaultDependencies(): CheckoutDependencies {
  return {
    async authenticate(request) {
      const current = await createAuth().api.getSession({
        headers: request.headers,
      });
      if (
        !current?.user?.id ||
        !current.user.email ||
        !current.user.emailVerified
      ) {
        return null;
      }
      return {
        sessionId: current.session.id,
        userEmail: current.user.email,
        userId: current.user.id,
        userName: current.user.name ?? '',
      };
    },
    resolveWorkspace: resolveActiveWorkspace,
    async start(input) {
      const providerName = websiteConfig.payment?.provider as
        | PaymentProviderName
        | undefined;
      if (
        !providerName ||
        !isProStudioPaymentProviderReady(websiteConfig.payment, process.env)
      ) {
        throw new ProStudioCommerceError(
          'CHECKOUT_UNAVAILABLE',
          'Payment provider is not configured.'
        );
      }
      const offer = resolveProStudioAddOnOffer(process.env, {
        findPlanByPriceId,
      });
      let provider: PaymentProvider;
      try {
        provider = getPaymentProvider();
      } catch {
        throw new ProStudioCommerceError(
          'CHECKOUT_UNAVAILABLE',
          'Payment provider is unavailable.'
        );
      }
      const result = await createProStudioCheckout(
        {
          customerEmail: input.userEmail,
          customerName: input.userName,
          ownerSessionId: input.sessionId,
          ownerUserId: input.userId,
          workspaceId: input.workspaceId,
        },
        {
          offer,
          provider: {
            name: providerName,
            createCheckout: (checkout) => provider.createCheckout(checkout),
            validateServerCatalogOffer: (catalogOffer) =>
              provider.validateServerCatalogOffer(catalogOffer),
          },
          store: new PostgresProStudioCommerceStore(getDb()),
          urls: {
            cancelUrl: getCanonicalUrl('/pro-studio?checkout=cancelled'),
            successUrl: getCanonicalUrl('/pro-studio?checkout=success'),
          },
        }
      );
      return result.url;
    },
  };
}
