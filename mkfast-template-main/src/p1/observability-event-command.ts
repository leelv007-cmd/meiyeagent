import type { ObservabilityEvent } from '@meiye/contracts';

export type ObservabilityEventCommand = (
  module: 'creation-experience',
  call: {
    action: 'event_append';
    payload: ObservabilityEvent;
  },
  idempotencyKey: string
) => Promise<unknown>;

export function submitObservabilityEvent(
  submit: ObservabilityEventCommand,
  event: ObservabilityEvent,
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
