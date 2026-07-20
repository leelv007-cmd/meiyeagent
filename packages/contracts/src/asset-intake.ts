import { z } from 'zod';
import {
  capabilityEvidenceStatusSchema,
  storeFactKindSchema,
  storeFactScopeSchema,
  storeFactSourceSchema,
} from './context-bundle.js';

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
  })
  .strict()
  .superRefine((fact, context) => {
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

const assistedPriceMetadataSchema = z
  .object({
    batchId: idSchema,
    taskId: idSchema,
    candidateId: idSchema,
    key: idSchema,
    scope: storeFactScopeSchema,
    effectiveFrom: timestampSchema,
    expiresAt: timestampSchema.nullable(),
  })
  .strict();

export const prepareAssistedPriceIntakeCommandSchema = z.discriminatedUnion(
  'inputMode',
  [
    assistedPriceMetadataSchema.extend({
      inputMode: z.literal('screenshot'),
      screenshotAssetId: idSchema,
      recognizedText: z.string().trim().min(1).max(20_000),
    }),
    assistedPriceMetadataSchema.extend({
      inputMode: z.literal('paste_text'),
      pastedText: z.string().trim().min(1).max(20_000),
    }),
    assistedPriceMetadataSchema.extend({
      inputMode: z.literal('manual_select'),
      amount: z.number().finite().nonnegative(),
      currency: z.literal('CNY').default('CNY'),
    }),
  ],
);

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
export type RecordAssetIntakeBatchCommand = z.infer<
  typeof recordAssetIntakeBatchCommandSchema
>;
export type PrepareAssistedPriceIntakeCommand = z.infer<
  typeof prepareAssistedPriceIntakeCommandSchema
>;
