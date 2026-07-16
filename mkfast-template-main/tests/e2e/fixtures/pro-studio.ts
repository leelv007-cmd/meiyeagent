import { expect, type Page } from '@playwright/test';
import { createHmac, randomUUID } from 'node:crypto';

export async function unlockProStudio(page: Page) {
  const suffix = randomUUID();
  const payload = JSON.stringify({
    data: {
      object: {
        id: `e2e-pro-studio-checkout-${suffix}`,
        mode: 'payment',
        payment_status: 'paid',
      },
    },
    id: `e2e-pro-studio-event-${suffix}`,
    type: 'checkout.session.completed',
  });
  const signature = createHmac('sha256', 'mkfast-e2e-pro-studio-webhook-secret')
    .update(payload)
    .digest('hex');
  const response = await page.request.post('/api/e2e/pro-studio-payment', {
    data: payload,
    headers: {
      'content-type': 'application/json',
      'x-e2e-secret': 'mkfast-e2e-secret',
      'x-e2e-webhook-signature': signature,
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}
