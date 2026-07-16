import { z } from 'zod';
import { creativeExecutionContractSchema } from './uiux.js';

const contentPackageIdSchema = z.string().trim().min(1);
const contentPackageTimestampSchema = z.iso.datetime();

export const contentPackageKindSchema = z.enum(['image_text', 'video']);
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
  needs_replacement: ['view', 'recreate', 'cancel'],
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
  workflowId: contentPackageIdSchema.optional(),
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
  providerModel: contentPackageIdSchema.optional(),
  routeSnapshotId: contentPackageIdSchema.optional(),
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
        contentType: z.string().trim().min(1),
        id: contentPackageIdSchema,
        objectKey: z.string().trim().min(1),
        sha256: z.string().trim().min(1),
        sizeBytes: z.number().int().positive().optional(),
        sourceAssetId: contentPackageIdSchema.optional(),
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
  id: contentPackageIdSchema,
  orderedAssetIds: z.array(contentPackageIdSchema),
  revertedFromVersionId: contentPackageIdSchema.optional(),
  source: z
    .enum(['ai_generated', 'merchant_edited', 'rollback_restored'])
    .optional(),
  sourceRef: contentPackageVersionSourceRefSchema.optional(),
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
    exportReceipts: z.array(contentPackageExportReceiptSchema),
    generated: contentPackageGeneratedSchema,
    id: contentPackageIdSchema,
    kind: contentPackageKindSchema,
    legacySource: contentPackageLegacySourceSchema.optional(),
    lineage: contentPackageLineageSchema,
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
export type ContentPackageLegacySource = z.infer<
  typeof contentPackageLegacySourceSchema
>;
export type ContentPackage = z.infer<typeof contentPackageSchema>;

export const createContentPackageCommandSchema = z.object({
  kind: contentPackageKindSchema,
  source: contentPackageSourceSchema,
});
export const cancelContentPackageCommandSchema = z.object({
  packageId: contentPackageIdSchema,
});
export const revokeContentPackageRightsCommandSchema = z.object({
  packageId: contentPackageIdSchema,
  reason: z.string().trim().min(1).optional(),
});
export const adoptIntoContentPackageCommandSchema = z.object({
  copyCandidateAssetId: contentPackageIdSchema,
  visualAssetIds: z.array(contentPackageIdSchema).min(1),
  workId: contentPackageIdSchema,
});
export const adoptCanvasWorkExportCommandSchema = z.object({
  exportReceiptId: contentPackageIdSchema,
  workId: contentPackageIdSchema,
  workRevisionId: contentPackageIdSchema,
});
export const attachContentPackageGenerationCommandSchema = z.object({
  assetIds: z.array(contentPackageIdSchema),
  childRun: contentPackageChildRunSchema,
  packageId: contentPackageIdSchema,
});
export const editContentPackageVersionCommandSchema = z.object({
  baseVersionId: contentPackageIdSchema,
  changes: contentPackageVersionSchema.pick({
    body: true,
    conversionHook: true,
    orderedAssetIds: true,
    title: true,
    topics: true,
  }),
  packageId: contentPackageIdSchema,
});
export const rollbackContentPackageVersionCommandSchema = z.object({
  packageId: contentPackageIdSchema,
  targetVersionId: contentPackageIdSchema,
});
export const contentPackageVariantGenerationContractSchema =
  creativeExecutionContractSchema.extend({
    operation: z.literal('copy.adapt'),
    outputCount: z.literal(3),
  });
export const generateContentPackageVariantsCommandSchema = z.object({
  contract: contentPackageVariantGenerationContractSchema,
  packageId: contentPackageIdSchema,
  submissionKey: contentPackageIdSchema,
});
export const editContentPackageVariantCommandSchema = z.object({
  baseVersionId: contentPackageIdSchema,
  changes: contentPackageVersionSchema.pick({
    body: true,
    conversionHook: true,
    orderedAssetIds: true,
    title: true,
    topics: true,
  }),
  packageId: contentPackageIdSchema,
  platform: contentPackagePlatformSchema,
});
export const exportContentPackageCommandSchema = z.object({
  packageId: contentPackageIdSchema,
  platform: contentPackagePlatformSchema,
});
export const reuseContentPackageCommandSchema = z.object({
  sourcePackageId: contentPackageIdSchema,
  versionId: contentPackageIdSchema.optional(),
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
export const contentPackageVersionsQuerySchema = z.object({
  packageId: contentPackageIdSchema,
  platform: contentPackagePlatformSchema.optional(),
});
export const contentPackageLineageQuerySchema = z.object({
  packageId: contentPackageIdSchema,
});

export const CONTENT_PACKAGE_COMMAND_SCHEMAS = {
  adopt_canvas_work_export: adoptCanvasWorkExportCommandSchema,
  adopt_into_content_package: adoptIntoContentPackageCommandSchema,
  attach_content_package_generation:
    attachContentPackageGenerationCommandSchema,
  cancel_content_package: cancelContentPackageCommandSchema,
  create_content_package: createContentPackageCommandSchema,
  edit_content_package_variant: editContentPackageVariantCommandSchema,
  edit_content_package_version: editContentPackageVersionCommandSchema,
  export_content_package: exportContentPackageCommandSchema,
  generate_content_package_variants:
    generateContentPackageVariantsCommandSchema,
  content_package_migration_activate: contentPackageMigrationCommandSchema,
  content_package_migration_backfill: contentPackageMigrationCommandSchema,
  content_package_migration_dry_run: contentPackageMigrationCommandSchema,
  content_package_migration_freeze: contentPackageMigrationCommandSchema,
  content_package_migration_inspect: contentPackageMigrationCommandSchema,
  content_package_migration_rollback: contentPackageMigrationCommandSchema,
  reuse_content_package: reuseContentPackageCommandSchema,
  revoke_content_package_rights: revokeContentPackageRightsCommandSchema,
  rollback_content_package_version: rollbackContentPackageVersionCommandSchema,
} as const;

export const CONTENT_PACKAGE_QUERY_SCHEMAS = {
  content_package: contentPackageQuerySchema,
  content_package_lineage: contentPackageLineageQuerySchema,
  content_package_versions: contentPackageVersionsQuerySchema,
  content_packages: contentPackagesQuerySchema,
  content_package_migration_report: contentPackageMigrationQuerySchema,
  content_package_migration_status: contentPackageMigrationQuerySchema,
} as const;
