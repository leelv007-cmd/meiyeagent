import type { ObservabilityEvent } from '@meiye/contracts';

export type MerchantObservabilityEvent = Extract<
  ObservabilityEvent,
  {
    eventType: 'delivery_rating.recorded' | 'delivery_rating.withdrawn';
  }
>;

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
