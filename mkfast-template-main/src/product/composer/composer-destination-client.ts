import {
  composerDestinationMappingSchema,
  type ComposerDestinationMapping,
} from '@meiye/contracts';

import { telemetryFetch } from '@/lib/product-telemetry';
import { readP1Envelope } from '@/p1/client';

export async function mapComposerDestination(
  destination: string
): Promise<ComposerDestinationMapping> {
  const response = await telemetryFetch(
    '/api/core/p1/composer/destination-map',
    {
      body: JSON.stringify({ destination }),
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }
  );
  return readP1Envelope(
    response,
    composerDestinationMappingSchema,
    'Composer destination mapping failed.'
  );
}
