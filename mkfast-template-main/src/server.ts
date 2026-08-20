// DO NOT DELETE THIS FILE!!!
// This file is a good smoke test to make sure the custom server entry is working
import handler from '@tanstack/react-start/server-entry';
import { hasDatabaseBinding } from '@/db/runtime';
import { localeMiddleware } from '@/locale/middleware';
import {
  drainPaymentRefundReviewAlerts,
  settlePendingPaymentWebhookEvents,
} from '@/payment';
import { shouldDrainDurableOutboxOnWebSurface } from '@/payment/durable-outbox-drain';
import { processStorageObjectOutbox } from '@/storage/object-outbox';

let lastPreviewOutboxDrainAtMs = 0;

/**
 * TanStack Start server entry
 * https://github.com/backpine/tanstack-start-on-cloudflare/blob/main/src/server.ts
 */
console.log("[server-entry]: using custom server entry in 'src/server.ts'");

export default {
  fetch(request: Request, env: unknown, context: ExecutionContext) {
    // Durable outbox drain is owned by the scheduled trigger. Ordinary
    // requests do not drain; preview/dev may throttle a fallback.
    if (hasDatabaseBinding(env)) {
      const decision = shouldDrainDurableOutboxOnWebSurface({
        appEnv: process.env.APP_ENV ?? process.env.MODE,
        lastDrainAtMs: lastPreviewOutboxDrainAtMs,
        surface: 'fetch',
      });
      if (decision.drain) {
        lastPreviewOutboxDrainAtMs = Date.now();
        context.waitUntil(settlePendingPaymentWebhookEvents());
        context.waitUntil(drainPaymentRefundReviewAlerts());
      }
    }
    return localeMiddleware(request, () =>
      handler.fetch(request, {
        context: {
          fromFetch: true,
        },
      })
    );
  },
  scheduled(
    _controller: ScheduledController,
    env: unknown,
    context: ExecutionContext
  ) {
    if (hasDatabaseBinding(env)) {
      context.waitUntil(settlePendingPaymentWebhookEvents());
      context.waitUntil(drainPaymentRefundReviewAlerts());
      context.waitUntil(processStorageObjectOutbox());
    }
  },
};
