import { z } from 'zod';
import { identifierSchema, nonEmptyTrimmedStringSchema } from './identifiers.js';

const idSchema = identifierSchema;
const timestampSchema = z.iso.datetime();

export function memoryTaskSourceConversationId(
  workId: string,
  taskId: string,
) {
  return `${idSchema.parse(workId)}:${idSchema.parse(taskId)}`;
}

export const reusableAssetScopeSchema = z
  .object({
    storeId: idSchema,
    personaId: idSchema.optional(),
    scene: idSchema.optional(),
    platform: idSchema.optional(),
  })
  .strict();

export const reusableScopeDecisionSchema = z
  .object({
    mode: z.enum(['accepted_default', 'explicitly_expanded']),
    decisionId: idSchema,
    decidedBy: idSchema,
    decidedAt: timestampSchema,
  })
  .strict();

function scopesEqual(
  left: z.infer<typeof reusableAssetScopeSchema>,
  right: z.infer<typeof reusableAssetScopeSchema>,
) {
  return (
    left.storeId === right.storeId &&
    left.personaId === right.personaId &&
    left.scene === right.scene &&
    left.platform === right.platform
  );
}

function finalScopeIsSameOrWider(
  defaultScope: z.infer<typeof reusableAssetScopeSchema>,
  finalScope: z.infer<typeof reusableAssetScopeSchema>,
) {
  if (defaultScope.storeId !== finalScope.storeId) return false;
  for (const key of ['personaId', 'scene', 'platform'] as const) {
    if (
      finalScope[key] !== undefined &&
      finalScope[key] !== defaultScope[key]
    ) {
      return false;
    }
  }
  return true;
}

function validateScopeDecision(
  value: {
    defaultScope: z.infer<typeof reusableAssetScopeSchema>;
    finalScope: z.infer<typeof reusableAssetScopeSchema>;
    scopeDecision: z.infer<typeof reusableScopeDecisionSchema>;
  },
  context: z.core.$RefinementCtx,
) {
  const equal = scopesEqual(value.defaultScope, value.finalScope);
  if (!finalScopeIsSameOrWider(value.defaultScope, value.finalScope)) {
    context.addIssue({
      code: 'custom',
      message: 'Final scope must preserve or explicitly widen the default scope.',
      path: ['finalScope'],
    });
  }
  if (
    (equal && value.scopeDecision.mode !== 'accepted_default') ||
    (!equal && value.scopeDecision.mode !== 'explicitly_expanded')
  ) {
    context.addIssue({
      code: 'custom',
      message: 'Scope decision mode must match the default-to-final scope change.',
      path: ['scopeDecision', 'mode'],
    });
  }
}

const reusableStructureTokenSchema = z.enum([
  'hook',
  'context',
  'problem',
  'experience',
  'service',
  'process',
  'evidence',
  'benefit',
  'result',
  'proof',
  'offer',
  'cta',
  'disclaimer',
]);

const reusableFixedItemBase = { sourceRef: idSchema };

