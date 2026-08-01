import { z } from 'zod';
import {
  marketingPackageEvidenceSchema,
  quickEditExportUseDeliverySchema,
  quickEditIntentSchema,
} from './marketing-package.js';
import {
  approvalReceiptSchema,
  pendingApprovalRequestSchema,
} from './approval-receipt.js';
import { creativeExecutionContractSchema } from './uiux.js';
import { imageTextNoteVersionSchema } from './note-plan.js';

const contentPackageIdSchema = z.string().trim().min(1);
const contentPackageTimestampSchema = z.iso.datetime();

/**
 * ContentPackage wire/storage kind. Unchanged from v1 on purpose: every stored
 * row, export manifest and byte-identical replay fixture keys off these two
 * values, and the product口径 below is derived rather than persisted.
 */
export const contentPackageKindSchema = z.enum(['image_text', 'video']);

/**
 * Product carrier口径 (xhs-vertical-integration-spec §3.1 三枚举).
 * - media: single media asset (图/视频等)
 * - copy: pure text deliverable
 * - note: image-text composite (页组 + 封面 + 正文); XHS 图文成品即 note
 *
 * Landed as a derived classification over the unchanged wire kind (§3.1
 * 「迁移方式实施时定」→ 分层映射起步，不做破坏性数据迁移). Deriving instead of
 * widening `contentPackageKindSchema` keeps every `kind === 'video' ? … : …`
 * dispatch downstream sound: no branch can receive a value it cannot handle.
 */
export const contentPackageCarriers = ['media', 'copy', 'note'] as const;
export type ContentPackageCarrier = (typeof contentPackageCarriers)[number];

export const contentPackagePlatformSchema = z.enum([
  'xiaohongshu',
  'douyin',
  'video_account',
]);
export const contentPackageStatusSchema = z.enum([
  'draft',
  'needs_input',
  'generating',
  'verifying',
  'partial',
  'review_ready',
  'accepted',
  'needs_replacement',
  'cancelling',
  'cancelled',
  'save_unknown',
  'export_failed',
]);

export const videoCompositionEvidenceSchema = z
  .object({
    aigc: z.object({
      implicitMetadata: z.object({
        actual: z.boolean(),
        contentId: z.string().trim().min(1).optional(),
        contentType: z.literal('ai_generated').optional(),
        serviceCode: z.string().trim().min(1).optional(),
        serviceProvider: z.string().trim().min(1).optional(),
        validated: z.boolean(),
      }),
      requested: z.boolean(),
      validationMethod: z.enum([
        'composition_manifest',
        'ffprobe_metadata',
        'recorded_synthetic',
      ]),
      visibleLabel: z.object({
        actual: z.boolean(),
        validated: z.boolean(),
        value: z.string().trim().min(1).optional(),
      }),
    }),
    brandWatermark: z.object({
      actual: z.boolean(),
      requested: z.boolean(),
      text: z.string().trim().min(1).optional(),
      validated: z.boolean(),
      validationMethod: z.enum([
        'composition_manifest',
        'recorded_synthetic',
      ]),
    }),
    clipCount: z.number().int().positive(),
    durationSeconds: z.number().positive().optional(),
    height: z.number().int().positive().optional(),
    outputSha256: z.string().trim().min(1),
    outputSizeBytes: z.number().int().positive(),
    rendererRevision: z.string().trim().min(1),
    sourceAssetIds: z.array(contentPackageIdSchema).min(1),
    width: z.number().int().positive().optional(),
    delivery: z.object({
      compositionRevision: contentPackageIdSchema,
      storyboardRevision: contentPackageIdSchema,
      workflowId: contentPackageIdSchema,
      outputVideoSha256: z.string().regex(/^[a-f0-9]{64}$/),
      cover: z.object({
        id: contentPackageIdSchema,
        objectKey: contentPackageIdSchema,
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        sizeBytes: z.number().int().positive(),
        contentType: z.literal('image/jpeg'),
        validationMethod: z.enum(['ffmpeg_frame_extract', 'recorded_synthetic']),
      }),
      subtitles: z.object({
        format: z.literal('srt'),
        text: z.string().trim().min(1),
        durationSeconds: z.number().positive(),
        validationMethod: z.enum(['composition_manifest', 'recorded_synthetic']),
      }),
    }).optional(),
  })
  .superRefine((evidence, context) => {
    const aigcMatchesRequest = evidence.aigc.requested
      ? evidence.aigc.visibleLabel.actual &&
        evidence.aigc.visibleLabel.validated &&
        Boolean(evidence.aigc.visibleLabel.value) &&
        evidence.aigc.implicitMetadata.actual &&
        evidence.aigc.implicitMetadata.validated &&
        Boolean(evidence.aigc.implicitMetadata.contentId) &&
        Boolean(evidence.aigc.implicitMetadata.contentType) &&
        Boolean(evidence.aigc.implicitMetadata.serviceCode) &&
        Boolean(evidence.aigc.implicitMetadata.serviceProvider)
      : !evidence.aigc.visibleLabel.actual &&
        !evidence.aigc.implicitMetadata.actual;
    if (!aigcMatchesRequest) {
      context.addIssue({
        code: 'custom',
        message: 'AIGC evidence must match the requested label branch.',
        path: ['aigc'],
      });
    }
    const watermarkMatchesRequest = evidence.brandWatermark.requested
      ? evidence.brandWatermark.actual &&
        evidence.brandWatermark.validated &&
        Boolean(evidence.brandWatermark.text)
      : !evidence.brandWatermark.actual;
    if (!watermarkMatchesRequest) {
      context.addIssue({
        code: 'custom',
        message: 'Watermark evidence must match the requested branch.',
        path: ['brandWatermark'],
      });
    }
    if (evidence.clipCount !== evidence.sourceAssetIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'Composition clip count must match source Asset lineage.',
        path: ['clipCount'],
      });
    }
  });
