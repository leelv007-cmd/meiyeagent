import { z } from 'zod';

export const MAX_PLAN_RESOURCE_ALLOWANCE = 1_000_000;
export const MAX_PLAN_CONCURRENCY = 100;
export const MAX_QUEUE_PRIORITY = 100;
export const MAX_ADD_ON_QUANTITY = 1_000_000;
export const MAX_ADD_ON_AMOUNT_MICROS = 1_000_000_000_000;
export const MAX_ADD_ON_OFFERS = 100;

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
  'douyin.adapter.assembly': z.literal('recorded'),
  'model.execution.mode': z.enum([
    'recorded',
    'fixture',
    'direct',
    'gateway',
    'disabled',
  ]),
  'model.media.execution.mode': z.enum(['disabled', 'ark', 'tuzi', 'ark,tuzi']),
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
