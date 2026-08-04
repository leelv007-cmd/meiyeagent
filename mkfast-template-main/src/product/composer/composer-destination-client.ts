import {
  composerContentPackagePlatformSchema,
  composerDistributionTargetSchema,
} from '@meiye/contracts';
import { z } from 'zod';

import { telemetryFetch } from '@/lib/product-telemetry';
import { readP1Envelope } from '@/p1/client';

const destinationOptionSchema = z
  .object({
    contentPackagePlatform: composerContentPackagePlatformSchema,
    distributionTarget: composerDistributionTargetSchema,
    label: z.string().trim().min(1).max(80),
  })
  .strict();

const mappedDestinationSchema = z
  .object({
    contentPackagePlatform: composerContentPackagePlatformSchema,
    distributionTarget: composerDistributionTargetSchema,
    status: z.literal('mapped'),
  })
  .strict();

export const composerDestinationMappingSchema = z.discriminatedUnion('status', [
  mappedDestinationSchema,
  z
    .object({
      options: z.array(destinationOptionSchema).max(6),
      question: z.string().trim().min(1).max(200),
      status: z.literal('needs_clarification'),
    })
    .strict(),
]);

export type ComposerDestinationMapping = z.infer<
  typeof composerDestinationMappingSchema
>;

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
