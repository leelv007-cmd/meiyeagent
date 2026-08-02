import { NOTE_STYLE_CONFIG_KEY, noteStyleConfigSchema } from '@meiye/contracts';
import { z } from 'zod';

export const MAX_PLAN_RESOURCE_ALLOWANCE = 1_000_000;
export const MAX_PLAN_CONCURRENCY = 100;
export const MAX_QUEUE_PRIORITY = 100;
export const MAX_ADD_ON_QUANTITY = 1_000_000;
export const MAX_ADD_ON_AMOUNT_MICROS = 1_000_000_000_000;
export const MAX_ADD_ON_OFFERS = 100;
export const MAX_CREDIT_PLAN_AMOUNT = 10_000_000;

const creditPlanSchema = z
  .object({
    concurrencyLimit: z.number().int().positive().max(MAX_PLAN_CONCURRENCY),
    credits: z.number().int().positive().max(MAX_CREDIT_PLAN_AMOUNT),
    currency: z.literal('CNY'),
    monthlyPriceMicros: z
      .number()
      .int()
      .positive()
      .max(MAX_ADD_ON_AMOUNT_MICROS),
    queuePriority: z.number().int().positive().max(MAX_QUEUE_PRIORITY),
    storageMb: z.number().int().positive().max(MAX_PLAN_RESOURCE_ALLOWANCE),
    supportLabel: z.enum(['standard', 'priority']),
  })
  .strict();

const trialCreditPlanSchema = creditPlanSchema.extend({
  monthlyPriceMicros: z
    .number()
    .int()
    .nonnegative()
    .max(MAX_ADD_ON_AMOUNT_MICROS),
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
    amountMicros: z.number().int().nonnegative().max(MAX_ADD_ON_AMOUNT_MICROS),
    credits: z.number().int().positive().max(MAX_CREDIT_PLAN_AMOUNT),
    currency: z.literal('CNY'),
    expireDays: z.number().int().positive().max(3_650),
    id: z.string().min(1).max(100),
  })
  .strict();

const planAllowanceSchema = z
  .object({
    allowance: z
      .object({
        copy: z.number().int().nonnegative().max(MAX_PLAN_RESOURCE_ALLOWANCE),
        image: z.number().int().nonnegative().max(MAX_PLAN_RESOURCE_ALLOWANCE),
        video: z.number().int().nonnegative().max(MAX_PLAN_RESOURCE_ALLOWANCE),
        audio: z.number().int().nonnegative().max(MAX_PLAN_RESOURCE_ALLOWANCE),
      })
      .strict(),
    concurrencyLimit: z.number().int().positive().max(MAX_PLAN_CONCURRENCY),
    queuePriority: z.number().int().positive().max(MAX_QUEUE_PRIORITY),
    supportLabel: z.enum(['standard', 'priority']),
  })
  .strict();

