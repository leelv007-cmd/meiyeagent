// DO NOT DELETE THIS FILE!!!
// This file is a good smoke test to make sure the custom server entry is working
import handler from '@tanstack/react-start/server-entry';
import { hasDatabaseBinding } from '@/db/runtime';
import { localeMiddleware } from '@/locale/middleware';
import {
  drainPaymentRefundReviewAlerts,
  settlePendingPaymentWebhookEvents,
} from '@/payment';
import { processStorageObjectOutbox } from '@/storage/object-outbox';

/**
 * TanStack Start server entry
 * https://github.com/backpine/tanstack-start-on-cloudflare/blob/main/src/server.ts
 */
console.log("[server-entry]: using custom server entry in 'src/server.ts'");

export default {
  fetch(request: Request, env: unknown, context: ExecutionContext) {
    // A failed provider delivery is retained in the durable outbox. Run due
    // work on normal Worker traffic as well as scheduled invocations so a
    // preview without a cron trigger still recovers it.
    if (hasDatabaseBinding(env)) {
      context.waitUntil(settlePendingPaymentWebhookEvents());
      context.waitUntil(drainPaymentRefundReviewAlerts());
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
