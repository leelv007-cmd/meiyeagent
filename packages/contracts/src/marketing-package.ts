import { z } from 'zod';
import {
  identifierSchema,
  marketingIdentityIdSchema,
  nonEmptyTrimmedStringSchema,
} from './identifiers.js';

const idSchema = identifierSchema;
const timestampSchema = z.iso.datetime();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const MARKETING_SCENES = [
  'daily_service_exposure',
  'traffic_opportunity',
  'brand_personal_ip',
  'promotion_groupbuy_conversion',
  'routine_marketing_materials',
] as const;

export const marketingSceneSchema = z.enum(MARKETING_SCENES);

export const MARKETING_IDENTITY_PLATFORMS = [
  'xiaohongshu',
  'douyin',
  'video_account',
  'offline',
] as const;

export const marketingIdentityPlatformSchema = z.enum(
  MARKETING_IDENTITY_PLATFORMS,
);

export type MarketingIdentityPlatform = z.infer<
  typeof marketingIdentityPlatformSchema
>;

export const promotionCallToActionSchema = z
  .object({
    kind: z.enum(['appointment', 'voucher', 'store_visit', 'contact', 'none']),
    mode: z.enum(['actionable', 'manual', 'unavailable']),
    label: nonEmptyTrimmedStringSchema,
    endpoint: z.url().optional(),
  })
  .strict()
  .superRefine((action, context) => {
    if (action.mode === 'actionable' && !action.endpoint) {
      context.addIssue({
        code: 'custom',
        message: 'An actionable conversion path requires a verified endpoint.',
        path: ['endpoint'],
      });
    }
    if (action.mode !== 'actionable' && action.endpoint) {
      context.addIssue({
        code: 'custom',
        message: 'Unverified conversion paths cannot expose clickable endpoints.',
        path: ['endpoint'],
      });
    }
  });

export const promotionOfferCardSchema = z
  .object({
    status: z.enum(['verified', 'unpriced']),
    sourceRefs: z.array(idSchema).max(20),
    priceText: nonEmptyTrimmedStringSchema.optional(),
    benefitText: nonEmptyTrimmedStringSchema.optional(),
    effectiveFrom: timestampSchema.optional(),
    expiresAt: timestampSchema.optional(),
    callToAction: promotionCallToActionSchema,
  })
  .strict()
  .superRefine((offer, context) => {
    if (offer.status === 'verified' && offer.sourceRefs.length === 0) {
      context.addIssue({
        code: 'custom',
        message: 'A verified offer requires an authoritative fact reference.',
        path: ['sourceRefs'],
      });
    }
    if (offer.status === 'unpriced' && (offer.priceText || offer.benefitText)) {
      context.addIssue({
        code: 'custom',
        message: 'An unpriced offer cannot carry concrete price or benefit copy.',
        path: ['priceText'],
      });
    }
    if (
      offer.effectiveFrom &&
      offer.expiresAt &&
      Date.parse(offer.expiresAt) <= Date.parse(offer.effectiveFrom)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Offer expiry must be later than its effective time.',
        path: ['expiresAt'],
      });
    }
  });

export const hotTopicOpportunityCardSchema = z
  .object({
    opportunityId: idSchema,
    status: z.enum(['active', 'expired', 'evergreen_fallback']),
    source: nonEmptyTrimmedStringSchema,
    sourceType: z.enum([
      'user_link',
      'user_screenshot',
      'user_text_with_source',
      'evergreen_fallback',
    ]),
    capturedAt: timestampSchema,
    expiresAt: timestampSchema,
    platforms: z
      .array(z.enum(['xiaohongshu', 'douyin', 'video_account']))
      .min(1),
    region: nonEmptyTrimmedStringSchema,
    targetAudience: nonEmptyTrimmedStringSchema,
    matchedStoreReferences: z.array(idSchema),
    relevanceExplanation: nonEmptyTrimmedStringSchema,
    reusableMechanism: nonEmptyTrimmedStringSchema,
    expectedAction: nonEmptyTrimmedStringSchema,
    evergreenFallback: nonEmptyTrimmedStringSchema,
    protectedExpressionCopied: z.literal(false),
  })
  .strict()
  .superRefine((opportunity, context) => {
    if (Date.parse(opportunity.expiresAt) <= Date.parse(opportunity.capturedAt)) {
      context.addIssue({
        code: 'custom',
        message: 'Opportunity expiry must be later than capture time.',
        path: ['expiresAt'],
      });
    }
    if (
      opportunity.status === 'active' &&
      (opportunity.sourceType === 'evergreen_fallback' ||
        opportunity.matchedStoreReferences.length === 0)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'An active opportunity requires a user source and a store match.',
        path: ['matchedStoreReferences'],
      });
    }
    if (
      opportunity.status === 'evergreen_fallback' &&
      opportunity.sourceType !== 'evergreen_fallback'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Evergreen fallback must be identified as a fallback source.',
        path: ['sourceType'],
      });
    }
  });

