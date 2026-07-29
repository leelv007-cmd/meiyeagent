import { z } from 'zod';

const compositeRevisionSchema = z
  .string()
  .trim()
  .regex(/^[^@\s]+@[^@\s]+$/u)
  .refine((value) => value !== 'unknown@0', {
    message: 'Unknown observability bindings must be represented as absent.',
  });

const axisAbsentSchema = z.object({ kind: z.literal('absent') }).strict();
const axisValueSchema = <Value extends z.ZodType>(
  valueSchema: Value,
) =>
  z.discriminatedUnion('kind', [
    z
      .object({
        kind: z.literal('bound'),
        value: valueSchema,
      })
      .strict(),
    axisAbsentSchema,
  ]);

export const observabilityAxisBindingSchema = z
  .object({
    axisScope: z.enum(['task_root', 'execution_child']),
    skillRevision: axisValueSchema(compositeRevisionSchema),
    promptVersion: axisValueSchema(compositeRevisionSchema),
    catalogRevision: axisValueSchema(z.string().trim().min(1)),
    scene: axisValueSchema(z.string().trim().min(1)),
  })
  .strict();

export type ObservabilityAxisBinding = z.infer<
  typeof observabilityAxisBindingSchema
>;

export const observabilityAxesSchema = z
  .object({
    skillRevision: compositeRevisionSchema,
    promptVersion: compositeRevisionSchema,
    /**
     * Event-attribution revision. This is distinct from
     * CreativeExecutionContract.catalogRevision, which pins the accepted
     * execution catalog contract.
     */
    catalogRevision: z.string().trim().min(1),
    scene: z.string().trim().min(1),
  })
  .strict();

export type ObservabilityAxes = z.infer<typeof observabilityAxesSchema>;

export const observabilitySignalSchema = z.enum([
  'trace',
  'log',
  'metric',
  'score',
  'feedback',
]);

export const observabilityDropEventSchema = z
  .object({
    signal: observabilitySignalSchema,
    reason: z.enum(['permanent-config', 'transient']),
    count: z.number().int().positive(),
    source: z.string().trim().min(1),
  })
  .strict();

export type ObservabilityDropEvent = z.infer<
  typeof observabilityDropEventSchema
>;
