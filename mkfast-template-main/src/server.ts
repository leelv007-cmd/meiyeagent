// DO NOT DELETE THIS FILE!!!
// This file is a good smoke test to make sure the custom server entry is working
import handler from '@tanstack/react-start/server-entry';
import { localeMiddleware } from '@/locale/middleware';
import { settlePendingPaymentWebhookEvents } from '@/payment';
import { processStorageObjectOutbox } from '@/storage/object-outbox';

/**
 * TanStack Start server entry
 * https://github.com/backpine/tanstack-start-on-cloudflare/blob/main/src/server.ts
 */
console.log("[server-entry]: using custom server entry in 'src/server.ts'");

export default {
  fetch(request: Request, _env: unknown, context: ExecutionContext) {
    // A failed provider delivery is retained in the durable outbox. Run due
    // work on normal Worker traffic as well as scheduled invocations so a
    // preview without a cron trigger still recovers it.
    context.waitUntil(settlePendingPaymentWebhookEvents());
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
    _env: unknown,
    context: ExecutionContext
  ) {
    context.waitUntil(settlePendingPaymentWebhookEvents());
    context.waitUntil(processStorageObjectOutbox());
  },
};
