import {
  ASSET_INTAKE_GUIDANCE_CONFIG_KEY,
  assetIntakeGuidanceConfigSchema,
} from '@meiye/contracts';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import {
  NOTE_STYLE_CONFIG_KEY,
  noteStyleConfigSchema,
} from '@meiye/contracts';

import { P1DomainError, type P1Context } from '../foundation/domain.js';
import type { P1OperationModule } from '../foundation/ports.js';
import {
  PLATFORM_DEFAULT_MODEL_CONFIG_KEYS,
  platformDefaultModelConfigName,
  type PlatformDefaultModelConfigKey,
} from '../foundation/workspace-provision.js';
import { createDefaultDeployments } from '../model-supply/catalog.js';
import type {
  CloudflareInventorySnapshot,
  CloudflareSelfProbeResult,
} from '../cloudflare-read/index.js';
import {
  BOUNDED_EXECUTION_LIVE_CALIBRATION_CONFIG_KEY,
  BOUNDED_EXECUTION_LIMITS_CONFIG_KEY,
  boundedExecutionLiveCalibrationConfigSchema,
  boundedExecutionLimitsConfigSchema,
} from './bounded-execution-limits.js';

export type AdminConfigScope = 'global' | 'workspace';
export type AdminConfigStatus = 'applied' | 'rolled_back';

export interface AdminConfigDefinition {
  key: string;
  scope: AdminConfigScope;
  description: string;
  valueSchema: z.ZodType;
}

export interface AdminConfigRevision {
  key: string;
  scope: AdminConfigScope;
  workspaceId: string;
  value: unknown;
  revision: number;
  status: AdminConfigStatus;
  rolledBackToRevision: number | null;
  actorId: string;
  reason: string;
  correlationId: string;
  createdAt: string;
}

export interface ApplyConfigInput {
  key: string;
  scope: AdminConfigScope;
  workspaceId: string;
  value: unknown;
  expectedRevision: number | null;
  actorId: string;
  reason: string;
  correlationId: string;
}

export interface RollbackConfigInput {
  key: string;
  scope: AdminConfigScope;
  workspaceId: string;
  targetRevision: number;
  expectedRevision: number;
  actorId: string;
  reason: string;
  correlationId: string;
}

export type RuntimeProcessKind = 'http' | 'job-worker';

export interface RuntimeEffectiveSnapshot {
  bootedAt: string;
  executionMode: string;
  executionSource:
    | { source: 'db_revision'; revision: number }
    | { source: 'env_fallback' };
  fallbackReason: string | null;
  mediaMode: string;
  mediaSource:
    | { source: 'db_revision'; revision: number }
    | { source: 'env_fallback' };
  processKind: RuntimeProcessKind;
}

export interface AdminConfigRepository {
  apply(input: ApplyConfigInput): Promise<AdminConfigRevision>;
  rollback(input: RollbackConfigInput): Promise<AdminConfigRevision>;
  get(
    scope: AdminConfigScope,
    workspaceId: string,
    key: string,
  ): Promise<AdminConfigRevision | null>;
  history(
    scope: AdminConfigScope,
    workspaceId: string,
    key: string,
  ): Promise<AdminConfigRevision[]>;
  listEffectiveSnapshots(): Promise<RuntimeEffectiveSnapshot[]>;
  upsertEffectiveSnapshot(
    snapshot: RuntimeEffectiveSnapshot,
  ): Promise<RuntimeEffectiveSnapshot>;
}

export interface CloudflareInventoryReadPort {
  getInventory(): Promise<CloudflareInventorySnapshot>;
}

export class MemoryAdminConfigRepository implements AdminConfigRepository {
  private readonly revisions = new Map<string, AdminConfigRevision[]>();
  private readonly effectiveSnapshots = new Map<
    RuntimeProcessKind,
    RuntimeEffectiveSnapshot
  >();