export const contentPackageStatusGroupSchema = z.enum([
  'creating',
  'usable',
  'needs_attention',
]);

export type ContentPackageKind = z.infer<typeof contentPackageKindSchema>;
export type ContentPackagePlatform = z.infer<
  typeof contentPackagePlatformSchema
>;
export type ContentPackageStatus = z.infer<typeof contentPackageStatusSchema>;
export type ContentPackageStatusGroup = z.infer<
  typeof contentPackageStatusGroupSchema
>;

/**
 * Classify a ContentPackage version into the media/copy/note carrier口径.
 *
 * Total over the wire kinds and lossless: `video` is the single-media carrier,
 * and ContentPackage v1 carries both Composer 纯文案 and 图文成品 under the same
 * `image_text` kind — a copy revision is exactly the one without ordered media
 * assets (see `delivery-package.ts` `buildCopyDeliveryPackage`).
 */
export function contentPackageCarrierOf(input: {
  kind: ContentPackageKind;
  orderedAssetCount: number;
}): ContentPackageCarrier {
  if (input.kind === 'video') return 'media';
  return input.orderedAssetCount === 0 ? 'copy' : 'note';
}

const STATUS_GROUP_BY_STATUS = {
  accepted: 'usable',
  cancelled: 'needs_attention',
  cancelling: 'creating',
  draft: 'creating',
  export_failed: 'needs_attention',
  generating: 'creating',
  needs_input: 'needs_attention',
  needs_replacement: 'needs_attention',
  partial: 'needs_attention',
  review_ready: 'usable',
  save_unknown: 'needs_attention',
  verifying: 'creating',
} as const satisfies Record<ContentPackageStatus, ContentPackageStatusGroup>;

export const CONTENT_PACKAGE_STATUS_GROUP_LABELS = {
  creating: '创作中',
  needs_attention: '需处理',
  usable: '可使用',
} as const satisfies Record<ContentPackageStatusGroup, string>;

export function contentPackageStatusGroup(
  status: ContentPackageStatus
): ContentPackageStatusGroup {
  return STATUS_GROUP_BY_STATUS[status];
}

export function contentPackageStatusLabel(status: ContentPackageStatus) {
  return CONTENT_PACKAGE_STATUS_GROUP_LABELS[contentPackageStatusGroup(status)];
}

export function contentPackageVisibleStatus(status: ContentPackageStatus) {
  return {
    statusGroup: contentPackageStatusGroup(status),
    statusLabel: contentPackageStatusLabel(status),
  };
}

export type ContentPackageAction =
  | 'adopt'
  | 'cancel'
  | 'edit_text'
  | 'export'
  | 'recreate'
  | 'retry_export'
  | 'reuse'
  | 'view';

export const CONTENT_PACKAGE_ACTIONS_BY_STATUS = {
  accepted: ['view', 'edit_text', 'export', 'reuse', 'cancel'],
  cancelled: ['view'],
  cancelling: ['view'],
  draft: ['view', 'cancel'],
  export_failed: ['view', 'edit_text', 'retry_export'],
  generating: ['view', 'cancel'],
  needs_input: ['view', 'cancel'],
  needs_replacement: ['view', 'edit_text', 'recreate', 'cancel'],
  partial: ['view', 'cancel'],
  review_ready: ['view', 'edit_text', 'adopt', 'cancel'],
  save_unknown: ['view'],
  verifying: ['view', 'cancel'],
} as const satisfies Record<
  ContentPackageStatus,
  readonly ContentPackageAction[]
>;

export function contentPackageActions(
  status: ContentPackageStatus
): readonly ContentPackageAction[] {
  return CONTENT_PACKAGE_ACTIONS_BY_STATUS[status];
}

