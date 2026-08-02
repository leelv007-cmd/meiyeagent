import { z } from 'zod';

import {
  p1_admin_model_catalog_json_label,
  p1_admin_model_catalog_short_label,
  p1_admin_model_catalog_short_validation_error,
  p1_admin_model_catalog_validation_error,
  p1_admin_model_validation_auto_operation,
  p1_admin_model_validation_fixed_model,
  p1_admin_template_document_json_label,
  p1_admin_template_document_validation_error,
  p1_admin_template_validation_rollout,
  p1_common_invalid_json,
  p1_common_unknown_error,
  p1_common_unlabeled,
} from '@/locale/paraglide/messages';

export const CREDIT_PRICING_OPERATIONS = [
  'copy.generate',
  'copy.adapt',
  'image.generate',
  'image.edit',
  'image.reference_transform',
  'video.generate',
  'audio.speech',
  'audio.sfx',
] as const;

export type CreditPricingOperation = (typeof CREDIT_PRICING_OPERATIONS)[number];

const modelOperationSchema = z.enum([
  'copy.generate',
  'copy.adapt',
  'image.generate',
  'image.edit',
  'video.generate',
  'audio.speech',
  'audio.sfx',
  'text.respond',
]);

const videoCreditCostsSchema = z.strictObject({
  '15': z.number().int().positive().optional(),
  '30': z.number().int().positive().optional(),
  '60': z.number().int().positive().optional(),
});

const creditPricingEntrySchema = z.strictObject({
  creditCost: z.number().int().positive(),
  failureRefundsCredits: z.boolean(),
  videoCreditCosts: videoCreditCostsSchema.optional(),
});

const creditPricingSchema = z.strictObject({
  'audio.sfx': creditPricingEntrySchema.optional(),
  'audio.speech': creditPricingEntrySchema.optional(),
  'copy.adapt': creditPricingEntrySchema.optional(),
  'copy.generate': creditPricingEntrySchema.optional(),
  'image.edit': creditPricingEntrySchema.optional(),
  'image.generate': creditPricingEntrySchema.optional(),
  'image.reference_transform': creditPricingEntrySchema.optional(),
  'video.generate': creditPricingEntrySchema.optional(),
});

const evidenceStatusSchema = z.enum([
  'documented',
  'recorded',
  'live_verified',
]);
const DATA_CLASSES = ['public', 'contains_face', 'pii', 'medical'] as const;
const dataClassSchema = z.enum(DATA_CLASSES);
const canvasGenerationParameterSchema = z.enum([
  'width',
  'height',
  'durationSeconds',
  'ratio',
  'resolution',
  'generateAudio',
  'watermark',
  'maxOutputTokens',
  'temperature',
  'strength',
  'format',
  'language',
  'maxDurationSeconds',
  'speed',
  'tone',
  'voice',
]);
const canvasGenerationInputAssetRoleSchema = z.enum([
  'reference_image',
  'reference_video',
  'reference_audio',
  'mask',
]);

export const routeSimulatorFormSchema = z
  .object({
    catalogModelId: z.string(),
    dataClass: dataClassSchema,
    failureScenario: z.enum([
      'success',
      'rejected_before_accept',
      'accepted_failure',
      'acceptance_unknown',
    ]),
    fallbackConsent: z.boolean(),
    operation: modelOperationSchema,
    selectionMode: z.enum(['fixed', 'auto']),
    unavailableDeploymentIds: z.string(),
  })
  .superRefine((value, context) => {
    if (value.selectionMode === 'fixed' && !value.catalogModelId.trim()) {
      context.addIssue({
        code: 'custom',
        message: p1_admin_model_validation_fixed_model(),
        path: ['catalogModelId'],
      });
    }
    if (value.selectionMode === 'auto' && value.operation !== 'copy.generate') {
      context.addIssue({
        code: 'custom',
        message: p1_admin_model_validation_auto_operation(),
        path: ['selectionMode'],
      });
    }
  });

export type RouteSimulatorFormValues = z.infer<typeof routeSimulatorFormSchema>;

