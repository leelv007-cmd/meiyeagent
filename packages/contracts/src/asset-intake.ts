import { z } from 'zod';
import {
  capabilityEvidenceStatusSchema,
  storeFactKindSchema,
  storeFactScopeSchema,
  storeFactSourceSchema,
} from './context-bundle.js';
import { storeProfilePatchSchema } from './product-schema.js';

const idSchema = z.string().trim().min(1);
const timestampSchema = z.iso.datetime();

export const ASSET_INTAKE_FALLBACK_INPUTS = [
  'screenshot',
  'paste_text',
  'manual_select',
] as const;

export const assetIntakeCapabilitySchema = z
  .object({
    status: capabilityEvidenceStatusSchema,
    fallbackInputs: z.array(z.enum(ASSET_INTAKE_FALLBACK_INPUTS)),
    reason: z.string().trim().min(1).nullable(),
  })
  .strict()
  .superRefine((capability, context) => {
    if (
      capability.status === 'assisted' &&
      capability.fallbackInputs.length === 0
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Assisted intake requires at least one fallback input.',
        path: ['fallbackInputs'],
      });
    }
  });

export const assetIntakeSourceSchema = z
  .object({
    sourceId: idSchema,
    kind: z.enum([
      'store_homepage',
      'price_list',
      'group_buy_screenshot',
      'gallery',
      'pasted_text',
      'manual',
      // D-151③: a batch staged from the merchant's own historical profile.
      // Never inline-finalizable — the finalize command rejects any inline
      // batch that is not `manual`, so an import batch has to be persisted
      // server-side (and therefore carry a persistence receipt) first.
      'import',
    ]),
    referenceId: idSchema,
    capabilityStatus: capabilityEvidenceStatusSchema,
    sourceWorkspaceId: idSchema,
    capturedAt: timestampSchema,
    example: z.boolean(),
  })
  .strict();

export const storeFactCandidateDraftSchema = z
  .object({
    kind: storeFactKindSchema,
    key: idSchema,
    value: z.json(),
    scope: storeFactScopeSchema,
    source: storeFactSourceSchema,
    effectiveFrom: timestampSchema,
    expiresAt: timestampSchema.nullable(),
    revisionKind: z.literal('revocation').optional(),
  })
  .strict()
  .superRefine((fact, context) => {
    if (fact.revisionKind === 'revocation' && fact.value !== null) {
      context.addIssue({
        code: 'custom',
        message: 'A revocation revision must carry a null value.',
        path: ['value'],
      });
    }
    if (
      fact.expiresAt !== null &&
      Date.parse(fact.expiresAt) <= Date.parse(fact.effectiveFrom)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'expiresAt must be later than effectiveFrom.',
        path: ['expiresAt'],
      });
    }
  });

const candidateBase = {
  candidateId: idSchema,
  status: z.enum(['pending', 'confirmed', 'corrected', 'rejected']),
};

export const assetIntakeCandidateSchema = z.discriminatedUnion('objectKind', [
  z
    .object({
      ...candidateBase,
      objectKind: z.literal('store_fact'),
      fact: storeFactCandidateDraftSchema,
    })
    .strict(),
  z
    .object({
      ...candidateBase,
      objectKind: z.literal('authorized_asset'),
      assetId: idSchema,
    })
    .strict(),
  z
    .object({
      ...candidateBase,
      objectKind: z.literal('identity_candidate'),
      candidateRef: idSchema,
    })
    .strict(),
]);

export const assetIntakeBatchSchema = z
  .object({
    batchId: idSchema,
    workspaceId: idSchema,
    taskId: idSchema,
    source: assetIntakeSourceSchema,
    summary: z.string().trim().min(1),
    candidates: z.array(assetIntakeCandidateSchema).min(1),
    createdAt: timestampSchema,
  })
  .strict();

export const assetIntakeDecisionEventSchema = z.discriminatedUnion('action', [
  z
    .object({
      eventId: idSchema,
      workspaceId: idSchema,
      batchId: idSchema,
      candidateId: idSchema,
      candidateRevision: z.number().int().positive(),
      action: z.literal('corrected'),
      correctedFact: storeFactCandidateDraftSchema,
      actorId: idSchema,
      occurredAt: timestampSchema,
    })
    .strict(),
  z
    .object({
      eventId: idSchema,
      workspaceId: idSchema,
      batchId: idSchema,
      candidateId: idSchema,
      candidateRevision: z.number().int().positive(),
      action: z.literal('confirmed'),
      factId: idSchema,
      factRevision: z.number().int().positive(),
      actorId: idSchema,
      occurredAt: timestampSchema,
    })
    .strict(),
  z
    .object({
      eventId: idSchema,
      workspaceId: idSchema,
      batchId: idSchema,
      candidateId: idSchema,
      candidateRevision: z.number().int().positive(),
      action: z.literal('rejected'),
      reason: z.string().trim().min(1),
      actorId: idSchema,
      occurredAt: timestampSchema,
    })
    .strict(),
]);

export const confirmedFactReferenceSchema = z
  .object({
    factId: idSchema,
    factRevision: z.number().int().positive(),
    taskId: idSchema,
    contextBundleId: idSchema,
    contextBundleRevision: z.number().int().positive(),
  })
  .strict();