/**
 * D-142 (W12②): where each identity field came from.
 *
 * `document` is a reference image the merchant handed over and the parse chain
 * read back; `ai_suggestion` is the model's inference from the merchant's
 * one-line background; `user` is the merchant's own words. Mirrors
 * `ASSET_FIELD_PROVENANCE` in parse-service.ts — the same three-way honesty the
 * five-step intake already renders as a badge — with `photo_extract` widened to
 * `document` because an identity reference may be a page, not a photo.
 */
export const MARKETING_IDENTITY_FIELD_PROVENANCE = [
  'user',
  'document',
  'ai_suggestion',
] as const;

export const marketingIdentityFieldProvenanceSchema = z.enum(
  MARKETING_IDENTITY_FIELD_PROVENANCE,
);

export type MarketingIdentityFieldProvenance = z.infer<
  typeof marketingIdentityFieldProvenanceSchema
>;

/**
 * Fields a draft assistant is allowed to propose. All of them are expressive:
 * how the identity speaks, what it stands for, what it refuses to say. The
 * merchant reads each one before it is registered.
 */
export const MARKETING_IDENTITY_ASSISTED_FIELDS = [
  'displayName',
  'owner',
  'professionalBoundaries',
  'expressionSamples',
  'brandClaims',
  'forbiddenClaims',
  'visualPrinciples',
  'seriesAnchors',
  'realWorldRole',
] as const;

/**
 * Fields no model may ever answer for the merchant. These are the consent
 * record itself — the authorization proof, the reach that was authorized, and
 * the portrait/voice permissions — which is exactly what D-142 was opened
 * about. The schema below refuses to register them as anything but `user`, so
 * a future assistant cannot quietly widen its own reach.
 */
export const MARKETING_IDENTITY_MERCHANT_ONLY_FIELDS = [
  'sourceRef',
  'allowedPlatforms',
  'allowedScenes',
  'portraitAuthorization',
  'voiceAuthorization',
] as const;

export const MARKETING_IDENTITY_PROVENANCE_FIELDS = [
  ...MARKETING_IDENTITY_ASSISTED_FIELDS,
  ...MARKETING_IDENTITY_MERCHANT_ONLY_FIELDS,
] as const;

export const marketingIdentityFieldProvenanceMapSchema = z.partialRecord(
  z.enum(MARKETING_IDENTITY_PROVENANCE_FIELDS),
  marketingIdentityFieldProvenanceSchema,
);

export type MarketingIdentityFieldProvenanceMap = z.infer<
  typeof marketingIdentityFieldProvenanceMapSchema
>;

const MERCHANT_ONLY_FIELD_SET: ReadonlySet<string> = new Set(
  MARKETING_IDENTITY_MERCHANT_ONLY_FIELDS,
);

function checkMerchantOnlyProvenance(
  identity: { fieldProvenance?: MarketingIdentityFieldProvenanceMap },
  context: z.RefinementCtx,
) {
  for (const [field, provenance] of Object.entries(
    identity.fieldProvenance ?? {},
  )) {
    if (!MERCHANT_ONLY_FIELD_SET.has(field)) continue;
    if (provenance === 'user') continue;
    context.addIssue({
      code: 'custom',
      message: `Identity field ${field} is a merchant answer and cannot carry ${provenance} provenance.`,
      path: ['fieldProvenance', field],
    });
  }
}