export const CONTENT_PACKAGE_STATUS_CONTRACTS = [
  {
    mustBehavior: '不创建付费任务，原地补齐',
    scenario: '信息或授权缺失',
    status: 'draft / needs_input',
    statuses: ['draft', 'needs_input'],
  },
  {
    mustBehavior: '使用原幂等键，只查询',
    scenario: '已持久化但受理未知',
    status: 'generating / verifying',
    statuses: ['generating', 'verifying'],
  },
  {
    mustBehavior: '保留成功，仅重试失败子任务',
    scenario: '子任务部分成功',
    status: 'partial',
    statuses: ['partial'],
  },
  {
    mustBehavior: '不再显示 running',
    scenario: '供应商完成',
    status: 'review_ready',
    statuses: ['review_ready'],
  },
  {
    mustBehavior: '展示真实状态，限制重提',
    scenario: '取消中/已取消',
    status: 'cancelling / cancelled',
    statuses: ['cancelling', 'cancelled'],
  },
  {
    mustBehavior: '幂等查询/重放，不重复版本',
    scenario: '保存结果未知',
    status: 'save_unknown',
    statuses: ['save_unknown'],
  },
  {
    mustBehavior: '进入唯一内容库并形成版本',
    scenario: '用户采用',
    status: 'accepted',
    statuses: ['accepted'],
  },
  {
    mustBehavior: '阻止新导出，提示替换',
    scenario: '授权撤销',
    status: 'needs_replacement',
    statuses: ['needs_replacement'],
  },
  {
    mustBehavior: '成品不回退，只重试导出',
    scenario: '单个平台导出失败',
    status: 'accepted / export_failed',
    statuses: ['accepted', 'export_failed'],
  },
  {
    mustBehavior: '使用已归档本地文件',
    scenario: '供应商 URL 过期',
    status: '状态不变',
    statuses: [],
  },
] as const satisfies ReadonlyArray<{
  mustBehavior: string;
  scenario: string;
  status: string;
  statuses: readonly ContentPackageStatus[];
}>;

export const contentPackageSourceSchema = z.object({
  aigcLabelEnabled: z.boolean().optional(),
  assetIds: z.array(contentPackageIdSchema).default([]),
  briefId: contentPackageIdSchema.optional(),
  catalogModelId: contentPackageIdSchema.optional(),
  dataClass: z.array(z.string().trim().min(1)).optional(),
  executionContract: creativeExecutionContractSchema.optional(),
  compositionRevision: contentPackageIdSchema.optional(),
  creationExecutionSnapshot: z
    .object({
      id: contentPackageIdSchema,
      revision: z.number().int().positive(),
      schemaVersion: z.literal('creation-execution-snapshot/v1'),
      modelSelection: z
        .object({
          source: z.enum([
            'current_selection',
            'user_default',
            'workspace_default',
            'platform_default',
          ]),
          catalogModelId: contentPackageIdSchema,
          platformConfigRevision: contentPackageIdSchema.nullable(),
        })
        .strict()
        .optional(),
    })
    .strict()
    .optional(),
  sourceContentPackage: z
    .object({
      id: contentPackageIdSchema,
      revision: contentPackageIdSchema,
    })
    .strict()
    .optional(),
  groundingId: contentPackageIdSchema.optional(),
  layoutCanvas: z
    .object({
      exportReceiptId: contentPackageIdSchema,
      schemaVersion: z.literal(1),
      workId: contentPackageIdSchema,
      workRevisionId: contentPackageIdSchema,
    })
    .optional(),
  shots: z
    .array(
      z.object({
        id: contentPackageIdSchema,
        prompt: z.string().trim().min(1),
      })
    )
    .optional(),
  storeProfileId: contentPackageIdSchema.optional(),
  storyboardRevision: contentPackageIdSchema.optional(),
  storyboardVersion: z.number().int().positive().optional(),
  targetPlatform: contentPackagePlatformSchema.optional(),
  workflowId: contentPackageIdSchema.optional(),
  workflowRevision: z.number().int().nonnegative().optional(),
  workId: contentPackageIdSchema.optional(),
});

export const contentPackageChildRunSchema = z.object({
  actualCatalogModelId: contentPackageIdSchema.optional(),
  apiCounterparty: contentPackageIdSchema.optional(),
  assetIds: z.array(contentPackageIdSchema).optional(),
  failureCode: contentPackageIdSchema.optional(),
  productUsage: z
    .object({
      quantity: z.number().int().nonnegative(),
      status: z.enum(['reserved', 'committed', 'refunded']),
    })
    .optional(),
  providerCost: z
    .object({
      amount: z.number().nonnegative(),
      currency: z.enum(['CNY', 'USD']),
      status: z.enum(['estimated', 'observed']),
    })
    .optional(),
  providerAttempts: z
    .array(
      z.object({
        acceptance: z.enum([
          'rejected_before_accept',
          'accepted',
          'acceptance_unknown',
        ]),
        catalogModelId: contentPackageIdSchema,
        createdAt: contentPackageTimestampSchema,
        deploymentId: contentPackageIdSchema,
        id: contentPackageIdSchema,
        jobId: contentPackageIdSchema,
        providerTaskRef: contentPackageIdSchema.optional(),
        status: z.enum(['completed', 'unknown', 'failed']),
      })
    )
    .optional(),
  providerCosts: z
    .array(
      z.object({
        amount: z.number().nonnegative(),
        currency: z.enum(['CNY', 'USD']),
        id: contentPackageIdSchema,
        status: z.enum(['estimated', 'observed']),
        usage: z.object({
          inputTokens: z.number().nonnegative().optional(),
          mediaUnits: z.number().nonnegative().optional(),
          outputTokens: z.number().nonnegative().optional(),
        }),
      })
    )
    .optional(),
  providerModel: contentPackageIdSchema.optional(),
  routeSnapshotId: contentPackageIdSchema.optional(),
  routeSnapshot: z
    .object({
      actualCatalogModelId: contentPackageIdSchema,
      apiCounterparty: contentPackageIdSchema.optional(),
      catalogRevisionId: contentPackageIdSchema,
      deploymentId: contentPackageIdSchema,
      endpointRevision: contentPackageIdSchema.optional(),
      id: contentPackageIdSchema,
      providerModel: contentPackageIdSchema.optional(),
    })
    .optional(),
  runId: contentPackageIdSchema,
  runType: z.enum([
    'creative_job',
    'canvas_image_job',
    'durable_video_workflow',
    'model_job',
  ]),
  status: z
    .enum(['pending', 'running', 'succeeded', 'failed', 'cancelled'])
    .optional(),
});

