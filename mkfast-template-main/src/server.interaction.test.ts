import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  drainPaymentRefundReviewAlerts,
  handlerFetch,
  localeMiddleware,
  settlePendingPaymentWebhookEvents,
} = vi.hoisted(() => ({
  drainPaymentRefundReviewAlerts: vi.fn(),
  handlerFetch: vi.fn(),
  localeMiddleware: vi.fn(),
  settlePendingPaymentWebhookEvents: vi.fn(),
}));

vi.mock('@tanstack/react-start/server-entry', () => ({
  default: { fetch: handlerFetch },
}));
vi.mock('@/locale/middleware', () => ({ localeMiddleware }));
vi.mock('@/payment', () => ({
  drainPaymentRefundReviewAlerts,
  settlePendingPaymentWebhookEvents,
}));
vi.mock('@/storage/object-outbox', () => ({
  processStorageObjectOutbox: vi.fn(),
}));

describe('Worker payment settlement recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localeMiddleware.mockImplementation(
      (_request: Request, next: () => Promise<Response>) => next()
    );
    handlerFetch.mockResolvedValue(new Response('ok'));
    settlePendingPaymentWebhookEvents.mockResolvedValue({
      completed: 0,
      failed: 0,
    });
    drainPaymentRefundReviewAlerts.mockResolvedValue({
      completed: 0,
      failed: 0,
    });
  });

  it('schedules due payment settlement and refund review alerts on fetch', async () => {
    const waitUntil = vi.fn();
    const server = (await import('./server')).default;

    await server.fetch(
      new Request('https://app.example.test/pricing'),
      { HYPERDRIVE: { connectionString: 'postgres://test/database' } },
      { waitUntil } as unknown as ExecutionContext
    );

    expect(settlePendingPaymentWebhookEvents).toHaveBeenCalledTimes(1);
    expect(drainPaymentRefundReviewAlerts).toHaveBeenCalledTimes(1);
    expect(waitUntil).toHaveBeenCalledTimes(2);
  });

  it('schedules refund review alert recovery with the existing cron work', async () => {
    const waitUntil = vi.fn();
    const server = (await import('./server')).default;

    await server.scheduled(
      {} as ScheduledController,
      { HYPERDRIVE: { connectionString: 'postgres://test/database' } },
      { waitUntil } as unknown as ExecutionContext
    );

    expect(settlePendingPaymentWebhookEvents).toHaveBeenCalledTimes(1);
    expect(drainPaymentRefundReviewAlerts).toHaveBeenCalledTimes(1);
    expect(waitUntil).toHaveBeenCalledTimes(3);
  });

  it('skips database-backed recovery on a local fetch without Hyperdrive', async () => {
    const waitUntil = vi.fn();
    const server = (await import('./server')).default;

    await server.fetch(new Request('https://app.example.test/pricing'), {}, {
      waitUntil,
    } as unknown as ExecutionContext);

    expect(settlePendingPaymentWebhookEvents).not.toHaveBeenCalled();
    expect(drainPaymentRefundReviewAlerts).not.toHaveBeenCalled();
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it('treats a malformed binding as unavailable without throwing', async () => {
    const waitUntil = vi.fn();
    const server = (await import('./server')).default;

    await server.fetch(
      new Request('https://app.example.test/pricing'),
      { HYPERDRIVE: { connectionString: '' } },
      { waitUntil } as unknown as ExecutionContext
    );

    expect(settlePendingPaymentWebhookEvents).not.toHaveBeenCalled();
    expect(drainPaymentRefundReviewAlerts).not.toHaveBeenCalled();
    expect(waitUntil).not.toHaveBeenCalled();
  });
});
