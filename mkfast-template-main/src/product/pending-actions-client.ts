import { pendingActionsResponseSchema } from '@meiye/contracts';

import { telemetryFetch } from '@/lib/product-telemetry';
import { readP1Envelope } from '@/p1/client';

export async function readPendingActions(signal?: AbortSignal) {
  const response = await telemetryFetch('/api/core/p1/pending-actions', {
    credentials: 'same-origin',
    signal,
  });
  return readP1Envelope(
    response,
    pendingActionsResponseSchema,
    'Pending actions request failed.'
  );
}

export const pendingActionsQueryKey = ['pending-actions'] as const;
