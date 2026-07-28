import { z } from 'zod';

const idSchema = z.string().trim().min(1);
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
    label: z.string().trim().min(1),
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
    priceText: z.string().trim().min(1).optional(),
    benefitText: z.string().trim().min(1).optional(),
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
    source: z.string().trim().min(1),
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
    region: z.string().trim().min(1),
    targetAudience: z.string().trim().min(1),
    matchedStoreReferences: z.array(idSchema),
    relevanceExplanation: z.string().trim().min(1),
    reusableMechanism: z.string().trim().min(1),
    expectedAction: z.string().trim().min(1),
    evergreenFallback: z.string().trim().min(1),
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

const identityBaseSchema = z.object({
  identityId: idSchema,
  workspaceId: idSchema,
  version: z.number().int().positive(),
  status: z.enum(['active', 'revoked', 'departed', 'operator_changed']),
  displayName: z.string().trim().min(1),
  owner: z.string().trim().min(1),
  professionalBoundaries: z.array(z.string().trim().min(1)),
  allowedPlatforms: z.array(marketingIdentityPlatformSchema),
  allowedScenes: z.array(marketingSceneSchema),
  expressionSamples: z.array(z.string().trim().min(1).max(2_000)).max(20),
  effectiveFrom: timestampSchema,
  expiresAt: timestampSchema.nullable(),
  departureHandling: z.string().trim().min(1),
  sourceRef: idSchema,
  createdAt: timestampSchema,
  createdBy: idSchema,
});

const brandIdentitySchema = identityBaseSchema.extend({
      kind: z.literal('brand'),
      brandClaims: z.array(z.string().trim().min(1)).min(1),
      forbiddenClaims: z.array(z.string().trim().min(1)),
      visualPrinciples: z.array(z.string().trim().min(1)),
      seriesAnchors: z.array(z.string().trim().min(1)),
    });
const personIdentitySchema = identityBaseSchema.extend({
      kind: z.literal('person'),
      realWorldRole: z.string().trim().min(1),
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
  });

const identityRegistrationBaseSchema = identityBaseSchema
  .omit({
    workspaceId: true,
    version: true,
    status: true,
    createdAt: true,
    createdBy: true,
  })
  .extend({ expectedVersion: z.literal(0) });

export const registerMarketingIdentityCommandSchema = z.discriminatedUnion(
  'kind',
  [
    identityRegistrationBaseSchema.extend({
      kind: z.literal('brand'),
      brandClaims: z.array(z.string().trim().min(1)).min(1),
      forbiddenClaims: z.array(z.string().trim().min(1)),
      visualPrinciples: z.array(z.string().trim().min(1)),
      seriesAnchors: z.array(z.string().trim().min(1)),
    }),
    identityRegistrationBaseSchema.extend({
      kind: z.literal('person'),
      realWorldRole: z.string().trim().min(1),
      portraitAuthorization: z.enum(['authorized', 'not_authorized']),
      voiceAuthorization: z.enum(['authorized', 'not_authorized']),
      historicalContentPermission: z.enum([
        'retain_published',
        'review_required',
        'withdraw_if_possible',
      ]),
    }),
  ],
);

export const transitionMarketingIdentityCommandSchema = z
  .object({
    identityId: idSchema,
    expectedVersion: z.number().int().positive(),
    transition: z.enum(['revoke', 'depart', 'operator_change']),
    reason: z.string().trim().min(1),
  })
  .strict();

export const marketingIdentityQuerySchema = z
  .object({
    identityId: idSchema.optional(),
    includeInactive: z.boolean().default(false),
  })
  .strict();

export const marketingIdentityReferenceSchema = z
  .object({
    identityId: idSchema,
    version: z.number().int().positive(),
  })
  .strict();

export const setDefaultMarketingIdentityCommandSchema = z
  .object({
    expectedDecisionRevision: z.number().int().nonnegative(),
    identity: marketingIdentityReferenceSchema,
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export const selectMarketingIdentityForSessionCommandSchema = z
  .object({
    identity: marketingIdentityReferenceSchema.nullable(),
    reason: z.string().trim().min(1).max(500),
    sessionId: idSchema,
  })
  .strict();

export const rollbackDefaultMarketingIdentityCommandSchema = z
  .object({
    expectedDecisionRevision: z.number().int().positive(),
    reason: z.string().trim().min(1).max(500),
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
    aspectRatio: z.string().trim().min(1),
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
    rendererVersion: z.string().trim().min(1),
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
    objectKey: z.string().trim().min(1),
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
    instruction: z.string().trim().min(1).max(2_000),
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
      fileName: z.string().trim().min(1),
      kind: z.literal('formatted_text'),
      text: z.string().trim().min(1),
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
    normalizedIntent: z.string().trim().min(1).max(4_000),
    taskType: marketingSceneSchema,
    deliveryLayer: z.enum(['copy', 'finished_media']),
    relevantAssetCategories: z.array(z.string().trim().min(1)).max(20),
    usedAssetCategories: z.array(z.string().trim().min(1)).max(20),
    route: z.enum(['customized', 'guidance', 'free']),
    routingSource: z.enum(['entry', 'model', 'fallback', 'decision', 'policy']),
    implicitConstraints: z.array(z.string().trim().min(1)).max(30),
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