export const reusableFixedItemSchema = z.union([
  z
    .object({
      ...reusableFixedItemBase,
      key: idSchema.regex(/^structure\./),
      value: z.array(reusableStructureTokenSchema).min(1).max(20),
    })
    .strict(),
  z
    .object({
      ...reusableFixedItemBase,
      key: idSchema.regex(/^layout\./),
      value: z
        .object({
          pattern: z.enum([
            'single',
            'split',
            'grid_2',
            'grid_3',
            'carousel',
            'before_after',
          ]),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...reusableFixedItemBase,
      key: idSchema.regex(/^hook\./),
      value: z
        .object({
          pattern: z.enum([
            'question',
            'contrast',
            'result_first',
            'scene_first',
            'pain_point',
            'curiosity_gap',
          ]),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...reusableFixedItemBase,
      key: idSchema.regex(/^cta\./),
      value: z
        .object({
          pattern: z.enum([
            'consultation',
            'booking',
            'save',
            'share',
            'comment',
            'learn_more',
          ]),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...reusableFixedItemBase,
      key: idSchema.regex(/^asset_slots\./),
      value: z
        .array(
          z.enum([
            'cover',
            'environment',
            'service',
            'process',
            'evidence',
            'result',
            'portrait',
            'product',
            'detail',
            'before',
            'after',
          ]),
        )
        .min(1)
        .max(20),
    })
    .strict(),
]);

export const reusableVariableSlotSchema = z
  .object({
    key: idSchema,
    source: z.enum(['current_fact', 'current_asset', 'current_instruction']),
    required: z.boolean(),
  })
  .strict();

export const reusableAssetCandidateSchema = z
  .object({
    candidateId: idSchema,
    assetId: idSchema,
    workspaceId: idSchema,
    kind: z.enum(['reuse_recipe', 'series']),
    name: idSchema,
    fixedItems: z.array(reusableFixedItemSchema).min(1),
    variableSlots: z.array(reusableVariableSlotSchema).min(1),
    defaultScope: reusableAssetScopeSchema,
    provenance: z
      .object({
        sourcePackageId: idSchema,
        sourceVersionId: idSchema,
        sourcePackageRevision: z.number().int().nonnegative(),
        contextBundleId: idSchema,
        contextBundleRevision: z.number().int().positive(),
      })
      .strict(),
    rights: z
      .object({
        assetIds: z.array(idSchema),
        status: z.literal('authorized'),
      })
      .strict(),
    status: z.enum(['pending', 'confirmed', 'rejected']),
    createdAt: timestampSchema,
    createdBy: idSchema,
  })
  .strict();

const assetRevisionBodySchema = z
  .object({
    assetId: idSchema,
    revisionId: idSchema,
    candidateId: idSchema,
    revision: z.number().int().positive(),
    workspaceId: idSchema,
    kind: z.enum(['reuse_recipe', 'series']),
    name: idSchema,
    fixedItems: z.array(reusableFixedItemSchema).min(1),
    variableSlots: z.array(reusableVariableSlotSchema).min(1),
    defaultScope: reusableAssetScopeSchema,
    finalScope: reusableAssetScopeSchema,
    scopeDecision: reusableScopeDecisionSchema,
    provenance: reusableAssetCandidateSchema.shape.provenance,
    rights: reusableAssetCandidateSchema.shape.rights,
    nextSuggestions: z.array(
      z
        .object({
          suggestionId: idSchema,
          explanation: nonEmptyTrimmedStringSchema,
          variableSlotKeys: z.array(idSchema),
        })
        .strict(),
    ),
    createdAt: timestampSchema,
    createdBy: idSchema,
  })
  .strict()
  .superRefine(validateScopeDecision);

export const assetRevisionSchema = assetRevisionBodySchema;

export const reusableAssetLifecycleEventSchema = z
  .object({
    eventId: idSchema,
    workspaceId: idSchema,
    assetId: idSchema,
    revisionId: idSchema,
    action: z.enum(['activated', 'deactivated']),
    reason: nonEmptyTrimmedStringSchema,
    actorId: idSchema,
    occurredAt: timestampSchema,
  })
  .strict();

export const reuseTaskSeedSchema = z
  .object({
    assetId: idSchema,
    assetRevision: z.number().int().positive(),
    sourcePackageId: idSchema,
    sourceVersionId: idSchema,
    sourcePackageRevision: z.number().int().nonnegative(),
    assetRevisionId: idSchema,
    fixedItemKeys: z.array(idSchema),
    variableSlotKeys: z.array(idSchema),
  })
  .strict();

export const preferenceSignalSchema = z
  .object({
    signalId: idSchema,
    workspaceId: idSchema,
    decisionId: idSchema,
    taskId: idSchema,
    semanticKey: idSchema,
    value: z.json(),
    defaultScope: reusableAssetScopeSchema,
    kind: z.enum(['adopted', 'modified', 'rejected']),
    occurredAt: timestampSchema,
  })
  .strict();

export const memoryCandidateSourceSchema = z
  .object({
    conversationId: idSchema,
    sourceTurnId: idSchema,
    messageRange: z
      .object({
        start: z.number().int().nonnegative(),
        end: z.number().int().nonnegative(),
      })
      .strict()
      .refine(({ start, end }) => start <= end, {
        message: 'Message range start must not exceed its end.',
      }),
  })
  .strict();

export const memoryEntriesPageQuerySchema = z
  .object({
    limit: z.number().int().positive().max(50).default(20),
    cursor: nonEmptyTrimmedStringSchema.max(512).optional(),
  })
  .strict();

export const deleteMemoryEntryCommandSchema = z
  .object({
    entryId: idSchema,
  })
  .strict();

export const deleteMemorySourceConversationCommandSchema = z
  .object({
    conversationId: idSchema,
  })
  .strict();

export const confirmMemoryCandidateCommandSchema = z
  .object({
    entryId: idSchema,
    positiveExamples: z.array(nonEmptyTrimmedStringSchema).max(20).default([]),
    negativeExamples: z.array(nonEmptyTrimmedStringSchema).max(20).default([]),
  })
  .strict();

export const rejectMemoryCandidateCommandSchema = z
  .object({
    entryId: idSchema,
    reason: nonEmptyTrimmedStringSchema.max(500),
  })
  .strict();

export const memoryEntryProjectionSchema = z
  .object({
    entryId: idSchema,
    semanticKey: idSchema,
    value: z.json(),
    // V31-18 AC3: after revoke_memory the vault must project `revoked`, not
    // keep a promotion-only `confirmed` residual (B2 / entries_page).
    status: z.enum(['pending', 'confirmed', 'rejected', 'revoked']),
    proposedAt: timestampSchema,
    source: z
      .object({
        conversationId: idSchema,
        sourceTurnId: idSchema,
        messageRange: memoryCandidateSourceSchema.shape.messageRange,
        status: z.enum(['available', 'deleted', 'unavailable']),
        observedAt: timestampSchema.nullable(),
        preview: nonEmptyTrimmedStringSchema.max(500).nullable(),
        deletedAt: timestampSchema.nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict();

export const memoryEntriesPageSchema = z
  .object({
    items: z.array(memoryEntryProjectionSchema),
    nextCursor: nonEmptyTrimmedStringSchema.max(512).nullable(),
  })
  .strict();

/**
 * V3.1 §12.5 preference/correction ledger expansion (U5=C).
 * Stored on existing three-table jsonb payloads — no p1_agent_memory_entries.
 * Optional for backward-compatible legacy rows; normalize on read in Core.
 */
export const preferenceMemoryKindSchema = z.enum([
  'preference',
  'correction',
  'procedure',
]);

export const preferenceMemoryAuthoritySchema = z.enum([
  'observation',
  'session',
  'strong',
  'confirmed',
]);

export const preferenceMemoryStateSchema = z.enum([
  'active',
  'proposed',
  'superseded',
  'revoked',
  'expired',
]);

/** Soft preferences decay; corrections / facts use mode none. */
export const preferenceMemoryDecaySchema = z
  .object({
    mode: z.enum(['none', 'soft_preference']),
    halfLifeDays: z.number().positive().optional(),
  })
  .strict();

/** Dual-channel write surface: session = Thread-local; cross_thread = confirm gate. */
export const preferenceMemoryChannelSchema = z.enum([
  'session',
  'cross_thread',
]);

export const preferenceCandidateSchema = z
  .object({
    candidateId: idSchema,
    workspaceId: idSchema,
    semanticKey: idSchema,
    proposedValue: z.json(),
    defaultScope: reusableAssetScopeSchema,
    evidenceDecisionIds: z.array(idSchema).min(1),
    evidenceTaskIds: z.array(idSchema).min(1),
    trigger: z.enum(['explicit_long_term_intent', 'repeated_signal']),
    status: z.enum(['pending', 'confirmed', 'rejected']),
    proposedAt: timestampSchema,
    source: memoryCandidateSourceSchema.optional(),
    // V3.1 §12.5 expansion (optional on legacy rows)
    kind: preferenceMemoryKindSchema.optional(),
    authority: preferenceMemoryAuthoritySchema.optional(),
    memoryState: preferenceMemoryStateSchema.optional(),
    decay: preferenceMemoryDecaySchema.optional(),
    confidence: z.number().min(0).max(1).optional(),
    statement: nonEmptyTrimmedStringSchema.max(4_000).optional(),
    /** Session channel binds the Thread; required when authority=session. */
    threadId: idSchema.optional(),
    channel: preferenceMemoryChannelSchema.optional(),
  })
  .strict();

export const sourcedPreferenceCandidateSchema = preferenceCandidateSchema.extend({
  source: memoryCandidateSourceSchema,
});

export const preferenceSchema = z
  .object({
    preferenceId: idSchema,
    revision: z.number().int().positive(),
    workspaceId: idSchema,
    candidateId: idSchema,
    semanticKey: idSchema,
    value: z.json(),
    defaultScope: reusableAssetScopeSchema,
    finalScope: reusableAssetScopeSchema,
    scopeDecision: reusableScopeDecisionSchema,
    positiveExamples: z.array(nonEmptyTrimmedStringSchema),
    negativeExamples: z.array(nonEmptyTrimmedStringSchema),
    evidenceDecisionIds: z.array(idSchema).min(1),
    status: z.literal('inactive_stage2'),
    recordState: z.enum(['current', 'revoked', 'superseded']),
    confirmedBy: idSchema,
    confirmedAt: timestampSchema,
    revokedAt: timestampSchema.nullable(),
    supersededByPreferenceId: idSchema.nullable(),
    changedBy: idSchema,
    changedAt: timestampSchema,
    changeReason: z.enum([
      'candidate_confirmed',
      'user_revoked',
      'superseded',
    ]),
    // V3.1 §12.5 expansion (optional on legacy rows)
    kind: preferenceMemoryKindSchema.optional(),
    authority: preferenceMemoryAuthoritySchema.optional(),
    memoryState: preferenceMemoryStateSchema.optional(),
    decay: preferenceMemoryDecaySchema.optional(),
    confidence: z.number().min(0).max(1).optional(),
    statement: nonEmptyTrimmedStringSchema.max(4_000).optional(),
    threadId: idSchema.optional(),
    channel: preferenceMemoryChannelSchema.optional(),
  })
  .strict()
  .superRefine(validateScopeDecision);

export type ReusableAssetScope = z.infer<typeof reusableAssetScopeSchema>;
export type ReusableScopeDecision = z.infer<
  typeof reusableScopeDecisionSchema
>;
export type ReusableFixedItem = z.infer<typeof reusableFixedItemSchema>;
export type ReusableVariableSlot = z.infer<typeof reusableVariableSlotSchema>;
export type ReusableAssetCandidate = z.infer<
  typeof reusableAssetCandidateSchema
>;
export type AssetRevision = z.infer<typeof assetRevisionSchema>;
export type ReusableAssetLifecycleEvent = z.infer<
  typeof reusableAssetLifecycleEventSchema
>;
export type ReuseTaskSeed = z.infer<typeof reuseTaskSeedSchema>;
export type PreferenceSignal = z.infer<typeof preferenceSignalSchema>;
export type MemoryCandidateSource = z.infer<
  typeof memoryCandidateSourceSchema
>;
export type PreferenceCandidate = z.infer<typeof preferenceCandidateSchema>;
export type SourcedPreferenceCandidate = z.infer<
  typeof sourcedPreferenceCandidateSchema
>;
export type MemoryEntriesPageQuery = z.infer<
  typeof memoryEntriesPageQuerySchema
>;
export type MemoryEntryProjection = z.infer<
  typeof memoryEntryProjectionSchema
>;
export type MemoryEntriesPage = z.infer<typeof memoryEntriesPageSchema>;
export type Preference = z.infer<typeof preferenceSchema>;
export type PreferenceMemoryKind = z.infer<typeof preferenceMemoryKindSchema>;
export type PreferenceMemoryAuthority = z.infer<
  typeof preferenceMemoryAuthoritySchema
>;
export type PreferenceMemoryState = z.infer<typeof preferenceMemoryStateSchema>;
export type PreferenceMemoryDecay = z.infer<typeof preferenceMemoryDecaySchema>;
export type PreferenceMemoryChannel = z.infer<
  typeof preferenceMemoryChannelSchema
>;
