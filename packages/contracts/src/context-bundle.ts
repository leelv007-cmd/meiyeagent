import { z } from 'zod';

const idSchema = z.string().trim().min(1);
const timestampSchema = z.iso.datetime();
const jsonValueSchema = z.json();

export const STORE_FACT_KINDS = [
  'service',
  'price',
  'discount',
  'group_buy',
  'qualification',
  'fulfillment',
  'staff_experience',
  'customer_case',
  'other',
] as const;

export const STORE_FACT_KIND_LABELS = {
  service: '服务项目',
  price: '价格',
  discount: '优惠',
  group_buy: '团购信息',
  qualification: '资质',
  fulfillment: '履约信息',
  staff_experience: '员工经验',
  customer_case: '顾客案例',
  other: '其他门店信息',
} as const satisfies Record<(typeof STORE_FACT_KINDS)[number], string>;

export const storeFactKindSchema = z.enum(STORE_FACT_KINDS);
export const storeFactSourceSchema = z
  .object({
    kind: z.enum([
      'verified_api',
      'import',
      'screenshot_extraction',
      'user_confirmation',
      'aggregate_statistics',
    ]),
    referenceId: idSchema,
    capturedAt: timestampSchema,
  })
  .strict();

export const storeFactScopeSchema = z
  .object({
    storeId: idSchema,
    serviceId: idSchema.optional(),
    personaId: idSchema.optional(),
    platform: idSchema.optional(),
  })
  .strict();

