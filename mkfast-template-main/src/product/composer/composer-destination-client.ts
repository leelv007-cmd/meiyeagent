import {
  composerDestinationMappingSchema,
  p1HttpPath,
  type ComposerDestinationMapping,
} from '@meiye/contracts';

import { telemetryFetch } from '@/lib/product-telemetry';
import { readP1Envelope } from '@/p1/client';

export async function mapComposerDestination(
  destination: string
): Promise<ComposerDestinationMapping> {
  const response = await telemetryFetch(
    p1HttpPath('composer.map_destination'),
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
