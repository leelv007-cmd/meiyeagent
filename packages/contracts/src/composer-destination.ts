import { z } from 'zod';

import {
  composerContentPackagePlatformSchema,
  composerDistributionTargetSchema,
} from './composer-submission.js';

const composerDestinationOptionSchema = z
  .object({
    contentPackagePlatform: composerContentPackagePlatformSchema,
    distributionTarget: composerDistributionTargetSchema,
    label: z.string().trim().min(1).max(80),
  })
  .strict();

const composerMappedDestinationSchema = z
  .object({
    contentPackagePlatform: composerContentPackagePlatformSchema,
    distributionTarget: composerDistributionTargetSchema,
    status: z.literal('mapped'),
  })
  .strict();

const composerDestinationClarificationSchema = z
  .object({
    options: z.array(composerDestinationOptionSchema).max(6),
    question: z.string().trim().min(1).max(200),
    status: z.literal('needs_clarification'),
  })
  .strict();

export const composerDestinationMappingSchema = z.discriminatedUnion('status', [
  composerMappedDestinationSchema,
  composerDestinationClarificationSchema,
]);

export type ComposerDestinationMapping = z.infer<
  typeof composerDestinationMappingSchema
>;