export const contentPackageGeneratedSchema = z.object({
  assetIds: z.array(contentPackageIdSchema).default([]),
  childRuns: z.array(contentPackageChildRunSchema).default([]),
  ownedAssets: z
    .array(
      z.object({
        compositionEvidence: videoCompositionEvidenceSchema.optional(),
        contentType: z.string().trim().min(1),
        id: contentPackageIdSchema,
        objectKey: z.string().trim().min(1),
        sha256: z.string().trim().min(1),
        sizeBytes: z.number().int().positive().optional(),
        sourceAssetId: contentPackageIdSchema.optional(),
        sourceTaskRef: contentPackageIdSchema.optional(),
      })
    )
    .optional(),
});

export const advancedCanvasContentPackageSourceRefSchema = z
  .object({
    orderedMediaNodeIds: z.array(contentPackageIdSchema),
    projectId: contentPackageIdSchema,
    revisionId: contentPackageIdSchema,
    schemaVersion: z.number().int().positive(),
    selectedNodeIds: z.array(contentPackageIdSchema),
  })
  .passthrough();

export const contentPackageVersionSourceRefSchema = z.object({
  advancedCanvas: advancedCanvasContentPackageSourceRefSchema,
});
export const CONTENT_PACKAGE_ADVANCED_CANVAS_SOURCE_REF_SCHEMA_VERSION = 1;

export function contentPackageVersionSourceRefIsReadOnly(
  sourceRef: z.infer<typeof contentPackageVersionSourceRefSchema>
) {
  return (
    sourceRef.advancedCanvas.schemaVersion >
    CONTENT_PACKAGE_ADVANCED_CANVAS_SOURCE_REF_SCHEMA_VERSION
  );
}

export const contentPackageVersionSchema = z.object({
  body: z.string(),
  conversionHook: z.string().optional(),
  createdAt: contentPackageTimestampSchema,
  createdBy: contentPackageIdSchema.optional(),
  derivedFromVersionId: contentPackageIdSchema.optional(),
  editIntent: quickEditIntentSchema.optional(),
  exportUseDelivery: quickEditExportUseDeliverySchema.optional(),
  id: contentPackageIdSchema,
  harnessCandidateId: contentPackageIdSchema.optional(),
  harnessScore: z.number().min(0).max(100).optional(),
  orderedAssetIds: z.array(contentPackageIdSchema),
  revertedFromVersionId: contentPackageIdSchema.optional(),
  source: z
    .enum(['ai_generated', 'merchant_edited', 'rollback_restored'])
    .optional(),
  sourceRef: contentPackageVersionSourceRefSchema.optional(),
  note: imageTextNoteVersionSchema.optional(),
  title: z.string(),
  topics: z.array(z.string().trim().min(1)).default([]),
});

export const contentPackageVariantSchema = z.object({
  currentVersionId: contentPackageIdSchema,
  id: contentPackageIdSchema,
  platform: contentPackagePlatformSchema,
  versions: z.array(contentPackageVersionSchema).min(1),
});

export const contentPackageRightsSchema = z
  .object({
    reason: z.string().trim().min(1).optional(),
    revokedAt: contentPackageTimestampSchema.optional(),
    state: z.enum(['authorized', 'revoked']),
  })
  .superRefine((rights, context) => {
    if (rights.state === 'revoked' && !rights.revokedAt) {
      context.addIssue({
        code: 'custom',
        message:
          'revokedAt is required when ContentPackage rights are revoked.',
        path: ['revokedAt'],
      });
    }
    if (rights.state === 'authorized' && rights.revokedAt) {
      context.addIssue({
        code: 'custom',
        message: 'Authorized ContentPackage rights cannot have revokedAt.',
        path: ['revokedAt'],
      });
    }
  });

export const contentPackageComplianceSchema = z.object({
  aigcLabelEnabled: z.boolean(),
  watermarkEnabled: z.boolean(),
  watermarkText: z.string().trim().min(1).optional(),
});

