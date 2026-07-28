import {
  composerSubmissionSignedFieldsSchema,
  type ApiEnvelope,
} from '@meiye/contracts';
import { z } from 'zod';

import { telemetryFetch } from '@/lib/product-telemetry';
import { P1RequestError } from '@/p1/client';

const identifierSchema = z.string().trim().min(1).max(200);
const revisionSchema = z.string().trim().min(1).max(200);
const revisionReferenceSchema = z
  .object({
    id: identifierSchema,
    revision: revisionSchema,
  })
  .strict();

export const composerSubmissionBodySchema = composerSubmissionSignedFieldsSchema
  .extend({
    briefConfirmation: revisionReferenceSchema.optional(),
    briefContext: z
      .object({
        id: identifierSchema,
        revision: z.number().int().nonnegative(),
      })
      .strict(),
    identity: revisionReferenceSchema.optional(),
    identityDecision: z
      .object({
        id: identifierSchema,
        revision: z.number().int().positive(),
      })
      .strict()
      .optional(),
    idempotencyKey: identifierSchema,
    quote: revisionReferenceSchema,
    sources: z
      .object({
        assets: z
          .array(
            revisionReferenceSchema
              .extend({
                role: z.enum(['reference', 'source', 'style', 'subject']),
              })
              .strict()
          )
          .max(50),
        contentPackage: revisionReferenceSchema.optional(),
      })
      .strict(),
    surface: revisionReferenceSchema,
  })
  .strict();

const composerSubmissionResultSchema = z
  .object({
    contentPackage: z
      .object({
        expectedRevision: z.number().int().nonnegative(),
        id: identifierSchema,
      })
      .strict(),
    replayed: z.boolean(),
    snapshot: z
      .object({
        id: identifierSchema,
        identity: revisionReferenceSchema,
        identityDecision: z
          .object({
            id: identifierSchema,
            revision: z.number().int().positive(),
          })
          .strict()
          .optional(),
        schemaVersion: identifierSchema,
      })
      .strict(),
    task: z.object({ id: identifierSchema }).strict(),
    usageReservation: z.object({ id: identifierSchema }).strict(),
    work: z.object({ id: identifierSchema }).strict(),
  })
  .strict();

export type ComposerSubmissionBody = z.infer<
  typeof composerSubmissionBodySchema
>;
export type ComposerSubmissionResult = z.infer<
  typeof composerSubmissionResultSchema
>;

export async function submitComposerSubmission(
  input: ComposerSubmissionBody
): Promise<ComposerSubmissionResult> {
  const body = composerSubmissionBodySchema.parse(input);
  const response = await telemetryFetch('/api/core/p1/composer/submissions', {
    body: JSON.stringify(body),
    credentials: 'same-origin',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': body.idempotencyKey,
    },
    method: 'POST',
  });
  return composerSubmissionResultSchema.parse(
    await readComposerEnvelope(response)
  );
}

async function readComposerEnvelope(response: Response) {
  let envelope: ApiEnvelope<unknown>;
  try {
    envelope = (await response.json()) as ApiEnvelope<unknown>;
  } catch {
    throw new P1RequestError(
      'Composer submission response was not valid JSON.'
    );
  }
  if (!response.ok || 'error' in envelope) {
    const error = 'error' in envelope ? envelope.error : undefined;
    throw new P1RequestError(
      error?.message ?? 'Composer submission failed.',
      error?.code,
      error?.details
    );
  }
  return envelope.data;
}
