import type { MerchantDeliveryRatingEventInput } from '@meiye/contracts';

export type MerchantObservabilityEvent = MerchantDeliveryRatingEventInput;

export type ObservabilityEventCommand = (
  module: 'creation-experience',
  call: {
    action: 'event_append';
    payload: MerchantObservabilityEvent;
  },
  idempotencyKey: string
) => Promise<unknown>;

export function submitObservabilityEvent(
  submit: ObservabilityEventCommand,
  event: MerchantObservabilityEvent,
  idempotencyKey: string
) {
  return submit(
    'creation-experience',
    {
      action: 'event_append',
      payload: event,
    },
    idempotencyKey
  );
}