  async apply(input: ApplyConfigInput) {
    const identity = `${input.scope}:${input.workspaceId}:${input.key}`;
    const history = this.revisions.get(identity) ?? [];
    const current = history.at(-1);
    if ((current?.revision ?? null) !== input.expectedRevision) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        'Config head changed before the value could be applied.',
      );
    }
    if (current && isDeepStrictEqual(current.value, input.value)) {
      return current;
    }
    const revision: AdminConfigRevision = {
      key: input.key,
      scope: input.scope,
      workspaceId: input.workspaceId,
      value: input.value,
      revision: (current?.revision ?? 0) + 1,
      status: 'applied',
      rolledBackToRevision: null,
      actorId: input.actorId,
      reason: input.reason,
      correlationId: input.correlationId,
      createdAt: new Date().toISOString(),
    };
    this.revisions.set(identity, [...history, revision]);
    return revision;
  }

  async get(scope: AdminConfigScope, workspaceId: string, key: string) {
    return this.revisions.get(`${scope}:${workspaceId}:${key}`)?.at(-1) ?? null;
  }

  async history(scope: AdminConfigScope, workspaceId: string, key: string) {
    return [...(this.revisions.get(`${scope}:${workspaceId}:${key}`) ?? [])];
  }

  async listEffectiveSnapshots() {
    return [...this.effectiveSnapshots.values()].map((snapshot) =>
      structuredClone(snapshot)
    );
  }

  async upsertEffectiveSnapshot(snapshot: RuntimeEffectiveSnapshot) {
    this.effectiveSnapshots.set(snapshot.processKind, structuredClone(snapshot));
    return structuredClone(snapshot);
  }

  async rollback(input: RollbackConfigInput) {
    const identity = `${input.scope}:${input.workspaceId}:${input.key}`;
    const history = this.revisions.get(identity) ?? [];
    const current = history.at(-1);
    if (current?.revision !== input.expectedRevision) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        'Config head changed before the rollback could be applied.',
      );
    }
    const target = history.find(
      (revision) => revision.revision === input.targetRevision,
    );
    if (!target) {
      throw new P1DomainError('NOT_FOUND', 'Config revision was not found.');
    }
    const revision: AdminConfigRevision = {
      key: input.key,
      scope: input.scope,
      workspaceId: input.workspaceId,
      value: target.value,
      revision: current.revision + 1,
      status: 'rolled_back',
      rolledBackToRevision: target.revision,
      actorId: input.actorId,
      reason: input.reason,
      correlationId: input.correlationId,
      createdAt: new Date().toISOString(),
    };
    this.revisions.set(identity, [...history, revision]);
    return revision;
  }
}

const GLOBAL_WORKSPACE_ID = '__global__';
const COMPLIANCE_DEFAULTS = {
  'compliance.aigc_label.default': true,
  'compliance.regulated_mode.default': false,
  'compliance.watermark.default': false,
} as const;
const MAX_PLAN_RESOURCE_ALLOWANCE = 1_000_000;
const MAX_PLAN_CONCURRENCY = 100;
const MAX_QUEUE_PRIORITY = 100;
const MAX_ADD_ON_QUANTITY = 1_000_000;
const MAX_ADD_ON_AMOUNT_MICROS = 1_000_000_000_000;
const MAX_ADD_ON_OFFERS = 100;
const MAX_CREDIT_PLAN_AMOUNT = 10_000_000;
const MAX_CREDIT_ADD_ON_EXPIRY_DAYS = 3_650;
export const HARNESS_WOZ_RECIPE_CONFIG_KEY = 'harness.woz.recipe';
export const HARNESS_CONFIRMATION_CARD_TIMEOUT_CONFIG_KEY =
  'harness.confirmation_card.timeout_seconds';
export const HARNESS_CONFIRMATION_CARD_HOLD_TIMEOUT_CONFIG_KEY =
  'harness.confirmation_card.hold_timeout_seconds';
export const HARNESS_RESERVATION_SWEEP_TTL_CONFIG_KEY =
  'harness.reservation_sweep.ttl_seconds';
export const HARNESS_LANGFUSE_OUTBOX_CONFIG_KEY =
  'harness.outbox.langfuse';
export const HARNESS_TODAY_RECOMMENDATION_CONFIG_KEY =
  'harness.today_recommendation';
export const DUE_DELIVERY_RETENTION_DAYS_CONFIG_KEY =
  'due_delivery.retention_days';
export const DEFAULT_DUE_DELIVERY_RETENTION_DAYS = 90;
export const dueDeliveryRetentionDaysConfigSchema = z
  .number()
  .int()
  .positive()
  .max(3_650);
export const harnessLangfuseOutboxConfigSchema = z
  .object({
    batchSize: z.number().int().positive().max(100),
    maxAttempts: z.number().int().positive().max(100),
    retryDelaySeconds: z.number().int().positive().max(86_400),
    leaseSeconds: z.number().int().positive().max(86_400),
  })
  .strict();
export type HarnessLangfuseOutboxConfig = z.infer<
  typeof harnessLangfuseOutboxConfigSchema
