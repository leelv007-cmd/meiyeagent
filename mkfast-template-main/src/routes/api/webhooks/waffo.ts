import { createFileRoute } from '@tanstack/react-router';
import { handleAndSettleWebhookEvent } from '@/payment';
import {
  paymentWebhookErrorResponse,
  paymentWebhookHttpResponse,
  readPaymentWebhookPayload,
} from '@/payment/webhook-settlement';
import { logPaymentWebhookError } from '@/payment/webhook-logging';

export const Route = createFileRoute('/api/webhooks/waffo')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const payload = await readPaymentWebhookPayload(request);
          const signature = request.headers.get('x-waffo-signature') ?? '';
          if (!payload || !signature) {
            return Response.json(
              { error: 'Missing payload or signature' },
              { status: 400 }
            );
          }
          const receipt = await handleAndSettleWebhookEvent(
            'waffo',
            payload,
            signature
          );
          return paymentWebhookHttpResponse(receipt);
        } catch (error) {
          logPaymentWebhookError({
            error,
            provider: 'waffo',
            stage: 'route',
          });
          return paymentWebhookErrorResponse(error);
        }
      },
    },
  },
});