const configSchemas = {
  'byok.adapter.assembly': z.enum(['recorded', 'live']),
  'compliance.aigc_label.default': z.boolean(),
  'compliance.regulated_mode.default': z.boolean(),
  'compliance.watermark.default': z.boolean(),
  // 图文笔记的风格集合：编译器按这份有序集合出候选，运营在后台直接改
  // （U05 / D-107；契约与 Core 同一份，来自 @meiye/contracts）。
  [NOTE_STYLE_CONFIG_KEY]: noteStyleConfigSchema,
  'model.execution.mode': z.enum([
    'recorded',
    'fixture',
    'direct',
    'gateway',
    'disabled',
  ]),
  'model.media.execution.mode': z.enum(['disabled', 'ark', 'tuzi', 'ark,tuzi']),
  'harness.confirmation_card.hold_timeout_seconds': z
    .number()
    .int()
    .min(3_600)
    .max(172_800),
  'plan.addons': z
    .array(
      z
        .object({
          id: z.string().min(1).max(100),
          resource: z.enum(['copy', 'image', 'video', 'audio']),
          quantity: z.number().int().positive().max(MAX_ADD_ON_QUANTITY),
          amountMicros: z
            .number()
            .int()
            .nonnegative()
            .max(MAX_ADD_ON_AMOUNT_MICROS),
          currency: z.string().regex(/^[A-Z]{3}$/u),
        })
        .strict()
    )
    .max(MAX_ADD_ON_OFFERS)
    .superRefine((offers, context) => {
      const ids = new Set<string>();
      for (const [index, offer] of offers.entries()) {
        if (ids.has(offer.id)) {
          context.addIssue({
            code: 'custom',
            message: 'Add-on offer ids must be unique.',
            path: [index, 'id'],
          });
        }
        ids.add(offer.id);
      }
    }),
  'plan.credits.addons': z.array(creditAddOnSchema).max(MAX_ADD_ON_OFFERS),
  'plan.credits.cycle_coefficients':
    creditPlanCycleCoefficientBasisPointsSchema,
  'plan.credits.growth': creditPlanSchema,
  'plan.credits.pro': creditPlanSchema,
  'plan.credits.starter': creditPlanSchema,
  'plan.credits.trial': trialCreditPlanSchema,
  'plan.credits.trial.enabled': z.boolean(),
  'plan.trial.enabled': z.boolean(),
  'plan.allowances.growth': planAllowanceSchema,
  'plan.allowances.pro': planAllowanceSchema,
  'plan.allowances.starter': planAllowanceSchema,
  'plan.allowances.trial': planAllowanceSchema.extend({
    expireDays: z.number().int().positive().max(366).optional(),
  }),
  'platform.defaultModel.copy': z.string().min(1).max(200),
  'platform.defaultModel.image': z.string().min(1).max(200),
  'platform.defaultModel.video': z.string().min(1).max(200),
  'platform.defaultModel.audio': z.string().min(1).max(200),
  'plan.payment-mapping': z
    .object({
      mappings: z
        .array(
          z
            .object({
              paymentProductId: z.string().trim().min(1).max(200),
              interval: z
                .enum(['month', 'year', 'lifetime', 'one_time', 'any'])
                .default('any'),
              tier: z.enum(['starter', 'growth', 'pro']),
            })
            .strict()
        )
        .max(100),
    })
    .strict(),
} satisfies Record<string, z.ZodType>;

export type AdminConfigKey = keyof typeof configSchemas;

/** 表单映射层的唯一入口：契约只有这一份，字段树从它读出来（U05）。 */
export function adminConfigSchemaFor(key: string): undefined | z.ZodType {
  return configSchemas[key as AdminConfigKey];
}

export const ADMIN_CONFIG_KEYS = Object.keys(configSchemas) as AdminConfigKey[];

/** 结构化表单直接给值，不再经过手敲 JSON 这一步。 */
export function parseAdminConfigValue(key: string, value: unknown) {
  const schema = configSchemas[key as AdminConfigKey];
  if (!schema) throw new Error('Unknown selected config key.');
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error('Value does not match the selected config key.');
  }
  return parsed.data;
}

export function parseAdminConfigDraft(key: string, draft: string) {
  const schema = configSchemas[key as AdminConfigKey];
  if (!schema) throw new Error('Unknown selected config key.');
  let value: unknown;
  try {
    value = JSON.parse(draft);
  } catch {
    throw new Error('Value must be valid JSON for the selected config key.');
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error('Value does not match the selected config key.');
  }
  return parsed.data;
}

export function formatAdminConfigValue(value: unknown) {
  if (value === null || value === undefined) return '';
  return JSON.stringify(value, null, 2);
}

export function runtimeSnapshotStatus(
  storedValue: unknown,
  effectiveValue: unknown
) {
  return JSON.stringify(storedValue) === JSON.stringify(effectiveValue)
    ? ('current' as const)
    : ('restart_pending' as const);
}