export const contentPackageExportReceiptSchema = z
  .object({
    appliedCompliance: z
      .object({
        aigcLabelEnabled: z.boolean(),
        watermarkEnabled: z.boolean(),
        watermarkText: z.string().trim().min(1).optional(),
      })
      .optional(),
    artifactAssetId: contentPackageIdSchema.optional(),
    artifactObjectKey: z.string().trim().min(1).optional(),
    contentType: z.enum(['application/zip', 'video/mp4']).optional(),
    correlationId: contentPackageIdSchema.optional(),
    createdAt: contentPackageTimestampSchema,
    failureCategory: z.string().trim().min(1).optional(),
    id: contentPackageIdSchema,
    platform: contentPackagePlatformSchema,
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    sizeBytes: z.number().int().nonnegative().optional(),
    /** Immutable shared-object receipt version used by deletion claims. */
    storageRevision: z.string().trim().min(1).optional(),
    status: z.enum(['succeeded', 'failed']),
    variantVersionId: contentPackageIdSchema,
  })
  .superRefine((receipt, context) => {
    if (receipt.status === 'succeeded' && !receipt.artifactAssetId) {
      context.addIssue({
        code: 'custom',
        message: 'Successful exports must reference an owned artifact Asset.',
        path: ['artifactAssetId'],
      });
    }
    if (receipt.status === 'failed' && !receipt.failureCategory) {
      context.addIssue({
        code: 'custom',
        message: 'Failed exports must include a normalized failure category.',
        path: ['failureCategory'],
      });
    }
  });

const contentPackageDeliveryEventBaseSchema = z.object({
  actorId: contentPackageIdSchema,
  id: contentPackageIdSchema,
  occurredAt: contentPackageTimestampSchema,
  platform: contentPackagePlatformSchema,
  source: z.enum(['native', 'legacy_read_only']),
  variantVersionId: contentPackageIdSchema,
});

export function contentPackageDeliveryAttemptId(approvalReceiptId: string) {
  return `content-package-delivery:${approvalReceiptId}`;
}

export const contentPackageDeliveryIdentitySchema = z
  .object({
    approvalReceiptId: contentPackageIdSchema,
    deliveryAttemptId: contentPackageIdSchema,
    schema: z.literal('approval_receipt_v1'),
  })
  .superRefine((identity, context) => {
    if (
      identity.deliveryAttemptId !==
      contentPackageDeliveryAttemptId(identity.approvalReceiptId)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Delivery attempt identity must be derived from its approval receipt.',
        path: ['deliveryAttemptId'],
      });
    }
  });

export const contentPackageDeliveryEventSchema = z.discriminatedUnion('type', [
  contentPackageDeliveryEventBaseSchema.extend({
    artifactReceiptId: contentPackageIdSchema.optional(),
    deliveryIdentity: contentPackageDeliveryIdentitySchema.optional(),
    type: z.literal('assisted_handoff_prepared'),
  }),
  contentPackageDeliveryEventBaseSchema.extend({
    deliveryIdentity: contentPackageDeliveryIdentitySchema.optional(),
    platformUrl: z.url().optional(),
    providerReceiptId: contentPackageIdSchema,
    status: z.enum(['published', 'failed', 'unknown']),
    type: z.literal('automatic_publish_result'),
  }),
  contentPackageDeliveryEventBaseSchema.extend({
    accountDisplayLabel: z.string().trim().min(1).optional(),
    note: z.string().trim().min(1).optional(),
    platformUrl: z.url().optional(),
    status: z.enum(['published', 'failed', 'unknown']),
    type: z.literal('manual_publish_result'),
  }),
  contentPackageDeliveryEventBaseSchema.extend({
    operation: z.enum([
      'package_created',
      'opened',
      'downloaded',
      'shared',
      'copied',
      'published',
    ]),
    type: z.literal('legacy_handoff_event'),
  }),
]);

export const contentPackageDeliveryCapabilitySchema = z.object({
  mode: z.enum(['automatic_verified', 'assisted', 'unavailable']),
  platform: contentPackagePlatformSchema,
  reason: z.string().trim().min(1),
});

export const contentPackageResultSignalSchema = z.object({
  actorId: contentPackageIdSchema,
  id: contentPackageIdSchema,
  kind: z.enum([
    'attention',
    'inquiry',
    'contact_added',
    'private_message',
    'wechat_added',
    'appointment',
    'voucher_purchase',
    'voucher_purchased',
    'redemption',
    'redeemed',
    'store_visit',
  ]),
  note: z.string().trim().min(1).optional(),
  occurredAt: contentPackageTimestampSchema,
  quantity: z.number().int().positive().optional(),
  source: z.enum([
    'verified_adapter',
    'merchant_recorded',
    'inferred_temporal',
  ]),
});

export const contentPackageResultReviewActionSchema = z.object({
  action: z.enum([
    'continue_series',
    'change_cta',
    'change_platform',
    'stop_series',
  ]),
  actorId: contentPackageIdSchema,
  id: contentPackageIdSchema,
  occurredAt: contentPackageTimestampSchema,
});

export const contentPackageLineageSchema = z.object({
  reusedFromPackageId: contentPackageIdSchema.optional(),
});

export const contentPackageLegacySourceSchema = z.object({
  mappingConfidence: z.enum(['exact', 'partial', 'unknown']),
  sourceId: contentPackageIdSchema,
  sourceType: z.enum([
    'product_content_item',
    'creative_content',
    'durable_video_workflow',
  ]),
});