export interface AdminRouteSimulationPayload {
  dataClass: Array<'contains_face' | 'pii' | 'medical'>;
  failureScenario: RouteSimulatorFormValues['failureScenario'];
  operation: ModelOperation;
  selection:
    | {
        catalogModelId: string;
        fallbackConsent: boolean;
        mode: 'fixed';
      }
    | {
        fallbackConsent: boolean;
        mode: 'auto';
        profile: 'quality';
      };
  unavailableDeploymentIds: string[];
}

export function createRouteSimulationPayload(
  value: RouteSimulatorFormValues
): AdminRouteSimulationPayload {
  const parsed = routeSimulatorFormSchema.parse(value);
  const unavailableDeploymentIds = [
    ...new Set(
      parsed.unavailableDeploymentIds
        .split(/[\s,]+/u)
        .map((candidate) => candidate.trim())
        .filter(Boolean)
    ),
  ].sort();
  return {
    dataClass: parsed.dataClass === 'public' ? [] : [parsed.dataClass],
    failureScenario: parsed.failureScenario,
    operation: parsed.operation,
    selection:
      parsed.selectionMode === 'fixed'
        ? {
            catalogModelId: parsed.catalogModelId.trim(),
            fallbackConsent: parsed.fallbackConsent,
            mode: 'fixed',
          }
        : {
            fallbackConsent: parsed.fallbackConsent,
            mode: 'auto',
            profile: 'quality',
          },
    unavailableDeploymentIds,
  };
}

const routeCostEstimateSchema = z.object({
  amountMicros: z.number().int().nonnegative(),
  currency: z.enum(['CNY', 'USD']),
  source: z.enum(['catalog', 'recorded_estimate']),
  unit: z.string().min(1),
});

const routeCandidateEvaluationSchema = z.object({
  catalogModelId: z.string().min(1),
  channel: z.enum(['direct', 'managed', 'bifrost', 'litellm']),
  costEstimate: routeCostEstimateSchema,
  deploymentId: z.string().min(1),
  eligible: z.boolean(),
  exclusionReasons: z.array(
    z.enum([
      'catalog_model_missing',
      'deployment_inactive',
      'operation_unsupported',
      'fixed_model_mismatch',
      'custom_requires_fixed_selection',
      'data_class_disallowed',
      'simulated_unavailable',
    ])
  ),
  qualityRank: z.number().nullable(),
  region: z.enum(['domestic', 'overseas']),
});

const routeSimulationSchema = z.object({
  candidateEvaluations: z.array(routeCandidateEvaluationSchema),
  catalogRevisionId: z.string().min(1),
  dataClass: z.array(z.enum(['contains_face', 'pii', 'medical'])),
  estimatedMaximumCost: routeCostEstimateSchema.nullable(),
  expectedOutcome: z.object({
    action: z.enum([
      'complete',
      'fallback',
      'stop',
      'recover_without_resubmit',
      'awaiting_selection',
    ]),
    attemptLimit: z.literal(2),
    expectedAttempts: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    fallbackDeploymentId: z.string().min(1).optional(),
    primaryDeploymentId: z.string().min(1).optional(),
    reason: z.enum([
      'no_eligible_candidate',
      'provider_completed',
      'safe_auto_fallback',
      'fallback_not_authorized',
      'no_safe_fallback_candidate',
      'provider_already_accepted',
      'provider_acceptance_unknown',
    ]),
  }),
  failureScenario: z.enum([
    'success',
    'rejected_before_accept',
    'accepted_failure',
    'acceptance_unknown',
  ]),
  operation: modelOperationSchema,
  rankedCandidates: z.array(
    routeCandidateEvaluationSchema.extend({ rank: z.number().int().positive() })
  ),
  selection: z.object({
    catalogModelId: z.string().optional(),
    fallbackConsent: z.boolean().optional(),
    mode: z.enum(['fixed', 'auto']),
    profile: z.enum(['quality', 'balanced']).optional(),
  }),
});

export type AdminRouteSimulation = z.infer<typeof routeSimulationSchema>;

export function normalizeAdminRouteSimulation(value: unknown) {
  return routeSimulationSchema.parse(value);
}

const canvasDocumentSchema = z.object({
  height: z.number().int().positive(),
  pages: z
    .array(
      z.object({
        elements: z.array(z.record(z.string(), z.unknown())),
        id: z.string().min(1),
      })
    )
    .min(1),
  width: z.number().int().positive(),
});