function requireMerchantOnlyProvenance(
  identity: { fieldProvenance?: MarketingIdentityFieldProvenanceMap },
  context: z.RefinementCtx,
) {
  for (const field of MARKETING_IDENTITY_MERCHANT_ONLY_FIELDS) {
    if (identity.fieldProvenance?.[field] === 'user') continue;
    context.addIssue({
      code: 'custom',
      message: `Identity field ${field} must be explicitly confirmed by the merchant.`,
      path: ['fieldProvenance', field],
    });
  }
}

const identityBaseSchema = z.object({
  identityId: marketingIdentityIdSchema,
  workspaceId: idSchema,
  version: z.number().int().positive(),
  status: z.enum(['active', 'revoked', 'departed', 'operator_changed']),
  displayName: nonEmptyTrimmedStringSchema,
  owner: nonEmptyTrimmedStringSchema,
  professionalBoundaries: z.array(nonEmptyTrimmedStringSchema),
  allowedPlatforms: z.array(marketingIdentityPlatformSchema),
  allowedScenes: z.array(marketingSceneSchema),
  expressionSamples: z.array(nonEmptyTrimmedStringSchema.max(2_000)).max(20),
  effectiveFrom: timestampSchema,
  expiresAt: timestampSchema.nullable(),
  departureHandling: nonEmptyTrimmedStringSchema,
  sourceRef: idSchema,
  /**
   * Field-level origin. Optional rather than defaulted: an identity registered
   * before W12② genuinely has no record of where its words came from, and
   * writing `user` over that absence would be the same silent answering D-142
   * exists to stop. Absent means unknown, not "the merchant wrote it".
   */
  fieldProvenance: marketingIdentityFieldProvenanceMapSchema.optional(),
  createdAt: timestampSchema,
  createdBy: idSchema,
});

const brandIdentitySchema = identityBaseSchema.extend({
      kind: z.literal('brand'),
      brandClaims: z.array(nonEmptyTrimmedStringSchema).min(1),
      forbiddenClaims: z.array(nonEmptyTrimmedStringSchema),
      visualPrinciples: z.array(nonEmptyTrimmedStringSchema),
      seriesAnchors: z.array(nonEmptyTrimmedStringSchema),
    });
const personIdentitySchema = identityBaseSchema.extend({
      kind: z.literal('person'),
      realWorldRole: nonEmptyTrimmedStringSchema,
      portraitAuthorization: z.enum(['authorized', 'not_authorized']),
      voiceAuthorization: z.enum(['authorized', 'not_authorized']),
      historicalContentPermission: z.enum([
        'retain_published',
        'review_required',
        'withdraw_if_possible',
      ]),
    });

export const marketingIdentityAssetSchema = z
  .discriminatedUnion('kind', [brandIdentitySchema, personIdentitySchema])
  .superRefine((identity, context) => {
    if (
      identity.expiresAt &&
      Date.parse(identity.expiresAt) <= Date.parse(identity.effectiveFrom)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Identity expiry must be later than its effective time.',
        path: ['expiresAt'],
      });
    }
    checkMerchantOnlyProvenance(identity, context);
  });

const identityRegistrationBaseSchema = identityBaseSchema
  .omit({
    workspaceId: true,
    version: true,
    status: true,
    createdAt: true,
    createdBy: true,
  })
  .extend({
    expectedVersion: z.literal(0),
    assistantDraft: z
      .object({
        draftId: idSchema,
        revision: z.number().int().positive(),
        confirmedFields: z
          .array(z.enum(MARKETING_IDENTITY_ASSISTED_FIELDS))
          .max(MARKETING_IDENTITY_ASSISTED_FIELDS.length),
      })
      .strict()
      .optional(),
  });

