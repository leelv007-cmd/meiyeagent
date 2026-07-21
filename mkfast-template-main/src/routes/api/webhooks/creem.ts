import { createFileRoute } from '@tanstack/react-router';
import { handleWebhookEvent } from '@/payment';
import {
  paymentWebhookErrorResponse,
  paymentWebhookHttpResponse,
  readPaymentWebhookPayload,
} from '@/payment/webhook-settlement';
import { logPaymentWebhookError } from '@/payment/webhook-logging';

/**
 * Creem webhook endpoint
 * Configure in Creem Dashboard: Settings -> Webhooks -> Add endpoint
 * Endpoint URL: https://your-domain.com/api/webhooks/creem
 * Events: checkout.completed, subscription.paid, subscription.canceled,
 *         subscription.expired, subscription.trialing, subscription.paused
 */
export const Route = createFileRoute('/api/webhooks/creem')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const payload = await readPaymentWebhookPayload(request);
          const signature = request.headers.get('creem-signature') ?? '';
          if (!payload || !signature) {
            console.warn('Creem webhook: missing payload or signature');
            return Response.json(
              { error: 'Missing payload or signature' },
              { status: 400 }
            );
          }
          const receipt = await handleWebhookEvent('creem', payload, signature);
          return paymentWebhookHttpResponse(receipt);
        } catch (err) {
          logPaymentWebhookError({
            error: err,
            provider: 'creem',
            stage: 'route',
          });
          return paymentWebhookErrorResponse(err);
        }
      },
    },
  },
});