const safeDraftModelSchema = z
  .strictObject({
    activationEvidence: z.strictObject({
      configurationRevision: z.string().min(1).optional(),
      evidenceRef: z.string().min(1).optional(),
      status: evidenceStatusSchema,
      verifiedAt: z.iso.datetime().optional(),
    }),
    allowedDataClasses: z.array(dataClassSchema),
    deniedDataClasses: z.array(dataClassSchema),
    id: z.string().min(1),
    lifecycle: z.enum(['available', 'recorded', 'unavailable']),
  })
  .superRefine((model, context) => {
    if (
      model.lifecycle === 'available' &&
      model.activationEvidence.status !== 'live_verified'
    ) {
      context.addIssue({
        code: 'custom',
        message: `${model.id}: available requires live_verified evidence`,
      });
    }
    if (
      model.activationEvidence.status === 'live_verified' &&
      (!model.activationEvidence.configurationRevision ||
        !model.activationEvidence.evidenceRef ||
        !model.activationEvidence.verifiedAt)
    ) {
      context.addIssue({
        code: 'custom',
        message: `${model.id}: live_verified requires complete activation evidence`,
      });
    }
    if (
      model.lifecycle === 'recorded' &&
      model.activationEvidence.status !== 'recorded'
    ) {
      context.addIssue({
        code: 'custom',
        message: `${model.id}: recorded requires recorded or live_verified evidence`,
      });
    }
    const allowed = new Set(model.allowedDataClasses);
    const denied = new Set(model.deniedDataClasses);
    if (
      allowed.size !== model.allowedDataClasses.length ||
      denied.size !== model.deniedDataClasses.length ||
      model.allowedDataClasses.some((item) => denied.has(item)) ||
      DATA_CLASSES.some((item) => !allowed.has(item) && !denied.has(item))
    ) {
      context.addIssue({
        code: 'custom',
        message: `${model.id}: allowedDataClasses and deniedDataClasses must be a complete non-overlapping policy`,
      });
    }
  });

