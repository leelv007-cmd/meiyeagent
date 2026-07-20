import { pendingActionsSchema, type ApiEnvelope } from '@meiye/contracts';

import { telemetryFetch } from '@/lib/product-telemetry';
import { P1RequestError } from '@/p1/client';

export async function readPendingActions(signal?: AbortSignal) {
  const response = await telemetryFetch('/api/core/p1/pending-actions', {
    credentials: 'same-origin',
    signal,
  });
  let envelope: ApiEnvelope<unknown>;
  try {
    envelope = (await response.json()) as ApiEnvelope<unknown>;
  } catch {
    throw new P1RequestError('Pending actions response was not valid JSON.');
  }
  if (!response.ok || 'error' in envelope) {
    throw new P1RequestError(
      'error' in envelope
        ? envelope.error.message
        : 'Pending actions request failed.',
      'error' in envelope ? envelope.error.code : undefined
    );
  }
  return pendingActionsSchema.parse(envelope.data);
}

export const pendingActionsQueryKey = ['pending-actions'] as const;
