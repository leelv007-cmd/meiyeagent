import {
  composerSubmissionSignedFieldsSchema,
  p1HttpPath,
  userSelectedSkillRefsSchema,
} from '@meiye/contracts';
import { z } from 'zod';

import { telemetryFetch } from '@/lib/product-telemetry';
import { readP1Envelope } from '@/p1/client';

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
    /** Continuation hint; Core verifies workspace ownership before reuse. */
    agentThreadId: identifierSchema.optional(),
    quote: revisionReferenceSchema,
    /** Merchant-selected fact refs; Core re-authorizes every ref server-side. */
    requestedFactRefs: z.array(identifierSchema).max(200).optional(),
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
    /** Merchant-confirmed Skill revision refs; omitted input defaults to []. */
    userSelectedSkillRefs: userSelectedSkillRefsSchema,
  })
  .strict()
  .superRefine((submission, context) => {
    if (!submission.viralAdaptSource) return;
    const frozenAssetIds = new Set(
      submission.sources.assets.map(({ id }) => id)
    );
    if (
      submission.viralAdaptSource.authorizedAssetIds.some(
        (assetId) => !frozenAssetIds.has(assetId)
      )
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Viral adapt reference images must belong to the submitted source set.',
        path: ['viralAdaptSource', 'authorizedAssetIds'],
      });
    }
  });

export const composerSubmissionResultSchema = z
  .object({
    contentPackage: z
      .object({
        expectedRevision: z.number().int().nonnegative(),
        id: identifierSchema,
      })
      .strict(),
    replayed: z.boolean(),
    /** False while a paid Living Plan waits for explicit merchant start. */
    makeReady: z.boolean(),
    /**
     * The confirmation the commit strip must decide before that start. Derived
     * from a snapshot digest server-side, so the browser cannot recompute it;
     * absent when the plan is exempt from paid confirmation.
     */
    executionConfirmationRequestId: identifierSchema.optional(),
    threadId: identifierSchema,
    runId: identifierSchema,
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

/** Input shape: optional defaulted fields (e.g. userSelectedSkillRefs) may be omitted. */
export type ComposerSubmissionBody = z.input<
  typeof composerSubmissionBodySchema
>;
export type ComposerSubmissionResult = z.infer<
  typeof composerSubmissionResultSchema
>;

export async function submitComposerSubmission(
  input: ComposerSubmissionBody
): Promise<ComposerSubmissionResult> {
  const body = composerSubmissionBodySchema.parse(input);
  const response = await telemetryFetch(p1HttpPath('composer.submit'), {
    body: JSON.stringify(body),
    credentials: 'same-origin',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': body.idempotencyKey,
    },
    method: 'POST',
  });
  return readP1Envelope(
    response,
    composerSubmissionResultSchema,
    'Composer submission failed.'
  );
}