export const contentPackageSchema = z
  .object({
    compliance: contentPackageComplianceSchema,
    createdAt: contentPackageTimestampSchema,
    approvalRequests: z.array(pendingApprovalRequestSchema).optional(),
    approvalReceipts: z.array(approvalReceiptSchema).optional(),
    deliveryEvents: z.array(contentPackageDeliveryEventSchema).optional(),
    resultReviewActions: z
      .array(contentPackageResultReviewActionSchema)
      .optional(),
    resultSignals: z.array(contentPackageResultSignalSchema).optional(),
    exportReceipts: z.array(contentPackageExportReceiptSchema),
    generated: contentPackageGeneratedSchema,
    harnessSelection: z
      .object({
        adoptedCandidateId: contentPackageIdSchema.optional(),
        recommendedCandidateId: contentPackageIdSchema,
      })
      .optional(),
    id: contentPackageIdSchema,
    kind: contentPackageKindSchema,
    legacySource: contentPackageLegacySourceSchema.optional(),
    marketing: marketingPackageEvidenceSchema.optional(),
    lineage: contentPackageLineageSchema,
    revision: z.number().int().nonnegative().default(0),
    currentVersionId: contentPackageIdSchema.optional(),
    rights: contentPackageRightsSchema,
    source: contentPackageSourceSchema,
    status: contentPackageStatusSchema,
    updatedAt: contentPackageTimestampSchema,
    variants: z.array(contentPackageVariantSchema),
    versions: z.array(contentPackageVersionSchema),
    workspaceId: contentPackageIdSchema,
  })
  .superRefine((contentPackage, context) => {
    const versionIds = contentPackage.versions.map((version) => version.id);
    if (new Set(versionIds).size !== versionIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'ContentPackage version ids must be unique.',
        path: ['versions'],
      });
    }
    if (
      contentPackage.currentVersionId &&
      !versionIds.includes(contentPackage.currentVersionId)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'currentVersionId must reference a ContentPackage version.',
        path: ['currentVersionId'],
      });
    }
    const harnessCandidateIds = contentPackage.versions.flatMap((version) =>
      version.harnessCandidateId ? [version.harnessCandidateId] : [],
    );
    if (new Set(harnessCandidateIds).size !== harnessCandidateIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'Harness candidate ids must be unique.',
        path: ['versions'],
      });
    }
    if (
      contentPackage.harnessSelection &&
      !harnessCandidateIds.includes(
        contentPackage.harnessSelection.recommendedCandidateId,
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'The recommended Harness candidate must be persisted.',
        path: ['harnessSelection', 'recommendedCandidateId'],
      });
    }
    if (
      contentPackage.harnessSelection?.adoptedCandidateId &&
      !harnessCandidateIds.includes(
        contentPackage.harnessSelection.adoptedCandidateId,
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'The adopted Harness candidate must be persisted.',
        path: ['harnessSelection', 'adoptedCandidateId'],
      });
    }
    const platforms = contentPackage.variants.map(
      (variant) => variant.platform
    );
    if (
      !contentPackage.legacySource &&
      platforms.length !== 0 &&
      platforms.length !== 3
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'ContentPackage variants must be empty or contain all three platforms.',
        path: ['variants'],
      });
    }
    if (new Set(platforms).size !== platforms.length) {
      context.addIssue({
        code: 'custom',
        message: 'ContentPackage variants must use unique platforms.',
        path: ['variants'],
      });
    }
    for (const [variantIndex, variant] of contentPackage.variants.entries()) {
      const variantVersionIds = variant.versions.map((version) => version.id);
      if (new Set(variantVersionIds).size !== variantVersionIds.length) {
        context.addIssue({
          code: 'custom',
          message: 'ContentPackage variant version ids must be unique.',
          path: ['variants', variantIndex, 'versions'],
        });
      }
      if (!variantVersionIds.includes(variant.currentVersionId)) {
        context.addIssue({
          code: 'custom',
          message: 'Variant currentVersionId must reference a variant version.',
          path: ['variants', variantIndex, 'currentVersionId'],
        });
      }
    }
  });

export type ContentPackageSource = z.infer<typeof contentPackageSourceSchema>;
export type VideoCompositionEvidence = z.infer<
  typeof videoCompositionEvidenceSchema
>;
export type ContentPackageChildRun = z.infer<
  typeof contentPackageChildRunSchema
>;
export type ContentPackageVersion = z.infer<typeof contentPackageVersionSchema>;
export type ContentPackageVersionSourceRef = z.infer<
  typeof contentPackageVersionSourceRefSchema
>;
export type ContentPackageExportReceipt = z.infer<
  typeof contentPackageExportReceiptSchema
>;
export type ContentPackageDeliveryCapability = z.infer<
  typeof contentPackageDeliveryCapabilitySchema
>;
export type ContentPackageDeliveryEvent = z.infer<
  typeof contentPackageDeliveryEventSchema
>;
export type ContentPackageResultSignal = z.infer<
  typeof contentPackageResultSignalSchema
>;
export type ContentPackageResultReviewAction = z.infer<
  typeof contentPackageResultReviewActionSchema
>;
export type ContentPackageLegacySource = z.infer<
  typeof contentPackageLegacySourceSchema
