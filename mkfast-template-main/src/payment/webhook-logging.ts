import { safeErrorFields } from '@/auth/safe-log';
import type { PaymentProviderName } from './types';

type PaymentWebhookStage = 'provider_effect' | 'route';

export function logPaymentWebhookError(
  input: {
    error: unknown;
    provider: PaymentProviderName;
    stage: PaymentWebhookStage;
  },
  logger: (...args: unknown[]) => void = console.error
) {
  logger('payment webhook processing failed', {
    event: 'PAYMENT_WEBHOOK_PROCESSING_FAILED',
    provider: input.provider,
    stage: input.stage,
    ...safeErrorFields(input.error),
  });
}