export const recordAssetIntakeBatchCommandSchema = assetIntakeBatchSchema
  .omit({ workspaceId: true, createdAt: true })
  .strict();

/*
 * `prepare_assisted_price_intake` was retired by D-244. It was the only command
 * that ever asked how long a price is good for, and no merchant surface ever
 * called it — the wizard writes through `finalize_store_intake` (D-151①), and a
 * second write channel for the same fact is what let the price validity question
 * go unasked for so long. The validity question now lives in the wizard and
 * travels on the price candidate's own `effectiveFrom` / `expiresAt`.
 * See docs/decisions/2026-07-28-price-validity-intake.md.
 */

export const correctAssetIntakeFactCommandSchema = z
  .object({
    batchId: idSchema,
    candidateId: idSchema,
    correctedFact: storeFactCandidateDraftSchema,
  })
  .strict();

export const confirmAssetIntakeFactCommandSchema = z
  .object({
    batchId: idSchema,
    candidateId: idSchema,
    factId: idSchema,
    expectedFactRevision: z.number().int().nonnegative(),
  })
  .strict();

export const persistedAssetIntakeBatchReferenceSchema = z
  .object({ batchId: idSchema })
  .strict();

export const finalizeStoreIntakeCommandSchema = z
  .object({
    batch: z.union([
      recordAssetIntakeBatchCommandSchema,
      persistedAssetIntakeBatchReferenceSchema,
    ]),
    confirmations: z
      .array(
        z
          .object({
            candidateId: idSchema,
            factId: idSchema,
            expectedFactRevision: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .min(1),
    profilePatch: storeProfilePatchSchema,
  })
  .strict()
  .superRefine((input, context) => {
    const inlineBatch =
      'candidates' in input.batch ? input.batch : undefined;
    if (inlineBatch && inlineBatch.source.kind !== 'manual') {
      context.addIssue({
        code: 'custom',
        message:
          'Only a manual user-confirmation batch can be finalized inline.',
        path: ['batch', 'source', 'kind'],
      });
    }
    for (const [index, candidate] of (
      inlineBatch?.candidates ?? []
    ).entries()) {
      if (
        candidate.objectKind === 'store_fact' &&
        candidate.fact.source.kind !== 'user_confirmation'
      ) {
        context.addIssue({
          code: 'custom',
          message:
            'An inline StoreFact candidate must be a user confirmation.',
          path: ['batch', 'candidates', index, 'fact', 'source', 'kind'],
        });
      }
    }
    const candidateIds = new Set(
      (inlineBatch?.candidates ?? [])
        .filter((candidate) => candidate.objectKind === 'store_fact')
        .map((candidate) => candidate.candidateId),
    );
    const seen = new Set<string>();
    const seenFactIds = new Set<string>();
    for (const [index, confirmation] of input.confirmations.entries()) {
      if (inlineBatch && !candidateIds.has(confirmation.candidateId)) {
        context.addIssue({
          code: 'custom',
          message: 'Every confirmation must reference a StoreFact candidate.',
          path: ['confirmations', index, 'candidateId'],
        });
      }
      if (seen.has(confirmation.candidateId)) {
        context.addIssue({
          code: 'custom',
          message: 'A StoreFact candidate can be confirmed only once.',
          path: ['confirmations', index, 'candidateId'],
        });
      }
      seen.add(confirmation.candidateId);
      if (seenFactIds.has(confirmation.factId)) {
        context.addIssue({
          code: 'custom',
          message: 'A StoreFact stream can be confirmed only once per batch.',
          path: ['confirmations', index, 'factId'],
        });
      }
      seenFactIds.add(confirmation.factId);
    }
  });

export const rejectAssetIntakeCandidateCommandSchema = z
  .object({
    batchId: idSchema,
    candidateId: idSchema,
    reason: z.string().trim().min(1),
  })
  .strict();

export const assetIntakeViewQuerySchema = z
  .object({ batchId: idSchema })
  .strict();

export const assetIntakeMissingFactKeysQuerySchema = z
  .object({
    bundleId: idSchema,
    bundleRevision: z.number().int().positive().optional(),
    requiredKeys: z.array(idSchema).max(100),
  })
  .strict();

export type AssetIntakeCapability = z.infer<
  typeof assetIntakeCapabilitySchema
>;
export type AssetIntakeSource = z.infer<typeof assetIntakeSourceSchema>;
export type StoreFactCandidateDraft = z.infer<
  typeof storeFactCandidateDraftSchema
>;
export type AssetIntakeCandidate = z.infer<
  typeof assetIntakeCandidateSchema
>;
export type AssetIntakeBatch = z.infer<typeof assetIntakeBatchSchema>;
export type AssetIntakeDecisionEvent = z.infer<
  typeof assetIntakeDecisionEventSchema
>;
export type ConfirmedFactReference = z.infer<
  typeof confirmedFactReferenceSchema
>;
export type FinalizeStoreIntakeCommand = z.infer<
  typeof finalizeStoreIntakeCommandSchema
>;
export type RecordAssetIntakeBatchCommand = z.infer<
  typeof recordAssetIntakeBatchCommandSchema
>;