>;
export type ContentPackage = z.infer<typeof contentPackageSchema>;

const contentPackageExpectedRevisionSchema = z.number().int().nonnegative();
export const adoptIntoContentPackageCommandSchema = z.object({
  copyCandidateAssetId: contentPackageIdSchema,
  visualAssetIds: z.array(contentPackageIdSchema).min(1),
  workId: contentPackageIdSchema,
});
/**
 * Re-adopt / replace / set-cover after first adoption.
 * Creates one derived immutable version under expectedRevision OCC.
 * User adoption path only — not generation attachment.
 */
export const reviseContentPackageVisualsCommandSchema = z.object({
  baseVersionId: contentPackageIdSchema,
  expectedRevision: contentPackageExpectedRevisionSchema,
  orderedVisualAssetIds: z.array(contentPackageIdSchema).min(1),
  packageId: contentPackageIdSchema,
  /** Optional role-action label for audit (does not change write semantics). */
  roleAction: z
    .enum([
      'adopt_one',
      'set_primary',
      'set_cover',
      'adopt_set',
      'replace_set',
    ])
    .optional(),
});
export type ReviseContentPackageVisualsCommand = z.infer<
  typeof reviseContentPackageVisualsCommandSchema
>;

/**
 * Role-facing picture actions. Server write family is first-adopt or
 * revise_content_package_visuals; add_to_set stays local working-selection.
 */
export type VisualAdoptionRoleAction =
  | { kind: 'adopt_one'; assetId: string }
  | { kind: 'set_primary'; assetId: string }
  | { kind: 'set_cover'; assetId: string }
  | { kind: 'add_to_set'; assetId: string }
  | { kind: 'adopt_set'; assetIds: string[] }
  | { kind: 'replace_set'; assetIds: string[] };

export const adoptHarnessCandidateCommandSchema = z.object({
  candidateId: contentPackageIdSchema,
  expectedRevision: contentPackageExpectedRevisionSchema,
  packageId: contentPackageIdSchema,
});
export const adoptCanvasWorkExportCommandSchema = z.object({
  exportReceiptId: contentPackageIdSchema,
  workId: contentPackageIdSchema,
  workRevisionId: contentPackageIdSchema,
});
export const editContentPackageVersionCommandSchema = z.object({
  baseVersionId: contentPackageIdSchema,
  changes: contentPackageVersionSchema.pick({
    body: true,
    conversionHook: true,
    note: true,
    orderedAssetIds: true,
    title: true,
    topics: true,
  }),
  expectedRevision: contentPackageExpectedRevisionSchema,
  intent: quickEditIntentSchema.optional(),
  packageId: contentPackageIdSchema,
}).superRefine((command, context) => {
  if (command.intent && command.intent.baseVersionId !== command.baseVersionId) {
    context.addIssue({
      code: 'custom',
      message: 'Quick edit intent must target the command base version.',
      path: ['intent', 'baseVersionId'],
    });
  }
});
export const rollbackContentPackageVersionCommandSchema = z.object({
  expectedRevision: contentPackageExpectedRevisionSchema,
  packageId: contentPackageIdSchema,
  targetVersionId: contentPackageIdSchema,
});
export const contentPackageVariantGenerationContractSchema =
  creativeExecutionContractSchema.extend({
    operation: z.literal('copy.adapt'),
    outputCount: z.literal(3),
  });
export const generateContentPackageVariantsCommandSchema = z.object({
  billingQuoteId: contentPackageIdSchema.optional(),
  billingTaskId: contentPackageIdSchema.optional(),
  contract: contentPackageVariantGenerationContractSchema,
  expectedRevision: contentPackageExpectedRevisionSchema,
  packageId: contentPackageIdSchema,
  submissionKey: contentPackageIdSchema,
}).superRefine((command, context) => {
  if (Boolean(command.billingQuoteId) !== Boolean(command.billingTaskId)) {
    context.addIssue({
      code: 'custom',
      message: 'billingQuoteId and billingTaskId must be provided together.',
      path: ['billingQuoteId'],
    });
  }
});
const contentPackageExternalActionSchema = z.object({
  accountId: contentPackageIdSchema,
  actionKind: z.enum(['publish', 'paid_action']),
  actionScheduledAt: contentPackageTimestampSchema,
  cost: z.object({
    amount: z.number().nonnegative(),
    currency: z.enum(['CNY', 'USD']),
  }),
  expectedRevision: contentPackageExpectedRevisionSchema,
  packageId: contentPackageIdSchema,
  platform: contentPackagePlatformSchema,
  purpose: contentPackageIdSchema,
  variantVersionId: contentPackageIdSchema,
});
export const approveContentPackageActionCommandSchema =
  contentPackageExternalActionSchema.extend({
    approvalKey: contentPackageIdSchema,
    requestId: contentPackageIdSchema,
  });
export const deliverContentPackageCommandSchema =
  contentPackageExternalActionSchema.extend({
    receiptId: contentPackageIdSchema.optional(),
  });
