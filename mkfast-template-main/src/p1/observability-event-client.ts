import type { ObservabilityEvent } from '@meiye/contracts';

import { commandP1 } from './client.js';
import {
  submitObservabilityEvent,
  type ObservabilityEventCommand,
} from './observability-event-command.js';

export function appendObservabilityEvent(
  event: ObservabilityEvent,
  idempotencyKey: string,
  submit: ObservabilityEventCommand = commandP1
) {
  return submitObservabilityEvent(submit, event, idempotencyKey);
}