>;
export const DEFAULT_HARNESS_LANGFUSE_OUTBOX_CONFIG: HarnessLangfuseOutboxConfig =
  {
    batchSize: 20,
    maxAttempts: 8,
    retryDelaySeconds: 30,
    leaseSeconds: 300,
  };
export const harnessTodayRecommendationConfigSchema = z
  .object({
    weekdayWhyNow: z.record(z.string(), z.string().trim().min(1).max(2_000)),
    industryWhyNow: z.record(z.string(), z.string().trim().min(1).max(2_000)),
    platformWhyNow: z.record(z.string(), z.string().trim().min(1).max(2_000)),
  })
  .strict();
export type HarnessTodayRecommendationConfig = z.infer<
  typeof harnessTodayRecommendationConfigSchema
>;
export const DEFAULT_HARNESS_TODAY_RECOMMENDATION_CONFIG: HarnessTodayRecommendationConfig = {
  weekdayWhyNow: {
    '1': '新的一周适合把本店主推项目重新介绍给顾客。',
    '5': '周末前适合提醒顾客安排下一次到店。',
  },
  industryWhyNow: {
    美发: '结合本店发型服务，今天适合把主推项目讲清楚。',
    美甲: '结合本店美甲服务，今天适合展示本周主推款式。',
    皮肤管理: '结合本店护理服务，今天适合提醒顾客安排护理。',
  },
  platformWhyNow: {
    xiaohongshu: '今天适合先用一篇实用内容让顾客了解本店项目。',
    douyin: '今天适合用短内容展示本店项目并引导咨询。',
    video_account: '今天适合用一条视频提醒顾客预约到店。',
  },
};
const planAllowanceSchema = z
  .object({
    allowance: z.object({
      audio: z.number().int().nonnegative().max(MAX_PLAN_RESOURCE_ALLOWANCE).default(0),
      copy: z.number().int().nonnegative().max(MAX_PLAN_RESOURCE_ALLOWANCE),
      image: z.number().int().nonnegative().max(MAX_PLAN_RESOURCE_ALLOWANCE),
      video: z.number().int().nonnegative().max(MAX_PLAN_RESOURCE_ALLOWANCE),
    }).strict(),
    concurrencyLimit: z.number().int().positive().max(MAX_PLAN_CONCURRENCY),
    queuePriority: z.number().int().positive().max(MAX_QUEUE_PRIORITY),
    supportLabel: z.enum(['standard', 'priority']),
  })
  .strict();
const trialPlanAllowanceSchema = planAllowanceSchema.extend({
  /** Trial fixed_days length. */
  expireDays: z.number().int().positive().max(366).optional(),
});
const creditPlanSchema = z
  .object({
    credits: z.number().int().positive().max(MAX_CREDIT_PLAN_AMOUNT),
    monthlyPriceMicros: z.number().int().positive().max(MAX_ADD_ON_AMOUNT_MICROS),
    currency: z.literal('CNY'),
    storageMb: z.number().int().positive().max(MAX_PLAN_RESOURCE_ALLOWANCE),
    concurrencyLimit: z.number().int().positive().max(MAX_PLAN_CONCURRENCY),
    queuePriority: z.number().int().positive().max(MAX_QUEUE_PRIORITY),
    supportLabel: z.enum(['standard', 'priority']),
  })
  .strict();
const trialCreditPlanSchema = creditPlanSchema.extend({
  monthlyPriceMicros: z.number().int().nonnegative().max(MAX_ADD_ON_AMOUNT_MICROS),
});
const creditPlanCycleCoefficientBasisPointsSchema = z
  .object({
    monthly: z.number().int().positive().max(10_000),
    single_month: z.number().int().positive().max(10_000),
    yearly: z.number().int().positive().max(10_000),
  })
  .strict();
const creditAddOnSchema = z
  .object({
    id: z.string().trim().min(1).max(100),
    credits: z.number().int().positive().max(MAX_CREDIT_PLAN_AMOUNT),
    amountMicros: z.number().int().nonnegative().max(MAX_ADD_ON_AMOUNT_MICROS),
    currency: z.literal('CNY'),
    expireDays: z.number().int().positive().max(MAX_CREDIT_ADD_ON_EXPIRY_DAYS),
  })
  .strict();
const activationEvidenceConfigSchema = z
  .object({
    configurationRevision: z.string().regex(/^[a-f0-9]{64}$/),
    evidenceRef: z.string().regex(/^activation-probe-[a-f0-9]{24,64}$/),
    status: z.literal('live_verified'),
    verifiedAt: z.iso.datetime(),
  })
  .strict();