export const recordContentPackageManualResultCommandSchema = z.object({
  accountDisplayLabel: z.string().trim().min(1).optional(),
  expectedRevision: contentPackageExpectedRevisionSchema,
  note: z.string().trim().min(1).optional(),
  packageId: contentPackageIdSchema,
  platform: contentPackagePlatformSchema,
  platformUrl: z.url().optional(),
  publishedAt: z.iso.datetime().optional(),
  status: z.enum(['published', 'failed', 'unknown']),
  variantVersionId: contentPackageIdSchema,
});
export const recordContentPackageResultSignalCommandSchema = z.object({
  expectedRevision: contentPackageExpectedRevisionSchema,
  kind: contentPackageResultSignalSchema.shape.kind,
  note: z.string().trim().min(1).optional(),
  /**
   * When the merchant says it happened — 「这是昨天的」. Absent means now.
   * Backdating moves the signal's own clock only; the package's updatedAt and
   * its audit row still carry the moment the row was written.
   *
   * Format only. The window it must land in (no future, at most
   * RESULT_SIGNAL_BACKDATE_WINDOW_DAYS back) is decided against the write clock
   * in the core delivery service, which is the only place that clock exists.
   */
  occurredAt: contentPackageTimestampSchema.optional(),
  packageId: contentPackageIdSchema,
  quantity: z.number().int().positive().optional(),
});
export const recordContentPackageResultReviewActionCommandSchema = z.object({
  action: contentPackageResultReviewActionSchema.shape.action,
  expectedRevision: contentPackageExpectedRevisionSchema,
  packageId: contentPackageIdSchema,
});
export const contentPackageMigrationCommandSchema = z.object({
  runId: contentPackageIdSchema,
});
export const contentPackageMigrationQuerySchema = z.object({
  runId: contentPackageIdSchema,
});

export const contentPackageMigrationDifferenceReportSchema = z.object({
  assetReceipts: z.array(z.string()),
  countsByKind: z.object({
    creative_content: z.number().int().nonnegative(),
    durable_video_workflow: z.number().int().nonnegative(),
    product_content_item: z.number().int().nonnegative(),
  }),
  lineage: z.array(z.string()),
  stableIds: z.array(z.string()),
  statuses: z.array(z.string()),
  variantVersions: z.array(z.string()),
  variants: z.array(z.string()),
});
export const contentPackageMigrationReportSchema = z.object({
  actualPackages: z.number().int().nonnegative(),
  differences: contentPackageMigrationDifferenceReportSchema,
  expectedPackages: z.number().int().nonnegative(),
  generatedAt: contentPackageTimestampSchema,
  mappingRuleVersion: z.literal('contentpackage-legacy-v1'),
  runId: contentPackageIdSchema,
  workspaceId: contentPackageIdSchema,
});
export const contentPackageMigrationRunSchema = z.object({
  backupVerified: z.boolean().optional(),
  lastReport: contentPackageMigrationReportSchema.optional(),
  runId: contentPackageIdSchema,
  stage: z.enum([
    'inspected',
    'dry_run',
    'frozen',
    'backfilled',
    'active',
    'rolled_back',
  ]),
  updatedAt: contentPackageTimestampSchema,
  workspaceId: contentPackageIdSchema,
});

export const contentPackageQuerySchema = z.object({
  packageId: contentPackageIdSchema,
});
export const contentPackagesQuerySchema = z.object({}).strict();

export const CONTENT_PACKAGE_COMMAND_SCHEMAS = {
  adopt_harness_candidate: adoptHarnessCandidateCommandSchema,
  adopt_canvas_work_export: adoptCanvasWorkExportCommandSchema,
  adopt_into_content_package: adoptIntoContentPackageCommandSchema,
  approve_content_package_action: approveContentPackageActionCommandSchema,
  edit_content_package_version: editContentPackageVersionCommandSchema,
  deliver_content_package: deliverContentPackageCommandSchema,
  generate_content_package_variants:
    generateContentPackageVariantsCommandSchema,
  content_package_migration_activate: contentPackageMigrationCommandSchema,
  content_package_migration_backfill: contentPackageMigrationCommandSchema,
  content_package_migration_dry_run: contentPackageMigrationCommandSchema,
  content_package_migration_freeze: contentPackageMigrationCommandSchema,
  content_package_migration_inspect: contentPackageMigrationCommandSchema,
  content_package_migration_rollback: contentPackageMigrationCommandSchema,
  record_content_package_manual_result:
    recordContentPackageManualResultCommandSchema,
  record_content_package_result_signal:
    recordContentPackageResultSignalCommandSchema,
  record_content_package_result_review_action:
    recordContentPackageResultReviewActionCommandSchema,
  revise_content_package_visuals: reviseContentPackageVisualsCommandSchema,
  rollback_content_package_version: rollbackContentPackageVersionCommandSchema,
} as const;

export const CONTENT_PACKAGE_QUERY_SCHEMAS = {
  content_package: contentPackageQuerySchema,
  content_packages: contentPackagesQuerySchema,
  content_package_delivery_timeline: contentPackageQuerySchema,
  content_package_results: contentPackageQuerySchema,
  content_package_migration_report: contentPackageMigrationQuerySchema,
  content_package_migration_status: contentPackageMigrationQuerySchema,
} as const;
