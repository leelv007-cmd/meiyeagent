import { beforeEach, describe, expect, it, vi } from 'vitest';

const { handlerFetch, localeMiddleware, settlePendingPaymentWebhookEvents } =
  vi.hoisted(() => ({
    handlerFetch: vi.fn(),
    localeMiddleware: vi.fn(),
    settlePendingPaymentWebhookEvents: vi.fn(),
  }));

vi.mock('@tanstack/react-start/server-entry', () => ({
  default: { fetch: handlerFetch },
}));
vi.mock('@/locale/middleware', () => ({ localeMiddleware }));
vi.mock('@/payment', () => ({ settlePendingPaymentWebhookEvents }));
vi.mock('@/storage/object-outbox', () => ({ processStorageObjectOutbox: vi.fn() }));

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
  });

  it('schedules due webhook settlement on fetch without waiting for a cron trigger', async () => {
    const waitUntil = vi.fn();
    const server = (await import('./server')).default;

    await server.fetch(new Request('https://app.example.test/pricing'), {}, {
      waitUntil,
    } as unknown as ExecutionContext);

    expect(settlePendingPaymentWebhookEvents).toHaveBeenCalledTimes(1);
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });
});