export const registerMarketingIdentityCommandSchema = z.discriminatedUnion(
  'kind',
  [
    identityRegistrationBaseSchema.extend({
      kind: z.literal('brand'),
      brandClaims: z.array(nonEmptyTrimmedStringSchema).min(1),
      forbiddenClaims: z.array(nonEmptyTrimmedStringSchema),
      visualPrinciples: z.array(nonEmptyTrimmedStringSchema),
      seriesAnchors: z.array(nonEmptyTrimmedStringSchema),
    }),
    identityRegistrationBaseSchema.extend({
      kind: z.literal('person'),
      realWorldRole: nonEmptyTrimmedStringSchema,
      portraitAuthorization: z.enum(['authorized', 'not_authorized']),
      voiceAuthorization: z.enum(['authorized', 'not_authorized']),
      historicalContentPermission: z.enum([
        'retain_published',
        'review_required',
        'withdraw_if_possible',
      ]),
    }),
  ],
).superRefine((identity, context) => {
  checkMerchantOnlyProvenance(identity, context);
  requireMerchantOnlyProvenance(identity, context);
  const assistedFields = Object.entries(identity.fieldProvenance ?? {})
    .filter(
      ([field, provenance]) =>
        !MERCHANT_ONLY_FIELD_SET.has(field) && provenance !== 'user',
    )
    .map(([field]) => field);
  if (assistedFields.length === 0) return;
  if (!identity.assistantDraft) {
    context.addIssue({
      code: 'custom',
      message:
        'Assistant-authored fields require a revision-bound server draft confirmation.',
      path: ['assistantDraft'],
    });
    return;
  }
  const confirmed = new Set(identity.assistantDraft.confirmedFields);
  for (const field of assistedFields) {
    if (confirmed.has(field as (typeof MARKETING_IDENTITY_ASSISTED_FIELDS)[number])) {
      continue;
    }
    context.addIssue({
      code: 'custom',
      message: `Assistant-authored field ${field} was not explicitly confirmed.`,
      path: ['assistantDraft', 'confirmedFields'],
    });
  }
});

/**
 * What the merchant hands the draft assistant: one line of background and,
 * optionally, the exact parse draft for a reference image they
 * uploaded. Core resolves that revision to text — this command never takes
 * browser-supplied extracted text, so there is one authoritative parse path
 * (`parse_single_asset`) rather than a second one hiding behind the assistant.
 */
