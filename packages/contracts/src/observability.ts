import { z } from 'zod';

const compositeRevisionSchema = z
  .string()
  .trim()
  .regex(/^[^@\s]+@[^@\s]+$/u);

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