export const storeFactSchema = z
  .object({
    factId: idSchema,
    workspaceId: idSchema,
    kind: storeFactKindSchema,
    key: idSchema,
    value: jsonValueSchema,
    scope: storeFactScopeSchema,
    source: storeFactSourceSchema,
    effectiveFrom: timestampSchema,
    expiresAt: timestampSchema.nullable(),
    revisionKind: z.literal('revocation').optional(),
    revision: z.number().int().positive(),
    recordedAt: timestampSchema,
    recordedBy: idSchema,
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

export const CONTEXT_DIMENSIONS = [
  'promotion_task',
  'traffic_opportunity',
  'expression_identity',
  'platform_mechanism',
  'store_facts_assets',
  'conversion_action',
] as const;

export const CONTEXT_PRIORITY_LAYERS = [
  'current_instruction',
  'current_fact',
  'confirmed_asset',
  'confirmed_preference',
  'industry_recipe',
  'model_knowledge',
] as const;

export const CONTEXT_SOURCE_REVISION_KEYS = [
  'facts',
  'assets',
  'identity',
  'rights',
  'preferences',
  'recipe',
  'platformRules',
  'currentSignal',
] as const;

export const contextDimensionSchema = z.enum(CONTEXT_DIMENSIONS);
export const contextPriorityLayerSchema = z.enum(CONTEXT_PRIORITY_LAYERS);
export const contextPoolSchema = z.enum([
  'industry',
  'store_personal',
  'current_signal',
]);
export const capabilityEvidenceStatusSchema = z.enum([
  'verified',
  'assisted',
  'unavailable',
]);
const contextSourceRevisionSchema = z.union([
  z.number().int().nonnegative(),
  z.string().trim().min(1),
]);

export const contextSourceRevisionsSchema = z
  .object({
    facts: contextSourceRevisionSchema,
    assets: contextSourceRevisionSchema,
    identity: contextSourceRevisionSchema,
    rights: contextSourceRevisionSchema,
    preferences: contextSourceRevisionSchema,
    recipe: contextSourceRevisionSchema,
    platformRules: contextSourceRevisionSchema,
    currentSignal: contextSourceRevisionSchema,
  })
  .strict();

export const contextContributionSchema = z
  .object({
    dimension: contextDimensionSchema,
    key: idSchema,
    value: jsonValueSchema,
    layer: contextPriorityLayerSchema,
    pool: contextPoolSchema,
    sourceRef: idSchema,
    capabilityStatus: capabilityEvidenceStatusSchema.optional(),
    factRevision: z
      .object({ factId: idSchema, revision: z.number().int().positive() })
      .strict()
      .optional(),
    factSnapshot: z
      .object({
        factId: idSchema,
        kind: storeFactKindSchema,
        revision: z.number().int().positive(),
        source: storeFactSourceSchema,
        effectiveFrom: timestampSchema,
        expiresAt: timestampSchema.nullable(),
        revisionKind: z.literal('revocation').optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((contribution, context) => {
    if (
      contribution.factSnapshot &&
      (contribution.factRevision?.factId !==
        contribution.factSnapshot.factId ||
        contribution.factRevision.revision !==
          contribution.factSnapshot.revision)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'factSnapshot must match factRevision.',
        path: ['factSnapshot'],
      });
    }
  });

export const resolvedContextValueSchema = z
  .object({
    value: jsonValueSchema,
    layer: contextPriorityLayerSchema,
    pool: contextPoolSchema,
    sourceRef: idSchema,
    factSnapshot: contextContributionSchema.shape.factSnapshot,
  })
  .strict();

const dimensionValuesSchema = z.record(
  z.string(),
  resolvedContextValueSchema,
);

export const contextBundlePayloadSchema = z
  .object({
    serializerVersion: z.literal('context-bundle-c14n-v1'),
    workspaceId: idSchema,
    taskId: idSchema,
    sourceRevisions: contextSourceRevisionsSchema,
    dimensions: z
      .object({
        promotion_task: dimensionValuesSchema,
        traffic_opportunity: dimensionValuesSchema,
        expression_identity: dimensionValuesSchema,
        platform_mechanism: dimensionValuesSchema,
        store_facts_assets: dimensionValuesSchema,
        conversion_action: dimensionValuesSchema,
      })
      .strict(),
    referencedFactRevisions: z.array(
      z
        .object({ factId: idSchema, revision: z.number().int().positive() })
        .strict(),
    ),
  })
  .strict();

export const contextBundleSchema = contextBundlePayloadSchema
  .extend({
    bundleId: idSchema,
    revision: z.number().int().positive(),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    frozenAt: timestampSchema,
    frozenBy: idSchema,
    previousRevision: z.number().int().positive().nullable(),
  })
  .strict();

export const contextBundleRecompileEventSchema = z
  .object({
    eventId: idSchema,
    workspaceId: idSchema,
    bundleId: idSchema,
    fromRevision: z.number().int().positive(),
    toRevision: z.number().int().positive(),
    changedSources: z.array(z.enum(CONTEXT_SOURCE_REVISION_KEYS)).min(1),
    reason: z.string().trim().min(1),
    occurredAt: timestampSchema,
  })
  .strict();

export const contextInvalidationEventSchema = z
  .object({
    eventId: idSchema,
    workspaceId: idSchema,
    source: z
      .object({
        key: z.enum(CONTEXT_SOURCE_REVISION_KEYS),
        referenceId: idSchema,
      })
      .strict(),
    reason: z.enum([
      'fact_expired',
      'fact_revised',
      'asset_expired',
      'identity_revoked',
      'rights_revoked',
      'preference_revoked',
      'recipe_revised',
      'platform_rules_revised',
      'current_signal_expired',
    ]),
    affectedBundleReferences: z.array(
      z
        .object({
          bundleId: idSchema,
          revision: z.number().int().positive(),
          hash: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict(),
    ),
    observedAt: timestampSchema,
  })
  .strict();

export type StoreFact = z.infer<typeof storeFactSchema>;
export type StoreFactScope = z.infer<typeof storeFactScopeSchema>;
export type StoreFactKind = z.infer<typeof storeFactKindSchema>;
export type ContextDimension = z.infer<typeof contextDimensionSchema>;
export type ContextPriorityLayer = z.infer<
  typeof contextPriorityLayerSchema
>;
export type ContextPool = z.infer<typeof contextPoolSchema>;
export type CapabilityEvidenceStatus = z.infer<
  typeof capabilityEvidenceStatusSchema
>;
export type ContextSourceRevisions = z.infer<
  typeof contextSourceRevisionsSchema
>;
export type ContextContribution = z.infer<typeof contextContributionSchema>;
export type ContextBundlePayload = z.infer<typeof contextBundlePayloadSchema>;
export type ContextBundle = z.infer<typeof contextBundleSchema>;
export type ContextBundleRecompileEvent = z.infer<
  typeof contextBundleRecompileEventSchema
>;
export type ContextInvalidationEvent = z.infer<
  typeof contextInvalidationEventSchema
>;
