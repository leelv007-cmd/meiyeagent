import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/config/website', () => ({
  websiteConfig: {
    metadata: { images: { logoLight: undefined }, name: 'Meiye' },
  },
}));
vi.mock('@/env/server', () => ({
  serverEnv: {
    DISCORD_WEBHOOK_URL: 'https://discord.example.test/refunds',
    FEISHU_WEBHOOK_URL: 'https://feishu.example.test/refunds',
  },
}));
vi.mock('@/lib/urls', () => ({ getBaseUrl: () => 'https://app.example.test' }));

import { DiscordProvider } from './discord';
import { FeishuProvider } from './feishu';

const alert = {
  amount: '161.00',
  currency: 'HKD',
  eventStatus: 'succeeded' as const,
  orderId: 'waffo-order-001',
  provider: 'waffo',
  providerEventId: 'waffo-refund-001',
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('refund review notification providers', () => {
  it.each([
    ['Discord', () => new DiscordProvider()],
    ['Feishu', () => new FeishuProvider()],
  ])('%s exposes a non-success operations alert to the durable retry worker', async (_name, create) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 503 }))
    );
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(create().sendPaymentRefundReviewAlert(alert)).rejects.toThrow(
      'notification request failed'
    );
  });
});
