import { createFileRoute } from '@tanstack/react-router';
import { handleWebhookEvent } from '@/payment';
import {
  paymentWebhookErrorResponse,
  paymentWebhookHttpResponse,
  readPaymentWebhookPayload,
} from '@/payment/webhook-settlement';
import { logPaymentWebhookError } from '@/payment/webhook-logging';

/**
 * Stripe webhook endpoint
 * Configure in Stripe Dashboard: Webhooks -> Add endpoint
 * Endpoint URL: https://your-domain.com/api/webhooks/stripe
 * Events: checkout.session.completed, customer.subscription.*, invoice.paid
 */
export const Route = createFileRoute('/api/webhooks/stripe')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const payload = await readPaymentWebhookPayload(request);
          const signature = request.headers.get('stripe-signature') ?? '';
          if (!payload || !signature) {
            console.warn('Stripe webhook: missing payload or signature');
            return Response.json(
              { error: 'Missing payload or signature' },
              { status: 400 }
            );
          }
          const receipt = await handleWebhookEvent(
            'stripe',
            payload,
            signature
          );
          return paymentWebhookHttpResponse(receipt);
        } catch (err) {
          logPaymentWebhookError({
            error: err,
            provider: 'stripe',
            stage: 'route',
          });
          return paymentWebhookErrorResponse(err);
        }
      },
    },
  },
});
