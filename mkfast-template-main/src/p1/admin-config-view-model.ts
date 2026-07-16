import { z } from 'zod';

const planAllowanceSchema = z
  .object({
    allowance: z
      .object({
        copy: z.number().int().nonnegative(),
        image: z.number().int().nonnegative(),
        video: z.number().int().nonnegative(),
        audio: z.number().int().nonnegative(),
      })
      .strict(),
    concurrencyLimit: z.number().int().positive(),
    queuePriority: z.number().int().positive(),
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
  'plan.addons': z.array(
    z
      .object({
        id: z.string().min(1),
        resource: z.enum(['copy', 'image', 'video', 'audio']),
        quantity: z.number().int().positive(),
        amountMicros: z.number().int().nonnegative(),
        currency: z.string().length(3),
      })
      .strict()
  ),
  'plan.allowances.growth': planAllowanceSchema,
  'plan.allowances.pro': planAllowanceSchema,
  'plan.allowances.starter': planAllowanceSchema,
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
