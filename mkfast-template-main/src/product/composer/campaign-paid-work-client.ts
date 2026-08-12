import { z } from 'zod';

import { telemetryFetch } from '@/lib/product-telemetry';
import { readP1Envelope } from '@/p1/client';

import {
  type ComposerSubmissionBody,
  composerSubmissionBodySchema,
  composerSubmissionResultSchema,
} from './composer-submission-client';

const campaignWorkPendingSchema = z
  .object({
    approvalScope: z.literal('single_work'),
    state: z.enum(['awaiting_plan_confirmation', 'creating', 'scheduled']),
    workOrdinal: z.union([z.literal(1), z.literal(2)]),
  })
  .strict();

const campaignWorkCreatedSchema = composerSubmissionResultSchema.extend({
  approvalScope: z.literal('single_work'),
  workOrdinal: z.union([z.literal(1), z.literal(2)]),
});

export const campaignPaidWorkProjectionSchema = z
  .object({
    campaignId: z.string().trim().min(1),
    campaignPlanRef: z
      .object({
        id: z.string().trim().min(1),
        revision: z.number().int().positive(),
      })
      .strict(),
    planApproval: z
      .object({
        approvalScope: z.literal('plan_only'),
        planOnlyNotice: z.string().trim().min(1),
        requestId: z.string().trim().min(1),
        reservedCredits: z.literal(0),
        status: z.enum(['pending', 'confirmed', 'rejected', 'expired']),
      })
      .strict(),
    works: z
      .array(z.union([campaignWorkCreatedSchema, campaignWorkPendingSchema]))
      .length(2),
  })
  .strict()
  .superRefine((projection, context) => {
    const ordinals = new Set(projection.works.map((work) => work.workOrdinal));
    if (!(ordinals.has(1) && ordinals.has(2))) {
      context.addIssue({
        code: 'custom',
        message: 'Campaign must contain Work ordinals 1 and 2.',
        path: ['works'],
      });
    }
  });

export type CampaignPaidWorkProjection = z.infer<
  typeof campaignPaidWorkProjectionSchema
>;

export async function submitCampaignPaidWork(input: {
  firstWork: ComposerSubmissionBody;
  secondWorkIntent: string;
}): Promise<CampaignPaidWorkProjection> {
  const body = {
    firstWork: composerSubmissionBodySchema.parse(input.firstWork),
    secondWorkIntent: input.secondWorkIntent.trim(),
  };
  const response = await telemetryFetch('/api/core/p1/campaigns/paid-works', {
    body: JSON.stringify(body),
    credentials: 'same-origin',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': body.firstWork.idempotencyKey,
    },
    method: 'POST',
  });
  return readP1Envelope(
    response,
    campaignPaidWorkProjectionSchema,
    'Campaign paid Work submission failed.'
  );
}

export async function readCampaignPaidWork(
  campaignId: string
): Promise<CampaignPaidWorkProjection> {
  const response = await telemetryFetch(
    `/api/core/p1/campaigns/paid-works/${encodeURIComponent(campaignId)}`,
    { credentials: 'same-origin', method: 'GET' }
  );
  return readP1Envelope(
    response,
    campaignPaidWorkProjectionSchema,
    'Campaign paid Work status failed.'
  );
}