export const marketingIdentityDraftRequestSchema = z
  .object({
    kind: z.enum(['brand', 'person']),
    background: nonEmptyTrimmedStringSchema.max(2_000),
    referenceDraft: z
      .object({
        draftId: idSchema,
        revision: z.number().int().positive(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type MarketingIdentityDraftRequest = z.infer<
  typeof marketingIdentityDraftRequestSchema
>;

const marketingIdentitySuggestedFieldSchema = z.discriminatedUnion(
  'provenance',
  [
    z
      .object({
        value: nonEmptyTrimmedStringSchema.max(2_000),
        provenance: z.literal('ai_suggestion'),
      })
      .strict(),
    z
      .object({
        value: nonEmptyTrimmedStringSchema.max(2_000),
        provenance: z.literal('document'),
        citation: z
          .object({
            exactQuote: nonEmptyTrimmedStringSchema.max(2_000),
          })
          .strict(),
      })
      .strict(),
  ],
);

/**
 * The assistant's proposal. Every key is nullable rather than optional so the
 * model has to say "I have nothing for this" out loud, and the key set is
 * exactly the expressive fields — the authorization proof, the authorized
 * reach, and the portrait/voice permissions have no slot here at all, so the
 * assistant structurally cannot answer them.
 */
export const marketingIdentitySuggestionSchema = z
  .object({
    displayName: marketingIdentitySuggestedFieldSchema.nullable(),
    owner: marketingIdentitySuggestedFieldSchema.nullable(),
    primaryClaimOrRole: marketingIdentitySuggestedFieldSchema.nullable(),
    professionalBoundaries: marketingIdentitySuggestedFieldSchema.nullable(),
    expressionSamples: marketingIdentitySuggestedFieldSchema.nullable(),
    forbiddenClaims: marketingIdentitySuggestedFieldSchema.nullable(),
    visualPrinciples: marketingIdentitySuggestedFieldSchema.nullable(),
    seriesAnchors: marketingIdentitySuggestedFieldSchema.nullable(),
  })
  .strict();

export type MarketingIdentitySuggestion = z.infer<
  typeof marketingIdentitySuggestionSchema
>;

export const EMPTY_MARKETING_IDENTITY_SUGGESTION: MarketingIdentitySuggestion =
  {
    displayName: null,
    owner: null,
    primaryClaimOrRole: null,
    professionalBoundaries: null,
    expressionSamples: null,
    forbiddenClaims: null,
    visualPrinciples: null,
    seriesAnchors: null,
  };

export const marketingIdentityDraftResultSchema = z
  .object({
    draftId: idSchema,
    revision: z.number().int().positive(),
    status: z.enum(['suggested', 'empty', 'unavailable']),
    suggestion: marketingIdentitySuggestionSchema,
    reference: z
      .object({
        draftId: idSchema,
        draftRevision: z.number().int().positive(),
        parsedDocumentId: idSchema,
      })
      .strict()
      .nullable(),
    errorCode: z
      .enum(['model_unavailable', 'model_execution_failed'])
      .nullable(),
  })
  .strict()
  .superRefine((result, context) => {
    const hasSuggestion = Object.values(result.suggestion).some(Boolean);
    if ((result.status === 'suggested') !== hasSuggestion) {
      context.addIssue({
        code: 'custom',
        message: 'Draft status must agree with whether suggestions exist.',
        path: ['status'],
      });
    }
    if ((result.status === 'unavailable') !== (result.errorCode !== null)) {
      context.addIssue({
        code: 'custom',
        message: 'Only unavailable drafts carry an observable error code.',
        path: ['errorCode'],
      });
    }
  });

export type MarketingIdentityDraftResult = z.infer<
  typeof marketingIdentityDraftResultSchema
>;

export const transitionMarketingIdentityCommandSchema = z
  .object({
    identityId: marketingIdentityIdSchema,
    expectedVersion: z.number().int().positive(),
    transition: z.enum(['revoke', 'depart', 'operator_change']),
    reason: nonEmptyTrimmedStringSchema,
  })
  .strict();

export const marketingIdentityQuerySchema = z
  .object({
    identityId: marketingIdentityIdSchema.optional(),
    includeInactive: z.boolean().default(false),
  })
  .strict();

export const marketingIdentityReferenceSchema = z
  .object({
    identityId: marketingIdentityIdSchema,
    version: z.number().int().positive(),
  })
  .strict();

export const setDefaultMarketingIdentityCommandSchema = z
  .object({
    expectedDecisionRevision: z.number().int().nonnegative(),
    identity: marketingIdentityReferenceSchema,
    reason: nonEmptyTrimmedStringSchema.max(500),
  })
  .strict();

export const selectMarketingIdentityForSessionCommandSchema = z
  .object({
    identity: marketingIdentityReferenceSchema.nullable(),
    reason: nonEmptyTrimmedStringSchema.max(500),
    sessionId: idSchema,
  })
  .strict();

export const rollbackDefaultMarketingIdentityCommandSchema = z
  .object({
    expectedDecisionRevision: z.number().int().positive(),
    reason: nonEmptyTrimmedStringSchema.max(500),
    targetDecisionRevision: z.number().int().positive(),
  })
  .strict();

export const marketingIdentityDefaultDecisionSchema = z
  .object({
    decisionId: idSchema,
    decisionRevision: z.number().int().positive(),
    identity: marketingIdentityReferenceSchema,
  })
  .strict();

export const marketingIdentityProjectionSchema = z
  .object({
    identities: z.array(marketingIdentityAssetSchema),
    defaultDecision: marketingIdentityDefaultDecisionSchema.nullable(),
    defaultIdentity: marketingIdentityReferenceSchema.nullable(),
    decisionRevision: z.number().int().nonnegative(),
  })
  .strict();

export const promotionalMaterialPurposeSchema = z.enum([
  'xiaohongshu_cover',
  'douyin_cover',
  'wechat_moments_poster',
  'offline_a4_poster',
]);

export const PROMOTIONAL_MATERIAL_SPECS = [
  {
    purpose: 'xiaohongshu_cover',
    width: 1242,
    height: 1660,
    aspectRatio: '3:4',
    textSafeArea: { top: 116, right: 96, bottom: 140, left: 96 },
    cropStrategy: 'cover_center',
    format: 'image/png',
    renderer: 'light-composer',
    rendererVersion: 'light-composer-v1',
  },
  {
    purpose: 'douyin_cover',
    width: 1080,
    height: 1440,
    aspectRatio: '3:4',
    textSafeArea: { top: 180, right: 90, bottom: 220, left: 90 },
    cropStrategy: 'cover_center',
    format: 'image/png',
    renderer: 'light-composer',
    rendererVersion: 'light-composer-v1',
  },
  {
    purpose: 'wechat_moments_poster',
    width: 1080,
    height: 1080,
    aspectRatio: '1:1',
    textSafeArea: { top: 86, right: 86, bottom: 86, left: 86 },
    cropStrategy: 'contain_brand_safe',
    format: 'image/png',
    renderer: 'light-composer',
    rendererVersion: 'light-composer-v1',
  },
  {
    purpose: 'offline_a4_poster',
    width: 2480,
    height: 3508,
    aspectRatio: '210:297',
    textSafeArea: { top: 176, right: 176, bottom: 176, left: 176 },
    cropStrategy: 'contain_brand_safe',
    format: 'image/png',
    renderer: 'light-composer',
    rendererVersion: 'light-composer-v1',
  },
] as const;

export const promotionalMaterialSpecSchema = z
  .object({
    purpose: promotionalMaterialPurposeSchema,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    aspectRatio: nonEmptyTrimmedStringSchema,
    textSafeArea: z
      .object({
        top: z.number().int().nonnegative(),
        right: z.number().int().nonnegative(),
        bottom: z.number().int().nonnegative(),
        left: z.number().int().nonnegative(),
      })
      .strict(),
    cropStrategy: z.enum(['cover_center', 'contain_brand_safe']),
    format: z.literal('image/png'),
    renderer: z.literal('light-composer'),
    rendererVersion: nonEmptyTrimmedStringSchema,
  })
  .strict();

const promotionalMaterialReceiptExtensionShape = {
  capabilityStatus: z.enum(['verified', 'assisted']),
  missingMaterialFallback: z.enum([
    'none',
    'brand_safe_placeholder',
    'text_only',
  ]),
  outputSha256: sha256Schema,
  provenanceRef: idSchema,
};

export const promotionalMaterialReceiptExtensionSchema = z
  .object(promotionalMaterialReceiptExtensionShape)
  .strict();

export const promotionalMaterialReceiptSchema = z
  .object({
    ...promotionalMaterialReceiptExtensionShape,
    spec: promotionalMaterialSpecSchema,
    normalizedDocumentHash: sha256Schema,
    sourceAssetHashes: z.array(sha256Schema),
    fontBundleHash: sha256Schema,
    objectKey: nonEmptyTrimmedStringSchema,
    contentType: z.literal('image/png'),
    sizeBytes: z.number().int().positive(),
  })
  .strict();

export const QUICK_EDIT_ACTIONS = [
  'natural_language',
  'identity_brand',
  'identity_person',
  'promotion_weaker',
  'promotion_stronger',
  'replace_assets',
  'platform_variant',
  'wechat_moments_export',
  'offline_material_export',
  'poster',
  'image_set',
  'spoken_script',
  'appointment_card',
] as const;

export const quickEditActionSchema = z.enum(QUICK_EDIT_ACTIONS);

export const QUICK_EDIT_TARGET_BY_ACTION = {
  natural_language: 'package_version',
  identity_brand: 'package_version',
  identity_person: 'package_version',
  promotion_weaker: 'package_version',
  promotion_stronger: 'package_version',
  replace_assets: 'package_version',
  platform_variant: 'platform_variant',
  wechat_moments_export: 'export_use',
  offline_material_export: 'export_use',
  poster: 'export_use',
  image_set: 'export_use',
  spoken_script: 'export_use',
  appointment_card: 'export_use',
} as const satisfies Record<
  z.infer<typeof quickEditActionSchema>,
  'package_version' | 'platform_variant' | 'export_use'
>;

export const QUICK_EDIT_EXPORT_USE_BY_ACTION = {
  wechat_moments_export: 'wechat_moments',
  offline_material_export: 'offline_material',
  poster: 'poster',
  image_set: 'image_set',
  spoken_script: 'spoken_script',
  appointment_card: 'appointment_card',
} as const;

export const quickEditExportUseSchema = z.enum([
  'wechat_moments',
  'offline_material',
  'poster',
  'image_set',
  'spoken_script',
  'appointment_card',
]);

export const quickEditIntentSchema = z
  .object({
    action: quickEditActionSchema,
    exportUse: quickEditExportUseSchema.optional(),
    instruction: nonEmptyTrimmedStringSchema.max(2_000),
    target: z.enum(['package_version', 'platform_variant', 'export_use']),
    scope: z.literal('current_task'),
    baseVersionId: idSchema,
    preservedFactRefs: z.array(idSchema),
    preservedRightsRefs: z.array(idSchema),
  })
  .strict()
  .superRefine((intent, context) => {
    const expectedTarget = QUICK_EDIT_TARGET_BY_ACTION[intent.action];
    if (intent.target !== expectedTarget) {
      context.addIssue({
        code: 'custom',
        message: `Quick edit action ${intent.action} must target ${expectedTarget}.`,
        path: ['target'],
      });
    }
    const expectedExportUse =
      intent.action in QUICK_EDIT_EXPORT_USE_BY_ACTION
        ? QUICK_EDIT_EXPORT_USE_BY_ACTION[
            intent.action as keyof typeof QUICK_EDIT_EXPORT_USE_BY_ACTION
          ]
        : undefined;
    if (intent.exportUse !== expectedExportUse) {
      context.addIssue({
        code: 'custom',
        message: expectedExportUse
          ? `Quick edit action ${intent.action} must route to ${expectedExportUse}.`
          : `Quick edit action ${intent.action} cannot declare an export use.`,
        path: ['exportUse'],
      });
    }
  });

export const quickEditExportUseDeliverySchema = z.discriminatedUnion('kind', [
  z
    .object({
      contentType: z.literal('text/plain;charset=utf-8'),
      exportUse: z.enum(['wechat_moments', 'spoken_script']),
      fileName: nonEmptyTrimmedStringSchema,
      kind: z.literal('formatted_text'),
      text: nonEmptyTrimmedStringSchema,
    })
    .strict(),
  z
    .object({
      exportUse: z.enum([
        'offline_material',
        'poster',
        'image_set',
        'appointment_card',
      ]),
      kind: z.literal('light_composer'),
      materialSpecs: z.array(promotionalMaterialSpecSchema).min(1),
      receiptCommand: z.literal('export_work'),
      sourcePackageId: idSchema.optional(),
      sourceWorkId: idSchema.optional(),
      sourceVersionId: idSchema.optional(),
      templateRole: z.enum([
        'offline_material',
        'poster',
        'image_set',
        'appointment_card',
      ]),
    })
    .strict()
    .superRefine((delivery, context) => {
      if (Boolean(delivery.sourcePackageId) !== Boolean(delivery.sourceVersionId)) {
        context.addIssue({
          code: 'custom',
          message:
            'Light Composer package and version lineage must be present together.',
          path: ['sourcePackageId'],
        });
      }
      if (delivery.exportUse !== delivery.templateRole) {
        context.addIssue({
          code: 'custom',
          message: 'Light Composer template role must match its export use.',
          path: ['templateRole'],
        });
      }
    }),
]);

export const marketingPackageDeclarationSchema = z
  .object({
    normalizedIntent: nonEmptyTrimmedStringSchema.max(4_000),
    taskType: marketingSceneSchema,
    deliveryLayer: z.enum(['copy', 'finished_media']),
    relevantAssetCategories: z.array(nonEmptyTrimmedStringSchema).max(20),
    usedAssetCategories: z.array(nonEmptyTrimmedStringSchema).max(20),
    route: z.enum(['customized', 'guidance', 'free']),
    routingSource: z.enum(['entry', 'model', 'fallback', 'decision', 'policy']),
    implicitConstraints: z.array(nonEmptyTrimmedStringSchema).max(30),
  })
  .strict();

const marketingPackageEvidenceCurrentSchema = z
  .object({
    declaration: marketingPackageDeclarationSchema,
    contextBundle: z
      .object({
        bundleId: idSchema,
        revision: z.number().int().positive(),
        hash: sha256Schema,
      })
      .strict(),
    factRefs: z.array(idSchema),
    rightsRefs: z.array(idSchema),
    identityRefs: z.array(idSchema),
    identityFallback: z.enum(['none', 'brand_official']).default('none'),
  })
  .strict();

const legacyMarketingPackageEvidenceSchema = z
  .object({
    scene: marketingSceneSchema,
    contextBundle: z
      .object({
        bundleId: idSchema,
        revision: z.number().int().positive(),
        hash: sha256Schema,
      })
      .strict(),
    factRefs: z.array(idSchema),
    rightsRefs: z.array(idSchema),
    identityRefs: z.array(idSchema),
    promotionOffer: promotionOfferCardSchema.optional(),
    opportunity: hotTopicOpportunityCardSchema.optional(),
    identityFallback: z.enum(['none', 'brand_official']).default('none'),
    materialSpecs: z.array(promotionalMaterialSpecSchema).optional(),
  })
  .strict()
  .superRefine((evidence, context) => {
    if (
      evidence.scene === 'promotion_groupbuy_conversion' &&
      !evidence.promotionOffer
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Promotion packages require an offer state.',
        path: ['promotionOffer'],
      });
    }
    if (evidence.scene === 'traffic_opportunity' && !evidence.opportunity) {
      context.addIssue({
        code: 'custom',
        message: 'Traffic opportunity packages require an opportunity card.',
        path: ['opportunity'],
      });
    }
    if (
      evidence.scene === 'routine_marketing_materials' &&
      (!evidence.materialSpecs || evidence.materialSpecs.length === 0)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Promotional material packages require at least one frozen output spec.',
        path: ['materialSpecs'],
      });
    }
  });

/**
 * Historical package JSON remains readable, but all new writes are normalized
 * to the fact-and-rights evidence shape. The legacy scene projection carried
 * heuristic opportunities and capability claims, neither of which is a
 * durable source of truth.
 */
export const marketingPackageEvidenceSchema = z
  .union([
    marketingPackageEvidenceCurrentSchema,
    legacyMarketingPackageEvidenceSchema,
  ])
  .transform((evidence) => {
    if ('declaration' in evidence) return evidence;
    return {
      declaration: {
        normalizedIntent: `Legacy ${evidence.scene} package`,
        taskType: evidence.scene,
        deliveryLayer: 'copy' as const,
        relevantAssetCategories: [],
        usedAssetCategories: [],
        route: 'customized' as const,
        routingSource: 'policy' as const,
        implicitConstraints: [],
      },
      contextBundle: evidence.contextBundle,
      factRefs: evidence.factRefs,
      rightsRefs: evidence.rightsRefs,
      identityRefs: evidence.identityRefs,
      identityFallback: evidence.identityFallback,
    };
  });

export type MarketingScene = z.infer<typeof marketingSceneSchema>;
export type PromotionOfferCard = z.infer<typeof promotionOfferCardSchema>;
export type HotTopicOpportunityCard = z.infer<
  typeof hotTopicOpportunityCardSchema
>;
export type MarketingIdentityAsset = z.infer<
  typeof marketingIdentityAssetSchema
>;
export type RegisterMarketingIdentityCommand = z.infer<
  typeof registerMarketingIdentityCommandSchema
>;
export type TransitionMarketingIdentityCommand = z.infer<
  typeof transitionMarketingIdentityCommandSchema
>;
export type MarketingIdentityQuery = z.infer<
  typeof marketingIdentityQuerySchema
>;
export type MarketingIdentityReference = z.infer<
  typeof marketingIdentityReferenceSchema
>;
export type SetDefaultMarketingIdentityCommand = z.infer<
  typeof setDefaultMarketingIdentityCommandSchema
>;
export type SelectMarketingIdentityForSessionCommand = z.infer<
  typeof selectMarketingIdentityForSessionCommandSchema
>;
export type RollbackDefaultMarketingIdentityCommand = z.infer<
  typeof rollbackDefaultMarketingIdentityCommandSchema
>;
export type MarketingIdentityDefaultDecision = z.infer<
  typeof marketingIdentityDefaultDecisionSchema
>;
export type MarketingIdentityProjection = z.infer<
  typeof marketingIdentityProjectionSchema
>;
export type PromotionalMaterialSpec = z.infer<
  typeof promotionalMaterialSpecSchema
>;
export type PromotionalMaterialReceipt = z.infer<
  typeof promotionalMaterialReceiptSchema
>;
export type PromotionalMaterialReceiptExtension = z.infer<
  typeof promotionalMaterialReceiptExtensionSchema
>;
export type QuickEditIntent = z.infer<typeof quickEditIntentSchema>;
export type QuickEditAction = z.infer<typeof quickEditActionSchema>;
export type QuickEditExportUse = z.infer<typeof quickEditExportUseSchema>;
export type QuickEditExportUseDelivery = z.infer<
  typeof quickEditExportUseDeliverySchema
>;
export type MarketingPackageEvidence = z.infer<
  typeof marketingPackageEvidenceSchema
>;