const safeModelDraftSchema = z
  .strictObject({ models: z.array(safeDraftModelSchema).min(1) })
  .superRefine((draft, context) => {
    const ids = new Set<string>();
    for (const [index, model] of draft.models.entries()) {
      if (ids.has(model.id)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate model id: ${model.id}`,
          path: ['models', index, 'id'],
        });
      }
      ids.add(model.id);
    }
  });

const catalogModelSchema = z.strictObject({
  capabilities: z.array(modelOperationSchema).optional(),
  creditPricing: creditPricingSchema.optional(),
  displayName: z.string().min(1),
  id: z.string().min(1),
  manufacturer: z.string().min(1).optional(),
  modality: z.enum(['llm', 'image', 'video', 'audio']),
  operations: z.array(modelOperationSchema).min(1),
  qualityRank: z.number().finite(),
  stableModelName: z.string().min(1).optional(),
  version: z.string().min(1).optional(),
});

const activationEvidenceSchema = z.strictObject({
  configurationRevision: z.string().min(1).optional(),
  evidenceRef: z.string().min(1).optional(),
  status: evidenceStatusSchema,
  verifiedAt: z.iso.datetime().optional(),
});

const providerProfileRevisionSchema = z.strictObject({
  apiCounterparty: z.string().min(1),
  id: z.string().min(1),
  lifecycle: evidenceStatusSchema,
  manufacturer: z.string().min(1),
  revision: z.number().int().positive(),
});

const executionChannelRevisionSchema = z.strictObject({
  apiCounterparty: z.string().min(1),
  apiFamily: z.enum([
    'openai',
    'anthropic',
    'gemini',
    'custom',
    'image',
    'media',
    'audio',
  ]),
  channel: z.enum(['direct', 'managed', 'bifrost', 'litellm']),
  credentialOwner: z.enum(['platform', 'workspace_byok', 'provider_managed']),
  id: z.string().min(1),
  providerProfileId: z.string().min(1),
  region: z.enum(['domestic', 'overseas']),
  revision: z.number().int().positive(),
});

const deploymentRevisionSchema = z.strictObject({
  activationEvidence: activationEvidenceSchema,
  allowedDataClasses: z.array(dataClassSchema).optional(),
  apiCounterparty: z.string().min(1).optional(),
  apiFamily: z.enum([
    'openai',
    'anthropic',
    'gemini',
    'custom',
    'image',
    'media',
    'audio',
  ]),
  canvasGenerationCapabilities: z
    .array(
      z.strictObject({
        inputAssetRoles: z.array(canvasGenerationInputAssetRoleSchema),
        operation: modelOperationSchema,
        parameters: z.array(canvasGenerationParameterSchema),
      })
    )
    .optional(),
  catalogModelId: z.string().min(1),
  channel: z.enum(['direct', 'managed', 'bifrost', 'litellm']),
  credentialMode: z.enum(['platform', 'byok_strict']).optional(),
  credentialOwner: z
    .enum(['platform', 'workspace_byok', 'provider_managed'])
    .optional(),
  credentialVersion: z.string().min(1).optional(),
  endpointRevision: z.string().min(1).optional(),
  executionChannelId: z.string().min(1).optional(),
  id: z.string().min(1),
  lifecycleRevision: z.string().min(1).optional(),
  policyRevision: z.string().min(1).optional(),
  priceRevision: z.string().min(1).optional(),
  providerModel: z.string().min(1).optional(),
  providerProfileId: z.string().min(1).optional(),
  region: z.enum(['domestic', 'overseas']),
  status: z.enum(['active', 'inactive', 'retired']),
  unavailableReason: z
    .enum([
      'activation_evidence_missing',
      'credential_unavailable',
      'region_unavailable',
      'deployment_unavailable',
      'retired',
    ])
    .optional(),
  unitPrice: z
    .strictObject({
      amountMicros: z.number().int().nonnegative(),
      currency: z.enum(['CNY', 'USD']),
      unit: z.string().min(1),
    })
    .optional(),
});

const capabilityRevisionSchema = z.strictObject({
  catalogModelId: z.string().min(1).optional(),
  id: z.string().min(1),
  operation: modelOperationSchema,
  revision: z.number().int().positive(),
});

const priceRevisionSchema = z.strictObject({
  amount: z.number().nonnegative(),
  catalogModelId: z.string().min(1).optional(),
  currency: z.enum(['CNY', 'USD']),
  id: z.string().min(1),
  revision: z.number().int().positive(),
  unit: z.string().min(1).optional(),
});

const routeRevisionSchema = z.strictObject({
  catalogModelId: z.string().min(1).optional(),
  id: z.string().min(1),
  operation: modelOperationSchema,
  revision: z.number().int().positive(),
});

const adminCatalogDraftSchema = z.strictObject({
  capabilities: z.array(capabilityRevisionSchema),
  deployments: z.array(deploymentRevisionSchema),
  executionChannels: z.array(executionChannelRevisionSchema),
  models: z.array(catalogModelSchema),
  prices: z.array(priceRevisionSchema),
  providerProfiles: z.array(providerProfileRevisionSchema),
  routes: z.array(routeRevisionSchema),
});

const adminCatalogControlSchema = z.strictObject({
  catalog: adminCatalogDraftSchema,
  revisionId: z.string().min(1),
  stage: z.enum(['recorded', 'published']),
  workspaceId: z.string().min(1),
});

export type AdminCatalogControl = z.infer<typeof adminCatalogControlSchema>;
export type AdminCatalogDraft = z.infer<typeof adminCatalogDraftSchema>;

export function normalizeAdminCatalogControl(value: unknown) {
  return adminCatalogControlSchema.parse(value);
}

export function createAdminCatalogDraftJson(control: AdminCatalogControl) {
  return JSON.stringify(control.catalog, null, 2);
}

export function parseAdminCatalogDraft(value: string) {
  const result = adminCatalogDraftSchema.safeParse(
    parseJson(value, p1_admin_model_catalog_json_label())
  );
  if (!result.success) {
    throw new Error(
      p1_admin_model_catalog_validation_error({
        reason: result.error.issues[0]?.message ?? p1_common_unknown_error(),
      })
    );
  }
  return result.data;
}

export type ModelOperation = z.infer<typeof modelOperationSchema>;
export type ActivationEvidenceStatus = z.infer<typeof evidenceStatusSchema>;

export interface AdminTemplateView {
  createdAt: string;
  family: string;
  id: string;
  name: string;
  publicationStatus: 'draft' | 'enabled' | 'published' | 'retired';
  enabledVersionId?: string;
  publishedVersionId?: string;
  tags: string[];
  updatedAt: string;
}

export interface AdminTemplateVersionView {
  createdAt: string;
  createdBy: string;
  documentSummary: {
    elementCount: number;
    height: number;
    pageCount: number;
    width: number;
  };
  id: string;
  publishedAt?: string;
  revision: number;
  rolloutPercent: number;
  status: 'draft' | 'enabled' | 'published' | 'retired';
  templateId: string;
}

export interface AdminTemplateHistoryView {
  templates: AdminTemplateView[];
  versions: AdminTemplateVersionView[];
  workspaceId: string;
}

export interface AdminCatalogModelView {
  activationEvidence: {
    configurationRevision?: string;
    evidenceRef?: string;
    status: ActivationEvidenceStatus;
    verifiedAt?: string;
  };
  allowedDataClasses: string[];
  availability: 'available' | 'recorded' | 'unavailable';
  deniedDataClasses: string[];
  displayName: string;
  id: string;
  manufacturer: string;
  modality: 'llm' | 'image' | 'video' | 'audio';
  operations: ModelOperation[];
  qualityRank: number;
  stableModelName: string;
  unavailableReason?: string;
  version: string;
}

export interface AdminCatalogSnapshot {
  models: AdminCatalogModelView[];
  operation: ModelOperation;
  revisionId: string;
  stage: 'published' | 'recorded';
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function string(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function parseJson(value: string, label: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(p1_common_invalid_json({ label }));
  }
}

export function parseRolloutPercent(value: string) {
  const percent = Number(value);
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
    throw new Error(p1_admin_template_validation_rollout());
  }
  return percent;
}

export function parseCanvasDocument(value: string) {
  const result = canvasDocumentSchema.safeParse(
    parseJson(value, p1_admin_template_document_json_label())
  );
  if (!result.success) {
    throw new Error(
      p1_admin_template_document_validation_error({
        reason: result.error.issues[0]?.message ?? p1_common_unknown_error(),
      })
    );
  }
  return result.data;
}

export function normalizeAdminTemplates(value: unknown): AdminTemplateView[] {
  const outer = record(value);
  const input = Array.isArray(value)
    ? value
    : Array.isArray(outer.templates)
      ? outer.templates
      : [];
  return input.map(record).flatMap((template) => {
    const id = string(template.id);
    const status = string(template.publicationStatus);
    if (!id || !['draft', 'enabled', 'published', 'retired'].includes(status)) {
      return [];
    }
    const publishedVersionId = string(template.publishedVersionId);
    const enabledVersionId = string(template.enabledVersionId);
    return [
      {
        createdAt: string(template.createdAt),
        family: string(template.family),
        id,
        name: string(template.name, id),
        publicationStatus: status as AdminTemplateView['publicationStatus'],
        ...(enabledVersionId ? { enabledVersionId } : {}),
        ...(publishedVersionId ? { publishedVersionId } : {}),
        tags: stringArray(template.tags),
        updatedAt: string(template.updatedAt),
      },
    ];
  });
}

export function normalizeAdminTemplateHistory(
  value: unknown
): AdminTemplateHistoryView {
  const payload = record(value);
  const versions = (Array.isArray(payload.versions) ? payload.versions : [])
    .map(record)
    .flatMap((version): AdminTemplateVersionView[] => {
      const id = string(version.id);
      const templateId = string(version.templateId);
      const status = string(version.status);
      const summary = record(version.documentSummary);
      if (
        !id ||
        !templateId ||
        !['draft', 'enabled', 'published', 'retired'].includes(status) ||
        typeof version.revision !== 'number' ||
        typeof version.rolloutPercent !== 'number' ||
        typeof summary.elementCount !== 'number' ||
        typeof summary.height !== 'number' ||
        typeof summary.pageCount !== 'number' ||
        typeof summary.width !== 'number'
      ) {
        return [];
      }
      const publishedAt = string(version.publishedAt);
      return [
        {
          createdAt: string(version.createdAt),
          createdBy: string(version.createdBy),
          documentSummary: {
            elementCount: summary.elementCount,
            height: summary.height,
            pageCount: summary.pageCount,
            width: summary.width,
          },
          id,
          ...(publishedAt ? { publishedAt } : {}),
          revision: version.revision,
          rolloutPercent: version.rolloutPercent,
          status: status as AdminTemplateVersionView['status'],
          templateId,
        },
      ];
    });
  return {
    templates: normalizeAdminTemplates(payload.templates),
    versions,
    workspaceId: string(payload.workspaceId),
  };
}

export function normalizeAdminCatalog(
  value: unknown,
  operation: ModelOperation
): AdminCatalogSnapshot {
  const payload = record(value);
  const revisionId = string(payload.revisionId, 'unknown');
  const stage = payload.stage === 'published' ? 'published' : 'recorded';
  const models = (Array.isArray(payload.models) ? payload.models : [])
    .map(record)
    .flatMap((model): AdminCatalogModelView[] => {
      const id = string(model.id);
      const modality = model.modality;
      const availability = model.availability;
      if (
        !id ||
        (modality !== 'llm' &&
          modality !== 'image' &&
          modality !== 'video' &&
          modality !== 'audio') ||
        (availability !== 'available' &&
          availability !== 'recorded' &&
          availability !== 'unavailable')
      ) {
        return [];
      }
      const evidence = record(model.activationEvidence);
      const evidenceStatus = evidence.status;
      const status =
        evidenceStatus === 'recorded' || evidenceStatus === 'live_verified'
          ? evidenceStatus
          : 'documented';
      const dataClasses = record(model.dataClasses);
      const modelOperations = stringArray(model.operations).filter(
        (candidate): candidate is ModelOperation =>
          modelOperationSchema.safeParse(candidate).success
      );
      const unavailableReason = string(model.unavailableReason);
      const evidenceRef = string(evidence.evidenceRef);
      const configurationRevision = string(evidence.configurationRevision);
      const verifiedAt = string(evidence.verifiedAt);
      return [
        {
          activationEvidence: {
            ...(configurationRevision ? { configurationRevision } : {}),
            ...(evidenceRef ? { evidenceRef } : {}),
            status,
            ...(verifiedAt ? { verifiedAt } : {}),
          },
          allowedDataClasses: stringArray(dataClasses.allowed),
          availability,
          deniedDataClasses: stringArray(dataClasses.denied),
          displayName: string(model.displayName, id),
          id,
          manufacturer: string(model.manufacturer, p1_common_unlabeled()),
          modality,
          operations: modelOperations,
          qualityRank:
            typeof model.qualityRank === 'number' ? model.qualityRank : 0,
          stableModelName: string(model.stableModelName, id),
          ...(unavailableReason ? { unavailableReason } : {}),
          version: string(model.version, p1_common_unlabeled()),
        },
      ];
    });
  return { models, operation, revisionId, stage };
}

export function createSafeModelDraftJson(snapshots: AdminCatalogSnapshot[]) {
  const models = new Map<string, AdminCatalogModelView>();
  for (const snapshot of snapshots) {
    for (const model of snapshot.models) {
      const existing = models.get(model.id);
      models.set(model.id, {
        ...model,
        operations: [
          ...new Set([...(existing?.operations ?? []), ...model.operations]),
        ],
      });
    }
  }
  return JSON.stringify(
    {
      models: [...models.values()].map((model) => ({
        activationEvidence: model.activationEvidence,
        allowedDataClasses: model.allowedDataClasses,
        deniedDataClasses: model.deniedDataClasses,
        id: model.id,
        lifecycle: model.availability,
      })),
    },
    null,
    2
  );
}

/**
 * Validates the allowlisted lifecycle patch sent to the backend. Private
 * deployment fields are merged from the current revision by the core service.
 */
export function parseSafeModelDraft(value: string) {
  const result = safeModelDraftSchema.safeParse(
    parseJson(value, p1_admin_model_catalog_short_label())
  );
  if (!result.success) {
    throw new Error(
      p1_admin_model_catalog_short_validation_error({
        reason: result.error.issues[0]?.message ?? p1_common_unknown_error(),
      })
    );
  }

  return result.data;
}