const PLATFORM_DEFAULT_MODEL_LABELS: Record<
  PlatformDefaultModelConfigKey,
  string
> = {
  audio: 'audio generation',
  copy: 'copy generation',
  image: 'image generation',
  video: 'video generation',
};

const PLATFORM_DEFAULT_MODEL_DEFINITIONS: readonly AdminConfigDefinition[] =
  PLATFORM_DEFAULT_MODEL_CONFIG_KEYS.map((configKey) => ({
    key: platformDefaultModelConfigName(configKey),
    scope: 'global' as const,
    description: `Platform default catalog model id for ${PLATFORM_DEFAULT_MODEL_LABELS[configKey]} on new workspaces.`,
    valueSchema: z.string().min(1).max(200),
  }));

const CONFIG_DEFINITIONS: readonly AdminConfigDefinition[] = [
  ...createDefaultDeployments().map((deployment) => ({
    key: `model.activation.evidence.${deployment.id}`,
    scope: 'global' as const,
    description: `Probe-backed activation evidence for ${deployment.id}.`,
    valueSchema: activationEvidenceConfigSchema,
  })),
  {
    key: NOTE_STYLE_CONFIG_KEY,
    scope: 'global',
    description: 'Ordered style set used by the ImageTextNote compiler.',
    valueSchema: noteStyleConfigSchema,
  },
  {
    key: ASSET_INTAKE_GUIDANCE_CONFIG_KEY,
    scope: 'global',
    description: 'Industry examples and recommendations for asset intake.',
    valueSchema: assetIntakeGuidanceConfigSchema,
  },
  {
    key: HARNESS_WOZ_RECIPE_CONFIG_KEY,
    scope: 'workspace',
    description: 'Free-form WOZ recipe consumed by ContextBundle compilation.',
    valueSchema: z.json(),
  },
  {
    key: HARNESS_CONFIRMATION_CARD_TIMEOUT_CONFIG_KEY,
    scope: 'global',
    description: 'Confirmation-card wait before generic workflow continuation.',
    valueSchema: z.number().int().positive().max(3_600),
  },
  {
    key: HARNESS_CONFIRMATION_CARD_HOLD_TIMEOUT_CONFIG_KEY,
    scope: 'global',
    description: 'Decision hold wait before the reserved task expires.',
    valueSchema: z.number().int().min(3_600).max(172_800),
  },
  {
    key: HARNESS_RESERVATION_SWEEP_TTL_CONFIG_KEY,
    scope: 'global',
    description:
      'How long a held confirmation may keep product usage reserved. Releasing usage does not resolve the held question.',
    valueSchema: z.number().int().positive().max(2_592_000),
  },
  {
    key: HARNESS_LANGFUSE_OUTBOX_CONFIG_KEY,
    scope: 'global',
    description:
      'Retry, lease and batch limits for the Harness Langfuse audit outbox.',
    valueSchema: harnessLangfuseOutboxConfigSchema,
  },
  {
    key: HARNESS_TODAY_RECOMMENDATION_CONFIG_KEY,
    scope: 'global',
    description:
      'Deterministic weekday, industry and platform basis for the today recommendation.',
    valueSchema: harnessTodayRecommendationConfigSchema,
  },
  {
    key: DUE_DELIVERY_RETENTION_DAYS_CONFIG_KEY,
    scope: 'global',
    description: 'Terminal due-delivery item and run retention in days.',
    valueSchema: dueDeliveryRetentionDaysConfigSchema,
  },
  {
    key: BOUNDED_EXECUTION_LIVE_CALIBRATION_CONFIG_KEY,
    scope: 'global',
    description:
      'Issue 255 live anchors and adjustable derivation policy for bounded Harness execution.',
    valueSchema: boundedExecutionLiveCalibrationConfigSchema,
  },
  {
    key: BOUNDED_EXECUTION_LIMITS_CONFIG_KEY,
    scope: 'global',
    description:
      'Calibrated default and hard-cap values for bounded Harness execution.',
    valueSchema: boundedExecutionLimitsConfigSchema,
  },
  {
    key: 'compliance.regulated_mode.default',
    scope: 'global',
    description: 'Default regulated mode setting for newly registered stores.',
    valueSchema: z.boolean(),
  },
  {
    key: 'byok.adapter.assembly',
    scope: 'global',
    description: 'BYOK adapter assembly selected by platform administration.',
    valueSchema: z.enum(['recorded', 'live']),
  },
  {
    key: 'plan.addons',
    scope: 'global',
    description: 'Recorded commerce add-on offers.',
    valueSchema: z.array(z.object({
      id: z.string().min(1).max(100),
      resource: z.enum(['copy', 'image', 'video', 'audio']),
      quantity: z.number().int().positive().max(MAX_ADD_ON_QUANTITY),
      amountMicros: z.number().int().nonnegative().max(MAX_ADD_ON_AMOUNT_MICROS),
      currency: z.string().length(3).regex(/^[A-Z]{3}$/),
    }).strict()).max(MAX_ADD_ON_OFFERS).superRefine((offers, context) => {
      const ids = new Set<string>();
      offers.forEach((offer, index) => {
        if (ids.has(offer.id)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Add-on offer ids must be unique.',
            path: [index, 'id'],
          });
        }
        ids.add(offer.id);
      });
    }),
  },
  {
    key: 'compliance.aigc_label.default',
    scope: 'global',
    description: 'Default AIGC label setting for new content.',
    valueSchema: z.boolean(),
  },
  {
    key: 'compliance.watermark.default',
    scope: 'global',
    description: 'Default product watermark setting for new content.',
    valueSchema: z.boolean(),
  },
  {
    key: 'model.execution.mode',
    scope: 'global',
    description: 'LLM execution mode recorded by platform administration.',
    valueSchema: z.enum([
      'recorded',
      'fixture',
      'direct',
      'gateway',
      'disabled',
    ]),
  },
  {
    key: 'model.media.execution.mode',
    scope: 'global',
    description: 'Media execution mode recorded by platform administration.',
    valueSchema: z.enum(['disabled', 'ark', 'tuzi', 'ark,tuzi']),
  },
  ...(['growth', 'pro', 'starter'] as const).map((plan) => ({
    key: `plan.allowances.${plan}`,
    scope: 'global' as const,
    description: `${plan} plan allowances recorded by platform administration.`,
    valueSchema: planAllowanceSchema,
  })),
  {
    key: 'plan.allowances.trial',
    scope: 'global',
    description:
      'Trial fixed-days allowances recorded by platform administration.',
    valueSchema: trialPlanAllowanceSchema,
  },
  {
    key: 'plan.trial.enabled',
    scope: 'global',
    description: 'Trial grants for newly registered workspaces.',
    valueSchema: z.boolean(),
  },
  ...(['growth', 'pro', 'starter'] as const).map((plan) => ({
    key: `plan.credits.${plan}`,
    scope: 'global' as const,
    description: `${plan} plan credits recorded by platform administration.`,
    valueSchema: creditPlanSchema,
  })),
  {
    key: 'plan.credits.trial',
    scope: 'global',
    description: 'One-time trial credits recorded by platform administration.',
    valueSchema: trialCreditPlanSchema,
  },
  {
    key: 'plan.credits.addons',
    scope: 'global',
    description: 'Credit top-up packages recorded by platform administration.',
    valueSchema: z.array(creditAddOnSchema).max(MAX_ADD_ON_OFFERS).superRefine((offers, context) => {
      const ids = new Set<string>();
      offers.forEach((offer, index) => {
        if (ids.has(offer.id)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Credit add-on offer ids must be unique.',
            path: [index, 'id'],
          });
        }
        ids.add(offer.id);
      });
    }),
  },
  {
    key: 'plan.credits.cycle_coefficients',
    scope: 'global',
    description: 'Credit plan billing-cycle price coefficients.',
    valueSchema: creditPlanCycleCoefficientBasisPointsSchema,
  },
  {
    key: 'plan.credits.trial.enabled',
    scope: 'global',
    description: 'Whether one-time trial credit grants are enabled.',
    valueSchema: z.boolean(),
  },
  // #240①: the four platform default model keys are generated from the one
  // canonical config-key table so admin config, provisioning, the supply
  // registry and the preferences projection cannot disagree about which
  // operations even have a platform default.
  ...PLATFORM_DEFAULT_MODEL_DEFINITIONS,
  {
    // Tc-3: payment product → foundation plan mapping (single truth = Foundation commerce).
    // Paid grants only enter through entitlements.payment_grant; legacy
    // product apply_plan is disabled at the product service boundary.
    key: 'plan.payment-mapping',
    scope: 'global',
    description:
      'Maps payment catalog product ids/intervals to foundation ProductPlanTier.',
    valueSchema: z
      .object({
        mappings: z
          .array(
            z
              .object({
                paymentProductId: z.string().trim().min(1).max(200),
                interval: z
                  .enum(['month', 'year', 'lifetime', 'one_time', 'any'])
                  .default('any'),
                // trial is granted by REGISTER_GIFT, never by a payment event.
                tier: z.enum(['starter', 'growth', 'pro']),
              })
              .strict()
          )
          .max(100),
      })
      .strict(),
  },
];

