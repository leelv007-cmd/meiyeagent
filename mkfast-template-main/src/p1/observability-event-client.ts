import { commandP1 } from './client.js';
import {
  submitObservabilityEvent,
  type MerchantObservabilityEvent,
  type ObservabilityEventCommand,
} from './observability-event-command.js';

export function appendObservabilityEvent(
  event: MerchantObservabilityEvent,
  idempotencyKey: string,
  submit: ObservabilityEventCommand = commandP1
) {
  return submitObservabilityEvent(submit, event, idempotencyKey);
}
