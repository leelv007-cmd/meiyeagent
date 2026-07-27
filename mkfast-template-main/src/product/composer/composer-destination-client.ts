import {
  composerContentPackagePlatformSchema,
  composerDistributionTargetSchema,
  type ApiEnvelope,
} from '@meiye/contracts';
import { z } from 'zod';

import { telemetryFetch } from '@/lib/product-telemetry';
import { P1RequestError } from '@/p1/client';

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
  return composerDestinationMappingSchema.parse(
    await readDestinationEnvelope(response)
  );
}

async function readDestinationEnvelope(response: Response) {
  let envelope: ApiEnvelope<unknown>;
  try {
    envelope = (await response.json()) as ApiEnvelope<unknown>;
  } catch {
    throw new P1RequestError(
      'Composer destination response was not valid JSON.'
    );
  }
  if (!response.ok || 'error' in envelope) {
    const error = 'error' in envelope ? envelope.error : undefined;
    throw new P1RequestError(
      error?.message ?? 'Composer destination mapping failed.',
      error?.code,
      error?.details
    );
  }
  return envelope.data;
}