function object(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new P1DomainError('INVALID_STATE', 'A config payload object is required.');
  }
  return value as Record<string, unknown>;
}

function string(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new P1DomainError('INVALID_STATE', `${key} is required.`);
  }
  return value.trim();
}

function expectedRevision(value: unknown) {
  if (value === null) return null;
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new P1DomainError(
      'INVALID_STATE',
      'expectedRevision must be null or a positive integer.',
    );
  }
  return value as number;
}

function positiveInteger(value: unknown, field: string) {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new P1DomainError(
      'INVALID_STATE',
      `${field} must be a positive integer.`,
    );
  }
  return value as number;
}

function containsSecretShape(value: unknown): boolean {
  if (typeof value === 'string') {
    return (
      /^(?:sk-|ghp_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{6,}$/i.test(value) ||
      /^bearer\s+\S+$/i.test(value) ||
      /(?:api[_-]?key|access[_-]?token|secret)\s*[:=]\s*\S+/i.test(value)
    );
  }
  if (Array.isArray(value)) return value.some(containsSecretShape);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(
    ([key, nested]) =>
      (/(?:api[_-]?key|access[_-]?token|secret|credential)/i.test(key) &&
        typeof nested === 'string' &&
        nested.length > 0) ||
      containsSecretShape(nested),
  );
}

export class AdminConfigFoundationModule implements P1OperationModule {
  readonly name = 'admin-config';
  private readonly adminActorIds: Set<string>;
  private readonly runtime: Readonly<Record<string, unknown>>;
  private readonly activationEvidenceStatus: string | null;
  private readonly definitions: readonly AdminConfigDefinition[];
  private readonly definitionByKey: ReadonlyMap<string, AdminConfigDefinition>;
  private readonly valueValidators: Readonly<
    Record<string, (value: unknown) => void | Promise<void>>
  >;
  private readonly wiredKeys: ReadonlySet<string>;
  private readonly hotReadKeys: ReadonlySet<string>;
  private readonly readOnlyKeys: ReadonlySet<string>;
  private readonly cloudflareInventory: CloudflareInventoryReadPort | null;
  private readonly cloudflareSelfProbes:
    | (() => Promise<CloudflareSelfProbeResult[]>)
    | null;

  constructor(
    private readonly repository: AdminConfigRepository,
    options: {
      adminActorIds?: readonly string[];
      runtime?: Readonly<Record<string, unknown>>;
      activationEvidenceStatus?: string;
      additionalDefinitions?: readonly AdminConfigDefinition[];
      valueValidators?: Readonly<
        Record<string, (value: unknown) => void | Promise<void>>
      >;
      wiredKeys?: readonly string[];
      hotReadKeys?: readonly string[];
      readOnlyKeys?: readonly string[];
      cloudflareInventory?: CloudflareInventoryReadPort;
      cloudflareSelfProbes?: () => Promise<CloudflareSelfProbeResult[]>;
    } = {},
  ) {
    this.adminActorIds = new Set(options.adminActorIds ?? []);
    this.runtime = options.runtime ?? {};
    this.activationEvidenceStatus = options.activationEvidenceStatus ?? null;
    this.valueValidators = options.valueValidators ?? {};
    this.wiredKeys = new Set(options.wiredKeys ?? []);
    this.hotReadKeys = new Set(options.hotReadKeys ?? []);
    this.readOnlyKeys = new Set(options.readOnlyKeys ?? []);
    this.cloudflareInventory = options.cloudflareInventory ?? null;
    this.cloudflareSelfProbes = options.cloudflareSelfProbes ?? null;
    this.definitions = [
      ...CONFIG_DEFINITIONS,
      ...(options.additionalDefinitions ?? []),
    ].sort((left, right) => left.key.localeCompare(right.key));
    this.definitionByKey = new Map(
      this.definitions.map((definition) => [definition.key, definition]),
    );
    if (this.definitionByKey.size !== this.definitions.length) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Admin config keys must be registered exactly once.',
      );
    }
  }

  async execute(args: {
    context: P1Context;
    input: Record<string, unknown>;
  }) {
    const action = string(args.input, 'action');
    if (action !== 'config_apply' && action !== 'config_rollback') {
      throw new P1DomainError('INVALID_STATE', `Unknown admin config action ${action}.`);
    }
    const payload = object(args.input.payload ?? {});
    const key = string(payload, 'key');
    const definition = this.definitionByKey.get(key);
    if (!definition) {
      throw new P1DomainError('INVALID_STATE', `Config key ${key} is not registered.`);
    }
    if (definition.scope === 'global') this.requireAdmin(args.context);
    if (this.readOnlyKeys.has(key)) {
      throw new P1DomainError(
        'INVALID_STATE',
        `Config key ${key} is retired and read-only.`,
      );
    }
    const workspaceId =
      definition.scope === 'global'
        ? GLOBAL_WORKSPACE_ID
        : args.context.workspaceId;
    if (action === 'config_rollback') {
      return this.project(
        definition,
        await this.repository.rollback({
          key,
          scope: definition.scope,
          workspaceId,
          targetRevision: positiveInteger(
            payload.targetRevision,
            'targetRevision',
          ),
          expectedRevision: positiveInteger(
            payload.expectedRevision,
            'expectedRevision',
          ),
          actorId: args.context.userId,
          reason: string(payload, 'reason'),
          correlationId: args.context.correlationId,
        }),
      );
    }
    if (key.startsWith('model.activation.evidence.')) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Activation evidence can only be written by activation_probe_run.',
      );
    }
    if (containsSecretShape(payload.value)) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Secret values cannot be stored in admin config.',
      );
    }
    const value = definition.valueSchema.safeParse(payload.value);
    if (!value.success) {
      throw new P1DomainError('INVALID_STATE', `Invalid value for config key ${key}.`);
    }
    await this.valueValidators[key]?.(value.data);
    const revision = await this.repository.apply({
      key,
      scope: definition.scope,
      workspaceId,
      value: value.data,
      expectedRevision: expectedRevision(payload.expectedRevision),
      actorId: args.context.userId,
      reason: string(payload, 'reason'),
      correlationId: args.context.correlationId,
    });
    return this.project(definition, revision);
  }

  async query(args: {
    context: P1Context;
    input: Record<string, unknown>;
  }) {
    const action = string(args.input, 'action');
    if (action === 'config_defaults') {
      const keys = [
        'compliance.aigc_label.default',
        'compliance.regulated_mode.default',
        'compliance.watermark.default',
      ];
      const values = await Promise.all(
        keys.map(async (key) => {
          const revision = await this.repository.get(
            'global',
            GLOBAL_WORKSPACE_ID,
            key,
          );
          return [
            key,
            revision?.value ??
              this.runtime[key] ??
              COMPLIANCE_DEFAULTS[key as keyof typeof COMPLIANCE_DEFAULTS],
          ] as const;
        }),
      );
      return Object.fromEntries(values);
    }
    if (action === 'cloudflare_inventory') {
      this.requireAdmin(args.context);
      if (!this.cloudflareInventory) {
        throw new P1DomainError(
          'INVALID_STATE',
          'Cloudflare inventory is not wired.',
        );
      }
      const [inventory, probes] = await Promise.all([
        this.cloudflareInventory.getInventory(),
        this.cloudflareSelfProbes?.() ?? Promise.resolve([]),
      ]);
      return { inventory, probes };
    }
    if (action === 'config_list') {
      const visibleDefinitions = this.isAdmin(args.context)
        ? this.definitions
        : this.definitions.filter(
            (definition) => definition.scope === 'workspace',
          );
      if (visibleDefinitions.length === 0) this.requireAdmin(args.context);
      const effectiveSnapshots = await this.repository.listEffectiveSnapshots();
      return Promise.all(
        visibleDefinitions.map(async (definition) => {
          const workspaceId =
            definition.scope === 'global'
              ? GLOBAL_WORKSPACE_ID
              : args.context.workspaceId;
          return this.project(
            definition,
            await this.repository.get(
              definition.scope,
              workspaceId,
              definition.key,
            ),
            effectiveSnapshots,
          );
          }),
      );
    }
    if (action === 'config_history') {
      const payload = object(args.input.payload ?? {});
      const key = string(payload, 'key');
      const definition = this.definitionByKey.get(key);
      if (!definition) {
        throw new P1DomainError('INVALID_STATE', `Config key ${key} is not registered.`);
      }
      if (definition.scope === 'global') this.requireAdmin(args.context);
      const workspaceId =
        definition.scope === 'global'
          ? GLOBAL_WORKSPACE_ID
          : args.context.workspaceId;
      return Promise.all(
        (
          await this.repository.history(definition.scope, workspaceId, key)
        ).map((revision) => this.project(definition, revision)),
      );
    }
    if (action !== 'config_get') {
      throw new P1DomainError('INVALID_STATE', `Unknown admin config query ${action}.`);
    }
    const payload = object(args.input.payload ?? {});
    const key = string(payload, 'key');
    const definition = this.definitionByKey.get(key);
    if (!definition) {
      throw new P1DomainError('INVALID_STATE', `Config key ${key} is not registered.`);
    }
    if (definition.scope === 'global') this.requireAdmin(args.context);
    const workspaceId =
      definition.scope === 'global'
        ? GLOBAL_WORKSPACE_ID
        : args.context.workspaceId;
    const effectiveSnapshots = await this.repository.listEffectiveSnapshots();
    return this.project(
      definition,
      await this.repository.get(definition.scope, workspaceId, key),
      effectiveSnapshots,
    );
  }

  private async project(
    definition: AdminConfigDefinition,
    revision: AdminConfigRevision | null,
    effectiveSnapshots: RuntimeEffectiveSnapshot[] = [],
  ) {
    const runtimeSnapshots = effectiveSnapshots
      .map((snapshot) => {
        if (definition.key === 'model.execution.mode') {
          return {
            bootedAt: snapshot.bootedAt,
            effectiveValue: snapshot.executionMode,
            fallbackReason: snapshot.fallbackReason,
            processKind: snapshot.processKind,
            source: snapshot.executionSource,
          };
        }
        if (definition.key === 'model.media.execution.mode') {
          return {
            bootedAt: snapshot.bootedAt,
            effectiveValue: snapshot.mediaMode,
            fallbackReason: snapshot.fallbackReason,
            processKind: snapshot.processKind,
            source: snapshot.mediaSource,
          };
        }
        return null;
      })
      .filter((snapshot) => snapshot !== null)
      .sort((left, right) =>
        left.processKind === right.processKind
          ? 0
          : left.processKind === 'http'
            ? -1
            : 1,
      );
    const validator = this.valueValidators[definition.key];
    const modeValues =
      definition.key === 'model.execution.mode'
        ? ['disabled', 'recorded', 'fixture', 'gateway', 'direct']
        : definition.key === 'model.media.execution.mode'
          ? ['disabled', 'ark', 'tuzi', 'ark,tuzi']
          : [];
    const modeAvailability = validator
      ? await Promise.all(
          modeValues.map(async (value) => {
            try {
              await validator(value);
              return { assemblable: true, missingRequirements: [], value };
            } catch (error) {
              const message =
                error instanceof Error ? error.message : 'runtime_configuration';
              const missingRequirements = [
                ...new Set(message.match(/[A-Z][A-Z0-9_]{2,}/gu) ?? []),
              ];
              return {
                assemblable: false,
                missingRequirements:
                  missingRequirements.length > 0
                    ? missingRequirements
                    : ['runtime_configuration'],
                value,
              };
            }
          }),
        )
      : [];
    return {
      key: definition.key,
      scope: definition.scope,
      storedValue: revision?.value ?? null,
      effectiveValue: this.hotReadKeys.has(definition.key)
        ? revision?.value ?? this.runtime[definition.key] ?? null
        : this.runtime[definition.key] ?? null,
      ...(runtimeSnapshots.length > 0
        ? { effectiveSnapshots: runtimeSnapshots }
        : {}),
      wired: this.wiredKeys.has(definition.key),
      activationEvidenceStatus: this.activationEvidenceStatus,
      ...(modeAvailability.length > 0 ? { modeAvailability } : {}),
      revision: revision?.revision ?? null,
      status: revision?.status ?? null,
      rolledBackToRevision: revision?.rolledBackToRevision ?? null,
      actorId: revision?.actorId ?? null,
      reason: revision?.reason ?? null,
      correlationId: revision?.correlationId ?? null,
      createdAt: revision?.createdAt ?? null,
    };
  }

  private requireAdmin(context: P1Context) {
    if (!this.isAdmin(context)) {
      throw new P1DomainError(
        'FORBIDDEN',
        'This config operation requires a trusted admin actor.',
      );
    }
  }

  private isAdmin(context: P1Context) {
    return (
      context.actor === 'admin' || this.adminActorIds.has(context.userId)
    );
  }
}
